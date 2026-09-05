//! Login and user-management inputs.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub pin: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserInput {
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub pin: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserInput {
    /// The account being edited, which is not necessarily the actor.
    pub user_id: i64,
    pub username: Option<String>,
    pub full_name: Option<String>,
    pub role: Option<String>,
    pub new_pin: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleUserActiveInput {
    /// The account being enabled or disabled, which is not necessarily the actor.
    pub user_id: i64,
    pub is_active: bool,
}
