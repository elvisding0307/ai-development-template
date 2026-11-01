use super::parse_stored_date;
use crate::{
    db::Store,
    error::{AppError, AppResult},
};
use chrono::{DateTime, Days, Local, NaiveDate, Utc};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    books: i64,
    readers: i64,
    active_loans: i64,
    overdue_loans: i64,
}
#[derive(Serialize)]
struct TrendDay {
    date: String,
    borrowed: i64,
    returned: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PopularBook {
    book_id: i64,
    code: String,
    title: String,
    borrow_count: i64,
}
#[derive(Serialize)]
struct Category {
    name: String,
    count: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Statistics {
    as_of: String,
    generated_at: String,
    totals: Totals,
    trend: Vec<TrendDay>,
    popular_books: Vec<PopularBook>,
    categories: Vec<Category>,
}

pub(super) fn snapshot(store: &Store, today: NaiveDate) -> AppResult<Value> {
    store.with_conn(|conn| {
        // One read transaction keeps all panels on the same snapshot, including
        // when another SQLite connection is used by an external maintenance tool.
        let tx = conn.transaction()?;
        let result = read(&tx, today)?;
        tx.commit()?;
        Ok(serde_json::to_value(result)?)
    })
}
fn read(conn: &Connection, today: NaiveDate) -> AppResult<Statistics> {
    let start = today
        .checked_sub_days(Days::new(6))
        .ok_or_else(|| AppError::new("validation", "系统日期超出统计支持范围"))?;
    let mut trend: Vec<TrendDay> = (0..7)
        .map(|i| TrendDay {
            date: (start + Days::new(i)).to_string(),
            borrowed: 0,
            returned: 0,
        })
        .collect();
    let mut totals = Totals {
        books: conn.query_row("SELECT count(*) FROM books", [], |r| r.get(0))?,
        readers: conn.query_row("SELECT count(*) FROM readers", [], |r| r.get(0))?,
        ..Totals::default()
    };
    let mut statement =
        conn.prepare("SELECT borrowed_at,due_date,returned_at,returned_local_date FROM loans")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let borrowed: String = row.get(0)?;
        let due: String = row.get(1)?;
        let returned_at: Option<String> = row.get(2)?;
        let returned_date: Option<String> = row.get(3)?;
        let borrowed = DateTime::parse_from_rfc3339(&borrowed)
            .map_err(|_| AppError::new("storage", "借出时间数据无效，无法生成完整统计"))?
            .with_timezone(&Local)
            .date_naive();
        let due = parse_stored_date(&due)?;
        let index = (borrowed - start).num_days();
        if (0..7).contains(&index) {
            trend[index as usize].borrowed += 1;
        }
        match (returned_at, returned_date) {
            (None, None) => {
                totals.active_loans += 1;
                if due < today {
                    totals.overdue_loans += 1;
                }
            }
            (Some(time), Some(date)) => {
                DateTime::parse_from_rfc3339(&time)
                    .map_err(|_| AppError::new("storage", "归还时间数据无效，无法生成完整统计"))?;
                let index = (parse_stored_date(&date)? - start).num_days();
                if (0..7).contains(&index) {
                    trend[index as usize].returned += 1;
                }
            }
            _ => return Err(AppError::new("storage", "归还数据不完整，无法生成统计")),
        }
    }
    let mut statement = conn.prepare("SELECT b.id,b.code,b.title,count(*) AS borrow_count FROM books b JOIN loans l ON l.book_id=b.id GROUP BY b.id ORDER BY borrow_count DESC,b.code ASC,b.id ASC LIMIT 5")?;
    let popular_books = statement
        .query_map([], |r| {
            Ok(PopularBook {
                book_id: r.get(0)?,
                code: r.get(1)?,
                title: r.get(2)?,
                borrow_count: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare("SELECT CASE WHEN trim(category)='' THEN '未分类' ELSE category END AS category_name,count(*) AS amount FROM books GROUP BY category_name ORDER BY amount DESC,category_name ASC")?;
    let categories = statement
        .query_map([], |r| {
            Ok(Category {
                name: r.get(0)?,
                count: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Statistics {
        as_of: today.to_string(),
        generated_at: Utc::now().to_rfc3339(),
        totals,
        trend,
        popular_books,
        categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone};
    use serde_json::json;
    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()
    }
    fn setup() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(dir.path().join("library.sqlite")).unwrap();
        (dir, s)
    }
    fn entities(s: &Store) {
        s.with_conn(|c| {
            c.execute("INSERT INTO readers(id,code,name,created_at,updated_at) VALUES(1,'R1','读者','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",[])?;
            for id in 1..=7 { c.execute("INSERT INTO books(id,code,title,category,created_at,updated_at) VALUES(?1,?2,'同名书',?3,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",rusqlite::params![id,format!("B{id:02}"),if id<=3 { "文学" } else if id==4 { "未分类" } else { "" }])?; }
            Ok(())
        }).unwrap();
    }
    fn loan(
        s: &Store,
        book: i64,
        borrowed_date: NaiveDate,
        due: NaiveDate,
        returned: Option<NaiveDate>,
    ) {
        let borrowed = Local
            .from_local_datetime(&borrowed_date.and_hms_opt(12, 0, 0).unwrap())
            .single()
            .unwrap()
            .with_timezone(&Utc)
            .to_rfc3339();
        let returned_time = returned.map(|d| {
            Local
                .from_local_datetime(&d.and_hms_opt(13, 0, 0).unwrap())
                .single()
                .unwrap()
                .with_timezone(&Utc)
                .to_rfc3339()
        });
        s.with_conn(|c| { c.execute("INSERT INTO loans(book_id,reader_id,borrowed_at,due_date,returned_at,returned_local_date,reader_code,reader_name,book_code,book_title) VALUES(?1,1,?2,?3,?4,?5,'R1','旧姓名',?6,'旧书名')",rusqlite::params![book,borrowed,due.to_string(),returned_time,returned.map(|d|d.to_string()),format!("B{book:02}")])?; Ok(()) }).unwrap();
    }
    #[test]
    fn empty_library_has_seven_zero_days_and_no_fake_rows() {
        let (_d, s) = setup();
        let result = snapshot(&s, day()).unwrap();
        assert_eq!(
            result["totals"],
            json!({"books":0,"readers":0,"activeLoans":0,"overdueLoans":0})
        );
        assert_eq!(result["trend"].as_array().unwrap().len(), 7);
        assert_eq!(result["trend"][0]["date"], "2026-10-26");
        assert_eq!(result["trend"][6]["date"], "2026-11-01");
        assert!(result["trend"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["borrowed"] == 0 && v["returned"] == 0));
        assert_eq!(result["popularBooks"], json!([]));
        assert_eq!(result["categories"], json!([]));
    }
    #[test]
    fn trend_uses_inclusive_local_dates_and_persisted_return_date() {
        let (_d, s) = setup();
        entities(&s);
        let today = day();
        loan(
            &s,
            1,
            today - Duration::days(7),
            today,
            Some(today - Duration::days(7)),
        );
        loan(
            &s,
            2,
            today - Duration::days(6),
            today,
            Some(today - Duration::days(6)),
        );
        loan(&s, 3, today, today, None);
        // The stored local return day is authoritative even if it differs from
        // conversion of the UTC instant under the current device timezone.
        loan(&s, 4, today - Duration::days(10), today, Some(today));
        s.with_conn(|c| {
            c.execute(
                "UPDATE loans SET returned_at='2026-10-31T12:00:00Z' WHERE book_id=4",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        let result = snapshot(&s, today).unwrap();
        let days = result["trend"].as_array().unwrap();
        assert_eq!(days[0]["borrowed"], 1);
        assert_eq!(days[0]["returned"], 1);
        assert_eq!(days[6]["borrowed"], 1);
        assert_eq!(days[6]["returned"], 1);
        assert_eq!(
            days.iter()
                .map(|v| v["borrowed"].as_i64().unwrap())
                .sum::<i64>(),
            2
        );
        assert!(days[1..6]
            .iter()
            .all(|v| v["borrowed"] == 0 && v["returned"] == 0));
    }
    #[test]
    fn totals_popularity_categories_and_refresh_match_business_data() {
        let (_d, s) = setup();
        entities(&s);
        let today = day();
        loan(
            &s,
            1,
            today - Duration::days(40),
            today - Duration::days(1),
            None,
        );
        loan(&s, 2, today - Duration::days(30), today, None);
        loan(
            &s,
            3,
            today - Duration::days(10),
            today + Duration::days(20),
            None,
        );
        for _ in 0..3 {
            loan(
                &s,
                4,
                today - Duration::days(50),
                today - Duration::days(20),
                Some(today - Duration::days(19)),
            );
        }
        loan(
            &s,
            5,
            today - Duration::days(45),
            today - Duration::days(15),
            Some(today - Duration::days(10)),
        );
        loan(
            &s,
            6,
            today - Duration::days(42),
            today - Duration::days(12),
            Some(today - Duration::days(8)),
        );
        s.with_conn(|c| {
            c.execute("UPDATE books SET enabled=0,title='新书名' WHERE id=4", [])?;
            c.execute("UPDATE readers SET enabled=0", [])?;
            Ok(())
        })
        .unwrap();
        let before = s.with_conn(|c| Ok(c.total_changes())).unwrap();
        let result = snapshot(&s, today).unwrap();
        assert_eq!(
            result["totals"],
            json!({"books":7,"readers":1,"activeLoans":3,"overdueLoans":1})
        );
        assert_eq!(result["popularBooks"].as_array().unwrap().len(), 5);
        assert_eq!(result["popularBooks"][0]["bookId"], 4);
        assert_eq!(result["popularBooks"][0]["title"], "新书名");
        assert_eq!(result["popularBooks"][0]["borrowCount"], 3);
        assert_eq!(result["popularBooks"][1]["code"], "B01");
        assert_eq!(result["popularBooks"][4]["code"], "B05");
        assert_eq!(
            result["categories"],
            json!([{"name":"未分类","count":4},{"name":"文学","count":3}])
        );
        assert_eq!(s.with_conn(|c| Ok(c.total_changes())).unwrap(), before);
        assert_eq!(
            snapshot(&s, today + Duration::days(1)).unwrap()["totals"]["overdueLoans"],
            2
        );
        s.with_conn(|c| { c.execute("UPDATE loans SET returned_at='2026-11-01T12:00:00Z',returned_local_date='2026-11-01' WHERE book_id=1",[])?; Ok(()) }).unwrap();
        assert_eq!(snapshot(&s, today).unwrap()["totals"]["overdueLoans"], 0);
    }
    #[test]
    fn malformed_dates_fail_instead_of_showing_partial_numbers() {
        let (_d, s) = setup();
        entities(&s);
        loan(&s, 1, day(), day(), None);
        s.with_conn(|c| {
            c.execute("UPDATE loans SET borrowed_at='bad'", [])?;
            Ok(())
        })
        .unwrap();
        assert_eq!(snapshot(&s, day()).unwrap_err().code, "storage");
        assert!(super::super::handle(&s, "statistics", json!({"today":"2000-01-01"})).is_err());
    }
}
