use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "products")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub barcode: Option<String>,
    #[sea_orm(unique)]
    pub sku: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub buy_price: f64,
    pub sell_price: f64,
    pub margin: f64,
    pub stock: i64,
    pub unit: String,
    pub min_stock: Option<i64>,
    pub is_active: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::categories::Entity",
        from = "Column::CategoryId",
        to = "super::categories::Column::Id"
    )]
    Category,
    #[sea_orm(has_many = "super::transaction_items::Entity")]
    TransactionItems,
    #[sea_orm(has_many = "super::refund_items::Entity")]
    RefundItems,
    #[sea_orm(has_many = "super::exchange_items::Entity")]
    ExchangeItems,
    #[sea_orm(has_many = "super::stock_writeoffs::Entity")]
    StockWriteoffs,
}

impl Related<super::categories::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Category.def()
    }
}

impl Related<super::transaction_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TransactionItems.def()
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
