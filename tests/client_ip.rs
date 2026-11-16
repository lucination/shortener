use axum::http::HeaderMap;
use shortener::{
    http::{AppState, ClientIpHeader},
    store::Store,
};

#[test]
fn trusted_cloudflare_ip_wins_over_spoofed_forwarded_chain() {
    let mut state = AppState::new(Store::open(":memory:", "example.com").unwrap());
    state.trusted_proxies = vec!["192.0.2.10".parse().unwrap()];
    state.client_ip_header = ClientIpHeader::parse(Some("cf-connecting-ip")).unwrap();
    let mut headers = HeaderMap::new();
    headers.insert("cf-connecting-ip", "203.0.113.42".parse().unwrap());
    headers.insert(
        "x-forwarded-for",
        "192.0.2.66, 203.0.113.42".parse().unwrap(),
    );
    assert_eq!(
        state.client_ip(Some("192.0.2.10".parse().unwrap()), &headers),
        "203.0.113.42"
    );
}

#[test]
fn header_policy_is_closed_and_defaults_to_existing_forwarded_behavior() {
    assert_eq!(
        ClientIpHeader::parse(None).unwrap(),
        ClientIpHeader::XForwardedFor
    );
    assert_eq!(
        ClientIpHeader::parse(Some("x-forwarded-for")).unwrap(),
        ClientIpHeader::XForwardedFor
    );
    for value in ["", "CF-Connecting-IP", "cf-connecting-ip ", "x-real-ip"] {
        assert!(ClientIpHeader::parse(Some(value)).is_err(), "{value:?}");
    }
    let mut state = AppState::new(Store::open(":memory:", "example.com").unwrap());
    state.trusted_proxies = vec!["192.0.2.10".parse().unwrap()];
    let mut headers = HeaderMap::new();
    headers.insert("cf-connecting-ip", "203.0.113.42".parse().unwrap());
    headers.insert(
        "x-forwarded-for",
        "192.0.2.66, 203.0.113.42".parse().unwrap(),
    );
    assert_eq!(
        state.client_ip(Some("192.0.2.10".parse().unwrap()), &headers),
        "192.0.2.66"
    );
}

#[test]
fn cloudflare_policy_rejects_ambiguous_metadata_without_forwarded_fallback() {
    let mut state = AppState::new(Store::open(":memory:", "example.com").unwrap());
    state.trusted_proxies = vec!["192.0.2.10".parse().unwrap()];
    state.client_ip_header = ClientIpHeader::CfConnectingIp;
    let peer = Some("192.0.2.10".parse().unwrap());
    let mut headers = HeaderMap::new();
    headers.insert("x-forwarded-for", "192.0.2.66".parse().unwrap());
    assert_eq!(state.client_ip(peer, &headers), "192.0.2.10");
    for value in [
        "",
        "not-an-ip",
        "203.0.113.42, 192.0.2.66",
        "203.0.113.42:443",
    ] {
        headers.insert("cf-connecting-ip", value.parse().unwrap());
        assert_eq!(state.client_ip(peer, &headers), "192.0.2.10", "{value}");
    }
    headers.insert(
        "cf-connecting-ip",
        axum::http::HeaderValue::from_bytes(b"\xff").unwrap(),
    );
    assert_eq!(state.client_ip(peer, &headers), "192.0.2.10");
    headers.insert("cf-connecting-ip", "203.0.113.42".parse().unwrap());
    headers.append("cf-connecting-ip", "203.0.113.42".parse().unwrap());
    assert_eq!(state.client_ip(peer, &headers), "192.0.2.10");
    headers.insert("cf-connecting-ip", "2001:db8::42".parse().unwrap());
    assert_eq!(state.client_ip(peer, &headers), "2001:db8::42");
    for policy in [
        ClientIpHeader::CfConnectingIp,
        ClientIpHeader::XForwardedFor,
    ] {
        state.client_ip_header = policy;
        assert_eq!(
            state.client_ip(Some("192.0.2.8".parse().unwrap()), &headers),
            "192.0.2.8"
        );
        assert_eq!(state.client_ip(None, &headers), "Unknown");
    }
}

#[tokio::test]
async fn actual_http_rate_bucket_uses_cloudflare_ip_not_spoofed_forwarded_ip() {
    use axum::{
        body::Body,
        extract::ConnectInfo,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut state =
        AppState::new(Store::open(file.path().to_str().unwrap(), "example.com").unwrap());
    state.trusted_proxies = vec!["192.0.2.10".parse().unwrap()];
    state.client_ip_header = ClientIpHeader::CfConnectingIp;
    let app = shortener::http::router(state);
    let send = |ip: &str, spoof: &str| {
        let mut req = Request::post("/api/auth/passkeys/authenticate/options")
            .header("origin", "http://localhost:3000")
            .header("cf-connecting-ip", ip)
            .header("x-forwarded-for", spoof)
            .body(Body::from(r#"{"email":"missing@example.test"}"#))
            .unwrap();
        req.extensions_mut().insert(ConnectInfo(
            "192.0.2.10:1234".parse::<std::net::SocketAddr>().unwrap(),
        ));
        app.clone().oneshot(req)
    };
    for n in 0..20 {
        assert_eq!(
            send("203.0.113.42", &format!("192.0.2.{n}"))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    assert_eq!(
        send("203.0.113.42", "192.0.2.99").await.unwrap().status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        send("203.0.113.43", "192.0.2.99").await.unwrap().status(),
        StatusCode::OK
    );
    let db = rusqlite::Connection::open(file.path()).unwrap();
    let keys = db
        .prepare("SELECT key FROM rate_limits ORDER BY key")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let mut expected = ["203.0.113.42", "203.0.113.43"].map(|ip| {
        shortener::store::token_hash(&format!(
            "auth:/api/auth/passkeys/authenticate/options:{ip}"
        ))
    });
    expected.sort();
    assert_eq!(keys, expected);
}
