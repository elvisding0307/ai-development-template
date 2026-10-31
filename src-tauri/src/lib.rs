pub mod db;
pub mod error;
pub mod modules;
pub mod validation;
use db::Store;
use error::{AppError, AppResult};
use serde_json::Value;
use std::sync::Arc;
use tauri::{Manager, State};
#[tauri::command]
async fn library(
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
    module: String,
    action: String,
    payload: Value,
) -> AppResult<Value> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match module.as_str() {
        "catalog" => modules::catalog::handle(&store, &action, payload),
        "readers" => modules::readers::handle(&store, &action, payload),
        "circulation" => modules::circulation::handle(&store, &action, payload),
        "data" => modules::data::handle(&store, &app, &action, payload),
        _ => Err(AppError::new("validation", "未知模块")),
    })
    .await
    .map_err(|_| AppError::new("internal", "任务执行失败，请重试"))?
}
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("library.sqlite");
            let store = Store::open(path).map_err(|e| std::io::Error::other(e.message))?;
            app.manage(Arc::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![library]);
    if let Err(e) = builder.run(tauri::generate_context!()) {
        eprintln!("客户端启动失败：{e}");
    }
}
