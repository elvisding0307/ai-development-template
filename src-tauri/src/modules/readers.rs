use crate::{
    db::Store,
    error::{AppError, AppResult},
};
use serde_json::Value;
pub fn handle(store: &Store, action: &str, payload: Value) -> AppResult<Value> {
    let _ = (store, action, payload);
    Err(AppError::new("not_implemented", "该模块正在开发中"))
}
