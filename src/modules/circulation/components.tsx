import { useEffect, useState } from "react";
import { call } from "../../shared/api";
import { useQuery } from "../../shared/hooks";
import {
  Badge,
  Notice,
  Loading,
  Empty,
  formatTime,
  Pagination,
} from "../../shared/ui";
import type { ListResult, Loan } from "../../shared/models";
export function LoanStatus({ loan }: { loan: Loan }) {
  if (loan.status === "returned")
    return (
      <Badge tone={loan.returnedLate ? "amber" : "neutral"}>
        {loan.returnedLate ? `逾期归还 ${loan.overdueDays} 天` : "已归还"}
      </Badge>
    );
  return (
    <Badge tone={loan.status === "overdue" ? "red" : "green"}>
      {loan.status === "overdue" ? `逾期 ${loan.overdueDays} 天` : "在借"}
    </Badge>
  );
}
export function LoanDetails({ loan: snapshot }: { loan: Loan }) {
  const [day, setDay] = useState(localDate());
  useEffect(() => {
    const timer = window.setInterval(() => setDay(localDate()), 1000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery(
    () => call<Loan>("circulation", "get", { id: snapshot.id }),
    [snapshot.id, day],
  );
  const loan = query.data ?? snapshot;
  return (
    <>
      {query.error && (
        <Notice kind="error">
          详情更新失败，以下为上次结果：{query.error}{" "}
          <button className="text-button" onClick={() => void query.reload()}>
            重试
          </button>
        </Notice>
      )}
      <Notice>
        以下姓名、书名及编号为借出时信息，档案修改不会改写历史记录。
      </Notice>
      <dl className="detail-grid">
        <div>
          <dt>读者</dt>
          <dd>
            {loan.readerName}
            <div className="code">{loan.readerCode}</div>
          </dd>
        </div>
        <div>
          <dt>图书</dt>
          <dd>
            {loan.bookTitle}
            <div className="code">{loan.bookCode}</div>
          </dd>
        </div>
        <div>
          <dt>借出时间</dt>
          <dd>{formatTime(loan.borrowedAt)}</dd>
        </div>
        <div>
          <dt>应还日期</dt>
          <dd>{loan.dueDate}</dd>
        </div>
        <div>
          <dt>归还时间</dt>
          <dd>{formatTime(loan.returnedAt)}</dd>
        </div>
        <div>
          <dt>借阅状态</dt>
          <dd>
            <LoanStatus loan={loan} />
          </dd>
        </div>
      </dl>
    </>
  );
}
export function QueryState({
  loading,
  error,
  retry,
  hasData,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  hasData: boolean;
}) {
  return (
    <>
      {error && (
        <Notice kind="error">
          {error}
          {hasData && " 当前显示的是上次查询结果，请重试获取最新数据。"}{" "}
          <button className="text-button" onClick={retry}>
            重试
          </button>
        </Notice>
      )}
      {loading && !hasData && <Loading />}
    </>
  );
}
export function LoanTable({
  result,
  loading,
  error,
  page,
  setPage,
  retry,
  select,
  returnLoan,
}: {
  result?: ListResult<Loan>;
  loading: boolean;
  error: string;
  page: number;
  setPage: (p: number) => void;
  retry: () => void;
  select: (l: Loan) => void;
  returnLoan?: (l: Loan) => void;
}) {
  return (
    <>
      <QueryState
        loading={loading}
        error={error}
        retry={retry}
        hasData={!!result}
      />
      {result && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>图书 · 借出时信息</th>
                  <th>读者 · 借出时信息</th>
                  <th>借出时间</th>
                  <th>应还日期</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="table-title">{l.bookTitle}</div>
                      <div className="code subtext">{l.bookCode}</div>
                    </td>
                    <td>
                      {l.readerName}
                      <div className="code subtext">{l.readerCode}</div>
                    </td>
                    <td>{formatTime(l.borrowedAt)}</td>
                    <td>{l.dueDate}</td>
                    <td>
                      <LoanStatus loan={l} />
                    </td>
                    <td>
                      <div className="actions">
                        <button
                          className="text-button"
                          onClick={() => select(l)}
                        >
                          详情
                        </button>
                        {l.status !== "returned" && returnLoan && (
                          <button
                            className="text-button"
                            onClick={() => returnLoan(l)}
                          >
                            归还
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.items.length === 0 && (
            <Empty
              title="没有匹配的借阅记录"
              description="调整搜索或筛选条件，或先在借书工作台登记借阅。"
            />
          )}
          <Pagination page={page} total={result.total} onChange={setPage} />
        </>
      )}
    </>
  );
}
export function localDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
