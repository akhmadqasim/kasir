use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// One remembered attempt at a money-moving POST.
///
/// `id` is `sha256(scope | user_id | key)`, so the client's own string never
/// becomes a column value and two tills cannot collide on the same key.
/// `response_body` holds the JSON that was returned the first time, which is
/// what a retry receives instead of a second sale.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "idempotency_keys")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub scope: String,
    pub user_id: i64,
    pub request_hash: String,
    /// `in_progress` while the work runs, `completed` once it has a response.
    pub status: String,
    pub response_body: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    /// The sale this key produced, written inside the sale's own DB
    /// transaction (migration 028). Lets a key stranded `in_progress` by a
    /// crash be completed (sale committed) or released (it did not).
    pub transaction_id: Option<i64>,
    /// A random token per claim (migration 030). Every attempt with a key
    /// shares `id`; this tells one claim from a retry's re-claim, even within
    /// the same second.
    pub claim_nonce: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id"
    )]
    User,
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
