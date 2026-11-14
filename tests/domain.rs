use shortener::domain;
#[test]
fn destination_rejects_non_http_schemes_and_credentials() {
    assert!(domain::destination("javascript:alert(1)").is_err());
    assert!(domain::destination("ftp://example.com").is_err());
    assert!(domain::destination("https://user:secret@example.com").is_err());
    assert_eq!(domain::destination("http://127.0.0.1/private").unwrap(), "http://127.0.0.1/private");
}
#[test]
fn smart_constructors_reject_illegal_values() {
 use domain::*;
 for alias in ["api","auth","v","index.html","_app","has/slash",""]{assert!(Alias::parse(alias).is_err(),"{alias}");}
 assert!(Alias::parse("My-Link_1").is_ok());
 for n in [-1,0]{assert!(ClickLimit::parse(n).is_err());assert!(RetentionDays::parse(n).is_err());}
 assert!(RetentionDays::parse(3651).is_err());assert_eq!(ClickLimit::parse(1).unwrap().get(),1);
}
#[test]
fn query_modes_preserve_repeated_values_without_clobbering_destination() {
 use shortener::dto::QueryMode::*;
 assert_eq!(domain::merge_query("https://e.test/x?a=1&a=2#f","a=9&b=3&b=4",Discard).unwrap(),"https://e.test/x?a=1&a=2#f");
 assert_eq!(domain::merge_query("https://e.test/x?a=1&a=2#f","a=9&b=3&b=4",Preserve).unwrap(),"https://e.test/x?a=1&a=2&b=3&b=4#f");
 assert_eq!(domain::merge_query("https://e.test/x?a=1&a=2#f","a=9&b=3&b=4",Override).unwrap(),"https://e.test/x?a=9&b=3&b=4#f");
}
#[test]
fn lifecycle_decisions_are_exhaustive_and_password_precedes_disclosure(){
 use domain::*;
 let now=parse_instant("2026-11-14T17:00:00Z").unwrap();
 let mut l:shortener::dto::Link=serde_json::from_value(serde_json::json!({"id":1,"owner_id":1,"destination":"https://example.test/","title":null,"description":null,"enabled":true,"deleted_at":null,"expires_at":null,"click_limit":null,"human_clicks":0,"password_protected":false,"interstitial":false,"query_mode":"discard","retention_days":null,"created_at":"2026-11-14T17:00:00Z","addresses":[]})).unwrap();
 let p=LinkPolicy::observe(&l,OwnerState::Active,now).unwrap();let d=Destination::parse(&l.destination).unwrap();assert_eq!(p.decide(GrantStatus::Missing,VisitIntent::Resolve),VisitDecision::Outgoing(d.clone()));assert_eq!(p.decide(GrantStatus::Missing,VisitIntent::Preview),VisitDecision::Preview(d.clone()));
 l.password_protected=true;l.interstitial=true;let p=LinkPolicy::observe(&l,OwnerState::Active,now).unwrap();assert_eq!(p.decide(GrantStatus::Missing,VisitIntent::Preview),VisitDecision::PasswordRequired);assert_eq!(p.decide(GrantStatus::Verified,VisitIntent::Resolve),VisitDecision::Preview(d.clone()));assert_eq!(p.decide(GrantStatus::Verified,VisitIntent::Continue),VisitDecision::Outgoing(d));
 for owner in [OwnerState::Suspended,OwnerState::Deleted]{assert_eq!(LinkPolicy::observe(&l,owner,now).unwrap().decide(GrantStatus::Verified,VisitIntent::Continue),VisitDecision::Hidden);}
 l.expires_at=Some("2026-11-14T16:59:59Z".into());assert_eq!(LinkPolicy::observe(&l,OwnerState::Active,now).unwrap().decide(GrantStatus::Verified,VisitIntent::Continue),VisitDecision::Hidden);
 l.expires_at=None;l.click_limit=Some(2);l.human_clicks=2;assert_eq!(LinkPolicy::observe(&l,OwnerState::Active,now).unwrap().decide(GrantStatus::Verified,VisitIntent::Continue),VisitDecision::Hidden);
}
