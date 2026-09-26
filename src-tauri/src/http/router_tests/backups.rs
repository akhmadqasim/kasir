//! Backups: a download, an upload, and no client-supplied paths.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, login_token, multipart_content_type, multipart_file,
    router, same_origin, scratch_data_dir, state,
};
use crate::test_support::setup_test_db;

/// The 16 bytes that make a file a SQLite database, followed by enough padding
/// to look like a page.
fn fake_sqlite_image() -> Vec<u8> {
    let mut bytes = b"SQLite format 3\0".to_vec();
    bytes.resize(512, 0);
    bytes
}

/// The export is a download, not a copy to a path the caller named.
#[tokio::test]
async fn the_database_export_is_a_download_with_a_server_chosen_filename() {
    scratch_data_dir();
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/backups/export")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let disposition = response
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .expect("a download header")
        .to_string();
    assert!(disposition.starts_with("attachment; filename=\"kasir-export-"));
    assert!(disposition.ends_with(".db\""));

    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/vnd.sqlite3")
    );

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    assert!(
        bytes.starts_with(b"SQLite format 3\0"),
        "the download must be the database itself"
    );
}

#[tokio::test]
async fn the_database_export_is_closed_to_a_cashier() {
    scratch_data_dir();
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/backups/export")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

/// An upload that is not a database must be refused before anything is staged.
/// A file that only fails at the next launch would brick the till in a way
/// nobody could connect back to the upload.
#[tokio::test]
async fn an_upload_that_is_not_a_sqlite_database_is_refused() {
    let dir = scratch_data_dir();
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let pending = dir.join("kasir.db.restore-pending");
    let _ = std::fs::remove_file(&pending);

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/backups/import")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, multipart_content_type())
                .body(multipart_file("file", "kasir.db", b"ini bukan database"))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_json(response).await["code"], json!("validation"));
    assert!(
        !pending.exists(),
        "a rejected upload must not have been staged"
    );
}

/// The `filename` on a multipart part is attacker-controlled. The import must
/// not read it at all — what lands on disk is the one staging path the service
/// owns, whatever the part claims to be called.
#[tokio::test]
async fn an_upload_filename_never_becomes_a_path() {
    let dir = scratch_data_dir();
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let escape = dir.join("dicuri.db");
    let _ = std::fs::remove_file(&escape);

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/backups/import")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, multipart_content_type())
                .body(multipart_file(
                    "file",
                    "../../dicuri.db",
                    &fake_sqlite_image(),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        dir.join("kasir.db.restore-pending").exists(),
        "the upload is staged next to the live database"
    );
    assert!(
        !escape.exists(),
        "the name the client chose must not have created a file"
    );

    std::fs::remove_file(dir.join("kasir.db.restore-pending")).expect("cleanup");
}

/// The two routes that do take a filename rebuild the path themselves and
/// refuse anything that is not a plain backup name.
#[tokio::test]
async fn a_backup_filename_that_leaves_the_backup_directory_is_refused() {
    let dir = scratch_data_dir();
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db);

    for filename in [
        "..",
        "..%2F..%2Fkasir.db",
        "%2Fetc%2Fpasswd",
        "C:%5CWindows%5Cwin.ini",
        "kasir_2026-09-05.db.gz%00",
    ] {
        let deleted = router(&state)
            .oneshot(
                same_origin(Method::DELETE, &format!("/api/backups/{filename}"))
                    .header(header::COOKIE, cookie(&token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(
            deleted.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "DELETE {filename}"
        );

        let restored = router(&state)
            .oneshot(
                same_origin(Method::POST, &format!("/api/backups/{filename}/restore"))
                    .header(header::COOKIE, cookie(&token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(
            restored.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "POST {filename}/restore"
        );
    }

    assert!(
        dir.join("kasir.db").exists(),
        "nothing outside the backup directory may have been touched"
    );
}
