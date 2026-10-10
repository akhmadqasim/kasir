use serde_json::Value;

/// Parse a JSON value as f64, handling both number and string representations
pub fn parse_number(val: Option<&Value>) -> Option<f64> {
    val.and_then(|v| {
        v.as_f64()
            .or_else(|| {
                v.as_str()
                    .and_then(|s| s.trim().replace(',', "").parse::<f64>().ok())
            })
            .or_else(|| v.as_i64().map(|i| i as f64))
    })
}

/// Parse a JSON value as string, handling both string and number representations
pub fn parse_string(val: Option<&Value>) -> Option<String> {
    val.and_then(|v| {
        v.as_str().map(String::from).or_else(|| {
            if v.is_number() {
                Some(v.to_string())
            } else {
                None
            }
        })
    })
}

/// Try multiple field names and return the first match as string
pub fn get_str_field(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| parse_string(obj.get(*k)))
}

/// Try multiple field names and return the first match as f64
pub fn get_num_field(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|k| parse_number(obj.get(*k)))
}

/// Extract optional string from Value trying multiple keys
pub fn extract_optional_string(val: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(s) = val[*key].as_str() {
            return Some(s.to_string());
        }
    }
    None
}

/// Extract f64 from Value trying multiple keys (returns 0.0 if not found)
pub fn extract_f64(val: &Value, keys: &[&str]) -> f64 {
    for key in keys {
        if let Some(n) = parse_number(Some(&val[*key])) {
            return n;
        }
    }
    0.0
}

/// Keys Mitra is known to wrap a response body in.
///
/// The same field arrives at a different depth per endpoint: `pulsa/v2/topup`
/// answers `{"history_payment": {...}}`, `confirm-payment` answers
/// `{"receipt_data": {...}}`, `history-payment/detail` was documented with
/// `detail`, `data` or `transaction`, and the `*/payment` endpoints answer
/// flat. Keeping the list in one place is what stops each reader growing its
/// own half of it.
pub const RESPONSE_WRAPPERS: &[&str] = &[
    "history_payment",
    "detail",
    "data",
    "transaction",
    "receipt_data",
];

/// Every object worth searching for a field: the response itself and each known
/// wrapper it carries. A payment response keeps its status at the top and the
/// struk details one level down, and which level that is depends on the
/// endpoint.
pub fn response_objects(raw: &Value) -> impl Iterator<Item = &serde_json::Map<String, Value>> {
    std::iter::once(raw)
        .chain(RESPONSE_WRAPPERS.iter().filter_map(|key| raw.get(*key)))
        .filter_map(|value| value.as_object())
}

/// The first non-blank string (or number) under `keys`, searched over the
/// response and every known wrapper ([`response_objects`]). Key order wins
/// over depth: `token_number` one level down beats `serial_number` at the
/// root. A blank value (`""`, `"   "`, Mitra's habit for "none") never ends
/// the search, so it cannot hide a real value deeper down.
pub fn find_string(raw: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        response_objects(raw).find_map(|obj| {
            parse_string(obj.get(*key))
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty())
        })
    })
}

/// [`find_string`] for amounts: the first value under `keys`, at any known
/// depth, that reads as a number.
pub fn find_number(raw: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| response_objects(raw).find_map(|obj| parse_number(obj.get(*key))))
}

/// [`find_number`], `0.0` when there is none.
pub fn find_f64(raw: &Value, keys: &[&str]) -> f64 {
    find_number(raw, keys).unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The PLN prepaid shape the contract documents: the token one level
    /// down in `data`, a blank `serial_number` at the root.
    #[test]
    fn find_string_searches_the_wrappers_in_key_order() {
        let raw = json!({
            "message": "OK",
            "serial_number": "",
            "data": {
                "token_number": "4617 5400 1832 5962 7611",
                "serial_number": "SN-1"
            }
        });
        assert_eq!(
            find_string(&raw, &["token_number", "serial_number"]).as_deref(),
            Some("4617 5400 1832 5962 7611")
        );
        assert_eq!(
            find_string(&raw, &["serial_number"]).as_deref(),
            Some("SN-1")
        );
        assert_eq!(find_string(&raw, &["sn"]), None);
        assert_eq!(
            find_string(
                &json!({ "history_payment": { "trx_id": 501 } }),
                &["trx_id"]
            )
            .as_deref(),
            Some("501")
        );
    }

    #[test]
    fn find_f64_reads_numbers_and_strings_at_any_depth() {
        let raw = json!({ "message": "OK", "data": { "amount": "23500.00", "admin_fee": 3500 } });
        assert_eq!(find_f64(&raw, &["amount"]), 23_500.0);
        assert_eq!(find_f64(&raw, &["admin", "admin_fee"]), 3_500.0);
        assert_eq!(find_f64(&raw, &["total"]), 0.0);
    }
}
