# 模块开发约定

各模块自有 React 页面目录及 Rust `src-tauri/src/modules/<module>.rs`，经共享 IPC `call<T>(module, action, payload)` 通信。共享返回类型见 `src/shared/models.ts`，数据库定义见 `src-tauri/src/schema.sql`，不重复建立数据库。

- catalog / readers：`list({search?,status?,page?})` 返回 ListResult；`get({id})` 返回实体；`save({id?,...资料字段})` 返回实体；`set_enabled({id,enabled})` 返回实体。
- catalog 状态：all / available / borrowed / disabled；readers 状态：all / enabled / disabled。
- circulation：`checkout({readerId,bookId})`、`return({loanId})`、`get({id})` 返回 Loan；`list({search?,status?,page?,readerId?,bookId?,from?,to?})` 返回 ListResult，状态 all / active / overdue / returned。
- circulation：新增 `statistics({})` 只读统计，返回类型见 BorrowingStatistics；日期由 Rust 生成，不接受前端传入日期或计数。
- data：原生文件选择由 Rust 模块完成；数据管理页面通过本模块 action 获取结果，不开放通用文件读写或任意 SQL。

所有列表每页 20 条；输入按功能规格校验。操作成功后调用 `changed()` 通知关联页面刷新。页面 props 使用共享 PageProps，导航通过 navigate(Route)。可复用组件和 CSS 见 `src/shared/ui.tsx` 与 `src/styles.css`。不修改其他模块以绕过接口。

Rust 通过 Store.with_conn 获取串行连接，写入自行建立事务；维护操作通过 Store.with_maintenance。不得从业务模块另建绕过共享锁的活动连接。
