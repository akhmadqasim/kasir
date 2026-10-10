//! Products by id, for the cashier's cart to reprice its lines in one request.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QuerySelect};

use crate::domain::products::ProductLookup;
use crate::entity::products;
use crate::utils::AppError;

/// The most ids one lookup takes: far above a cart plus its held carts, low
/// enough that the `IN (...)` list stays small.
///
/// The one source of this number. The frontend splits a longer id list into
/// chunks of `MAX_LOOKUP_IDS` from `src/lib/api/products.ts`, and
/// `the_frontend_chunks_by_the_same_cap` fails if the two drift apart.
pub const MAX_LOOKUP_IDS: usize = 500;

/// Parses the `ids` query value, `"1,2,3"`. Blank entries are skipped.
pub fn parse_lookup_ids(raw: &str) -> Result<Vec<i64>, AppError> {
    let ids = raw
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            part.parse::<i64>()
                .map_err(|_| AppError::Validation(format!("ID produk tidak valid: {part}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if ids.len() > MAX_LOOKUP_IDS {
        return Err(AppError::Validation(format!(
            "Terlalu banyak produk dalam satu pengecekan ({} ID). Paling banyak {MAX_LOOKUP_IDS} ID per permintaan.",
            ids.len()
        )));
    }
    Ok(ids)
}

/// The current price, stock and unit of each product in `ids`, inactive ones
/// included (flagged by `is_active`). Ids with no row are left out.
pub async fn lookup(db: &DatabaseConnection, ids: &[i64]) -> Result<Vec<ProductLookup>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(products::Entity::find()
        .select_only()
        .columns([
            products::Column::Id,
            products::Column::SellPrice,
            products::Column::Stock,
            products::Column::Unit,
            products::Column::IsActive,
        ])
        .filter(products::Column::Id.is_in(ids.iter().copied()))
        .into_model::<ProductLookup>()
        .all(db)
        .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_product, setup_test_db};

    #[test]
    fn parses_a_comma_separated_id_list() {
        assert_eq!(parse_lookup_ids("1, 2,,3").expect("ids"), vec![1, 2, 3]);
        assert!(parse_lookup_ids("").expect("ids").is_empty());
        assert!(parse_lookup_ids("1,abc").is_err());
    }

    #[test]
    fn refuses_more_ids_than_the_cap() {
        let raw = (1..=MAX_LOOKUP_IDS as i64 + 1)
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let err = parse_lookup_ids(&raw).expect_err("over the cap");
        assert!(matches!(err, AppError::Validation(_)), "a 422, got {err:?}");
        assert!(
            err.to_string()
                .contains(&format!("Paling banyak {MAX_LOOKUP_IDS} ID")),
            "names the cap: {err}"
        );

        let at_cap = (1..=MAX_LOOKUP_IDS as i64)
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        assert_eq!(
            parse_lookup_ids(&at_cap).expect("at the cap").len(),
            MAX_LOOKUP_IDS
        );
    }

    /// The frontend chunks its lookups by this same cap; a chunk bigger than
    /// the cap would be refused whole.
    #[test]
    fn the_frontend_chunks_by_the_same_cap() {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/api/products.ts");
        let source = std::fs::read_to_string(&path).expect("read the frontend products API");
        assert!(
            source.contains(&format!("export const MAX_LOOKUP_IDS = {MAX_LOOKUP_IDS}")),
            "{} must export `MAX_LOOKUP_IDS = {MAX_LOOKUP_IDS}`",
            path.display()
        );
    }

    #[tokio::test]
    async fn returns_the_listed_products_only() {
        let db = setup_test_db().await;
        let beras = insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
        let air = insert_product(&db, "Air Mineral", 2_000.0, 3_000.0, 40).await;
        insert_product(&db, "Gula 1kg", 12_000.0, 15_000.0, 5).await;

        let mut found = lookup(&db, &[beras.id, air.id, 9_999])
            .await
            .expect("lookup");
        found.sort_by_key(|p| p.id);

        assert_eq!(found.len(), 2);
        assert_eq!(
            (found[0].id, found[0].sell_price, found[0].stock),
            (beras.id, 65_000.0, 10)
        );
        assert_eq!((found[1].id, found[1].sell_price), (air.id, 3_000.0));
        assert!(found.iter().all(|p| p.is_active));
    }
}
