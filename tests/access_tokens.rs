use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use shortener::{
    http::{AppState, router},
    store::Store,
};
use tower::ServiceExt;
async fn call(
    app: axum::Router,
    method: &str,
    path: &str,
    cookie: &str,
    bearer: Option<&str>,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("origin", "http://localhost:3000")
        .header("cookie", cookie)
        .header("content-type", "application/json");
    if let Some(b) = bearer {
        req = req.header("authorization", b);
    }
    let res = app
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 100000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or_default())
}
#[tokio::test]
async fn issued_token_creates_owned_link_then_revocation_fences_it() {
    let now = shortener::domain::instant(chrono::Utc::now());
    let db = Store::open(":memory:", "example.com").unwrap();
    let u = db.create_user("owner@example.test", &now).unwrap();
    let magic = db.issue_magic(&u.email, &now).unwrap().unwrap();
    let session = db.consume_magic(&magic, &now).unwrap().1;
    let cookie = format!("short_session={session}");
    let app = router(AppState::new(db.clone()));
    let (status, issued) = call(
        app.clone(),
        "POST",
        "/api/account/tokens",
        &cookie,
        None,
        serde_json::json!({"name":"Chrome extension","expires_in_days":90}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let secret = issued["token"].as_str().unwrap();
    assert!(secret.starts_with("short_at_"));
    assert_eq!(secret.len(), 73);
    let bearer = format!("Bearer {secret}");
    let (status, link) = call(
        app.clone(),
        "POST",
        "/api/links",
        "",
        Some(&bearer),
        serde_json::json!({"destination":"https://example.test/article"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    assert_eq!(link["owner_id"], u.id);
    let (status, list) = call(
        app.clone(),
        "GET",
        "/api/account/tokens",
        &cookie,
        None,
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"][0]["scope"], "links:create");
    assert!(!list.to_string().contains(secret));
    let id = issued["metadata"]["id"].as_i64().unwrap();
    assert_eq!(
        call(
            app.clone(),
            "DELETE",
            &format!("/api/account/tokens/{id}"),
            &cookie,
            None,
            serde_json::Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            app.clone(),
            "POST",
            "/api/links",
            &cookie,
            Some(&bearer),
            serde_json::json!({"destination":"https://example.test"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(db.links(Some(u.id)).unwrap().total, 1);
}

#[tokio::test]
async fn token_authority_is_private_and_cannot_fall_back_to_cookie() {
    let now = shortener::domain::instant(chrono::Utc::now());
    let db = Store::open(":memory:", "example.com").unwrap();
    let mut cookies = vec![];
    let mut sessions = vec![];
    for email in ["owner@example.test", "other@example.test"] {
        db.create_user(email, &now).unwrap();
        let magic = db.issue_magic(email, &now).unwrap().unwrap();
        let session = db.consume_magic(&magic, &now).unwrap().1;
        cookies.push(format!("short_session={session}"));
        sessions.push(session);
    }
    let admin = db.admin_session(&now).unwrap();
    let app = router(AppState::new(db.clone()));
    let (_, issued) = call(
        app.clone(),
        "POST",
        "/api/account/tokens",
        &cookies[0],
        None,
        serde_json::json!({"name":"Extension"}),
    )
    .await;
    let secret = issued["token"].as_str().unwrap();
    let bearer = format!("Bearer {secret}");
    let id = issued["metadata"]["id"].as_i64().unwrap();
    for malformed in [
        format!("Bearer {}", sessions[0]),
        format!("Bearer {admin}"),
        "Bearer invalid".into(),
        "Bearer".into(),
        "Basic value".into(),
        format!("Bearer {secret} "),
        format!("Bearer {}", secret.to_uppercase()),
    ] {
        assert_eq!(
            call(
                app.clone(),
                "POST",
                "/api/links",
                &cookies[0],
                Some(&malformed),
                serde_json::json!({"destination":"https://example.test"})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED,
            "{malformed:?}"
        );
    }
    for (method, path) in [
        ("GET", "/api/me"),
        ("GET", "/api/links"),
        ("GET", "/api/account/tokens"),
        ("POST", "/api/account/tokens"),
        ("PATCH", "/api/account"),
        ("POST", "/api/links/bulk"),
        ("PATCH", "/api/links/1"),
        ("POST", "/_/api/users"),
    ] {
        assert_eq!(
            call(
                app.clone(),
                method,
                path,
                &cookies[0],
                Some(&bearer),
                serde_json::json!({})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED,
            "{method} {path}"
        );
    }
    assert_eq!(
        call(
            app.clone(),
            "GET",
            "/api/account/tokens",
            &cookies[1],
            None,
            serde_json::Value::Null
        )
        .await
        .1,
        serde_json::json!({"items":[]})
    );
    assert_eq!(
        call(
            app.clone(),
            "DELETE",
            &format!("/api/account/tokens/{id}"),
            &cookies[1],
            None,
            serde_json::Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    for body in [
        serde_json::json!({"name":"","expires_in_days":90}),
        serde_json::json!({"name":"bad\nname"}),
        serde_json::json!({"name":"x".repeat(81)}),
        serde_json::json!({"name":"x","expires_in_days":0}),
        serde_json::json!({"name":"x","expires_in_days":366}),
    ] {
        assert_eq!(
            call(
                app.clone(),
                "POST",
                "/api/account/tokens",
                &cookies[0],
                None,
                body
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    // Token management never admits cross-origin cookie requests.
    for origin in ["https://evil.test", ""] {
        let res = app
            .clone()
            .oneshot(
                Request::post("/api/account/tokens")
                    .header("cookie", &cookies[0])
                    .header("origin", origin)
                    .body(Body::from(r#"{"name":"CSRF"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }
    let res = app
        .clone()
        .oneshot(
            Request::get("/api/account/tokens")
                .header("cookie", &cookies[0])
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.headers()["cache-control"], "no-store");
    let res = app
        .clone()
        .oneshot(
            Request::post("/api/account/tokens")
                .header("origin", "http://localhost:3000")
                .header("cookie", &cookies[0])
                .body(Body::from(r#"{"name":"No cache"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.headers()["cache-control"], "no-store");
    assert_eq!(
        call(
            app.clone(),
            "POST",
            "/api/account/sign-out-everywhere",
            &cookies[0],
            None,
            serde_json::json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            app.clone(),
            "POST",
            "/api/links",
            "",
            Some(&bearer),
            serde_json::json!({"destination":"https://example.test"})
        )
        .await
        .0,
        StatusCode::CREATED
    );
}

#[test]
fn persistence_expiry_account_status_and_revocation_are_checked_at_create() {
    use shortener::dto::AccessTokenInput;
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_str().unwrap();
    let now = "2026-11-17T12:00:00.000Z";
    let db = Store::open(path, "example.com").unwrap();
    let user = db.create_user("owner@example.test", now).unwrap();
    let magic = db.issue_magic(&user.email, now).unwrap().unwrap();
    let session = db.consume_magic(&magic, now).unwrap().1;
    let issued = db
        .user_scope(&session, now)
        .unwrap()
        .issue_access_token(
            user.id,
            AccessTokenInput {
                name: "Extension".into(),
                expires_in_days: 1,
            },
            now,
        )
        .unwrap();
    let secret = issued.token;
    drop(db);
    let db = Store::open(path, "example.com").unwrap();
    let input = || {
        serde_json::from_value(serde_json::json!({"destination":"https://example.test"})).unwrap()
    };
    assert!(
        db.create_access_link_at(&secret, input(), &issued.metadata.expires_at)
            .is_err()
    );
    let raw = rusqlite::Connection::open(path).unwrap();
    let hash: String = raw
        .query_row("SELECT token_hash FROM access_tokens", [], |r| r.get(0))
        .unwrap();
    assert_eq!(hash, shortener::store::token_hash(&secret));
    assert_ne!(hash, secret);
    raw.execute("UPDATE users SET link_quota=0", []).unwrap();
    assert!(db.create_access_link_at(&secret, input(), now).is_err());
    raw.execute("UPDATE users SET link_quota=NULL", []).unwrap();
    for change in [
        "suspended=1",
        "suspended=0,deleted_at='2026-11-17T12:00:00.000Z'",
    ] {
        raw.execute(&format!("UPDATE users SET {change}"), [])
            .unwrap();
        assert!(db.create_access_link_at(&secret, input(), now).is_err());
    }
    raw.execute("UPDATE users SET suspended=0,deleted_at=NULL", [])
        .unwrap();
    raw.execute_batch("BEGIN IMMEDIATE").unwrap();
    let secret_copy = secret.clone();
    let worker = std::thread::spawn(move || db.create_access_link_at(&secret, input(), now));
    std::thread::sleep(std::time::Duration::from_millis(100));
    raw.execute("UPDATE access_tokens SET revoked_at=?", [now])
        .unwrap();
    raw.execute_batch("COMMIT").unwrap();
    assert!(worker.join().unwrap().is_err());
    let db = Store::open(path, "example.com").unwrap();
    assert_eq!(db.links(Some(user.id)).unwrap().total, 0);
    raw.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    let bytes = std::fs::read(path).unwrap();
    assert!(
        !bytes
            .windows(secret_copy.len())
            .any(|w| w == secret_copy.as_bytes())
    );
}

#[tokio::test]
async fn access_create_rate_limit_is_owner_scoped_and_returns_429() {
    let now = shortener::domain::instant(chrono::Utc::now());
    let db = Store::open(":memory:", "example.com").unwrap();
    let u = db.create_user("limit@example.test", &now).unwrap();
    let magic = db.issue_magic(&u.email, &now).unwrap().unwrap();
    let session = db.consume_magic(&magic, &now).unwrap().1;
    let token = || {
        db.user_scope(&session, &now)
            .unwrap()
            .issue_access_token(
                u.id,
                shortener::dto::AccessTokenInput {
                    name: "Extension".into(),
                    expires_in_days: 90,
                },
                &now,
            )
            .unwrap()
            .token
    };
    let first = token();
    let second = token();
    let app = router(AppState::new(db.clone()));
    let stable_window =
        shortener::domain::instant(chrono::Utc::now() + chrono::Duration::seconds(60));
    for _ in 0..60 {
        db.create_access_link_at(
            &first,
            serde_json::from_value(serde_json::json!({"destination":"https://example.test"}))
                .unwrap(),
            &stable_window,
        )
        .unwrap();
    }
    assert_eq!(
        call(
            app,
            "POST",
            "/api/links",
            "",
            Some(&format!("Bearer {second}")),
            serde_json::json!({"destination":"https://example.test"})
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(db.links(Some(u.id)).unwrap().total, 60);
}

#[test]
fn actual_clock_expiry_is_rechecked_after_sqlite_writer_contention() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_str().unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let db = Store::open(path, "example.com").unwrap();
    let u = db.create_user("clock@example.test", &now).unwrap();
    let magic = db.issue_magic(&u.email, &now).unwrap().unwrap();
    let session = db.consume_magic(&magic, &now).unwrap().1;
    let token = db
        .user_scope(&session, &now)
        .unwrap()
        .issue_access_token(
            u.id,
            shortener::dto::AccessTokenInput {
                name: "Clock".into(),
                expires_in_days: 1,
            },
            &now,
        )
        .unwrap()
        .token;
    let raw = rusqlite::Connection::open(path).unwrap();
    let expiry =
        shortener::domain::instant(chrono::Utc::now() + chrono::Duration::milliseconds(200));
    raw.execute("UPDATE access_tokens SET expires_at=?", [expiry])
        .unwrap();
    raw.execute_batch("BEGIN IMMEDIATE").unwrap();
    let worker = std::thread::spawn(move || {
        db.create_access_link(
            &token,
            serde_json::from_value(serde_json::json!({"destination":"https://example.test"}))
                .unwrap(),
        )
    });
    std::thread::sleep(std::time::Duration::from_millis(400));
    raw.execute_batch("COMMIT").unwrap();
    assert!(worker.join().unwrap().is_err());
    let db = Store::open(path, "example.com").unwrap();
    assert_eq!(db.links(Some(u.id)).unwrap().total, 0);
}

#[test]
fn unknown_access_tokens_are_rejected_before_link_policy_or_password_work() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let input = serde_json::from_value(
        serde_json::json!({"destination":"not a URL","password":"expensive-password"}),
    )
    .unwrap();
    assert_eq!(
        db.create_access_link_at(
            &format!("short_at_{}", "a".repeat(64)),
            input,
            "2026-11-17T12:00:00.000Z"
        )
        .unwrap_err(),
        "session no longer authorized"
    );
}
