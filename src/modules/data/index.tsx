import { useState } from 'react';
import { Archive, FolderOpen, ShieldCheck, Download, RotateCcw, Database, Check, X } from 'lucide-react';
import { call, changed, errorMessage } from '../../shared/api';
import { useQuery } from '../../shared/hooks';
import { PageHeader, Notice, Loading, Modal } from '../../shared/ui';
import type { PageProps } from '../../shared/navigation';
import './data.css';
interface Summary { books: number; readers: number; loans: number; activeLoans: number; schemaVersion: number }
interface Info { path: string; summary: Summary }
interface Inspection { cancelled?: boolean; token: string; path: string; summary: Summary }
interface Backup { cancelled?: boolean; path: string }
interface Restored { summary: Summary; safetyPath: string }
export default function DataPage(_props: PageProps) {
 const info = useQuery(() => call<Info>('data', 'info'), []);
 const [busy, setBusy] = useState('');
 const [error, setError] = useState('');
 const [message, setMessage] = useState('');
 const [inspection, setInspection] = useState<Inspection>();
 const [confirmed, setConfirmed] = useState(false);
 const [safety, setSafety] = useState('');
 async function backup() {
  setBusy('正在创建完整备份，请稍候…'); setError(''); setMessage('');
  try { const result = await call<Backup>('data', 'backup'); if (!result.cancelled) setMessage(`备份已保存：${result.path}`); }
  catch (e) { setError(errorMessage(e)); }
  finally { setBusy(''); }
 }
 async function choose() {
  setBusy('正在选择并校验备份…'); setError(''); setMessage(''); setConfirmed(false);
  try { const result = await call<Inspection>('data', 'inspect'); if (!result.cancelled) setInspection(result); }
  catch (e) { setError(errorMessage(e)); }
  finally { setBusy(''); }
 }
 async function restore() {
  if (!inspection || !confirmed) return;
  setBusy('正在保存安全备份并恢复数据，请勿关闭客户端…'); setError('');
  try {
   const result = await call<Restored>('data', 'restore', { token: inspection.token });
   setSafety(result.safetyPath); setMessage('恢复完成，当前工作空间已切换到备份时的数据。');
   setInspection(undefined); setConfirmed(false); window.dispatchEvent(new Event('library:restored')); changed();
  } catch (e) { setError(errorMessage(e)); setInspection(undefined); }
  finally { setBusy(''); }
 }
 return <><PageHeader eyebrow="DATA & BACKUP" title="数据管理" description="为每一份馆藏与借阅记录，留一份安心的备份。"/>
  {error && <Notice kind="error">{error}</Notice>}
  {message && <Notice kind="success"><span className="file-path">{message}</span></Notice>}
  {safety && <Notice>恢复前的数据已单独保存，可通过“从备份恢复”找回。<br/><span className="file-path">{safety}</span></Notice>}
  {busy && <Notice><span className="data-inline"><RotateCcw size={15} className="spin"/>{busy}</span></Notice>}
  <div className="workspace-grid data-cards">
   <section className="card"><div className="data-card-icon"><Download size={25} strokeWidth={1.4}/></div><span className="eyebrow">01 / KEEP A COPY</span><h2>创建完整备份</h2><p>把图书、读者档案和全部借还记录保存到一个文件。可以存放在移动硬盘或其他安全位置。</p><div className="data-card-foot"><span className="subtext">手动备份 · 所有业务数据</span><button className="primary" disabled={!!busy} onClick={() => void backup()}><Archive size={16}/>创建备份</button></div></section>
   <section className="card"><div className="data-card-icon amber"><RotateCcw size={25} strokeWidth={1.4}/></div><span className="eyebrow">02 / RESTORE YOUR LIBRARY</span><h2>从备份恢复</h2><p>先选择备份并检查内容，确认后完整替换当前数据。系统会先保留一份恢复前的安全备份。</p><div className="data-card-foot"><span className="subtext">完整替换 · 校验后确认</span><button disabled={!!busy} onClick={() => void choose()}><FolderOpen size={16}/>选择备份文件</button></div></section>
  </div>
  <section className="panel data-info"><div className="panel-header"><h2><Database size={17}/>本地数据</h2><span className="badge green"><Check size={11}/>离线保存</span></div><div className="section-body">
   {info.loading && !info.data ? <Loading/> : info.error ? <Notice kind="error">{info.error}<button className="text-button" onClick={() => void info.reload()}>重新读取</button></Notice> : info.data && <><div className="data-counts"><div><strong>{info.data.summary.books}</strong><span>本馆图书</span></div><div><strong>{info.data.summary.readers}</strong><span>读者档案</span></div><div><strong>{info.data.summary.loans}</strong><span>借阅记录</span></div><div><strong>{info.data.summary.activeLoans}</strong><span>当前在借</span></div></div><dl className="data-path"><dt>数据库位置</dt><dd className="file-path">{info.data.path}</dd><dt>数据版本</dt><dd>Schema {info.data.summary.schemaVersion}</dd></dl></>}
  </div></section>
  <div className="data-tips"><ShieldCheck size={20} strokeWidth={1.4}/><div><strong>备份前的小提醒</strong><p>备份是包含读者联系方式的明文文件，请妥善保存。恢复会替换所有当前数据，备份之后的修改将丢失。备份与恢复过程中暂停业务办理，完成后即可继续。</p></div></div>
  {inspection && <Modal title="确认恢复图书室数据" onClose={() => { if (!busy) setInspection(undefined); }}><div className="modal-body"><Notice>恢复会替换全部当前数据，备份之后的修改将丢失。当前数据会先保存为独立安全备份。</Notice><p className="file-path">{inspection.path}</p><div className="restore-summary"><div><b>{inspection.summary.books}</b> 本馆图书</div><div><b>{inspection.summary.readers}</b> 读者档案</div><div><b>{inspection.summary.loans}</b> 借阅记录</div><div><b>{inspection.summary.activeLoans}</b> 当前在借</div></div><label className="restore-consent"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={e => setConfirmed(e.target.checked)}/>我已确认用此备份替换当前全部数据</label>{busy && <Notice>{busy}</Notice>}<div className="form-actions"><button disabled={!!busy} onClick={() => setInspection(undefined)}><X size={15}/>取消</button><button className="danger" disabled={!confirmed || !!busy} onClick={() => void restore()}><RotateCcw size={15}/>确认恢复</button></div></div></Modal>}
 </>;
}
