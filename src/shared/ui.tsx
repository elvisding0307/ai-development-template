import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, BookOpen, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
export function Empty({ title = '这里还没有记录', description = '从新增第一条记录开始。', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="empty"><BookOpen size={36} strokeWidth={1.2}/><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: 'info' | 'error' | 'success' }) { return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>; }
export function Loading() { return <div className="loading" role="status"><RefreshCw size={18} className="spin"/> 正在读取本地数据…</div>; }
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Pagination({ page, total, onChange, pageSize = 20 }: { page: number; total: number; onChange: (page: number) => void; pageSize?: number }) {
 const pages = Math.max(1, Math.ceil(total / pageSize));
 return <div className="pagination"><span>共 {total} 条记录</span><div><button className="icon-button" aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16}/></button><span>{page} / {pages}</span><button className="icon-button" aria-label="下一页" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={16}/></button></div></div>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
 const id = useId(); const dialog = useRef<HTMLDialogElement>(null);
 useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
 return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose(); }}><div className="modal-header"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
export function formatTime(value?: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
