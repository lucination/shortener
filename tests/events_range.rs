use shortener::{analytics::Observation, dto::*, store::Store};
#[test]
fn raw_events_use_inclusive_utc_dates_and_report_only_matching_total() {
    let db = Store::open(":memory:", "example.com").unwrap();
    let u = db
        .create_user("events@example.test", "2026-11-14T00:00:00Z")
        .unwrap();
    let input = serde_json::from_value(
        serde_json::json!({"destination":"https://example.test","alias":"events-range"}),
    )
    .unwrap();
    let link = db.create_link(u.id, input, "2026-11-14T00:00:00Z").unwrap();
    let observation = Observation {
        ip: "192.0.2.1".into(),
        user_agent: "Firefox/1 Linux".into(),
        referrer: None,
    };
    for at in [
        "2026-11-13T23:59:59Z",
        "2026-11-14T00:00:00Z",
        "2026-11-14T23:59:59Z",
        "2026-11-15T00:00:00Z",
    ] {
        db.record_event(
            &link,
            link.addresses[0].id,
            EventKind::Human,
            &observation,
            at,
            "secret",
        )
        .unwrap();
    }
    let events = db
        .events_between(Some(link.id), "2026-11-14", "2026-11-14")
        .unwrap();
    assert_eq!(events.total, 2);
    assert_eq!(events.items.len(), 2);
    assert!(
        events
            .items
            .iter()
            .all(|e| e.occurred_at.starts_with("2026-11-14"))
    );
    assert!(
        db.events_between(Some(link.id), "invalid", "2026-11-14")
            .is_err()
    );
    assert!(
        db.events_between(Some(link.id), "2026-11-15", "2026-11-14")
            .is_err()
    );
}
