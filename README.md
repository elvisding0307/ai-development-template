# 青禾 · 图书管理

Rust + Tauri 2 + React 的离线桌面图书管理工具。功能规格见 [项目概览](docs/project.md)。

## 开发

需要 Node.js 22.12+、Rust（由 rust-toolchain.toml 固定）及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run tauri dev
```

`npm run dev` 仅预览前端，业务数据操作必须在桌面客户端内执行。

## 验证与打包

```sh
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build
```

数据存储于系统应用数据目录中的 `com.qinghe.library/library.sqlite`，与安装目录独立。升级或卸载应用资源时请保留该目录。备份恢复行为以功能规格为准。
