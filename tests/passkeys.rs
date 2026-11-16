use shortener::{dto::*, passkeys::webauthn, store::Store};
use webauthn_authenticator_rs::{WebauthnAuthenticator, softpasskey::SoftPasskey};
const NOW: &str = "2026-11-14T17:00:00.000Z";
#[test]
fn actual_webauthn_registration_authentication_replay_and_revocation_preserve_passkey() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
    let u = db.create_user("passkey@example.test", NOW).unwrap();
    let token = db.issue_magic(&u.email, NOW).unwrap().unwrap();
    db.consume_magic(&token, NOW).unwrap();
    let w = webauthn("http://localhost:3000").unwrap();
    let origin = url::Url::parse("http://localhost:3000").unwrap();
    let mut auth = WebauthnAuthenticator::new(SoftPasskey::new(true));
    let mut options = db.passkey_register_options(&w, u.id, NOW).unwrap();
    // A legacy non-resident credential fixture: SoftPasskey cannot store resident keys.
    // Only this authenticator fixture uses old enrollment selection; browser tests use
    // the unmodified current required-resident options.
    options.public_key["authenticatorSelection"]["residentKey"] = serde_json::json!("discouraged");
    options.public_key["authenticatorSelection"]["requireResidentKey"] = serde_json::json!(false);
    assert!(options.public_key.get("challenge").is_some());
    let ccr = serde_json::from_value(serde_json::json!({"publicKey":options.public_key})).unwrap();
    let credential = auth.do_registration(origin.clone(), ccr).unwrap();
    let verify = PasskeyVerify {
        challenge_id: options.challenge_id,
        credential: serde_json::to_value(credential).unwrap(),
    };
    db.passkey_register_verify(&w, u.id, verify.clone(), NOW)
        .unwrap();
    assert!(db.passkey_register_verify(&w, u.id, verify, NOW).is_err());
    // Simulate a pre-metadata database containing a real legacy credential.
    let raw = rusqlite::Connection::open(file.path()).unwrap();
    let bytes: String = raw
        .query_row("SELECT credential FROM passkeys", [], |r| r.get(0))
        .unwrap();
    raw.execute_batch("DROP TABLE passkey_names").unwrap();
    drop(db);
    db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
    let key = db.passkey_list(u.id, NOW).unwrap().items.remove(0);
    assert_eq!(key.name, "Unnamed passkey");
    db.rename_passkey(u.id, key.id, "Legacy security key", NOW)
        .unwrap();
    assert_eq!(
        raw.query_row("SELECT credential FROM passkeys", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        bytes
    );
    db.revoke_user(u.id).unwrap();
    let options = db.passkey_auth_options(&w, &u.email, NOW).unwrap();
    let rcr = serde_json::from_value(serde_json::json!({"publicKey":options.public_key})).unwrap();
    let credential = auth.do_authentication(origin, rcr).unwrap();
    let verify = PasskeyVerify {
        challenge_id: options.challenge_id,
        credential: serde_json::to_value(credential).unwrap(),
    };
    let (user, session) = db.passkey_auth_verify(&w, verify.clone(), NOW).unwrap();
    assert_eq!(user.id, u.id);
    assert_eq!(db.authenticate_user(&session, NOW).unwrap().id, u.id);
    assert!(db.passkey_auth_verify(&w, verify, NOW).is_err());
    let a = db.passkey_auth_options(&w, &u.email, NOW).unwrap();
    let b = db.passkey_auth_options(&w, &u.email, NOW).unwrap();
    let ar = auth
        .do_authentication(
            url::Url::parse("http://localhost:3000").unwrap(),
            serde_json::from_value(serde_json::json!({"publicKey":a.public_key})).unwrap(),
        )
        .unwrap();
    let br = auth
        .do_authentication(
            url::Url::parse("http://localhost:3000").unwrap(),
            serde_json::from_value(serde_json::json!({"publicKey":b.public_key})).unwrap(),
        )
        .unwrap();
    db.passkey_auth_verify(
        &w,
        PasskeyVerify {
            challenge_id: b.challenge_id,
            credential: serde_json::to_value(br).unwrap(),
        },
        NOW,
    )
    .unwrap();
    assert!(
        db.passkey_auth_verify(
            &w,
            PasskeyVerify {
                challenge_id: a.challenge_id,
                credential: serde_json::to_value(ar).unwrap()
            },
            NOW
        )
        .is_err(),
        "stale snapshot must not roll back an already advanced credential counter"
    );
}

#[test]
fn usernameless_options_do_not_lookup_or_disclose_accounts() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let w = webauthn("http://localhost:3000").unwrap();
    let options = db
        .passkey_auth_options(&w, "", NOW)
        .expect("no email or account is needed to start");
    assert!(
        options
            .public_key
            .get("allowCredentials")
            .is_none_or(|v| v.as_array().unwrap().is_empty())
    );
    assert_eq!(options.public_key["userVerification"], "required");
}

#[test]
fn discovered_assertion_binds_handle_to_credential_and_creates_one_session() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let u = db.create_user("discover@example.test", NOW).unwrap();
    let other = db.create_user("not-selected@example.test", NOW).unwrap();
    let token = db.issue_magic(&u.email, NOW).unwrap().unwrap();
    db.consume_magic(&token, NOW).unwrap();
    let w = webauthn("http://localhost:3000").unwrap();
    let origin = url::Url::parse("http://localhost:3000").unwrap();
    let mut auth = WebauthnAuthenticator::new(SoftPasskey::new(true));
    let mut options = db.passkey_register_options(&w, u.id, NOW).unwrap();
    // A legacy non-resident credential fixture: SoftPasskey cannot store resident keys.
    // Only this authenticator fixture uses old enrollment selection; browser tests use
    // the unmodified current required-resident options.
    options.public_key["authenticatorSelection"]["residentKey"] = serde_json::json!("discouraged");
    options.public_key["authenticatorSelection"]["requireResidentKey"] = serde_json::json!(false);
    let handle = options.public_key["user"]["id"].clone();
    let credential = auth
        .do_registration(
            origin.clone(),
            serde_json::from_value(serde_json::json!({"publicKey":options.public_key})).unwrap(),
        )
        .unwrap();
    db.passkey_register_verify(
        &w,
        u.id,
        PasskeyVerify {
            challenge_id: options.challenge_id,
            credential: serde_json::to_value(credential).unwrap(),
        },
        NOW,
    )
    .unwrap();
    // SoftPasskey is non-resident. Supply its known descriptor only to this test
    // authenticator, then attach its userHandle. Real discovery is browser-tested.
    db.revoke_user(u.id).unwrap(); // Fresh discovery after revocation is allowed.
    let known = db.passkey_auth_options(&w, &u.email, NOW).unwrap();
    let mut options = db.passkey_auth_options(&w, "", NOW).unwrap();
    options.public_key["allowCredentials"] = known.public_key["allowCredentials"].clone();
    db.revoke_user(other.id).unwrap(); // Another account cannot invalidate this ceremony.
    let credential = auth
        .do_authentication(
            origin,
            serde_json::from_value(serde_json::json!({"publicKey":options.public_key})).unwrap(),
        )
        .unwrap();
    let mut credential = serde_json::to_value(credential).unwrap();
    credential["response"]["userHandle"] = handle;
    let verify = PasskeyVerify {
        challenge_id: options.challenge_id,
        credential,
    };
    let (user, session) = db
        .passkey_auth_verify(&w, verify.clone(), NOW)
        .expect("verify a credential selected without an email");
    assert_eq!(user.id, u.id);
    assert_eq!(db.authenticate_user(&session, NOW).unwrap().id, u.id);
    assert!(
        db.passkey_auth_verify(&w, verify, NOW).is_err(),
        "challenge is single-use"
    );
}

#[tokio::test]
async fn public_options_accept_no_email_and_bind_to_browser() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;
    let app = shortener::http::test_router().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/passkeys/authenticate/options")
                .method("POST")
                .header("origin", "http://localhost:3000")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response
            .headers()
            .get_all("set-cookie")
            .iter()
            .any(|v| v.to_str().unwrap().starts_with("short_passkey=")),
        "challenge must be bound to the initiating browser"
    );
}

#[test]
fn new_enrollment_requests_a_discoverable_credential() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let u = db.create_user("resident@example.test", NOW).unwrap();
    let token = db.issue_magic(&u.email, NOW).unwrap().unwrap();
    db.consume_magic(&token, NOW).unwrap();
    let options = db
        .passkey_register_options(&webauthn("http://localhost:3000").unwrap(), u.id, NOW)
        .unwrap();
    assert_eq!(
        options.public_key["authenticatorSelection"]["residentKey"],
        "required"
    );
    assert_eq!(
        options.public_key["authenticatorSelection"]["requireResidentKey"],
        true
    );
    assert_eq!(
        options.public_key["authenticatorSelection"]["userVerification"],
        "required"
    );
}

#[tokio::test]
#[ignore = "requires built web assets and Playwright Chromium; run explicitly"]
async fn browser_virtual_authenticator_signs_in_without_email() {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let db = Store::open(":memory:", "localhost").unwrap();
    let u = db.create_user("virtual@example.test", &now).unwrap();
    let token = db.issue_magic(&u.email, &now).unwrap().unwrap();
    let (_, session) = db.consume_magic(&token, &now).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://localhost:{}", listener.local_addr().unwrap().port());
    let mut state = shortener::http::AppState::new(db);
    state.origin = base.clone();
    state.domain = "localhost".into();
    state.static_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/build");
    let server = tokio::spawn(async move {
        axum::serve(listener, shortener::http::router(state))
            .await
            .unwrap()
    });
    let output = tokio::process::Command::new("node")
        .arg("scripts/verify-passkey-sign-in.mjs")
        .current_dir("web")
        .env("SIGNIN_BASE", &base)
        .env("SIGNIN_SESSION", session)
        .output()
        .await;
    server.abort();
    let _ = server.await;
    let output = output.unwrap();
    assert!(
        output.status.success(),
        "browser failed: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    println!("{}", String::from_utf8_lossy(&output.stdout));
}

#[test]
fn discovery_rejects_unbound_tampered_expired_and_ineligible_assertions() {
    use webauthn_rs::prelude::Base64UrlSafeData;
    for case in [
        "missing-handle",
        "foreign-handle",
        "unknown-handle",
        "bad-signature",
        "wrong-origin",
        "wrong-challenge",
        "expired",
        "suspended",
        "deleted",
        "revoked",
        "revoked-after-reopen",
        "reactivated",
    ] {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
        let u = db.create_user("negative@example.test", NOW).unwrap();
        let other = db.create_user("other@example.test", NOW).unwrap();
        let other_token = db.issue_magic(&other.email, NOW).unwrap().unwrap();
        db.consume_magic(&other_token, NOW).unwrap();
        let token = db.issue_magic(&u.email, NOW).unwrap().unwrap();
        db.consume_magic(&token, NOW).unwrap();
        let w = webauthn("http://localhost:3000").unwrap();
        let origin = url::Url::parse("http://localhost:3000").unwrap();
        let mut auth = WebauthnAuthenticator::new(SoftPasskey::new(true));
        let mut registration = db.passkey_register_options(&w, u.id, NOW).unwrap();
        let handle = registration.public_key["user"]["id"].clone();
        // Legacy fixture, never the current browser enrollment path.
        registration.public_key["authenticatorSelection"]["residentKey"] =
            serde_json::json!("discouraged");
        registration.public_key["authenticatorSelection"]["requireResidentKey"] =
            serde_json::json!(false);
        let credential = auth
            .do_registration(
                origin.clone(),
                serde_json::from_value(serde_json::json!({"publicKey":registration.public_key}))
                    .unwrap(),
            )
            .unwrap();
        db.passkey_register_verify(
            &w,
            u.id,
            PasskeyVerify {
                challenge_id: registration.challenge_id,
                credential: serde_json::to_value(credential).unwrap(),
            },
            NOW,
        )
        .unwrap();
        let known = db.passkey_auth_options(&w, &u.email, NOW).unwrap();
        let mut options = db.passkey_auth_options(&w, "", NOW).unwrap();
        options.public_key["allowCredentials"] = known.public_key["allowCredentials"].clone();
        if case == "wrong-challenge" {
            options.public_key["challenge"] = known.public_key["challenge"].clone();
        }
        let credential = auth
            .do_authentication(
                origin,
                serde_json::from_value(serde_json::json!({"publicKey":options.public_key}))
                    .unwrap(),
            )
            .unwrap();
        let mut credential = serde_json::to_value(credential).unwrap();
        credential["response"]["userHandle"] = handle;
        match case {
            "missing-handle" => credential["response"]["userHandle"] = serde_json::Value::Null,
            "foreign-handle" | "unknown-handle" => {
                let id = if case == "foreign-handle" {
                    other.id as u128
                } else {
                    2147483648
                };
                credential["response"]["userHandle"] = serde_json::to_value(
                    Base64UrlSafeData::from(uuid::Uuid::from_u128(id).as_bytes().to_vec()),
                )
                .unwrap();
            }
            "bad-signature" => credential["response"]["signature"] = serde_json::json!("AA"),
            "wrong-origin" => {
                let bytes: Base64UrlSafeData =
                    serde_json::from_value(credential["response"]["clientDataJSON"].clone())
                        .unwrap();
                let mut data: serde_json::Value = serde_json::from_slice(bytes.as_ref()).unwrap();
                data["origin"] = serde_json::json!("https://attacker.example");
                credential["response"]["clientDataJSON"] = serde_json::to_value(
                    Base64UrlSafeData::from(serde_json::to_vec(&data).unwrap()),
                )
                .unwrap();
            }
            "revoked" | "revoked-after-reopen" => {
                db.revoke_user(u.id).unwrap();
            }
            "reactivated" => {
                for suspended in [true, false] {
                    db.patch_user(
                        u.id,
                        UserPatch {
                            suspended: Some(suspended),
                            deleted: None,
                            retention_days: None,
                            link_quota: None,
                        },
                        NOW,
                    )
                    .unwrap();
                }
            }
            "suspended" | "deleted" => {
                db.patch_user(
                    u.id,
                    UserPatch {
                        suspended: Some(case == "suspended"),
                        deleted: Some(case == "deleted"),
                        retention_days: None,
                        link_quota: None,
                    },
                    NOW,
                )
                .unwrap();
            }
            _ => {}
        }
        if case == "revoked-after-reopen" {
            drop(db);
            db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
        }
        let at = if case == "expired" {
            "2026-11-14T17:05:00.000Z"
        } else {
            NOW
        };
        assert!(
            db.passkey_auth_verify(
                &w,
                PasskeyVerify {
                    challenge_id: options.challenge_id,
                    credential
                },
                at
            )
            .is_err(),
            "must reject {case}"
        );
    }
}
