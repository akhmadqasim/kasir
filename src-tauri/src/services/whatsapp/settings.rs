//! WhatsApp settings, stored in `store_info.additional_info["whatsapp"]`
//! alongside the printer keys and the four `AppSettings` sections — the same
//! blob, merged through the same [`crate::services::settings::merge_additional_info`]
//! every other settings section uses.

use sea_orm::{DatabaseConnection, EntityTrait};

use crate::domain::whatsapp::WhatsappSettings;
use crate::entity::store_info;
use crate::services::settings::merge_additional_info;
use crate::utils::AppError;

pub async fn get_whatsapp_settings(db: &DatabaseConnection) -> Result<WhatsappSettings, AppError> {
    let store = store_info::Entity::find_by_id(1_i64).one(db).await?;
    Ok(store.map(|s| whatsapp_settings_of(&s)).unwrap_or_default())
}

/// Pure extraction from an already-fetched store row, for a caller (like
/// `services::whatsapp::send_receipt`) that needs the row itself as well and
/// would otherwise fetch it a second time just for this.
pub(crate) fn whatsapp_settings_of(store: &store_info::Model) -> WhatsappSettings {
    store
        .additional_info
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| v.get("whatsapp").cloned())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

pub async fn save_caption_template(
    db: &DatabaseConnection,
    caption_template: String,
) -> Result<(), AppError> {
    merge_additional_info(db, |info| {
        ensure_whatsapp_section(info);
        info["whatsapp"]["caption_template"] = serde_json::json!(caption_template);
        Ok(())
    })
    .await
}

/// Written by `enable`/`disable` only — see [`WhatsappSettings::enabled`].
pub(crate) async fn set_enabled(db: &DatabaseConnection, enabled: bool) -> Result<(), AppError> {
    merge_additional_info(db, |info| {
        ensure_whatsapp_section(info);
        info["whatsapp"]["enabled"] = serde_json::json!(enabled);
        Ok(())
    })
    .await
}

fn ensure_whatsapp_section(info: &mut serde_json::Value) {
    if !info["whatsapp"].is_object() {
        info["whatsapp"] = serde_json::json!({});
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::whatsapp::DEFAULT_CAPTION_TEMPLATE;
    use crate::test_support::{insert_store_info, setup_test_db};

    #[tokio::test]
    async fn defaults_before_anything_is_saved() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;

        let settings = get_whatsapp_settings(&db).await.expect("read");
        assert!(!settings.enabled);
        assert_eq!(settings.caption_template, DEFAULT_CAPTION_TEMPLATE);
    }

    #[tokio::test]
    async fn saving_the_caption_does_not_touch_the_enabled_flag_or_its_neighbours() {
        let db = setup_test_db().await;
        insert_store_info(&db, true).await;

        set_enabled(&db, true).await.expect("enable");
        save_caption_template(&db, "Halo {store}!".into())
            .await
            .expect("save caption");

        let settings = get_whatsapp_settings(&db).await.expect("read");
        assert!(settings.enabled);
        assert_eq!(settings.caption_template, "Halo {store}!");

        // The sales section the fixture seeded is still there.
        let app_settings = crate::services::settings::get_app_settings(&db)
            .await
            .expect("app settings");
        assert!(app_settings.sales.allow_negative_stock);
    }

    #[tokio::test]
    async fn set_enabled_round_trips_independently_of_the_caption() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;

        set_enabled(&db, true).await.expect("enable");
        assert!(get_whatsapp_settings(&db).await.expect("read").enabled);

        set_enabled(&db, false).await.expect("disable");
        assert!(!get_whatsapp_settings(&db).await.expect("read").enabled);
    }
}
