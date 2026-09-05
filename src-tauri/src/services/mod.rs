//! All business logic, independent of any transport.
//!
//! Every function here has the shape `(&DatabaseConnection, Actor, Input) ->
//! Result<Output, AppError>`; the `Actor` is omitted where the operation needs
//! no identity. Modules in here must never `use tauri::` or `use axum::` — that
//! is what lets `cargo test --lib` exercise the rules without a running app.

pub mod auth;
pub mod categories;
pub mod guard;
pub mod onboarding;
pub mod products;
pub mod shifts;
pub mod stock;
