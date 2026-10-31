import { invoke, isTauri } from '@tauri-apps/api/core';
export type Module = 'catalog' | 'readers' | 'circulation' | 'data';
export interface AppError { code: string; message: string; field?: string }
export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) return String(error.message);
  return typeof error === 'string' ? error : '操作失败，请重试';
}
export async function call<T>(module: Module, action: string, payload: unknown = {}): Promise<T> {
  if (!isTauri()) throw { code: 'desktop_required', message: '请在桌面客户端中使用此功能。运行 npm run tauri dev 启动。' };
  return invoke<T>('library', { module, action, payload });
}
export function changed() { window.dispatchEvent(new Event('library:changed')); }
