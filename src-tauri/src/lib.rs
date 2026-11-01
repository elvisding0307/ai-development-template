pub mod db;
pub mod error;
pub mod modules;
pub mod validation;
use db::Store;
use error::{AppError, AppResult};
use serde_json::Value;
use std::sync::Arc;
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
#[tauri::command]
async fn library(
    app: tauri::AppHandle,
    store: State<'_, AppResult<Arc<Store>>>,
    module: String,
    action: String,
    payload: Value,
) -> AppResult<Value> {
    let store = store.inner().as_ref().map_err(Clone::clone)?.clone();
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
            let directory = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("QINGHE_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(directory);
            let path = directory.join("library.sqlite");
            let state = Store::open(&path).map(Arc::new).map_err(|mut error| {
                error.message = format!(
                    "{}\n数据位置：{}\n请保留此目录和已有安全备份。客户端已停止业务操作。",
                    error.message,
                    path.display()
                );
                error
            });
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![library]);
    match builder.build(tauri::generate_context!()) {
        Ok(app) => app.run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                let state = app.state::<AppResult<Arc<Store>>>();
                if let Err(error) = state.inner() {
                    let handle = app.clone();
                    let mut message = app
                        .dialog()
                        .message(&error.message)
                        .title("无法打开图书室数据")
                        .kind(MessageDialogKind::Error);
                    if let Some(window) = app.get_webview_window("main") {
                        message = message.parent(&window);
                    }
                    message.show(move |_| handle.exit(1));
                }
            }
        }),
        Err(error) => eprintln!("客户端启动失败：{error}"),
    }
}
