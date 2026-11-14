use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;
#[tokio::test]
async fn admin_namespace_is_separate_from_user_api() {
    let app = shortener::http::test_router().await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/_/api/login")
                .method("POST")
                .header("origin", "http://localhost:3000")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"token":"test-admin-token"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let old = app
        .oneshot(
            Request::builder()
                .uri("/api/admin/login")
                .method("POST")
                .header("origin", "http://localhost:3000")
                .body(Body::from(r#"{"token":"test-admin-token"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_ne!(old.status(), StatusCode::OK);
}
