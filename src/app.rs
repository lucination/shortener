//! Native Loco application hooks own configuration, boot, routes and worker lifecycle.
use crate::{http::AppState, store::Store};
use async_trait::async_trait;
use loco_rs::{
    Result,
    app::{AppContext, Hooks},
    bgworker::Queue,
    boot::{BootResult, StartMode, create_app},
    config::Config,
    controller::AppRoutes,
    environment::Environment,
    task::Tasks,
};
use std::sync::Arc;
pub struct App;
struct CleanupWorker {
    stop: tokio::sync::watch::Sender<bool>,
    task: tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}
fn fail(e: impl ToString) -> loco_rs::Error {
    loco_rs::Error::Message(e.to_string())
}
#[async_trait]
impl Hooks for App {
    fn app_name() -> &'static str {
        "shortener"
    }
    fn app_version() -> String {
        env!("CARGO_PKG_VERSION").into()
    }
    async fn boot(
        mode: StartMode,
        environment: &Environment,
        config: Config,
    ) -> Result<BootResult> {
        create_app::<Self>(mode, environment, config).await
    }
    fn routes(_ctx: &AppContext) -> AppRoutes {
        AppRoutes::with_default_routes()
    }
    async fn after_context(ctx: AppContext) -> Result<AppContext> {
        let state = if ctx.environment == Environment::Test {
            AppState::new(Store::open(":memory:", "example.com").map_err(fail)?)
        } else {
            let env =
                |key: &str| std::env::var(key).map_err(|_| fail(format!("{key} is required")));
            let domain = crate::domain::HostName::parse(
                &std::env::var("SHORT_DOMAIN").unwrap_or_else(|_| "example.com".into()),
            )
            .map_err(fail)?
            .as_str()
            .to_owned();
            let db = Store::open(&env("DATABASE_PATH")?, &domain).map_err(fail)?;
            let mut s = AppState::new(db);
            s.origin = env("APP_ORIGIN")?;
            let parsed = url::Url::parse(&s.origin).map_err(fail)?;
            if parsed.path() != "/"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || !matches!(parsed.scheme(), "http" | "https")
                || parsed.host_str().is_none()
            {
                return Err(fail(
                    "APP_ORIGIN must be an HTTP(S) origin without path/query/credentials",
                ));
            }
            if parsed.scheme() != "https"
                && !matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
            {
                return Err(fail("non-local APP_ORIGIN requires HTTPS"));
            }
            s.origin = parsed.origin().ascii_serialization();
            s.domain = domain;
            s.geoip = crate::geoip::GeoIp::open(
                std::env::var("GEOIP_MMDB")
                    .ok()
                    .as_deref()
                    .map(std::path::Path::new),
            )
            .map_err(fail)?;
            s.global_retention_days = crate::domain::global_retention_days(
                std::env::var("GLOBAL_RETENTION_DAYS").ok().as_deref(),
            )
            .map_err(fail)?;
            s.admin_token = env("ADMIN_TOKEN")?;
            s.analytics_secret = env("ANALYTICS_SECRET")?;
            if s.admin_token.len() < 32 || s.analytics_secret.len() < 32 {
                return Err(fail(
                    "ADMIN_TOKEN and ANALYTICS_SECRET must contain at least 32 bytes",
                ));
            }
            s.static_dir = std::env::var("STATIC_DIR")
                .unwrap_or_else(|_| "web/build".into())
                .into();
            let smtp_env = |key: &str| -> Result<Option<String>> {
                match std::env::var(key) {
                    Ok(value) => Ok(Some(value)),
                    Err(std::env::VarError::NotPresent) => Ok(None),
                    Err(_) => Err(fail(format!("{key} must contain valid Unicode"))),
                }
            };
            s.smtp = crate::smtp::SmtpConfig::parse(
                smtp_env("SMTP_HOST")?.as_deref().unwrap_or("127.0.0.1"),
                smtp_env("SMTP_PORT")?.as_deref().unwrap_or("1025"),
                smtp_env("SMTP_SECURITY")?.as_deref(),
                smtp_env("SMTP_USERNAME")?.as_deref(),
                smtp_env("SMTP_PASSWORD")?.as_deref(),
            )
            .map_err(fail)?;
            s.smtp_from =
                std::env::var("SMTP_FROM").unwrap_or_else(|_| format!("login@{}", s.domain));
            s.trusted_proxies = std::env::var("TRUSTED_PROXIES")
                .unwrap_or_default()
                .split(',')
                .filter(|v| !v.trim().is_empty())
                .map(|v| v.trim().parse())
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(fail)?;
            if let Ok(origin) = std::env::var("DEV_VITE_ORIGIN") {
                s.configure_dev_proxy(&origin, &ctx.environment)
                    .map_err(fail)?;
            }
            s
        };
        ctx.shared_store.insert(state);
        Ok(ctx)
    }
    async fn after_routes(router: axum::Router, ctx: &AppContext) -> Result<axum::Router> {
        Ok(router.merge(crate::http::router(
            ctx.shared_store
                .get::<AppState>()
                .ok_or_else(|| fail("missing application state"))?,
        )))
    }
    async fn before_run(ctx: &AppContext) -> Result<()> {
        if ctx.environment == Environment::Test {
            return Ok(());
        }
        let state = ctx
            .shared_store
            .get::<AppState>()
            .ok_or_else(|| fail("missing application state"))?;
        let (stop, mut rx) = tokio::sync::watch::channel(false);
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                tokio::select! {
                 _=rx.changed()=>break,
                 _=interval.tick()=>{let db=state.store.clone();let result=tokio::task::spawn_blocking(move||{let now=crate::domain::instant(chrono::Utc::now());db.cleanup(&now,state.global_retention_days)}).await;if let Err(e)=result{tracing::error!(error=%e,"cleanup worker failed");}},
                }
            }
        });
        ctx.shared_store.insert(Arc::new(CleanupWorker {
            stop,
            task: tokio::sync::Mutex::new(Some(task)),
        }));
        Ok(())
    }
    async fn on_shutdown(ctx: &AppContext) {
        if let Some(w) = ctx.shared_store.get::<Arc<CleanupWorker>>() {
            let _ = w.stop.send(true);
            if let Some(task) = w.task.lock().await.take() {
                if tokio::time::timeout(std::time::Duration::from_secs(10), task)
                    .await
                    .is_err()
                {
                    tracing::error!("cleanup shutdown timed out");
                }
            }
        }
    }
    async fn connect_workers(_ctx: &AppContext, _queue: &Queue) -> Result<()> {
        Ok(())
    }
    fn register_tasks(_tasks: &mut Tasks) {}
}
pub async fn test_boot() -> Result<axum::Router> {
    let config = Config::new(&Environment::Development)?;
    App::boot(StartMode::ServerOnly, &Environment::Test, config)
        .await?
        .router
        .ok_or_else(|| fail("missing router"))
}
