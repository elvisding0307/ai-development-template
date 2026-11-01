import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./shared/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./shared/api')>()), call: vi.fn() }));
import { call } from './shared/api';
import App from './App';
const summary = { books: 0, readers: 0, loans: 0, activeLoans: 0, schemaVersion: 1 };
beforeEach(() => {
 vi.clearAllMocks(); window.scrollTo = vi.fn();
 HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); };
 HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
 vi.mocked(call).mockImplementation(async (module, action) => {
  if (module === 'data') {
   if (action === 'info') return { path: '/test/library.sqlite', summary };
   if (action === 'inspect') return { token: 'chosen', path: '/test/backup.sqlite', summary };
   if (action === 'restore') return { summary, safetyPath: '/test/before-restore.sqlite' };
  }
  return { items: [], total: 0 };
 });
});
afterEach(cleanup);
it('keeps catalogue filters on navigation and clears stale page state after full recovery', async () => {
 render(<App/>);
 fireEvent.change(screen.getByRole('textbox', { name: '搜索图书' }), { target: { value: '旧数据库中的书' } });
 fireEvent.click(screen.getByRole('button', { name: '数据管理' }));
 fireEvent.click(screen.getByRole('button', { name: '图书管理' }));
 expect((screen.getByRole('textbox', { name: '搜索图书' }) as HTMLInputElement).value).toBe('旧数据库中的书');
 fireEvent.click(screen.getByRole('button', { name: '数据管理' }));
 fireEvent.click(screen.getByRole('button', { name: '选择备份文件' }));
 await screen.findByRole('checkbox');
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
 await waitFor(() => expect(call).toHaveBeenCalledWith('data', 'restore', { token: 'chosen' }));
 await screen.findByText('/test/before-restore.sqlite');
 fireEvent.click(screen.getByRole('button', { name: '图书管理' }));
 expect((screen.getByRole('textbox', { name: '搜索图书' }) as HTMLInputElement).value).toBe('');
});
