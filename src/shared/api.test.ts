import { describe, it, expect, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
import { call, errorMessage } from './api';
describe('desktop boundary', () => {
 it('does not pretend browser preview saved data', async () => { await expect(call('catalog', 'list')).rejects.toMatchObject({ code: 'desktop_required' }); });
 it('renders structured backend errors', () => { expect(errorMessage({ code: 'conflict', message: '图书已经借出' })).toBe('图书已经借出'); });
});
