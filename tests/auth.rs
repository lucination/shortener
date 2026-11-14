use shortener::store::Store;
const NOW: &str = "2026-11-14T17:00:00.000Z";
#[test]
fn magic_token_is_hashed_single_use_expiring_and_not_signup() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
    assert!(
        db.issue_magic("missing@example.test", NOW)
            .unwrap()
            .is_none()
    );
    let u = db.create_user("member@example.test", NOW).unwrap();
    let token = db.issue_magic(&u.email, NOW).unwrap().unwrap();
    assert!(token.len() >= 32);
    let sql = rusqlite::Connection::open(file.path()).unwrap();
    let stored: String = sql
        .query_row("SELECT token_hash FROM magic_tokens", [], |r| r.get(0))
        .unwrap();
    assert_ne!(stored, token);
    assert_eq!(stored, shortener::store::token_hash(&token));
    let (user, session) = db.consume_magic(&token, NOW).unwrap();
    assert!(user.verified_at.is_some());
    let stored: String = sql
        .query_row("SELECT token_hash FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert_ne!(stored, session);
    assert!(db.consume_magic(&token, NOW).is_err());
    assert_eq!(db.authenticate_user(&session, NOW).unwrap().id, u.id);
    db.revoke_user(u.id).unwrap();
    assert!(db.authenticate_user(&session, NOW).is_err());
    let expired = db.issue_magic(&u.email, NOW).unwrap().unwrap();
    assert!(
        db.consume_magic(&expired, "2026-11-15T17:00:00.000Z")
            .is_err()
    );
}
#[test]
fn revoked_session_cannot_mutate_after_an_earlier_authentication_observation() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let u = db.create_user("revoke@example.test", NOW).unwrap();
    let token = db.issue_magic(&u.email, NOW).unwrap().unwrap();
    let (_, session) = db.consume_magic(&token, NOW).unwrap();
    let authorized = db.user_scope(&session, NOW).unwrap();
    db.revoke_user(u.id).unwrap();
    let input = serde_json::from_value(
        serde_json::json!({"destination":"https://a.test","alias":"must-not-create"}),
    )
    .unwrap();
    assert!(
        authorized.create_link(u.id, input, NOW).is_err(),
        "session eligibility must be rechecked inside the mutation transaction"
    );
}
#[test]
fn rate_limit_is_atomic_and_new_window_resets() {
    let db = Store::open(":memory:", "example.com").unwrap();
    assert!(db.rate_limit("a", 2, NOW).unwrap());
    assert!(db.rate_limit("a", 2, NOW).unwrap());
    assert!(!db.rate_limit("a", 2, NOW).unwrap());
    assert!(db.rate_limit("a", 2, "2026-11-14T17:01:00.000Z").unwrap());
}
