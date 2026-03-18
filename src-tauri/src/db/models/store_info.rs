use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct StoreInfo {
    pub id: i64,
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub logo_path: Option<String>,
    pub additional_info: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
