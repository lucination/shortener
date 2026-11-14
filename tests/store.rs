use shortener::{store::Store,dto::*};
const NOW:&str="2026-11-14T17:00:00.000Z";
fn input(alias:&str)->LinkInput { serde_json::from_value(serde_json::json!({"destination":"https://example.com/path?a=1","alias":alias})).unwrap() }
#[test]
fn creates_owned_link_with_immutable_domain_scoped_address() {
 let db=Store::open(":memory:","example.com").unwrap();
 let user=db.create_user("test@example.test",NOW).unwrap();
 let link=db.create_link(user.id,input("hello"),NOW).unwrap();
 assert_eq!(link.owner_id,user.id); assert_eq!(link.addresses[0].short_code,"hello");
 assert_eq!(link.addresses[0].domain,"example.com");
 assert!(db.create_link(user.id,input("hello"),NOW).is_err());
 assert!(db.create_link(user.id,input("index.html"),NOW).is_err());
}

#[test]
fn claims_human_click_limit_atomically_bots_do_not_consume() {
 let file=tempfile::NamedTempFile::new().unwrap();let path=file.path().to_str().unwrap();
 let db=Store::open(path,"example.com").unwrap();let user=db.create_user("race@example.test",NOW).unwrap();
 let mut i=input("race");i.click_limit=Some(3);let link=db.create_link(user.id,i,NOW).unwrap();
 let handles:Vec<_>=(0..12).map(|_|{let path=path.to_string();std::thread::spawn(move||Store::open(&path,"example.com").unwrap().claim_redirect("race",true,NOW).is_ok())}).collect();
 let won=handles.into_iter().filter_map(|h|h.join().ok()).filter(|b|*b).count();assert_eq!(won,3);
 assert_eq!(db.link(link.id).unwrap().human_clicks,3);
 assert!(db.claim_redirect("race",false,NOW).is_err(),"already exhausted links are hidden even from bots");
 let bot=db.create_link(user.id,input("bot"),NOW).unwrap();
 assert!(db.claim_redirect("bot",false,NOW).is_ok());assert_eq!(db.link(bot.id).unwrap().human_clicks,0);
}

#[test]
fn patch_null_clears_omitted_preserves_and_deleted_alias_is_never_reused() {
 let db=Store::open(":memory:","example.com").unwrap();let u=db.create_user("patch@example.test",NOW).unwrap();
 let mut i=input("stable");i.title=Some("keep".into());i.description=Some("clear".into());
 let l=db.create_link(u.id,i,NOW).unwrap();
 let patch:LinkPatch=serde_json::from_value(serde_json::json!({"description":null})).unwrap();
 let l=db.patch_link(u.id,l.id,patch,NOW).unwrap();assert_eq!(l.title.as_deref(),Some("keep"));assert_eq!(l.description,None);
 assert!(db.patch_link(u.id+1,l.id,LinkPatch::default(),NOW).is_err());
 db.delete_link(u.id,l.id,NOW).unwrap();assert!(db.claim_redirect("stable",true,NOW).is_err());
 assert!(db.create_link(u.id,input("stable"),NOW).is_err());
}
#[test]
fn quota_expiry_retention_constructors_and_bulk_ownership_fail_closed(){
 let db=Store::open(":memory:","example.com").unwrap();let a=db.create_user("a@example.test",NOW).unwrap();let b=db.create_user("b@example.test",NOW).unwrap();
 db.patch_user(a.id,UserPatch{link_quota:Some(Some(1)),..UserPatch::default()},NOW).unwrap();let l=db.create_link(a.id,input("quota"),NOW).unwrap();assert!(db.create_link(a.id,input("full"),NOW).is_err());
 let other=db.create_link(b.id,input("other"),NOW).unwrap();assert!(db.bulk_update(a.id,BulkUpdate{ids:vec![l.id,other.id],action:BulkAction::Disable},NOW).is_err());assert!(db.link(l.id).unwrap().enabled);
 let p:LinkPatch=serde_json::from_value(serde_json::json!({"expires_at":"2026-11-14T16:00:00Z"})).unwrap();db.patch_link(a.id,l.id,p,NOW).unwrap();assert!(db.claim_redirect("quota",true,NOW).is_err());
 for invalid in [serde_json::json!({"click_limit":0}),serde_json::json!({"retention_days":0}),serde_json::json!({"retention_days":3651}),serde_json::json!({"expires_at":"not-time"})]{let p:LinkPatch=serde_json::from_value(invalid).unwrap();assert!(db.patch_link(a.id,l.id,p,NOW).is_err());}
}
