//! Category inputs.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCategoryInput {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateCategoryInput {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}
