use crate::error::{AppError, AppResult};
pub fn text(value: &str, field: &str, max: usize, required: bool) -> AppResult<String> {
    let value = value.trim();
    if required && value.is_empty() {
        return Err(AppError::validation(field, "此项不能为空"));
    }
    if value.chars().count() > max {
        return Err(AppError::validation(
            field,
            &format!("最多允许 {max} 个字符"),
        ));
    }
    Ok(value.into())
}
pub fn code(value: &str) -> AppResult<String> {
    let value = text(value, "code", 32, true)?.to_ascii_uppercase();
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::validation(
            "code",
            "编号仅允许英文字母、数字、短横线和下划线",
        ));
    }
    Ok(value)
}
pub fn page(value: Option<u32>) -> AppResult<u32> {
    let p = value.unwrap_or(1);
    if p == 0 || p > 1_000_000 {
        Err(AppError::validation("page", "页码无效"))
    } else {
        Ok(p)
    }
}
