use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub username: String,
    #[serde(skip_serializing)]
    pub pin_hash: String,
    pub full_name: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::transactions::Entity")]
    Transactions,
    #[sea_orm(has_many = "super::refunds::Entity")]
    Refunds,
    #[sea_orm(has_many = "super::stock_writeoffs::Entity")]
    StockWriteoffs,
}

impl Related<super::transactions::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Transactions.def()
    }
}

impl Related<super::refunds::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Refunds.def()
    }
}

impl Related<super::stock_writeoffs::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::StockWriteoffs.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
