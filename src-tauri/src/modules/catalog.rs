use crate::{
    db::Store,
    error::{AppError, AppResult},
    validation,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveLoan {
    id: i64,
    reader_name: String,
    due_date: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Book {
    id: i64,
    code: String,
    title: String,
    author: String,
    isbn: String,
    publisher: String,
    category: String,
    location: String,
    enabled: bool,
    created_at: String,
    updated_at: String,
    status: String,
    active_loan: Option<ActiveLoan>,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListInput {
    search: Option<String>,
    status: Option<String>,
    page: Option<u32>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdInput {
    id: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnabledInput {
    id: i64,
    enabled: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveInput {
    id: Option<i64>,
    code: String,
    title: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    isbn: String,
    #[serde(default)]
    publisher: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    location: String,
}
const BOOK_SELECT: &str = "SELECT b.id,b.code,b.title,b.author,b.isbn,b.publisher,b.category,b.location,b.enabled,b.created_at,b.updated_at, CASE WHEN b.enabled=0 THEN 'disabled' WHEN l.id IS NOT NULL THEN 'borrowed' ELSE 'available' END, l.id,l.reader_name,l.due_date FROM books b LEFT JOIN loans l ON l.book_id=b.id AND l.returned_at IS NULL";
fn read_book(row: &Row<'_>) -> rusqlite::Result<Book> {
    let loan_id: Option<i64> = row.get(12)?;
    Ok(Book {
        id: row.get(0)?,
        code: row.get(1)?,
        title: row.get(2)?,
        author: row.get(3)?,
        isbn: row.get(4)?,
        publisher: row.get(5)?,
        category: row.get(6)?,
        location: row.get(7)?,
        enabled: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        status: row.get(11)?,
        active_loan: match loan_id {
            Some(id) => Some(ActiveLoan {
                id,
                reader_name: row.get(13)?,
                due_date: row.get(14)?,
            }),
            None => None,
        },
    })
}
fn valid_id(id: i64) -> AppResult<i64> {
    if id > 0 {
        Ok(id)
    } else {
        Err(AppError::validation("id", "图书编号无效"))
    }
}
fn get(conn: &Connection, id: i64) -> AppResult<Book> {
    valid_id(id)?;
    conn.query_row(&format!("{BOOK_SELECT} WHERE b.id=?1"), [id], read_book)
        .optional()?
        .ok_or_else(AppError::not_found)
}
fn list(conn: &Connection, input: ListInput) -> AppResult<Value> {
    let search = validation::text(input.search.as_deref().unwrap_or(""), "search", 200, false)?;
    let page = validation::page(input.page)?;
    let status = input.status.as_deref().unwrap_or("all");
    let condition = match status {
        "all" => "1=1",
        "available" => "b.enabled=1 AND l.id IS NULL",
        "borrowed" => "b.enabled=1 AND l.id IS NOT NULL",
        "disabled" => "b.enabled=0",
        _ => return Err(AppError::validation("status", "图书状态无效")),
    };
    let filter = format!("({condition}) AND (?1='' OR instr(lower(b.code),lower(?1))>0 OR instr(lower(b.title),lower(?1))>0 OR instr(lower(b.author),lower(?1))>0 OR instr(lower(b.isbn),lower(?1))>0)");
    let total: i64 = conn.query_row(&format!("SELECT count(*) FROM books b LEFT JOIN loans l ON l.book_id=b.id AND l.returned_at IS NULL WHERE {filter}"), [&search], |r| r.get(0))?;
    let mut statement = conn.prepare(&format!(
        "{BOOK_SELECT} WHERE {filter} ORDER BY b.created_at DESC,b.id DESC LIMIT 20 OFFSET ?2"
    ))?;
    let books = statement
        .query_map(params![search, i64::from(page - 1) * 20], read_book)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "items": books, "total": total }))
}
fn save(conn: &mut Connection, input: SaveInput) -> AppResult<Book> {
    let code = validation::code(&input.code)?;
    let title = validation::text(&input.title, "title", 200, true)?;
    let author = validation::text(&input.author, "author", 100, false)?;
    let isbn = validation::text(&input.isbn, "isbn", 32, false)?;
    let publisher = validation::text(&input.publisher, "publisher", 100, false)?;
    let category = validation::text(&input.category, "category", 50, false)?;
    let location = validation::text(&input.location, "location", 50, false)?;
    let tx = conn.transaction()?;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let id = if let Some(id) = input.id {
        valid_id(id)?;
        let original = get(&tx, id)?;
        if original.code != code {
            return Err(AppError::validation("code", "馆藏编号创建后不能修改"));
        }
        tx.execute("UPDATE books SET title=?1,author=?2,isbn=?3,publisher=?4,category=?5,location=?6,updated_at=?7 WHERE id=?8", params![title,author,isbn,publisher,category,location,now,id])?;
        id
    } else {
        let duplicate: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE code=?1)",
            [&code],
            |r| r.get(0),
        )?;
        if duplicate {
            return Err(AppError {
                code: "conflict".into(),
                message: "馆藏编号已存在，请使用其他编号".into(),
                field: Some("code".into()),
            });
        }
        tx.execute("INSERT INTO books(code,title,author,isbn,publisher,category,location,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)", params![code,title,author,isbn,publisher,category,location,now])?;
        tx.last_insert_rowid()
    };
    let book = get(&tx, id)?;
    tx.commit()?;
    Ok(book)
}
fn set_enabled(conn: &mut Connection, input: EnabledInput) -> AppResult<Book> {
    valid_id(input.id)?;
    let tx = conn.transaction()?;
    let book = get(&tx, input.id)?;
    if !input.enabled && book.active_loan.is_some() {
        return Err(AppError::conflict("图书已借出，请先办理归还后再停用"));
    }
    tx.execute(
        "UPDATE books SET enabled=?1,updated_at=?2 WHERE id=?3",
        params![
            input.enabled,
            Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            input.id
        ],
    )?;
    let result = get(&tx, input.id)?;
    tx.commit()?;
    Ok(result)
}
pub fn handle(store: &Store, action: &str, payload: Value) -> AppResult<Value> {
    match action {
        "list" => {
            let input = serde_json::from_value(payload)?;
            store.with_conn(|conn| list(conn, input))
        }
        "get" => {
            let input: IdInput = serde_json::from_value(payload)?;
            store.with_conn(|conn| Ok(serde_json::to_value(get(conn, input.id)?)?))
        }
        "save" => {
            let input = serde_json::from_value(payload)?;
            store.with_conn(|conn| Ok(serde_json::to_value(save(conn, input)?)?))
        }
        "set_enabled" => {
            let input = serde_json::from_value(payload)?;
            store.with_conn(|conn| Ok(serde_json::to_value(set_enabled(conn, input)?)?))
        }
        _ => Err(AppError::new("validation", "未知馆藏操作")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("library.sqlite")).unwrap();
        (dir, store)
    }
    fn create(store: &Store, code: &str, title: &str) -> Value {
        handle(
            store,
            "save",
            json!({"code":code,"title":title,"isbn":"9780000000000"}),
        )
        .unwrap()
    }
    fn seed_loan(store: &Store, book_id: i64) {
        store.with_conn(|conn| { conn.execute("INSERT INTO readers(code,name,created_at,updated_at) VALUES('R001','林同学','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z')", [])?;
            conn.execute("INSERT INTO loans(book_id,reader_id,borrowed_at,due_date,reader_code,reader_name,book_code,book_title) SELECT id,1,'2026-10-31T00:00:00Z','2026-11-30','R001','林同学',code,title FROM books WHERE id=?1", [book_id])?; Ok(()) }).unwrap();
    }
    #[test]
    fn persists_normalizes_and_allows_same_isbn_copies() {
        let (dir, store) = fixture();
        let first = create(&store, " b001 ", " 第一册 ");
        assert_eq!(first["code"], "B001");
        assert_eq!(first["title"], "第一册");
        create(&store, "B002", "第二册");
        drop(store);
        let reopened = Store::open(dir.path().join("library.sqlite")).unwrap();
        let list = handle(&reopened, "list", json!({})).unwrap();
        assert_eq!(list["total"], 2);
        assert_eq!(list["items"][0]["status"], "available");
    }
    #[test]
    fn rejects_duplicate_and_invalid_values_without_writes() {
        let (_dir, store) = fixture();
        create(&store, "B001", "第一册");
        let error = handle(&store, "save", json!({"code":"b001","title":"重复"})).unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(error.field.as_deref(), Some("code"));
        for (code, title) in [("A B", "书"), ("B2", "  ")] {
            assert!(handle(&store, "save", json!({"code":code,"title":title})).is_err());
        }
        assert!(handle(
            &store,
            "save",
            json!({"code":"B3","title":"长".repeat(201)})
        )
        .is_err());
        assert_eq!(handle(&store, "list", json!({})).unwrap()["total"], 1);
    }
    #[test]
    fn edits_preserve_identity_and_historical_snapshot() {
        let (_dir, store) = fixture();
        let book = create(&store, "B001", "旧书名");
        let id = book["id"].as_i64().unwrap();
        seed_loan(&store, id);
        assert!(handle(
            &store,
            "save",
            json!({"id":id,"code":"B002","title":"新书名"})
        )
        .is_err());
        let edited = handle(
            &store,
            "save",
            json!({"id":id,"code":"B001","title":"新书名","author":"新作者"}),
        )
        .unwrap();
        assert_eq!(edited["status"], "borrowed");
        assert_eq!(edited["activeLoan"]["readerName"], "林同学");
        store
            .with_conn(|c| {
                let snapshot: String =
                    c.query_row("SELECT book_title FROM loans", [], |r| r.get(0))?;
                assert_eq!(snapshot, "旧书名");
                Ok(())
            })
            .unwrap();
    }
    #[test]
    fn active_loan_blocks_disabling_then_return_allows_reenable() {
        let (_dir, store) = fixture();
        let id = create(&store, "B001", "书")["id"].as_i64().unwrap();
        seed_loan(&store, id);
        assert_eq!(
            handle(&store, "set_enabled", json!({"id":id,"enabled":false}))
                .unwrap_err()
                .code,
            "conflict"
        );
        store.with_conn(|c| { c.execute("UPDATE loans SET returned_at='2026-11-01T00:00:00Z',returned_local_date='2026-11-01'",[])?; Ok(()) }).unwrap();
        assert_eq!(
            handle(&store, "set_enabled", json!({"id":id,"enabled":false})).unwrap()["status"],
            "disabled"
        );
        assert_eq!(
            handle(&store, "set_enabled", json!({"id":id,"enabled":true})).unwrap()["status"],
            "available"
        );
        assert_eq!(handle(&store, "list", json!({})).unwrap()["total"], 1);
    }
    #[test]
    fn search_is_literal_case_insensitive_and_pagination_is_stable() {
        let (_dir, store) = fixture();
        for i in 0..25 {
            create(&store, &format!("B{i:03}"), &format!("Rust 阅读 {i}"));
        }
        let first = handle(&store, "list", json!({"search":"rUsT"})).unwrap();
        let second = handle(&store, "list", json!({"search":"Rust","page":2})).unwrap();
        assert_eq!(first["total"], 25);
        assert_eq!(first["items"].as_array().unwrap().len(), 20);
        assert_eq!(second["items"].as_array().unwrap().len(), 5);
        assert_ne!(first["items"][19]["id"], second["items"][0]["id"]);
        assert_eq!(
            handle(&store, "list", json!({"search":"%"})).unwrap()["total"],
            0
        );
        assert_eq!(
            handle(&store, "list", json!({"search":"_"})).unwrap()["total"],
            0
        );
        assert!(handle(&store, "list", json!({"page":0})).is_err());
        assert!(handle(&store, "list", json!({"status":"unknown"})).is_err());
    }
    #[test]
    fn statuses_and_failed_write_leave_existing_data_intact() {
        let (_dir, store) = fixture();
        let id = create(&store, "B001", "原书名")["id"].as_i64().unwrap();
        create(&store, "B002", "可借书");
        seed_loan(&store, id);
        assert_eq!(
            handle(&store, "list", json!({"status":"borrowed"})).unwrap()["total"],
            1
        );
        assert_eq!(
            handle(&store, "list", json!({"status":"available"})).unwrap()["total"],
            1
        );
        store.with_conn(|c| { c.execute_batch("CREATE TRIGGER reject_book_update BEFORE UPDATE ON books BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;")?; Ok(()) }).unwrap();
        assert!(handle(
            &store,
            "save",
            json!({"id":id,"code":"B001","title":"修改"})
        )
        .is_err());
        assert_eq!(
            handle(&store, "get", json!({"id":id})).unwrap()["title"],
            "原书名"
        );
    }
}
