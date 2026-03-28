use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "transactions")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub receipt_number: String,
    pub user_id: i64,
    pub total_amount: f64,
    pub subtotal_amount: f64,
    pub discount_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: Option<f64>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id"
    )]
    User,
    #[sea_orm(has_many = "super::transaction_items::Entity")]
    TransactionItems,
    #[sea_orm(has_many = "super::refunds::Entity")]
    Refunds,
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl Related<super::transaction_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TransactionItems.def()
    }
}

impl Related<super::refunds::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Refunds.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
