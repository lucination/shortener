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

#[tokio::test]
async fn existing_alias_update_attempts_fail_atomically_and_keep_native_redirect_identity() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let (owner, cookie) = member(&db, "immutable@example.test", &now);
    let link = db.create_link(owner, serde_json::from_value(serde_json::json!({"destination":"https://example.test/original", "alias":"Keep-A"})).unwrap(), &now).unwrap();
    let before = serde_json::to_value(db.link(link.id).unwrap()).unwrap();
    let app = router(AppState::new(db.clone()));
    for (path, body) in [
        (
            format!("/api/links/{}", link.id),
            serde_json::json!({"alias":"Change-A", "title":"Do not write"}),
        ),
        (
            "/api/links/bulk-update".into(),
            serde_json::json!({"ids":[link.id], "alias":"Change-A", "action":{"type":"disable"}}),
        ),
        (
            "/api/links/bulk-update".into(),
            serde_json::json!({"ids":[link.id], "action":{"type":"disable", "alias":"Change-A"}}),
        ),
    ] {
        let method = if path.ends_with("bulk-update") {
            "POST"
        } else {
            "PATCH"
        };
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("origin", "http://localhost:3000")
                    .header("content-type", "application/json")
                    .header("cookie", &cookie)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        assert!(String::from_utf8_lossy(&body).contains("Short address cannot be changed"));
        assert_eq!(
            serde_json::to_value(db.link(link.id).unwrap()).unwrap(),
            before
        );
    }
    // Bulk import is create-only, never upserts an existing address.
    let imported = app.clone().oneshot(Request::builder().method("POST").uri("/api/links/bulk").header("origin", "http://localhost:3000").header("content-type", "application/json").header("cookie", &cookie).body(Body::from(serde_json::json!({"items":[{"destination":"https://example.test/replacement", "alias":"Keep-A"}]}).to_string())).unwrap()).await.unwrap();
    assert_eq!(imported.status(), StatusCode::OK);
    let result: serde_json::Value =
        serde_json::from_slice(&to_bytes(imported.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(result["items"][0]["status"], "failed");
    assert_eq!(
        serde_json::to_value(db.link(link.id).unwrap()).unwrap(),
        before
    );
    // Admin exposes link reads, not a second rename/update authority.
    let admin = db.admin_session(&now).unwrap();
    let rejected = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/_/api/links/{}", link.id))
                .header("origin", "http://localhost:3000")
                .header("content-type", "application/json")
                .header("cookie", format!("short_admin={admin}"))
                .body(Body::from(
                    serde_json::json!({"alias":"Change-A"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        serde_json::to_value(db.link(link.id).unwrap()).unwrap(),
        before
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/links/{}", link.id))
                .header("origin", "http://localhost:3000")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    serde_json::json!({"alias":"Keep-A", "title":"Valid edit"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let updated = db.link(link.id).unwrap();
    assert_eq!(updated.title.as_deref(), Some("Valid edit"));
    assert_eq!(updated.addresses[0].id, link.addresses[0].id);
    let redirect = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/Keep-A")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(redirect.status(), StatusCode::FOUND);
    assert_eq!(
        redirect.headers()["location"],
        "https://example.test/original"
    );
    assert_eq!(
        get(app, "/Change-A", "", "localhost:3000").await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn bulk_alias_assertions_preserve_size_admission_before_target_reads() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let (_, cookie) = member(&db, "bounded-bulk@example.test", &now);
    let app = router(AppState::new(db));
    let response = app.oneshot(Request::builder().method("POST").uri("/api/links/bulk-update").header("origin", "http://localhost:3000").header("content-type", "application/json").header("cookie", cookie).body(Body::from(serde_json::json!({"ids":vec![i32::MAX;1001],"alias":"Keep-A","action":{"type":"disable"}}).to_string())).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert!(String::from_utf8_lossy(&body).contains("bulk update requires 1..1000 IDs"));
}
