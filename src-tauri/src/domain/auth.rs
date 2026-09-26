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

/// Whether `pin` has the shape every PIN in the app has: 4 to 6 ASCII digits.
///
/// The one definition behind both the login PIN (`services::auth::validate_pin`)
/// and the Mitra transaction PIN typed at a PPOB sale
/// (`services::ppob::executor::validate_pin`); each caller words its own error.
pub fn pin_has_valid_format(pin: &str) -> bool {
    (4..=6).contains(&pin.len()) && pin.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pin_is_four_to_six_ascii_digits() {
        for good in ["1234", "12345", "123456"] {
            assert!(pin_has_valid_format(good), "{good:?}");
        }
        for bad in [
            "",
            "123",
            "1234567",
            "12a4",
            "12 45",
            "\u{0661}\u{0662}\u{0663}\u{0664}",
        ] {
            assert!(!pin_has_valid_format(bad), "{bad:?}");
        }
    }
}
