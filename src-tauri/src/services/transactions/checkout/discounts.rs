//! Discount arithmetic: which discounts are allowed, and how the transaction
//! discount is spread over the lines.

use super::cart::ResolvedItem;
use crate::utils::AppError;

/// Validates client-supplied discounts against server-computed subtotals.
///
/// Each `item_discount` must sit in `[0, line_subtotal]` where `line_subtotal`
/// is the server price multiplied by the quantity (`ResolvedItem::subtotal`,
/// derived from re-fetched prices in `resolve_items`). The
/// `transaction_discount` must sit in `[0, subtotal_after_item_discounts]`.
/// Out-of-range discounts are rejected (never silently clamped) to protect
/// money integrity.
pub(super) fn validate_discounts(
    resolved_items: &[ResolvedItem],
    transaction_discount: f64,
) -> Result<(), AppError> {
    // Small tolerance for floating-point noise on REAL money values.
    const EPSILON: f64 = 0.01;

    let mut subtotal_after_item_discounts = 0.0_f64;

    for item in resolved_items {
        let line_subtotal = item.subtotal;
        if !item.item_discount.is_finite()
            || item.item_discount < -EPSILON
            || item.item_discount > line_subtotal + EPSILON
        {
            return Err(AppError::Validation(format!(
                "Diskon item '{}' tidak valid",
                item.product_name
            )));
        }
        subtotal_after_item_discounts += line_subtotal - item.item_discount;
    }

    if !transaction_discount.is_finite()
        || transaction_discount < -EPSILON
        || transaction_discount > subtotal_after_item_discounts + EPSILON
    {
        return Err(AppError::Validation("Diskon tidak valid".into()));
    }

    Ok(())
}

/// The rupiah actually paid for each line, in the order the lines were given.
///
/// A line starts at `subtotal - item_discount`, then gives up its share of the
/// transaction-level discount, weighted by that post-item-discount amount. The
/// result sums to `subtotal_amount - discount_amount`, i.e. the transaction
/// total, so refunds, reports and receipts can all read one stored number
/// instead of each re-deriving money from prices and two discount columns.
///
/// A fully discounted cart (`net_total == 0`) has nothing to spread, so every
/// line is zero.
pub(super) fn prorated_line_nets(
    resolved_items: &[ResolvedItem],
    transaction_discount: f64,
) -> Vec<f64> {
    let line_nets: Vec<f64> = resolved_items
        .iter()
        .map(|item| item.subtotal - item.item_discount)
        .collect();
    let net_total: f64 = line_nets.iter().sum();

    if net_total <= 0.0 {
        return vec![0.0; line_nets.len()];
    }

    let kept_ratio = (1.0 - transaction_discount / net_total).max(0.0);
    line_nets.into_iter().map(|net| net * kept_ratio).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolved_item(subtotal: f64, item_discount: f64) -> ResolvedItem {
        ResolvedItem {
            product_name: "Item".to_string(),
            subtotal,
            item_discount,
            ..Default::default()
        }
    }

    #[test]
    fn validate_discounts_accepts_in_range_values() {
        // subtotal_after_item_discounts = (20_000 - 2_000) + (10_000 - 0) = 28_000
        let items = vec![
            resolved_item(20_000.0, 2_000.0),
            resolved_item(10_000.0, 0.0),
        ];

        assert!(validate_discounts(&items, 0.0).is_ok());
        assert!(validate_discounts(&items, 5_000.0).is_ok());
        // Transaction discount may consume the full post-item-discount subtotal.
        assert!(validate_discounts(&items, 28_000.0).is_ok());
    }

    #[test]
    fn validate_discounts_rejects_item_discount_above_line_subtotal() {
        let items = vec![resolved_item(20_000.0, 21_000.0)];
        assert!(validate_discounts(&items, 0.0).is_err());
    }

    #[test]
    fn validate_discounts_rejects_negative_item_discount() {
        let items = vec![resolved_item(20_000.0, -1.0)];
        assert!(validate_discounts(&items, 0.0).is_err());
    }

    #[test]
    fn validate_discounts_rejects_transaction_discount_above_subtotal() {
        // subtotal_after_item_discounts = 20_000; a 25_000 transaction discount
        // would push the total negative, so it must be rejected (not clamped).
        let items = vec![resolved_item(20_000.0, 0.0)];
        assert!(validate_discounts(&items, 25_000.0).is_err());
    }

    #[test]
    fn validate_discounts_rejects_negative_transaction_discount() {
        let items = vec![resolved_item(20_000.0, 0.0)];
        assert!(validate_discounts(&items, -1.0).is_err());
    }

    #[test]
    fn prorated_line_nets_split_the_transaction_discount_by_weight() {
        // Lines net 18_000 and 6_000 after item discounts; a 6_000 transaction
        // discount is 25% of the 24_000 that is left, so each line gives up 25%.
        let items = vec![
            resolved_item(20_000.0, 2_000.0),
            resolved_item(6_000.0, 0.0),
        ];

        let nets = prorated_line_nets(&items, 6_000.0);

        assert_eq!(nets, vec![13_500.0, 4_500.0]);
        assert_eq!(nets.iter().sum::<f64>(), 18_000.0);
    }

    #[test]
    fn prorated_line_nets_are_zero_for_a_fully_discounted_cart() {
        let items = vec![resolved_item(20_000.0, 20_000.0)];
        assert_eq!(prorated_line_nets(&items, 0.0), vec![0.0]);
    }
}
