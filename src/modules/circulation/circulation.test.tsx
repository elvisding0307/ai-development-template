import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CirculationPage from "./index";
import LoansPage from "./LoansPage";
import { call, changed } from "../../shared/api";
import type { Book, Loan, Reader } from "../../shared/models";
vi.mock("../../shared/api", () => ({
  call: vi.fn(),
  changed: vi.fn(),
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
const reader: Reader = {
  id: 1,
  code: "R1",
  name: "张读者",
  phone: "",
  notes: "",
  enabled: true,
  createdAt: "2026-10-31T00:00:00Z",
  updatedAt: "2026-10-31T00:00:00Z",
  activeLoans: 1,
};
const book: Book = {
  id: 1,
  code: "B1",
  title: "山中来信",
  author: "林先生",
  isbn: "",
  publisher: "",
  category: "",
  location: "",
  enabled: true,
  createdAt: "2026-10-31T00:00:00Z",
  updatedAt: "2026-10-31T00:00:00Z",
  status: "available",
};
const loan: Loan = {
  id: 1,
  readerId: 1,
  bookId: 1,
  borrowedAt: "2026-10-31T04:00:00Z",
  dueDate: "2026-11-30",
  returnedAt: null,
  returnedLocalDate: null,
  readerCode: "R1",
  readerName: "张读者",
  bookCode: "B1",
  bookTitle: "山中来信",
  status: "overdue",
  overdueDays: 1,
  returnedLate: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(changed).mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(call).mockImplementation(async (module, action, payload) => {
    const p = payload as Record<string, unknown>;
    if (module === "readers")
      return (
        action === "get" ? reader : { items: [reader], total: 1 }
      ) as never;
    if (module === "catalog")
      return (action === "get" ? book : { items: [book], total: 1 }) as never;
    if (action === "get") return loan as never;
    if (action === "list")
      return {
        items: p?.status === "overdue" ? [] : [loan],
        total: p?.status === "overdue" ? 0 : 1,
      } as never;
    return loan as never;
  });
});
describe("circulation desktop UI", () => {
  it("rechecks checkout on the backend and preserves selection on conflict", async () => {
    const defaultImpl = vi.mocked(call).getMockImplementation()!;
    vi.mocked(call).mockImplementation((module, action, payload) =>
      action === "checkout"
        ? Promise.reject(new Error("图书已被借出"))
        : defaultImpl(module, action, payload),
    );
    render(
      <CirculationPage
        route={{ page: "circulation", readerId: 1, bookId: 1 }}
        navigate={vi.fn()}
      />,
    );
    const confirm = screen.getByRole("button", { name: "确认借出" });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    await userEvent.click(confirm);
    expect(await screen.findByText("图书已被借出")).toBeTruthy();
    expect(call).toHaveBeenCalledWith("circulation", "checkout", {
      readerId: 1,
      bookId: 1,
    });
    expect(screen.getByText("山中来信 · B1")).toBeTruthy();
  });
  it("does not offer checkout after the selected reader reaches the limit", async () => {
    const base = vi.mocked(call).getMockImplementation()!;
    vi.mocked(call).mockImplementation((m, a, p) =>
      m === "readers" && a === "get"
        ? (Promise.resolve({ ...reader, activeLoans: 5 }) as never)
        : base(m, a, p),
    );
    render(
      <CirculationPage
        route={{ page: "circulation", readerId: 1, bookId: 1 }}
        navigate={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("该读者已达到同时借阅 5 本的上限，请先归还。"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认借出" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("requires return confirmation and reports the actual backend return time", async () => {
    const base = vi.mocked(call).getMockImplementation()!;
    vi.mocked(call).mockImplementation((m, a, p) =>
      a === "return"
        ? (Promise.resolve({
            ...loan,
            status: "returned",
            returnedAt: "2026-12-01T04:00:00Z",
            returnedLocalDate: "2026-12-01",
            returnedLate: true,
          }) as never)
        : base(m, a, p),
    );
    render(
      <CirculationPage
        route={{ page: "circulation", tab: "return", loanId: 1 }}
        navigate={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(call).not.toHaveBeenCalledWith(
      "circulation",
      "return",
      expect.anything(),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认归还" }),
    );
    expect(
      await screen.findByText(/《山中来信》已归还，归还时间/),
    ).toBeTruthy();
    expect(call).toHaveBeenCalledWith("circulation", "return", { loanId: 1 });
  });
  it("combines linked identity and status filters, then navigates by exact loan ID", async () => {
    const navigate = vi.fn();
    render(
      <LoansPage route={{ page: "loans", readerId: 1 }} navigate={navigate} />,
    );
    await screen.findByText("山中来信");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "借阅状态" }),
      "overdue",
    );
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "circulation",
        "list",
        expect.objectContaining({ readerId: 1, status: "overdue", page: 1 }),
      ),
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "借阅状态" }),
      "all",
    );
    await userEvent.click(await screen.findByRole("button", { name: "归还" }));
    expect(navigate).toHaveBeenCalledWith({
      page: "circulation",
      tab: "return",
      loanId: 1,
    });
  });
  it("applies a repeated checkout link after success without discarding search filters", async () => {
    const navigate = vi.fn();
    const { rerender } = render(
      <CirculationPage
        route={{ page: "circulation", tab: "checkout", readerId: 1, bookId: 1 }}
        navigate={navigate}
      />,
    );
    const search = screen.getByRole("textbox", { name: "查找图书" });
    await userEvent.type(search, "山");
    const confirm = screen.getByRole("button", { name: "确认借出" });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    await userEvent.click(confirm);
    await screen.findByText(/借出成功/);
    await waitFor(() => expect(screen.queryByText("山中来信 · B1")).toBeNull());
    rerender(
      <CirculationPage
        route={{ page: "circulation", tab: "checkout", readerId: 1, bookId: 1 }}
        navigate={navigate}
      />,
    );
    expect(await screen.findByText("山中来信 · B1")).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "查找图书" }) as HTMLInputElement)
        .value,
    ).toBe("山");
    expect(screen.queryByText(/借出成功/)).toBeNull();
  });
  it("resets the active tab for a repeated navigation request with equal IDs", async () => {
    const navigate = vi.fn();
    const { rerender } = render(
      <CirculationPage
        route={{ page: "circulation", tab: "checkout", bookId: 1 }}
        navigate={navigate}
      />,
    );
    await screen.findByText("山中来信 · B1");
    await userEvent.click(screen.getByRole("tab", { name: "还书登记" }));
    expect(
      screen
        .getByRole("tab", { name: "还书登记" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    rerender(
      <CirculationPage
        route={{ page: "circulation", tab: "checkout", bookId: 1 }}
        navigate={navigate}
      />,
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "借书登记" })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(await screen.findByText("山中来信 · B1")).toBeTruthy();
  });
  it("reopens the same return link after cancellation without remounting the workbench", async () => {
    const navigate = vi.fn();
    const { rerender } = render(
      <CirculationPage
        route={{ page: "circulation", tab: "return", loanId: 1 }}
        navigate={navigate}
      />,
    );
    let dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索待还记录" }),
      "B1",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <CirculationPage
        route={{ page: "circulation", tab: "return", loanId: 1 }}
        navigate={navigate}
      />,
    );
    dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "确认归还" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("textbox", {
          name: "搜索待还记录",
        }) as HTMLInputElement
      ).value,
    ).toBe("B1");
  });
  it("returns the loan query to its valid last page after the result count decreases", async () => {
    const base = vi.mocked(call).getMockImplementation()!;
    let total = 21;
    vi.mocked(call).mockImplementation((m, a, p) => {
      if (m !== "circulation" || a !== "list") return base(m, a, p);
      const page = (p as { page: number }).page;
      return Promise.resolve({
        items:
          page === 2
            ? total === 21
              ? [{ ...loan, id: 21, bookTitle: "末页图书" }]
              : []
            : [{ ...loan, bookTitle: "首页图书" }],
        total,
      }) as never;
    });
    render(<LoansPage route={{ page: "loans" }} navigate={vi.fn()} />);
    await screen.findByText("首页图书");
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("末页图书");
    total = 20;
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("首页图书")).toBeTruthy();
    expect(screen.getByText("1 / 1")).toBeTruthy();
    expect(screen.queryByText("2 / 1")).toBeNull();
    expect(call).toHaveBeenLastCalledWith(
      "circulation",
      "list",
      expect.objectContaining({ page: 1 }),
    );
  });
  it("returns the return desk to page one after returning its last second-page record", async () => {
    const base = vi.mocked(call).getMockImplementation()!;
    let returned = false;
    const last = { ...loan, id: 21, bookTitle: "末页待还图书" };
    vi.mocked(changed).mockImplementation(() => {
      window.dispatchEvent(new Event("library:changed"));
    });
    vi.mocked(call).mockImplementation((m, a, p) => {
      if (m !== "circulation") return base(m, a, p);
      if (a === "get") return Promise.resolve(last) as never;
      if (a === "return") {
        returned = true;
        return Promise.resolve({
          ...last,
          status: "returned",
          returnedAt: "2026-12-01T04:00:00Z",
          returnedLocalDate: "2026-12-01",
        }) as never;
      }
      const page = (p as { page: number }).page;
      return Promise.resolve({
        items:
          page === 2
            ? returned
              ? []
              : [last]
            : [{ ...loan, bookTitle: "首页待还图书" }],
        total: returned ? 20 : 21,
      }) as never;
    });
    render(
      <CirculationPage
        route={{ page: "circulation", tab: "return" }}
        navigate={vi.fn()}
      />,
    );
    await screen.findByText("首页待还图书");
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("末页待还图书");
    await userEvent.click(screen.getByRole("button", { name: "归还" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认归还" }),
    );
    expect(await screen.findByText("首页待还图书")).toBeTruthy();
    expect(screen.getByText("1 / 1")).toBeTruthy();
    expect(screen.queryByText("2 / 1")).toBeNull();
    expect(call).toHaveBeenLastCalledWith(
      "circulation",
      "list",
      expect.objectContaining({ page: 1 }),
    );
  });
});
