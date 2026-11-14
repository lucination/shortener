//! HTTP/session side effects. DTO decoding is not domain validation.
use axum::{Router,Json,extract::{State,Request},response::{IntoResponse,Response},routing::any,http::{StatusCode,HeaderMap,Method,header}};
use crate::{dto::*,store::Store};
#[derive(Clone)]
pub struct AppState {pub store:Store,pub origin:String,pub domain:String,pub admin_token:String,pub analytics_secret:String,pub static_dir:std::path::PathBuf,pub smtp_host:String,pub smtp_port:u16,pub smtp_from:String,pub trusted_proxies:Vec<std::net::IpAddr>}
impl AppState {
 pub fn new(store:Store)->Self {Self{store,origin:"http://localhost:3000".into(),domain:"example.com".into(),admin_token:"test-admin-token".into(),analytics_secret:"test-analytics-secret".into(),static_dir:"web/build".into(),smtp_host:"127.0.0.1".into(),smtp_port:1025,smtp_from:"login@example.com".into(),trusted_proxies:vec![]}}
 pub fn client_ip(&self,peer:Option<std::net::IpAddr>,h:&HeaderMap)->String{if peer.is_some_and(|p|self.trusted_proxies.contains(&p)){if let Some(ip)=h.get("x-forwarded-for").and_then(|v|v.to_str().ok()).and_then(|s|s.split(',').next()).and_then(|s|s.trim().parse::<std::net::IpAddr>().ok()){return ip.to_string();}}peer.map(|ip|ip.to_string()).unwrap_or_else(||"Unknown".into())}
}
pub async fn test_router()->Router{router(AppState::new(Store::open(":memory:","example.com").unwrap()))}
pub fn router(state:AppState)->Router {Router::new().route("/api/{*path}",any(api)).fallback(fallback).with_state(state)}
pub fn error(status:StatusCode,code:&str,message:&str)->Response{(status,Json(ErrorBody{code:code.into(),message:message.into()})).into_response()}
pub fn message(text:&str)->Response{Json(Message{message:text.into()}).into_response()}
pub(crate) fn origin_ok(s:&AppState,h:&HeaderMap)->bool {h.get("origin").and_then(|v|v.to_str().ok())==Some(s.origin.as_str()) && h.get("sec-fetch-site").and_then(|v|v.to_str().ok()).is_none_or(|v|matches!(v,"same-origin"|"none"))}
async fn api(State(s):State<AppState>,req:Request)->Response {
 if !matches!(*req.method(),Method::GET|Method::HEAD) && !origin_ok(&s,req.headers()){return error(StatusCode::FORBIDDEN,"origin","same-origin request required");}
 let (parts,body)=req.into_parts();
 let peer=parts.extensions.get::<axum::extract::ConnectInfo<std::net::SocketAddr>>().map(|p|p.0.ip());
 let bytes=match axum::body::to_bytes(body,1024*1024).await{Ok(b)=>b,Err(_)=>return error(StatusCode::PAYLOAD_TOO_LARGE,"body","request too large")};
 tokio::task::spawn_blocking(move||{let path=parts.uri.path();if parts.method==Method::POST&&(path=="/api/admin/login"||path.starts_with("/api/auth/")){let key=format!("auth:{}:{}",path,s.client_ip(peer,&parts.headers));let now=crate::domain::instant(chrono::Utc::now());if !s.store.rate_limit(&key,20,&now).unwrap_or(false){return error(StatusCode::TOO_MANY_REQUESTS,"rate_limit","try again later");}}api_sync(&s,&parts.method,parts.uri.path_and_query().map(|v|v.as_str()).unwrap_or(parts.uri.path()),&parts.headers,&bytes)}).await.unwrap_or_else(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"internal","request failed"))
}
fn decode<T:serde::de::DeserializeOwned>(body:&[u8])->Result<T,Response>{serde_json::from_slice(body).map_err(|_|error(StatusCode::UNPROCESSABLE_ENTITY,"validation","invalid JSON body"))}
pub(crate) fn cookie(h:&HeaderMap,name:&str)->Option<String>{h.get("cookie")?.to_str().ok()?.split(';').find_map(|s|{let (k,v)=s.trim().split_once('=')?;(k==name).then(||v.to_owned())})}
pub(crate) fn set_cookie(mut r:Response,s:&AppState,name:&str,token:&str,age:u32)->Response{let secure=if s.origin.starts_with("https://"){"; Secure"}else{""};r.headers_mut().append(header::SET_COOKIE,format!("{name}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{secure}").parse().unwrap());r}
fn db_error(e:String)->Response{if e.contains("not found")||e.contains("Query returned no rows"){error(StatusCode::NOT_FOUND,"not_found","not found")}else if e.contains("UNIQUE"){error(StatusCode::CONFLICT,"conflict","address or email already exists")}else{error(StatusCode::UNPROCESSABLE_ENTITY,"validation",if e.len()<200{&e}else{"invalid request"})}}
fn api_sync(s:&AppState,method:&Method,path:&str,h:&HeaderMap,body:&[u8])->Response{match api_result(s,method,path,h,body){Ok(r)=>r,Err(r)=>r}}
fn api_result(s:&AppState,method:&Method,path:&str,h:&HeaderMap,body:&[u8])->Result<Response,Response>{
 let (path,query)=path.split_once('?').unwrap_or((path,""));
 let now=crate::domain::instant(chrono::Utc::now());let db=&s.store;
 if path=="/api/admin/login" && *method==Method::POST {
  let input:TokenInput=decode(body)?;
  // HMAC verifier avoids content-dependent comparison of the configured secret.
  use hmac::{Hmac,Mac};use sha2::Sha256;
  let mut mac=Hmac::<Sha256>::new_from_slice(s.admin_token.as_bytes()).unwrap();mac.update(b"admin-login");let expected=mac.finalize().into_bytes();
  let mut attempt=Hmac::<Sha256>::new_from_slice(input.token.as_bytes()).unwrap();attempt.update(b"admin-login");
  if s.admin_token.len()<16 || attempt.verify_slice(&expected).is_err(){return Err(error(StatusCode::UNAUTHORIZED,"unauthorized","invalid administrator token"));}
  let token=db.admin_session(&now).map_err(db_error)?;return Ok(set_cookie(message("signed in"),s,"short_admin",&token,3600));
 }
 if path.starts_with("/api/admin/") {
  let token=cookie(h,"short_admin").ok_or_else(||error(StatusCode::UNAUTHORIZED,"unauthorized","administrator authentication required"))?;
  db.authenticate_admin(&token,&now).map_err(|_|error(StatusCode::UNAUTHORIZED,"unauthorized","administrator authentication required"))?;
  let scoped=db.admin_scope(&token,&now).map_err(|_|error(StatusCode::UNAUTHORIZED,"unauthorized","administrator authentication required"))?;let db=&scoped;
  match (method.as_str(),path){
   ("POST","/api/admin/logout")=>{db.logout(&token).map_err(db_error)?;return Ok(set_cookie(message("signed out"),s,"short_admin","",0));},
   ("GET","/api/admin/users")=>return Ok(Json(db.users().map_err(db_error)?).into_response()),
   ("GET","/api/admin/links")=>return Ok(Json(db.links(None).map_err(db_error)?).into_response()),
   ("GET","/api/admin/events")=>return Ok(Json(db.events(None).map_err(db_error)?).into_response()),
   ("GET","/api/admin/usage")=>return Ok(Json(db.usage().map_err(db_error)?).into_response()),
   ("POST","/api/admin/users")=>{let i:UserInput=decode(body)?;if i.link_quota.is_some_and(|q|q<0)||i.retention_days.is_some_and(|d|crate::domain::RetentionDays::parse(d).is_err()){return Err(error(StatusCode::UNPROCESSABLE_ENTITY,"validation","invalid quota or retention"));}let u=db.create_user(&i.email,&now).map_err(db_error)?;let u=db.patch_user(u.id,UserPatch{suspended:None,deleted:None,retention_days:Some(i.retention_days),link_quota:Some(i.link_quota)},&now).map_err(db_error)?;return Ok((StatusCode::CREATED,Json(u)).into_response());},
   _=>{}
  }
  let seg:Vec<_>=path.trim_matches('/').split('/').collect();
  if seg.len()>=4&&seg[..3]==["api","admin","users"] {
   let id:i32=seg[3].parse().map_err(|_|error(StatusCode::NOT_FOUND,"not_found","not found"))?;
   match(method.as_str(),seg.get(4).copied()){
    ("PATCH",None)=>return Ok(Json(db.patch_user(id,decode(body)?,&now).map_err(db_error)?).into_response()),
    ("DELETE",None)=>{db.patch_user(id,UserPatch{deleted:Some(true),..UserPatch::default()},&now).map_err(db_error)?;return Ok(message("account soft deleted"));},
    ("POST",Some("sign-out-everywhere"))=>{db.revoke_user(id).map_err(db_error)?;return Ok(message("all sessions revoked; passkeys preserved"));},
    _=>{}
   }
  }
  return Err(error(StatusCode::NOT_FOUND,"not_found","unknown administrator route"));
 }
 if path=="/api/auth/magic-link" && *method==Method::POST {
  let i:EmailInput=decode(body)?;
  if let Some(token)=db.issue_magic(&i.email,&now).map_err(db_error)?{
   use lettre::Transport;
   let mail=lettre::Message::builder().from(s.smtp_from.parse().map_err(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"smtp","mail unavailable"))?).to(i.email.parse().map_err(|_|error(StatusCode::UNPROCESSABLE_ENTITY,"validation","invalid email"))?).subject("Your sign-in link").body(format!("Sign in: {}/auth/verify?token={}\nExpires in 15 minutes. This link works once.",s.origin,token)).map_err(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"smtp","mail unavailable"))?;
   let transport=lettre::SmtpTransport::builder_dangerous(&s.smtp_host).port(s.smtp_port).timeout(Some(std::time::Duration::from_secs(5))).build();
   if let Err(e)=transport.send(&mail){tracing::warn!(error=%e,"SMTP delivery failed");}
  }
  return Ok(message("If this account is eligible, a sign-in link has been sent."));
 }
 if *method==Method::POST && path.starts_with("/api/auth/passkeys/authenticate/"){
  let w=crate::passkeys::webauthn(&s.origin).map_err(db_error)?;
  if path.ends_with("/options"){let i:EmailInput=decode(body)?;return Ok(Json(db.passkey_auth_options(&w,&i.email,&now).map_err(|_|error(StatusCode::UNAUTHORIZED,"unauthorized","passkey authentication unavailable"))?).into_response());}
  if path.ends_with("/verify"){let i:PasskeyVerify=decode(body)?;let(user,session)=db.passkey_auth_verify(&w,i,&now).map_err(|_|error(StatusCode::UNAUTHORIZED,"unauthorized","passkey verification failed"))?;return Ok(set_cookie(Json(user).into_response(),s,"short_session",&session,30*86400));}
 }
 let token=cookie(h,"short_session").ok_or_else(||error(StatusCode::UNAUTHORIZED,"unauthorized","authentication required"))?;
 let user=db.authenticate_user(&token,&now).map_err(|_|error(StatusCode::UNAUTHORIZED,"unauthorized","authentication required"))?;
 let scoped=db.user_scope(&token,&now).map_err(|_|error(StatusCode::UNAUTHORIZED,"unauthorized","authentication required"))?;let db=&scoped;
 let segments:Vec<_>=path.trim_matches('/').split('/').collect();
 match (method.as_str(),path){
  ("GET","/api/me")=>return Ok(Json(user).into_response()),
  ("POST","/api/auth/passkeys/register/options")=>{let w=crate::passkeys::webauthn(&s.origin).map_err(db_error)?;return Ok(Json(db.passkey_register_options(&w,user.id,&now).map_err(db_error)?).into_response());},
  ("POST","/api/auth/passkeys/register/verify")=>{let w=crate::passkeys::webauthn(&s.origin).map_err(db_error)?;db.passkey_register_verify(&w,user.id,decode(body)?,&now).map_err(|_|error(StatusCode::UNPROCESSABLE_ENTITY,"verification","passkey verification failed"))?;return Ok(message("passkey registered"));},
  ("POST","/api/auth/logout")=>{db.logout(&token).map_err(db_error)?;return Ok(set_cookie(message("signed out"),s,"short_session","",0));},
  ("POST","/api/account/sign-out-everywhere")=>{db.revoke_user(user.id).map_err(db_error)?;return Ok(set_cookie(message("all sessions revoked; passkeys preserved"),s,"short_session","",0));},
  ("PATCH","/api/account")=>{let p:AccountPatch=decode(body)?;return Ok(Json(db.patch_user(user.id,UserPatch{retention_days:p.retention_days,..UserPatch::default()},&now).map_err(db_error)?).into_response());},
  ("GET","/api/links")=>return Ok(Json(db.links(Some(user.id)).map_err(db_error)?).into_response()),
  ("POST","/api/links")=>{let i:LinkInput=decode(body)?;check_static_alias(s,&i).map_err(db_error)?;return Ok((StatusCode::CREATED,Json(db.create_link(user.id,i,&now).map_err(db_error)?)).into_response());},
  ("POST","/api/links/bulk")=>{let i:BulkInput=decode(body)?;if i.items.is_empty()||i.items.len()>500{return Err(error(StatusCode::UNPROCESSABLE_ENTITY,"validation","bulk creation requires 1..500 rows"));}let items=i.items.into_iter().enumerate().map(|(index,input)|match check_static_alias(s,&input).and_then(|_|db.create_link(user.id,input,&now)){Ok(link)=>BulkResult::Created{index:index as i32,link},Err(e)=>BulkResult::Failed{index:index as i32,error:ErrorBody{code:"validation".into(),message:if e.contains("UNIQUE"){"alias already exists".into()}else{e}}}}).collect();return Ok(Json(BulkResponse{items}).into_response());},
  ("POST","/api/links/bulk-update")=>return Ok(Json(db.bulk_update(user.id,decode(body)?,&now).map_err(db_error)?).into_response()),
  _=>{}
 }
 if segments.len()>=3 && segments[..2]==["api","links"] {
  let id:i32=segments[2].parse().map_err(|_|error(StatusCode::NOT_FOUND,"not_found","not found"))?;
  let link=db.link(id).map_err(db_error)?;if link.owner_id!=user.id||link.deleted_at.is_some(){return Err(error(StatusCode::NOT_FOUND,"not_found","not found"));}
  match (method.as_str(),segments.get(3).copied()){
   ("GET",None)=>return Ok(Json(link).into_response()),
   ("PATCH",None)=>return Ok(Json(db.patch_link(user.id,id,decode(body)?,&now).map_err(db_error)?).into_response()),
   ("DELETE",None)=>{db.delete_link(user.id,id,&now).map_err(db_error)?;return Ok(message("link deleted"));},
   ("GET",Some("events"))=>return Ok(Json(db.events(Some(id)).map_err(db_error)?).into_response()),
   ("GET",Some("stats"))=>{let q:std::collections::HashMap<String,String>=url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();let to=q.get("to").map(String::as_str).unwrap_or(&now[..10]);let default_from=(chrono::Utc::now().date_naive()-chrono::Duration::days(29)).to_string();let from=q.get("from").map(String::as_str).unwrap_or(&default_from);return Ok(Json(db.stats(id,from,to).map_err(db_error)?).into_response());},
   _=>{}
  }
 }
 Err(error(StatusCode::NOT_FOUND,"not_found","unknown API route"))
}

async fn fallback(State(s):State<AppState>,req:Request)->Response{
 let (parts,body)=req.into_parts();let bytes=match axum::body::to_bytes(body,16384).await{Ok(b)=>b,Err(_)=>return error(StatusCode::PAYLOAD_TOO_LARGE,"body","request too large")};
 let peer=parts.extensions.get::<axum::extract::ConnectInfo<std::net::SocketAddr>>().map(|p|p.0.ip());
 tokio::task::spawn_blocking(move||fallback_sync(&s,&parts.method,&parts.uri,&parts.headers,&bytes,peer)).await.unwrap_or_else(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"internal","request failed"))
}
pub(crate) fn html(status:StatusCode,body:String)->Response{(status,[(header::CONTENT_TYPE,"text/html; charset=utf-8"),(header::CACHE_CONTROL,"no-store"),(header::CONTENT_SECURITY_POLICY,"default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"),(header::REFERRER_POLICY,"no-referrer")],body).into_response()}
pub(crate) fn escape(s:&str)->String{s.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;").replace('\'',"&#39;")}
fn shell(s:&AppState,status:StatusCode)->Response{let body=std::fs::read_to_string(s.static_dir.join("index.html")).unwrap_or_else(|_|"<!doctype html><html><body><h1>Shortener</h1><p>Not found</p></body></html>".into());html(status,body)}
fn redirect(location:&str)->Response{(StatusCode::FOUND,[(header::LOCATION,location),(header::CACHE_CONTROL,"no-store"),(header::REFERRER_POLICY,"no-referrer")]).into_response()}
fn fallback_sync(s:&AppState,method:&Method,uri:&axum::http::Uri,h:&HeaderMap,body:&[u8],peer:Option<std::net::IpAddr>)->Response{
 let path=uri.path();let now=crate::domain::instant(chrono::Utc::now());
 if path=="/auth/verify" && *method==Method::GET {
  let q:std::collections::HashMap<String,String>=url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes()).into_owned().collect();
  return match q.get("token").and_then(|t|s.store.consume_magic(t,&now).ok()){Some((_,token))=>{let mut r=redirect("/");*r.status_mut()=StatusCode::SEE_OTHER;set_cookie(r,s,"short_session",&token,30*86400)},None=>shell(s,StatusCode::NOT_FOUND)};
 }
 let request_parts:Vec<_>=path.trim_matches('/').split('/').collect();
 let continuation=*method==Method::POST&&request_parts.len()==3&&request_parts[0]=="v"&&request_parts[2]=="continue";
 let unlock=*method==Method::POST&&request_parts.len()==3&&request_parts[0]=="v"&&request_parts[2]=="unlock";
 if continuation||unlock {
  if !origin_ok(s,h){return error(StatusCode::FORBIDDEN,"origin","same-origin request required");}
  if unlock {
   if s.store.lookup(request_parts[1],&now).is_err(){return shell(s,StatusCode::NOT_FOUND);}
   if !s.store.rate_limit(&format!("unlock:{}:{}",request_parts[1],s.client_ip(peer,h)),20,&now).unwrap_or(false){return error(StatusCode::TOO_MANY_REQUESTS,"rate_limit","try again later");}
   let form:std::collections::HashMap<String,String>=url::form_urlencoded::parse(body).into_owned().collect();
   return match s.store.unlock(request_parts[1],form.get("password").map(String::as_str).unwrap_or(""),&now){Ok((id,token))=>{let location=format!("/v/{}{}",request_parts[1],uri.query().map(|q|format!("?{q}")).unwrap_or_default());let mut r=redirect(&location);*r.status_mut()=StatusCode::SEE_OTHER;set_cookie(r,s,&format!("short_grant_{id}"),&token,15*60)},Err(_)=>html(StatusCode::UNAUTHORIZED,"<!doctype html><h1>Unable to unlock link</h1>".into())};
  }
 }else if *method!=Method::GET && *method!=Method::HEAD{return shell(s,StatusCode::NOT_FOUND);}
 if path=="/" || path=="/_" || path.starts_with("/_/"){return shell(s,StatusCode::OK);}
 if path.starts_with("/auth/") || path.starts_with("/api/"){return shell(s,StatusCode::NOT_FOUND);}
 // Canonicalized existing files beat aliases. Missing assets must not receive HTML.
 let relative=path.trim_start_matches('/');
 if !relative.split('/').any(|p|p==".."||p==".") && !relative.contains('%') {
  let file=s.static_dir.join(relative);
  if let (Ok(root),Ok(full))=(s.static_dir.canonicalize(),file.canonicalize()) {
   if full.starts_with(root)&&full.is_file(){if let Ok(bytes)=std::fs::read(&full){let mime=match full.extension().and_then(|v|v.to_str()).unwrap_or(""){"js"=>"text/javascript","css"=>"text/css","svg"=>"image/svg+xml","png"=>"image/png","ico"=>"image/x-icon","woff2"=>"font/woff2","json"=>"application/json","html"=>"text/html; charset=utf-8",_=>"application/octet-stream"};return (StatusCode::OK,[(header::CONTENT_TYPE,mime)],bytes).into_response();}}
  }
 }
 let parts:Vec<_>=relative.split('/').collect();let preview=parts.len()==2&&parts[0]=="v";
 let code=if preview||continuation{parts[1]}else if parts.len()==1&&!relative.contains('.') {relative}else{return if relative.contains('.')||path.starts_with("/_app/")||path.starts_with("/assets/")||path.starts_with("/fonts/") {StatusCode::NOT_FOUND.into_response()}else{shell(s,StatusCode::NOT_FOUND)}};
 let link=match s.store.lookup(code,&now){Ok(l)=>l,Err(_)=>return shell(s,StatusCode::NOT_FOUND)};
 let grant=cookie(h,&format!("short_grant_{}",link.id));
 use crate::domain::{LinkPolicy,OwnerState,GrantStatus,VisitIntent,VisitDecision};
 let proof=if grant.as_deref().is_some_and(|g|s.store.check_grant(link.id,g,&now).unwrap_or(false)){GrantStatus::Verified}else{GrantStatus::Missing};
 let intent=if continuation{VisitIntent::Continue}else if preview{VisitIntent::Preview}else{VisitIntent::Resolve};
 let decision=LinkPolicy::observe(&link,OwnerState::Active,chrono::Utc::now()).map(|p|p.decide(proof,intent)).unwrap_or(VisitDecision::Hidden);
 let query=uri.query().map(|q|format!("?{}",escape(q))).unwrap_or_default();
 if decision==VisitDecision::Hidden{return shell(s,StatusCode::NOT_FOUND);}
 if decision==VisitDecision::PasswordRequired{return html(StatusCode::OK,format!("<!doctype html><title>Protected link</title><h1>Password required</h1><form method=post action=\"/v/{}/unlock{}\"><input name=password type=password required autocomplete=current-password><button>Unlock</button></form>",escape(code),query));}
 if matches!(decision,VisitDecision::Preview(_)) {
  let o=observation(h,s.client_ip(peer,h));let _=s.store.record_event(&link,link.addresses[0].id,EventKind::Preview,&o,&now,&s.analytics_secret);
  return html(StatusCode::OK,format!("<!doctype html><title>Preview</title><h1>{}</h1><p>{}</p><p>{}</p><form method=post action=\"/v/{}/continue{}\"><button>Continue</button></form>",escape(link.title.as_deref().unwrap_or("Link preview")),escape(link.description.as_deref().unwrap_or("")),escape(&link.destination),escape(code),query));
 }
 let o=observation(h,s.client_ip(peer,h));let kind=crate::analytics::classify(&o.user_agent);
 match s.store.claim_authorized_now(code,kind==EventKind::Human,grant.as_deref()){Ok(link)=>{let event_now=crate::domain::instant(chrono::Utc::now());let _=s.store.record_event(&link,link.addresses[0].id,kind,&o,&event_now,&s.analytics_secret);match crate::domain::merge_query(&link.destination,uri.query().unwrap_or(""),link.query_mode){Ok(destination)=>redirect(&destination),Err(_)=>shell(s,StatusCode::NOT_FOUND)}},Err(_)=>shell(s,StatusCode::NOT_FOUND)}
}
fn observation(h:&HeaderMap,ip:String)->crate::analytics::Observation{crate::analytics::Observation{ip,user_agent:h.get("user-agent").and_then(|v|v.to_str().ok()).unwrap_or("").chars().take(2048).collect(),referrer:h.get("referer").and_then(|v|v.to_str().ok()).map(|s|s.chars().take(8192).collect())}}
fn check_static_alias(s:&AppState,i:&LinkInput)->Result<(),String>{if let Some(alias)=&i.alias{crate::domain::Alias::parse(alias)?;if s.static_dir.join(alias).exists(){return Err("alias collides with a static file or directory".into());}}Ok(())}
