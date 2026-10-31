import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { call } from "../../shared/api";
import { useQuery } from "../../shared/hooks";
import type { Book, ListResult, Loan, Reader } from "../../shared/models";
import type { PageProps } from "../../shared/navigation";
import { Modal, Notice, PageHeader } from "../../shared/ui";
import { LoanDetails, LoanTable, localDate } from "./components";
export default function LoansPage({ route, navigate }: PageProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [day, setDay] = useState(localDate());
  const [selected, setSelected] = useState<Loan>();
  useEffect(() => {
    setPage(1);
  }, [route.readerId, route.bookId]);
  useEffect(() => {
    const timer = window.setInterval(() => setDay(localDate()), 1000);
    return () => clearInterval(timer);
  }, []);
  const records = useQuery(
    () =>
      call<ListResult<Loan>>("circulation", "list", {
        search,
        status,
        page,
        from: from || undefined,
        to: to || undefined,
        readerId: route.readerId,
        bookId: route.bookId,
      }),
    [search, status, page, from, to, route.readerId, route.bookId, day],
  );
  const reader = useQuery(
    () =>
      route.readerId
        ? call<Reader>("readers", "get", { id: route.readerId })
        : Promise.resolve(null),
    [route.readerId],
  );
  const book = useQuery(
    () =>
      route.bookId
        ? call<Book>("catalog", "get", { id: route.bookId })
        : Promise.resolve(null),
    [route.bookId],
  );
  const filterChanged = (action: () => void) => {
    action();
    setPage(1);
  };
  const goReturn = (loan: Loan) => {
    setSelected(undefined);
    navigate({ page: "circulation", tab: "return", loanId: loan.id });
  };
  const clear = () => {
    setSearch("");
    setStatus("all");
    setFrom("");
    setTo("");
    setPage(1);
    navigate({ page: "loans" });
  };
  return (
    <>
      <PageHeader
        eyebrow="BORROWING RECORDS"
        title="借阅记录"
        description="查看每一次借还，及时发现逾期；姓名和书名保留借出时的信息。"
        action={
          <button
            onClick={() => navigate({ page: "circulation", tab: "checkout" })}
          >
            办理借阅
          </button>
        }
      />
      {(route.readerId || route.bookId) && (
        <div style={{ marginBottom: 18, display: "flex", gap: 8 }}>
          {route.readerId && (
            <span className="filter-chip">
              读者：
              {reader.data
                ? `${reader.data.name} · ${reader.data.code}`
                : reader.error
                  ? "档案读取失败"
                  : "正在读取…"}{" "}
              <button
                aria-label="清除读者筛选"
                className="text-button"
                onClick={() => navigate({ ...route, readerId: undefined })}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {route.bookId && (
            <span className="filter-chip">
              图书：
              {book.data
                ? `${book.data.title} · ${book.data.code}`
                : book.error
                  ? "档案读取失败"
                  : "正在读取…"}{" "}
              <button
                aria-label="清除图书筛选"
                className="text-button"
                onClick={() => navigate({ ...route, bookId: undefined })}
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}
      {(reader.error || book.error) && (
        <Notice kind="error">
          {reader.error || book.error}{" "}
          <button
            className="text-button"
            onClick={() => {
              void reader.reload();
              void book.reload();
            }}
          >
            重试读取档案
          </button>
          （借阅记录仍按原关联对象查询）
        </Notice>
      )}
      <section className="panel">
        <div className="toolbar">
          <Search size={17} />
          <input
            aria-label="搜索借阅记录"
            value={search}
            maxLength={200}
            placeholder="借出时的姓名、书名或编号"
            onChange={(e) => filterChanged(() => setSearch(e.target.value))}
          />
          <select
            aria-label="借阅状态"
            value={status}
            onChange={(e) => filterChanged(() => setStatus(e.target.value))}
          >
            <option value="all">全部状态</option>
            <option value="active">在借（含逾期）</option>
            <option value="overdue">逾期未还</option>
            <option value="returned">已归还</option>
          </select>
          <button onClick={() => void records.reload()}>刷新</button>
        </div>
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 12 }}>
            借出日期
          </span>
          <input
            aria-label="借出起始日期"
            type="date"
            value={from}
            onChange={(e) => filterChanged(() => setFrom(e.target.value))}
          />
          <span className="muted">至</span>
          <input
            aria-label="借出结束日期"
            type="date"
            value={to}
            onChange={(e) => filterChanged(() => setTo(e.target.value))}
          />
          <button className="text-button" onClick={clear}>
            清除筛选
          </button>
        </div>
        {from && to && from > to && (
          <Notice kind="error">
            起始日期不能晚于结束日期，请调整日期后重试。
          </Notice>
        )}
        <LoanTable
          result={records.data}
          loading={records.loading}
          error={records.error}
          retry={records.reload}
          page={page}
          setPage={setPage}
          select={setSelected}
          returnLoan={goReturn}
        />
      </section>
      {selected && (
        <Modal title="借阅详情" onClose={() => setSelected(undefined)}>
          <div className="modal-body">
            <LoanDetails loan={selected} />
            <div className="form-actions">
              <button onClick={() => setSelected(undefined)}>关闭</button>
              {!selected.returnedAt && (
                <button className="primary" onClick={() => goReturn(selected)}>
                  办理归还
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
