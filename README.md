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


## 并行开发

框架先提交为 `1d81203`，随后创建以下分支与独立 worktree。馆藏、读者、借阅由 3 个 agent 并行开发，主代理在数据管理 worktree 完成备份恢复并负责交叉审查和集成；模块提交已集成到主分支。所有 worktree 均保留，不自动删除。

| 模块 | 分支 | Worktree（相对当前仓库） |
|---|---|---|
| 馆藏 | `feat/catalog` | `../ai-development-template-worktrees/catalog` |
| 读者 | `feat/readers` | `../ai-development-template-worktrees/readers` |
| 借阅 | `feat/circulation` | `../ai-development-template-worktrees/circulation` |
| 数据管理 | `feat/data` | `../ai-development-template-worktrees/data` |

使用 `git worktree list` 查看本机实际路径。继续在模块分支开发前，先将主分支的集成修正同步到该分支；依赖可在对应 worktree 运行 `npm ci` 安装。共享接口类型见 `src/shared/models.ts`，模块约定见 [模块开发说明](src/modules/README.md)。

## 交付与验证

6 个功能均已实现，用户业务验收待进行。[验证记录](docs/verification.md) 区分自动测试、实际桌面操作和未验证平台。

macOS 正式构建位于 `src-tauri/target/release/bundle/macos/青禾图书管理.app`。当前没有内置示例业务记录，首次启动为空图书室。
