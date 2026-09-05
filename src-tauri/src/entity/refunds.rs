use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "refunds")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub refund_number: String,
    pub transaction_id: i64,
    pub user_id: i64,
    #[sea_orm(column_name = "type")]
    pub refund_type: String,
    pub total_refund_amount: f64,
    pub total_exchange_amount: Option<f64>,
    pub difference_amount: Option<f64>,
    pub payment_method: Option<String>,
    pub reason: Option<String>,
    /// The shift whose drawer the money came out of — the shift that was open
    /// when the return was taken, not the one that rang up the sale. `None` for
    /// refunds recorded with no shift open, and for the historical rows
    /// migration 022 could not place.
    pub shift_id: Option<i64>,
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
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id"
    )]
    User,
    #[sea_orm(has_many = "super::refund_items::Entity")]
    RefundItems,
    #[sea_orm(has_many = "super::exchange_items::Entity")]
    ExchangeItems,
    #[sea_orm(has_many = "super::stock_writeoffs::Entity")]
    StockWriteoffs,
}

impl Related<super::transactions::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Transaction.def()
    }
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl Related<super::refund_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RefundItems.def()
    }
}

impl Related<super::exchange_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ExchangeItems.def()
    }
}

impl Related<super::stock_writeoffs::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::StockWriteoffs.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
