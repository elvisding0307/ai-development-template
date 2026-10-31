import { useState, type FormEvent } from 'react';
import { ArrowRight, Plus, Search, UserRound, Pencil, Check, Ban } from 'lucide-react';
import { call, changed, errorMessage, type AppError } from '../../shared/api';
import { useQuery } from '../../shared/hooks';
import type { ListResult, Reader } from '../../shared/models';
import type { PageProps } from '../../shared/navigation';
import { PageHeader, Empty, Notice, Loading, Badge, Field, Pagination, Modal, formatTime } from '../../shared/ui';

interface ReaderDraft { code: string; name: string; phone: string; notes: string }
function draftOf(reader?: Reader): ReaderDraft {
  return { code: reader?.code ?? '', name: reader?.name ?? '', phone: reader?.phone ?? '', notes: reader?.notes ?? '' };
}
function ReaderEditor({ reader, onClose, onSaved }: { reader?: Reader; onClose: () => void; onSaved: (reader: Reader) => void }) {
  const [draft, setDraft] = useState(() => draftOf(reader));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError>();
  const [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(reader));
  function close() { if (saving) return; if (dirty) setDiscard(true); else onClose(); }
  function update(field: keyof ReaderDraft, value: string) { setDraft(old => ({ ...old, [field]: value })); setError(undefined); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(undefined);
    try {
      const saved = await call<Reader>('readers', 'save', { ...draft, ...(reader ? { id: reader.id } : {}) });
      changed(); onSaved(saved);
    } catch (e) { setError({ ...(e as AppError), message: errorMessage(e) }); }
    finally { setSaving(false); }
  }
  return <>
    <Modal title={reader ? '编辑读者档案' : '新增读者'} onClose={close}>
      <form onSubmit={e => { void submit(e); }}>
        {error && <Notice kind="error">{error.message}{error.field && <span className="subtext"> · 请检查{({ code: '读者编号', name: '姓名', phone: '联系电话', notes: '备注' } as Record<string, string>)[error.field] ?? '输入内容'}</span>}</Notice>}
        <div className="form-grid">
          <Field label="读者编号 *" hint={reader ? '创建后不可更改' : '英文字母、数字、短横线或下划线'}><input autoFocus={!reader} name="code" required maxLength={32} value={draft.code} disabled={saving || !!reader} onChange={e => update('code', e.target.value)} placeholder="例如 R001" aria-invalid={error?.field === 'code'}/></Field>
          <Field label="姓名 *"><input autoFocus={!!reader} name="name" required maxLength={100} value={draft.name} disabled={saving} onChange={e => update('name', e.target.value)} placeholder="读者姓名" aria-invalid={error?.field === 'name'}/></Field>
        </div>
        <Field label="联系电话" hint="可选，允许区号和空格"><input name="phone" type="tel" maxLength={32} value={draft.phone} disabled={saving} onChange={e => update('phone', e.target.value)} placeholder="留下方便联系的号码" aria-invalid={error?.field === 'phone'}/></Field>
        <Field label="备注"><textarea name="notes" maxLength={500} value={draft.notes} disabled={saving} onChange={e => update('notes', e.target.value)} placeholder="可选，最多 500 字符" aria-invalid={error?.field === 'notes'}/></Field>
        <div className="form-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary" disabled={saving} type="submit"><Check size={16}/>{saving ? '正在保存…' : '保存档案'}</button></div>
      </form>
    </Modal>
    {discard && <Modal title="放弃未保存的修改？" onClose={() => setDiscard(false)}><div className="modal-body"><p>修改尚未保存，关闭后需要重新填写。</p><div className="form-actions"><button onClick={() => setDiscard(false)}>继续编辑</button><button className="danger" onClick={onClose}>放弃修改</button></div></div></Modal>}
  </>;
}

function ReaderDetails({ id, onClose, onEdit, onToggle, navigate }: { id: number; onClose: () => void; onEdit: (reader: Reader) => void; onToggle: (reader: Reader) => void; navigate: PageProps['navigate'] }) {
  const query = useQuery(() => call<Reader>('readers', 'get', { id }), [id]);
  const reader = query.data;
  return <Modal title="读者档案" onClose={onClose}><div className="modal-body">
    {query.error && <><Notice kind="error">{query.error}</Notice><button onClick={() => { void query.reload(); }}>重新读取</button></>}
    {query.loading && <Loading/>}
    {reader && !query.loading && <>
      <div className="split" style={{ alignItems: 'center', marginBottom: 25 }}><div><div className="code">{reader.code}</div><h2 style={{ margin: '8px 0', fontFamily: 'serif' }}>{reader.name}</h2></div><Badge tone={reader.enabled ? 'green' : 'neutral'}>{reader.enabled ? '启用' : '停用'}</Badge></div>
      <dl className="detail-grid"><div><dt>联系电话</dt><dd>{reader.phone || '未填写'}</dd></div><div><dt>当前在借</dt><dd><strong>{reader.activeLoans}</strong> 本</dd></div><div><dt>创建时间</dt><dd>{formatTime(reader.createdAt)}</dd></div><div><dt>更新时间</dt><dd>{formatTime(reader.updatedAt)}</dd></div></dl>
      <dl className="detail-grid" style={{ gridTemplateColumns: '1fr' }}><div><dt>备注</dt><dd>{reader.notes || '暂无备注'}</dd></div></dl>
      {!reader.enabled && <Notice>此读者已停用，可查询历史和办理归还，重新启用后可继续借书。</Notice>}
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        <button onClick={() => { onClose(); navigate({ page: 'loans', readerId: reader.id }); }}>查看借阅记录<ArrowRight size={14}/></button>
        {reader.enabled && <button className="primary" onClick={() => { onClose(); navigate({ page: 'circulation', tab: 'checkout', readerId: reader.id }); }}>办理借书<ArrowRight size={14}/></button>}
      </div>
      <div className="form-actions"><button onClick={() => onEdit(reader)}><Pencil size={14}/>编辑档案</button><button className={reader.enabled ? 'danger' : ''} onClick={() => onToggle(reader)}>{reader.enabled ? <Ban size={14}/> : <Check size={14}/>} {reader.enabled ? '停用读者' : '重新启用'}</button></div>
    </>}
  </div></Modal>;
}

function StatusConfirmation({ reader, onClose, onDone }: { reader: Reader; onClose: () => void; onDone: (reader: Reader) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setSaving(true); setError('');
    try { const result = await call<Reader>('readers', 'set_enabled', { id: reader.id, enabled: !reader.enabled }); changed(); onDone(result); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  }
  return <Modal title={reader.enabled ? '确认停用读者' : '重新启用读者'} onClose={() => { if (!saving) onClose(); }}><div className="modal-body">
    {error && <Notice kind="error">{error}</Notice>}
    <p><strong>{reader.name}</strong> <span className="code">{reader.code}</span></p>
    <p>当前在借 <strong>{reader.activeLoans}</strong> 本。</p>
    <Notice>{reader.enabled ? '停用后将不能新增借阅，现有图书仍可归还，档案与借阅历史会保留。' : '重新启用后可恢复借书，原有借阅与历史保持不变。'}</Notice>
    <div className="form-actions"><button disabled={saving} onClick={onClose}>取消</button><button disabled={saving} className={reader.enabled ? 'danger' : 'primary'} onClick={() => { void confirm(); }}>{saving ? '正在保存…' : reader.enabled ? '确认停用' : '确认启用'}</button></div>
  </div></Modal>;
}

export default function ReadersPage({ navigate }: PageProps) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [viewId, setViewId] = useState<number>();
  const [editor, setEditor] = useState<{ reader?: Reader }>();
  const [toggle, setToggle] = useState<Reader>();
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [fetchingStatus, setFetchingStatus] = useState(false);
  const query = useQuery(() => call<ListResult<Reader>>('readers', 'list', { search, status, page }), [search, status, page]);
  const filtered = !!search || status !== 'all';
  async function prepareToggle(reader: Reader) {
    setFetchingStatus(true); setActionError('');
    try { setToggle(await call<Reader>('readers', 'get', { id: reader.id })); }
    catch (e) { setActionError(errorMessage(e)); }
    finally { setFetchingStatus(false); }
  }
  function searchReaders(event: FormEvent) { event.preventDefault(); setSearch(input.trim()); setPage(1); }
  function clearFilters() { setInput(''); setSearch(''); setStatus('all'); setPage(1); }
  return <>
    <PageHeader eyebrow="PEOPLE & STORIES" title="读者管理" description="记住每一位读者，也记住书与人的相遇。" action={<button className="primary" onClick={() => { setMessage(''); setEditor({}); }}><Plus size={17}/>新增读者</button>}/>
    {message && <Notice kind="success">{message}</Notice>}
    {actionError && <Notice kind="error">{actionError}</Notice>}
    <section className="panel">
      <form className="toolbar" onSubmit={searchReaders}>
        <input aria-label="搜索读者" maxLength={100} placeholder="搜索编号、姓名或联系电话" value={input} onChange={e => setInput(e.target.value)}/>
        <button type="submit"><Search size={16}/>搜索</button>
        <select aria-label="读者状态" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">全部状态</option><option value="enabled">启用</option><option value="disabled">停用</option></select>
        {filtered && <button type="button" className="text-button" onClick={clearFilters}>清除条件</button>}
        <span className="count">以读者编号区分同名档案</span>
      </form>
      {query.error && <div className="section-body"><Notice kind="error">{query.error}{query.data && ' · 以下为上次读取的数据。'}</Notice><button onClick={() => { void query.reload(); }}>重新读取</button></div>}
      {query.loading ? <Loading/> : query.data && query.data.items.length === 0 ? <Empty title={filtered ? '没有找到匹配的读者' : '从第一位读者开始'} description={filtered ? '试试其他编号、姓名或状态。' : '建立一份读者档案，让每一次借阅都有清楚的记录。'} action={filtered ? <button onClick={clearFilters}>清除筛选</button> : <button onClick={() => setEditor({})}><Plus size={16}/>新增读者</button>}/> : query.data && <>
        <div className="table-wrap"><table><thead><tr><th>读者编号</th><th>姓名</th><th>联系电话</th><th>当前在借</th><th>状态</th><th>操作</th></tr></thead><tbody>{query.data.items.map(reader => <tr key={reader.id}><td className="code">{reader.code}</td><td><button className="text-button table-title" onClick={() => setViewId(reader.id)}><UserRound size={14}/>{reader.name}</button></td><td>{reader.phone || <span className="muted">—</span>}</td><td>{reader.activeLoans} 本</td><td><Badge tone={reader.enabled ? 'green' : 'neutral'}>{reader.enabled ? '启用' : '停用'}</Badge></td><td><div className="actions"><button className="text-button" onClick={() => setViewId(reader.id)}>详情</button><button className="text-button" onClick={() => { setMessage(''); setEditor({ reader }); }}>编辑</button><button className="text-button" disabled={fetchingStatus} onClick={() => { void prepareToggle(reader); }}>{reader.enabled ? '停用' : '启用'}</button></div></td></tr>)}</tbody></table></div>
        <Pagination page={page} total={query.data.total} onChange={setPage}/>
      </>}
    </section>
    {viewId !== undefined && !editor && !toggle && <ReaderDetails id={viewId} onClose={() => setViewId(undefined)} navigate={navigate} onEdit={reader => { setEditor({ reader }); }} onToggle={reader => { void prepareToggle(reader); }}/>}
    {editor && <ReaderEditor reader={editor.reader} onClose={() => setEditor(undefined)} onSaved={reader => { setEditor(undefined); setViewId(reader.id); setMessage('读者档案已保存。'); }}/>}
    {toggle && <StatusConfirmation reader={toggle} onClose={() => setToggle(undefined)} onDone={reader => { setToggle(undefined); setMessage(reader.enabled ? '读者已重新启用。' : '读者已停用，原有借阅仍可归还。'); }}/>}
  </>;
}
