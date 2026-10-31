import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReadersPage from './index';
import type { Reader } from '../../shared/models';

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }));
vi.mock('../../shared/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../shared/api')>();
  return { ...actual, call: mockCall, changed: vi.fn() };
});
const reader: Reader = { id: 7, code: 'R007', name: '林小满', phone: '', notes: '', enabled: true, activeLoans: 2, createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z' };
const navigate = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  mockCall.mockImplementation(async (_module: string, action: string) => {
    if (action === 'list') return { items: [reader], total: 1 };
    if (action === 'get') return reader;
    return reader;
  });
});
afterEach(cleanup);

function renderPage() { return render(<ReadersPage route={{ page: 'readers' }} navigate={navigate}/>); }

describe('reader workflows', () => {
  it('retains input on duplicate code and lets the user correct it', async () => {
    const user = userEvent.setup(); renderPage();
    await screen.findByRole('button', { name: '林小满' });
    await user.click(screen.getByRole('button', { name: '新增读者' }));
    const dialog = screen.getByRole('dialog', { name: '新增读者' });
    const code = within(dialog).getByRole('textbox', { name: /^读者编号/ });
    const name = within(dialog).getByRole('textbox', { name: /^姓名/ });
    await user.type(code, 'R007'); await user.type(name, '另一位读者');
    mockCall.mockImplementation(async (_module: string, action: string) => {
      if (action === 'save') throw { code: 'validation', field: 'code', message: '读者编号已存在，请使用其他编号' };
      return { items: [reader], total: 1 };
    });
    await user.click(within(dialog).getByRole('button', { name: '保存档案' }));
    await screen.findByText('读者编号已存在，请使用其他编号');
    expect((code as HTMLInputElement).value).toBe('R007');
    expect((name as HTMLInputElement).value).toBe('另一位读者');
    await user.clear(code); await user.type(code, 'R008');
    expect(screen.queryByText('读者编号已存在，请使用其他编号')).toBeNull();
  });

  it('asks before discarding edits and can return to the same draft', async () => {
    const user = userEvent.setup(); renderPage();
    await screen.findByRole('button', { name: '林小满' });
    await user.click(screen.getByRole('button', { name: '编辑' }));
    const dialog = screen.getByRole('dialog', { name: '编辑读者档案' });
    const code = within(dialog).getByRole('textbox', { name: /^读者编号/ }) as HTMLInputElement;
    expect(code.disabled).toBe(true);
    const name = within(dialog).getByRole('textbox', { name: /^姓名/ });
    await user.type(name, '同学');
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    const confirm = screen.getByRole('dialog', { name: '放弃未保存的修改？' });
    await user.click(within(confirm).getByRole('button', { name: '继续编辑' }));
    expect((name as HTMLInputElement).value).toBe('林小满同学');
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows outstanding loans before disabling and preserves the reader identity', async () => {
    const user = userEvent.setup(); renderPage();
    await screen.findByRole('button', { name: '林小满' });
    await user.click(screen.getByRole('button', { name: '停用' }));
    const dialog = await screen.findByRole('dialog', { name: '确认停用读者' });
    expect(dialog.textContent).toContain('林小满'); expect(dialog.textContent).toContain('R007'); expect(dialog.textContent).toContain('当前在借 2 本');
    expect(dialog.textContent).toContain('现有图书仍可归还');
    mockCall.mockImplementation(async (_module: string, action: string) => action === 'set_enabled' ? { ...reader, enabled: false } : { items: [reader], total: 1 });
    await user.click(within(dialog).getByRole('button', { name: '确认停用' }));
    await waitFor(() => expect(mockCall).toHaveBeenCalledWith('readers', 'set_enabled', { id: 7, enabled: false }));
    await screen.findByText('读者已停用，原有借阅仍可归还。');
  });

  it('opens history by stable id and does not offer checkout to disabled readers', async () => {
    const user = userEvent.setup();
    mockCall.mockImplementation(async (_module: string, action: string) => action === 'list' ? { items: [{ ...reader, enabled: false }], total: 1 } : { ...reader, enabled: false });
    renderPage(); await user.click(await screen.findByRole('button', { name: '林小满' }));
    const dialog = await screen.findByRole('dialog', { name: '读者档案' });
    await within(dialog).findByText('当前在借');
    expect(within(dialog).queryByRole('button', { name: /办理借书/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: /查看借阅记录/ }));
    expect(navigate).toHaveBeenCalledWith({ page: 'loans', readerId: 7 });
  });
});
