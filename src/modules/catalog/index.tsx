import { useEffect, useState, type FormEvent } from "react";
import {
  Plus,
  Search,
  ArrowUpRight,
  Pencil,
  Power,
  BookOpen,
} from "lucide-react";
import { call, changed, errorMessage, type AppError } from "../../shared/api";
import { useQuery } from "../../shared/hooks";
import type { Book, ListResult } from "../../shared/models";
import type { PageProps } from "../../shared/navigation";
import {
  Badge,
  Empty,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Pagination,
} from "../../shared/ui";
import "./catalog.css";

type BookForm = Pick<
  Book,
  "code" | "title" | "author" | "isbn" | "publisher" | "category" | "location"
>;
type Editor = { original: Book | null; form: BookForm };
const blank: BookForm = {
  code: "",
  title: "",
  author: "",
  isbn: "",
  publisher: "",
  category: "",
  location: "",
};
const statusText = {
  available: "可借",
  borrowed: "借出",
  disabled: "停用",
} as const;
function formOf(book: Book): BookForm {
  return {
    code: book.code,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    publisher: book.publisher,
    category: book.category,
    location: book.location,
  };
}
function Status({ book }: { book: Book }) {
  return (
    <Badge
      tone={
        book.status === "available"
          ? "green"
          : book.status === "borrowed"
            ? "amber"
            : "neutral"
      }
    >
      {statusText[book.status]}
    </Badge>
  );
}

export default function CatalogPage({ route, navigate }: PageProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [discard, setDiscard] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<AppError | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Book | null>(null);
  const [message, setMessage] = useState("");
  const books = useQuery(
    () => call<ListResult<Book>>("catalog", "list", { search, status, page }),
    [search, status, page],
  );
  const detail = useQuery(
    () =>
      detailId === null
        ? Promise.resolve(null)
        : call<Book>("catalog", "get", { id: detailId }),
    [detailId],
  );
  useEffect(() => {
    if (route.bookId) setDetailId(route.bookId);
  }, [route]);
  useEffect(() => {
    if (books.data && page > Math.max(1, Math.ceil(books.data.total / 20)))
      setPage(Math.max(1, Math.ceil(books.data.total / 20)));
  }, [books.data, page]);

  function startEditor(book: Book | null) {
    setDetailId(null);
    setFormError(null);
    setDiscard(false);
    setEditor({ original: book, form: book ? formOf(book) : { ...blank } });
  }
  function closeEditor() {
    if (busy || !editor) return;
    if (
      JSON.stringify(editor.form) !==
      JSON.stringify(editor.original ? formOf(editor.original) : blank)
    )
      setDiscard(true);
    else setEditor(null);
  }
  function update(field: keyof BookForm, value: string) {
    setEditor((current) =>
      current
        ? { ...current, form: { ...current.form, [field]: value } }
        : current,
    );
    if (formError?.field === field) setFormError(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await call<Book>("catalog", "save", {
        ...editor.form,
        ...(editor.original ? { id: editor.original.id } : {}),
      });
      setEditor(null);
      setSaved(result);
      setMessage(editor.original ? "图书资料已更新。" : "图书已加入馆藏。");
      setError("");
      changed();
    } catch (e) {
      setFormError({
        code: "validation",
        message: errorMessage(e),
        ...(typeof e === "object" && e ? e : {}),
      } as AppError);
    } finally {
      setBusy(false);
    }
  }
  async function setEnabled(book: Book, enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await call<Book>("catalog", "set_enabled", { id: book.id, enabled });
      setConfirmDisable(null);
      setMessage(
        enabled ? "图书已重新启用。" : "图书已停用，资料与历史仍然保留。",
      );
      setSaved(null);
      changed();
    } catch (e) {
      setError(errorMessage(e));
      setConfirmDisable(null);
    } finally {
      setBusy(false);
    }
  }
  function jump(
    book: Book,
    page: "circulation" | "loans",
    extra: { tab?: "checkout" | "return"; loanId?: number } = {},
  ) {
    setDetailId(null);
    navigate({ page, bookId: book.id, ...extra });
  }
  const detailBook =
    !detail.error && detail.data?.id === detailId ? detail.data : null;
  return (
    <>
      <PageHeader
        eyebrow="THE COLLECTION"
        title="图书管理"
        description="整理每一册馆藏，让好书有处可寻。"
        action={
          <button className="primary" onClick={() => startEditor(null)}>
            <Plus size={16} />
            新增图书
          </button>
        }
      />
      {message && (
        <Notice kind="success">
          <div className="split">
            <span>{message}</span>
            {saved && (
              <button
                className="text-button"
                onClick={() => setDetailId(saved.id)}
              >
                查看详情 <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </Notice>
      )}
      {error && (
        <Notice kind="error">
          {error}
          <button className="text-button" onClick={() => setError("")}>
            关闭提示
          </button>
        </Notice>
      )}
      {books.error && (
        <Notice kind="error">
          {books.error}
          {books.data && " 以下为上次读取的结果。"}{" "}
          <button className="text-button" onClick={() => void books.reload()}>
            重新读取
          </button>
        </Notice>
      )}
      <section className="panel" aria-label="馆藏列表">
        <div className="toolbar">
          <div className="catalog-search">
            <Search size={16} />
            <input
              aria-label="搜索图书"
              placeholder="搜索馆藏编号、书名、作者或 ISBN"
              maxLength={200}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="图书状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">全部状态</option>
            <option value="available">可借</option>
            <option value="borrowed">借出</option>
            <option value="disabled">停用</option>
          </select>
          <span className="count">一册一号 · 独立借还</span>
        </div>
        {books.loading && !books.data ? (
          <Loading />
        ) : books.data && books.data.items.length > 0 ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>馆藏编号</th>
                    <th>图书 / 作者</th>
                    <th>分类</th>
                    <th>馆藏位置</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {books.data.items.map((book) => (
                    <tr key={book.id}>
                      <td>
                        <span className="code">{book.code}</span>
                      </td>
                      <td>
                        <button
                          className="text-button catalog-book-title"
                          onClick={() => setDetailId(book.id)}
                        >
                          {book.title}
                        </button>
                        <div className="subtext">
                          {book.author || "未填写作者"}
                        </div>
                      </td>
                      <td>{book.category || "—"}</td>
                      <td>{book.location || "—"}</td>
                      <td>
                        <Status book={book} />
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            className="text-button"
                            onClick={() => setDetailId(book.id)}
                          >
                            详情
                          </button>
                          <button
                            className="text-button"
                            onClick={() => startEditor(book)}
                          >
                            编辑
                          </button>
                          {book.status === "available" && (
                            <button
                              className="text-button"
                              onClick={() =>
                                jump(book, "circulation", { tab: "checkout" })
                              }
                            >
                              借出 <ArrowUpRight size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={books.data.total}
              onChange={setPage}
            />
          </>
        ) : books.data ? (
          <Empty
            title={
              search || status !== "all"
                ? "没有找到匹配图书"
                : "为图书室添上第一册书"
            }
            description={
              search || status !== "all"
                ? "试试其他关键词，或清除筛选条件。"
                : "录入书名和馆藏编号，就可以开始管理借阅。"
            }
            action={
              search || status !== "all" ? (
                <button
                  onClick={() => {
                    setSearch("");
                    setStatus("all");
                    setPage(1);
                  }}
                >
                  清除筛选
                </button>
              ) : (
                <button className="primary" onClick={() => startEditor(null)}>
                  <Plus size={15} />
                  新增图书
                </button>
              )
            }
          />
        ) : !books.error ? (
          <Empty
            title="尚未读取馆藏"
            description="请重新读取本地数据。"
            action={
              <button onClick={() => void books.reload()}>重新读取</button>
            }
          />
        ) : null}
      </section>
      <div className="catalog-footnote">
        <BookOpen size={14} />
        <span>同一本书的不同副本使用不同馆藏编号；ISBN 可以相同。</span>
      </div>

      {editor && (
        <Modal
          title={editor.original ? "编辑图书" : "新增图书"}
          onClose={closeEditor}
        >
          <form
            className="catalog-editor"
            onSubmit={(event) => void save(event)}
          >
            <p className="catalog-form-intro">
              每条馆藏记录代表一本可单独借还的实体书。<span> * 为必填项</span>
            </p>
            {formError && <Notice kind="error">{formError.message}</Notice>}
            <Field
              label="馆藏编号 *"
              hint={
                editor.original
                  ? "馆藏编号创建后不可修改。"
                  : "1～32 位字母、数字、短横线或下划线；保存时统一为大写。"
              }
            >
              <input
                autoFocus={!editor.original}
                name="code"
                required
                pattern="[A-Za-z0-9_-]+"
                maxLength={32}
                value={editor.form.code}
                disabled={!!editor.original || busy}
                aria-invalid={formError?.field === "code"}
                onChange={(e) => update("code", e.target.value)}
                placeholder="例如 B001"
              />
            </Field>
            <Field label="书名 *">
              <input
                autoFocus={!!editor.original}
                name="title"
                required
                maxLength={200}
                value={editor.form.title}
                disabled={busy}
                aria-invalid={formError?.field === "title"}
                onChange={(e) => update("title", e.target.value)}
                placeholder="填写图书名称"
              />
            </Field>
            <div className="form-grid">
              <Field label="作者">
                <input
                  name="author"
                  maxLength={100}
                  value={editor.form.author}
                  disabled={busy}
                  aria-invalid={formError?.field === "author"}
                  onChange={(e) => update("author", e.target.value)}
                  placeholder="选填"
                />
              </Field>
              <Field label="ISBN">
                <input
                  name="isbn"
                  maxLength={32}
                  value={editor.form.isbn}
                  disabled={busy}
                  aria-invalid={formError?.field === "isbn"}
                  onChange={(e) => update("isbn", e.target.value)}
                  placeholder="选填"
                />
              </Field>
            </div>
            <Field label="出版社">
              <input
                name="publisher"
                maxLength={100}
                value={editor.form.publisher}
                disabled={busy}
                aria-invalid={formError?.field === "publisher"}
                onChange={(e) => update("publisher", e.target.value)}
                placeholder="选填"
              />
            </Field>
            <div className="form-grid">
              <Field label="分类">
                <input
                  name="category"
                  maxLength={50}
                  value={editor.form.category}
                  disabled={busy}
                  aria-invalid={formError?.field === "category"}
                  onChange={(e) => update("category", e.target.value)}
                  placeholder="例如 文学"
                />
              </Field>
              <Field label="馆藏位置">
                <input
                  name="location"
                  maxLength={50}
                  value={editor.form.location}
                  disabled={busy}
                  aria-invalid={formError?.field === "location"}
                  onChange={(e) => update("location", e.target.value)}
                  placeholder="例如 A 区 02 架"
                />
              </Field>
            </div>
            <div className="form-actions">
              <button type="button" disabled={busy} onClick={closeEditor}>
                取消
              </button>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "正在保存…" : "保存图书"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {discard && (
        <Modal title="放弃未保存的修改？" onClose={() => setDiscard(false)}>
          <div className="modal-body">
            <p>关闭后，本次填写的内容不会保存。</p>
            <div className="form-actions">
              <button onClick={() => setDiscard(false)}>继续编辑</button>
              <button
                className="danger"
                onClick={() => {
                  setDiscard(false);
                  setEditor(null);
                  setFormError(null);
                }}
              >
                放弃修改
              </button>
            </div>
          </div>
        </Modal>
      )}
      {detailId !== null && (
        <Modal title="图书详情" onClose={() => setDetailId(null)}>
          <div className="modal-body catalog-detail">
            {error && <Notice kind="error">{error}</Notice>}
            {detail.loading && !detailBook ? <Loading /> : null}
            {detail.error && (
              <Notice kind="error">
                {detail.error}
                <button
                  className="text-button"
                  onClick={() => void detail.reload()}
                >
                  重试
                </button>
              </Notice>
            )}
            {detailBook && (
              <>
                <div className="catalog-detail-heading">
                  <span className="code">{detailBook.code}</span>
                  <Status book={detailBook} />
                  <h3>{detailBook.title}</h3>
                  <p>{detailBook.author || "未填写作者"}</p>
                </div>
                <dl className="detail-grid">
                  <div>
                    <dt>ISBN</dt>
                    <dd>{detailBook.isbn || "—"}</dd>
                  </div>
                  <div>
                    <dt>出版社</dt>
                    <dd>{detailBook.publisher || "—"}</dd>
                  </div>
                  <div>
                    <dt>分类</dt>
                    <dd>{detailBook.category || "—"}</dd>
                  </div>
                  <div>
                    <dt>馆藏位置</dt>
                    <dd>{detailBook.location || "—"}</dd>
                  </div>
                </dl>
                {detailBook.activeLoan && (
                  <div className="summary">
                    <strong>当前借阅</strong>
                    <div>借阅人：{detailBook.activeLoan.readerName}</div>
                    <div>应还日期：{detailBook.activeLoan.dueDate}</div>
                    <button
                      className="text-button"
                      onClick={() =>
                        jump(detailBook, "circulation", {
                          tab: "return",
                          loanId: detailBook.activeLoan!.id,
                        })
                      }
                    >
                      办理归还 <ArrowUpRight size={13} />
                    </button>
                  </div>
                )}
                <div className="catalog-detail-links">
                  <button
                    className="text-button"
                    onClick={() => jump(detailBook, "loans")}
                  >
                    查看借阅记录 <ArrowUpRight size={14} />
                  </button>
                  {detailBook.status === "available" && (
                    <button
                      className="primary"
                      onClick={() =>
                        jump(detailBook, "circulation", { tab: "checkout" })
                      }
                    >
                      办理借出
                    </button>
                  )}
                </div>
                <div className="form-actions">
                  <button
                    onClick={() => startEditor(detailBook)}
                    disabled={busy}
                  >
                    <Pencil size={14} />
                    编辑资料
                  </button>
                  {detailBook.enabled ? (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => setConfirmDisable(detailBook)}
                    >
                      <Power size={14} />
                      停用图书
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => void setEnabled(detailBook, true)}
                    >
                      <Power size={14} />
                      重新启用
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      {confirmDisable && (
        <Modal
          title="停用这本图书？"
          onClose={() => {
            if (!busy) setConfirmDisable(null);
          }}
        >
          <div className="modal-body">
            <p>
              《{confirmDisable.title}》（{confirmDisable.code}
              ）停用后将无法借出，资料及历史记录会继续保留。
            </p>
            {confirmDisable.status === "borrowed" && (
              <Notice>图书当前已借出，需要先办理归还。</Notice>
            )}
            <div className="form-actions">
              <button disabled={busy} onClick={() => setConfirmDisable(null)}>
                取消
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void setEnabled(confirmDisable, false)}
              >
                {busy ? "正在处理…" : "确认停用"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
