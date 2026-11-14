PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 2147483647), email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 verified_at TEXT, suspended INTEGER NOT NULL DEFAULT 0 CHECK(suspended IN(0,1)), deleted_at TEXT,
 retention_days INTEGER CHECK(retention_days BETWEEN 1 AND 3650), link_quota INTEGER CHECK(link_quota>=0), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS domains(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS links(
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 2147483647), owner_id INTEGER NOT NULL REFERENCES users(id), destination TEXT NOT NULL CHECK(destination LIKE 'http://%' OR destination LIKE 'https://%'),
 title TEXT, description TEXT, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)), deleted_at TEXT, expires_at TEXT,
 click_limit INTEGER CHECK(click_limit>0), human_clicks INTEGER NOT NULL DEFAULT 0 CHECK(human_clicks>=0), password_hash TEXT,
 password_version INTEGER NOT NULL DEFAULT 0, interstitial INTEGER NOT NULL DEFAULT 0 CHECK(interstitial IN(0,1)),
 query_mode TEXT NOT NULL DEFAULT 'discard' CHECK(query_mode IN('discard','preserve','override')),
 retention_days INTEGER CHECK(retention_days BETWEEN 1 AND 3650), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS addresses(id INTEGER PRIMARY KEY, link_id INTEGER NOT NULL REFERENCES links(id), domain_id INTEGER NOT NULL REFERENCES domains(id), short_code TEXT NOT NULL, UNIQUE(domain_id,short_code));
CREATE TRIGGER IF NOT EXISTS immutable_address BEFORE UPDATE ON addresses BEGIN SELECT RAISE(ABORT,'address identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS permanent_address BEFORE DELETE ON addresses BEGIN SELECT RAISE(ABORT,'address identity is permanent'); END;
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN('user','admin')), expires_at TEXT NOT NULL, CHECK((kind='user' AND user_id IS NOT NULL) OR (kind='admin' AND user_id IS NULL)));
CREATE TABLE IF NOT EXISTS magic_tokens(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grants(token_hash TEXT PRIMARY KEY, link_id INTEGER NOT NULL REFERENCES links(id), version INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passkeys(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), credential_id TEXT NOT NULL UNIQUE, credential TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN('register','authenticate')), state TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, link_id INTEGER NOT NULL REFERENCES links(id), address_id INTEGER NOT NULL REFERENCES addresses(id), occurred_at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('human','bot','link_preview','preview')), ip TEXT NOT NULL, user_agent TEXT NOT NULL, referrer TEXT, country TEXT, city TEXT, browser TEXT NOT NULL, os TEXT NOT NULL, device TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_link_time ON events(link_id,occurred_at);
CREATE TABLE IF NOT EXISTS daily(link_id INTEGER NOT NULL REFERENCES links(id), day TEXT NOT NULL, redirects INTEGER NOT NULL DEFAULT 0, humans INTEGER NOT NULL DEFAULT 0, bots INTEGER NOT NULL DEFAULT 0, previews INTEGER NOT NULL DEFAULT 0, daily_unique INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(link_id,day));
CREATE TABLE IF NOT EXISTS uniques(link_id INTEGER NOT NULL REFERENCES links(id), day TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(link_id,day,hash));
CREATE TABLE IF NOT EXISTS breakdown(link_id INTEGER NOT NULL REFERENCES links(id), day TEXT NOT NULL, dimension TEXT NOT NULL CHECK(dimension IN('referrer','country','device')), label TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(link_id,day,dimension,label));
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
PRAGMA user_version=1;
