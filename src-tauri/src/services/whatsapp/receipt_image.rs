//! The struk as a PNG, for WhatsApp.
//!
//! Reuses the printer's own raster renderer (`printing::raster`) on exactly
//! the same [`crate::printing::receipt::ReceiptData`] the thermal printer
//! draws from, so a struk sent by chat looks like the one that comes out of
//! the printer — same font, same columns, same line breaks — without a
//! printer needing to be configured at all: only the paper width and footer
//! text are read from `store.additional_info`, never a printer id.
//!
//! Windows only, because the raster renderer is GDI. There is no text-mode
//! fallback here the way `printing::escpos` is one for the thermal printer:
//! a message needs a picture, not a run of characters a phone would show in
//! whatever font WhatsApp picked.

use sea_orm::DatabaseConnection;

use crate::entity::store_info;
use crate::printing::receipt::{columns, format_receipt_text};
use crate::services::receipt::{build_sale_receipt_data, get_printer_settings};
use crate::utils::AppError;

/// `store` is taken already-fetched rather than re-queried here: `send_receipt`
/// (the only caller) needs the same row for the caption's store name, and
/// fetching it twice for one request was wasted round-trips to the same table.
#[cfg(windows)]
pub async fn render_receipt_png(
    db: &DatabaseConnection,
    store: &store_info::Model,
    transaction_id: i64,
) -> Result<Vec<u8>, AppError> {
    use crate::printing::raster::{render_lines, DOTS_58MM, DOTS_80MM};

    let printer_settings = get_printer_settings(&store.additional_info);
    let paper_width = printer_settings.paper_width.unwrap_or(58);
    let (receipt_data, _items) =
        build_sale_receipt_data(db, store, printer_settings.footer_text, transaction_id).await?;

    let cpl = columns(paper_width);
    let dots_wide = if paper_width >= 80 {
        DOTS_80MM
    } else {
        DOTS_58MM
    };
    let lines = format_receipt_text(&receipt_data, paper_width);

    let bitmap = tokio::task::spawn_blocking(move || render_lines(&lines, cpl, dots_wide))
        .await
        .map_err(|e| AppError::Internal(format!("Render struk error: {e}")))?
        .map_err(AppError::Internal)?;

    encode_png(&bitmap)
}

#[cfg(windows)]
fn encode_png(bitmap: &crate::printing::raster::Bitmap1bpp) -> Result<Vec<u8>, AppError> {
    use image::codecs::png::PngEncoder;
    use image::{ExtendedColorType, ImageEncoder};

    // Expand the printer's 1-bit-per-pixel rows into 8-bit grayscale: the PNG
    // crate's 1-bit path expects a different bit order than `GS v 0` packs
    // (`Bitmap1bpp`'s own doc comment), and a grayscale PNG this size — a few
    // hundred pixels wide, a struk's worth of rows tall — is a few kilobytes
    // more either way, not worth writing a second bit-packing scheme for.
    let mut gray = vec![0xFF_u8; (bitmap.width * bitmap.height) as usize];
    let bytes_per_row = bitmap.bytes_per_row();
    for y in 0..bitmap.height {
        for x in 0..bitmap.width {
            let byte = bitmap.data[(y * bytes_per_row + x / 8) as usize];
            let dot_set = byte & (0x80 >> (x % 8)) != 0;
            if dot_set {
                gray[(y * bitmap.width + x) as usize] = 0x00;
            }
        }
    }

    let mut out = Vec::new();
    PngEncoder::new(&mut out)
        .write_image(&gray, bitmap.width, bitmap.height, ExtendedColorType::L8)
        .map_err(|e| AppError::Internal(format!("Gagal membuat gambar struk: {e}")))?;
    Ok(out)
}

#[cfg(not(windows))]
pub async fn render_receipt_png(
    _db: &DatabaseConnection,
    _store: &store_info::Model,
    _transaction_id: i64,
) -> Result<Vec<u8>, AppError> {
    Err(AppError::Internal(
        "Pembuatan gambar struk hanya tersedia di Windows".to_string(),
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use crate::test_support::{
        insert_store_info, insert_transaction, insert_transaction_item, insert_user, setup_test_db,
    };
    use sea_orm::EntityTrait;

    async fn store(db: &DatabaseConnection) -> store_info::Model {
        store_info::Entity::find_by_id(1_i64)
            .one(db)
            .await
            .expect("query")
            .expect("store row")
    }

    /// The renderer is exercised end to end against the real GDI backend in
    /// `printing::raster`'s own tests; here it only has to prove that a
    /// transaction turns into *some* well-formed PNG, sized like a struk
    /// rather than empty or malformed.
    #[tokio::test]
    async fn a_transaction_renders_to_a_non_trivial_png() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;
        let cashier = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let transaction = insert_transaction(
            &db,
            cashier.id,
            17_000.0,
            "completed",
            "2026-09-13 07:15:00",
        )
        .await;
        insert_transaction_item(
            &db,
            transaction.id,
            None,
            "Gula Pasir 1kg",
            17_000.0,
            15_000.0,
            1,
        )
        .await;

        let png = render_receipt_png(&db, &store(&db).await, transaction.id)
            .await
            .expect("renders");

        // The PNG signature, so a rendering bug that produced garbage bytes
        // rather than an image fails loudly here instead of on a phone.
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        assert!(png.len() > 200, "a struk-sized PNG is more than a header");
    }

    #[tokio::test]
    async fn a_missing_transaction_is_a_not_found_rather_than_a_panic() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;

        let err = render_receipt_png(&db, &store(&db).await, 999)
            .await
            .expect_err("no such transaction");
        assert!(matches!(err, AppError::NotFound(_)));
    }
}
