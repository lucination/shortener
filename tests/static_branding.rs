use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use shortener::{
    http::{AppState, router},
    store::Store,
};
use tower::ServiceExt;
#[tokio::test]
async fn missing_static_artifacts_do_not_invent_a_build_time_app_name() {
    let empty = tempfile::tempdir().unwrap();
    let mut state = AppState::new(Store::open(":memory:", "example.com").unwrap());
    state.static_dir = empty.path().to_owned();
    let response = router(state)
        .oneshot(
            Request::get("/")
                .header("host", "example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(
        !body.contains("Shortener"),
        "a missing static build cannot resolve PUBLIC_APP_NAME"
    );
    assert!(body.contains("Application unavailable"));
}
