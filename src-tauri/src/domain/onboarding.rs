//! First-run setup inputs.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct SetupStoreInput {
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetupAdminInput {
    pub username: String,
    pub pin: String,
    pub full_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompleteOnboardingInput {
    pub store: SetupStoreInput,
    pub admin: SetupAdminInput,
}
