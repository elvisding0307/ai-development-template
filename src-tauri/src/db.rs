use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
pub const SCHEMA_VERSION: i64 = 1;
pub const APPLICATION_ID: i64 = 1279414866;
pub struct Store {
    pub path: PathBuf,
    connection: Mutex<Connection>,
    maintaining: AtomicBool,
}
impl Store {
    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open(&path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        let app: i64 = conn.pragma_query_value(None, "application_id", |r| r.get(0))?;
        if version == 0 && app == 0 {
            let tables: i64 = conn.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0))?;
            if tables != 0 {
                return Err(AppError::new(
                    "incompatible",
                    "数据库不属于本应用，已停止启动",
                ));
            }
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("schema.sql"))?;
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            tx.pragma_update(None, "application_id", APPLICATION_ID)?;
            tx.commit()?;
        } else if version != SCHEMA_VERSION || app != APPLICATION_ID {
            return Err(AppError::new(
                "incompatible",
                "数据库版本不兼容，已停止启动，请保留原始数据",
            ));
        }
        Ok(Self {
            path,
            connection: Mutex::new(conn),
            maintaining: AtomicBool::new(false),
        })
    }
    pub fn with_conn<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        if self.maintaining.load(Ordering::SeqCst) {
            return Err(AppError::new("maintenance", "正在备份或恢复，请稍后重试"));
        }
        let mut conn = self
            .connection
            .lock()
            .map_err(|_| AppError::new("storage", "数据库状态异常，请重启客户端"))?;
        if self.maintaining.load(Ordering::SeqCst) {
            return Err(AppError::new("maintenance", "正在备份或恢复，请稍后重试"));
        }
        f(&mut conn)
    }
    pub fn with_maintenance<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        if self.maintaining.swap(true, Ordering::SeqCst) {
            return Err(AppError::new("maintenance", "已有备份或恢复任务正在执行"));
        }
        struct Reset<'a>(&'a AtomicBool);
        impl Drop for Reset<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _reset = Reset(&self.maintaining);
        let mut conn = self
            .connection
            .lock()
            .map_err(|_| AppError::new("storage", "数据库状态异常，请重启客户端"))?;
        f(&mut conn)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_and_reopens_database() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("library.sqlite");
        drop(Store::open(&p).unwrap());
        let s = Store::open(p).unwrap();
        s.with_conn(|c| {
            let n: i64 = c.query_row("SELECT count(*) FROM books", [], |r| r.get(0))?;
            assert_eq!(n, 0);
            Ok(())
        })
        .unwrap();
    }
    #[test]
    fn refuses_foreign_database() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("other.sqlite");
        let c = Connection::open(&p).unwrap();
        c.execute_batch("CREATE TABLE unrelated(id INTEGER)")
            .unwrap();
        drop(c);
        assert!(Store::open(p).is_err());
    }
}
