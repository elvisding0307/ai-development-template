use serde::Serialize;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}
pub type AppResult<T> = Result<T, AppError>;
impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            field: None,
        }
    }
    pub fn validation(field: &str, message: &str) -> Self {
        Self {
            code: "validation".into(),
            message: message.into(),
            field: Some(field.into()),
        }
    }
    pub fn conflict(message: &str) -> Self {
        Self::new("conflict", message)
    }
    pub fn not_found() -> Self {
        Self::new("not_found", "记录不存在，请刷新后重试")
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("storage", "数据库操作失败，数据未保存，请重试")
    }
}
impl From<std::io::Error> for AppError {
    fn from(_: std::io::Error) -> Self {
        Self::new("storage", "文件操作失败，请检查路径、权限及可用空间")
    }
}
impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        Self::new("validation", "输入格式无效")
    }
}
