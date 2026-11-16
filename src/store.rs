//! Stateful SQLite shell. Policy inputs are parsed by the pure domain boundary.
use crate::{domain::*, dto::*};
use rusqlite::{Connection, OptionalExtension, params};
use std::sync::{Arc, Mutex};
mod short_code;
#[derive(Clone)]
enum Authority {
    Internal,
    User { id: i32, hash: String },
    Admin { hash: String },
}
#[derive(Clone)]
pub struct Store {
    pub(crate) db: Arc<Mutex<Connection>>,
    authority: Authority,
}
pub type DbResult<T> = Result<T, String>;
fn sql(e: rusqlite::Error) -> String {
    e.to_string()
}
const LINK_SELECT: &str = "SELECT id,owner_id,destination,title,description,enabled,deleted_at,expires_at,click_limit,human_clicks,password_hash IS NOT NULL,interstitial,query_mode,retention_days,created_at FROM links";
pub(crate) fn user_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<User> {
    Ok(User {
        id: r.get(0)?,
        email: r.get(1)?,
        verified_at: r.get(2)?,
        suspended: r.get(3)?,
        deleted_at: r.get(4)?,
        retention_days: r.get(5)?,
        link_quota: r.get(6)?,
        created_at: r.get(7)?,
    })
}
fn link_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Link> {
    let mode: String = r.get(12)?;
    Ok(Link {
        id: r.get(0)?,
        owner_id: r.get(1)?,
        destination: r.get(2)?,
        title: r.get(3)?,
        description: r.get(4)?,
        enabled: r.get(5)?,
        deleted_at: r.get(6)?,
        expires_at: r.get(7)?,
        click_limit: r.get(8)?,
        human_clicks: r.get(9)?,
        password_protected: r.get(10)?,
        interstitial: r.get(11)?,
        query_mode: serde_json::from_value(serde_json::Value::String(mode))
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
        retention_days: r.get(13)?,
        created_at: r.get(14)?,
        addresses: vec![],
    })
}
pub(crate) fn get_link(db: &Connection, id: i32) -> DbResult<Link> {
    let mut link = db
        .query_row(&format!("{LINK_SELECT} WHERE id=?"), [id], link_row)
        .map_err(sql)?;
    link.addresses=db.prepare("SELECT a.id,a.domain_id,d.name,a.short_code FROM addresses a JOIN domains d ON d.id=a.domain_id WHERE a.link_id=? ORDER BY a.id").map_err(sql)?.query_map([id],|r|Ok(Address{id:r.get(0)?,domain_id:r.get(1)?,domain:r.get(2)?,short_code:r.get(3)?})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;
    Ok(link)
}
impl Store {
    pub fn rate_limit(&self, key: &str, limit: i32, now: &str) -> DbResult<bool> {
        if !(1..=10000).contains(&limit) {
            return Err("invalid rate limit".into());
        }
        let window = parse_instant(now)?.timestamp() / 60;
        self.with(|db|{let count:i32=db.query_row("INSERT INTO rate_limits(key,window,count)VALUES(?,?,1) ON CONFLICT(key)DO UPDATE SET count=CASE WHEN excluded.window>rate_limits.window THEN 1 ELSE MIN(rate_limits.count+1,?) END,window=MAX(rate_limits.window,excluded.window) RETURNING count",params![token_hash(key),window,limit+1],|r|r.get(0)).map_err(sql)?;Ok(count<=limit)})
    }
    pub fn user_scope(&self, token: &str, now: &str) -> DbResult<Self> {
        let user = self.authenticate_user(token, now)?;
        Ok(Self {
            db: self.db.clone(),
            authority: Authority::User {
                id: user.id,
                hash: token_hash(token),
            },
        })
    }
    pub(crate) fn admin_scope(&self, token: &str, now: &str) -> DbResult<Self> {
        self.authenticate_admin(token, now)?;
        Ok(Self {
            db: self.db.clone(),
            authority: Authority::Admin {
                hash: token_hash(token),
            },
        })
    }
    pub(crate) fn authorize(
        &self,
        db: &Connection,
        target: Option<i32>,
        now: &str,
    ) -> DbResult<()> {
        let valid=match &self.authority{
   Authority::Internal=>true,
   Authority::User{id,hash}=>target==Some(*id)&&db.query_row("SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.kind='user' AND s.user_id=? AND s.expires_at>? AND u.verified_at IS NOT NULL AND u.suspended=0 AND u.deleted_at IS NULL)",params![hash,id,now],|r|r.get::<_,bool>(0)).map_err(sql)?,
   Authority::Admin{hash}=>db.query_row("SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND kind='admin' AND expires_at>?)",params![hash,now],|r|r.get::<_,bool>(0)).map_err(sql)?,
  };
        if valid {
            Ok(())
        } else {
            Err("session no longer authorized".into())
        }
    }
    pub fn issue_magic(&self, email: &str, now: &str) -> DbResult<Option<String>> {
        let expiry = expires(now, 15 * 60)?;
        self.with(|db|{
  let id:Option<i32>=db.query_row("SELECT id FROM users WHERE email=? COLLATE NOCASE AND suspended=0 AND deleted_at IS NULL",[email.trim()],|r|r.get(0)).optional().map_err(sql)?;
  let Some(id)=id else{return Ok(None)};let token=random_token();db.execute("INSERT INTO magic_tokens VALUES(?,?,?)",params![token_hash(&token),id,expiry]).map_err(sql)?;Ok(Some(token))
 })
    }
    pub fn consume_magic(&self, token: &str, now: &str) -> DbResult<(User, String)> {
        self.with(|db|{
  let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(sql)?;
  let id:Option<i32>=tx.query_row("DELETE FROM magic_tokens WHERE token_hash=? AND expires_at>? RETURNING user_id",params![token_hash(token),now],|r|r.get(0)).optional().map_err(sql)?;
  let id=id.ok_or("invalid or expired token")?;
  let changed=tx.execute("UPDATE users SET verified_at=COALESCE(verified_at,?) WHERE id=? AND suspended=0 AND deleted_at IS NULL",params![now,id]).map_err(sql)?;if changed!=1{return Err("account unavailable".into());}
  let user=tx.query_row("SELECT * FROM users WHERE id=?",[id],user_row).map_err(sql)?;
  let session=insert_session(&tx,Some(id),now)?;tx.commit().map_err(sql)?;Ok((user,session))
 })
    }
    pub fn authenticate_user(&self, token: &str, now: &str) -> DbResult<User> {
        self.with(|db|db.query_row("SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.kind='user' AND s.expires_at>? AND u.verified_at IS NOT NULL AND u.suspended=0 AND u.deleted_at IS NULL",params![token_hash(token),now],user_row).map_err(sql))
    }
    pub fn revoke_user(&self, id: i32) -> DbResult<()> {
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(sql)?;
            self.authorize(&tx, Some(id), &instant(chrono::Utc::now()))?;
            for table in ["sessions", "magic_tokens", "challenges"] {
                tx.execute(&format!("DELETE FROM {table} WHERE user_id=?"), [id])
                    .map_err(sql)?;
            }
            tx.execute(
                    "INSERT OR REPLACE INTO passkey_revocations(user_id) SELECT id FROM users WHERE id=?", [id]
                ).map_err(sql)?;
            tx.commit().map_err(sql)
        })
    }
    pub fn admin_session(&self, now: &str) -> DbResult<String> {
        self.with(|db| insert_session(db, None, now))
    }
    pub fn authenticate_admin(&self, token: &str, now: &str) -> DbResult<()> {
        self.with(|db|{let yes:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND kind='admin' AND expires_at>?)",params![token_hash(token),now],|r|r.get(0)).map_err(sql)?;if yes{Ok(())}else{Err("unauthorized".into())}})
    }
    pub fn logout(&self, token: &str) -> DbResult<()> {
        self.with(|db| {
            db.execute(
                "DELETE FROM sessions WHERE token_hash=?",
                [token_hash(token)],
            )
            .map_err(sql)?;
            Ok(())
        })
    }
    pub fn users(&self) -> DbResult<UserList> {
        self.with(|db| {
            let items = db
                .prepare("SELECT * FROM users ORDER BY id DESC")
                .map_err(sql)?
                .query_map([], user_row)
                .map_err(sql)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(sql)?;
            Ok(UserList {
                total: items.len() as i32,
                items,
            })
        })
    }
    pub fn user(&self, id: i32) -> DbResult<User> {
        self.with(|db| {
            db.query_row("SELECT * FROM users WHERE id=?", [id], user_row)
                .map_err(sql)
        })
    }
    pub fn patch_user(&self, id: i32, p: UserPatch, now: &str) -> DbResult<User> {
        let retention = p
            .retention_days
            .map(|v| {
                v.map(RetentionDays::parse)
                    .transpose()
                    .map(|v| v.map(RetentionDays::get))
            })
            .transpose()?;
        if p.link_quota.flatten().is_some_and(|q| q < 0) {
            return Err("quota cannot be negative".into());
        }
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(sql)?;
            self.authorize(&tx, Some(id), now)?;
            macro_rules! set {
                ($col:literal,$v:expr) => {
                    if let Some(v) = $v {
                        tx.execute(
                            concat!("UPDATE users SET ", $col, "=? WHERE id=?"),
                            params![v, id],
                        )
                        .map_err(sql)?;
                    }
                };
            }
            set!("suspended", p.suspended);
            set!("retention_days", retention);
            set!("link_quota", p.link_quota);
            if let Some(deleted) = p.deleted {
                tx.execute(
                    "UPDATE users SET deleted_at=? WHERE id=?",
                    params![if deleted { Some(now) } else { None }, id],
                )
                .map_err(sql)?;
            }
            if p.suspended == Some(true) || p.deleted == Some(true) {
                for table in ["sessions", "magic_tokens", "challenges"] {
                    tx.execute(&format!("DELETE FROM {table} WHERE user_id=?"), [id])
                        .map_err(sql)?;
                }
                tx.execute(
                    "INSERT OR REPLACE INTO passkey_revocations(user_id) SELECT id FROM users WHERE id=?", [id]
                ).map_err(sql)?;
            }
            let u = tx
                .query_row("SELECT * FROM users WHERE id=?", [id], user_row)
                .map_err(sql)?;
            tx.commit().map_err(sql)?;
            Ok(u)
        })
    }
    pub fn link(&self, id: i32) -> DbResult<Link> {
        self.with(|db| get_link(db, id))
    }
    pub fn lookup(&self, code: &str, now: &str) -> DbResult<Link> {
        self.with(|db| {
            let id = eligible_address(db, code, now)?;
            get_link(db, id)
        })
    }
    pub fn claim_redirect(&self, code: &str, human: bool, now: &str) -> DbResult<Link> {
        self.claim_authorized(code, human, now, None)
    }
    pub fn claim_authorized(
        &self,
        code: &str,
        human: bool,
        now: &str,
        grant: Option<&str>,
    ) -> DbResult<Link> {
        self.claim_with_clock(code, human, || now.to_owned(), grant)
    }
    pub fn claim_authorized_now(
        &self,
        code: &str,
        human: bool,
        grant: Option<&str>,
    ) -> DbResult<Link> {
        self.claim_with_clock(code, human, || instant(chrono::Utc::now()), grant)
    }
    fn claim_with_clock(
        &self,
        code: &str,
        human: bool,
        clock: impl FnOnce() -> String,
        grant: Option<&str>,
    ) -> DbResult<Link> {
        self.with(|db|{
  let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(sql)?;
  // Observe the shell clock only after obtaining SQLite's write reservation.
  let now=clock();let id=eligible_address(&tx,code,&now)?;
  let protected:bool=tx.query_row("SELECT password_hash IS NOT NULL FROM links WHERE id=?",[id],|r|r.get(0)).map_err(sql)?;
  if protected&&!valid_grant(&tx,id,grant.unwrap_or(""),&now)?{return Err("password required".into());}
  // Eligibility is part of the same SQL write, not a read-then-increment race.
  let changed=tx.execute("UPDATE links SET human_clicks=human_clicks+? WHERE id=? AND enabled=1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND (click_limit IS NULL OR human_clicks<click_limit) AND EXISTS(SELECT 1 FROM users WHERE users.id=links.owner_id AND suspended=0 AND deleted_at IS NULL)",params![i32::from(human),id,now]).map_err(sql)?;
  if changed!=1{return Err("not found".into());}
  let l=get_link(&tx,id)?;tx.commit().map_err(sql)?;Ok(l)
 })
    }
    pub fn check_grant(&self, id: i32, token: &str, now: &str) -> DbResult<bool> {
        self.with(|db| valid_grant(db, id, token, now))
    }
    pub fn unlock(&self, code: &str, password: &str, now: &str) -> DbResult<(i32, String)> {
        if password.len() > 1024 {
            return Err("invalid password".into());
        }
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(sql)?;
            let id = eligible_address(&tx, code, now)?;
            let (hash, version): (Option<String>, i32) = tx
                .query_row(
                    "SELECT password_hash,password_version FROM links WHERE id=?",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(sql)?;
            if !hash.is_some_and(|h| verify_password(password, &h)) {
                return Err("invalid password".into());
            }
            let token = random_token();
            tx.execute(
                "INSERT INTO grants VALUES(?,?,?,?)",
                params![token_hash(&token), id, version, expires(now, 15 * 60)?],
            )
            .map_err(sql)?;
            tx.commit().map_err(sql)?;
            Ok((id, token))
        })
    }
    pub fn bulk_update(
        &self,
        owner: i32,
        input: BulkUpdate,
        now: &str,
    ) -> DbResult<BulkUpdateResponse> {
        if input.ids.is_empty() || input.ids.len() > 1000 {
            return Err("bulk update requires 1..1000 IDs".into());
        }
        let mut outcomes = std::collections::BTreeMap::<i32, Result<(), String>>::new();
        let mut updated = vec![];
        let mut items = vec![];
        for (index, id) in input.ids.into_iter().enumerate() {
            if let std::collections::btree_map::Entry::Vacant(entry) = outcomes.entry(id) {
                let outcome = self.bulk_update_one(owner, id, &input.action, now);
                if outcome.is_ok() {
                    updated.push(id);
                }
                entry.insert(outcome);
            }
            items.push(match &outcomes[&id] {
                Ok(()) => BulkUpdateResult::Updated {
                    index: index as i32,
                    id,
                },
                Err(e) => BulkUpdateResult::Failed {
                    index: index as i32,
                    id,
                    error: ErrorBody {
                        code: if e == "not found" {
                            "not_found"
                        } else {
                            "validation"
                        }
                        .into(),
                        message: e.clone(),
                    },
                },
            });
        }
        Ok(BulkUpdateResponse { updated, items })
    }
    fn bulk_update_one(&self, owner: i32, id: i32, action: &BulkAction, now: &str) -> DbResult<()> {
        let expiry = if let BulkAction::Expiration { expires_at } = action {
            expires_at
                .as_deref()
                .map(parse_instant)
                .transpose()?
                .map(instant)
        } else {
            None
        };
        let retention = if let BulkAction::Retention { retention_days } = action {
            retention_days
                .map(RetentionDays::parse)
                .transpose()?
                .map(RetentionDays::get)
        } else {
            None
        };
        if matches!(action,BulkAction::Domain{domain_id} if *domain_id!=1) {
            return Err("only configured domain 1 is available".into());
        }
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(sql)?;
            self.authorize(&tx, Some(owner), now)?;
            assert_owned(&tx, owner, id)?;
            match action {
                BulkAction::Enable | BulkAction::Disable => {
                    tx.execute(
                        "UPDATE links SET enabled=? WHERE id=?",
                        params![matches!(action, BulkAction::Enable), id],
                    )
                    .map_err(sql)?;
                }
                BulkAction::Delete => {
                    tx.execute(
                        "UPDATE links SET deleted_at=?,enabled=0 WHERE id=?",
                        params![now, id],
                    )
                    .map_err(sql)?;
                }
                BulkAction::Expiration { .. } => {
                    tx.execute(
                        "UPDATE links SET expires_at=? WHERE id=?",
                        params![expiry, id],
                    )
                    .map_err(sql)?;
                }
                BulkAction::Retention { .. } => {
                    tx.execute(
                        "UPDATE links SET retention_days=? WHERE id=?",
                        params![retention, id],
                    )
                    .map_err(sql)?;
                }
                BulkAction::Domain { .. } => {}
            }
            tx.commit().map_err(sql)
        })
    }
    pub fn patch_link(&self, owner: i32, id: i32, p: LinkPatch, now: &str) -> DbResult<Link> {
        // Validate all replacements before opening the transaction or changing any row.
        let dest = p.destination.as_deref().map(destination).transpose()?;
        let expiry = p
            .expires_at
            .map(|v| v.map(|s| parse_instant(&s).map(instant)).transpose())
            .transpose()?;
        let limit = p
            .click_limit
            .map(|v| {
                v.map(ClickLimit::parse)
                    .transpose()
                    .map(|v| v.map(ClickLimit::get))
            })
            .transpose()?;
        let retention = p
            .retention_days
            .map(|v| {
                v.map(RetentionDays::parse)
                    .transpose()
                    .map(|v| v.map(RetentionDays::get))
            })
            .transpose()?;
        for (value, max) in [(&p.title, 300), (&p.description, 4000)] {
            if value
                .as_ref()
                .and_then(|v| v.as_ref())
                .is_some_and(|s| s.len() > max)
            {
                return Err("text too long".into());
            }
        }
        let password = p
            .password
            .map(|v| {
                v.map(|s| {
                    if !(8..=1024).contains(&s.len()) {
                        return Err("password must be 8..1024 bytes".into());
                    }
                    hash_password(&s)
                })
                .transpose()
            })
            .transpose()?;
        self.with(|db|{
   let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(sql)?;
   self.authorize(&tx,Some(owner),now)?;assert_owned(&tx,owner,id)?;
   macro_rules! set {($col:literal,$v:expr)=>{if let Some(v)=$v {tx.execute(concat!("UPDATE links SET ",$col,"=? WHERE id=?"),params![v,id]).map_err(sql)?;}};}
   set!("destination",dest);set!("enabled",p.enabled);set!("interstitial",p.interstitial);set!("query_mode",p.query_mode.map(|m|serde_json::to_value(m).unwrap().as_str().unwrap().to_string()));
   set!("title",p.title);set!("description",p.description);set!("expires_at",expiry);set!("click_limit",limit);set!("retention_days",retention);
   if let Some(hash)=password{tx.execute("UPDATE links SET password_hash=?,password_version=password_version+1 WHERE id=?",params![hash,id]).map_err(sql)?;tx.execute("DELETE FROM grants WHERE link_id=?",[id]).map_err(sql)?;}
   let l=get_link(&tx,id)?;tx.commit().map_err(sql)?;Ok(l)
  })
    }
    pub fn delete_link(&self, owner: i32, id: i32, now: &str) -> DbResult<()> {
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(sql)?;
            self.authorize(&tx, Some(owner), now)?;
            assert_owned(&tx, owner, id)?;
            tx.execute(
                "UPDATE links SET deleted_at=?,enabled=0 WHERE id=?",
                params![now, id],
            )
            .map_err(sql)?;
            tx.commit().map_err(sql)
        })
    }
    pub fn open(path: &str, domain: &str) -> DbResult<Self> {
        let domain = HostName::parse(domain)?.as_str().to_owned();
        let db = Connection::open(path).map_err(sql)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(sql)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(sql)?;
        db.execute_batch(include_str!("../migration/001_initial.sql"))
            .map_err(sql)?;
        db.execute_batch(include_str!("../migration/002_discoverable_challenges.sql"))
            .map_err(sql)?;
        db.execute(
            "INSERT OR IGNORE INTO domains(id,name)VALUES(1,?)",
            [&domain],
        )
        .map_err(sql)?;
        let actual: String = db
            .query_row("SELECT name FROM domains WHERE id=1", [], |r| r.get(0))
            .map_err(sql)?;
        if actual != domain {
            return Err(
                "configured domain cannot replace an existing immutable address domain".into(),
            );
        }
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            authority: Authority::Internal,
        })
    }
    pub(crate) fn with<T>(&self, f: impl FnOnce(&mut Connection) -> DbResult<T>) -> DbResult<T> {
        let mut db = self.db.lock().map_err(|_| "database lock poisoned")?;
        f(&mut db)
    }
    pub fn create_user(&self, email: &str, now: &str) -> DbResult<User> {
        let email = email.trim().to_ascii_lowercase();
        if email.len() > 254 || email.parse::<lettre::Address>().is_err() {
            return Err("invalid email".into());
        }
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(sql)?;
            self.authorize(&tx, None, now)?;
            tx.execute(
                "INSERT INTO users(email,created_at) VALUES(?,?)",
                params![email, now],
            )
            .map_err(sql)?;
            let u = tx
                .query_row(
                    "SELECT * FROM users WHERE id=?",
                    [tx.last_insert_rowid()],
                    user_row,
                )
                .map_err(sql)?;
            tx.commit().map_err(sql)?;
            Ok(u)
        })
    }
    pub fn create_link(&self, owner: i32, input: LinkInput, now: &str) -> DbResult<Link> {
        self.create_link_with_candidates(owner, input, now, short_code::generate)
    }
    fn create_link_with_candidates(
        &self,
        owner: i32,
        input: LinkInput,
        now: &str,
        mut candidate: impl FnMut() -> String,
    ) -> DbResult<Link> {
        let v = NewLink::try_from(input)?;
        let hash = v.password.as_deref().map(hash_password).transpose()?;
        self.with(|db|{
   let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(sql)?;
   self.authorize(&tx,Some(owner),now)?;
   let eligible:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=? AND suspended=0 AND deleted_at IS NULL AND (link_quota IS NULL OR (SELECT count(*) FROM links WHERE owner_id=u.id AND deleted_at IS NULL)<link_quota))",[owner],|r|r.get(0)).map_err(sql)?;
   if !eligible{return Err("owner unavailable or link quota exceeded".into());}
   tx.execute("INSERT INTO links(owner_id,destination,title,description,expires_at,click_limit,password_hash,interstitial,query_mode,retention_days,created_at)VALUES(?,?,?,?,?,?,?,?,?,?,?)",params![owner,v.destination.as_str(),v.title,v.description,v.expires_at.map(instant),v.click_limit.map(ClickLimit::get),hash,v.interstitial,serde_json::to_value(v.query_mode).unwrap().as_str().unwrap(),v.retention.map(RetentionDays::get),now]).map_err(sql)?;
   let id=tx.last_insert_rowid() as i32;
   if let Some(alias) = v.alias {
       tx.execute("INSERT INTO addresses(link_id,domain_id,short_code) VALUES(?,1,?)",params![id,alias.as_str()]).map_err(sql)?;
   } else {
       let mut inserted = false;
       for _ in 0..32 {
           let Ok(alias) = Alias::parse(&candidate()) else { continue };
           if insert_address(&tx, id, &alias)? {
               inserted = true;
               break;
           }
       }
       if !inserted {
           return Err("unable to allocate a short code after 32 attempts".into());
       }
   }
   let link=get_link(&tx,id)?;tx.commit().map_err(sql)?;Ok(link)
  })
    }
}
// Only the permanent domain/code UNIQUE constraint is eligible for retry.
// Foreign key, CHECK, trigger, disk, and other SQL failures remain errors.
fn insert_address(db: &Connection, link: i32, alias: &Alias) -> DbResult<bool> {
    db.execute(
        "INSERT INTO addresses(link_id,domain_id,short_code) VALUES(?,1,?) ON CONFLICT(domain_id,short_code) DO NOTHING",
        params![link, alias.as_str()],
    ).map(|changed| changed == 1).map_err(sql)
}

#[cfg(test)]
mod short_code_tests;

pub fn hash_password(p: &str) -> DbResult<String> {
    use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
    let salt =
        SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes()).map_err(|e| e.to_string())?;
    Argon2::default()
        .hash_password(p.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}
pub fn verify_password(p: &str, hash: &str) -> bool {
    use argon2::{Argon2, PasswordHash, PasswordVerifier};
    PasswordHash::new(hash)
        .is_ok_and(|h| Argon2::default().verify_password(p.as_bytes(), &h).is_ok())
}
fn eligible_address(db: &Connection, code: &str, now: &str) -> DbResult<i32> {
    db.query_row("SELECT l.id FROM links l JOIN addresses a ON a.link_id=l.id JOIN users u ON u.id=l.owner_id WHERE a.domain_id=1 AND a.short_code=? AND l.enabled=1 AND l.deleted_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>?) AND (l.click_limit IS NULL OR l.human_clicks<l.click_limit) AND u.suspended=0 AND u.deleted_at IS NULL",params![code,now],|r|r.get(0)).optional().map_err(sql)?.ok_or_else(||"not found".into())
}
pub(crate) fn assert_owned(db: &Connection, owner: i32, id: i32) -> DbResult<()> {
    let yes:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM links l JOIN users u ON u.id=l.owner_id WHERE l.id=? AND l.owner_id=? AND l.deleted_at IS NULL AND u.suspended=0 AND u.deleted_at IS NULL)",params![id,owner],|r|r.get(0)).map_err(sql)?;
    if yes { Ok(()) } else { Err("not found".into()) }
}
pub fn random_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub fn token_hash(token: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(token.as_bytes()))
}
pub fn expires(now: &str, seconds: i64) -> DbResult<String> {
    Ok(instant(
        parse_instant(now)? + chrono::Duration::seconds(seconds),
    ))
}
pub(crate) fn insert_session(db: &Connection, user: Option<i32>, now: &str) -> DbResult<String> {
    if let Some(id) = user {
        let eligible:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND verified_at IS NOT NULL AND suspended=0 AND deleted_at IS NULL)",[id],|r|r.get(0)).map_err(sql)?;
        if !eligible {
            return Err("account unavailable".into());
        }
    }
    let token = random_token();
    let kind = if user.is_some() { "user" } else { "admin" };
    db.execute(
        "INSERT INTO sessions(token_hash,user_id,kind,expires_at) VALUES(?,?,?,?)",
        params![
            token_hash(&token),
            user,
            kind,
            expires(now, if user.is_some() { 30 * 86400 } else { 3600 })?
        ],
    )
    .map_err(sql)?;
    Ok(token)
}
fn valid_grant(db: &Connection, id: i32, token: &str, now: &str) -> DbResult<bool> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM grants g JOIN links l ON l.id=g.link_id WHERE g.token_hash=? AND g.link_id=? AND g.version=l.password_version AND g.expires_at>?)",params![token_hash(token),id,now],|r|r.get(0)).map_err(sql)
}
