use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "cash_flows")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub shift_id: i64,
    pub user_id: i64,
    #[sea_orm(column_name = "type")]
    pub flow_type: String,
    pub amount: f64,
    pub description: String,
    pub created_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::shifts::Entity",
        from = "Column::ShiftId",
        to = "super::shifts::Column::Id"
    )]
    Shift,
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id"
    )]
    User,
}

impl Related<super::shifts::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Shift.def()
    }
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
