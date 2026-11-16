//! Stateless functional policy. Construct validated values before any effects.
use url::Url;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Destination(Url);
impl Destination {
    pub fn parse(value: &str) -> Result<Self, String> {
        let url = Url::parse(value).map_err(|_| "invalid destination")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || value.len() > 8192
        {
            return Err("destination must be an HTTP(S) URL without credentials".into());
        }
        Ok(Self(url))
    }
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}
pub fn destination(value: &str) -> Result<String, String> {
    Destination::parse(value).map(|d| d.as_str().into())
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostName(String);
impl HostName {
    pub fn parse(value: &str) -> Result<Self, String> {
        let u = Url::parse(&format!("http://{value}")).map_err(|_| "invalid host")?;
        if u.path() != "/"
            || u.query().is_some()
            || u.fragment().is_some()
            || !u.username().is_empty()
            || u.password().is_some()
            || value.trim() != value
        {
            return Err("invalid host".into());
        }
        Ok(Self(
            u.host_str().ok_or("missing host")?.to_ascii_lowercase(),
        ))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Alias(String);
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasskeyName(String);
impl PasskeyName {
    pub fn parse(value: &str) -> Result<Self, String> {
        let name = value.trim();
        if !(1..=80).contains(&name.chars().count()) || name.chars().any(char::is_control) {
            return Err("passkey name must be 1..80 characters without control characters".into());
        }
        Ok(Self(name.into()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
/// Exact raw path: never percent-decode or normalize an ownership boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManagementPage {
    Statistics(Alias),
    Edit(Alias),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManagementRoute {
    Unrelated,
    Invalid,
    Creator(ManagementPage),
}
impl ManagementRoute {
    pub fn parse(path: &str) -> Self {
        // Classify malformed separators without normalizing them for admission.
        // `/v/{short}` remains the native preview namespace, even for codes named edit/statistics.
        let mut parts = path.split('/').filter(|part| !part.is_empty());
        let code = parts.next();
        let suffix = parts.next();
        if code != Some("v") && matches!(suffix, Some("statistics" | "edit")) {
            ManagementPage::parse(path)
                .map(Self::Creator)
                .unwrap_or(Self::Invalid)
        } else {
            Self::Unrelated
        }
    }
}
impl ManagementPage {
    pub fn parse(path: &str) -> Option<Self> {
        let (code, suffix) = path.strip_prefix('/')?.split_once('/')?;
        let alias = Alias::parse(code).ok()?;
        match suffix {
            "statistics" => Some(Self::Statistics(alias)),
            "edit" => Some(Self::Edit(alias)),
            _ => None,
        }
    }
    pub fn alias(&self) -> &Alias {
        match self {
            Self::Statistics(alias) | Self::Edit(alias) => alias,
        }
    }
}
impl Alias {
    pub fn parse(value: &str) -> Result<Self, String> {
        const RESERVED: &[&str] = &[
            "api",
            "auth",
            "v",
            "_",
            "_app",
            "admin",
            "assets",
            "fonts",
            "favicon",
            "robots",
            "index",
            "index.html",
            "login",
            "account",
            "links",
        ];
        if value.is_empty()
            || value.len() > 64
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || RESERVED.contains(&value.to_ascii_lowercase().as_str())
        {
            return Err("invalid or reserved alias".into());
        }
        Ok(Self(value.into()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClickLimit(std::num::NonZeroU32);
impl ClickLimit {
    pub fn parse(n: i32) -> Result<Self, String> {
        u32::try_from(n)
            .ok()
            .and_then(std::num::NonZeroU32::new)
            .map(Self)
            .ok_or_else(|| "click_limit must be positive".into())
    }
    pub fn get(self) -> i32 {
        self.0.get() as i32
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionDays(u16);
impl RetentionDays {
    pub fn parse(n: i32) -> Result<Self, String> {
        if (1..=3650).contains(&n) {
            Ok(Self(n as u16))
        } else {
            Err("retention_days must be 1..3650".into())
        }
    }
    pub fn get(self) -> i32 {
        i32::from(self.0)
    }
}
#[derive(Debug, Clone)]
pub struct NewLink {
    pub(crate) destination: Destination,
    pub(crate) alias: Option<Alias>,
    pub(crate) title: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) password: Option<String>,
    pub(crate) expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub(crate) click_limit: Option<ClickLimit>,
    pub(crate) interstitial: bool,
    pub(crate) query_mode: crate::dto::QueryMode,
    pub(crate) retention: Option<RetentionDays>,
}
impl TryFrom<crate::dto::LinkInput> for NewLink {
    type Error = String;
    fn try_from(i: crate::dto::LinkInput) -> Result<Self, String> {
        if i.title.as_ref().is_some_and(|s| s.len() > 300)
            || i.description.as_ref().is_some_and(|s| s.len() > 4000)
            || i.password
                .as_ref()
                .is_some_and(|p| p.len() < 8 || p.len() > 1024)
        {
            return Err("title/description/password length outside permitted bounds".into());
        }
        Ok(Self {
            destination: Destination::parse(&i.destination)?,
            alias: i.alias.as_deref().map(Alias::parse).transpose()?,
            title: i.title,
            description: i.description,
            password: i.password,
            expires_at: i.expires_at.as_deref().map(parse_instant).transpose()?,
            click_limit: i.click_limit.map(ClickLimit::parse).transpose()?,
            interstitial: i.interstitial,
            query_mode: i.query_mode,
            retention: i.retention_days.map(RetentionDays::parse).transpose()?,
        })
    }
}
pub fn parse_instant(s: &str) -> Result<chrono::DateTime<chrono::Utc>, String> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&chrono::Utc))
        .map_err(|_| "invalid RFC3339 instant".into())
}
pub fn instant(d: chrono::DateTime<chrono::Utc>) -> String {
    d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn merge_query(
    destination: &str,
    incoming: &str,
    mode: crate::dto::QueryMode,
) -> Result<String, String> {
    use crate::dto::QueryMode;
    let mut url = Destination::parse(destination)?.0;
    if mode == QueryMode::Discard || incoming.is_empty() {
        return Ok(url.to_string());
    }
    let dest: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let added: Vec<(String, String)> = url::form_urlencoded::parse(incoming.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let pairs: Vec<_> = match mode {
        QueryMode::Preserve => dest
            .iter()
            .cloned()
            .chain(
                added
                    .iter()
                    .filter(|(k, _)| !dest.iter().any(|(d, _)| d == k))
                    .cloned(),
            )
            .collect(),
        QueryMode::Override => dest
            .iter()
            .filter(|(k, _)| !added.iter().any(|(a, _)| a == k))
            .cloned()
            .chain(added.iter().cloned())
            .collect(),
        QueryMode::Discard => unreachable!(),
    };
    url.set_query(None);
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    Ok(url.to_string())
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerState {
    Active,
    Suspended,
    Deleted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisitIntent {
    Resolve,
    Preview,
    Continue,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantStatus {
    Missing,
    Verified,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VisitDecision {
    Hidden,
    PasswordRequired,
    Preview(Destination),
    Outgoing(Destination),
}
enum DisclosureGate {
    Open,
    Password,
}
enum Presentation {
    Direct,
    Interstitial,
}
enum Availability {
    Hidden,
    Live {
        destination: Destination,
        gate: DisclosureGate,
        presentation: Presentation,
    },
}
pub struct LinkPolicy(Availability);
impl LinkPolicy {
    pub fn observe(
        link: &crate::dto::Link,
        owner: OwnerState,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<Self, String> {
        let expires = link.expires_at.as_deref().map(parse_instant).transpose()?;
        let limit = link.click_limit.map(ClickLimit::parse).transpose()?;
        if link.human_clicks < 0 {
            return Err("invalid persisted click count".into());
        }
        if owner != OwnerState::Active
            || !link.enabled
            || link.deleted_at.is_some()
            || expires.is_some_and(|t| t <= now)
            || limit.is_some_and(|l| link.human_clicks >= l.get())
        {
            return Ok(Self(Availability::Hidden));
        }
        Ok(Self(Availability::Live {
            destination: Destination::parse(&link.destination)?,
            gate: if link.password_protected {
                DisclosureGate::Password
            } else {
                DisclosureGate::Open
            },
            presentation: if link.interstitial {
                Presentation::Interstitial
            } else {
                Presentation::Direct
            },
        }))
    }
    pub fn decide(&self, grant: GrantStatus, intent: VisitIntent) -> VisitDecision {
        match &self.0 {
            Availability::Hidden => VisitDecision::Hidden,
            Availability::Live {
                gate: DisclosureGate::Password,
                ..
            } if grant != GrantStatus::Verified => VisitDecision::PasswordRequired,
            Availability::Live {
                destination,
                presentation,
                ..
            } => {
                if intent == VisitIntent::Preview
                    || (matches!(presentation, Presentation::Interstitial)
                        && intent == VisitIntent::Resolve)
                {
                    VisitDecision::Preview(destination.clone())
                } else {
                    VisitDecision::Outgoing(destination.clone())
                }
            }
        }
    }
}

pub fn global_retention_days(value: Option<&str>) -> Result<i32, String> {
    let Some(value) = value else {
        return Ok(90);
    };
    let n: i32 = value
        .parse()
        .map_err(|_| "GLOBAL_RETENTION_DAYS must be positive (1..=3650)")?;
    RetentionDays::parse(n).map(RetentionDays::get)
}
