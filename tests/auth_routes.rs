use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use shortener::{
    http::{AppState, router},
    store::Store,
};
use tower::ServiceExt;
#[tokio::test]
async fn auth_routes_are_exact_and_unknown_paths_do_not_allocate_rate_keys() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let app = router(AppState::new(
        Store::open(file.path().to_str().unwrap(), "example.com").unwrap(),
    ));
    let sql = rusqlite::Connection::open(file.path()).unwrap();
    let send = |path: String| {
        app.clone().oneshot(
            Request::post(path)
                .header("origin", "http://localhost:3000")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":"missing@example.test"}"#))
                .unwrap(),
        )
    };
    for _ in 0..20 {
        assert_eq!(
            send("/api/auth/passkeys/authenticate/options".into())
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        send("/api/auth/passkeys/authenticate/options".into())
            .await
            .unwrap()
            .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    let snapshot = || {
        sql.prepare("SELECT key,window,count FROM rate_limits ORDER BY key")
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i32>(2)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let before = snapshot();
    for path in [
        "/api/auth/passkeys/authenticate/nonce1/options",
        "/api/auth/passkeys/authenticate/options/",
        "/api/auth/passkeys/register/nonce/verify",
        "/api/auth/random",
        "/api/auth/magic-link/extra",
    ] {
        assert_eq!(
            send(path.into()).await.unwrap().status(),
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    assert_eq!(snapshot(), before);
    for path in [
        "/api/auth/passkeys/authenticate/verify",
        "/api/auth/passkeys/register/options",
        "/api/auth/passkeys/register/verify",
        "/api/auth/magic-link",
        "/api/auth/logout",
    ] {
        let status = send(path.into()).await.unwrap().status();
        assert_ne!(status, StatusCode::NOT_FOUND, "{path}");
        assert_ne!(status, StatusCode::TOO_MANY_REQUESTS, "{path}");
    }
}
