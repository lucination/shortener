use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;
#[tokio::test]
async fn api_enforces_auth_and_origin_before_mutation() {
    let app = shortener::http::test_router().await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_/api/login")
                .header("content-type", "application/json")
                .header("origin", "https://evil.test")
                .body(Body::from(r#"{"token":"test-admin-token"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

async fn json_call(
    app: axum::Router,
    method: &str,
    path: &str,
    body: serde_json::Value,
    cookie: Option<&str>,
) -> axum::response::Response {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header("origin", "http://localhost:3000")
        .header("content-type", "application/json");
    if let Some(c) = cookie {
        b = b.header("cookie", c);
    }
    app.oneshot(b.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}
#[tokio::test]
async fn admin_login_controls_users_without_exposing_token_or_crossing_sessions() {
    let app = shortener::http::test_router().await;
    let bad = json_call(
        app.clone(),
        "POST",
        "/_/api/login",
        serde_json::json!({"token":"bad"}),
        None,
    )
    .await;
    assert_eq!(bad.status(), StatusCode::UNAUTHORIZED);
    let login = json_call(
        app.clone(),
        "POST",
        "/_/api/login",
        serde_json::json!({"token":"test-admin-token"}),
        None,
    )
    .await;
    assert_eq!(login.status(), StatusCode::OK);
    let cookie = login.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    assert!(cookie.starts_with("short_admin="));
    assert!(!cookie.contains("test-admin-token"));
    let created = json_call(
        app.clone(),
        "POST",
        "/_/api/users",
        serde_json::json!({"email":"member@example.test","link_quota":2,"retention_days":7}),
        Some(&cookie),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let body = axum::body::to_bytes(created.into_body(), 100000)
        .await
        .unwrap();
    let u: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(u["email"], "member@example.test");
    assert_eq!(u["link_quota"], 2);
    let me = json_call(
        app.clone(),
        "GET",
        "/api/me",
        serde_json::Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(me.status(), StatusCode::FORBIDDEN);
    let list = json_call(
        app,
        "GET",
        "/_/api/users",
        serde_json::Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(list.status(), StatusCode::OK);
}

async fn member_app() -> (axum::Router, shortener::store::Store, String) {
    let db = shortener::store::Store::open(":memory:", "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let u = db.create_user("member@example.test", &now).unwrap();
    let magic = db.issue_magic(&u.email, &now).unwrap().unwrap();
    let (_, session) = db.consume_magic(&magic, &now).unwrap();
    (
        shortener::http::router(shortener::http::AppState::new(db.clone())),
        db,
        format!("short_session={session}"),
    )
}
async fn value(r: axum::response::Response) -> serde_json::Value {
    serde_json::from_slice(&axum::body::to_bytes(r.into_body(), 1000000).await.unwrap()).unwrap()
}
#[tokio::test]
async fn user_creates_redirects_and_reads_stats_with_ownership_isolation() {
    let (app, db, c) = member_app().await;
    let created=json_call(app.clone(),"POST","/api/links",serde_json::json!({"destination":"https://example.test/path?fixed=1","query_mode":"preserve"}),Some(&c)).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let l = value(created).await;
    let id = l["id"].as_i64().unwrap();
    let code = l["addresses"][0]["short_code"].as_str().unwrap();
    assert_eq!(code.len(), 5);
    assert!(code.bytes().all(|b| b.is_ascii_alphanumeric()));
    let conflict = json_call(
        app.clone(),
        "POST",
        "/api/links",
        serde_json::json!({"destination":"https://example.com/conflict", "alias":code}),
        Some(&c),
    )
    .await;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert!(l.get("password_hash").is_none());
    let out = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/{code}?fixed=9&x=2&x=3"))
                .header("user-agent", "Mozilla/5.0 Firefox/120.0 Linux")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(out.status(), StatusCode::FOUND);
    assert_eq!(
        out.headers()["location"],
        "https://example.test/path?fixed=1&x=2&x=3"
    );
    assert_eq!(db.link(id as i32).unwrap().human_clicks, 1);
    let stats = json_call(
        app.clone(),
        "GET",
        &format!("/api/links/{id}/stats"),
        serde_json::Value::Null,
        Some(&c),
    )
    .await;
    assert_eq!(stats.status(), StatusCode::OK);
    assert_eq!(value(stats).await["humans"], 1);
    let events = json_call(
        app.clone(),
        "GET",
        &format!("/api/links/{id}/events"),
        serde_json::Value::Null,
        Some(&c),
    )
    .await;
    assert_eq!(value(events).await["total"], 1);
    let now = shortener::domain::instant(chrono::Utc::now());
    let other = db.create_user("other@example.test", &now).unwrap();
    let magic = db.issue_magic(&other.email, &now).unwrap().unwrap();
    let (_, token) = db.consume_magic(&magic, &now).unwrap();
    let theft = json_call(
        app,
        "GET",
        &format!("/api/links/{id}"),
        serde_json::Value::Null,
        Some(&format!("short_session={token}")),
    )
    .await;
    assert_eq!(theft.status(), StatusCode::NOT_FOUND);
}
#[tokio::test]
async fn password_preview_gate_and_explicit_continuation_do_not_loop_or_leak() {
    let (app, db, c) = member_app().await;
    let r=json_call(app.clone(),"POST","/api/links",serde_json::json!({"destination":"https://secret.example.test/hidden","alias":"locked","password":"correct horse","interstitial":true,"click_limit":2}),Some(&c)).await;
    assert_eq!(r.status(), StatusCode::CREATED);
    let id = value(r).await["id"].as_i64().unwrap() as i32;
    let gate = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v/locked")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let text = String::from_utf8(
        axum::body::to_bytes(gate.into_body(), 100000)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(text.contains("Password required"));
    assert!(
        text.contains("/presentation.css"),
        "native password gate uses the built shared presentation stylesheet"
    );
    assert!(text.contains("width=device-width"));
    assert!(
        text.contains("<meta name=referrer content=same-origin>"),
        "native forms retain a same-origin Origin header without leaking cross-origin referrers"
    );
    assert!(!text.contains("secret.example"));
    assert_eq!(db.link(id).unwrap().human_clicks, 0);
    let unlock = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v/locked/unlock")
                .header("origin", "http://localhost:3000")
                .header("content-type", "application/x-www-form-urlencoded")
                .body(Body::from("password=correct+horse"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unlock.status(), StatusCode::SEE_OTHER);
    let grant = unlock.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let preview = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v/locked?x=1")
                .header("cookie", &grant)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        preview.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("form-action 'self' https://secret.example.test;"),
        "native continuation permits only its validated redirect origin"
    );
    let text = String::from_utf8(
        axum::body::to_bytes(preview.into_body(), 100000)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(text.contains("secret.example.test"));
    assert_eq!(db.link(id).unwrap().human_clicks, 0);
    let cont = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v/locked/continue?x=1")
                .header("origin", "http://localhost:3000")
                .header("cookie", &grant)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cont.status(), StatusCode::FOUND);
    assert_eq!(db.link(id).unwrap().human_clicks, 1);
    let p: shortener::dto::LinkPatch =
        serde_json::from_value(serde_json::json!({"password":"replacement secret"})).unwrap();
    db.patch_link(1, id, p, &shortener::domain::instant(chrono::Utc::now()))
        .unwrap();
    let stale = app
        .oneshot(
            Request::builder()
                .uri("/v/locked")
                .header("cookie", &grant)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        stale.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("form-action 'self';")
    );
    assert!(
        !stale.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("secret.example.test")
    );
    let text = String::from_utf8(
        axum::body::to_bytes(stale.into_body(), 100000)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(!text.contains("secret.example.test"));
}
#[tokio::test]
async fn bulk_create_reports_each_row_and_bulk_update_has_atomic_ownership() {
    let (app, _db, c) = member_app().await;
    let r=json_call(app.clone(),"POST","/api/links/bulk",serde_json::json!({"items":[{"destination":"https://a.test","alias":"bulk-a"},{"destination":"javascript:bad","alias":"bulk-b"},{"destination":"https://c.test","alias":"bulk-c"},{"destination":"https://example.com/generated"},{"destination":"https://example.com/duplicate","alias":"bulk-a"}]}),Some(&c)).await;
    assert_eq!(r.status(), StatusCode::OK);
    let b = value(r).await;
    assert_eq!(b["items"][0]["status"], "created");
    assert_eq!(b["items"][1]["status"], "failed");
    assert_eq!(b["items"][2]["status"], "created");
    assert_eq!(
        b["items"][0]["link"]["addresses"][0]["short_code"],
        "bulk-a"
    );
    assert_eq!(
        b["items"][2]["link"]["addresses"][0]["short_code"],
        "bulk-c"
    );
    assert_eq!(b["items"][3]["status"], "created");
    assert_eq!(b["items"][4]["status"], "failed");
    let code = b["items"][3]["link"]["addresses"][0]["short_code"]
        .as_str()
        .unwrap();
    assert_eq!(code.len(), 5);
    assert!(code.bytes().all(|b| b.is_ascii_alphanumeric()));
    let generated = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/{code}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(generated.status(), StatusCode::FOUND);
    assert_eq!(
        generated.headers()["location"],
        "https://example.com/generated"
    );
    let ids = serde_json::json!([b["items"][0]["link"]["id"], b["items"][2]["link"]["id"]]);
    let r = json_call(
        app.clone(),
        "POST",
        "/api/links/bulk-update",
        serde_json::json!({"ids":ids,"action":{"type":"disable"}}),
        Some(&c),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(value(r).await["updated"].as_array().unwrap().len(), 2);
    let hidden = app
        .oneshot(
            Request::builder()
                .uri("/bulk-a")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
}
#[tokio::test]
async fn admin_suspension_and_soft_delete_revoke_sessions_and_hide_redirects_recoverably() {
    let (app, db, c) = member_app().await;
    let r = json_call(
        app.clone(),
        "POST",
        "/api/links",
        serde_json::json!({"destination":"https://a.test","alias":"admin-owned"}),
        Some(&c),
    )
    .await;
    assert_eq!(r.status(), StatusCode::CREATED);
    let r = json_call(
        app.clone(),
        "POST",
        "/_/api/login",
        serde_json::json!({"token":"test-admin-token"}),
        None,
    )
    .await;
    let admin = r.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let r = json_call(
        app.clone(),
        "GET",
        "/_/api/usage",
        serde_json::Value::Null,
        Some(&admin),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(value(r).await["links"], 1);
    let r = json_call(
        app.clone(),
        "PATCH",
        "/_/api/users/1",
        serde_json::json!({"suspended":true}),
        Some(&admin),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    assert!(db.user(1).unwrap().suspended);
    let me = json_call(
        app.clone(),
        "GET",
        "/api/me",
        serde_json::Value::Null,
        Some(&c),
    )
    .await;
    assert_eq!(me.status(), StatusCode::UNAUTHORIZED);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin-owned")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
    let r = json_call(
        app.clone(),
        "PATCH",
        "/_/api/users/1",
        serde_json::json!({"suspended":false}),
        Some(&admin),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    let r = json_call(
        app.clone(),
        "DELETE",
        "/_/api/users/1",
        serde_json::Value::Null,
        Some(&admin),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    assert!(db.user(1).unwrap().deleted_at.is_some());
    let r = json_call(
        app,
        "PATCH",
        "/_/api/users/1",
        serde_json::json!({"deleted":false}),
        Some(&admin),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    assert!(db.user(1).unwrap().deleted_at.is_none());
}
#[tokio::test]
async fn static_files_precede_aliases_missing_assets_are_not_html_and_proxy_headers_are_untrusted()
{
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<html>APP SHELL</html>").unwrap();
    std::fs::write(dir.path().join("manual"), "STATIC MANUAL").unwrap();
    let db = shortener::store::Store::open(":memory:", "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let u = db.create_user("static@example.test", &now).unwrap();
    let magic = db.issue_magic(&u.email, &now).unwrap().unwrap();
    let (_, session) = db.consume_magic(&magic, &now).unwrap();
    let c = format!("short_session={session}");
    let mut state = shortener::http::AppState::new(db.clone());
    state.static_dir = dir.path().into();
    let app = shortener::http::router(state);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/manual")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        &axum::body::to_bytes(r.into_body(), 1000).await.unwrap()[..],
        b"STATIC MANUAL"
    );
    let r = json_call(
        app.clone(),
        "POST",
        "/api/links",
        serde_json::json!({"destination":"https://a.test","alias":"manual"}),
        Some(&c),
    )
    .await;
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
    for p in ["/assets/missing", "/_app/missing.js", "/missing.css"] {
        let r = app
            .clone()
            .oneshot(Request::builder().uri(p).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        assert!(
            !r.headers()
                .get("content-type")
                .is_some_and(|h| h.to_str().unwrap().contains("text/html")),
            "{p}"
        );
    }
    let r = json_call(
        app.clone(),
        "POST",
        "/api/links",
        serde_json::json!({"destination":"https://a.test","alias":"peer"}),
        Some(&c),
    )
    .await;
    assert_eq!(r.status(), StatusCode::CREATED);
    let id = value(r).await["id"].as_i64().unwrap() as i32;
    let mut req = Request::builder()
        .uri("/peer")
        .header("x-forwarded-for", "203.0.113.99")
        .header("user-agent", "Firefox/1 Linux")
        .body(Body::empty())
        .unwrap();
    req.extensions_mut().insert(axum::extract::ConnectInfo(
        "192.0.2.8:1234".parse::<std::net::SocketAddr>().unwrap(),
    ));
    let r = app.oneshot(req).await.unwrap();
    assert_eq!(r.status(), StatusCode::FOUND);
    assert_eq!(db.events(Some(id)).unwrap().items[0].ip, "192.0.2.8");
}
#[tokio::test]
async fn unavailable_links_share_generic_404_shell_including_password_submission() {
    let (app, db, c) = member_app().await;
    let r = json_call(
        app.clone(),
        "POST",
        "/api/links",
        serde_json::json!({"destination":"https://hidden.test","alias":"disabled"}),
        Some(&c),
    )
    .await;
    let id = value(r).await["id"].as_i64().unwrap() as i32;
    let now = shortener::domain::instant(chrono::Utc::now());
    db.patch_link(
        1,
        id,
        serde_json::from_value(serde_json::json!({"enabled":false})).unwrap(),
        &now,
    )
    .unwrap();
    for code in ["missing", "disabled"] {
        for (method, path) in [
            ("GET", format!("/{code}")),
            ("GET", format!("/v/{code}")),
            ("POST", format!("/v/{code}/continue")),
            ("POST", format!("/v/{code}/unlock")),
        ] {
            let r = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header("origin", "http://localhost:3000")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::NOT_FOUND);
            let text = String::from_utf8(
                axum::body::to_bytes(r.into_body(), 100000)
                    .await
                    .unwrap()
                    .to_vec(),
            )
            .unwrap();
            assert!(!text.contains("hidden.test"));
        }
    }
}
#[tokio::test]
async fn expiry_is_observed_after_contended_sqlite_claim_not_before_waiting() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let db = shortener::store::Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let u = db.create_user("expiry@example.test", &now).unwrap();
    let expiry =
        shortener::domain::instant(chrono::Utc::now() + chrono::Duration::milliseconds(400));
    let l=db.create_link(u.id,serde_json::from_value(serde_json::json!({"destination":"https://a.test","alias":"contended","expires_at":expiry})).unwrap(),&now).unwrap();
    let app = shortener::http::router(shortener::http::AppState::new(db.clone()));
    let blocker = rusqlite::Connection::open(file.path()).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let request = tokio::spawn(async move {
        app.oneshot(
            Request::builder()
                .uri("/contended")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
    });
    tokio::time::sleep(std::time::Duration::from_millis(850)).await;
    blocker.execute_batch("COMMIT").unwrap();
    let r = request.await.unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
    assert_eq!(db.link(l.id).unwrap().human_clicks, 0);
}
#[tokio::test]
async fn bulk_updates_report_original_rows_dedupe_and_do_not_rollback_other_successes() {
    let (app, db, c) = member_app().await;
    let now = shortener::domain::instant(chrono::Utc::now());
    let l = db
        .create_link(
            1,
            serde_json::from_value(
                serde_json::json!({"destination":"https://a.test","alias":"bulk-rows"}),
            )
            .unwrap(),
            &now,
        )
        .unwrap();
    let r = json_call(
        app,
        "POST",
        "/api/links/bulk-update",
        serde_json::json!({"ids":[l.id,9999,l.id],"action":{"type":"disable"}}),
        Some(&c),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    let body = value(r).await;
    assert_eq!(body["items"][0]["status"], "updated");
    assert_eq!(body["items"][1]["status"], "failed");
    assert_eq!(body["items"][2]["index"], 2);
    assert_eq!(body["items"][2]["status"], "updated");
    assert_eq!(body["updated"], serde_json::json!([l.id]));
    assert!(!db.link(l.id).unwrap().enabled);
}
#[tokio::test]
async fn unknown_hosts_cannot_resolve_domain_aliases_and_malformed_json_is_400() {
    let (app, _db, c) = member_app().await;
    let r = json_call(
        app.clone(),
        "POST",
        "/api/links",
        serde_json::json!({"destination":"https://a.test","alias":"CaseCode"}),
        Some(&c),
    )
    .await;
    assert_eq!(r.status(), StatusCode::CREATED);
    for host in ["evil.test", "example.com.evil.test"] {
        let r = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/CaseCode")
                    .header("host", host)
                    .header("x-forwarded-host", "example.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/CaseCode")
                .header("host", "EXAMPLE.COM:443")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FOUND);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/casecode")
                .header("host", "example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/links")
                .header("origin", "http://localhost:3000")
                .header("cookie", &c)
                .body(Body::from("{"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    let r = json_call(
        app,
        "GET",
        "/_/api/users",
        serde_json::Value::Null,
        Some(&c),
    )
    .await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
}
#[tokio::test]
async fn bulk_creation_keeps_validation_outcomes_for_structurally_invalid_rows() {
    let (app, _db, c) = member_app().await;
    let r=json_call(app,"POST","/api/links/bulk",serde_json::json!({"items":[{"destination":"https://a.test","alias":"row-good"},{"alias":"missing-destination"},"not an object"]}),Some(&c)).await;
    assert_eq!(r.status(), StatusCode::OK);
    let b = value(r).await;
    assert_eq!(b["items"][0]["status"], "created");
    assert_eq!(b["items"][1]["status"], "failed");
    assert_eq!(b["items"][2]["status"], "failed");
}
