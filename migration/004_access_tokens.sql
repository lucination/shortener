-- Independent create-only authority; never persist the issuance secret.
CREATE TABLE IF NOT EXISTS access_tokens(
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 prefix TEXT NOT NULL CHECK(length(prefix)=17),
 scope TEXT NOT NULL DEFAULT 'links:create' CHECK(scope='links:create'),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL CHECK(expires_at>created_at),
 last_used_at TEXT,
 revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS access_tokens_owner ON access_tokens(user_id,id);
