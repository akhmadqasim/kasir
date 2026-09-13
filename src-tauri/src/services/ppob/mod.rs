//! PPOB (Payment Point Online Bank) against the Mitra Indogrosir API.
//!
//! [`client`] speaks HTTP to the provider, [`auth`] keeps the Mitra session
//! alive across restarts, [`executor`] is the one place a purchase is actually
//! fulfilled, and the remaining modules are the read-side catalogues, inquiries
//! and history the cashier screen shows.

pub mod auth;
pub mod client;
pub mod executor;
pub mod history;
pub mod inquiry;
pub mod menu;
pub mod notifications;
pub mod parsers;
pub mod payment;
pub mod search;

pub use client::MitraClient;
