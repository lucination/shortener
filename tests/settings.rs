#[test]
fn retention_config_defaults_to_ninety_and_rejects_unsafe_or_nonpositive_days() {
    use shortener::domain::global_retention_days;
    assert_eq!(global_retention_days(None).unwrap(), 90);
    assert_eq!(global_retention_days(Some("7")).unwrap(), 7);
    for value in ["0", "-1", "abc", "9007199254740992", ""] {
        assert!(global_retention_days(Some(value)).is_err(), "{value}");
    }
}
