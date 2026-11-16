-- Metadata is deliberately separate: existing WebAuthn credential bytes stay untouched.
CREATE TABLE IF NOT EXISTS passkey_names(
 passkey_id INTEGER PRIMARY KEY REFERENCES passkeys(id),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80 AND length(trim(name)) > 0)
);
