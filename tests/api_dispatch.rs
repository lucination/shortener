//! Golden matrix pinning `/api` and `/_/api` dispatch: every route (and a set of
//! unknown/wrong-method/malformed variants) under every credential combination.
//! Each cell runs against a fresh store, so mutations never leak between cells.
//! Regenerate deliberately with `UPDATE_GOLDEN=1 cargo test --test api_dispatch`.
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use shortener::{
    dto::{AccessTokenInput, LinkInput},
    http::{AppState, router},
    store::Store,
};
use tower::ServiceExt;

const GOLDEN: &str = "tests/data/api_dispatch.golden";

struct World {
    app: axum::Router,
    user: String,
    admin: String,
    access: String,
}

fn link(destination: &str) -> LinkInput {
    serde_json::from_value(serde_json::json!({ "destination": destination })).unwrap()
}

fn world() -> World {
    let db = Store::open(":memory:", "example.com").unwrap();
    let now = shortener::domain::instant(chrono::Utc::now());
    let mut sessions = vec![];
    for email in ["member@example.test", "other@example.test"] {
        let u = db.create_user(email, &now).unwrap();
        let magic = db.issue_magic(&u.email, &now).unwrap().unwrap();
        let (u, session) = db.consume_magic(&magic, &now).unwrap();
        db.create_link(u.id, link("https://example.org/a"), &now)
            .unwrap();
        sessions.push((u.id, session));
    }
    let access = db
        .issue_access_token(
            sessions[0].0,
            AccessTokenInput {
                name: "cli".into(),
                expires_in_days: 30,
            },
            &now,
        )
        .unwrap()
        .token;
    let admin = db.admin_session(&now).unwrap();
    let mut state = AppState::new(db);
    // Independent of whether the frontends have been built locally.
    state.static_dir = "tests/data/no-static-build".into();
    World {
        app: router(state),
        user: sessions.remove(0).1,
        admin,
        access,
    }
}

const AUTHS: &[&str] = &[
    "none",
    "user",
    "admin",
    "user+admin",
    "user-no-origin",
    "user-evil-origin",
    "bearer",
    "bearer-no-origin",
    "bearer+user",
    "bearer-session",
    "bearer-malformed",
    "basic",
];

const ROUTES: &[(&str, &str, &str)] = &[
    ("POST", "/_/api/login", r#"{"token":"test-admin-token"}"#),
    ("POST", "/_/api/login", r#"{"token":"bad"}"#),
    ("POST", "/_/api/login", "not json"),
    ("GET", "/_/api/login", ""),
    ("POST", "/_/api/logout", ""),
    ("GET", "/_/api/logout", ""),
    ("GET", "/_/api/users", ""),
    ("POST", "/_/api/users", r#"{"email":"new@example.test"}"#),
    (
        "POST",
        "/_/api/users",
        r#"{"email":"new@example.test","link_quota":-1}"#,
    ),
    ("POST", "/_/api/users", r#"{"email":"member@example.test"}"#),
    ("PUT", "/_/api/users", ""),
    ("GET", "/_/api/links", ""),
    ("DELETE", "/_/api/links", ""),
    ("GET", "/_/api/events", ""),
    ("GET", "/_/api/events?from=bad", ""),
    ("GET", "/_/api/usage", ""),
    ("PATCH", "/_/api/users/1", r#"{"suspended":false}"#),
    ("PATCH", "/_/api/users/1", "not json"),
    ("PATCH", "/_/api/users/999", r#"{"suspended":false}"#),
    ("DELETE", "/_/api/users/2", ""),
    ("POST", "/_/api/users/2/sign-out-everywhere", ""),
    ("GET", "/_/api/users/1", ""),
    ("GET", "/_/api/users/abc", ""),
    ("POST", "/_/api/users/1/unknown", ""),
    ("GET", "/_/api/unknown", ""),
    ("GET", "/_/api/", ""),
    (
        "POST",
        "/api/auth/magic-link",
        r#"{"email":"nobody@example.test"}"#,
    ),
    ("POST", "/api/auth/magic-link", "not json"),
    ("GET", "/api/auth/magic-link", ""),
    ("GET", "/api/auth/unknown", ""),
    ("POST", "/api/auth/unknown", ""),
    ("POST", "/api/auth/passkeys/authenticate/options", "{}"),
    ("POST", "/api/auth/passkeys/authenticate/options", "[]"),
    ("GET", "/api/auth/passkeys/authenticate/options", ""),
    (
        "POST",
        "/api/auth/passkeys/authenticate/verify",
        r#"{"challenge_id":"x","credential":{}}"#,
    ),
    ("POST", "/api/auth/passkeys/authenticate/verify", "{}"),
    ("POST", "/api/auth/passkeys/register/options", "{}"),
    (
        "POST",
        "/api/auth/passkeys/register/verify",
        r#"{"challenge_id":"x","credential":{},"name":"Laptop"}"#,
    ),
    (
        "POST",
        "/api/auth/passkeys/register/verify",
        r#"{"challenge_id":"x","credential":{},"name":""}"#,
    ),
    ("POST", "/api/auth/logout", ""),
    ("GET", "/api/auth/logout", ""),
    ("GET", "/api/me", ""),
    ("HEAD", "/api/me", ""),
    ("POST", "/api/me", ""),
    ("GET", "/api/account/tokens", ""),
    ("POST", "/api/account/tokens", r#"{"name":"cli"}"#),
    ("POST", "/api/account/tokens", r#"{"name":""}"#),
    ("GET", "/api/account/tokens/1", ""),
    ("DELETE", "/api/account/tokens/1", ""),
    ("DELETE", "/api/account/tokens/abc", ""),
    ("DELETE", "/api/account/tokens/999", ""),
    ("GET", "/api/account/tokens/", ""),
    ("GET", "/api/account/passkeys", ""),
    ("PATCH", "/api/account/passkeys/1", r#"{"name":"x"}"#),
    ("PATCH", "/api/account/passkeys/abc", r#"{"name":"x"}"#),
    ("PATCH", "/api/account/passkeys/1/extra", r#"{"name":"x"}"#),
    ("DELETE", "/api/account/passkeys/1", ""),
    ("POST", "/api/account/sign-out-everywhere", ""),
    ("PATCH", "/api/account", r#"{"retention_days":30}"#),
    ("PATCH", "/api/account", r#"{"retention_days":0}"#),
    ("GET", "/api/account", ""),
    ("GET", "/api/links", ""),
    (
        "POST",
        "/api/links",
        r#"{"destination":"https://example.org/x"}"#,
    ),
    (
        "POST",
        "/api/links",
        r#"{"destination":"https://example.org/x","alias":"custom-a"}"#,
    ),
    (
        "POST",
        "/api/links",
        r#"{"destination":"https://example.org/x","alias":"bad alias"}"#,
    ),
    ("POST", "/api/links", "not json"),
    (
        "POST",
        "/api/links?x=1",
        r#"{"destination":"https://example.org/q"}"#,
    ),
    ("PUT", "/api/links", ""),
    ("GET", "/api/links/", ""),
    (
        "POST",
        "/api/links/bulk",
        r#"{"items":[{"destination":"https://example.org/b"},{"nope":1}]}"#,
    ),
    ("POST", "/api/links/bulk", r#"{"items":[]}"#),
    (
        "POST",
        "/api/links/bulk-update",
        r#"{"ids":[1],"action":{"type":"disable"}}"#,
    ),
    (
        "POST",
        "/api/links/bulk-update",
        r#"{"ids":[1,2],"action":{"type":"enable"},"alias":"zzz"}"#,
    ),
    (
        "POST",
        "/api/links/bulk-update",
        r#"{"ids":[],"action":{"type":"enable"}}"#,
    ),
    ("GET", "/api/links/1", ""),
    ("GET", "/api/links/2", ""),
    ("GET", "/api/links/999", ""),
    ("GET", "/api/links/abc", ""),
    ("PATCH", "/api/links/1", r#"{"title":"t"}"#),
    ("PATCH", "/api/links/1", r#"{"alias":"other"}"#),
    ("PATCH", "/api/links/2", r#"{"title":"t"}"#),
    ("DELETE", "/api/links/1", ""),
    ("PUT", "/api/links/1", ""),
    ("GET", "/api/links/1/events", ""),
    (
        "GET",
        "/api/links/1/events?from=2020-02-01&to=2020-01-01",
        "",
    ),
    ("GET", "/api/links/1/stats", ""),
    (
        "GET",
        "/api/links/1/stats?from=2020-01-01&to=2020-01-31",
        "",
    ),
    ("GET", "/api/links/1/stats?from=bad", ""),
    ("GET", "/api/links/2/stats", ""),
    ("GET", "/api/links/abc/stats", ""),
    ("GET", "/api/links/1/unknown", ""),
    ("POST", "/api/links/1/events", ""),
    ("GET", "/api/unknown", ""),
    ("POST", "/api/unknown", ""),
    ("GET", "/api/", ""),
];

fn render_cookie(v: &str) -> String {
    // Redact the token value, keep name and every attribute.
    let (pair, attrs) = v.split_once(';').unwrap_or((v, ""));
    let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
    let value = if value.is_empty() { "" } else { "<v>" };
    format!("{name}={value};{attrs}")
}

fn render_body(status: u16, bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "<empty>".into();
    }
    if status >= 400 {
        // Native documents inline critical CSS; presentation isn't dispatch.
        let text = String::from_utf8_lossy(bytes);
        return match (text.find("<style>"), text.find("</style>")) {
            (Some(start), Some(end)) if start < end => {
                format!("{}<style>…{}", &text[..start], &text[end..])
            }
            _ => text.into_owned(),
        };
    }
    match serde_json::from_slice::<serde_json::Value>(bytes) {
        Ok(serde_json::Value::Object(map)) => {
            let mut keys: Vec<_> = map.keys().cloned().collect();
            keys.sort();
            match map.get("message") {
                Some(serde_json::Value::String(m)) if map.len() == 1 => {
                    format!("message={m:?}")
                }
                _ => format!("keys={keys:?}"),
            }
        }
        Ok(other) => format!("json:{}", other),
        Err(_) => format!("raw:{} bytes", bytes.len()),
    }
}

async fn cell(method: &str, path: &str, body: &str, auth: &str) -> String {
    let w = world();
    let mut req = Request::builder().method(method).uri(path);
    let with_origin = !auth.ends_with("no-origin");
    if auth == "user-evil-origin" {
        req = req.header("origin", "https://evil.test");
    } else if with_origin {
        req = req.header("origin", "http://localhost:3000");
    }
    if !body.is_empty() {
        req = req.header("content-type", "application/json");
    }
    let cookie = match auth {
        "user" | "user-no-origin" | "user-evil-origin" | "bearer+user" => {
            Some(format!("short_session={}", w.user))
        }
        "admin" => Some(format!("short_admin={}", w.admin)),
        "user+admin" => Some(format!("short_session={}; short_admin={}", w.user, w.admin)),
        _ => None,
    };
    if let Some(c) = cookie {
        req = req.header("cookie", c);
    }
    let authorization = match auth {
        "bearer" | "bearer-no-origin" | "bearer+user" => Some(format!("Bearer {}", w.access)),
        "bearer-session" => Some(format!("Bearer {}", w.user)),
        "bearer-malformed" => Some("Bearer short_at_nothex".into()),
        "basic" => Some("Basic dXNlcjpwYXNz".into()),
        _ => None,
    };
    if let Some(a) = authorization {
        req = req.header("authorization", a);
    }
    let res = w
        .app
        .oneshot(req.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap();
    let status = res.status().as_u16();
    let mut headers: Vec<String> = res
        .headers()
        .iter()
        .filter(|(k, _)| *k != "content-length" && *k != "date")
        .map(|(k, v)| {
            let v = v.to_str().unwrap_or("<bin>");
            if *k == "set-cookie" {
                format!("{k}: {}", render_cookie(v))
            } else {
                format!("{k}: {v}")
            }
        })
        .collect();
    headers.sort();
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    format!(
        "{method} {path} {body} [{auth}] -> {status} | {} | {}",
        headers.join(" | "),
        render_body(status, &bytes)
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn api_dispatch_matches_golden_matrix() {
    let mut lines = vec![];
    for (method, path, body) in ROUTES {
        for auth in AUTHS {
            lines.push(cell(method, path, body, auth).await);
        }
    }
    let actual = lines.join("\n") + "\n";
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(GOLDEN, &actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(GOLDEN).expect("golden file present");
    let mismatches: Vec<_> = expected
        .lines()
        .zip(actual.lines())
        .filter(|(e, a)| e != a)
        .map(|(e, a)| format!("expected: {e}\n  actual: {a}"))
        .collect();
    assert!(
        mismatches.is_empty() && expected.lines().count() == actual.lines().count(),
        "{} dispatch cells differ (expected {} lines, got {}):\n{}",
        mismatches.len(),
        expected.lines().count(),
        actual.lines().count(),
        mismatches.join("\n")
    );
}
