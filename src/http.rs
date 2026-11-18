//! HTTP/session side effects. DTO decoding is not domain validation.
use crate::{dto::*, store::Store};
use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
/// Which client-IP assertion an explicitly admitted immediate proxy may supply.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClientIpHeader {
    #[default]
    XForwardedFor,
    CfConnectingIp,
}
impl ClientIpHeader {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value {
            None | Some("x-forwarded-for") => Ok(Self::XForwardedFor),
            Some("cf-connecting-ip") => Ok(Self::CfConnectingIp),
            Some(_) => Err("CLIENT_IP_HEADER must be x-forwarded-for or cf-connecting-ip".into()),
        }
    }
}
#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub origin: String,
    pub domain: String,
    pub admin_token: String,
    pub analytics_secret: String,
    pub static_dir: std::path::PathBuf,
    pub smtp: crate::smtp::SmtpConfig,
    pub smtp_from: String,
    pub trusted_proxies: Vec<std::net::IpAddr>,
    pub client_ip_header: ClientIpHeader,
    pub dev_vite_origin: Option<String>,
    pub global_retention_days: i32,
    pub geoip: crate::geoip::GeoIp,
}
impl AppState {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            origin: "http://localhost:3000".into(),
            domain: "example.com".into(),
            admin_token: "test-admin-token".into(),
            analytics_secret: "test-analytics-secret".into(),
            static_dir: "web/build".into(),
            smtp: crate::smtp::SmtpConfig::parse("127.0.0.1", "1025", None, None, None)
                .expect("local SMTP defaults"),
            smtp_from: "login@example.com".into(),
            trusted_proxies: vec![],
            client_ip_header: ClientIpHeader::default(),
            dev_vite_origin: None,
            global_retention_days: 90,
            geoip: crate::geoip::GeoIp::default(),
        }
    }
    pub fn configure_dev_proxy(
        &mut self,
        origin: &str,
        environment: &loco_rs::environment::Environment,
    ) -> Result<(), String> {
        if *environment != loco_rs::environment::Environment::Development {
            return Err("DEV_VITE_ORIGIN is forbidden outside development".into());
        }
        let u = url::Url::parse(origin).map_err(|_| "invalid development Vite origin")?;
        if u.scheme() != "http"
            || !matches!(u.host_str(), Some("127.0.0.1" | "[::1]"))
            || matches!(u.port_or_known_default(), None | Some(3000 | 3001))
            || u.path() != "/"
            || u.query().is_some()
            || u.fragment().is_some()
            || !u.username().is_empty()
            || u.password().is_some()
        {
            return Err("Vite development origin must be loopback HTTP without credentials/path and cannot point to the gateway/backend".into());
        }
        self.dev_vite_origin = Some(u.to_string());
        Ok(())
    }
    pub fn client_ip(&self, peer: Option<std::net::IpAddr>, h: &HeaderMap) -> String {
        if peer.is_some_and(|p| self.trusted_proxies.contains(&p)) {
            let ip = match self.client_ip_header {
                ClientIpHeader::XForwardedFor => h
                    .get("x-forwarded-for")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.split(',').next())
                    .and_then(|s| s.trim().parse::<std::net::IpAddr>().ok()),
                ClientIpHeader::CfConnectingIp => {
                    let mut values = h.get_all("cf-connecting-ip").iter();
                    let first = values.next();
                    if values.next().is_some() {
                        None
                    } else {
                        first
                            .and_then(|v| v.to_str().ok())
                            .and_then(|s| s.trim().parse::<std::net::IpAddr>().ok())
                    }
                }
            };
            if let Some(ip) = ip {
                return ip.to_string();
            }
        }
        peer.map(|ip| ip.to_string())
            .unwrap_or_else(|| "Unknown".into())
    }
    pub fn known_alias_host(&self, peer: Option<std::net::IpAddr>, h: &HeaderMap) -> bool {
        let forwarded = if peer.is_some_and(|p| self.trusted_proxies.contains(&p)) {
            h.get("x-forwarded-host")
        } else {
            None
        };
        let host = forwarded
            .or_else(|| h.get("host"))
            .and_then(|v| v.to_str().ok())
            .and_then(|v| crate::domain::HostName::parse(v).ok());
        let app_host = url::Url::parse(&self.origin)
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned));
        match host {
            Some(host) => {
                host.as_str() == self.domain || app_host.as_deref() == Some(host.as_str())
            }
            None => {
                h.get("host").is_none()
                    && forwarded.is_none()
                    && matches!(
                        app_host.as_deref(),
                        Some("localhost" | "127.0.0.1" | "[::1]")
                    )
            }
        }
    }
}
pub async fn test_router() -> Router {
    router(AppState::new(
        Store::open(":memory:", "example.com").unwrap(),
    ))
}
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/{*path}", any(api))
        .route("/_/api/{*path}", any(api))
        .fallback(fallback)
        .with_state(state)
}
pub fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(ErrorBody {
            code: code.into(),
            message: message.into(),
        }),
    )
        .into_response()
}
pub fn message(text: &str) -> Response {
    Json(Message {
        message: text.into(),
    })
    .into_response()
}
pub(crate) fn origin_ok(s: &AppState, h: &HeaderMap) -> bool {
    h.get("origin").and_then(|v| v.to_str().ok()) == Some(s.origin.as_str())
        && h.get("sec-fetch-site")
            .and_then(|v| v.to_str().ok())
            .is_none_or(|v| matches!(v, "same-origin" | "none"))
}
// Only this route can replace cookie authority; malformed credentials fail closed.
fn creation_authorization(method: &Method, path: &str, h: &HeaderMap) -> bool {
    *method == Method::POST && path == "/api/links" && h.contains_key(header::AUTHORIZATION)
}
fn access_bearer(h: &HeaderMap) -> Option<&str> {
    if h.get_all(header::AUTHORIZATION).iter().count() != 1 {
        return None;
    }
    h.get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}
async fn api(State(s): State<AppState>, req: Request) -> Response {
    if !matches!(*req.method(), Method::GET | Method::HEAD)
        && !creation_authorization(req.method(), req.uri().path(), req.headers())
        && !origin_ok(&s, req.headers())
    {
        return error(
            StatusCode::FORBIDDEN,
            "origin",
            "same-origin request required",
        );
    }
    let (parts, body) = req.into_parts();
    let peer = parts
        .extensions
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|p| p.0.ip());
    let bytes = match axum::body::to_bytes(body, 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return error(StatusCode::PAYLOAD_TOO_LARGE, "body", "request too large"),
    };
    tokio::task::spawn_blocking(move || {
        let path = parts.uri.path();
        // Validate the operation before allocating persistent limiter state.
        let auth_operation = match path {
            "/_/api/login" => Some("/_/api/login"),
            "/api/auth/magic-link" => Some("/api/auth/magic-link"),
            "/api/auth/logout" => Some("/api/auth/logout"),
            "/api/auth/passkeys/authenticate/options" => {
                Some("/api/auth/passkeys/authenticate/options")
            }
            "/api/auth/passkeys/authenticate/verify" => {
                Some("/api/auth/passkeys/authenticate/verify")
            }
            "/api/auth/passkeys/register/options" => Some("/api/auth/passkeys/register/options"),
            "/api/auth/passkeys/register/verify" => Some("/api/auth/passkeys/register/verify"),
            _ if path.starts_with("/api/auth/") => {
                return error(
                    StatusCode::NOT_FOUND,
                    "not_found",
                    "unknown authentication route",
                );
            }
            _ => None,
        };
        if let Some(operation) = auth_operation.filter(|_| parts.method == Method::POST) {
            let key = format!("auth:{}:{}", operation, s.client_ip(peer, &parts.headers));
            let now = crate::domain::instant(chrono::Utc::now());
            if !s.store.rate_limit(&key, 20, &now).unwrap_or(false) {
                return error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "rate_limit",
                    "try again later",
                );
            }
        }
        api_sync(
            &s,
            &parts.method,
            parts
                .uri
                .path_and_query()
                .map(|v| v.as_str())
                .unwrap_or(parts.uri.path()),
            &parts.headers,
            &bytes,
        )
    })
    .await
    .unwrap_or_else(|_| {
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "request failed",
        )
    })
}
fn decode<T: serde::de::DeserializeOwned>(body: &[u8]) -> Result<T, Response> {
    serde_json::from_slice(body)
        .map_err(|_| error(StatusCode::BAD_REQUEST, "malformed", "invalid JSON body"))
}
pub(crate) fn cookie(h: &HeaderMap, name: &str) -> Option<String> {
    h.get("cookie")?.to_str().ok()?.split(';').find_map(|s| {
        let (k, v) = s.trim().split_once('=')?;
        (k == name).then(|| v.to_owned())
    })
}
pub(crate) fn set_cookie(
    mut r: Response,
    s: &AppState,
    name: &str,
    token: &str,
    age: u32,
) -> Response {
    let secure = if s.origin.starts_with("https://") {
        "; Secure"
    } else {
        ""
    };
    r.headers_mut().append(
        header::SET_COOKIE,
        format!("{name}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{secure}")
            .parse()
            .unwrap(),
    );
    r
}
fn db_error(e: String) -> Response {
    if e == "create rate limit exceeded" {
        error(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limit",
            "try again later",
        )
    } else if e == "session no longer authorized" {
        error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "authentication required",
        )
    } else if e.contains("not found") || e.contains("Query returned no rows") {
        error(StatusCode::NOT_FOUND, "not_found", "not found")
    } else if e.contains("UNIQUE") {
        error(
            StatusCode::CONFLICT,
            "conflict",
            "address or email already exists",
        )
    } else {
        error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation",
            if e.len() < 200 { &e } else { "invalid request" },
        )
    }
}
fn authority_error(db: &Store, h: &HeaderMap, now: &str, want_admin: bool) -> Response {
    let wrong = if want_admin {
        cookie(h, "short_session").is_some_and(|t| db.authenticate_user(&t, now).is_ok())
    } else {
        cookie(h, "short_admin").is_some_and(|t| db.authenticate_admin(&t, now).is_ok())
    };
    if wrong {
        error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "wrong authentication authority",
        )
    } else {
        error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "authentication required",
        )
    }
}
fn api_sync(s: &AppState, method: &Method, path: &str, h: &HeaderMap, body: &[u8]) -> Response {
    let mut response = match api_result(s, method, path, h, body) {
        Ok(r) => r,
        Err(r) => r,
    };
    if path
        .split('?')
        .next()
        .is_some_and(|p| p == "/api/account/tokens" || p.starts_with("/api/account/tokens/"))
    {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-store"),
        );
    }
    if path
        .split('?')
        .next()
        .and_then(|p| p.strip_prefix("/api/links/"))
        .is_some_and(|tail| matches!(tail.split('/').nth(1), Some("stats" | "events")))
    {
        // Both views of the creator statistics page, including denials.
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-store"),
        );
    }
    response
}
type ApiResult = Result<Response, Response>;
/// One decoded API request. `path` excludes the query string.
struct ApiRequest<'a> {
    s: &'a AppState,
    method: &'a Method,
    path: &'a str,
    query: &'a str,
    h: &'a HeaderMap,
    body: &'a [u8],
    now: String,
}
fn unauthorized(message: &str) -> Response {
    error(StatusCode::UNAUTHORIZED, "unauthorized", message)
}
fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "not_found", "not found")
}
/// Authority precedence: any Authorization header ⇒ Bearer create only (never a
/// cookie fallback); then the unauthenticated admin login; then the admin cookie
/// namespace; then unauthenticated user auth ceremonies; then the user cookie.
fn api_result(s: &AppState, method: &Method, path: &str, h: &HeaderMap, body: &[u8]) -> ApiResult {
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    let r = ApiRequest {
        s,
        method,
        path,
        query,
        h,
        body,
        now: crate::domain::instant(chrono::Utc::now()),
    };
    if h.contains_key(header::AUTHORIZATION) {
        return bearer_create(&r);
    }
    if path == "/_/api/login" && *method == Method::POST {
        return admin_login(&r);
    }
    if path.starts_with("/_/api/") {
        let (token, db) = admin_authority(&r)?;
        return admin_api(&r, &db, &token);
    }
    if let Some(response) = public_auth(&r) {
        return response;
    }
    let user = user_authority(&r)?;
    user_api(&r, &user)
}

// ---- Bearer access token: exact POST /api/links only ----

fn bearer_create(r: &ApiRequest) -> ApiResult {
    if !creation_authorization(r.method, r.path, r.h) {
        return Err(unauthorized("create-only access token required"));
    }
    let bearer = access_bearer(r.h).ok_or_else(|| unauthorized("invalid access token"))?;
    // Parse before decoding the request; no session-cookie fallback.
    crate::store::access_token_format(bearer).map_err(db_error)?;
    let input: LinkInput = decode(r.body)?;
    check_static_alias(r.s, &input).map_err(db_error)?;
    Ok((
        StatusCode::CREATED,
        Json(
            r.s.store
                .create_access_link(bearer, input)
                .map_err(db_error)?,
        ),
    )
        .into_response())
}

// ---- Administrator namespace /_/api ----

fn admin_login(r: &ApiRequest) -> ApiResult {
    let input: TokenInput = decode(r.body)?;
    // HMAC verifier avoids content-dependent comparison of the configured secret.
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let s = r.s;
    let mut mac = Hmac::<Sha256>::new_from_slice(s.admin_token.as_bytes()).unwrap();
    mac.update(b"admin-login");
    let expected = mac.finalize().into_bytes();
    let mut attempt = Hmac::<Sha256>::new_from_slice(input.token.as_bytes()).unwrap();
    attempt.update(b"admin-login");
    if s.admin_token.len() < 16 || attempt.verify_slice(&expected).is_err() {
        return Err(unauthorized("invalid administrator token"));
    }
    let token = s.store.admin_session(&r.now).map_err(db_error)?;
    Ok(set_cookie(
        message("signed in"),
        s,
        "short_admin",
        &token,
        3600,
    ))
}
/// The `short_admin` cookie is the only authority for `/_/api`.
fn admin_authority(r: &ApiRequest) -> Result<(String, Store), Response> {
    let store = &r.s.store;
    let token =
        cookie(r.h, "short_admin").ok_or_else(|| authority_error(store, r.h, &r.now, true))?;
    let db = store
        .admin_scope(&token, &r.now)
        .map_err(|_| unauthorized("administrator authentication required"))?;
    Ok((token, db))
}
fn admin_api(r: &ApiRequest, db: &Store, token: &str) -> ApiResult {
    let now = r.now.as_str();
    match (r.method.as_str(), r.path) {
        ("POST", "/_/api/logout") => {
            db.logout(token).map_err(db_error)?;
            return Ok(set_cookie(message("signed out"), r.s, "short_admin", "", 0));
        }
        ("GET", "/_/api/users") => return Ok(Json(db.users().map_err(db_error)?).into_response()),
        ("GET", "/_/api/links") => {
            return Ok(Json(db.links(None).map_err(db_error)?).into_response());
        }
        ("GET", "/_/api/events") => {
            return Ok(Json(event_response(db, None, r.query)?).into_response());
        }
        ("GET", "/_/api/usage") => return Ok(Json(db.usage().map_err(db_error)?).into_response()),
        ("POST", "/_/api/users") => return admin_create_user(r, db),
        _ => {}
    }
    let seg: Vec<_> = r.path.trim_matches('/').split('/').collect();
    if seg.len() >= 4 && seg[..3] == ["_", "api", "users"] {
        let id: i32 = seg[3].parse().map_err(|_| not_found())?;
        match (r.method.as_str(), seg.get(4).copied()) {
            ("PATCH", None) => {
                return Ok(
                    Json(db.patch_user(id, decode(r.body)?, now).map_err(db_error)?)
                        .into_response(),
                );
            }
            ("DELETE", None) => {
                db.patch_user(
                    id,
                    UserPatch {
                        deleted: Some(true),
                        ..UserPatch::default()
                    },
                    now,
                )
                .map_err(db_error)?;
                return Ok(message("account soft deleted"));
            }
            ("POST", Some("sign-out-everywhere")) => {
                db.revoke_user(id).map_err(db_error)?;
                return Ok(message("all sessions revoked; passkeys preserved"));
            }
            _ => {}
        }
    }
    Err(error(
        StatusCode::NOT_FOUND,
        "not_found",
        "unknown administrator route",
    ))
}
fn admin_create_user(r: &ApiRequest, db: &Store) -> ApiResult {
    let i: UserInput = decode(r.body)?;
    if i.link_quota.is_some_and(|q| q < 0)
        || i.retention_days
            .is_some_and(|d| crate::domain::RetentionDays::parse(d).is_err())
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation",
            "invalid quota or retention",
        ));
    }
    let u = db.create_user(&i.email, &r.now).map_err(db_error)?;
    let u = db
        .patch_user(
            u.id,
            UserPatch {
                suspended: None,
                deleted: None,
                retention_days: Some(i.retention_days),
                link_quota: Some(i.link_quota),
            },
            &r.now,
        )
        .map_err(db_error)?;
    Ok((StatusCode::CREATED, Json(u)).into_response())
}

// ---- Unauthenticated user ceremonies ----

/// Sign-in routes that precede user cookie authority; `None` for every other route.
fn public_auth(r: &ApiRequest) -> Option<ApiResult> {
    if *r.method != Method::POST {
        return None;
    }
    match r.path {
        "/api/auth/magic-link" => Some(magic_link(r)),
        "/api/auth/passkeys/authenticate/options" => Some(
            crate::passkeys::webauthn(&r.s.origin)
                .map_err(db_error)
                .and_then(|w| passkey_authenticate_options(r, &w)),
        ),
        "/api/auth/passkeys/authenticate/verify" => Some(
            crate::passkeys::webauthn(&r.s.origin)
                .map_err(db_error)
                .and_then(|w| passkey_authenticate_verify(r, &w)),
        ),
        _ => None,
    }
}
fn magic_link(r: &ApiRequest) -> ApiResult {
    let s = r.s;
    let i: EmailInput = decode(r.body)?;
    if let Some(token) = s.store.issue_magic(&i.email, &r.now).map_err(db_error)? {
        use lettre::Transport;
        let unavailable = || {
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "smtp",
                "mail unavailable",
            )
        };
        let mail = lettre::Message::builder()
            .from(s.smtp_from.parse().map_err(|_| unavailable())?)
            .to(i.email.parse().map_err(|_| {
                error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "validation",
                    "invalid email",
                )
            })?)
            .subject("Your sign-in link")
            .body(format!(
                "Sign in: {}/auth/verify?token={}\nExpires in 15 minutes. This link works once.",
                s.origin, token
            ))
            .map_err(|_| unavailable())?;
        let transport = s.smtp.transport().map_err(|_| unavailable())?;
        if transport.send(&mail).is_err() {
            // Relay responses can echo credentials; do not log provider error text.
            tracing::warn!("SMTP delivery failed");
        }
    }
    Ok(message(
        "If this account is eligible, a sign-in link has been sent.",
    ))
}
fn passkey_authenticate_options(r: &ApiRequest, w: &webauthn_rs::Webauthn) -> ApiResult {
    let _: serde_json::Map<String, serde_json::Value> = decode(r.body)?;
    // No account lookup or credential IDs before the authenticator identifies itself.
    let options =
        r.s.store
            .passkey_auth_options(w, "", &r.now)
            .map_err(|_| unauthorized("passkey authentication unavailable"))?;
    let challenge = options.challenge_id.clone();
    Ok(set_cookie(
        Json(options).into_response(),
        r.s,
        "short_passkey",
        &challenge,
        300,
    ))
}
fn passkey_authenticate_verify(r: &ApiRequest, w: &webauthn_rs::Webauthn) -> ApiResult {
    let i: PasskeyVerify = decode(r.body)?;
    if cookie(r.h, "short_passkey").as_deref() != Some(i.challenge_id.as_str()) {
        return Err(unauthorized("passkey verification failed"));
    }
    let (user, session) =
        r.s.store
            .passkey_auth_verify(w, i, &r.now)
            .map_err(|_| unauthorized("passkey verification failed"))?;
    Ok(set_cookie(
        set_cookie(
            Json(user).into_response(),
            r.s,
            "short_session",
            &session,
            30 * 86400,
        ),
        r.s,
        "short_passkey",
        "",
        0,
    ))
}

// ---- User namespace /api (short_session cookie) ----

struct UserAuthority {
    token: String,
    user: User,
    db: Store,
}
/// The `short_session` cookie is the only authority for the rest of `/api`.
fn user_authority(r: &ApiRequest) -> Result<UserAuthority, Response> {
    let store = &r.s.store;
    let token =
        cookie(r.h, "short_session").ok_or_else(|| authority_error(store, r.h, &r.now, false))?;
    let (user, db) = store
        .user_session(&token, &r.now)
        .map_err(|_| unauthorized("authentication required"))?;
    Ok(UserAuthority { token, user, db })
}
fn user_api(r: &ApiRequest, u: &UserAuthority) -> ApiResult {
    if let Some(response) = account_api(r, u) {
        return response;
    }
    if let Some(response) = link_api(r, u) {
        return response;
    }
    let segments: Vec<_> = r.path.trim_matches('/').split('/').collect();
    if *r.method == Method::PATCH
        && segments.len() == 4
        && segments[..3] == ["api", "account", "passkeys"]
    {
        let id: i32 = segments[3].parse().map_err(|_| not_found())?;
        let input: PasskeyRename = decode(r.body)?;
        return Ok(Json(
            u.db.rename_passkey(u.user.id, id, &input.name, &r.now)
                .map_err(db_error)?,
        )
        .into_response());
    }
    Err(error(
        StatusCode::NOT_FOUND,
        "not_found",
        "unknown API route",
    ))
}
/// Exact user routes (plus token revocation); `None` when no route matches.
fn account_api(r: &ApiRequest, u: &UserAuthority) -> Option<ApiResult> {
    let (s, db, user, now) = (r.s, &u.db, &u.user, r.now.as_str());
    let result = match (r.method.as_str(), r.path) {
        ("GET", "/api/account/tokens") => db
            .access_tokens(user.id, now)
            .map_err(db_error)
            .map(|v| Json(v).into_response()),
        ("POST", "/api/account/tokens") => decode(r.body).and_then(|input| {
            Ok((
                StatusCode::CREATED,
                Json(
                    db.issue_access_token(user.id, input, now)
                        .map_err(db_error)?,
                ),
            )
                .into_response())
        }),
        ("DELETE", path) if path.starts_with("/api/account/tokens/") => {
            revoke_access_token(u, path, now)
        }
        ("GET", "/api/me") => Ok(Json(user).into_response()),
        ("GET", "/api/account/passkeys") => db
            .passkey_list(user.id, now)
            .map_err(db_error)
            .map(|v| ([(header::CACHE_CONTROL, "no-store")], Json(v)).into_response()),
        ("POST", "/api/auth/passkeys/register/options") => crate::passkeys::webauthn(&s.origin)
            .and_then(|w| db.passkey_register_options(&w, user.id, now))
            .map_err(db_error)
            .map(|v| Json(v).into_response()),
        ("POST", "/api/auth/passkeys/register/verify") => passkey_register_verify(r, u),
        ("POST", "/api/auth/logout") => db
            .logout(&u.token)
            .map_err(db_error)
            .map(|()| set_cookie(message("signed out"), s, "short_session", "", 0)),
        ("POST", "/api/account/sign-out-everywhere") => {
            db.revoke_user(user.id).map_err(db_error).map(|()| {
                set_cookie(
                    message("all sessions revoked; passkeys preserved"),
                    s,
                    "short_session",
                    "",
                    0,
                )
            })
        }
        ("PATCH", "/api/account") => decode::<AccountPatch>(r.body).and_then(|p| {
            Ok(Json(
                db.patch_user(
                    user.id,
                    UserPatch {
                        retention_days: p.retention_days,
                        ..UserPatch::default()
                    },
                    now,
                )
                .map_err(db_error)?,
            )
            .into_response())
        }),
        ("GET", "/api/links") => db
            .links(Some(user.id))
            .map_err(db_error)
            .map(|v| Json(v).into_response()),
        ("POST", "/api/links") => decode::<LinkInput>(r.body).and_then(|i| {
            check_static_alias(s, &i).map_err(db_error)?;
            Ok((
                StatusCode::CREATED,
                Json(db.create_link(user.id, i, now).map_err(db_error)?),
            )
                .into_response())
        }),
        ("POST", "/api/links/bulk") => bulk_create(r, u),
        ("POST", "/api/links/bulk-update") => bulk_update(r, u),
        _ => return None,
    };
    Some(result)
}
fn revoke_access_token(u: &UserAuthority, path: &str, now: &str) -> ApiResult {
    let id = path
        .strip_prefix("/api/account/tokens/")
        .unwrap()
        .parse::<i32>()
        .map_err(|_| db_error("not found".into()))?;
    u.db.revoke_access_token(u.user.id, id, now)
        .map_err(db_error)?;
    Ok(message("access token revoked"))
}
fn passkey_register_verify(r: &ApiRequest, u: &UserAuthority) -> ApiResult {
    let w = crate::passkeys::webauthn(&r.s.origin).map_err(db_error)?;
    let input: PasskeyEnrollment = decode(r.body)?;
    crate::domain::PasskeyName::parse(&input.name).map_err(db_error)?;
    u.db.passkey_register_named(&w, u.user.id, input, &r.now)
        .map_err(|_| {
            error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "verification",
                "passkey verification failed",
            )
        })?;
    Ok(message("passkey registered"))
}
fn bulk_create(r: &ApiRequest, u: &UserAuthority) -> ApiResult {
    let i: BulkInput = decode(r.body)?;
    if i.items.is_empty() || i.items.len() > 500 {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation",
            "bulk creation requires 1..500 rows",
        ));
    }
    let items = i
        .items
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            let result = match row {
                BulkRow::Link(input) => check_static_alias(r.s, &input)
                    .and_then(|_| u.db.create_link(u.user.id, input, &r.now)),
                BulkRow::Invalid(_) => Err("invalid link input row".into()),
            };
            match result {
                Ok(link) => BulkResult::Created {
                    index: index as i32,
                    link,
                },
                Err(e) => BulkResult::Failed {
                    index: index as i32,
                    error: ErrorBody {
                        code: "validation".into(),
                        message: if e.contains("UNIQUE") {
                            "alias already exists".into()
                        } else {
                            e
                        },
                    },
                },
            }
        })
        .collect();
    Ok(Json(BulkResponse { items }).into_response())
}
fn bulk_update(r: &ApiRequest, u: &UserAuthority) -> ApiResult {
    // An optional alias assertion can accompany an otherwise valid
    // bulk action. Check every assertion before any per-link write; do
    // not silently discard a rename alongside a metadata update.
    let raw: serde_json::Value = decode(r.body)?;
    let input: BulkUpdate = decode(r.body)?;
    // Bound all preflight target reads before looking up any ID.
    if input.ids.is_empty() || input.ids.len() > 1000 {
        return Err(db_error("bulk update requires 1..1000 IDs".into()));
    }
    for alias in [raw.get("alias"), raw.pointer("/action/alias")]
        .into_iter()
        .flatten()
    {
        for id in &input.ids {
            let link = owned_link(u, *id)?;
            let current = link
                .addresses
                .iter()
                .find(|address| address.domain_id == 1)
                .ok_or_else(not_found)?;
            crate::domain::unchanged_short_address(&current.short_code, alias.as_str())
                .map_err(db_error)?;
        }
    }
    Ok(Json(
        u.db.bulk_update(u.user.id, input, &r.now)
            .map_err(db_error)?,
    )
    .into_response())
}
/// An undeleted link owned by the session user; every other ID is a generic 404.
fn owned_link(u: &UserAuthority, id: i32) -> Result<Link, Response> {
    let link = u.db.link(id).map_err(db_error)?;
    if link.owner_id != u.user.id || link.deleted_at.is_some() {
        return Err(not_found());
    }
    Ok(link)
}
/// `/api/links/{id}[/…]`; ownership is checked before the method/child route.
/// `None` falls through to the generic unknown-route response.
fn link_api(r: &ApiRequest, u: &UserAuthority) -> Option<ApiResult> {
    let segments: Vec<_> = r.path.trim_matches('/').split('/').collect();
    if segments.len() < 3 || segments[..2] != ["api", "links"] {
        return None;
    }
    let link = match segments[2]
        .parse::<i32>()
        .map_err(|_| not_found())
        .and_then(|id| owned_link(u, id))
    {
        Ok(link) => link,
        Err(e) => return Some(Err(e)),
    };
    let (db, id, now) = (&u.db, link.id, r.now.as_str());
    let result = match (r.method.as_str(), segments.get(3).copied()) {
        ("GET", None) => Ok(Json(link).into_response()),
        ("PATCH", None) => decode(r.body).and_then(|p| {
            Ok(Json(db.patch_link(u.user.id, id, p, now).map_err(db_error)?).into_response())
        }),
        ("DELETE", None) => db
            .delete_link(u.user.id, id, now)
            .map_err(db_error)
            .map(|()| message("link deleted")),
        ("GET", Some("events")) => {
            event_response(db, Some(id), r.query).map(|v| Json(v).into_response())
        }
        ("GET", Some("stats")) => link_stats(r, db, id),
        _ => return None,
    };
    Some(result)
}
fn link_stats(r: &ApiRequest, db: &Store, id: i32) -> ApiResult {
    let q: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(r.query.as_bytes())
            .into_owned()
            .collect();
    let to = q.get("to").map(String::as_str).unwrap_or(&r.now[..10]);
    let default_from = (chrono::Utc::now().date_naive() - chrono::Duration::days(29)).to_string();
    let from = q.get("from").map(String::as_str).unwrap_or(&default_from);
    Ok(Json(db.stats(id, from, to).map_err(db_error)?).into_response())
}

async fn fallback(State(s): State<AppState>, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    let bytes = match axum::body::to_bytes(body, 16384).await {
        Ok(b) => b,
        Err(_) => return error(StatusCode::PAYLOAD_TOO_LARGE, "body", "request too large"),
    };
    let peer = parts
        .extensions
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|p| p.0.ip());
    tokio::task::spawn_blocking(move || {
        fallback_sync(&s, &parts.method, &parts.uri, &parts.headers, &bytes, peer)
    })
    .await
    .unwrap_or_else(|_| {
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "request failed",
        )
    })
}
pub(crate) fn html(status: StatusCode, body: String) -> Response {
    html_with_form_policy(status, body, FormPolicy::SameOrigin)
}
enum FormPolicy {
    SameOrigin,
    ContinueTo(url::Origin),
}
fn html_with_form_policy(status: StatusCode, body: String, policy: FormPolicy) -> Response {
    let action = match policy {
        FormPolicy::SameOrigin => "'self'".to_owned(),
        FormPolicy::ContinueTo(origin) => format!("'self' {}", origin.ascii_serialization()),
    };
    let csp = format!(
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; form-action {action}; frame-ancestors 'none'; base-uri 'none'"
    );
    (
        status,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_SECURITY_POLICY, csp.as_str()),
            (header::REFERRER_POLICY, "no-referrer"),
        ],
        body,
    )
        .into_response()
}
pub(crate) fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
// Native password/continue forms retain their HTTP authority and work without JS.
// The stable stylesheet is emitted from the same built CSS as the user app.
fn public_document(title: &str, content: String) -> String {
    format!(
        include_str!("../web/src/lib/presentation/native-document.html"),
        title = escape(title),
        content = content,
        style = include_str!("../web/src/lib/presentation/native-critical.css")
    )
}
fn shell(s: &AppState, status: StatusCode) -> Response {
    if let Some(origin) = &s.dev_vite_origin {
        let body = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .and_then(|client| client.get(origin).send())
            .and_then(reqwest::blocking::Response::error_for_status)
            .and_then(reqwest::blocking::Response::text);
        return match body {
            Ok(body) => html(status, body),
            Err(_) => html(
                StatusCode::SERVICE_UNAVAILABLE,
                public_document(
                    "Development frontend unavailable",
                    "<h1>Development frontend unavailable</h1>".into(),
                ),
            ),
        };
    }
    let body = std::fs::read_to_string(s.static_dir.join("index.html"))
        .or_else(|_| std::fs::read_to_string(s.static_dir.join("200.html")))
        .unwrap_or_else(|_| {
            public_document(
                "Application unavailable",
                "<h1>Application unavailable</h1><p>Static application files are missing.</p>"
                    .into(),
            )
        });
    html(status, body)
}
fn redirect(location: &str) -> Response {
    (
        StatusCode::FOUND,
        [
            (header::LOCATION, location),
            (header::CACHE_CONTROL, "no-store"),
            (header::REFERRER_POLICY, "no-referrer"),
        ],
    )
        .into_response()
}
// A denied management document must not execute the SPA: cookies span ports,
// while creator-page host admission is stricter than ordinary API admission.
fn management_not_found() -> Response {
    html(
        StatusCode::NOT_FOUND,
        public_document("Link not found", "<h1>Link not found</h1>".into()),
    )
}
fn fallback_sync(
    s: &AppState,
    method: &Method,
    uri: &axum::http::Uri,
    h: &HeaderMap,
    body: &[u8],
    peer: Option<std::net::IpAddr>,
) -> Response {
    let path = uri.path();
    let now = crate::domain::instant(chrono::Utc::now());
    // Creator pages precede static files so a generated or stray file cannot bypass auth.
    let management = crate::domain::ManagementRoute::parse(path);
    if management == crate::domain::ManagementRoute::Invalid {
        return management_not_found();
    }
    if let crate::domain::ManagementRoute::Creator(page) = management {
        let admitted = matches!(*method, Method::GET | Method::HEAD)
            && management_host_ok(s, peer, h)
            && cookie(h, "short_session")
                .and_then(|token| s.store.user_scope(&token, &now).ok())
                .and_then(|db| db.owned_alias(page.alias(), &now).ok())
                .is_some();
        return if admitted {
            shell(s, StatusCode::OK)
        } else {
            management_not_found()
        };
    }
    if path == "/auth/verify" && *method == Method::GET {
        let q: std::collections::HashMap<String, String> =
            url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
                .into_owned()
                .collect();
        return match q
            .get("token")
            .and_then(|t| s.store.consume_magic(t, &now).ok())
        {
            Some((_, token)) => {
                let mut r = redirect("/");
                *r.status_mut() = StatusCode::SEE_OTHER;
                set_cookie(r, s, "short_session", &token, 30 * 86400)
            }
            None => shell(s, StatusCode::NOT_FOUND),
        };
    }
    let request_parts: Vec<_> = path.trim_matches('/').split('/').collect();
    let continuation = *method == Method::POST
        && request_parts.len() == 3
        && request_parts[0] == "v"
        && request_parts[2] == "continue";
    let unlock = *method == Method::POST
        && request_parts.len() == 3
        && request_parts[0] == "v"
        && request_parts[2] == "unlock";
    if continuation || unlock {
        if !origin_ok(s, h) {
            return error(
                StatusCode::FORBIDDEN,
                "origin",
                "same-origin request required",
            );
        }
        if unlock {
            if !s.known_alias_host(peer, h) {
                return shell(s, StatusCode::NOT_FOUND);
            }
            if s.store.lookup(request_parts[1], &now).is_err() {
                return shell(s, StatusCode::NOT_FOUND);
            }
            if !s
                .store
                .rate_limit(
                    &format!("unlock:{}:{}", request_parts[1], s.client_ip(peer, h)),
                    20,
                    &now,
                )
                .unwrap_or(false)
            {
                return error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "rate_limit",
                    "try again later",
                );
            }
            let form: std::collections::HashMap<String, String> =
                url::form_urlencoded::parse(body).into_owned().collect();
            return match s.store.unlock(
                request_parts[1],
                form.get("password").map(String::as_str).unwrap_or(""),
                &now,
            ) {
                Ok((id, token)) => {
                    let location = format!(
                        "/v/{}{}",
                        request_parts[1],
                        uri.query().map(|q| format!("?{q}")).unwrap_or_default()
                    );
                    let mut r = redirect(&location);
                    *r.status_mut() = StatusCode::SEE_OTHER;
                    set_cookie(r, s, &format!("short_grant_{id}"), &token, 15 * 60)
                }
                Err(_) => html(
                    StatusCode::UNAUTHORIZED,
                    public_document(
                        "Unable to unlock link",
                        format!(
                            include_str!("../web/src/lib/presentation/native-unlock-error.html"),
                            code = escape(request_parts[1]),
                            query = uri
                                .query()
                                .map(|q| format!("?{}", escape(q)))
                                .unwrap_or_default()
                        ),
                    ),
                ),
            };
        }
    } else if *method != Method::GET && *method != Method::HEAD {
        return shell(s, StatusCode::NOT_FOUND);
    }
    if path == "/_" {
        return redirect("/_/");
    }
    if let Some(relative) = path.strip_prefix("/_/") {
        let mut admin = s.clone();
        admin.static_dir = s.static_dir.join("_");
        admin.dev_vite_origin = None;
        if relative.is_empty() {
            return shell(&admin, StatusCode::OK);
        }
        if let Some(response) = static_file(&admin, relative) {
            return response;
        }
        return if relative.contains('.') || relative.starts_with("_app/") {
            StatusCode::NOT_FOUND.into_response()
        } else {
            shell(&admin, StatusCode::NOT_FOUND)
        };
    }
    if path == "/" {
        return shell(s, StatusCode::OK);
    }
    if path.starts_with("/auth/") || path.starts_with("/api/") {
        return shell(s, StatusCode::NOT_FOUND);
    }
    // Canonicalized existing files beat aliases. Missing assets must not receive HTML.
    let relative = path.trim_start_matches('/');
    if let Some(response) = static_file(s, relative) {
        return response;
    }
    let parts: Vec<_> = relative.split('/').collect();
    let preview = parts.len() == 2 && parts[0] == "v";
    let code = if preview || continuation {
        parts[1]
    } else if parts.len() == 1 && !relative.contains('.') {
        relative
    } else {
        return if relative.contains('.')
            || path.starts_with("/_app/")
            || path.starts_with("/assets/")
            || path.starts_with("/fonts/")
        {
            StatusCode::NOT_FOUND.into_response()
        } else {
            shell(s, StatusCode::NOT_FOUND)
        };
    };
    if !s.known_alias_host(peer, h) {
        return shell(s, StatusCode::NOT_FOUND);
    }
    let link = match s.store.lookup(code, &now) {
        Ok(l) => l,
        Err(_) => return shell(s, StatusCode::NOT_FOUND),
    };
    let grant = cookie(h, &format!("short_grant_{}", link.id));
    use crate::domain::{GrantStatus, LinkPolicy, OwnerState, VisitDecision, VisitIntent};
    let proof = if grant
        .as_deref()
        .is_some_and(|g| s.store.check_grant(link.id, g, &now).unwrap_or(false))
    {
        GrantStatus::Verified
    } else {
        GrantStatus::Missing
    };
    let intent = if continuation {
        VisitIntent::Continue
    } else if preview {
        VisitIntent::Preview
    } else {
        VisitIntent::Resolve
    };
    let decision = LinkPolicy::observe(&link, OwnerState::Active, chrono::Utc::now())
        .map(|p| p.decide(proof, intent))
        .unwrap_or(VisitDecision::Hidden);
    let query = uri
        .query()
        .map(|q| format!("?{}", escape(q)))
        .unwrap_or_default();
    if decision == VisitDecision::Hidden {
        return shell(s, StatusCode::NOT_FOUND);
    }
    if decision == VisitDecision::PasswordRequired {
        return html(
            StatusCode::OK,
            public_document(
                "Protected link",
                format!(
                    include_str!("../web/src/lib/presentation/native-password.html"),
                    code = escape(code),
                    query = query
                ),
            ),
        );
    }
    if matches!(decision, VisitDecision::Preview(_)) {
        let destination = match url::Url::parse(&link.destination) {
            Ok(destination) if matches!(destination.scheme(), "http" | "https") => destination,
            _ => {
                return error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "destination",
                    "link unavailable",
                );
            }
        };
        let o = observation(h, s.client_ip(peer, h));
        let _ = s.store.record_event_with_location(
            &link,
            link.addresses[0].id,
            EventKind::Preview,
            &o,
            &now,
            &s.analytics_secret,
            &s.geoip.lookup(&o.ip),
        );
        return html_with_form_policy(
            StatusCode::OK,
            public_document(
                "Preview",
                format!(
                    include_str!("../web/src/lib/presentation/native-preview.html"),
                    title = escape(link.title.as_deref().unwrap_or("Link preview")),
                    description = escape(link.description.as_deref().unwrap_or("")),
                    destination = escape(&link.destination),
                    code = escape(code),
                    query = query
                ),
            ),
            FormPolicy::ContinueTo(destination.origin()),
        );
    }
    let o = observation(h, s.client_ip(peer, h));
    let kind = crate::analytics::classify(&o.user_agent);
    match s
        .store
        .claim_authorized_now(code, kind == EventKind::Human, grant.as_deref())
    {
        Ok(link) => {
            let event_now = crate::domain::instant(chrono::Utc::now());
            let _ = s.store.record_event_with_location(
                &link,
                link.addresses[0].id,
                kind,
                &o,
                &event_now,
                &s.analytics_secret,
                &s.geoip.lookup(&o.ip),
            );
            match crate::domain::merge_query(
                &link.destination,
                uri.query().unwrap_or(""),
                link.query_mode,
            ) {
                Ok(destination) => redirect(&destination),
                Err(_) => shell(s, StatusCode::NOT_FOUND),
            }
        }
        Err(_) => shell(s, StatusCode::NOT_FOUND),
    }
}
fn management_host_ok(s: &AppState, peer: Option<std::net::IpAddr>, h: &HeaderMap) -> bool {
    let key = if peer.is_some_and(|p| s.trusted_proxies.contains(&p))
        && h.contains_key("x-forwarded-host")
    {
        "x-forwarded-host"
    } else {
        "host"
    };
    let mut values = h.get_all(key).iter();
    let Some(value) = values.next().and_then(|value| value.to_str().ok()) else {
        return false;
    };
    if values.next().is_some()
        || value.is_empty()
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b':' | b'[' | b']'))
    {
        return false;
    }
    let Ok(authority) = value.parse::<axum::http::uri::Authority>() else {
        return false;
    };
    if authority.port().is_some() && authority.port_u16().is_none() {
        return false;
    }
    let Ok(origin) = url::Url::parse(&s.origin) else {
        return false;
    };
    let default_port = if origin.scheme() == "https" { 443 } else { 80 };
    origin
        .host_str()
        .is_some_and(|host| authority.host().eq_ignore_ascii_case(host))
        && Some(authority.port_u16().unwrap_or(default_port)) == origin.port_or_known_default()
}
fn observation(h: &HeaderMap, ip: String) -> crate::analytics::Observation {
    crate::analytics::Observation {
        ip,
        user_agent: h
            .get("user-agent")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .chars()
            .take(2048)
            .collect(),
        referrer: h
            .get("referer")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.chars().take(8192).collect()),
    }
}
fn check_static_alias(s: &AppState, i: &LinkInput) -> Result<(), String> {
    if let Some(alias) = &i.alias {
        crate::domain::Alias::parse(alias)?;
        if s.static_dir.join(alias).exists() {
            return Err("alias collides with a static file or directory".into());
        }
    }
    Ok(())
}

fn static_file(s: &AppState, relative: &str) -> Option<Response> {
    if !relative.split('/').any(|p| p == ".." || p == ".") && !relative.contains('%') {
        let file = s.static_dir.join(relative);
        if let (Ok(root), Ok(full)) = (s.static_dir.canonicalize(), file.canonicalize()) {
            if full.starts_with(root) && full.is_file() {
                if let Ok(bytes) = std::fs::read(&full) {
                    let mime = match full.extension().and_then(|v| v.to_str()).unwrap_or("") {
                        "js" => "text/javascript",
                        "css" => "text/css",
                        "svg" => "image/svg+xml",
                        "png" => "image/png",
                        "ico" => "image/x-icon",
                        "woff2" => "font/woff2",
                        "json" => "application/json",
                        "html" => "text/html; charset=utf-8",
                        _ => "application/octet-stream",
                    };
                    return Some(
                        (StatusCode::OK, [(header::CONTENT_TYPE, mime)], bytes).into_response(),
                    );
                }
            }
        }
    }
    None
}

fn event_response(db: &Store, link: Option<i32>, query: &str) -> Result<EventList, Response> {
    let q: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(query.as_bytes())
            .into_owned()
            .collect();
    db.events_between(
        link,
        q.get("from").map(String::as_str).unwrap_or("0001-01-01"),
        q.get("to").map(String::as_str).unwrap_or("9999-12-31"),
    )
    .map_err(db_error)
}
