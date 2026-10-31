import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Check, Search, UserRound } from "lucide-react";
import { call, changed, errorMessage } from "../../shared/api";
import { useQuery } from "../../shared/hooks";
import type { Book, ListResult, Loan, Reader } from "../../shared/models";
import type { PageProps, Route } from "../../shared/navigation";
import {
  Badge,
  Empty,
  Field,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  formatTime,
} from "../../shared/ui";
import { LoanDetails, LoanTable, QueryState, localDate } from "./components";

export default function CirculationPage({ route, navigate }: PageProps) {
  const [tab, setTab] = useState<"checkout" | "return">(
    route.tab ?? "checkout",
  );
  useEffect(() => {
    setTab(route.tab ?? "checkout");
  }, [route]);
  return (
    <>
      <PageHeader
        eyebrow="CIRCULATION DESK"
        title="借还工作台"
        description="每次借出与归还，都让书的去向更清楚。"
        action={
          <button onClick={() => navigate({ page: "loans" })}>
            查看借阅记录 <ArrowRight size={15} />
          </button>
        }
      />
      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="tabs" role="tablist" aria-label="借还操作">
          <button
            role="tab"
            aria-selected={tab === "checkout"}
            className={tab === "checkout" ? "active" : ""}
            onClick={() => setTab("checkout")}
          >
            借书登记
          </button>
          <button
            role="tab"
            aria-selected={tab === "return"}
            className={tab === "return" ? "active" : ""}
            onClick={() => setTab("return")}
          >
            还书登记
          </button>
        </div>
      </div>
      {tab === "checkout" ? (
        <Checkout request={route} />
      ) : (
        <ReturnDesk request={route} />
      )}
    </>
  );
}
function Checkout({ request }: { request: Route }) {
  const [readerId, setReaderId] = useState<number | undefined>(
    request.readerId,
  );
  const [bookId, setBookId] = useState<number | undefined>(request.bookId);
  const [readerSearch, setReaderSearch] = useState("");
  const [bookSearch, setBookSearch] = useState("");
  const [readerPage, setReaderPage] = useState(1);
  const [bookPage, setBookPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<Loan>();
  const [day, setDay] = useState(localDate());
  // A new navigation request may target the same IDs after the user changed
  // local selection or completed a checkout. Preserve search filters, but apply
  // that request again rather than treating equal IDs as an already handled link.
  useEffect(() => {
    setReaderId(request.readerId);
    setBookId(request.bookId);
    setSuccess(undefined);
    setError("");
  }, [request]);
  useEffect(() => {
    const timer = window.setInterval(() => setDay(localDate()), 1000);
    return () => clearInterval(timer);
  }, []);
  const readers = useQuery(
    () =>
      call<ListResult<Reader>>("readers", "list", {
        search: readerSearch,
        status: "enabled",
        page: readerPage,
      }),
    [readerSearch, readerPage],
  );
  const books = useQuery(
    () =>
      call<ListResult<Book>>("catalog", "list", {
        search: bookSearch,
        status: "available",
        page: bookPage,
      }),
    [bookSearch, bookPage],
  );
  const reader = useQuery(
    () =>
      readerId
        ? call<Reader>("readers", "get", { id: readerId })
        : Promise.resolve(null),
    [readerId],
  );
  const book = useQuery(
    () =>
      bookId
        ? call<Book>("catalog", "get", { id: bookId })
        : Promise.resolve(null),
    [bookId],
  );
  const overdue = useQuery(
    () =>
      readerId
        ? call<ListResult<Loan>>("circulation", "list", {
            readerId,
            status: "overdue",
          })
        : Promise.resolve({ items: [], total: 0 }),
    [readerId, day],
  );
  async function submit() {
    if (!readerId || !bookId) return;
    setBusy(true);
    setError("");
    setSuccess(undefined);
    try {
      const loan = await call<Loan>("circulation", "checkout", {
        readerId,
        bookId,
      });
      setSuccess(loan);
      setBookId(undefined);
      changed();
    } catch (e) {
      setError(errorMessage(e));
      void reader.reload();
      void book.reload();
      void readers.reload();
      void books.reload();
    } finally {
      setBusy(false);
    }
  }
  const selectedReader = reader.data;
  const selectedBook = book.data;
  const canSubmit =
    !!selectedReader?.enabled &&
    selectedReader.activeLoans < 5 &&
    selectedBook?.status === "available" &&
    !reader.loading &&
    !book.loading &&
    !reader.error &&
    !book.error;
  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      {success && (
        <Notice kind="success">
          <Check size={14} /> 借出成功：《{success.bookTitle}》已借给{" "}
          {success.readerName}，应还日期 {success.dueDate}。借出时间{" "}
          {formatTime(success.borrowedAt)}。
        </Notice>
      )}
      <div className="workspace-grid">
        <section className="card">
          <h2>
            <UserRound size={20} /> 选择读者
          </h2>
          <p>按编号或姓名查找，编号用于区分同名读者。</p>
          <Field label="查找读者">
            <input
              value={readerSearch}
              maxLength={100}
              placeholder="读者编号 / 姓名"
              onChange={(e) => {
                setReaderSearch(e.target.value);
                setReaderPage(1);
              }}
            />
          </Field>
          <QueryState
            loading={readers.loading}
            error={readers.error}
            retry={readers.reload}
            hasData={!!readers.data}
          />
          <div className="selection-list">
            {readers.data?.items.map((r) => (
              <button
                key={r.id}
                className={readerId === r.id ? "selected" : ""}
                onClick={() => {
                  setReaderId(r.id);
                  setSuccess(undefined);
                }}
              >
                <strong>
                  {r.name} <span className="code">{r.code}</span>
                </strong>
                <span className="subtext">当前在借 {r.activeLoans} / 5 本</span>
              </button>
            ))}
          </div>
          {readers.data?.items.length === 0 && (
            <Empty
              title="没有可选择的读者"
              description="请调整搜索，或在读者管理中新建并启用读者。"
            />
          )}
          {readers.data && (
            <Pagination
              page={readerPage}
              total={readers.data.total}
              onChange={setReaderPage}
            />
          )}
        </section>
        <section className="card">
          <h2>
            <BookOpen size={20} /> 选择图书
          </h2>
          <p>每个馆藏编号代表一本可独立借还的实体书。</p>
          <Field label="查找图书">
            <input
              value={bookSearch}
              maxLength={200}
              placeholder="馆藏编号 / 书名"
              onChange={(e) => {
                setBookSearch(e.target.value);
                setBookPage(1);
              }}
            />
          </Field>
          <QueryState
            loading={books.loading}
            error={books.error}
            retry={books.reload}
            hasData={!!books.data}
          />
          <div className="selection-list">
            {books.data?.items.map((b) => (
              <button
                key={b.id}
                className={bookId === b.id ? "selected" : ""}
                onClick={() => {
                  setBookId(b.id);
                  setSuccess(undefined);
                }}
              >
                <strong>{b.title}</strong>
                <span className="subtext">
                  <span className="code">{b.code}</span> ·{" "}
                  {b.author || "作者未填写"}
                </span>
              </button>
            ))}
          </div>
          {books.data?.items.length === 0 && (
            <Empty
              title="没有可借图书"
              description="请调整搜索，或在图书管理中录入可借图书。"
            />
          )}
          {books.data && (
            <Pagination
              page={bookPage}
              total={books.data.total}
              onChange={setBookPage}
            />
          )}
        </section>
      </div>
      <section className="card" style={{ marginTop: 24 }}>
        <h2>确认借出</h2>
        {reader.error && (
          <Notice kind="error">
            所选读者：{reader.error}{" "}
            <button
              className="text-button"
              onClick={() => void reader.reload()}
            >
              重试
            </button>
          </Notice>
        )}
        {book.error && (
          <Notice kind="error">
            所选图书：{book.error}{" "}
            <button className="text-button" onClick={() => void book.reload()}>
              重试
            </button>
          </Notice>
        )}
        {overdue.error && readerId && (
          <Notice kind="error">
            逾期提示读取失败：{overdue.error}{" "}
            <button
              className="text-button"
              onClick={() => void overdue.reload()}
            >
              重试
            </button>
          </Notice>
        )}
        {!!overdue.data?.total && (
          <Notice>
            该读者有 {overdue.data.total} 本逾期未还；未达到 5
            本上限时仍可借书。
          </Notice>
        )}
        {selectedReader && !selectedReader.enabled && (
          <Notice kind="error">所选读者已停用，请选择其他读者。</Notice>
        )}
        {selectedReader && selectedReader.activeLoans >= 5 && (
          <Notice kind="error">
            该读者已达到同时借阅 5 本的上限，请先归还。
          </Notice>
        )}
        {selectedBook && selectedBook.status !== "available" && (
          <Notice kind="error">所选图书当前不可借，请重新选择。</Notice>
        )}
        <div className="summary">
          <div className="split">
            <span>借阅人</span>
            <strong>
              {selectedReader
                ? `${selectedReader.name} · ${selectedReader.code}`
                : "尚未选择"}
            </strong>
          </div>
          <div className="split">
            <span>借阅图书</span>
            <strong>
              {selectedBook
                ? `${selectedBook.title} · ${selectedBook.code}`
                : "尚未选择"}
            </strong>
          </div>
          <div className="split">
            <span>预计应还日期</span>
            <strong>{localDate(30)}</strong>
          </div>
          <span className="muted">
            借期 30 个自然日 · 每人最多同时借 5 本 · 实际日期以提交结果为准
          </span>
        </div>
        <div className="form-actions">
          <button
            className="primary"
            disabled={!canSubmit || busy}
            onClick={() => void submit()}
          >
            {busy ? "正在登记…" : "确认借出"} <ArrowRight size={15} />
          </button>
        </div>
      </section>
    </>
  );
}
function ReturnDesk({ request }: { request: Route }) {
  const { readerId, bookId } = request;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [day, setDay] = useState(localDate());
  const [selected, setSelected] = useState<Loan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const records = useQuery(
    () =>
      call<ListResult<Loan>>("circulation", "list", {
        search,
        status: "active",
        readerId,
        bookId,
        page,
      }),
    [search, page, readerId, bookId, day],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setDay(localDate()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setPage(1);
  }, [readerId, bookId]);
  useEffect(() => {
    setSelected(undefined);
    setError("");
    if (!request.loanId) return;
    let cancelled = false;
    call<Loan>("circulation", "get", { id: request.loanId })
      .then((l) => {
        if (!cancelled) setSelected(l);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [request]);
  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<Loan>("circulation", "return", {
        loanId: selected.id,
      });
      setMessage(
        `《${result.bookTitle}》已归还，归还时间 ${formatTime(result.returnedAt)}。`,
      );
      setSelected(undefined);
      changed();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <section className="panel">
        <div className="toolbar">
          <Search size={17} />
          <input
            aria-label="搜索待还记录"
            placeholder="馆藏编号 / 读者编号 / 借出时姓名"
            maxLength={200}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Badge tone="amber">仅显示未归还记录</Badge>
          <button onClick={() => void records.reload()}>刷新</button>
        </div>
        <LoanTable
          result={records.data}
          loading={records.loading}
          error={records.error}
          retry={records.reload}
          page={page}
          setPage={setPage}
          select={setSelected}
          returnLoan={setSelected}
        />
      </section>
      {selected && (
        <Modal
          title={selected.returnedAt ? "该记录已经归还" : "确认归还图书"}
          onClose={() => {
            if (!busy) setSelected(undefined);
          }}
        >
          <div className="modal-body">
            {error && <Notice kind="error">{error}</Notice>}
            <LoanDetails loan={selected} />
            {selected.returnedAt && (
              <Notice>
                此记录已归还，归还时间保持不变，不影响该图书后续的新借阅。
              </Notice>
            )}
            <div className="form-actions">
              <button disabled={busy} onClick={() => setSelected(undefined)}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy
                  ? "正在办理…"
                  : selected.returnedAt
                    ? "确认已归还"
                    : "确认归还"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
