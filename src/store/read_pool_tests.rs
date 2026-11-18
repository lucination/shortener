use super::*;
const NOW: &str = "2026-11-14T17:00:00.000Z";
fn input(alias: &str) -> LinkInput {
    serde_json::from_value(serde_json::json!({"destination":"https://example.com/","alias":alias}))
        .unwrap()
}

#[test]
fn in_memory_store_has_no_readers_and_reads_use_the_writer() {
    let db = Store::open(":memory:", "example.com").unwrap();
    assert!(db.readers.is_none());
    let user = db.create_user("mem@example.test", NOW).unwrap();
    db.create_link(user.id, input("mem"), NOW).unwrap();
    assert_eq!(db.links(Some(user.id)).unwrap().total, 1);
    assert_eq!(db.usage().unwrap().links, 1);
}

#[test]
fn file_store_reads_committed_writes_without_the_writer_lock() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
    assert!(db.readers.is_some());
    let user = db.create_user("wal@example.test", NOW).unwrap();
    let link = db.create_link(user.id, input("wal"), NOW).unwrap();
    // Read-your-writes: a reader transaction started after commit sees the row.
    assert_eq!(db.links(Some(user.id)).unwrap().items[0].id, link.id);
    // Hold the writer mutex; reports must still complete.
    let writer = db.db.lock().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = db.clone();
    std::thread::spawn(move || {
        let ok = reader.stats(link.id, "2026-11-01", "2026-11-30").is_ok()
            && reader
                .events_between(Some(link.id), "2026-11-01", "2026-11-30")
                .is_ok()
            && reader.usage().is_ok()
            && reader.users().is_ok()
            && reader.links(None).is_ok();
        tx.send(ok).unwrap();
    });
    let ok = rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("read-only reports must not wait on the writer mutex");
    assert!(ok);
    drop(writer);
}

#[test]
fn reader_connections_are_read_only() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let db = Store::open(file.path().to_str().unwrap(), "example.com").unwrap();
    let err = db
        .read(|c| c.execute("DELETE FROM users", []).map_err(sql))
        .unwrap_err();
    assert!(
        err.contains("readonly") || err.contains("read-only"),
        "{err}"
    );
}
