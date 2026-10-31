import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CatalogPage from "./index";
import { call } from "../../shared/api";
import type { Book } from "../../shared/models";
vi.mock("../../shared/api", () => ({
  call: vi.fn(),
  changed: () => window.dispatchEvent(new Event("library:changed")),
  errorMessage: (error: { message?: string }) => error.message ?? "操作失败",
}));
const book: Book = {
  id: 1,
  code: "B001",
  title: "山间读书",
  author: "林秋",
  isbn: "",
  publisher: "",
  category: "文学",
  location: "A-01",
  enabled: true,
  createdAt: "2026-10-31T00:00:00Z",
  updatedAt: "2026-10-31T00:00:00Z",
  status: "available",
  activeLoan: null,
};
const api = vi.mocked(call);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  api.mockImplementation(async (_module, action) =>
    action === "list" ? { items: [book], total: 1 } : book,
  );
});
function mount() {
  const navigate = vi.fn();
  render(<CatalogPage route={{ page: "catalog" }} navigate={navigate} />);
  return navigate;
}
describe("catalog interactions", () => {
  it("shows library rows, filters literal search and resets page", async () => {
    mount();
    await screen.findByRole("button", { name: book.title });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索图书" }), {
      target: { value: "%" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "图书状态" }), {
      target: { value: "available" },
    });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("catalog", "list", {
        search: "%",
        status: "available",
        page: 1,
      }),
    );
  });
  it("keeps entered data and identifies server validation errors", async () => {
    api.mockImplementation(async (_module, action) => {
      if (action === "save")
        throw {
          code: "conflict",
          message: "馆藏编号已存在，请使用其他编号",
          field: "code",
        };
      return action === "list" ? { items: [], total: 0 } : book;
    });
    mount();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "新增图书" })[0]);
    const dialog = screen.getByRole("dialog", { name: "新增图书" });
    await user.type(
      within(dialog).getByRole("textbox", { name: /馆藏编号/ }),
      "B001",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "书名 *" }),
      "重复编号",
    );
    await user.click(within(dialog).getByRole("button", { name: "保存图书" }));
    await screen.findByRole("alert");
    expect(
      (
        within(dialog).getByRole("textbox", {
          name: "书名 *",
        }) as HTMLInputElement
      ).value,
    ).toBe("重复编号");
    expect(
      within(dialog)
        .getByRole("textbox", { name: /馆藏编号/ })
        .getAttribute("aria-invalid"),
    ).toBe("true");
  });
  it("asks before discarding unsaved changes", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "新增图书" })[0]);
    await user.type(screen.getByRole("textbox", { name: "书名 *" }), "未保存");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await screen.findByRole("dialog", { name: "放弃未保存的修改？" });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(
      (screen.getByRole("textbox", { name: "书名 *" }) as HTMLInputElement)
        .value,
    ).toBe("未保存");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("opens details and passes the exact book identity to checkout", async () => {
    const navigate = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: book.title }));
    const dialog = await screen.findByRole("dialog", { name: "图书详情" });
    await user.click(
      await within(dialog).findByRole("button", { name: "办理借出" }),
    );
    expect(navigate).toHaveBeenCalledWith({
      page: "circulation",
      bookId: 1,
      tab: "checkout",
    });
  });
  it("confirms a save even when the current search hides the new book", async () => {
    api.mockImplementation(async (_module, action) =>
      action === "list" ? { items: [], total: 0 } : book,
    );
    mount();
    const user = userEvent.setup();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索图书" }), {
      target: { value: "其他书" },
    });
    await user.click(screen.getAllByRole("button", { name: "新增图书" })[0]);
    await user.type(screen.getByRole("textbox", { name: /馆藏编号/ }), "B001");
    await user.type(
      screen.getByRole("textbox", { name: "书名 *" }),
      "山间读书",
    );
    await user.click(screen.getByRole("button", { name: "保存图书" }));
    await screen.findByText("图书已加入馆藏。");
    expect(screen.getByRole("button", { name: "查看详情" })).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "搜索图书" }) as HTMLInputElement)
        .value,
    ).toBe("其他书");
  });
  it("requires explicit confirmation before disabling a book", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: book.title }));
    await user.click(await screen.findByRole("button", { name: "停用图书" }));
    expect(
      api.mock.calls.filter((args) => args[1] === "set_enabled"),
    ).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("catalog", "set_enabled", {
        id: 1,
        enabled: false,
      }),
    );
  });
});
