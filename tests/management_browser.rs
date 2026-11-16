use shortener::{
    http::{AppState, router},
    store::Store,
};
#[tokio::test]
#[ignore = "requires built frontend and Playwright Chromium"]
async fn built_management_pages_against_real_native_server() {
    let db = Store::open(":memory:", "localhost").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let u = db.create_user("browser@example.test", &now).unwrap();
    let magic = db.issue_magic(&u.email, &now).unwrap().unwrap();
    let (_, session) = db.consume_magic(&magic, &now).unwrap();
    let other = db.create_user("other@example.test", &now).unwrap();
    let magic = db.issue_magic(&other.email, &now).unwrap().unwrap();
    let (_, other_session) = db.consume_magic(&magic, &now).unwrap();
    let admin = db.admin_session(&now).unwrap();
    let link=db.create_link(u.id,serde_json::from_value(serde_json::json!({"destination":format!("https://example.org/{}","long-path/".repeat(24)),"alias":"Note-A","title":"Field notes","description":"Keep this description","query_mode":"preserve","retention_days":31,"expires_at":"2030-12-31T12:13:14.123Z","click_limit":500})).unwrap(),&now).unwrap();
    let disabled=db.create_link(u.id,serde_json::from_value(serde_json::json!({"destination":"https://example.org","alias":"disabled","title":"Disabled link"})).unwrap(),&now).unwrap();
    db.patch_link(
        u.id,
        disabled.id,
        serde_json::from_value(serde_json::json!({"enabled":false})).unwrap(),
        &now,
    )
    .unwrap();
    db.create_link(u.id,serde_json::from_value(serde_json::json!({"destination":format!("https://example.org/{}","long-path/".repeat(24)),"alias":"a".repeat(64),"title":"Long alias fixture"})).unwrap(),&now).unwrap();
    for kind in [
        shortener::dto::EventKind::Human,
        shortener::dto::EventKind::Bot,
        shortener::dto::EventKind::Preview,
    ] {
        db.record_event(
            &link,
            link.addresses[0].id,
            kind,
            &shortener::analytics::Observation {
                ip: "192.0.2.1".into(),
                user_agent: "Firefox/120 Linux".into(),
                referrer: Some("https://example.org/notes".into()),
            },
            &now,
            "task-fixture",
        )
        .unwrap();
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://localhost:{}", listener.local_addr().unwrap().port());
    let mut state = AppState::new(db.clone());
    state.origin = base.clone();
    state.domain = "localhost".into();
    state.static_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/build");
    let wrong_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let wrong_base = format!(
        "http://localhost:{}",
        wrong_listener.local_addr().unwrap().port()
    );
    let trusted_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let trusted_base = format!(
        "http://localhost:{}",
        trusted_listener.local_addr().unwrap().port()
    );
    let mut trusted_state = state.clone();
    trusted_state.trusted_proxies = vec!["127.0.0.1".parse().unwrap()];
    let wrong_state = state.clone();
    let wrong_server = tokio::spawn(async move {
        axum::serve(wrong_listener, router(wrong_state))
            .await
            .unwrap()
    });
    let trusted_server = tokio::spawn(async move {
        axum::serve(
            trusted_listener,
            router(trusted_state).into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap()
    });
    let authority = base.trim_start_matches("http://");
    let probes = serde_json::json!([
        {"name":"wrong port", "base":wrong_base, "status":404},
        {"name":"wrong hostname", "base":base.replace("localhost", "127.0.0.1"), "status":404},
        {"name":"untrusted forwarded host cannot admit", "base":wrong_base, "headers":{"x-forwarded-host":authority}, "status":404},
        {"name":"untrusted forwarded host ignored", "base":base, "headers":{"x-forwarded-host":"evil.test"}, "status":200},
        {"name":"trusted forwarded host denied", "base":trusted_base, "headers":{"x-forwarded-host":"localhost:1"}, "status":404},
        {"name":"trusted forwarded host admitted", "base":trusted_base, "headers":{"x-forwarded-host":authority}, "status":200}
    ]);
    let server = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    let output = tokio::process::Command::new("node")
        .arg("scripts/check-management-browser.mjs")
        .current_dir("web")
        .env("MANAGEMENT_BASE", &base)
        .env("MANAGEMENT_HOST_PROBES", probes.to_string())
        .env("MANAGEMENT_SESSION", session)
        .env("MANAGEMENT_OTHER", other_session)
        .env("MANAGEMENT_ADMIN", admin)
        .output()
        .await;
    wrong_server.abort();
    trusted_server.abort();
    let _ = wrong_server.await;
    let _ = trusted_server.await;
    server.abort();
    let _ = server.await;
    let output = output.unwrap();
    println!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let saved = db.link(link.id).unwrap();
    assert!(
        saved
            .title
            .as_deref()
            .is_some_and(|title| title.starts_with("Edited notes "))
    );
    assert_eq!(
        saved.expires_at.as_deref(),
        Some("2030-12-31T12:13:14.123Z")
    );
    assert_eq!(saved.retention_days, Some(31));
    assert_eq!(saved.click_limit, Some(500));
    assert_eq!(saved.description.as_deref(), Some("Keep this description"));
}
