use shortener::{
    http::{AppState, router},
    store::Store,
};
#[tokio::test]
#[ignore = "requires built web, extension, and Playwright Chromium"]
async fn account_tokens_native_browser() {
    let db = Store::open(":memory:", "localhost").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let u = db.create_user("browser@example.test", &now).unwrap();
    let magic = db.issue_magic(&u.email, &now).unwrap().unwrap();
    let session = db.consume_magic(&magic, &now).unwrap().1;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://localhost:{}", listener.local_addr().unwrap().port());
    let mut state = AppState::new(db);
    state.origin = base.clone();
    state.domain = "localhost".into();
    state.static_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/build");
    let server = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    let output = tokio::process::Command::new("node")
        .arg("scripts/check-access-tokens-browser.mjs")
        .current_dir("web")
        .env("TOKENS_BASE", base)
        .env("TOKENS_SESSION", session)
        .output()
        .await;
    server.abort();
    let _ = server.await;
    let output = output.unwrap();
    println!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
