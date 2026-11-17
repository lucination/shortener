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
async fn bearer_creation_uses_dedicated_access_token_and_owner_scope() {
    let now = chrono::Utc::now().to_rfc3339();
    let db = Store::open(":memory:", "short.example").unwrap();
    let owner = db.create_user("extension@example.test", &now).unwrap();
    let magic = db.issue_magic(&owner.email, &now).unwrap().unwrap();
    let (_, session) = db.consume_magic(&magic, &now).unwrap();
    let token = db
        .user_scope(&session, &now)
        .unwrap()
        .issue_access_token(
            owner.id,
            shortener::dto::AccessTokenInput {
                name: "Chrome extension".into(),
                expires_in_days: 90,
            },
            &now,
        )
        .unwrap()
        .token;
    let app = router(AppState::new(db.clone()));
    let response = app
        .oneshot(
            Request::post("/api/links")
                .header("authorization", format!("Bearer {token}"))
                .header("origin", "chrome-extension://test")
                .header("sec-fetch-site", "cross-site")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"destination":"https://example.test/article","title":"Page title"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 100_000).await.unwrap()).unwrap();
    assert_eq!(body["owner_id"], owner.id);
    assert_eq!(body["title"], "Page title");
    assert_eq!(db.links(Some(owner.id)).unwrap().total, 1);
}

#[tokio::test]
async fn extension_authority_is_create_only_never_admin_or_a_csrf_cookie_bypass() {
    let now = chrono::Utc::now().to_rfc3339();
    let db = Store::open(":memory:", "short.example").unwrap();
    let owner = db.create_user("extension@example.test", &now).unwrap();
    let magic = db.issue_magic(&owner.email, &now).unwrap().unwrap();
    let (_, token) = db.consume_magic(&magic, &now).unwrap();
    let admin = db.admin_session(&now).unwrap();
    let app = router(AppState::new(db.clone()));
    for (method, path, bearer, cookie, expected) in [
        (
            "POST",
            "/api/links",
            Some(admin.as_str()),
            None,
            StatusCode::UNAUTHORIZED,
        ),
        (
            "POST",
            "/api/links",
            Some("invalid"),
            Some(token.as_str()),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "POST",
            "/api/links",
            None,
            Some(token.as_str()),
            StatusCode::FORBIDDEN,
        ),
        (
            "POST",
            "/api/links/bulk",
            Some(token.as_str()),
            None,
            StatusCode::FORBIDDEN,
        ),
        (
            "PATCH",
            "/api/links/1",
            Some(token.as_str()),
            None,
            StatusCode::FORBIDDEN,
        ),
        (
            "POST",
            "/_/api/users",
            Some(token.as_str()),
            None,
            StatusCode::FORBIDDEN,
        ),
        (
            "GET",
            "/api/links",
            Some(token.as_str()),
            None,
            StatusCode::UNAUTHORIZED,
        ),
    ] {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", "https://untrusted.example")
            .header("sec-fetch-site", "cross-site")
            .header("content-type", "application/json");
        if let Some(value) = bearer {
            request = request.header("authorization", format!("Bearer {value}"));
        }
        if let Some(value) = cookie {
            request = request.header("cookie", format!("short_session={value}"));
        }
        let response = app
            .clone()
            .oneshot(
                request
                    .body(Body::from(r#"{"destination":"https://example.test"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{method} {path}");
        assert!(
            !response
                .headers()
                .contains_key("access-control-allow-origin")
        );
    }
    assert_eq!(db.links(Some(owner.id)).unwrap().total, 0);
    db.revoke_user(owner.id).unwrap();
    let response = app
        .oneshot(
            Request::post("/api/links")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(r#"{"destination":"https://example.test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(db.links(Some(owner.id)).unwrap().total, 0);
}
