//! SMTP configuration is parsed once at startup; secrets have no Debug/Serialize implementation.
use lettre::transport::smtp::{
    authentication::Credentials,
    client::{Tls, TlsParameters},
};

#[derive(Clone, Copy)]
enum Security {
    Plain,
    StartTls,
    Tls,
}

#[derive(Clone)]
pub struct SmtpConfig {
    host: String,
    port: u16,
    security: Security,
    credentials: Option<Credentials>,
}

impl SmtpConfig {
    pub fn parse(
        host: &str,
        port: &str,
        security: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<Self, &'static str> {
        if host.is_empty() || host.contains(['/', '@', ':', ' ', '\r', '\n']) && host != "::1" {
            return Err("SMTP_HOST must be a hostname or IP address without a scheme or port");
        }
        let port = port
            .parse::<u16>()
            .ok()
            .filter(|p| *p != 0)
            .ok_or("SMTP_PORT must be 1..65535")?;
        let security = match security {
            Some("plain") => Security::Plain,
            Some("starttls") => Security::StartTls,
            Some("tls") => Security::Tls,
            None if host == "localhost"
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback()) =>
            {
                Security::Plain
            }
            None => {
                return Err(
                    "Remote SMTP requires explicit SMTP_SECURITY (starttls, tls, or trusted internal plain)",
                );
            }
            _ => return Err("SMTP_SECURITY must be plain, starttls, or tls"),
        };
        let credentials = match (username, password) {
            (None, None) => None,
            (Some(u), Some(p)) if !u.is_empty() && !p.is_empty() => {
                Some(Credentials::new(u.to_owned(), p.to_owned()))
            }
            _ => {
                return Err(
                    "SMTP_USERNAME and SMTP_PASSWORD must both be set and nonempty, or both absent",
                );
            }
        };
        Ok(Self {
            host: host.to_owned(),
            port,
            security,
            credentials,
        })
    }

    pub fn transport(&self) -> Result<lettre::SmtpTransport, &'static str> {
        let tls = match self.security {
            Security::Plain => Tls::None,
            Security::StartTls => Tls::Required(
                TlsParameters::new(self.host.clone()).map_err(|_| "Invalid SMTP TLS hostname")?,
            ),
            Security::Tls => Tls::Wrapper(
                TlsParameters::new(self.host.clone()).map_err(|_| "Invalid SMTP TLS hostname")?,
            ),
        };
        let mut builder = lettre::SmtpTransport::builder_dangerous(&self.host)
            .port(self.port)
            .tls(tls)
            .timeout(Some(std::time::Duration::from_secs(5)));
        if let Some(credentials) = &self.credentials {
            builder = builder.credentials(credentials.clone());
        }
        Ok(builder.build())
    }
}
