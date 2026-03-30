use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;
use tauri::State;
use tokio::sync::Mutex;

use super::auth::get_mitra_client;
use super::client::MitraClient;
use super::models::{NotificationItem, NotificationListResult};
use super::parsers::get_str_field;
use crate::utils::AppError;

// Cache for notification data to avoid re-fetching 2000+ items on every page change
struct NotificationCache {
    items: Vec<NotificationItem>,
    unread_count: i64,
    fetched_at: Instant,
}

static NOTIFICATION_CACHE: std::sync::LazyLock<Mutex<Option<NotificationCache>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

fn parse_notification(item: &Value) -> Option<NotificationItem> {
    let obj = item.as_object()?;

    let inbox_id = get_str_field(obj, &["inbox_id", "id", "notification_id"])
        .unwrap_or_default();
    if inbox_id.is_empty() {
        return None;
    }

    let title = get_str_field(obj, &["title", "subject"])
        .unwrap_or_else(|| "Pemberitahuan".to_string());

    let message = get_str_field(obj, &["message", "body", "content", "description"])
        .unwrap_or_default();

    let category = get_str_field(obj, &["type", "category", "tag"])
        .unwrap_or_else(|| "INFORMASI".to_string())
        .to_uppercase();

    // flag_read: 1 = read, 0 = unread (integer field)
    let flag_read = obj.get("flag_read")
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(0);
    let status = if flag_read == 1 { "read" } else { "unread" }.to_string();

    // Parse formatted_date "DD-MM-YYYY HH:MM:SS" → ISO "YYYY-MM-DDTHH:MM:SS"
    let created_at = get_str_field(obj, &["formatted_date", "created_at", "date", "timestamp"])
        .map(|s| {
            let parts: Vec<&str> = s.splitn(2, ' ').collect();
            if parts.len() == 2 {
                let date_parts: Vec<&str> = parts[0].split('-').collect();
                if date_parts.len() == 3 {
                    return format!("{}-{}-{}T{}", date_parts[2], date_parts[1], date_parts[0], parts[1]);
                }
            }
            s
        });

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

#[tauri::command]
pub async fn ppob_get_notifications(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    page: Option<i64>,
    per_page: Option<i64>,
    force_refresh: Option<bool>,
) -> Result<NotificationListResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let page_num = page.unwrap_or(1);
    let limit = per_page.unwrap_or(20);
    let force = force_refresh.unwrap_or(false);

    // Check cache first (valid for 5 minutes)
    let cache_ttl = std::time::Duration::from_secs(300);
    {
        let cache = NOTIFICATION_CACHE.lock().await;
        if !force {
            if let Some(ref c) = *cache {
                if c.fetched_at.elapsed() < cache_ttl {
                    let total_count = c.items.len() as i64;
                    let total_pages = ((total_count as f64) / (limit as f64)).ceil() as i64;
                    let start = ((page_num - 1) * limit) as usize;
                    let paginated: Vec<NotificationItem> = c.items
                        .iter()
                        .skip(start)
                        .take(limit as usize)
                        .cloned()
                        .collect();

                    return Ok(NotificationListResult {
                        items: paginated,
                        unread_count: c.unread_count,
                        total_count,
                        current_page: page_num,
                        total_pages,
                    });
                }
            }
        }
    }

    // Fetch from API
    let client = mitra.lock().await;
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

    let mut items: Vec<NotificationItem> = inbox_array
        .iter()
        .filter_map(parse_notification)
        .collect();

    // Sort by date descending (newest first)
    items.sort_by(|a, b| {
        let da = a.created_at.as_deref().unwrap_or("");
        let db_date = b.created_at.as_deref().unwrap_or("");
        db_date.cmp(da)
    });

    // Store in cache
    {
        let mut cache = NOTIFICATION_CACHE.lock().await;
        *cache = Some(NotificationCache {
            items: items.clone(),
            unread_count,
            fetched_at: Instant::now(),
        });
    }

    let total_count = items.len() as i64;
    let total_pages = ((total_count as f64) / (limit as f64)).ceil() as i64;
    let start = ((page_num - 1) * limit) as usize;
    let paginated: Vec<NotificationItem> = items
        .into_iter()
        .skip(start)
        .take(limit as usize)
        .collect();

    Ok(NotificationListResult {
        items: paginated,
        unread_count,
        total_count,
        current_page: page_num,
        total_pages,
    })
}

#[tauri::command]
pub async fn ppob_mark_all_read(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<(), AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    client.post("inbox/read-all", json!({})).await?;

    // Invalidate cache
    let mut cache = NOTIFICATION_CACHE.lock().await;
    *cache = None;

    Ok(())
}

#[tauri::command]
pub async fn ppob_mark_notification_read(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    inbox_id: String,
) -> Result<(), AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    client
        .post(
            "inbox/update",
            json!({
                "inbox_id": inbox_id,
                "status": "read"
            }),
        )
        .await?;

    // Invalidate cache
    let mut cache = NOTIFICATION_CACHE.lock().await;
    *cache = None;

    Ok(())
}
