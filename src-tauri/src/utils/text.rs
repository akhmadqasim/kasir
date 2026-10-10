//! Bounds on free text that ends up on a printed receipt.

use super::AppError;

/// Longest free-text field (notes, reasons, footer, store details) we accept.
/// Receipts are laid out one row per 32-48 chars, so this keeps a field to a
/// few dozen printed rows at most.
pub const MAX_PRINTED_TEXT_CHARS: usize = 500;

/// Refuse `value` when it is longer than [`MAX_PRINTED_TEXT_CHARS`].
/// `label` names the field in the Indonesian message.
pub fn ensure_printable_len(value: Option<&str>, label: &str) -> Result<(), AppError> {
    if value.is_some_and(|v| v.chars().count() > MAX_PRINTED_TEXT_CHARS) {
        return Err(AppError::Validation(format!(
            "{label} terlalu panjang (maksimal {MAX_PRINTED_TEXT_CHARS} karakter)"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_up_to_the_cap_passes_and_longer_is_refused() {
        let at_cap = "é".repeat(MAX_PRINTED_TEXT_CHARS);
        assert!(ensure_printable_len(None, "Catatan").is_ok());
        assert!(ensure_printable_len(Some(&at_cap), "Catatan").is_ok());
        let over = format!("{at_cap}x");
        match ensure_printable_len(Some(&over), "Catatan") {
            Err(AppError::Validation(message)) => {
                assert_eq!(message, "Catatan terlalu panjang (maksimal 500 karakter)")
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
    }
}
