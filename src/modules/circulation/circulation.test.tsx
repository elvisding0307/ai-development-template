import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CirculationPage from "./index";
import LoansPage from "./LoansPage";
import { call } from "../../shared/api";
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
});
