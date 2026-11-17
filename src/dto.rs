//! Wire-only types. Domain policy never depends on HTTP or database state.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum QueryMode {
    #[default]
    Discard,
    Preserve,
    Override,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Message {
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Address {
    pub id: i32,
    pub domain_id: i32,
    pub domain: String,
    pub short_code: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct User {
    pub id: i32,
    pub email: String,
    pub verified_at: Option<String>,
    pub suspended: bool,
    pub deleted_at: Option<String>,
    pub retention_days: Option<i32>,
    pub link_quota: Option<i32>,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Link {
    pub id: i32,
    pub owner_id: i32,
    pub destination: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub deleted_at: Option<String>,
    pub expires_at: Option<String>,
    pub click_limit: Option<i32>,
    pub human_clicks: i32,
    pub password_protected: bool,
    pub interstitial: bool,
    pub query_mode: QueryMode,
    pub retention_days: Option<i32>,
    pub created_at: String,
    pub addresses: Vec<Address>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LinkInput {
    pub destination: String,
    pub alias: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub password: Option<String>,
    pub expires_at: Option<String>,
    pub click_limit: Option<i32>,
    #[serde(default)]
    pub interstitial: bool,
    #[serde(default)]
    pub query_mode: QueryMode,
    pub retention_days: Option<i32>,
}
// PATCH is a JSON object boundary: Option<Option<T>> has a custom deserializer to preserve null.
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<Option<T>>, D::Error> {
    Ok(Some(Option::<T>::deserialize(d)?))
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct LinkPatch {
    // Compatibility assertion only; never changes the existing address.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub alias: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub destination: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub interstitial: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub query_mode: Option<QueryMode>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub title: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub description: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub password: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub expires_at: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub click_limit: Option<Option<i32>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub retention_days: Option<Option<i32>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LinkList {
    pub items: Vec<Link>,
    pub total: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UserList {
    pub items: Vec<User>,
    pub total: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ClickEvent {
    pub id: i32,
    pub link_id: i32,
    pub address_id: i32,
    pub occurred_at: String,
    pub kind: EventKind,
    pub ip: String,
    pub user_agent: String,
    pub referrer: Option<String>,
    pub country: Option<String>,
    pub city: Option<String>,
    pub browser: String,
    pub os: String,
    pub device: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Human,
    Bot,
    LinkPreview,
    Preview,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EventList {
    pub items: Vec<ClickEvent>,
    pub total: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DailyStat {
    pub date: String,
    pub redirects: i32,
    pub humans: i32,
    pub bots: i32,
    pub previews: i32,
    pub daily_unique: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Breakdown {
    pub label: String,
    pub count: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LinkStats {
    pub link_id: i32,
    pub from: String,
    pub to: String,
    pub redirects: i32,
    pub humans: i32,
    pub bots: i32,
    pub previews: i32,
    pub daily: Vec<DailyStat>,
    pub referrers: Vec<Breakdown>,
    pub countries: Vec<Breakdown>,
    pub devices: Vec<Breakdown>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BulkInput {
    pub items: Vec<BulkRow>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum BulkRow {
    Link(LinkInput),
    Invalid(serde_json::Value),
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum BulkResult {
    Created { index: i32, link: Link },
    Failed { index: i32, error: ErrorBody },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BulkResponse {
    pub items: Vec<BulkResult>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BulkAction {
    Enable,
    Disable,
    Delete,
    Expiration { expires_at: Option<String> },
    Retention { retention_days: Option<i32> },
    Domain { domain_id: i32 },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BulkUpdate {
    pub ids: Vec<i32>,
    pub action: BulkAction,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BulkUpdateResponse {
    pub updated: Vec<i32>,
    pub items: Vec<BulkUpdateResult>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum BulkUpdateResult {
    Updated {
        index: i32,
        id: i32,
    },
    Failed {
        index: i32,
        id: i32,
        error: ErrorBody,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EmailInput {
    pub email: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TokenInput {
    pub token: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PasswordInput {
    pub password: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct AccountPatch {
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub retention_days: Option<Option<i32>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UserInput {
    pub email: String,
    pub retention_days: Option<i32>,
    pub link_quota: Option<i32>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct UserPatch {
    pub suspended: Option<bool>,
    pub deleted: Option<bool>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub retention_days: Option<Option<i32>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub link_quota: Option<Option<i32>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Usage {
    pub users: i32,
    pub links: i32,
    pub redirects: i32,
    pub raw_events: i32,
}
// Browser WebAuthn JSON follows W3C, cryptographic validation is performed by webauthn-rs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PasskeyOptions {
    pub challenge_id: String,
    pub public_key: serde_json::Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PasskeyVerify {
    pub challenge_id: String,
    pub credential: serde_json::Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PasskeyEnrollment {
    pub challenge_id: String,
    pub credential: serde_json::Value,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PasskeySummary {
    pub id: i32,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PasskeyList {
    pub items: Vec<PasskeySummary>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PasskeyRename {
    pub name: String,
}

pub fn export_types() -> Result<String, ts_rs::ExportError> {
    let mut out = String::from("// Generated by cargo run --bin export-contracts. DO NOT EDIT.\n");
    macro_rules! emit { ($($t:ty),*) => {$({out.push_str("export "); out.push_str(&<$t>::decl()); out.push('\n');})*}; }
    emit!(
        serde_json::Value,
        QueryMode,
        ErrorBody,
        Message,
        Address,
        User,
        Link,
        LinkInput,
        LinkPatch,
        LinkList,
        UserList,
        ClickEvent,
        EventKind,
        EventList,
        DailyStat,
        Breakdown,
        LinkStats,
        BulkInput,
        BulkRow,
        BulkResult,
        BulkResponse,
        BulkAction,
        BulkUpdate,
        BulkUpdateResponse,
        BulkUpdateResult,
        EmailInput,
        TokenInput,
        PasswordInput,
        AccountPatch,
        UserInput,
        UserPatch,
        Usage,
        PasskeyOptions,
        PasskeyVerify,
        PasskeyEnrollment,
        PasskeySummary,
        PasskeyList,
        PasskeyRename
    );
    Ok(out)
}
