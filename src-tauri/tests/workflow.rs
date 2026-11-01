use library_desktop_lib::{
    db::Store,
    modules::{catalog, circulation, readers},
};
use serde_json::{json, Value};
use std::sync::{Arc, Barrier};
fn book(s: &Store, code: &str) -> Value {
    catalog::handle(s, "save", json!({"code":code,"title":"借出时书名"})).unwrap()
}
fn reader(s: &Store) -> Value {
    readers::handle(s, "save", json!({"code":"R001","name":"借出时姓名"})).unwrap()
}
#[test]
fn complete_cross_module_lifecycle_preserves_snapshots_and_identity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite");
    let s = Store::open(&path).unwrap();
    let b = book(&s, "B001");
    let r = reader(&s);
    let loan =
        circulation::handle(&s, "checkout", json!({"bookId":b["id"],"readerId":r["id"]})).unwrap();
    assert_eq!(
        catalog::handle(&s, "get", json!({"id":b["id"]})).unwrap()["status"],
        "borrowed"
    );
    assert_eq!(
        readers::handle(&s, "get", json!({"id":r["id"]})).unwrap()["activeLoans"],
        1
    );
    assert!(catalog::handle(&s, "set_enabled", json!({"id":b["id"],"enabled":false})).is_err());
    catalog::handle(
        &s,
        "save",
        json!({"id":b["id"],"code":"B001","title":"修改后书名"}),
    )
    .unwrap();
    readers::handle(
        &s,
        "save",
        json!({"id":r["id"],"code":"R001","name":"修改后姓名"}),
    )
    .unwrap();
    readers::handle(&s, "set_enabled", json!({"id":r["id"],"enabled":false})).unwrap();
    let result = circulation::handle(&s, "return", json!({"loanId":loan["id"]})).unwrap();
    assert_eq!(result["status"], "returned");
    assert_eq!(result["readerName"], "借出时姓名");
    assert_eq!(result["bookTitle"], "借出时书名");
    assert_eq!(
        catalog::handle(&s, "get", json!({"id":b["id"]})).unwrap()["status"],
        "available"
    );
    assert_eq!(
        readers::handle(&s, "get", json!({"id":r["id"]})).unwrap()["activeLoans"],
        0
    );
    readers::handle(&s, "set_enabled", json!({"id":r["id"],"enabled":true})).unwrap();
    let second =
        circulation::handle(&s, "checkout", json!({"bookId":b["id"],"readerId":r["id"]})).unwrap();
    assert_ne!(second["id"], loan["id"]);
    circulation::handle(&s, "return", json!({"loanId":loan["id"]})).unwrap();
    assert_eq!(
        catalog::handle(&s, "get", json!({"id":b["id"]})).unwrap()["status"],
        "borrowed"
    );
    drop(s);
    let reopened = Store::open(path).unwrap();
    assert_eq!(
        circulation::handle(&reopened, "list", json!({"readerId":r["id"]})).unwrap()["total"],
        2
    );
    assert_eq!(
        circulation::handle(&reopened, "list", json!({"search":"借出时书名"})).unwrap()["total"],
        1
    );
}
#[test]
fn checkout_and_catalog_disable_cannot_both_succeed() {
    let dir = tempfile::tempdir().unwrap();
    let s = Arc::new(Store::open(dir.path().join("library.sqlite")).unwrap());
    let b = book(&s, "B001")["id"].as_i64().unwrap();
    let r = reader(&s)["id"].as_i64().unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let a = {
        let s = s.clone();
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            barrier.wait();
            circulation::handle(&s, "checkout", json!({"bookId":b,"readerId":r})).is_ok()
        })
    };
    let d = {
        let s = s.clone();
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            barrier.wait();
            catalog::handle(&s, "set_enabled", json!({"id":b,"enabled":false})).is_ok()
        })
    };
    barrier.wait();
    let borrowed = a.join().unwrap();
    let disabled = d.join().unwrap();
    assert_ne!(borrowed, disabled);
    let current = catalog::handle(&s, "get", json!({"id":b})).unwrap();
    let count = circulation::handle(&s, "list", json!({"status":"active","bookId":b})).unwrap()
        ["total"]
        .as_i64()
        .unwrap();
    assert!(
        (current["enabled"] == true && count == 1) || (current["enabled"] == false && count == 0)
    );
}
