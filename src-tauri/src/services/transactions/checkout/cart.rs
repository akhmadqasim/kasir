//! Turning the cart the client sent into lines the server trusts: which channel
//! it may be stored under, and each line's name and price re-read from the
//! catalogue (goods) or checked for the metadata fulfilment will need (PPOB).

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use crate::domain::transactions::TransactionItemInput;
use crate::entity::products;
use crate::services::transactions::{CHANNEL_PPOB, CHANNEL_SALES};
use crate::utils::AppError;

/// One cart line after validation. Goods lines carry the server's own name and
/// prices; PPOB lines carry what the inquiry quoted.
#[derive(Default)]
pub(super) struct ResolvedItem {
    pub(super) product_id: Option<i64>,
    pub(super) product_name: String,
    pub(super) sell_price: f64,
    pub(super) buy_price: Option<f64>,
    pub(super) quantity: i64,
    pub(super) subtotal: f64,
    pub(super) item_discount: f64,
    pub(super) service_type: Option<String>,
    pub(super) service_ref: Option<String>,
    pub(super) ppob_product_id: Option<i64>,
    pub(super) ppob_product_code: Option<String>,
    pub(super) ppob_inquiry_id: Option<String>,
    pub(super) ppob_payment_code: Option<String>,
    pub(super) ppob_flag_id: Option<String>,
}

/// Refuses an empty cart; returns whether it has any PPOB line.
pub(super) fn validate_cart_composition(items: &[TransactionItemInput]) -> Result<bool, AppError> {
    if items.is_empty() {
        return Err(AppError::Validation(
            "Item transaksi tidak boleh kosong".into(),
        ));
    }

    let has_ppob = items.iter().any(|item| item.service_type.is_some());

    Ok(has_ppob)
}

/// Which channel the cart may be stored under.
///
/// An absent channel is the cashier's cart, so a client that never heard of the
/// field keeps working. The PPOB page may only ring up PPOB lines: it has no
/// stock to move and its sales are deliberately excluded from the goods
/// figures, so a product line arriving from there is a bug, not a sale.
pub(super) fn resolve_channel(
    channel: Option<&str>,
    items: &[TransactionItemInput],
) -> Result<&'static str, AppError> {
    match channel {
        None | Some(CHANNEL_SALES) => Ok(CHANNEL_SALES),
        Some(CHANNEL_PPOB) => {
            if items.iter().all(|item| item.service_type.is_some()) {
                Ok(CHANNEL_PPOB)
            } else {
                Err(AppError::Validation(
                    "Transaksi di halaman PPOB hanya boleh berisi item PPOB".into(),
                ))
            }
        }
        Some(_) => Err(AppError::Validation("Channel transaksi tidak valid".into())),
    }
}

pub(super) async fn resolve_items<C: ConnectionTrait>(
    db: &C,
    items: &[TransactionItemInput],
    allow_negative_stock: bool,
) -> Result<Vec<ResolvedItem>, AppError> {
    let mut resolved_items = Vec::with_capacity(items.len());

    for item_input in items {
        if item_input.quantity <= 0 {
            return Err(AppError::Validation(
                "Jumlah item harus lebih dari 0".into(),
            ));
        }

        let resolved = match item_input.service_type.clone() {
            Some(service_type) => resolve_ppob_line(item_input, service_type)?,
            None => resolve_product_line(db, item_input, allow_negative_stock).await?,
        };
        resolved_items.push(resolved);
    }

    Ok(resolved_items)
}

/// A PPOB line: its price is the one the PPOB screen quoted, and it must carry
/// whatever its service type needs at pay time — a product code for a direct
/// top-up, an inquiry for a bill.
fn resolve_ppob_line(
    item_input: &TransactionItemInput,
    service_type: String,
) -> Result<ResolvedItem, AppError> {
    let product_name = item_input
        .product_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Validation("Nama produk PPOB harus diisi".into()))?;
    let product_price = item_input
        .product_price
        .filter(|value| *value > 0.0)
        .ok_or_else(|| AppError::Validation("Harga produk PPOB harus diisi".into()))?;
    let service_ref = item_input
        .service_ref
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Validation("Referensi pelanggan PPOB harus diisi".into()))?;

    match service_type.as_str() {
        "pulsa" | "data" => {
            if item_input.ppob_product_id.is_none()
                || is_blank(item_input.ppob_product_code.as_deref())
            {
                return Err(AppError::Validation(
                    "Metadata produk PPOB belum lengkap untuk topup langsung".into(),
                ));
            }
        }
        "pln" | "pdam" | "bpjs" | "pp" | "transfer" | "emoney" => {
            if is_blank(item_input.ppob_inquiry_id.as_deref()) {
                return Err(AppError::Validation(
                    "Inquiry PPOB harus dilakukan sebelum checkout".into(),
                ));
            }
        }
        other => {
            return Err(AppError::Validation(format!(
                "Service type PPOB tidak didukung: {}",
                other
            )))
        }
    }

    Ok(ResolvedItem {
        product_id: None,
        product_name,
        sell_price: product_price,
        buy_price: item_input.buy_price,
        quantity: item_input.quantity,
        subtotal: product_price * item_input.quantity as f64,
        item_discount: item_input.item_discount.unwrap_or(0.0),
        service_type: Some(service_type),
        service_ref: Some(service_ref),
        ppob_product_id: item_input.ppob_product_id,
        ppob_product_code: item_input.ppob_product_code.clone(),
        ppob_inquiry_id: item_input.ppob_inquiry_id.clone(),
        ppob_payment_code: item_input.ppob_payment_code.clone(),
        ppob_flag_id: item_input.ppob_flag_id.clone(),
    })
}

/// A goods line: name and prices come from the active product, never the
/// request. The stock check here only gives a friendly message early; the
/// guarded UPDATE in `persist` is what actually prevents overselling.
async fn resolve_product_line<C: ConnectionTrait>(
    db: &C,
    item_input: &TransactionItemInput,
    allow_negative_stock: bool,
) -> Result<ResolvedItem, AppError> {
    let product_id = item_input
        .product_id
        .ok_or_else(|| AppError::Validation("Produk fisik harus memiliki ID produk".into()))?;

    let product = products::Entity::find_by_id(product_id)
        .filter(products::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "Produk dengan ID {} tidak ditemukan atau tidak aktif",
                product_id
            ))
        })?;

    if product.stock < item_input.quantity && !allow_negative_stock {
        return Err(AppError::Validation(format!(
            "Stok '{}' tidak cukup (tersedia: {}, diminta: {})",
            product.name, product.stock, item_input.quantity
        )));
    }

    Ok(ResolvedItem {
        product_id: Some(product.id),
        product_name: product.name,
        sell_price: product.sell_price,
        buy_price: Some(product.buy_price),
        quantity: item_input.quantity,
        subtotal: product.sell_price * item_input.quantity as f64,
        item_discount: item_input.item_discount.unwrap_or(0.0),
        ..Default::default()
    })
}

fn is_blank(value: Option<&str>) -> bool {
    value.is_none_or(|value| value.trim().is_empty())
}
