use chrono::TimeZone;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use crate::domain::ppob::{NotificationItem, NotificationListResult};
use crate::services::ppob::auth::get_mitra_request_context;
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::parsers::get_str_field;
use crate::services::ppob::session_cache::{SessionCache, Ticket};
use crate::utils::AppError;

// Cache for notification data to avoid re-fetching 2000+ items on every page change
struct NotificationCache {
    items: Vec<NotificationItem>,
    unread_count: i64,
    fetched_at: Instant,
}

static NOTIFICATION_CACHE: std::sync::LazyLock<SessionCache<Option<NotificationCache>>> =
    std::sync::LazyLock::new(SessionCache::new);

/// Drop the cached inbox. Called when the Mitra session is cleared, so the
/// next account never sees — or marks read — the previous one's messages, and
/// after a mark-read, so the next page shows it. A fetch still in flight at
/// that moment is not cached either: it answered for the old state.
pub fn forget_cache() {
    NOTIFICATION_CACHE.forget();
}

/// The cached inbox, one page of it, if it is younger than `ttl`.
fn cached_page(
    ttl: std::time::Duration,
    page: Option<i64>,
    per_page: Option<i64>,
) -> Option<NotificationListResult> {
    NOTIFICATION_CACHE
        .read(|cache| {
            cache
                .as_ref()
                .filter(|c| c.fetched_at.elapsed() < ttl)
                .map(|c| paginate(&c.items, c.unread_count, page, per_page))
        })
        .flatten()
}

/// Cache an inbox fetched from `ticket` on, unless it was forgotten since.
fn store_inbox(ticket: Ticket, items: Vec<NotificationItem>, unread_count: i64) {
    NOTIFICATION_CACHE.store(ticket, |cache| {
        *cache = Some(NotificationCache {
            items,
            unread_count,
            fetched_at: Instant::now(),
        });
    });
}

/// One page of `items`. `page` and `per_page` come straight off the query
/// string, so they are clamped here: `page = 0` used to skip past the end and
/// `per_page = 0` divided by zero.
fn paginate(
    items: &[NotificationItem],
    unread_count: i64,
    page: Option<i64>,
    per_page: Option<i64>,
) -> NotificationListResult {
    let page_num = page.unwrap_or(1).max(1);
    let limit = per_page.unwrap_or(20).clamp(1, 100);
    let total_count = items.len() as i64;
    let total_pages = (total_count + limit - 1) / limit;
    let start = ((page_num - 1) * limit) as usize;

    NotificationListResult {
        items: items
            .iter()
            .skip(start)
            .take(limit as usize)
            .cloned()
            .collect(),
        unread_count,
        total_count,
        current_page: page_num,
        total_pages,
    }
}

/// Mitra's `formatted_date` is `DD-MM-YYYY HH:MM:SS` in WIB (UTC+7). It is
/// rewritten as a local-time `YYYY-MM-DDTHH:MM:SS`; a value with that shape
/// whose time does not parse is only reordered, and anything else is passed
/// through as it came.
fn wib_date_to_local(raw: String) -> String {
    let Some((date, time)) = raw.split_once(' ') else {
        return raw;
    };
    let date_parts: Vec<&str> = date.split('-').collect();
    let [day, month, year] = date_parts[..] else {
        return raw;
    };
    let iso = format!("{year}-{month}-{day}T{time}");

    let wib = chrono::FixedOffset::east_opt(7 * 3600).expect("UTC+7 is a valid offset");
    chrono::NaiveDateTime::parse_from_str(&iso, "%Y-%m-%dT%H:%M:%S")
        .ok()
        .and_then(|naive| wib.from_local_datetime(&naive).single())
        .map(|at| {
            at.with_timezone(&chrono::Local)
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()
        })
        .unwrap_or(iso)
}

fn parse_notification(item: &Value) -> Option<NotificationItem> {
    let obj = item.as_object()?;

    let inbox_id = get_str_field(obj, &["inbox_id", "id", "notification_id"]).unwrap_or_default();
    if inbox_id.is_empty() {
        return None;
    }

    let title =
        get_str_field(obj, &["title", "subject"]).unwrap_or_else(|| "Pemberitahuan".to_string());

    let message =
        get_str_field(obj, &["message", "body", "content", "description"]).unwrap_or_default();

    let category = get_str_field(obj, &["type", "category", "tag"])
        .unwrap_or_else(|| "INFORMASI".to_string())
        .to_uppercase();

    // flag_read: 1 = read, 0 = unread (integer field)
    let flag_read = obj
        .get("flag_read")
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .unwrap_or(0);
    let status = if flag_read == 1 { "read" } else { "unread" }.to_string();

    let created_at = get_str_field(obj, &["formatted_date", "created_at", "date", "timestamp"])
        .map(wib_date_to_local);

    Some(NotificationItem {
        inbox_id,
        title,
        message,
        category,
        status,
        created_at,
        raw_data: item.clone(),
    })
}

pub async fn list(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    page: Option<i64>,
    per_page: Option<i64>,
    force_refresh: Option<bool>,
) -> Result<NotificationListResult, AppError> {
    let force = force_refresh.unwrap_or(false);

    // Check cache first (valid for 5 minutes)
    let cache_ttl = std::time::Duration::from_secs(300);
    if !force {
        if let Some(cached) = cached_page(cache_ttl, page, per_page) {
            return Ok(cached);
        }
    }

    // Fetch from API. The ticket is taken first; see [`store_inbox`].
    let ticket = NOTIFICATION_CACHE.ticket();
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client.post("inbox/get-all", json!({})).await?;

    let inbox_array = result
        .get("inbox")
        .or_else(|| result.get("data"))
        .or_else(|| result.get("notifications"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let unread_count = result
        .get("count_inbox")
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
        })
        .unwrap_or(0);

    let mut items: Vec<NotificationItem> =
        inbox_array.iter().filter_map(parse_notification).collect();

    // Sort by date descending (newest first)
    items.sort_by(|a, b| {
        let da = a.created_at.as_deref().unwrap_or("");
        let db_date = b.created_at.as_deref().unwrap_or("");
        db_date.cmp(da)
    });

    let result = paginate(&items, unread_count, page, per_page);

    store_inbox(ticket, items, unread_count);

    Ok(result)
}

pub async fn mark_all_read(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<(), AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    client.post("inbox/read-all", json!({})).await?;

    forget_cache();

    Ok(())
}

pub async fn mark_read(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    inbox_id: String,
) -> Result<(), AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    client
        .post(
            "inbox/update",
            json!({
                "inbox_id": inbox_id,
                "status": "read"
            }),
        )
        .await?;

    forget_cache();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An inbox fetch still in flight at a logout (or a mark-read) answered
    /// for the old state and must not be served afterwards.
    #[test]
    fn an_inbox_fetched_across_a_forget_is_not_cached() {
        let ticket = NOTIFICATION_CACHE.ticket();
        forget_cache();
        store_inbox(ticket, items(3), 3);

        assert!(cached_page(std::time::Duration::from_secs(300), None, None).is_none());
    }

    fn items(count: usize) -> Vec<NotificationItem> {
        (0..count)
            .map(|i| NotificationItem {
                inbox_id: i.to_string(),
                title: "Pemberitahuan".to_string(),
                message: String::new(),
                category: "INFORMASI".to_string(),
                status: "unread".to_string(),
                created_at: None,
                raw_data: Value::Null,
            })
            .collect()
    }

    #[test]
    fn a_wib_formatted_date_becomes_local_iso() {
        let expected = chrono::FixedOffset::east_opt(7 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 9, 5, 18, 30, 0)
            .unwrap()
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();
        assert_eq!(wib_date_to_local("05-09-2026 18:30:00".into()), expected);
    }

    /// The right shape with a time that does not parse is only reordered;
    /// any other shape is left exactly as Mitra sent it.
    #[test]
    fn other_date_shapes_are_reordered_or_passed_through() {
        assert_eq!(
            wib_date_to_local("05-09-2026 25:61:00".into()),
            "2026-09-05T25:61:00"
        );
        for raw in ["2026-09-05T18:30:00", "5 Sep", "05-09 18:30:00", ""] {
            assert_eq!(wib_date_to_local(raw.into()), raw);
        }
    }

    #[test]
    fn paginate_counts_pages_and_slices_the_requested_one() {
        let result = paginate(&items(45), 3, Some(3), Some(20));
        assert_eq!(result.total_count, 45);
        assert_eq!(result.total_pages, 3);
        assert_eq!(result.current_page, 3);
        assert_eq!(result.unread_count, 3);
        let ids: Vec<&str> = result.items.iter().map(|i| i.inbox_id.as_str()).collect();
        assert_eq!(ids, vec!["40", "41", "42", "43", "44"]);
    }

    /// `page = 0` used to skip past the end and `per_page = 0` divided by
    /// zero; both come straight off the query string.
    #[test]
    fn paginate_clamps_page_and_per_page_from_the_query_string() {
        let first = paginate(&items(5), 0, Some(0), Some(0));
        assert_eq!(first.current_page, 1);
        assert_eq!(first.total_pages, 5);
        assert_eq!(first.items.len(), 1);

        let capped = paginate(&items(150), 0, None, Some(-1));
        assert_eq!(capped.items.len(), 1);

        let huge = paginate(&items(150), 0, None, Some(10_000));
        assert_eq!(huge.items.len(), 100);
        assert_eq!(huge.total_pages, 2);

        let empty = paginate(&[], 0, None, None);
        assert_eq!(empty.total_pages, 0);
        assert!(empty.items.is_empty());
    }
}
