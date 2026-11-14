use shortener::{store::Store,dto::*,analytics::Observation};
#[test]
fn cleanup_keeps_permanent_aggregates_and_obeys_link_account_global_precedence(){
 let db=Store::open(":memory:","example.com").unwrap();let now="2026-11-14T00:00:00.000Z";let u=db.create_user("retention@example.test",now).unwrap();
 let input:LinkInput=serde_json::from_value(serde_json::json!({"destination":"https://a.test","alias":"retained","retention_days":1})).unwrap();let l=db.create_link(u.id,input,now).unwrap();let o=Observation{ip:"192.0.2.4".into(),user_agent:"Firefox/1 Linux".into(),referrer:None};
 db.record_event(&l,l.addresses[0].id,EventKind::Human,&o,now,"test-secret").unwrap();db.record_event(&l,l.addresses[0].id,EventKind::Human,&o,now,"test-secret").unwrap();
 assert_eq!(db.stats(l.id,"2026-11-14","2026-11-14").unwrap().daily[0].daily_unique,1);
 assert_eq!(db.cleanup("2026-11-16T00:00:00.000Z",90).unwrap(),2);assert_eq!(db.events(Some(l.id)).unwrap().total,0);assert_eq!(db.stats(l.id,"2026-11-14","2026-11-14").unwrap().humans,2);
 db.patch_user(u.id,UserPatch{retention_days:Some(Some(3)),..UserPatch::default()},now).unwrap();
 let a=db.create_link(u.id,serde_json::from_value(serde_json::json!({"destination":"https://a.test","alias":"account-retained"})).unwrap(),now).unwrap();db.record_event(&a,a.addresses[0].id,EventKind::Human,&o,now,"test-secret").unwrap();
 assert_eq!(db.cleanup("2026-11-16T00:00:00.000Z",1).unwrap(),0,"account retention overrides global");
 db.patch_user(u.id,UserPatch{retention_days:Some(Some(1)),..UserPatch::default()},now).unwrap();assert_eq!(db.cleanup("2026-11-16T00:00:00.000Z",90).unwrap(),1,"changed setting applies next cleanup");
 db.patch_user(u.id,UserPatch{retention_days:Some(None),..UserPatch::default()},now).unwrap();db.record_event(&a,a.addresses[0].id,EventKind::Human,&o,now,"test-secret").unwrap();assert_eq!(db.cleanup("2026-11-16T00:00:00.000Z",90).unwrap(),0,"global retention is fallback");
}
