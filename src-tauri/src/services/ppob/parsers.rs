use serde_json::Value;

/// Parse a JSON value as f64, handling both number and string representations
pub fn parse_number(val: Option<&Value>) -> Option<f64> {
    val.and_then(|v| {
        v.as_f64()
            .or_else(|| {
                v.as_str()
                    .and_then(|s| s.replace(',', "").parse::<f64>().ok())
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

/// Extract string from Value trying multiple keys (returns empty string if not found)
pub fn extract_string(val: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(s) = val[*key].as_str() {
            return s.to_string();
        }
        if let Some(n) = val[*key].as_i64() {
            return n.to_string();
        }
    }
    String::new()
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
/// `{"receipt_data": {...}}`, `history-payment/detail` uses `detail`, `data` or
/// `transaction`, and the `*/payment` endpoints answer flat. Keeping the list in
/// one place is what stops each reader growing its own half of it.
///
/// The order is the one `history-payment/detail` already read in, with
/// `receipt_data` last: only the payment endpoints send it, and appending it
/// leaves [`unwrap_response`]'s answer on the history path exactly as it was.
pub const RESPONSE_WRAPPERS: &[&str] = &[
    "history_payment",
    "detail",
    "data",
    "transaction",
    "receipt_data",
];

/// The object carrying the actual fields: the first known wrapper present, or
/// the response itself when it came back flat.
pub fn unwrap_response(raw: &Value) -> &Value {
    RESPONSE_WRAPPERS
        .iter()
        .find_map(|key| raw.get(*key))
        .unwrap_or(raw)
}

/// Every object worth searching for a field: the response itself and each known
/// wrapper it carries. Use this instead of [`unwrap_response`] when the fields
/// you want are split across the root and a wrapper — a payment response keeps
/// its status at the top and the struk details one level down.
pub fn response_objects(raw: &Value) -> impl Iterator<Item = &serde_json::Map<String, Value>> {
    std::iter::once(raw)
        .chain(RESPONSE_WRAPPERS.iter().filter_map(|key| raw.get(*key)))
        .filter_map(|value| value.as_object())
}
