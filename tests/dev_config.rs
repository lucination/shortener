use loco_rs::environment::Environment;
use shortener::{http::AppState, store::Store};
#[test]
fn dev_proxy_is_forbidden_in_production_and_is_loopback_only() {
    let mut s = AppState::new(Store::open(":memory:", "example.com").unwrap());
    assert!(
        s.configure_dev_proxy("http://127.0.0.1:5173", &Environment::Production)
            .is_err()
    );
    for value in [
        "http://evil.test:5173",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:5173/path",
        "https://127.0.0.1:5173",
    ] {
        assert!(
            s.configure_dev_proxy(value, &Environment::Development)
                .is_err(),
            "{value}"
        );
    }
    assert!(
        s.configure_dev_proxy("http://127.0.0.1:5173", &Environment::Development)
            .is_ok()
    );
}
#[tokio::test]
async fn dev_shell_fetches_actual_http_bytes_but_preserves_unknown_path_404() {
    use tower::ServiceExt;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let fixture = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().route("/", axum::routing::get(|| async { "DEV SHELL FIXTURE" })),
        )
        .await
        .unwrap();
    });
    let mut s = AppState::new(Store::open(":memory:", "example.com").unwrap());
    s.configure_dev_proxy(&format!("http://{address}"), &Environment::Development)
        .unwrap();
    let r = shortener::http::router(s)
        .oneshot(
            axum::http::Request::builder()
                .uri("/unknown/deep/path")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), axum::http::StatusCode::NOT_FOUND);
    let bytes = axum::body::to_bytes(r.into_body(), 100000).await.unwrap();
    assert_eq!(&bytes[..], b"DEV SHELL FIXTURE");
    fixture.abort();
}
