//! Transport-agnostic input and output types.
//!
//! Nothing here may depend on `tauri` or on an HTTP framework. These types are
//! the vocabulary the services in [`crate::services`] speak, so the same service
//! can be driven by the current Tauri command layer or by the HTTP layer that
//! replaces it.

pub mod actor;
pub mod auth;
pub mod categories;
pub mod onboarding;
pub mod products;
pub mod stock;

pub use actor::Actor;
