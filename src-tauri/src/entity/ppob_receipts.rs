//! The provider's payment response, kept so a PPOB struk can be reprinted.
//!
//! One row per fulfilled PPOB line, and a table of its own rather than a column
//! on `transaction_items`: it is several kilobytes that only the printer reads,
//! and as a column every query over the sale history would carry it. See
//! migration 023.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "ppob_receipts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub transaction_item_id: i64,
    /// Raw JSON of the provider's payment response, verbatim.
    pub data: String,
    pub created_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::transaction_items::Entity",
        from = "Column::TransactionItemId",
        to = "super::transaction_items::Column::Id"
    )]
    TransactionItem,
}

impl Related<super::transaction_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TransactionItem.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
