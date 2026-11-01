use crate::{
    db::Store,
    error::{AppError, AppResult},
    validation,
};
use chrono::{DateTime, Days, Local, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Loan {
    id: i64,
    book_id: i64,
    reader_id: i64,
    borrowed_at: String,
    due_date: String,
    returned_at: Option<String>,
    returned_local_date: Option<String>,
    reader_code: String,
    reader_name: String,
    book_code: String,
    book_title: String,
    status: String,
    overdue_days: i64,
    returned_late: bool,
}
const SELECT: &str = "SELECT id,book_id,reader_id,borrowed_at,due_date,returned_at,returned_local_date,reader_code,reader_name,book_code,book_title FROM loans";
fn row_loan(row: &Row<'_>) -> rusqlite::Result<Loan> {
    Ok(Loan {
        id: row.get(0)?,
        book_id: row.get(1)?,
        reader_id: row.get(2)?,
        borrowed_at: row.get(3)?,
        due_date: row.get(4)?,
        returned_at: row.get(5)?,
        returned_local_date: row.get(6)?,
        reader_code: row.get(7)?,
        reader_name: row.get(8)?,
        book_code: row.get(9)?,
        book_title: row.get(10)?,
        status: String::new(),
        overdue_days: 0,
        returned_late: false,
    })
}
fn classify(mut loan: Loan, today: NaiveDate) -> AppResult<Loan> {
    let due = parse_stored_date(&loan.due_date)?;
    let comparison = match &loan.returned_local_date {
        Some(s) => parse_stored_date(s)?,
        None => today,
    };
    loan.overdue_days = (comparison - due).num_days().max(0);
    loan.returned_late = loan.returned_at.is_some() && loan.overdue_days > 0;
    loan.status = if loan.returned_at.is_some() {
        "returned"
    } else if loan.overdue_days > 0 {
        "overdue"
    } else {
        "active"
    }
    .into();
    Ok(loan)
}
fn parse_stored_date(s: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| AppError::new("storage", "借阅日期数据无效，请保留数据库并联系维护人员"))
}
fn valid_id(id: i64, field: &str) -> AppResult<i64> {
    if id > 0 {
        Ok(id)
    } else {
        Err(AppError::validation(field, "请选择有效记录"))
    }
}
fn get_conn(conn: &Connection, id: i64, today: NaiveDate) -> AppResult<Loan> {
    let loan = conn
        .query_row(&format!("{SELECT} WHERE id=?1"), [id], row_loan)
        .optional()?
        .ok_or_else(AppError::not_found)?;
    classify(loan, today)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Checkout {
    reader_id: i64,
    book_id: i64,
}
#[derive(Deserialize)]
struct Get {
    id: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Return {
    loan_id: i64,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Query {
    #[serde(default)]
    search: String,
    #[serde(default = "all")]
    status: String,
    page: Option<u32>,
    reader_id: Option<i64>,
    book_id: Option<i64>,
    from: Option<String>,
    to: Option<String>,
}
fn all() -> String {
    "all".into()
}

mod statistics;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StatisticsInput {}

pub fn handle(store: &Store, action: &str, payload: Value) -> AppResult<Value> {
    let now = Local::now();
    match action {
        "statistics" => {
            let _: StatisticsInput = serde_json::from_value(payload)?;
            statistics::snapshot(store, now.date_naive())
        }
        "checkout" => {
            let p: Checkout = serde_json::from_value(payload)?;
            Ok(serde_json::to_value(checkout_at(
                store,
                valid_id(p.reader_id, "readerId")?,
                valid_id(p.book_id, "bookId")?,
                now,
            )?)?)
        }
        "return" => {
            let p: Return = serde_json::from_value(payload)?;
            Ok(serde_json::to_value(return_at(
                store,
                valid_id(p.loan_id, "loanId")?,
                now,
            )?)?)
        }
        "get" => {
            let p: Get = serde_json::from_value(payload)?;
            valid_id(p.id, "id")?;
            store.with_conn(|c| Ok(serde_json::to_value(get_conn(c, p.id, now.date_naive())?)?))
        }
        "list" => {
            let q: Query = serde_json::from_value(payload)?;
            list_at(store, q, now.date_naive())
        }
        _ => Err(AppError::new("validation", "未知借阅操作")),
    }
}
fn checkout_at(
    store: &Store,
    reader_id: i64,
    book_id: i64,
    now: DateTime<Local>,
) -> AppResult<Loan> {
    store.with_conn(|conn| {
        let tx = conn.transaction()?;
        let reader: Option<(String,String,bool)> = tx.query_row("SELECT code,name,enabled FROM readers WHERE id=?1",[reader_id],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        let (reader_code, reader_name, reader_enabled) = reader.ok_or_else(AppError::not_found)?;
        if !reader_enabled { return Err(AppError::conflict("读者已停用，无法新增借阅")); }
        let book: Option<(String,String,bool)> = tx.query_row("SELECT code,title,enabled FROM books WHERE id=?1",[book_id],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        let (book_code, book_title, book_enabled) = book.ok_or_else(AppError::not_found)?;
        if !book_enabled { return Err(AppError::conflict("图书已停用，无法借出")); }
        let borrowed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM loans WHERE book_id=?1 AND returned_at IS NULL)",[book_id],|r| r.get(0))?;
        if borrowed { return Err(AppError::conflict("这本图书已借出，请刷新后选择其他图书")); }
        let count: i64 = tx.query_row("SELECT count(*) FROM loans WHERE reader_id=?1 AND returned_at IS NULL",[reader_id],|r| r.get(0))?;
        if count >= 5 { return Err(AppError::conflict("读者已达到同时借阅 5 本的上限，请先归还")); }
        let due = now.date_naive().checked_add_days(Days::new(30)).ok_or_else(|| AppError::new("validation","系统日期超出支持范围"))?.to_string();
        let borrowed_at = now.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis,true);
        tx.execute("INSERT INTO loans(book_id,reader_id,borrowed_at,due_date,reader_code,reader_name,book_code,book_title) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![book_id,reader_id,borrowed_at,due,reader_code,reader_name,book_code,book_title])?;
        let id = tx.last_insert_rowid();
        let loan = get_conn(&tx,id,now.date_naive())?;
        tx.commit()?;
        Ok(loan)
    })
}
fn return_at(store: &Store, loan_id: i64, now: DateTime<Local>) -> AppResult<Loan> {
    store.with_conn(|conn| {
        let tx = conn.transaction()?;
        let loan = get_conn(&tx,loan_id,now.date_naive())?;
        if loan.returned_at.is_none() {
            let borrowed = DateTime::parse_from_rfc3339(&loan.borrowed_at).map_err(|_| AppError::new("storage","借出时间数据无效"))?;
            if now < borrowed { return Err(AppError::conflict("系统时间早于借出时间，请校准系统时钟后归还")); }
            tx.execute("UPDATE loans SET returned_at=?1,returned_local_date=?2 WHERE id=?3 AND returned_at IS NULL",params![now.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis,true),now.date_naive().to_string(),loan_id])?;
        }
        let result = get_conn(&tx,loan_id,now.date_naive())?;
        tx.commit()?;
        Ok(result)
    })
}
fn input_date(value: Option<String>, field: &str) -> AppResult<Option<NaiveDate>> {
    value
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            let date = NaiveDate::parse_from_str(&s, "%Y-%m-%d")
                .map_err(|_| AppError::validation(field, "请输入有效日期"))?;
            if s != date.to_string() {
                return Err(AppError::validation(field, "日期格式应为 YYYY-MM-DD"));
            }
            Ok(date)
        })
        .transpose()
}
fn list_at(store: &Store, q: Query, today: NaiveDate) -> AppResult<Value> {
    let search = validation::text(&q.search, "search", 200, false)?.to_lowercase();
    let page = validation::page(q.page)?;
    if !["all", "active", "overdue", "returned"].contains(&q.status.as_str()) {
        return Err(AppError::validation("status", "借阅状态无效"));
    }
    if let Some(id) = q.reader_id {
        valid_id(id, "readerId")?;
    }
    if let Some(id) = q.book_id {
        valid_id(id, "bookId")?;
    }
    let from = input_date(q.from, "from")?;
    let to = input_date(q.to, "to")?;
    if from.zip(to).is_some_and(|(a, b)| a > b) {
        return Err(AppError::validation("from", "起始日期不能晚于结束日期"));
    }
    store.with_conn(|conn| {
        let mut stmt = conn.prepare(&format!("{SELECT} WHERE (?1 IS NULL OR reader_id=?1) AND (?2 IS NULL OR book_id=?2) ORDER BY borrowed_at DESC,id DESC"))?;
        let raw = stmt.query_map(params![q.reader_id,q.book_id],row_loan)?;
        let mut matched = Vec::new();
        for row in raw {
            let loan = classify(row?,today)?;
            let state_matches = match q.status.as_str() { "active" => loan.returned_at.is_none(), "overdue" => loan.status=="overdue", "returned" => loan.returned_at.is_some(), _ => true };
            if !state_matches { continue; }
            if !search.is_empty() && ![&loan.reader_code,&loan.reader_name,&loan.book_code,&loan.book_title].iter().any(|v| v.to_lowercase().contains(&search)) { continue; }
            if from.is_some() || to.is_some() {
                let date = DateTime::parse_from_rfc3339(&loan.borrowed_at).map_err(|_| AppError::new("storage","借出时间数据无效"))?.with_timezone(&Local).date_naive();
                if from.is_some_and(|v| date<v) || to.is_some_and(|v| date>v) { continue; }
            }
            matched.push(loan);
        }
        let total = matched.len();
        let items: Vec<Loan> = matched.into_iter().skip((page as usize-1)*20).take(20).collect();
        Ok(json!({"items":items,"total":total}))
    })
}

#[cfg(test)]
mod tests;
