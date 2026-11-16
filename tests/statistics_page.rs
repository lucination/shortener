use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use shortener::{
    http::{AppState, router},
    store::Store,
};
use tower::ServiceExt;

#[tokio::test]
async fn management_named_aliases_keep_native_redirect_and_preview_routes() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let (owner, _) = member(&db, "owner@example.test", &now);
    for alias in ["edit", "statistics"] {
        db.create_link(
            owner,
            serde_json::from_value(
                serde_json::json!({"destination":"https://example.test","alias":alias}),
            )
            .unwrap(),
            &now,
        )
        .unwrap();
    }
    let app = router(AppState::new(db));
    for alias in ["edit", "statistics"] {
        assert_eq!(
            get(app.clone(), &format!("/{alias}"), "", "localhost:3000")
                .await
                .0,
            StatusCode::FOUND
        );
        assert_eq!(
            get(app.clone(), &format!("/v/{alias}"), "", "localhost:3000")
                .await
                .0,
            StatusCode::OK
        );
    }
}

#[tokio::test]
async fn invalid_management_shapes_cannot_serve_existing_static_files() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "GENERIC SHELL").unwrap();
    for file in [
        "bad.name/statistics",
        "odd/statistics",
        "extra/statistics/index.html",
    ] {
        let path = dir.path().join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "STATIC BYPASS").unwrap();
    }
    let mut state = AppState::new(Store::open(":memory:", "example.com").unwrap());
    state.static_dir = dir.path().into();
    let app = router(state);
    for path in [
        "/bad.name/statistics",
        "/odd//statistics",
        "/extra/statistics/index.html",
    ] {
        let response = get(app.clone(), path, "", "localhost:3000").await;
        assert_eq!(response.0, StatusCode::NOT_FOUND, "{path}");
        assert!(String::from_utf8_lossy(&response.2).contains("<h1>Link not found</h1>"));
        assert!(!String::from_utf8_lossy(&response.2).contains("<script"));
        assert!(!String::from_utf8_lossy(&response.2).contains("STATIC BYPASS"));
    }
}

fn member(db: &Store, email: &str, now: &str) -> (i32, String) {
    let u = db.create_user(email, now).unwrap();
    let magic = db.issue_magic(email, now).unwrap().unwrap();
    let (_, session) = db.consume_magic(&magic, now).unwrap();
    (u.id, format!("short_session={session}"))
}
async fn get(
    app: axum::Router,
    path: &str,
    cookie: &str,
    host: &str,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let r = app
        .oneshot(
            Request::builder()
                .uri(path)
                .header("host", host)
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let headers = r.headers().clone();
    (
        status,
        headers,
        to_bytes(r.into_body(), 100000).await.unwrap().to_vec(),
    )
}
#[tokio::test]
async fn creator_gets_native_statistics_shell_without_recording_a_visit() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "USER SHELL").unwrap();
    let db = Store::open(":memory:", "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let (owner, cookie) = member(&db, "owner@example.test", &now);
    let link = db
        .create_link(
            owner,
            serde_json::from_value(
                serde_json::json!({"destination":"https://private.test", "alias":"Note-A"}),
            )
            .unwrap(),
            &now,
        )
        .unwrap();
    let mut state = AppState::new(db.clone());
    state.static_dir = dir.path().into();
    let app = router(state);
    let (status, headers, body) =
        get(app.clone(), "/Note-A/statistics", &cookie, "localhost:3000").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"USER SHELL");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(db.link(link.id).unwrap().human_clicks, 0);
    assert_eq!(db.events(Some(link.id)).unwrap().total, 0);
    let stats = get(
        app.clone(),
        &format!("/api/links/{}/stats", link.id),
        &cookie,
        "localhost:3000",
    )
    .await;
    assert_eq!(stats.0, StatusCode::OK);
    assert_eq!(
        stats.1.get("cache-control").and_then(|v| v.to_str().ok()),
        Some("no-store")
    );
    assert_eq!(
        get(app, "/Note-A/edit", &cookie, "localhost:3000").await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn management_pages_hide_every_denial_and_override_static_files() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "GENERIC SHELL").unwrap();
    std::fs::create_dir(dir.path().join("Note-A")).unwrap();
    for suffix in ["edit", "statistics"] {
        std::fs::write(dir.path().join(format!("Note-A/{suffix}")), "STATIC BYPASS").unwrap();
    }
    let db = Store::open(":memory:", "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let (owner, owner_cookie) = member(&db, "owner@example.test", &now);
    let (_, other_cookie) = member(&db, "other@example.test", &now);
    let (_, expired_cookie) = member(&db, "expired@example.test", "2020-01-01T00:00:00.000Z");
    let admin = format!("short_admin={}", db.admin_session(&now).unwrap());
    let link = db
        .create_link(
            owner,
            serde_json::from_value(
                serde_json::json!({"destination":"https://private.test", "alias":"Note-A"}),
            )
            .unwrap(),
            &now,
        )
        .unwrap();
    let mut state = AppState::new(db.clone());
    state.static_dir = dir.path().into();
    let app = router(state);
    for suffix in ["statistics", "edit"] {
        let expected = get(
            app.clone(),
            &format!("/missing/{suffix}"),
            &owner_cookie,
            "localhost:3000",
        )
        .await;
        assert!(String::from_utf8_lossy(&expected.2).contains("<h1>Link not found</h1>"));
        assert!(!String::from_utf8_lossy(&expected.2).contains("<script"));
        for c in [
            "",
            "short_session=invalid",
            &other_cookie,
            &expired_cookie,
            &admin,
        ] {
            let r = get(
                app.clone(),
                &format!("/Note-A/{suffix}"),
                c,
                "localhost:3000",
            )
            .await;
            assert_eq!(r.0, StatusCode::NOT_FOUND, "{suffix}: {c}");
            assert_eq!(r.2, expected.2);
            assert_eq!(r.1["cache-control"], "no-store");
            assert!(!r.1.contains_key("location"));
        }
        for host in [
            "evil.test",
            "example.com",
            "localhost:3001",
            "localhost:3000.evil.test",
            "localhost/",
            "localhost\\evil",
            "localhost%2e",
            "localhost:999999",
        ] {
            assert_eq!(
                get(
                    app.clone(),
                    &format!("/Note-A/{suffix}"),
                    &owner_cookie,
                    host
                )
                .await
                .0,
                StatusCode::NOT_FOUND,
                "{host}"
            );
        }
        for path in [
            format!("//Note-A/{suffix}"),
            format!("/Note-A/{suffix}/"),
            format!("/%4eote-A/{suffix}"),
            format!("/Note-A/%73{suffix}"),
            format!("/Note-A/../{suffix}"),
            format!("/Note-A%2f/{suffix}"),
        ] {
            assert_eq!(
                get(app.clone(), &path, &owner_cookie, "localhost:3000")
                    .await
                    .0,
                StatusCode::NOT_FOUND,
                "{path}"
            );
        }
        for patch in [
            serde_json::json!({"enabled":false}),
            serde_json::json!({"enabled":true,"expires_at":"2020-01-01T00:00:00Z"}),
            serde_json::json!({"expires_at":null,"click_limit":1}),
        ] {
            db.patch_link(owner, link.id, serde_json::from_value(patch).unwrap(), &now)
                .unwrap();
            if db.link(link.id).unwrap().click_limit == Some(1)
                && db.link(link.id).unwrap().human_clicks == 0
            {
                db.claim_redirect("Note-A", true, &now).unwrap();
            }
            assert_eq!(
                get(
                    app.clone(),
                    &format!("/Note-A/{suffix}"),
                    &owner_cookie,
                    "localhost:3000"
                )
                .await
                .0,
                StatusCode::OK
            );
        }
    }
    for c in [&other_cookie, &admin, &expired_cookie, ""] {
        let r = get(
            app.clone(),
            &format!("/api/links/{}/stats", link.id),
            c,
            "localhost:3000",
        )
        .await;
        assert!(!r.0.is_success());
        assert!(!String::from_utf8_lossy(&r.2).contains("humans"));
    }
    db.delete_link(owner, link.id, &now).unwrap();
    for suffix in ["statistics", "edit"] {
        assert_eq!(
            get(
                app.clone(),
                &format!("/Note-A/{suffix}"),
                &owner_cookie,
                "localhost:3000"
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
}
