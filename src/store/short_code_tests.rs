use super::*;
const NOW: &str = "2026-11-14T17:00:00.000Z";

fn input(alias: Option<&str>) -> LinkInput {
    serde_json::from_value(serde_json::json!({
        "destination": "https://example.com/path", "alias": alias
    }))
    .unwrap()
}

fn fixture() -> (Store, i32) {
    let db = Store::open(":memory:", "example.com").unwrap();
    let owner = db.create_user("member@example.com", NOW).unwrap().id;
    (db, owner)
}

#[test]
fn automatic_collision_retries_without_leaking_links_or_quota() {
    let (db, owner) = fixture();
    let original = db.create_link(owner, input(Some("Ab123")), NOW).unwrap();
    db.patch_user(
        owner,
        UserPatch {
            link_quota: Some(Some(2)),
            ..UserPatch::default()
        },
        NOW,
    )
    .unwrap();
    let mut candidates = ["Ab123", "Zy987"].into_iter();
    let result = db.create_link_with_candidates(owner, input(None), NOW, || {
        candidates.next().unwrap().into()
    });
    assert!(result.is_ok(), "collision must be retried: {result:?}");
    let link = result.unwrap();
    assert_eq!(link.addresses[0].short_code, "Zy987");
    assert_eq!(
        db.link(original.id).unwrap().addresses[0].short_code,
        "Ab123"
    );
    db.with(|conn| {
        assert_eq!(
            conn.query_row("SELECT count(*) FROM links", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM addresses", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            2
        );
        Ok(())
    })
    .unwrap();
    assert!(
        db.create_link(owner, input(None), NOW)
            .unwrap_err()
            .contains("quota")
    );
}

#[test]
fn reserved_candidates_are_resampled_case_insensitively() {
    let (db, owner) = fixture();
    let mut candidates = [
        "admin", "AdMiN", "login", "LoGiN", "index", "fonts", "Az09z",
    ]
    .into_iter();
    let result = db.create_link_with_candidates(owner, input(None), NOW, || {
        candidates.next().unwrap().into()
    });
    assert!(
        result.is_ok(),
        "reserved candidates must be skipped: {result:?}"
    );
    let code = &result.unwrap().addresses[0].short_code;
    assert_eq!(code, "Az09z");
    assert!(Alias::parse(code).is_ok());
    assert!(candidates.next().is_none());
}

fn counts(db: &Store) -> (i32, i32) {
    db.with(|conn| {
        Ok((
            conn.query_row("SELECT count(*) FROM links", [], |r| r.get(0))
                .unwrap(),
            conn.query_row("SELECT count(*) FROM addresses", [], |r| r.get(0))
                .unwrap(),
        ))
    })
    .unwrap()
}

#[test]
fn deleted_addresses_remain_reserved_and_case_sensitive() {
    let (db, owner) = fixture();
    let original = db.create_link(owner, input(Some("Ab123")), NOW).unwrap();
    db.delete_link(owner, original.id, NOW).unwrap();
    let mut candidates = ["Ab123", "ab123"].into_iter();
    let new = db
        .create_link_with_candidates(owner, input(None), NOW, || {
            candidates.next().unwrap().into()
        })
        .unwrap();
    assert_eq!(new.addresses[0].short_code, "ab123");
    assert!(db.claim_redirect("Ab123", true, NOW).is_err());
    assert!(db.claim_redirect("ab123", true, NOW).is_ok());
    assert_eq!(
        db.link(original.id).unwrap().addresses[0].short_code,
        "Ab123"
    );
    assert_eq!(counts(&db), (2, 2));
}

#[test]
fn exhaustion_is_exactly_32_attempts_and_rolls_back_durably() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_str().unwrap();
    let db = Store::open(path, "example.com").unwrap();
    let owner = db.create_user("member@example.com", NOW).unwrap().id;
    db.create_link(owner, input(Some("Ab123")), NOW).unwrap();
    db.patch_user(
        owner,
        UserPatch {
            link_quota: Some(Some(2)),
            ..UserPatch::default()
        },
        NOW,
    )
    .unwrap();
    // Both collisions and namespace rejections consume the same fixed budget.
    for candidate in ["Ab123", "AdMiN"] {
        let mut calls = 0;
        let result = db.create_link_with_candidates(owner, input(None), NOW, || {
            calls += 1;
            assert!(calls <= 32, "candidate budget must be bounded");
            candidate.into()
        });
        assert_eq!(
            result.unwrap_err(),
            "unable to allocate a short code after 32 attempts"
        );
        assert_eq!(calls, 32);
        assert_eq!(counts(&db), (1, 1));
    }
    drop(db);
    let db = Store::open(path, "example.com").unwrap();
    assert_eq!(counts(&db), (1, 1));
    assert!(
        db.create_link(owner, input(Some("Zy987")), NOW).is_ok(),
        "failed attempts must not consume quota"
    );
    assert_eq!(counts(&db), (2, 2));
}

#[test]
fn custom_conflicts_never_sample_and_custom_lengths_stay_unchanged() {
    let (db, owner) = fixture();
    for alias in [
        "x".to_owned(),
        "a".repeat(64),
        "Mixed_-Case".to_owned(),
        "0123456789".to_owned(),
    ] {
        let link = db
            .create_link_with_candidates(owner, input(Some(&alias)), NOW, || {
                panic!("custom aliases must not sample")
            })
            .unwrap();
        assert_eq!(link.addresses[0].short_code, alias);
        assert!(db.claim_redirect(&alias, false, NOW).is_ok());
        if alias == "x" {
            db.delete_link(owner, link.id, NOW).unwrap();
        }
        let before = counts(&db);
        let error = db
            .create_link_with_candidates(owner, input(Some(&alias)), NOW, || {
                panic!("custom conflicts must not resample")
            })
            .unwrap_err();
        assert_eq!(
            error,
            "UNIQUE constraint failed: addresses.domain_id, addresses.short_code"
        );
        assert_eq!(counts(&db), before);
    }
    for alias in [
        "a".repeat(65),
        String::new(),
        "AdMiN".to_owned(),
        "bad!".to_owned(),
    ] {
        assert!(
            db.create_link_with_candidates(owner, input(Some(&alias)), NOW, || panic!(
                "invalid custom aliases must not sample"
            ))
            .is_err()
        );
    }
}

#[test]
fn unrelated_sql_constraints_are_not_retried_and_roll_back() {
    for trigger in [
        "CREATE TRIGGER reject_address BEFORE INSERT ON addresses BEGIN SELECT RAISE(ABORT,'address write rejected'); END;",
        "CREATE TRIGGER reject_address BEFORE INSERT ON addresses BEGIN INSERT INTO users(email,created_at) VALUES('member@example.com','now'); END;",
    ] {
        let (db, owner) = fixture();
        db.with(|conn| conn.execute_batch(trigger).map_err(sql))
            .unwrap();
        let mut calls = 0;
        let result = db.create_link_with_candidates(owner, input(None), NOW, || {
            calls += 1;
            "Az09z".into()
        });
        let error = result.unwrap_err();
        assert!(
            error.contains("address write rejected")
                || error.contains("UNIQUE constraint failed: users.email"),
            "{error}"
        );
        assert_eq!(calls, 1);
        assert_eq!(counts(&db), (0, 0));
    }
    let (db, owner) = fixture();
    db.with(|conn| {
        conn.execute("DELETE FROM domains", [])
            .map(|_| ())
            .map_err(sql)
    })
    .unwrap();
    let mut calls = 0;
    let error = db
        .create_link_with_candidates(owner, input(None), NOW, || {
            calls += 1;
            "Az09z".into()
        })
        .unwrap_err();
    assert!(error.contains("FOREIGN KEY constraint failed"), "{error}");
    assert_eq!(calls, 1);
    assert_eq!(counts(&db), (0, 0));
}

#[test]
fn collisions_are_scoped_to_the_configured_domain() {
    let (db, owner) = fixture();
    let link = db.create_link(owner, input(Some("Other")), NOW).unwrap();
    db.with(|conn| {
        conn.execute(
            "INSERT INTO domains(id,name) VALUES(2,'other.example.com')",
            [],
        )
        .map_err(sql)?;
        conn.execute(
            "INSERT INTO addresses(link_id,domain_id,short_code) VALUES(?,2,'Az09z')",
            [link.id],
        )
        .map_err(sql)?;
        Ok(())
    })
    .unwrap();
    let mut calls = 0;
    let new = db
        .create_link_with_candidates(owner, input(None), NOW, || {
            calls += 1;
            "Az09z".into()
        })
        .unwrap();
    assert_eq!(calls, 1);
    assert_eq!(new.addresses[0].domain_id, 1);
    assert_eq!(new.addresses[0].short_code, "Az09z");
}

#[test]
fn independent_sqlite_writers_serialize_creation_and_collision_retry() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_str().unwrap();
    let db = Store::open(path, "example.com").unwrap();
    let owner = db.create_user("member@example.com", NOW).unwrap().id;
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let writers: Vec<_> = (0..2)
        .map(|_| {
            let db = Store::open(path, "example.com").unwrap();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut candidates = ["Aa111", "Bb222"].into_iter();
                barrier.wait();
                db.create_link_with_candidates(owner, input(None), NOW, || {
                    candidates.next().unwrap().into()
                })
                .unwrap()
            })
        })
        .collect();
    let mut codes: Vec<_> = writers
        .into_iter()
        .map(|h| h.join().unwrap().addresses[0].short_code.clone())
        .collect();
    codes.sort();
    assert_eq!(codes, ["Aa111", "Bb222"]);
    assert_eq!(counts(&db), (2, 2));
}
