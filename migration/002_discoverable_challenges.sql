-- A bounded latest revocation revision per account fences pre-existing ceremonies.
CREATE TABLE IF NOT EXISTS passkey_revocations (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL UNIQUE REFERENCES users(id)
);
-- Anonymous state cannot reference a user before credential discovery.
CREATE TABLE IF NOT EXISTS discoverable_challenges (
 id TEXT PRIMARY KEY,
 state TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 issued_revision INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS discoverable_challenges_expiry ON discoverable_challenges(expires_at);
