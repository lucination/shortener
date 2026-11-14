use shortener::smtp::SmtpConfig;

#[test]
fn configuration_rejects_partial_credentials_and_implicit_remote_plaintext() {
    assert!(SmtpConfig::parse("127.0.0.1", "1025", None, Some("user"), None).is_err());
    assert!(SmtpConfig::parse("127.0.0.1", "1025", None, None, Some("secret")).is_err());
    assert!(SmtpConfig::parse("relay.example", "587", None, None, None).is_err());
    assert!(SmtpConfig::parse("127.0.0.1", "1025", None, None, None).is_ok());
}

#[test]
fn invalid_security_ports_and_empty_secrets_fail_closed() {
    for mode in ["", "optional", "STARTTLS", "insecure", "none"] {
        assert!(SmtpConfig::parse("relay.example", "587", Some(mode), None, None).is_err());
    }
    for port in ["0", "65536", "bad", ""] {
        assert!(SmtpConfig::parse("localhost", port, None, None, None).is_err());
    }
    for (u, p) in [("", "secret"), ("user", ""), ("", "")] {
        assert!(SmtpConfig::parse("localhost", "1025", None, Some(u), Some(p)).is_err());
    }
    for mode in ["starttls", "tls", "plain"] {
        assert!(
            SmtpConfig::parse("relay.example", "587", Some(mode), Some("u"), Some("p"))
                .unwrap()
                .transport()
                .is_ok()
        );
    }
}

#[test]
fn required_starttls_does_not_downgrade_or_transmit_credentials() {
    use lettre::Transport;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        time::Duration,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let relay = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(8)))
            .unwrap();
        socket.write_all(b"220 localhost\r\n").unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.starts_with("EHLO "));
        socket
            .write_all(b"250-localhost\r\n250 AUTH PLAIN LOGIN\r\n")
            .unwrap();
        let mut rest = String::new();
        while reader.read_line(&mut rest).unwrap_or(0) > 0 {
            if rest.ends_with("QUIT\r\n") {
                break;
            }
        }
        assert!(!rest.contains("AUTH"));
        assert!(!rest.contains("MAIL FROM"));
    });
    let config = SmtpConfig::parse(
        "127.0.0.1",
        &port.to_string(),
        Some("starttls"),
        Some("relay-user"),
        Some("relay-pass"),
    )
    .unwrap();
    let mail = lettre::Message::builder()
        .from("a@example.test".parse().unwrap())
        .to("b@example.test".parse().unwrap())
        .body("test".to_owned())
        .unwrap();
    assert!(config.transport().unwrap().send(&mail).is_err());
    relay.join().unwrap();
}

#[tokio::test]
async fn magic_email_authenticates_to_local_relay_before_delivery() {
    authenticated_magic_email(false).await;
}

#[tokio::test]
async fn magic_email_supports_login_only_relays() {
    authenticated_magic_email(true).await;
}

async fn authenticated_magic_email(login_only: bool) {
    use axum::{body::Body, http::Request};
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        time::Duration,
    };
    use tower::ServiceExt;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let relay = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(8)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(8)))
            .unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        socket.write_all(b"220 localhost test relay\r\n").unwrap();
        let mut authenticated = false;
        let mut delivered = false;
        let mut data = false;
        let mut body = String::new();
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap() == 0 {
                break;
            }
            let reply = if data {
                if line == ".\r\n" {
                    data = false;
                    delivered = true;
                    "250 queued\r\n"
                } else {
                    body.push_str(&line);
                    continue;
                }
            } else if line.starts_with("EHLO ") {
                if login_only {
                    "250-localhost\r\n250 AUTH LOGIN\r\n"
                } else {
                    "250-localhost\r\n250 AUTH PLAIN LOGIN\r\n"
                }
            } else if line == "AUTH LOGIN\r\n" {
                socket.write_all(b"334 VXNlcm5hbWU6\r\n").unwrap();
                let mut username = String::new();
                reader.read_line(&mut username).unwrap();
                socket.write_all(b"334 UGFzc3dvcmQ6\r\n").unwrap();
                let mut password = String::new();
                reader.read_line(&mut password).unwrap();
                authenticated = username.trim_end() == "cmVsYXktdXNlcg=="
                    && password.trim_end() == "cmVsYXktcGFzcw==";
                if authenticated {
                    "235 authenticated\r\n"
                } else {
                    "535 invalid credentials\r\n"
                }
            } else if line.starts_with("AUTH PLAIN ") {
                authenticated = line.trim_end() == "AUTH PLAIN AHJlbGF5LXVzZXIAcmVsYXktcGFzcw==";
                if authenticated {
                    "235 authenticated\r\n"
                } else {
                    "535 invalid credentials\r\n"
                }
            } else if line.starts_with("MAIL FROM:") || line.starts_with("RCPT TO:") {
                if authenticated {
                    "250 ok\r\n"
                } else {
                    "530 authentication required\r\n"
                }
            } else if line == "DATA\r\n" && authenticated {
                data = true;
                "354 end with dot\r\n"
            } else if line == "QUIT\r\n" {
                break;
            } else {
                "500 unsupported\r\n"
            };
            socket.write_all(reply.as_bytes()).unwrap();
            if delivered {
                break;
            }
        }
        (authenticated, delivered, body)
    });
    let db = shortener::store::Store::open(":memory:", "example.com").unwrap();
    db.create_user("member@example.test", "2026-11-14T17:00:00.000Z")
        .unwrap();
    let mut state = shortener::http::AppState::new(db);
    state.smtp = SmtpConfig::parse(
        "127.0.0.1",
        &port.to_string(),
        Some("plain"),
        Some("relay-user"),
        Some("relay-pass"),
    )
    .unwrap();
    let response = shortener::http::router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/magic-link")
                .header("origin", "http://localhost:3000")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":"member@example.test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let (authenticated, delivered, body) = relay.join().unwrap();
    assert!(
        authenticated,
        "relay must receive configured AUTH credentials"
    );
    assert!(
        delivered,
        "relay must accept actual DATA after authentication"
    );
    assert!(body.contains("/auth/verify?token="));
    assert!(!body.contains("relay-pass"));
}
