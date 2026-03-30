use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use super::auth::get_mitra_client;
use super::client::MitraClient;
use super::models::{NotificationItem, NotificationListResult};
use super::parsers::get_str_field;
use crate::utils::AppError;

fn parse_notification(item: &Value) -> Option<NotificationItem> {
    let obj = item.as_object()?;

    let inbox_id = get_str_field(obj, &["inbox_id", "id", "notification_id"])
        .unwrap_or_default();
    if inbox_id.is_empty() {
        return None;
    }

    let title = get_str_field(obj, &["title", "subject", "category"])
        .unwrap_or_else(|| "Pemberitahuan".to_string());

    let message = get_str_field(obj, &["message", "body", "content", "description"])
        .unwrap_or_default();

    let category = get_str_field(obj, &["category", "type", "tag"])
        .unwrap_or_else(|| "INFORMASI".to_string())
        .to_uppercase();

    let status_raw = get_str_field(obj, &["status", "is_read", "read"])
        .unwrap_or_else(|| "unread".to_string());
    let status = match status_raw.to_lowercase().as_str() {
        "read" | "1" | "true" | "sudah_dibaca" => "read".to_string(),
        _ => "unread".to_string(),
    };

    let created_at = get_str_field(obj, &["created_at", "date", "timestamp", "created_date"]);

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
) -> Result<NotificationListResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

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

    Ok(NotificationListResult {
        items,
        unread_count,
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

    Ok(())
}
