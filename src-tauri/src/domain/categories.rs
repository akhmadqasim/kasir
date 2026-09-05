//! Category inputs.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCategoryInput {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateCategoryInput {
    /// Optional in the payload because over HTTP the id lives in the path
    /// (`PUT /api/categories/{id}`) and the route overwrites whatever the body
    /// says. The Tauri command builds this struct from separate arguments.
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}
