use crate::{
    db::Store,
    error::{AppError, AppResult},
};
use serde_json::Value;
pub fn handle(
    store: &Store,
    app: &tauri::AppHandle,
    action: &str,
    payload: Value,
) -> AppResult<Value> {
    let _ = (store, app, action, payload);
    Err(AppError::new("not_implemented", "该模块正在开发中"))
}
