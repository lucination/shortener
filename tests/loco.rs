use tower::ServiceExt;
#[tokio::test]
async fn loco_boot_installs_application_routes(){
 let app=shortener::app::test_boot().await.unwrap();let r=app.oneshot(axum::http::Request::builder().uri("/api/me").body(axum::body::Body::empty()).unwrap()).await.unwrap();assert_eq!(r.status(),axum::http::StatusCode::UNAUTHORIZED);
}
