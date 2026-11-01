import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call } from '../../shared/api';
import type { BorrowingStatistics } from '../../shared/models';
import StatisticsPage from './StatisticsPage';
vi.mock('../../shared/api', () => ({ call: vi.fn(), errorMessage: (e: { message: string }) => e.message }));
const fixture: BorrowingStatistics = {
 asOf: '2026-11-01', generatedAt: '2026-11-01T04:00:00Z',
 totals: { books: 25, readers: 11, activeLoans: 9, overdueLoans: 3 },
 trend: Array.from({ length: 7 }, (_, i) => ({ date: i===6 ? '2026-11-01' : `2026-10-${26+i}`, borrowed: i===6 ? 2 : 0, returned: i===5 ? 1 : 0 })),
 popularBooks: [ { bookId: 7, code: 'B007', title: '同名馆藏', borrowCount: 3 }, { bookId: 9, code: 'B009', title: '同名馆藏', borrowCount: 1 } ],
 categories: [ { name: '文学', count: 20 }, { name: '未分类', count: 5 } ],
};
beforeEach(() => { vi.clearAllMocks(); vi.mocked(call).mockResolvedValue(fixture); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function mount() { const navigate=vi.fn(); render(<StatisticsPage route={{ page: 'statistics' }} navigate={navigate}/>); return navigate; }
describe('borrowing statistics', () => {
 it('shows backend numbers and accessible seven-day detail, and navigates by copy ID', async () => {
  const navigate=mount(); await screen.findByText('截至 2026-11-01', { exact: false });
  expect(within(screen.getByRole('region', { name: '本馆图书' })).getByText('25')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '逾期未还' })).getByText('3')).toBeTruthy();
  expect(screen.getByRole('img', { name: /最近 7 天借还次数/ })).toBeTruthy();
  fireEvent.click(screen.getByText('查看逐日数据'));
  expect(within(screen.getByRole('table', { name: '最近7天借还明细' })).getAllByRole('row')).toHaveLength(8);
  fireEvent.click(screen.getAllByRole('button', { name: '同名馆藏' })[1]);
  expect(navigate).toHaveBeenCalledWith({ page: 'loans', bookId: 9 });
  expect(screen.getByText('未分类')).toBeTruthy();
 });
 it('shows empty states without inventing popular books', async () => {
  vi.mocked(call).mockResolvedValue({ ...fixture, totals: { books:0, readers:0, activeLoans:0, overdueLoans:0 }, trend:fixture.trend.map(d=>({...d,borrowed:0,returned:0})), popularBooks:[], categories:[] });
  mount(); expect(await screen.findByText('还没有借阅记录')).toBeTruthy();
  expect(screen.getByText('书架正在等待第一本书')).toBeTruthy();
  expect(screen.queryByText('同名馆藏')).toBeNull();
 });
 it('retries a failed request and labels preserved values after refresh fails', async () => {
  vi.mocked(call).mockRejectedValueOnce({ message: '正在恢复，请稍后重试' });
  mount(); expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '本馆图书' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  await screen.findByRole('region', { name: '本馆图书' });
  vi.mocked(call).mockRejectedValueOnce({ message: '存储读取失败' });
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  expect((await screen.findByRole('alert')).textContent).toContain('上次成功读取的旧数据');
  expect(within(screen.getByRole('region', { name: '本馆图书' })).getByText('25')).toBeTruthy();
  expect(screen.getByText(/旧数据，更新失败/)).toBeTruthy();
 });
 it('refreshes real query results after a business mutation and window focus', async () => {
  mount(); await screen.findByRole('region', { name: '当前在借' });
  vi.mocked(call).mockResolvedValue({ ...fixture, totals: { ...fixture.totals, activeLoans: 10 } });
  fireEvent(window,new Event('library:changed'));
  await waitFor(()=>expect(within(screen.getByRole('region', { name: '当前在借' })).getByText('10')).toBeTruthy());
  vi.mocked(call).mockResolvedValue({ ...fixture, totals: { ...fixture.totals, activeLoans: 8 } });
  fireEvent(window,new Event('focus'));
  await waitFor(()=>expect(within(screen.getByRole('region', { name: '当前在借' })).getByText('8')).toBeTruthy());
  expect(call).toHaveBeenLastCalledWith('circulation','statistics');
 });
 it('rereads backend statistics when the device crosses midnight', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026,10,1,23,59,59));
  mount(); await act(async()=>{ await Promise.resolve(); });
  expect(call).toHaveBeenCalledTimes(1);
  await act(async()=>{ await vi.advanceTimersByTimeAsync(1500); });
  expect(call).toHaveBeenCalledTimes(2);
 });
});
