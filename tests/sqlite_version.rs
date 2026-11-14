#[test]
fn linked_sqlite_includes_the_wal_page_cache_security_fix() {
    assert!(
        rusqlite::version_number() >= 3_054_000,
        "linked SQLite {} must be >=3.54.0",
        rusqlite::version()
    );
}
