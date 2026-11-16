use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use shortener::{
    http::{AppState, router},
    store::Store,
};
use tower::ServiceExt;
async fn call(
    app: axum::Router,
    method: &str,
    path: &str,
    cookie: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let r = app
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("cookie", cookie)
                .header("origin", "http://localhost:3000")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let bytes = to_bytes(r.into_body(), 100000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test]
async fn passkey_names_are_private_validated_metadata_and_migrate_existing_rows() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let mut cookies = vec![];
    for email in ["owner@example.test", "other@example.test"] {
        db.create_user(email, &now).unwrap();
        let magic = db.issue_magic(email, &now).unwrap().unwrap();
        cookies.push(format!(
            "short_session={}",
            db.consume_magic(&magic, &now).unwrap().1
        ));
    }
    let raw = rusqlite::Connection::open(file.path()).unwrap();
    raw.execute("INSERT INTO passkeys(user_id,credential_id,credential)VALUES(1,'secret-id','secret-credential')",[]).unwrap();
    raw.execute("INSERT INTO passkeys(user_id,credential_id,credential)VALUES(2,'other-secret-id','other-secret-credential')",[]).unwrap();
    drop(db);
    let db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
    let admin = format!("short_admin={}", db.admin_session(&now).unwrap());
    let app = router(AppState::new(db));
    let (status, list) = call(
        app.clone(),
        "GET",
        "/api/account/passkeys",
        &cookies[0],
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        list,
        serde_json::json!({"items":[{"id":1,"name":"Unnamed passkey"}]})
    );
    for invalid in ["", "   ", "line\nbreak", &"x".repeat(81)] {
        assert_eq!(
            call(
                app.clone(),
                "PATCH",
                "/api/account/passkeys/1",
                &cookies[0],
                serde_json::json!({"name":invalid})
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        call(
            app.clone(),
            "PATCH",
            "/api/account/passkeys/1",
            &cookies[1],
            serde_json::json!({"name":"stolen"})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    for c in ["", &admin, "short_session=invalid"] {
        assert!(
            !call(
                app.clone(),
                "GET",
                "/api/account/passkeys",
                c,
                serde_json::Value::Null
            )
            .await
            .0
            .is_success()
        );
        assert!(
            !call(
                app.clone(),
                "PATCH",
                "/api/account/passkeys/1",
                c,
                serde_json::json!({"name":"stolen"})
            )
            .await
            .0
            .is_success()
        );
    }
    // API and list round-trips count scalars, including supplementary Unicode.
    for name in ["x".repeat(80), "🔑".repeat(80), "a🔑".repeat(40)] {
        let renamed = call(
            app.clone(),
            "PATCH",
            "/api/account/passkeys/1",
            &cookies[0],
            serde_json::json!({"name":name}),
        )
        .await;
        assert_eq!(renamed.0, StatusCode::OK);
        assert_eq!(renamed.1["name"], name);
        assert_eq!(
            call(
                app.clone(),
                "GET",
                "/api/account/passkeys",
                &cookies[0],
                serde_json::Value::Null
            )
            .await
            .1["items"][0]["name"],
            name
        );
    }
    for name in [
        "🔑".repeat(81),
        "a🔑".repeat(40) + "x",
        "key\u{0080}name".into(),
    ] {
        assert_eq!(
            call(
                app.clone(),
                "PATCH",
                "/api/account/passkeys/1",
                &cookies[0],
                serde_json::json!({"name":name})
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let (status, renamed) = call(
        app.clone(),
        "PATCH",
        "/api/account/passkeys/1",
        &cookies[0],
        serde_json::json!({"name":"  Laptop key  "}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(renamed, serde_json::json!({"id":1,"name":"Laptop key"}));
    assert_eq!(
        call(
            app,
            "GET",
            "/api/account/passkeys",
            &cookies[0],
            serde_json::Value::Null
        )
        .await
        .1["items"][0]["name"],
        "Laptop key"
    );
    assert_eq!(
        raw.query_row("SELECT credential FROM passkeys WHERE id=1", [], |r| r
            .get::<_, String>(
            0
        ))
        .unwrap(),
        "secret-credential"
    );
}
