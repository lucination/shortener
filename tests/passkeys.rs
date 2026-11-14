use shortener::{store::Store,dto::*,passkeys::webauthn};
use webauthn_authenticator_rs::{WebauthnAuthenticator,softpasskey::SoftPasskey};
const NOW:&str="2026-11-14T17:00:00.000Z";
#[test]
fn actual_webauthn_registration_authentication_replay_and_revocation_preserve_passkey(){
 let db=Store::open(":memory:","example.com").unwrap();let u=db.create_user("passkey@example.test",NOW).unwrap();let token=db.issue_magic(&u.email,NOW).unwrap().unwrap();db.consume_magic(&token,NOW).unwrap();
 let w=webauthn("http://localhost:3000").unwrap();let origin=url::Url::parse("http://localhost:3000").unwrap();let mut auth=WebauthnAuthenticator::new(SoftPasskey::new(true));
 let options=db.passkey_register_options(&w,u.id,NOW).unwrap();assert!(options.public_key.get("challenge").is_some());
 let ccr=serde_json::from_value(serde_json::json!({"publicKey":options.public_key})).unwrap();let credential=auth.do_registration(origin.clone(),ccr).unwrap();
 let verify=PasskeyVerify{challenge_id:options.challenge_id,credential:serde_json::to_value(credential).unwrap()};db.passkey_register_verify(&w,u.id,verify.clone(),NOW).unwrap();assert!(db.passkey_register_verify(&w,u.id,verify,NOW).is_err());
 db.revoke_user(u.id).unwrap();
 let options=db.passkey_auth_options(&w,&u.email,NOW).unwrap();let rcr=serde_json::from_value(serde_json::json!({"publicKey":options.public_key})).unwrap();let credential=auth.do_authentication(origin,rcr).unwrap();
 let verify=PasskeyVerify{challenge_id:options.challenge_id,credential:serde_json::to_value(credential).unwrap()};let(user,session)=db.passkey_auth_verify(&w,verify.clone(),NOW).unwrap();assert_eq!(user.id,u.id);assert_eq!(db.authenticate_user(&session,NOW).unwrap().id,u.id);assert!(db.passkey_auth_verify(&w,verify,NOW).is_err());
 let a=db.passkey_auth_options(&w,&u.email,NOW).unwrap();let b=db.passkey_auth_options(&w,&u.email,NOW).unwrap();
 let ar=auth.do_authentication(url::Url::parse("http://localhost:3000").unwrap(),serde_json::from_value(serde_json::json!({"publicKey":a.public_key})).unwrap()).unwrap();
 let br=auth.do_authentication(url::Url::parse("http://localhost:3000").unwrap(),serde_json::from_value(serde_json::json!({"publicKey":b.public_key})).unwrap()).unwrap();
 db.passkey_auth_verify(&w,PasskeyVerify{challenge_id:b.challenge_id,credential:serde_json::to_value(br).unwrap()},NOW).unwrap();
 assert!(db.passkey_auth_verify(&w,PasskeyVerify{challenge_id:a.challenge_id,credential:serde_json::to_value(ar).unwrap()},NOW).is_err(),"stale snapshot must not roll back an already advanced credential counter");
}
