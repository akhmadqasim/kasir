//! Product search, CRUD, quick-access shortcuts and bulk import.

mod crud;
mod import;
mod search;
mod shortcuts;

pub use crud::{create, delete, update};
pub use import::{bulk_create, import_template_csv, IMPORT_TEMPLATE_FILENAME};
pub use search::{get_by_barcode, search, LOW_STOCK_SQL};
pub use shortcuts::{popular, toggle_pin, track_selection};

/// The admin and the one product every test in this module tree starts from.
#[cfg(test)]
mod test_fixtures {
    use crate::domain::products::CreateProductInput;
    use crate::domain::Actor;

    pub(super) fn admin() -> Actor {
        Actor::new(1, "admin")
    }

    pub(super) fn make_valid_input() -> CreateProductInput {
        CreateProductInput {
            barcode: Some("1234567890123".to_string()),
            sku: Some("SKU-001".to_string()),
            name: "Beras 5kg".to_string(),
            category_id: None,
            buy_price: 50_000.0,
            sell_price: 65_000.0,
            margin: None,
            stock: 100,
            unit: "pcs".to_string(),
            min_stock: Some(10),
        }
    }
}
