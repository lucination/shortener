use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use tower::ServiceExt;
#[tokio::test]
async fn native_runtime_serves_distinct_admin_shell_and_assets_without_alias_fallback() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("_")).unwrap();
    std::fs::write(dir.path().join("index.html"), "USER SHELL").unwrap();
    std::fs::write(dir.path().join("_/index.html"), "ADMIN SHELL").unwrap();
    std::fs::write(dir.path().join("_/entry.js"), "ADMIN ASSET").unwrap();
    let mut s = shortener::http::AppState::new(
        shortener::store::Store::open(":memory:", "example.com").unwrap(),
    );
    s.static_dir = dir.path().to_owned();
    let app = shortener::http::router(s);
    for (path, status, body) in [
        ("/", StatusCode::OK, "USER SHELL"),
        ("/_/", StatusCode::OK, "ADMIN SHELL"),
        ("/_/entry.js", StatusCode::OK, "ADMIN ASSET"),
        ("/_/missing.js", StatusCode::NOT_FOUND, ""),
    ] {
        let r = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(r.status(), status, "{path}");
        assert_eq!(
            to_bytes(r.into_body(), 10000).await.unwrap().as_ref(),
            body.as_bytes(),
            "{path}"
        );
    }
}
