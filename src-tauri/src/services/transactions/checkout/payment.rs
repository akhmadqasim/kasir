//! How the total is paid: the single-method path and the split-payment path,
//! each producing the method to record, what was handed over, the change, and
//! the per-method splits.

use crate::domain::transactions::{CheckoutTransactionInput, PaymentSplit};
use crate::services::transactions::{validate_payment_method, MIXED_PAYMENT_METHOD};
use crate::utils::AppError;

/// The money side of a sale, ready to be stored.
pub(super) struct Payment {
    /// The one method the sale is filed under, or `mixed`.
    pub(super) method: String,
    /// What the customer handed over, change included.
    pub(super) amount: f64,
    pub(super) change: f64,
    /// What each method actually covers; these sum to the total.
    pub(super) splits: Vec<PaymentSplit>,
}

/// A single payment method paying the whole total. Only cash may overpay; the
/// difference is the change.
fn single_method_payment(
    payment_method: &str,
    requested_payment_amount: f64,
    total_amount: f64,
) -> Result<Payment, AppError> {
    let is_cash = payment_method == "cash";

    if is_cash && requested_payment_amount < total_amount {
        return Err(AppError::Validation(format!(
            "Pembayaran kurang. Total: {}, Dibayar: {}",
            total_amount, requested_payment_amount
        )));
    }

    Ok(Payment {
        method: payment_method.to_string(),
        amount: if is_cash {
            requested_payment_amount
        } else {
            total_amount
        },
        change: if is_cash {
            requested_payment_amount - total_amount
        } else {
            0.0
        },
        splits: vec![PaymentSplit {
            payment_method: payment_method.to_string(),
            bank_name: None,
            amount: total_amount,
        }],
    })
}

/// The payment for `total_amount`, from the split breakdown when the request
/// has a non-empty one and from the single method otherwise.
pub(super) fn calculate_payment(
    input: &CheckoutTransactionInput,
    total_amount: f64,
) -> Result<Payment, AppError> {
    let splits: Vec<PaymentSplit> = input
        .payment_breakdown
        .iter()
        .flatten()
        .filter(|split| split.amount > 0.0)
        .map(|split| PaymentSplit {
            payment_method: split.payment_method.clone(),
            bank_name: split
                .bank_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string),
            amount: split.amount,
        })
        .collect();

    if splits.is_empty() {
        return single_method_payment(&input.payment_method, input.payment_amount, total_amount);
    }

    split_payment(splits, total_amount)
}

fn split_payment(splits: Vec<PaymentSplit>, total_amount: f64) -> Result<Payment, AppError> {
    // `bank_name` is optional on every method: the sender bank on a transfer,
    // the issuing bank on a debit card, the app on an e-wallet or QRIS payment.
    // Left empty, the receipt and reports just name the method.
    for split in &splits {
        validate_payment_method(&split.payment_method)?;
    }

    let mut seen = std::collections::HashSet::new();
    if splits
        .iter()
        .any(|split| !seen.insert(split.payment_method.as_str()))
    {
        return Err(AppError::Validation(
            "Metode pembayaran tidak boleh duplikat".into(),
        ));
    }

    let total_paid: f64 = splits.iter().map(|split| split.amount).sum();

    let Some(cash_index) = splits
        .iter()
        .position(|split| split.payment_method == "cash")
    else {
        if (total_paid - total_amount).abs() > 0.01 {
            return Err(AppError::Validation(
                "Total pembayaran gabungan harus sama dengan total transaksi".into(),
            ));
        }

        let method = if splits.len() == 1 {
            splits[0].payment_method.clone()
        } else {
            MIXED_PAYMENT_METHOD.to_string()
        };

        return Ok(Payment {
            method,
            amount: total_paid,
            change: 0.0,
            splits,
        });
    };

    let non_cash_total: f64 = splits
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != cash_index)
        .map(|(_, split)| split.amount)
        .sum();

    if non_cash_total - total_amount > 0.01 {
        return Err(AppError::Validation(
            "Nominal non-tunai tidak boleh melebihi total transaksi".into(),
        ));
    }

    let remaining_due = (total_amount - non_cash_total).max(0.0);
    if splits[cash_index].amount + 0.01 < remaining_due {
        return Err(AppError::Validation(
            "Nominal tunai belum cukup untuk menutup sisa pembayaran".into(),
        ));
    }

    let change = (splits[cash_index].amount - remaining_due).max(0.0);
    let cash_method = splits[cash_index].payment_method.clone();
    let mut effective_splits = splits;
    effective_splits[cash_index].amount = remaining_due;

    // Drop splits that contribute nothing. When the non-cash legs already
    // cover the total the cash leg lands on 0, and keeping it recorded the sale
    // as `mixed`, inserted a Rp 0 payment row, made the sale match a "cash"
    // filter and put a spurious empty bucket in the payment-method stats.
    effective_splits.retain(|split| split.amount > 0.0);

    let method = match effective_splits.len() {
        // A zero-total sale paid in cash: nothing is left to record, so fall
        // back to the method the cashier actually chose.
        0 => cash_method,
        1 => effective_splits[0].payment_method.clone(),
        _ => MIXED_PAYMENT_METHOD.to_string(),
    };

    Ok(Payment {
        method,
        amount: total_paid,
        change,
        splits: effective_splits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::transactions::PaymentSplitInput;

    /// A checkout paid by `splits`; the cart itself plays no part here.
    fn breakdown_input(splits: Vec<(&str, f64)>) -> CheckoutTransactionInput {
        CheckoutTransactionInput {
            items: vec![],
            payment_method: "cash".to_string(),
            payment_amount: 0.0,
            payment_breakdown: Some(
                splits
                    .into_iter()
                    .map(|(method, amount)| PaymentSplitInput {
                        payment_method: method.to_string(),
                        bank_name: None,
                        amount,
                    })
                    .collect(),
            ),
            notes: None,
            transaction_discount: None,
            ppob_pin: None,
            channel: None,
        }
    }

    #[test]
    fn fully_non_cash_payment_drops_the_zero_cash_split() {
        // QRIS already covers the 50.000 total; the 20.000 cash the customer put
        // on the counter is all change.
        let input = breakdown_input(vec![("qris", 50_000.0), ("cash", 20_000.0)]);

        let payment = calculate_payment(&input, 50_000.0).expect("breakdown accepted");

        assert_eq!(payment.method, "qris");
        assert_eq!(payment.amount, 70_000.0);
        assert_eq!(payment.change, 20_000.0);
        assert_eq!(payment.splits.len(), 1);
        assert_eq!(payment.splits[0].payment_method, "qris");
        assert_eq!(payment.splits[0].amount, 50_000.0);
    }

    #[test]
    fn partially_cash_payment_stays_mixed() {
        let input = breakdown_input(vec![("qris", 30_000.0), ("cash", 25_000.0)]);

        let payment = calculate_payment(&input, 50_000.0).expect("breakdown accepted");

        assert_eq!(payment.method, MIXED_PAYMENT_METHOD);
        assert_eq!(payment.change, 5_000.0);
        assert_eq!(payment.splits.len(), 2);
        assert_eq!(payment.splits[1].amount, 20_000.0);
    }
}
