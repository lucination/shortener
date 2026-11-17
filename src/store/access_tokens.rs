//! Token lifecycle shell. Secrets are generated once and never read back from SQLite.
use super::*;
use rand::TryRngCore;
const UNAUTHORIZED: &str = "session no longer authorized";
pub(crate) fn access_hash(token: &str) -> DbResult<String> {
    let secret = token.strip_prefix("short_at_").ok_or(UNAUTHORIZED)?;
    if secret.len() != 64
        || !secret
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(UNAUTHORIZED.into());
    }
    Ok(token_hash(token))
}
fn metadata(r: &rusqlite::Row<'_>) -> rusqlite::Result<AccessTokenMetadata> {
    Ok(AccessTokenMetadata {
        id: r.get(0)?,
        name: r.get(1)?,
        prefix: r.get(2)?,
        scope: r.get(3)?,
        created_at: r.get(4)?,
        expires_at: r.get(5)?,
        last_used_at: r.get(6)?,
    })
}
const SELECT: &str =
    "SELECT id,name,prefix,scope,created_at,expires_at,last_used_at FROM access_tokens";
pub(super) fn owner(db: &Connection, hash: &str, now: &str) -> DbResult<i32> {
    db.query_row("SELECT t.user_id FROM access_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>? AND t.scope='links:create' AND u.verified_at IS NOT NULL AND u.suspended=0 AND u.deleted_at IS NULL",params![hash,now],|r|r.get(0)).optional().map_err(sql)?.ok_or_else(||UNAUTHORIZED.into())
}
impl Store {
    pub fn issue_access_token(
        &self,
        user: i32,
        input: AccessTokenInput,
        now: &str,
    ) -> DbResult<IssuedAccessToken> {
        let name = input.name.trim();
        if !(1..=80).contains(&name.chars().count()) || name.chars().any(char::is_control) {
            return Err("token name must be 1..80 characters without control characters".into());
        }
        if !(1..=365).contains(&input.expires_in_days) {
            return Err("token expiration must be 1..365 days".into());
        }
        let created_at = instant(parse_instant(now)?);
        let expires_at = expires(&created_at, i64::from(input.expires_in_days) * 86400)?;
        let mut entropy = [0u8; 32];
        rand::rngs::OsRng
            .try_fill_bytes(&mut entropy)
            .map_err(|_| "secure randomness unavailable")?;
        let token = format!("short_at_{}", hex::encode(entropy));
        let prefix = token[..17].to_owned();
        self.with(|db| {
            let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(sql)?;
            self.authorize(&tx,Some(user),&created_at)?;
            tx.execute("INSERT INTO access_tokens(user_id,token_hash,name,prefix,created_at,expires_at)VALUES(?,?,?,?,?,?)",params![user,token_hash(&token),name,prefix,created_at,expires_at]).map_err(sql)?;
            let metadata=tx.query_row(&format!("{SELECT} WHERE id=?"),[tx.last_insert_rowid()],metadata).map_err(sql)?;
            tx.commit().map_err(sql)?;
            Ok(IssuedAccessToken{metadata,token})
        })
    }
    pub fn access_tokens(&self, user: i32, now: &str) -> DbResult<AccessTokenList> {
        self.with(|db| {
            self.authorize(db, Some(user), now)?;
            let items = db
                .prepare(&format!(
                    "{SELECT} WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC"
                ))
                .map_err(sql)?
                .query_map([user], metadata)
                .map_err(sql)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(sql)?;
            Ok(AccessTokenList { items })
        })
    }
    pub fn revoke_access_token(&self, user: i32, id: i32, now: &str) -> DbResult<()> {
        self.with(|db|{let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(sql)?;
            self.authorize(&tx,Some(user),now)?;
            if tx.execute("UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND id=?",params![now,user,id]).map_err(sql)?!=1{return Err("not found".into());}
            tx.commit().map_err(sql)
        })
    }
    /// Clock observation occurs after acquiring the store lock, inside the write boundary.
    pub fn create_access_link(&self, token: &str, input: LinkInput) -> DbResult<Link> {
        self.create_access_link_with_clock(token, input, || instant(chrono::Utc::now()))
    }
    pub fn create_access_link_at(
        &self,
        token: &str,
        input: LinkInput,
        now: &str,
    ) -> DbResult<Link> {
        self.create_access_link_with_clock(token, input, || now.to_owned())
    }
    fn create_access_link_with_clock(
        &self,
        token: &str,
        input: LinkInput,
        mut clock: impl FnMut() -> String,
    ) -> DbResult<Link> {
        let hash = access_hash(token)?;
        // Cheap rejection before password hashing. This is NOT admission:
        // create_link_with_clock rechecks owner/status/expiry/revocation against
        // a fresh clock under its final IMMEDIATE write transaction.
        self.with(|db| owner(db, &hash, &clock()).map(|_| ()))?;
        let scoped = Self {
            db: self.db.clone(),
            authority: Authority::Access { hash },
        };
        scoped.create_link_with_clock(0, input, clock, short_code::generate)
    }
}
