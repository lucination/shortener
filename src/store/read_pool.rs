//! Read-only WAL snapshot connections for heavy reports and listings.
//!
//! SQLite in WAL mode lets readers proceed while the single writer commits, so
//! statistics, event, usage and list queries no longer hold the writer mutex
//! that redirects (atomic human-count claims) and every write wait on.
use super::{DbResult, sql};
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

const READERS: usize = 4;

pub(super) struct ReadPool {
    conns: Vec<Mutex<Connection>>,
    next: AtomicUsize,
}

impl ReadPool {
    /// Opens readers for the writer's on-disk WAL database. Returns `None` for
    /// in-memory/temporary databases (empty filename: another connection would
    /// see a different database) and for non-WAL journals, where readers would
    /// still block on the writer and gain nothing.
    pub(super) fn open(writer: &Connection) -> DbResult<Option<Self>> {
        let mode: String = writer
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .map_err(sql)?;
        let file: String = writer
            .query_row(
                "SELECT file FROM pragma_database_list WHERE name='main'",
                [],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if !mode.eq_ignore_ascii_case("wal") || file.is_empty() {
            return Ok(None);
        }
        let conns = (0..READERS)
            .map(|_| {
                let c = Connection::open_with_flags(
                    &file,
                    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                )
                .map_err(sql)?;
                c.busy_timeout(std::time::Duration::from_secs(5))
                    .map_err(sql)?;
                c.execute_batch("PRAGMA query_only=ON;").map_err(sql)?;
                Ok(Mutex::new(c))
            })
            .collect::<DbResult<Vec<_>>>()?;
        Ok(Some(Self {
            conns,
            next: AtomicUsize::new(0),
        }))
    }

    /// Prefers an idle reader; only waits when every reader is busy.
    pub(super) fn read<T>(&self, f: impl FnOnce(&Connection) -> DbResult<T>) -> DbResult<T> {
        let start = self.next.fetch_add(1, Ordering::Relaxed);
        let idle = (0..self.conns.len())
            .find_map(|i| self.conns[(start + i) % self.conns.len()].try_lock().ok());
        let mut conn = match idle {
            Some(conn) => conn,
            None => self.conns[start % self.conns.len()]
                .lock()
                .map_err(|_| "database lock poisoned")?,
        };
        // One deferred read transaction: every statement in `f` observes the
        // same committed snapshot, as it did under the exclusive writer mutex.
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(sql)?;
        let out = f(&tx)?;
        tx.commit().map_err(sql)?;
        Ok(out)
    }
}
