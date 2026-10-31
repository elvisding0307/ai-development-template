use crate::{
    db::Store,
    error::{AppError, AppResult},
    validation,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Reader {
    id: i64,
    code: String,
    name: String,
    phone: String,
    notes: String,
    enabled: bool,
    created_at: String,
    updated_at: String,
    active_loans: i64,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListInput {
    #[serde(default)]
    search: String,
    #[serde(default)]
    status: String,
    page: Option<u32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdInput {
    id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveInput {
    id: Option<i64>,
    code: String,
    name: String,
    #[serde(default)]
    phone: String,
    #[serde(default)]
    notes: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnableInput {
    id: i64,
    enabled: bool,
}

const SELECT_READER: &str = "SELECT r.id,r.code,r.name,r.phone,r.notes,r.enabled,r.created_at,r.updated_at,
    (SELECT COUNT(*) FROM loans l WHERE l.reader_id=r.id AND l.returned_at IS NULL) AS active_loans FROM readers r";

fn row_reader(row: &rusqlite::Row<'_>) -> rusqlite::Result<Reader> {
    Ok(Reader {
        id: row.get(0)?,
        code: row.get(1)?,
        name: row.get(2)?,
        phone: row.get(3)?,
        notes: row.get(4)?,
        enabled: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        active_loans: row.get(8)?,
    })
}

fn get(conn: &Connection, id: i64) -> AppResult<Reader> {
    if id <= 0 {
        return Err(AppError::validation("id", "读者编号无效"));
    }
    conn.query_row(&format!("{SELECT_READER} WHERE r.id=?1"), [id], row_reader)
        .optional()?
        .ok_or_else(AppError::not_found)
}

fn list(store: &Store, input: ListInput) -> AppResult<Value> {
    let search = validation::text(&input.search, "search", 100, false)?;
    let page = validation::page(input.page)?;
    let enabled = match input.status.as_str() {
        "" | "all" => None,
        "enabled" => Some(true),
        "disabled" => Some(false),
        _ => return Err(AppError::validation("status", "读者状态无效")),
    };
    store.with_conn(|conn| {
        let filter = " WHERE (?1='' OR instr(lower(r.code),lower(?1))>0 OR instr(lower(r.name),lower(?1))>0 OR instr(lower(r.phone),lower(?1))>0) AND (?2 IS NULL OR r.enabled=?2)";
        let total: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM readers r{filter}"),
            params![search, enabled],
            |row| row.get(0),
        )?;
        let mut query = conn.prepare(&format!("{SELECT_READER}{filter} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?3"))?;
        let readers = query
            .query_map(params![search, enabled, i64::from(page - 1) * 20], row_reader)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(json!({ "items": readers, "total": total }))
    })
}

fn save(store: &Store, input: SaveInput) -> AppResult<Value> {
    let code = validation::code(&input.code)?;
    let name = validation::text(&input.name, "name", 100, true)?;
    let phone = validation::text(&input.phone, "phone", 32, false)?;
    let notes = validation::text(&input.notes, "notes", 500, false)?;
    store.with_conn(|conn| {
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        let id = if let Some(id) = input.id {
            let old = get(&tx, id)?;
            if code != old.code {
                return Err(AppError::validation("code", "读者编号创建后不能修改"));
            }
            tx.execute(
                "UPDATE readers SET name=?1,phone=?2,notes=?3,updated_at=?4 WHERE id=?5",
                params![name, phone, notes, now, id],
            )?;
            id
        } else {
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM readers WHERE code=?1 COLLATE NOCASE)",
                [&code],
                |row| row.get(0),
            )?;
            if exists {
                return Err(AppError { code: "conflict".into(), message: "读者编号已存在，请使用其他编号".into(), field: Some("code".into()) });
            }
            tx.execute(
                "INSERT INTO readers(code,name,phone,notes,enabled,created_at,updated_at) VALUES(?1,?2,?3,?4,1,?5,?5)",
                params![code, name, phone, notes, now],
            )?;
            tx.last_insert_rowid()
        };
        let reader = get(&tx, id)?;
        tx.commit()?;
        Ok(serde_json::to_value(reader)?)
    })
}

fn set_enabled(store: &Store, input: EnableInput) -> AppResult<Value> {
    store.with_conn(|conn| {
        let tx = conn.transaction()?;
        get(&tx, input.id)?;
        tx.execute(
            "UPDATE readers SET enabled=?1,updated_at=?2 WHERE id=?3",
            params![input.enabled, Utc::now().to_rfc3339(), input.id],
        )?;
        let reader = get(&tx, input.id)?;
        tx.commit()?;
        Ok(serde_json::to_value(reader)?)
    })
}

pub fn handle(store: &Store, action: &str, payload: Value) -> AppResult<Value> {
    match action {
        "list" => list(store, serde_json::from_value(payload)?),
        "get" => {
            let input: IdInput = serde_json::from_value(payload)?;
            store.with_conn(|conn| Ok(serde_json::to_value(get(conn, input.id)?)?))
        }
        "save" => save(store, serde_json::from_value(payload)?),
        "set_enabled" => set_enabled(store, serde_json::from_value(payload)?),
        _ => Err(AppError::new("validation", "未知读者操作")),
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
    fn create(store: &Store, code: &str, name: &str) -> Value {
        handle(store, "save", json!({"code":code,"name":name})).unwrap()
    }

    #[test]
    fn normalizes_unique_identity_but_allows_same_name_and_phone_and_persists() {
        let (dir, store) = setup();
        let reader = handle(
            &store,
            "save",
            json!({"code":" r001 ","name":" 同名 ","phone":"+86 123"}),
        )
        .unwrap();
        assert_eq!(reader["code"], "R001");
        assert_eq!(reader["name"], "同名");
        assert_eq!(reader["activeLoans"], 0);
        assert_eq!(reader["enabled"], true);
        assert!(handle(&store, "save", json!({"code":"R001","name":"另一人"})).is_err());
        handle(
            &store,
            "save",
            json!({"code":"R002","name":"同名","phone":"+86 123"}),
        )
        .unwrap();
        drop(store);
        let reopened = Store::open(dir.path().join("library.sqlite")).unwrap();
        let result = handle(&reopened, "list", json!({"search":"同名"})).unwrap();
        assert_eq!(result["total"], 2);
    }

    #[test]
    fn validates_input_and_keeps_identity_immutable() {
        let (_dir, store) = setup();
        assert!(handle(&store, "save", json!({"code":"R-01","name":"  "})).is_err());
        assert!(handle(&store, "save", json!({"code":"R 01","name":"甲"})).is_err());
        assert!(handle(
            &store,
            "save",
            json!({"code":"R01","name":"甲","phone":"a".repeat(33)})
        )
        .is_err());
        assert!(handle(
            &store,
            "save",
            json!({"code":"R01","name":"甲","notes":"字".repeat(501)})
        )
        .is_err());
        let first = create(&store, "R01", "甲");
        let id = first["id"].as_i64().unwrap();
        let error = handle(&store, "save", json!({"id":id,"code":"R02","name":"乙"})).unwrap_err();
        assert_eq!(error.field.as_deref(), Some("code"));
        let unchanged = handle(&store, "get", json!({"id":id})).unwrap();
        assert_eq!(unchanged["name"], "甲");
        assert_eq!(unchanged["code"], "R01");
        assert_eq!(
            handle(&store, "get", json!({"id":999})).unwrap_err().code,
            "not_found"
        );
        assert!(handle(&store, "list", json!({"page":0})).is_err());
        assert!(handle(&store, "list", json!({"status":"bogus"})).is_err());
    }

    #[test]
    fn search_is_literal_case_insensitive_and_pagination_respects_filters() {
        let (_dir, store) = setup();
        for n in 0..23 {
            create(
                &store,
                &format!("R{n:03}"),
                if n == 0 { "100%_Real" } else { "普通读者" },
            );
        }
        let first = handle(&store, "list", json!({})).unwrap();
        let second = handle(&store, "list", json!({"page":2})).unwrap();
        assert_eq!(first["total"], 23);
        assert_eq!(first["items"].as_array().unwrap().len(), 20);
        assert_eq!(second["items"].as_array().unwrap().len(), 3);
        assert_ne!(first["items"][19]["id"], second["items"][0]["id"]);
        assert_eq!(
            handle(&store, "list", json!({"search":"%_rEal"})).unwrap()["total"],
            1
        );
        assert_eq!(
            handle(&store, "list", json!({"search":"r000"})).unwrap()["total"],
            1
        );
        let id = first["items"][0]["id"].as_i64().unwrap();
        handle(&store, "set_enabled", json!({"id":id,"enabled":false})).unwrap();
        assert_eq!(
            handle(&store, "list", json!({"status":"disabled"})).unwrap()["total"],
            1
        );
        assert_eq!(
            handle(&store, "list", json!({"status":"enabled"})).unwrap()["total"],
            22
        );
    }

    #[test]
    fn disabling_with_outstanding_loan_preserves_history_and_rename_snapshot() {
        let (_dir, store) = setup();
        let reader = create(&store, "R01", "旧姓名");
        let id = reader["id"].as_i64().unwrap();
        store.with_conn(|conn| {
            conn.execute("INSERT INTO books(code,title,created_at,updated_at) VALUES('B01','书','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z')",[])?;
            conn.execute("INSERT INTO loans(book_id,reader_id,borrowed_at,due_date,reader_code,reader_name,book_code,book_title) VALUES(1,?1,'2026-10-31T00:00:00Z','2026-11-30','R01','旧姓名','B01','书')",[id])?;
            Ok(())
        }).unwrap();
        let disabled = handle(&store, "set_enabled", json!({"id":id,"enabled":false})).unwrap();
        assert_eq!(disabled["activeLoans"], 1);
        assert_eq!(disabled["enabled"], false);
        handle(
            &store,
            "save",
            json!({"id":id,"code":"R01","name":"新姓名"}),
        )
        .unwrap();
        let enabled = handle(&store, "set_enabled", json!({"id":id,"enabled":true})).unwrap();
        assert_eq!(enabled["activeLoans"], 1);
        store
            .with_conn(|conn| {
                let snapshot: String =
                    conn.query_row("SELECT reader_name FROM loans", [], |r| r.get(0))?;
                assert_eq!(snapshot, "旧姓名");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn failed_update_rolls_back_reader_fields() {
        let (_dir, store) = setup();
        let reader = create(&store, "R01", "原姓名");
        let id = reader["id"].as_i64().unwrap();
        store.with_conn(|conn| { conn.execute_batch("CREATE TRIGGER reject_reader_update BEFORE UPDATE ON readers BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;")?; Ok(()) }).unwrap();
        assert_eq!(
            handle(
                &store,
                "save",
                json!({"id":id,"code":"R01","name":"新姓名"})
            )
            .unwrap_err()
            .code,
            "storage"
        );
        assert_eq!(
            handle(&store, "get", json!({"id":id})).unwrap()["name"],
            "原姓名"
        );
    }
}
