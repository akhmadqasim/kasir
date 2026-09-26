//! The till window's zoom and icon: only the till itself may change them.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cookie, json_body, login_token, multipart_content_type, multipart_file, router,
    same_origin, state,
};
use crate::test_support::setup_test_db;

/// A request whose socket peer is `ip`, the way `into_make_service_with_connect_info`
/// would have recorded it.
fn from_address(
    builder: axum::http::request::Builder,
    ip: [u8; 4],
) -> axum::http::request::Builder {
    builder.extension(axum::extract::ConnectInfo(std::net::SocketAddr::from((
        ip, 51000,
    ))))
}

#[tokio::test]
async fn the_zoom_routes_need_a_session_and_report_no_window_in_a_bare_server() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let token = login_token(&db, 1).await;
    let state = state(db);

    let anonymous = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/window/zoom")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    // Nothing attached a window, so the stored default is reported as not
    // controllable — which is what a tablet on the LAN should also be told.
    let status = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/window/zoom")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(status.status(), StatusCode::OK);
    assert_eq!(
        body_json(status).await,
        json!({ "factor": 1.0, "available": false })
    );

    let refused = router(&state)
        .oneshot(
            same_origin(Method::PUT, "/api/window/zoom")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "factor": 1.5 })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::CONFLICT);
    assert_eq!(body_json(refused).await["code"], json!("conflict"));
}

/// With a window attached, the till's own webview — and only it — can zoom
/// it. The factor is clamped, stored, applied, and read back.
#[tokio::test]
async fn the_till_window_zooms_itself_and_a_lan_client_cannot() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let token = login_token(&db, 1).await;
    let state = state(db);

    let applied = std::sync::Arc::new(std::sync::Mutex::new(Vec::<f64>::new()));
    let sink = applied.clone();
    state.window_zoom.attach(move |factor| {
        sink.lock().expect("lock").push(factor);
        Ok(())
    });

    // Past the ceiling on purpose: the answer is the clamped factor.
    let zoomed = router(&state)
        .oneshot(
            from_address(same_origin(Method::PUT, "/api/window/zoom"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "factor": 2.5 })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(zoomed.status(), StatusCode::OK);
    assert_eq!(
        body_json(zoomed).await,
        json!({ "factor": 2.0, "available": true })
    );
    assert_eq!(*applied.lock().expect("lock"), vec![2.0]);

    let read_back = router(&state)
        .oneshot(
            from_address(same_origin(Method::GET, "/api/window/zoom"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(
        body_json(read_back).await,
        json!({ "factor": 2.0, "available": true })
    );

    // A tablet on the shop LAN sees the factor but is told it cannot change
    // it, and a PUT from there must not move the desktop window.
    let from_lan = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::GET, "/api/window/zoom"),
                [192, 168, 1, 20],
            )
            .header(header::COOKIE, cookie(&token))
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(
        body_json(from_lan).await,
        json!({ "factor": 2.0, "available": false })
    );

    let refused = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::PUT, "/api/window/zoom"),
                [192, 168, 1, 20],
            )
            .header(header::COOKIE, cookie(&token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(json!({ "factor": 1.0 })))
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::CONFLICT);
    assert_eq!(*applied.lock().expect("lock"), vec![2.0]);

    // A body that does not fit the shape is the usual 422, not a 500.
    let malformed = router(&state)
        .oneshot(
            from_address(same_origin(Method::PUT, "/api/window/zoom"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "factor": "besar" })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(malformed.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn the_till_window_paints_its_own_icon_and_a_lan_client_cannot() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let token = login_token(&db, 1).await;
    let state = state(db);

    // A bare server has no window: the route answers 409 rather than 500.
    let no_window = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::DELETE, "/api/window/icon"),
                [127, 0, 0, 1],
            )
            .header(header::COOKIE, cookie(&token))
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(no_window.status(), StatusCode::CONFLICT);

    let painted = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Option<Vec<u8>>>::new()));
    let sink = painted.clone();
    state.window_icon.attach(move |png| {
        sink.lock().expect("lock").push(png.map(<[u8]>::to_vec));
        Ok(())
    });

    let set = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::POST, "/api/window/icon"),
                [127, 0, 0, 1],
            )
            .header(header::COOKIE, cookie(&token))
            .header(header::CONTENT_TYPE, multipart_content_type())
            .body(multipart_file("file", "icon.png", b"png-bytes"))
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(set.status(), StatusCode::NO_CONTENT);

    let reset = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::DELETE, "/api/window/icon"),
                [127, 0, 0, 1],
            )
            .header(header::COOKIE, cookie(&token))
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(reset.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        *painted.lock().expect("lock"),
        vec![Some(b"png-bytes".to_vec()), None]
    );

    // A tablet on the LAN must not repaint the desktop window's taskbar entry.
    let refused = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::POST, "/api/window/icon"),
                [192, 168, 1, 20],
            )
            .header(header::COOKIE, cookie(&token))
            .header(header::CONTENT_TYPE, multipart_content_type())
            .body(multipart_file("file", "icon.png", b"png-bytes"))
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::CONFLICT);
    assert_eq!(painted.lock().expect("lock").len(), 2);
}
