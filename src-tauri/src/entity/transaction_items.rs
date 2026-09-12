use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "transaction_items")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub transaction_id: i64,
    pub product_id: Option<i64>,
    pub product_name: String,
    pub product_price: f64,
    pub buy_price: Option<f64>,
    pub quantity: i64,
    pub subtotal: f64,
    pub item_discount: f64,
    /// Rupiah actually paid for this line: `subtotal` minus `item_discount`,
    /// minus this line's share of the transaction-level discount. Summing it
    /// over a transaction gives `transactions.total_amount`. See migration 018
    /// for the backfill caveat on rows written before it.
    pub net_subtotal: f64,
    pub service_type: Option<String>,
    pub service_ref: Option<String>,
    pub ppob_product_id: Option<i64>,
    pub ppob_product_code: Option<String>,
    pub ppob_inquiry_id: Option<String>,
    pub ppob_payment_code: Option<String>,
    pub ppob_flag_id: Option<String>,
    pub ppob_status: Option<String>,
    pub ppob_message: Option<String>,
    pub ppob_serial_number: Option<String>,
    /// Raw JSON of the provider's payment response, kept verbatim so the PPOB
    /// struk can be reprinted. Only written on a successful fulfilment; see
    /// migration 023 for why it is one text blob and not columns.
    ///
    /// Never serialised: it is a multi-kilobyte provider blob that only the
    /// printer path reads, and the item list it hangs off is returned for every
    /// sale in a paginated history.
    #[serde(skip, default)]
    pub ppob_receipt_data: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::transactions::Entity",
        from = "Column::TransactionId",
        to = "super::transactions::Column::Id"
    )]
    Transaction,
    #[sea_orm(
        belongs_to = "super::products::Entity",
        from = "Column::ProductId",
        to = "super::products::Column::Id"
    )]
    Product,
    #[sea_orm(has_many = "super::refund_items::Entity")]
    RefundItems,
}

impl Related<super::transactions::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Transaction.def()
    }
}

impl Related<super::products::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Product.def()
    }
}

impl Related<super::refund_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RefundItems.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
