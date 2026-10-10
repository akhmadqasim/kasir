//! Discount arithmetic: which discounts are allowed, and how the transaction
//! discount is spread over the lines.

use super::cart::ResolvedItem;
use crate::utils::AppError;

/// Tolerance for floating-point noise when comparing REAL money values.
pub(super) const MONEY_EPSILON: f64 = 0.01;

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
    let mut subtotal_after_item_discounts = 0.0_f64;

    for item in resolved_items {
        let line_subtotal = item.subtotal;
        if !item.item_discount.is_finite()
            || item.item_discount < -MONEY_EPSILON
            || item.item_discount > line_subtotal + MONEY_EPSILON
        {
            return Err(AppError::Validation(format!(
                "Diskon item '{}' tidak valid",
                item.product_name
            )));
        }
        subtotal_after_item_discounts += line_subtotal - item.item_discount;
    }

    if !transaction_discount.is_finite()
        || transaction_discount < -MONEY_EPSILON
        || transaction_discount > subtotal_after_item_discounts + MONEY_EPSILON
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
/// Each share is whole rupiah: the raw shares are floored and the rupiah left
/// over go one each to the lines with the largest remainders (ties to the
/// earlier line), so `12.000 * (1 - 5.000/12.000)` is stored as 7.000, not
/// 6999.999999999999, and the nets add up to the total exactly.
///
/// A fully discounted cart (`net_total == 0`) has nothing to spread, so every
/// line is zero.
///
/// With no transaction discount there is nothing to spread either, and each
/// line keeps exactly its own amount. Re-rounding it anyway moved money
/// between lines: a fractional goods price (1.250,5 from a CSV import) pushed
/// its half rupiah onto the largest line, which could be a PPOB line — whose
/// net then fell below its cost and the sale was refused as a discount on PPOB.
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
    if transaction_discount == 0.0 {
        return line_nets;
    }

    let target = (net_total - transaction_discount).max(0.0);
    let kept_ratio = target / net_total;
    let raw: Vec<f64> = line_nets.iter().map(|net| net * kept_ratio).collect();
    let mut nets: Vec<f64> = raw.iter().map(|value| value.floor()).collect();

    // Whole rupiah left after flooring. Fewer than the lines with a positive
    // remainder, since each remainder is under one; the tolerance absorbs
    // float noise such as 1.9999999 for 2.
    let floor_sum: f64 = nets.iter().sum();
    let units = (target - floor_sum + ROUNDING_TOLERANCE).floor().max(0.0) as usize;
    let mut order: Vec<usize> = (0..raw.len())
        .filter(|&index| raw[index] - nets[index] > 0.0)
        .collect();
    order.sort_by(|&a, &b| {
        (raw[b] - nets[b])
            .total_cmp(&(raw[a] - nets[a]))
            .then(a.cmp(&b))
    });
    for &index in order.iter().take(units) {
        nets[index] += 1.0;
    }

    // Only sub-rupiah money (a fractional price or discount) leaves a residue,
    // and it is never negative beyond float noise. It goes on the line left
    // furthest below its raw share (ties to the earlier line), so a line is
    // only ever rounded up toward its share, and a zero line never is.
    let residue = target - nets.iter().sum::<f64>();
    if residue.abs() > ROUNDING_TOLERANCE {
        let furthest_below = (0..nets.len())
            .filter(|&index| raw[index] > 0.0)
            .min_by(|&a, &b| (raw[b] - nets[b]).total_cmp(&(raw[a] - nets[a])));
        if let Some(index) = furthest_below {
            nets[index] += residue;
        }
    }
    nets
}

/// Float noise allowed when splitting rupiah: far below a cent, far above the
/// error of summing a cart of REAL prices.
const ROUNDING_TOLERANCE: f64 = 1e-6;

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
    fn prorated_line_nets_are_whole_rupiah_and_sum_to_the_total() {
        // 10.000 / 10.000 / 10.000 sharing a 10.000 discount: each raw share is
        // 6666.67, so one line takes the extra rupiah (the first, on a tie).
        let items = vec![
            resolved_item(10_000.0, 0.0),
            resolved_item(10_000.0, 0.0),
            resolved_item(10_000.0, 0.0),
        ];

        let nets = prorated_line_nets(&items, 10_000.0);

        assert_eq!(nets, vec![6_667.0, 6_667.0, 6_666.0]);
        assert_eq!(nets.iter().sum::<f64>(), 20_000.0);
        assert_eq!(
            prorated_line_nets(&[resolved_item(12_000.0, 0.0)], 5_000.0),
            vec![7_000.0]
        );
    }

    #[test]
    fn prorated_line_nets_keep_each_line_as_is_without_a_transaction_discount() {
        // A fractional goods price next to a PPOB line: rounding used to move
        // the goods' half rupiah onto the larger line, the PPOB one.
        let items = vec![resolved_item(1_250.5, 0.0), resolved_item(12_000.0, 0.0)];

        assert_eq!(prorated_line_nets(&items, 0.0), vec![1_250.5, 12_000.0]);
    }

    /// A free line (100% item discount) is never rounded up, and the
    /// sub-rupiah residue goes up onto the line furthest below its share
    /// instead of coming off the largest line, which may be a PPOB line at
    /// cost. Raw shares: 923.54, 11076.96, 0.
    #[test]
    fn prorated_line_nets_never_round_a_zero_line_up_or_cut_the_largest() {
        let items = vec![
            resolved_item(1_000.5, 0.0),
            resolved_item(12_000.0, 0.0),
            resolved_item(5_000.0, 5_000.0),
        ];

        let nets = prorated_line_nets(&items, 1_000.0);

        assert_eq!(nets, vec![923.5, 11_077.0, 0.0]);
        assert_eq!(nets.iter().sum::<f64>(), 12_000.5);
    }

    /// Every line whole and a zero line among them: no unit is left over, so
    /// nothing goes to the zero line.
    #[test]
    fn prorated_line_nets_leave_a_zero_line_at_zero_on_an_even_split() {
        let items = vec![
            resolved_item(0.0, 0.0),
            resolved_item(10_000.0, 0.0),
            resolved_item(10_000.0, 0.0),
        ];

        assert_eq!(
            prorated_line_nets(&items, 10_000.0),
            vec![0.0, 5_000.0, 5_000.0]
        );
    }

    #[test]
    fn prorated_line_nets_are_zero_for_a_fully_discounted_cart() {
        let items = vec![resolved_item(20_000.0, 20_000.0)];
        assert_eq!(prorated_line_nets(&items, 0.0), vec![0.0]);
    }
}
