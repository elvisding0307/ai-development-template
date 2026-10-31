use super::*;
use chrono::TimeZone;
use std::sync::{Arc, Barrier};
fn clock(y: i32, m: u32, d: u32) -> DateTime<Local> {
    Local.with_ymd_and_hms(y, m, d, 12, 0, 0).unwrap()
}
fn setup() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("library.sqlite")).unwrap();
    store.with_conn(|c| { c.execute("INSERT INTO readers(id,code,name,created_at,updated_at) VALUES(1,'R1','原姓名','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",[])?; for i in 1..=30 {c.execute("INSERT INTO books(id,code,title,created_at,updated_at) VALUES(?1,?2,?3,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",params![i,format!("B{i}"),format!("原书名{i}")])?;} Ok(()) }).unwrap();
    (dir, store)
}
#[test]
fn checkout_due_date_snapshots_and_duplicate_protection() {
    let (_d, s) = setup();
    let l = checkout_at(&s, 1, 1, clock(2026, 10, 31)).unwrap();
    assert_eq!(l.due_date, "2026-11-30");
    assert_eq!(l.status, "active");
    assert_eq!(
        checkout_at(&s, 1, 1, clock(2026, 10, 31)).unwrap_err().code,
        "conflict"
    );
    s.with_conn(|c| {
        c.execute("UPDATE readers SET name='新姓名' WHERE id=1", [])?;
        c.execute("UPDATE books SET title='新书名' WHERE id=1", [])?;
        let old = get_conn(c, l.id, clock(2026, 11, 1).date_naive())?;
        assert_eq!(old.reader_name, "原姓名");
        assert_eq!(old.book_title, "原书名1");
        Ok(())
    })
    .unwrap();
}
#[test]
fn loan_limit_is_atomic_even_under_concurrent_checkout() {
    let (_d, s) = setup();
    for book in 1..=4 {
        checkout_at(&s, 1, book, clock(2026, 10, 31)).unwrap();
    }
    let s = Arc::new(s);
    let barrier = Arc::new(Barrier::new(3));
    let threads: Vec<_> = (5..=6)
        .map(|book| {
            let s = s.clone();
            let b = barrier.clone();
            std::thread::spawn(move || {
                b.wait();
                checkout_at(&s, 1, book, clock(2026, 10, 31)).is_ok()
            })
        })
        .collect();
    barrier.wait();
    let successes = threads
        .into_iter()
        .filter_map(|t| t.join().ok())
        .filter(|v| *v)
        .count();
    assert_eq!(successes, 1);
    s.with_conn(|c| {
        let n: i64 = c.query_row(
            "SELECT count(*) FROM loans WHERE returned_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(n, 5);
        Ok(())
    })
    .unwrap();
}
#[test]
fn concurrent_same_copy_has_only_one_winner() {
    let (_d, s) = setup();
    let s = Arc::new(s);
    let barrier = Arc::new(Barrier::new(3));
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let s = s.clone();
            let b = barrier.clone();
            std::thread::spawn(move || {
                b.wait();
                checkout_at(&s, 1, 1, clock(2026, 10, 31)).is_ok()
            })
        })
        .collect();
    barrier.wait();
    assert_eq!(
        threads
            .into_iter()
            .map(|t| t.join().unwrap() as usize)
            .sum::<usize>(),
        1
    );
}
#[test]
fn disabled_entities_and_missing_ids_are_rechecked() {
    let (_d, s) = setup();
    s.with_conn(|c| {
        c.execute("UPDATE readers SET enabled=0 WHERE id=1", [])?;
        Ok(())
    })
    .unwrap();
    assert!(checkout_at(&s, 1, 1, clock(2026, 10, 31)).is_err());
    s.with_conn(|c| {
        c.execute("UPDATE readers SET enabled=1 WHERE id=1", [])?;
        c.execute("UPDATE books SET enabled=0 WHERE id=1", [])?;
        Ok(())
    })
    .unwrap();
    assert!(checkout_at(&s, 1, 1, clock(2026, 10, 31)).is_err());
    assert_eq!(
        checkout_at(&s, 99, 2, clock(2026, 10, 31))
            .unwrap_err()
            .code,
        "not_found"
    );
}
#[test]
fn return_is_idempotent_allows_disabled_reader_and_protects_new_loan() {
    let (_d, s) = setup();
    let old = checkout_at(&s, 1, 1, clock(2026, 10, 31)).unwrap();
    s.with_conn(|c| {
        c.execute("UPDATE readers SET enabled=0 WHERE id=1", [])?;
        Ok(())
    })
    .unwrap();
    let returned = return_at(&s, old.id, clock(2026, 12, 2)).unwrap();
    assert_eq!(returned.overdue_days, 2);
    assert!(returned.returned_late);
    assert_eq!(returned.status, "returned");
    s.with_conn(|c| {
        c.execute("UPDATE readers SET enabled=1 WHERE id=1", [])?;
        Ok(())
    })
    .unwrap();
    let new = checkout_at(&s, 1, 1, clock(2026, 12, 3)).unwrap();
    let repeated = return_at(&s, old.id, clock(2026, 12, 4)).unwrap();
    assert_eq!(returned.returned_at, repeated.returned_at);
    s.with_conn(|c| {
        assert!(get_conn(c, new.id, clock(2026, 12, 4).date_naive())?
            .returned_at
            .is_none());
        Ok(())
    })
    .unwrap();
}
#[test]
fn due_day_and_next_day_are_calendar_boundaries() {
    let (_d, s) = setup();
    let loan = checkout_at(&s, 1, 1, clock(2026, 10, 31)).unwrap();
    s.with_conn(|c| {
        let due = get_conn(c, loan.id, clock(2026, 11, 30).date_naive())?;
        assert_eq!(due.status, "active");
        assert_eq!(due.overdue_days, 0);
        let late = get_conn(c, loan.id, clock(2026, 12, 1).date_naive())?;
        assert_eq!(late.status, "overdue");
        assert_eq!(late.overdue_days, 1);
        Ok(())
    })
    .unwrap();
}
#[test]
fn failures_roll_back_checkout_and_return() {
    let (_d, s) = setup();
    s.with_conn(|c|{c.execute_batch("CREATE TRIGGER deny_checkout BEFORE INSERT ON loans BEGIN SELECT RAISE(ABORT, 'injected'); END")?;Ok(())}).unwrap();
    assert!(checkout_at(&s, 1, 1, clock(2026, 10, 31)).is_err());
    s.with_conn(|c| {
        let n: i64 = c.query_row("SELECT count(*) FROM loans", [], |r| r.get(0))?;
        assert_eq!(n, 0);
        c.execute_batch("DROP TRIGGER deny_checkout")?;
        Ok(())
    })
    .unwrap();
    let loan = checkout_at(&s, 1, 1, clock(2026, 10, 31)).unwrap();
    s.with_conn(|c|{c.execute_batch("CREATE TRIGGER deny_return BEFORE UPDATE ON loans BEGIN SELECT RAISE(ABORT, 'injected'); END")?;Ok(())}).unwrap();
    assert!(return_at(&s, loan.id, clock(2026, 11, 1)).is_err());
    s.with_conn(|c| {
        assert!(get_conn(c, loan.id, clock(2026, 11, 1).date_naive())?
            .returned_at
            .is_none());
        Ok(())
    })
    .unwrap();
}
#[test]
fn listing_combines_literal_search_state_dates_ids_and_pagination() {
    let (_d, s) = setup();
    for book in 1..=25 {
        let l = checkout_at(&s, 1, book, clock(2026, 10, 31)).unwrap();
        return_at(&s, l.id, clock(2026, 11, 1)).unwrap();
    }
    checkout_at(&s, 1, 26, clock(2026, 10, 31)).unwrap();
    let query = |value: Value| {
        list_at(
            &s,
            serde_json::from_value(value).unwrap(),
            clock(2026, 12, 1).date_naive(),
        )
        .unwrap()
    };
    let a = query(json!({"readerId":1,"from":"2026-10-31","to":"2026-10-31","status":"returned"}));
    assert_eq!(a["total"], 25);
    assert_eq!(a["items"].as_array().unwrap().len(), 20);
    let b = query(json!({"readerId":1,"status":"returned","page":2}));
    assert_eq!(b["items"].as_array().unwrap().len(), 5);
    assert_ne!(a["items"][0]["id"], b["items"][0]["id"]);
    assert_eq!(query(json!({"status":"active"}))["total"], 1);
    assert_eq!(query(json!({"status":"overdue"}))["total"], 1);
    assert_eq!(query(json!({"search":"原姓名","bookId":26}))["total"], 1);
    assert_eq!(query(json!({"search":"%"}))["total"], 0);
    assert!(list_at(
        &s,
        serde_json::from_value(json!({"from":"2026-11-02","to":"2026-11-01"})).unwrap(),
        clock(2026, 12, 1).date_naive()
    )
    .is_err());
}
#[test]
fn overdue_does_not_prevent_checkout_and_invalid_input_is_rejected() {
    let (_d, s) = setup();
    checkout_at(&s, 1, 1, clock(2026, 10, 31)).unwrap();
    assert!(checkout_at(&s, 1, 2, clock(2026, 12, 5)).is_ok());
    assert!(handle(&s, "checkout", json!({"readerId":0,"bookId":3})).is_err());
    assert!(handle(&s, "list", json!({"status":"unknown"})).is_err());
    assert!(handle(&s, "list", json!({"page":0})).is_err());
}
