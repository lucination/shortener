use crate::{
    dto::*,
    store::{DbResult, Store},
};
use rusqlite::{Connection, OptionalExtension, params};
use webauthn_rs::prelude::{
    Passkey, PasskeyAuthentication, PasskeyRegistration, PublicKeyCredential,
    RegisterPublicKeyCredential,
};
fn err(e: impl ToString) -> String {
    e.to_string()
}
pub fn webauthn(origin: &str) -> DbResult<webauthn_rs::Webauthn> {
    let url = url::Url::parse(origin).map_err(|e| e.to_string())?;
    webauthn_rs::WebauthnBuilder::new(url.host_str().ok_or("missing origin host")?, &url)
        .map_err(|e| e.to_string())?
        .rp_name("Shortener")
        .build()
        .map_err(|e| e.to_string())
}
impl Store {
    pub fn passkey_register_options(
        &self,
        w: &webauthn_rs::Webauthn,
        id: i32,
        now: &str,
    ) -> DbResult<PasskeyOptions> {
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            self.authorize(&tx, Some(id), now)?;
            let user = eligible(&tx, id)?;
            let keys = keys(&tx, id)?;
            let exclude = Some(keys.iter().map(|(_, key)| key.cred_id().clone()).collect());
            let uuid = uuid::Uuid::from_u128(id as u128);
            let (challenge, state) = w
                .start_passkey_registration(uuid, &user.email, &user.email, exclude)
                .map_err(err)?;
            let options = save_challenge(
                &tx,
                id,
                "register",
                &state,
                serde_json::to_value(challenge).map_err(err)?,
                now,
            )?;
            tx.commit().map_err(err)?;
            Ok(options)
        })
    }
    pub fn passkey_register_verify(
        &self,
        w: &webauthn_rs::Webauthn,
        id: i32,
        i: PasskeyVerify,
        now: &str,
    ) -> DbResult<()> {
        let (_, state) = self.take_challenge(&i.challenge_id, "register", Some(id), now)?;
        let state: PasskeyRegistration = serde_json::from_str(&state).map_err(err)?;
        let credential: RegisterPublicKeyCredential =
            serde_json::from_value(i.credential).map_err(err)?;
        let key = w
            .finish_passkey_registration(&credential, &state)
            .map_err(|_| "passkey verification failed")?;
        let credential_id = serde_json::to_string(key.cred_id()).map_err(err)?;
        let serialized = serde_json::to_string(&key).map_err(err)?;
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            self.authorize(&tx, Some(id), now)?;
            eligible(&tx, id)?;
            tx.execute(
                "INSERT INTO passkeys(user_id,credential_id,credential)VALUES(?,?,?)",
                params![id, credential_id, serialized],
            )
            .map_err(err)?;
            tx.commit().map_err(err)
        })
    }
    pub fn passkey_auth_options(
        &self,
        w: &webauthn_rs::Webauthn,
        email: &str,
        now: &str,
    ) -> DbResult<PasskeyOptions> {
        self.with(|db|{
  let id:i32=db.query_row("SELECT id FROM users WHERE email=? COLLATE NOCASE AND verified_at IS NOT NULL AND suspended=0 AND deleted_at IS NULL",[email.trim()],|r|r.get(0)).map_err(|_|"passkey authentication unavailable")?;
  let keys:Vec<Passkey>=keys(db,id)?.into_iter().map(|(_,k)|k).collect();if keys.is_empty(){return Err("passkey authentication unavailable".into());}
  let (challenge,state)=w.start_passkey_authentication(&keys).map_err(err)?;
  save_challenge(db,id,"authenticate",&state,serde_json::to_value(challenge).map_err(err)?,now)
 })
    }
    pub fn passkey_auth_verify(
        &self,
        w: &webauthn_rs::Webauthn,
        i: PasskeyVerify,
        now: &str,
    ) -> DbResult<(User, String)> {
        let (id, state) = self.take_challenge(&i.challenge_id, "authenticate", None, now)?;
        let state: PasskeyAuthentication = serde_json::from_str(&state).map_err(err)?;
        let credential: PublicKeyCredential = serde_json::from_value(i.credential).map_err(err)?;
        let result = w
            .finish_passkey_authentication(&credential, &state)
            .map_err(|_| "passkey verification failed")?;
        self.with(|db| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let user = eligible(&tx, id)?;
            let mut matched = false;
            for (key_id, mut key) in keys(&tx, id)? {
                if key.cred_id() == result.cred_id() {
                    let current: webauthn_rs::prelude::Credential = key.clone().into();
                    if result.counter() > 0 && result.counter() <= current.counter {
                        return Err("stale authenticator counter".into());
                    }
                }
                if let Some(_changed) = key.update_credential(&result) {
                    matched = true;
                    tx.execute(
                        "UPDATE passkeys SET credential=? WHERE id=?",
                        params![serde_json::to_string(&key).map_err(err)?, key_id],
                    )
                    .map_err(err)?;
                }
            }
            if !matched {
                return Err("credential unavailable".into());
            }
            let session = crate::store::insert_session(&tx, Some(id), now)?;
            tx.commit().map_err(err)?;
            Ok((user, session))
        })
    }
    fn take_challenge(
        &self,
        id: &str,
        kind: &str,
        user: Option<i32>,
        now: &str,
    ) -> DbResult<(i32, String)> {
        self.with(|db|db.query_row("DELETE FROM challenges WHERE id=? AND kind=? AND expires_at>? AND (? IS NULL OR user_id=?) RETURNING user_id,state",params![id,kind,now,user,user],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?.ok_or_else(||"invalid or expired challenge".into()))
    }
}
fn eligible(db: &Connection, id: i32) -> DbResult<User> {
    db.query_row("SELECT * FROM users WHERE id=? AND verified_at IS NOT NULL AND suspended=0 AND deleted_at IS NULL",[id],crate::store::user_row).map_err(|_|"account unavailable".into())
}
fn keys(db: &Connection, id: i32) -> DbResult<Vec<(i32, Passkey)>> {
    let rows: Vec<(i32, String)> = db
        .prepare("SELECT id,credential FROM passkeys WHERE user_id=?")
        .map_err(err)?
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    rows.into_iter()
        .map(|(id, s)| serde_json::from_str(&s).map(|key| (id, key)).map_err(err))
        .collect()
}
fn save_challenge(
    db: &Connection,
    id: i32,
    kind: &str,
    state: &impl serde::Serialize,
    challenge: serde_json::Value,
    now: &str,
) -> DbResult<PasskeyOptions> {
    let challenge_id = crate::store::random_token();
    let public_key = challenge
        .get("publicKey")
        .cloned()
        .ok_or("invalid challenge encoding")?;
    db.execute(
        "INSERT INTO challenges VALUES(?,?,?,?,?)",
        params![
            challenge_id,
            id,
            kind,
            serde_json::to_string(state).map_err(err)?,
            crate::store::expires(now, 300)?
        ],
    )
    .map_err(err)?;
    Ok(PasskeyOptions {
        challenge_id,
        public_key,
    })
}
