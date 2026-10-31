import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataPage from './index';
vi.mock('../../shared/api', () => ({ call: vi.fn(), changed: vi.fn(), errorMessage: (e: unknown) => (e as Error).message }));
import { call, changed } from '../../shared/api';
const summary = { books: 2, readers: 1, loans: 3, activeLoans: 1, schemaVersion: 1 };
beforeEach(() => {
 vi.clearAllMocks();
 HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
 HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
 vi.mocked(call).mockImplementation(async (_module, action) => {
  if (action === 'info') return { path: '/local/library.sqlite', summary };
  if (action === 'inspect') return { token: 'selected-native-file', path: '/backup.sqlite', summary };
  if (action === 'restore') return { summary, safetyPath: '/before-restore.sqlite' };
  return { cancelled: true };
 });
});
afterEach(cleanup);
describe('data recovery consent', () => {
 it('requires explicit confirmation before sending restore token', async () => {
  render(<DataPage route={{ page: 'data' }} navigate={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: '选择备份文件' }));
  const restore = await screen.findByRole('button', { name: '确认恢复' });
  expect((restore as HTMLButtonElement).disabled).toBe(true);
  expect(vi.mocked(call).mock.calls.some(c => c[1] === 'restore')).toBe(false);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(restore);
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(call).toHaveBeenCalledWith('data', 'restore', { token: 'selected-native-file' });
  expect(await screen.findByText('/before-restore.sqlite')).toBeTruthy();
 });
 it('cancels inspection without writing data', async () => {
  render(<DataPage route={{ page: 'data' }} navigate={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: '选择备份文件' }));
  await screen.findByRole('button', { name: '确认恢复' });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(vi.mocked(call).mock.calls.some(c => c[1] === 'restore')).toBe(false);
  expect(changed).not.toHaveBeenCalled();
 });
 it('native backup cancellation is not success', async () => {
  render(<DataPage route={{ page: 'data' }} navigate={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: '创建备份' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('data', 'backup'));
  expect(screen.queryByText(/备份已保存/)).toBeNull();
 });
});
