//! Persistence/aggregation shell; classification and privacy transforms are pure.
use crate::{
    dto::*,
    store::{DbResult, Store},
};
use hmac::{Hmac, Mac};
use rusqlite::{Connection, params};
use sha2::Sha256;

#[derive(Debug, Clone)]
pub struct Observation {
    pub ip: String,
    pub user_agent: String,
    pub referrer: Option<String>,
}
pub fn classify(ua: &str) -> EventKind {
    let ua = ua.to_ascii_lowercase();
    if [
        "facebookexternalhit",
        "twitterbot",
        "slackbot",
        "discordbot",
        "telegrambot",
        "whatsapp",
        "linkedinbot",
    ]
    .iter()
    .any(|v| ua.contains(v))
    {
        EventKind::LinkPreview
    } else if ["bot", "crawler", "spider", "curl/", "wget/", "headless"]
        .iter()
        .any(|v| ua.contains(v))
    {
        EventKind::Bot
    } else {
        EventKind::Human
    }
}
pub fn dimensions(ua: &str) -> (String, String, String) {
    let u = ua.to_ascii_lowercase();
    let browser = if u.contains("firefox/") {
        "Firefox"
    } else if u.contains("edg/") {
        "Edge"
    } else if u.contains("chrome/") {
        "Chrome"
    } else if u.contains("safari/") {
        "Safari"
    } else {
        "Unknown"
    };
    let os = if u.contains("android") {
        "Android"
    } else if u.contains("iphone") || u.contains("ipad") {
        "iOS"
    } else if u.contains("windows") {
        "Windows"
    } else if u.contains("mac os") {
        "macOS"
    } else if u.contains("linux") {
        "Linux"
    } else {
        "Unknown"
    };
    let device = if u.contains("ipad") || u.contains("tablet") {
        "Tablet"
    } else if u.contains("mobile") || u.contains("iphone") || u.contains("android") {
        "Mobile"
    } else if os != "Unknown" {
        "Desktop"
    } else {
        "Unknown"
    };
    (browser.into(), os.into(), device.into())
}
fn err(e: rusqlite::Error) -> String {
    e.to_string()
}
impl Store {
    pub fn links(&self, owner: Option<i32>) -> DbResult<LinkList> {
        self.read(|db|{
  let ids=db.prepare("SELECT id FROM links WHERE (? IS NULL OR owner_id=?) AND (? IS NULL OR deleted_at IS NULL) ORDER BY id DESC").map_err(err)?.query_map(params![owner,owner,owner],|r|r.get::<_,i32>(0)).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
  let items=ids.into_iter().map(|id|crate::store::get_link(db,id)).collect::<Result<Vec<_>,_>>()?;Ok(LinkList{total:items.len() as i32,items})
 })
    }
    pub fn record_event(
        &self,
        link: &Link,
        address_id: i32,
        kind: EventKind,
        o: &Observation,
        now: &str,
        secret: &str,
    ) -> DbResult<()> {
        self.record_event_with_location(
            link,
            address_id,
            kind,
            o,
            now,
            secret,
            &crate::geoip::Location::default(),
        )
    }
    pub fn record_event_with_location(
        &self,
        link: &Link,
        address_id: i32,
        kind: EventKind,
        o: &Observation,
        now: &str,
        secret: &str,
        location: &crate::geoip::Location,
    ) -> DbResult<()> {
        self.with(|db|{
  let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
  let (browser,os,device)=dimensions(&o.user_agent);let day=&now[..10];
  let kind_str=serde_json::to_value(&kind).unwrap().as_str().unwrap().to_string();
  tx.execute("INSERT INTO events(link_id,address_id,occurred_at,kind,ip,user_agent,referrer,browser,os,device,country,city)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",params![link.id,address_id,now,kind_str,o.ip,o.user_agent,o.referrer,browser,os,device,location.country,location.city]).map_err(err)?;
  let mut mac=Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|e|e.to_string())?;for part in [&o.ip,&o.user_agent,day]{mac.update(part.as_bytes());mac.update(&[0]);}let hash=hex::encode(mac.finalize().into_bytes());
  let unique=if kind==EventKind::Human{tx.execute("INSERT OR IGNORE INTO uniques VALUES(?,?,?)",params![link.id,day,hash]).map_err(err)? as i32}else{0};
  let preview=kind==EventKind::Preview;let human=kind==EventKind::Human;
  tx.execute("INSERT INTO daily(link_id,day,redirects,humans,bots,previews,daily_unique)VALUES(?,?,?,?,?,?,?) ON CONFLICT(link_id,day) DO UPDATE SET redirects=redirects+excluded.redirects,humans=humans+excluded.humans,bots=bots+excluded.bots,previews=previews+excluded.previews,daily_unique=daily_unique+excluded.daily_unique",params![link.id,day,i32::from(!preview),i32::from(human),i32::from(!human&&!preview),i32::from(preview),unique]).map_err(err)?;
  let referrer=o.referrer.as_deref().and_then(|s|url::Url::parse(s).ok()).and_then(|u|u.host_str().map(str::to_owned)).unwrap_or_else(||"Direct / unknown".into());
  for (dimension,label) in [("referrer",referrer),("country",location.country.clone().unwrap_or_else(||"Unknown".into())),("device",device)]{tx.execute("INSERT INTO breakdown(link_id,day,dimension,label,count)VALUES(?,?,?,?,1) ON CONFLICT(link_id,day,dimension,label)DO UPDATE SET count=count+1",params![link.id,day,dimension,label]).map_err(err)?;}
  tx.commit().map_err(err)
 })
    }
    pub fn events(&self, link: Option<i32>) -> DbResult<EventList> {
        self.events_between(link, "0001-01-01", "9999-12-31")
    }
    pub fn events_between(&self, link: Option<i32>, from: &str, to: &str) -> DbResult<EventList> {
        let first =
            chrono::NaiveDate::parse_from_str(from, "%Y-%m-%d").map_err(|_| "invalid from date")?;
        let last =
            chrono::NaiveDate::parse_from_str(to, "%Y-%m-%d").map_err(|_| "invalid to date")?;
        if first > last {
            return Err("invalid date range".into());
        }
        self.read(|db|{
  let total=db.query_row("SELECT count(*) FROM events WHERE (? IS NULL OR link_id=?) AND substr(occurred_at,1,10)>=? AND substr(occurred_at,1,10)<=?",params![link,link,from,to],|r|r.get(0)).map_err(err)?;
  let items=db.prepare("SELECT id,link_id,address_id,occurred_at,kind,ip,user_agent,referrer,country,city,browser,os,device FROM events WHERE (? IS NULL OR link_id=?) AND substr(occurred_at,1,10)>=? AND substr(occurred_at,1,10)<=? ORDER BY id DESC LIMIT 1000").map_err(err)?.query_map(params![link,link,from,to],|r|{
   let kind:String=r.get(4)?;Ok(ClickEvent{id:r.get(0)?,link_id:r.get(1)?,address_id:r.get(2)?,occurred_at:r.get(3)?,kind:serde_json::from_value(serde_json::Value::String(kind)).map_err(|e|rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,ip:r.get(5)?,user_agent:r.get(6)?,referrer:r.get(7)?,country:r.get(8)?,city:r.get(9)?,browser:r.get(10)?,os:r.get(11)?,device:r.get(12)?})
  }).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;Ok(EventList{items,total})
 })
    }
    pub fn stats(&self, id: i32, from: &str, to: &str) -> DbResult<LinkStats> {
        let f =
            chrono::NaiveDate::parse_from_str(from, "%Y-%m-%d").map_err(|_| "invalid from date")?;
        let t = chrono::NaiveDate::parse_from_str(to, "%Y-%m-%d").map_err(|_| "invalid to date")?;
        if f > t || (t - f).num_days() > 3660 {
            return Err("invalid date range".into());
        }
        self.read(|db|{
   let daily:Vec<DailyStat>=db.prepare("SELECT day,redirects,humans,bots,previews,daily_unique FROM daily WHERE link_id=? AND day>=? AND day<=? ORDER BY day").map_err(err)?.query_map(params![id,from,to],|r|Ok(DailyStat{date:r.get(0)?,redirects:r.get(1)?,humans:r.get(2)?,bots:r.get(3)?,previews:r.get(4)?,daily_unique:r.get(5)?})).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
   let mut stats=LinkStats{link_id:id,from:from.into(),to:to.into(),redirects:daily.iter().map(|d|d.redirects).sum(),humans:daily.iter().map(|d|d.humans).sum(),bots:daily.iter().map(|d|d.bots).sum(),previews:daily.iter().map(|d|d.previews).sum(),daily,referrers:vec![],countries:vec![],devices:vec![]};
   stats.referrers=breakdown(db,id,from,to,"referrer")?;stats.countries=breakdown(db,id,from,to,"country")?;stats.devices=breakdown(db,id,from,to,"device")?;Ok(stats)
  })
    }
    pub fn usage(&self) -> DbResult<Usage> {
        self.read(|db| {
            let count = |q: &str| db.query_row(q, [], |r| r.get::<_, i32>(0)).map_err(err);
            Ok(Usage {
                users: count("SELECT count(*)FROM users")?,
                links: count("SELECT count(*)FROM links")?,
                redirects: count("SELECT COALESCE(sum(redirects),0)FROM daily")?,
                raw_events: count("SELECT count(*)FROM events")?,
            })
        })
    }
    pub fn cleanup(&self, now: &str, global: i32) -> DbResult<usize> {
        crate::domain::RetentionDays::parse(global)?;
        self.with(|db|{
  let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
  // Aggregation is committed when events are inserted, before pruning ever runs.
  let n=tx.execute("DELETE FROM events WHERE id IN(SELECT e.id FROM events e JOIN links l ON l.id=e.link_id JOIN users u ON u.id=l.owner_id WHERE julianday(e.occurred_at)<julianday(?)-COALESCE(l.retention_days,u.retention_days,?) LIMIT 1000)",params![now,global]).map_err(err)?;
  for table in ["sessions","magic_tokens","grants","challenges","discoverable_challenges"]{tx.execute(&format!("DELETE FROM {table} WHERE expires_at<=?"),[now]).map_err(err)?;}
  tx.execute("DELETE FROM uniques WHERE day<date(?,'-2 days')",[now]).map_err(err)?;
  tx.execute("DELETE FROM rate_limits WHERE window<CAST(strftime('%s',?)AS INTEGER)/60-2",[now]).map_err(err)?;
  tx.commit().map_err(err)?;Ok(n)
 })
    }
}
fn breakdown(
    db: &Connection,
    id: i32,
    from: &str,
    to: &str,
    dimension: &str,
) -> DbResult<Vec<Breakdown>> {
    db.prepare("SELECT label,sum(count)AS total FROM breakdown WHERE link_id=? AND day>=? AND day<=? AND dimension=? GROUP BY label ORDER BY total DESC,label LIMIT 20").map_err(err)?.query_map(params![id,from,to,dimension],|r|Ok(Breakdown{label:r.get(0)?,count:r.get(1)?})).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)
}
