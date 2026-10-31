use crate::{
    db::{Store, APPLICATION_ID, SCHEMA_VERSION},
    error::{AppError, AppResult},
    validation,
};
use chrono::{DateTime, NaiveDate};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    books: i64,
    readers: i64,
    loans: i64,
    active_loans: i64,
    schema_version: i64,
}
#[derive(Clone)]
struct Selection {
    path: PathBuf,
    digest: String,
}
static SELECTIONS: OnceLock<Mutex<HashMap<String, Selection>>> = OnceLock::new();
static COUNTER: AtomicU64 = AtomicU64::new(0);
fn nonce() -> String {
    format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}
fn invalid(message: &str) -> AppError {
    AppError::new("invalid_backup", message)
}
struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn temporary(parent: &Path) -> AppResult<Temporary> {
    let path = parent.join(format!(".qinghe-{}.partial", nonce()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(&path)?.flush()?;
    Ok(Temporary(path))
}
fn hash(path: &Path) -> AppResult<String> {
    let mut input = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
fn independent(store: &Store, path: &Path) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid("文件路径无效"))?
        .canonicalize()?;
    let candidate = parent.join(path.file_name().ok_or_else(|| invalid("文件路径无效"))?);
    let current = store.path.canonicalize()?;
    let resolved = if candidate.exists() {
        candidate.canonicalize()?
    } else {
        candidate.clone()
    };
    let active = current.to_string_lossy();
    if resolved == current
        || ["-wal", "-shm", "-journal"].iter().any(|suffix| {
            resolved.as_os_str() == std::ffi::OsStr::new(&format!("{active}{suffix}"))
        })
    {
        return Err(invalid("请选择独立备份文件，不能使用当前数据库或辅助文件"));
    }
    #[cfg(unix)]
    if candidate.exists() {
        use std::os::unix::fs::MetadataExt;
        let a = fs::metadata(&candidate)?;
        let b = fs::metadata(&current)?;
        if a.dev() == b.dev() && a.ino() == b.ino() {
            return Err(invalid("不能使用当前数据库的链接文件"));
        }
    }
    Ok(())
}
fn schema(conn: &Connection) -> AppResult<Vec<(String, String, String)>> {
    let mut stmt=conn.prepare("SELECT type,name,coalesce(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}
fn valid_date(s: &str) -> bool {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok_and(|d| d.to_string() == s)
}
fn valid_code(s: &str) -> bool {
    validation::code(s).is_ok_and(|v| v == s)
}
fn valid_text(s: &str, max: usize, required: bool) -> bool {
    validation::text(s, "backup", max, required).is_ok_and(|v| v == s)
}
fn validate(conn: &Connection) -> AppResult<Summary> {
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|_| invalid("备份文件格式损坏"))?;
    let app: i64 = conn.pragma_query_value(None, "application_id", |r| r.get(0))?;
    if app != APPLICATION_ID {
        return Err(invalid("该文件不是青禾图书管理备份"));
    }
    if version != SCHEMA_VERSION {
        return Err(AppError::new(
            "incompatible",
            "备份数据版本不兼容，请使用相同版本客户端",
        ));
    }
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        return Err(invalid("备份完整性检查失败"));
    }
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(include_str!("../schema.sql"))?;
    if schema(conn)? != schema(&reference)? {
        return Err(invalid("备份数据库结构不匹配"));
    }
    if conn.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(invalid("备份存在失效的数据关联"));
    }
    let duplicate:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM loans WHERE returned_at IS NULL GROUP BY book_id HAVING count(*)>1)",[],|r|r.get(0))?;
    if duplicate {
        return Err(invalid("备份存在重复的未归还记录"));
    }
    let mut stmt=conn.prepare("SELECT code,title,author,isbn,publisher,category,location,enabled,created_at,updated_at FROM books")?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let code: String = r.get(0)?;
        let title: String = r.get(1)?;
        if !valid_code(&code) || !valid_text(&title, 200, true) {
            return Err(invalid("备份中的馆藏编号或书名无效"));
        }
        for (i, max) in [(2, 100), (3, 32), (4, 100), (5, 50), (6, 50)] {
            if !valid_text(&r.get::<_, String>(i)?, max, false) {
                return Err(invalid("备份中的图书资料无效"));
            }
        }
        if !matches!(r.get::<_, i64>(7)?, 0 | 1) {
            return Err(invalid("备份中的启用状态无效"));
        }
        validate_times(&r.get::<_, String>(8)?, &r.get::<_, String>(9)?)?;
    }
    let mut stmt =
        conn.prepare("SELECT code,name,phone,notes,enabled,created_at,updated_at FROM readers")?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        if !valid_code(&r.get::<_, String>(0)?)
            || !valid_text(&r.get::<_, String>(1)?, 100, true)
            || !valid_text(&r.get::<_, String>(2)?, 32, false)
            || !valid_text(&r.get::<_, String>(3)?, 500, false)
            || !matches!(r.get::<_, i64>(4)?, 0 | 1)
        {
            return Err(invalid("备份中的读者资料无效"));
        }
        validate_times(&r.get::<_, String>(5)?, &r.get::<_, String>(6)?)?;
    }
    let mut stmt=conn.prepare("SELECT borrowed_at,due_date,returned_at,returned_local_date,reader_code,reader_name,book_code,book_title FROM loans")?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let borrowed: String = r.get(0)?;
        let due: String = r.get(1)?;
        let borrowed =
            DateTime::parse_from_rfc3339(&borrowed).map_err(|_| invalid("借出时间无效"))?;
        if !valid_date(&due)
            || NaiveDate::parse_from_str(&due, "%Y-%m-%d").unwrap()
                < borrowed.date_naive() - chrono::Days::new(1)
        {
            return Err(invalid("应还日期无效"));
        }
        let returned: Option<String> = r.get(2)?;
        let local: Option<String> = r.get(3)?;
        match (returned, local) {
            (Some(time), Some(date)) => {
                let time =
                    DateTime::parse_from_rfc3339(&time).map_err(|_| invalid("归还时间无效"))?;
                if time < borrowed || !valid_date(&date) {
                    return Err(invalid("归还日期或时间先后关系无效"));
                }
                let d = NaiveDate::parse_from_str(&date, "%Y-%m-%d").unwrap();
                if (d - time.date_naive()).num_days().abs() > 1 {
                    return Err(invalid("归还本地日期无效"));
                }
            }
            (None, None) => {}
            _ => return Err(invalid("归还字段不完整")),
        }
        if !valid_code(&r.get::<_, String>(4)?)
            || !valid_text(&r.get::<_, String>(5)?, 100, true)
            || !valid_code(&r.get::<_, String>(6)?)
            || !valid_text(&r.get::<_, String>(7)?, 200, true)
        {
            return Err(invalid("历史快照资料无效"));
        }
    }
    let stopped:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM loans l JOIN books b ON l.book_id=b.id WHERE l.returned_at IS NULL AND b.enabled=0)",[],|r|r.get(0))?;
    if stopped {
        return Err(invalid("停用图书仍有未归还借阅"));
    }
    for table in ["books", "readers", "loans"] {
        let invalid_id: bool = conn.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id < 1 OR id > 9007199254740991)"),
            [],
            |r| r.get(0),
        )?;
        if invalid_id {
            return Err(invalid("备份中的内部编号超出支持范围"));
        }
    }
    let count = |table: &str| -> AppResult<i64> {
        Ok(conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?)
    };
    Ok(Summary {
        books: count("books")?,
        readers: count("readers")?,
        loans: count("loans")?,
        active_loans: conn.query_row(
            "SELECT count(*) FROM loans WHERE returned_at IS NULL",
            [],
            |r| r.get(0),
        )?,
        schema_version: version,
    })
}
fn validate_times(created: &str, updated: &str) -> AppResult<()> {
    DateTime::parse_from_rfc3339(created).map_err(|_| invalid("创建时间无效"))?;
    DateTime::parse_from_rfc3339(updated).map_err(|_| invalid("更新时间无效"))?;
    // Metadata records the device clock, which may move backwards. Borrow/return
    // chronology is checked separately because it has business meaning.
    Ok(())
}

fn read_backup(path: &Path) -> AppResult<Connection> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| invalid("无法读取备份文件"))?;
    c.pragma_update(None, "trusted_schema", "OFF")?;
    Ok(c)
}
fn snapshot(conn: &Connection, target: &Path) -> AppResult<Summary> {
    let parent = target.parent().ok_or_else(|| invalid("目标路径无效"))?;
    let temp = temporary(parent)?;
    conn.backup(rusqlite::MAIN_DB, &temp.0, None)?;
    let summary = validate(&read_backup(&temp.0)?)?;
    File::open(&temp.0)?.sync_all()?;
    fs::rename(&temp.0, target)?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(summary)
}
fn stage(store: &Store, source: &Path) -> AppResult<(Temporary, String, Summary)> {
    independent(store, source)?;
    for suffix in ["-wal", "-journal"] {
        if PathBuf::from(format!("{}{suffix}", source.to_string_lossy())).exists() {
            return Err(invalid("请选择已完成的独立备份文件，不接受活动数据库"));
        }
    }
    let temp = temporary(store.path.parent().unwrap())?;
    fs::copy(source, &temp.0)?;
    let digest = hash(&temp.0)?;
    let summary = validate(&read_backup(&temp.0)?)?;
    Ok((temp, digest, summary))
}
fn inspect(store: &Store, source: PathBuf) -> AppResult<Value> {
    let (_temp, digest, summary) = stage(store, &source)?;
    let token = nonce();
    let selections = SELECTIONS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = selections
        .lock()
        .map_err(|_| invalid("文件选择状态异常，请重试"))?;
    map.clear();
    map.insert(
        token.clone(),
        Selection {
            path: source.clone(),
            digest,
        },
    );
    Ok(json!({"token":token,"path":source,"summary":summary}))
}
fn restore(store: &Store, selection: &Selection) -> AppResult<Value> {
    store.with_maintenance(|conn| {
        let (temp, digest, summary) = stage(store, &selection.path)?;
        if digest != selection.digest {
            return Err(invalid("备份文件已改变，请重新选择并确认"));
        }
        let safety = store
            .path
            .parent()
            .unwrap()
            .join(format!("before-restore-{}.library-backup.sqlite", nonce()));
        snapshot(conn, &safety)?;
        // SQLite's backup API holds a destination write transaction. Dropping an
        // incomplete backup rolls it back; the rollback journal covers process death.
        let source = read_backup(&temp.0)?;
        let result = (|| {
            let backup = Backup::new(&source, conn)?;
            backup.run_to_completion(128, Duration::from_millis(1), None)?;
            Ok::<_, AppError>(())
        })();
        result?;
        if let Err(error) = validate(conn) {
            let recovery = (|| -> AppResult<()> {
                let original = read_backup(&safety)?;
                Backup::new(&original, conn)?.run_to_completion(
                    128,
                    Duration::from_millis(1),
                    None,
                )?;
                validate(conn)?;
                Ok(())
            })();
            if recovery.is_err() {
                store.quarantine();
                return Err(AppError::new(
                    "recovery_required",
                    &format!(
                        "恢复检查失败，请关闭客户端，并保留安全备份：{}",
                        safety.display()
                    ),
                ));
            }
            return Err(error);
        }
        Ok(json!({"summary":summary,"safetyPath":safety}))
    })
}
pub fn handle(
    store: &Store,
    app: &tauri::AppHandle,
    action: &str,
    payload: Value,
) -> AppResult<Value> {
    match action {
        "info" => store.with_conn(|conn| Ok(json!({"path":store.path,"summary":validate(conn)?}))),
        "backup" => {
            let name = format!(
                "qinghe-{}.library-backup.sqlite",
                chrono::Local::now().format("%Y%m%d-%H%M%S")
            );
            let Some(file) = app
                .dialog()
                .file()
                .set_title("创建图书室备份")
                .set_file_name(name)
                .add_filter("青禾图书备份", &["sqlite"])
                .blocking_save_file()
            else {
                return Ok(json!({"cancelled":true}));
            };
            let path = file.into_path().map_err(|_| invalid("文件路径无效"))?;
            independent(store, &path)?;
            store.with_maintenance(|conn| {
                let summary = snapshot(conn, &path)?;
                Ok(json!({"path":path,"summary":summary}))
            })
        }
        "inspect" => {
            let Some(file) = app
                .dialog()
                .file()
                .set_title("选择图书室备份")
                .add_filter("青禾图书备份", &["sqlite"])
                .blocking_pick_file()
            else {
                return Ok(json!({"cancelled":true}));
            };
            let path = file.into_path().map_err(|_| invalid("文件路径无效"))?;
            store.with_maintenance(|_| inspect(store, path))
        }
        "restore" => {
            let token = payload
                .get("token")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("请先选择并校验备份"))?;
            let selection = SELECTIONS
                .get_or_init(|| Mutex::new(HashMap::new()))
                .lock()
                .map_err(|_| invalid("文件选择状态异常"))?
                .remove(token)
                .ok_or_else(|| invalid("备份选择已失效，请重新选择"))?;
            restore(store, &selection)
        }
        _ => Err(AppError::new("validation", "未知数据管理操作")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("library.sqlite")).unwrap();
        (dir, store)
    }
    fn add(store: &Store, code: &str) {
        store.with_conn(|c| { c.execute("INSERT INTO books(code,title,created_at,updated_at) VALUES (?1,'测试书','2026-10-31T12:00:00Z','2026-10-31T12:00:00Z')",[code])?;Ok(()) }).unwrap();
    }
    #[test]
    fn complete_backup_restore_and_safety_recovery() {
        let (dir, store) = setup();
        add(&store, "B001");
        let backup = dir.path().join("backup.sqlite");
        store.with_maintenance(|c| snapshot(c, &backup)).unwrap();
        let selection = Selection {
            path: backup.clone(),
            digest: hash(&backup).unwrap(),
        };
        add(&store, "B002");
        let result = restore(&store, &selection).unwrap();
        assert_eq!(result["summary"]["books"], 1);
        let safety = PathBuf::from(result["safetyPath"].as_str().unwrap());
        let safety_selection = Selection {
            digest: hash(&safety).unwrap(),
            path: safety,
        };
        assert_eq!(
            restore(&store, &safety_selection).unwrap()["summary"]["books"],
            2
        );
        drop(store);
        let reopened = Store::open(dir.path().join("library.sqlite")).unwrap();
        assert_eq!(reopened.with_conn(|c| validate(c)).unwrap().books, 2);
    }
    #[test]
    fn rejects_changed_file_without_modifying_current() {
        let (dir, store) = setup();
        let backup = dir.path().join("backup.sqlite");
        store.with_maintenance(|c| snapshot(c, &backup)).unwrap();
        let selection = Selection {
            path: backup.clone(),
            digest: hash(&backup).unwrap(),
        };
        add(&store, "B001");
        store.with_maintenance(|c| snapshot(c, &backup)).unwrap();
        assert!(restore(&store, &selection).is_err());
        assert_eq!(store.with_conn(|c| validate(c)).unwrap().books, 1);
    }
    #[test]
    fn rejects_bad_version_foreign_and_malformed_backups() {
        let (dir, store) = setup();
        let p = dir.path().join("bad.sqlite");
        fs::write(&p, b"not a database").unwrap();
        assert!(stage(&store, &p).is_err());
        fs::remove_file(&p).unwrap();
        let c = Connection::open(&p).unwrap();
        assert!(validate(&c).is_err());
        c.execute_batch(include_str!("../schema.sql")).unwrap();
        c.pragma_update(None, "application_id", APPLICATION_ID)
            .unwrap();
        c.pragma_update(None, "user_version", 99).unwrap();
        assert_eq!(validate(&c).unwrap_err().code, "incompatible");
        c.pragma_update(None, "user_version", SCHEMA_VERSION)
            .unwrap();
        c.execute("INSERT INTO books(code,title,created_at,updated_at) VALUES ('bad code','书','bad','bad')",[]).unwrap();
        assert!(validate(&c).is_err());
    }
    #[test]
    fn rejects_active_database_and_links() {
        let (dir, store) = setup();
        assert!(independent(&store, &store.path).is_err());
        #[cfg(unix)]
        {
            let p = dir.path().join("link.sqlite");
            fs::hard_link(&store.path, &p).unwrap();
            assert!(independent(&store, &p).is_err());
        }
    }
    #[test]
    fn failed_export_keeps_old_target_and_live_data() {
        let (dir, store) = setup();
        add(&store, "B001");
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep"), b"old").unwrap();
        assert!(store.with_maintenance(|c| snapshot(c, &target)).is_err());
        assert_eq!(fs::read(target.join("keep")).unwrap(), b"old");
        assert_eq!(store.with_conn(|c| validate(c)).unwrap().books, 1);
    }
    #[test]
    fn maintenance_rejects_business_and_recovers_after_error() {
        let (_dir, store) = setup();
        let result = store.with_maintenance(|_| {
            assert_eq!(store.with_conn(|_| Ok(())).unwrap_err().code, "maintenance");
            Err::<(), _>(invalid("test"))
        });
        assert!(result.is_err());
        assert!(store.with_conn(|_| Ok(())).is_ok());
    }
    #[test]
    fn incomplete_restore_rolls_back() {
        let (dir, store) = setup();
        let backup = dir.path().join("large.sqlite");
        let source = Store::open(&backup).unwrap();
        // Populate enough real data to force multiple backup steps.
        source.with_conn(|c| { let tx=c.transaction()?; for i in 0..2000 { tx.execute("INSERT INTO books(code,title,created_at,updated_at) VALUES (?1,?2,'2026-10-31T12:00:00Z','2026-10-31T12:00:00Z')",rusqlite::params![format!("S{i}"),"图书".repeat(60)])?; } tx.commit()?; Ok(()) }).unwrap();
        add(&store, "ORIGINAL");
        let c = read_backup(&backup).unwrap();
        store
            .with_maintenance(|target| {
                {
                    let backup = Backup::new(&c, target)?;
                    assert_eq!(backup.step(1)?, rusqlite::backup::StepResult::More);
                }
                Ok(())
            })
            .unwrap();
        drop(store);
        let reopened = Store::open(dir.path().join("library.sqlite")).unwrap();
        assert_eq!(reopened.with_conn(|c| validate(c)).unwrap().books, 1);
    }
    #[test]
    fn restore_crash_child() {
        let Some(dir) = std::env::var_os("QINGHE_RESTORE_CRASH_TEST") else {
            return;
        };
        let dir = PathBuf::from(dir);
        let store = Store::open(dir.join("library.sqlite")).unwrap();
        let source = read_backup(&dir.join("source.sqlite")).unwrap();
        store
            .with_maintenance(|target| -> AppResult<()> {
                let backup = Backup::new(&source, target)?;
                assert_eq!(backup.step(1)?, rusqlite::backup::StepResult::More);
                std::process::exit(91);
            })
            .unwrap();
    }
    #[test]
    fn process_death_during_restore_recovers_on_reopen() {
        let (dir, store) = setup();
        add(&store, "ORIGINAL");
        let source = Store::open(dir.path().join("source.sqlite")).unwrap();
        source.with_conn(|c| { let tx = c.transaction()?;
            for i in 0..1500 { tx.execute("INSERT INTO books(code,title,created_at,updated_at) VALUES (?1,?2,'2026-10-31T12:00:00Z','2026-10-31T12:00:00Z')", rusqlite::params![format!("B{i}"), "书名".repeat(80)])?; }
            tx.commit()?; Ok(())
        }).unwrap();
        drop(source);
        drop(store);
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "modules::data::tests::restore_crash_child",
                "--nocapture",
            ])
            .env("QINGHE_RESTORE_CRASH_TEST", dir.path())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(91));
        let reopened = Store::open(dir.path().join("library.sqlite")).unwrap();
        assert_eq!(reopened.with_conn(|c| validate(c)).unwrap().books, 1);
    }
    #[test]
    fn rejects_unaddressable_internal_ids() {
        let (_dir, store) = setup();
        store.with_conn(|c| {
            c.execute("INSERT INTO readers(id,code,name,created_at,updated_at) VALUES (0,'R001','读者','2026-10-31T12:00:00Z','2026-10-31T12:00:00Z')", [])?;
            assert!(validate(c).is_err());
            c.execute("DELETE FROM readers", [])?;
            c.execute("INSERT INTO readers(id,code,name,created_at,updated_at) VALUES (9007199254740992,'R001','读者','2026-10-31T12:00:00Z','2026-10-31T12:00:00Z')", [])?;
            assert!(validate(c).is_err());
            Ok(())
        }).unwrap();
    }
    #[test]
    fn accepts_metadata_after_device_clock_moves_backwards() {
        let (_dir, store) = setup();
        add(&store, "B001");
        store
            .with_conn(|c| {
                c.execute("UPDATE books SET updated_at='2026-10-30T12:00:00Z'", [])?;
                assert_eq!(validate(c)?.books, 1);
                Ok(())
            })
            .unwrap();
    }
}
