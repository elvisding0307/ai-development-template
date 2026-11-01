import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, Clock3, Library, RefreshCw, UsersRound } from 'lucide-react';
import { call } from '../../shared/api';
import { useQuery } from '../../shared/hooks';
import type { BorrowingStatistics } from '../../shared/models';
import type { PageProps } from '../../shared/navigation';
import { Empty, Loading, Notice, PageHeader, formatTime } from '../../shared/ui';
import { localDate } from './components';
import './statistics.css';

function Trend({ days }: { days: BorrowingStatistics['trend'] }) {
 const titleId = useId();
 const upper = Math.max(4, Math.ceil(Math.max(...days.flatMap(d => [d.borrowed, d.returned]), 0) / 4) * 4);
 const y = (value: number) => 174 - value / upper * 140;
 return <><div className="statistics-chart"><svg viewBox="0 0 640 224" role="img" aria-labelledby={titleId}>
  <title id={titleId}>最近 7 天借还次数，逐日数值见下方明细</title>
  {[0,1,2,3,4].map(i => <g key={i}><line x1="48" y1={y(i*upper/4)} x2="623" y2={y(i*upper/4)} stroke="#e5eadf" strokeDasharray={i ? '3 5' : undefined}/><text x="32" y={y(i*upper/4)+4} textAnchor="end" className="statistics-axis">{i*upper/4}</text></g>)}
  {days.map((d,i) => <g key={d.date}><rect x={68+i*80} y={y(d.borrowed)} width="18" height={174-y(d.borrowed)} rx="3" fill="#34654f"><title>{d.date} 借出 {d.borrowed} 次</title></rect><rect x={93+i*80} y={y(d.returned)} width="18" height={174-y(d.returned)} rx="3" fill="#b7c78e"><title>{d.date} 归还 {d.returned} 次</title></rect><text x={89+i*80} y="199" textAnchor="middle" className="statistics-axis">{d.date.slice(5).replace('-','/')}</text>{i===6 && <text x={89+i*80} y="216" textAnchor="middle" className="statistics-today">今天</text>}</g>)}
 </svg></div><details className="statistics-details"><summary>查看逐日数据</summary><div className="table-wrap"><table aria-label="最近7天借还明细"><thead><tr><th>日期</th><th>借出次数</th><th>归还次数</th></tr></thead><tbody>{days.map(d => <tr key={d.date}><td>{d.date}</td><td>{d.borrowed}</td><td>{d.returned}</td></tr>)}</tbody></table></div></details></>;
}
export default function StatisticsPage({ navigate }: PageProps) {
 const [day, setDay] = useState(localDate());
 useEffect(() => {
  const timer = window.setInterval(() => setDay(localDate()), 1000);
  return () => clearInterval(timer);
 }, []);
 const query = useQuery(() => call<BorrowingStatistics>('circulation', 'statistics'), [day]);
 const data = query.data;
 const totals = data?.totals;
 const cards = [
  { label: '本馆图书', value: totals?.books, unit: '册', icon: Library, note: '包含停用馆藏', tone: 'green' },
  { label: '读者档案', value: totals?.readers, unit: '位', icon: UsersRound, note: '包含停用读者', tone: 'sage' },
  { label: '当前在借', value: totals?.activeLoans, unit: '册', icon: BookOpen, note: '包含逾期未还', tone: 'amber' },
  { label: '逾期未还', value: totals?.overdueLoans, unit: '册', icon: Clock3, note: '到期当天不算逾期', tone: 'rose' },
 ];
 return <><PageHeader eyebrow="READING IN NUMBERS" title="借阅统计" description="每一次借还，都留下阅读的足迹。" action={<button disabled={query.loading} onClick={() => void query.reload()}><RefreshCw size={15} className={query.loading ? 'spin' : ''}/>{query.loading ? '正在刷新…' : '刷新统计'}</button>}/>
  {query.error && <Notice kind="error">{query.error}{data && ' 以下为上次成功读取的旧数据，请重试刷新。'}</Notice>}
  {!data ? query.loading ? <Loading/> : <section className="panel"><Empty title="统计暂不可用" description="请检查错误提示，稍后点击刷新统计重试。"/></section> : <>
   <div className="statistics-meta"><span className="statistics-meta-line"/><span>截至 {data.asOf} · {query.error ? '旧数据，更新失败' : query.loading ? '正在更新，显示上次结果' : `更新于 ${formatTime(data.generatedAt)}`}</span></div>
   <div className="statistics-cards">{cards.map(({ label, value, unit, icon: Icon, note, tone }) => <section className={`statistics-card ${tone}`} aria-label={label} key={label}><div className="statistics-card-top"><span>{label}</span><Icon size={17} strokeWidth={1.5}/></div><div className="statistics-number"><strong>{value}</strong><span>{unit}</span></div><p>{note}</p></section>)}</div>
   <div className="statistics-grid"><section className="panel statistics-trend"><div className="panel-header"><div><span className="eyebrow">THE PAST WEEK</span><h2>最近 7 天借还趋势</h2></div><div className="statistics-legend"><span><i/>借出</span><span><i/>归还</span></div></div><Trend days={data.trend}/><div className="statistics-panel-note">{data.trend[0]?.date} — {data.asOf} · 按自然日计次，无记录的日期记为 0</div></section>
   <section className="panel statistics-popular"><div className="panel-header"><div><span className="eyebrow">WELL-LOVED BOOKS</span><h2>热门馆藏 <span className="statistics-top-label">TOP 5</span></h2></div><ChartNoAxesCombined size={20} strokeWidth={1.2}/></div>{data.popularBooks.length ? <ol className="statistics-ranking">{data.popularBooks.map((book,index) => <li key={book.bookId}><span className="statistics-rank">{String(index+1).padStart(2,'0')}</span><div className="statistics-ranked-book"><button className="text-button" title={`查看《${book.title}》的借阅记录`} onClick={() => navigate({ page:'loans', bookId:book.bookId })}>{book.title}<ArrowUpRight size={12}/></button><span className="code">{book.code}</span><div className="statistics-track" aria-hidden="true"><i style={{ width:`${book.borrowCount/data.popularBooks[0].borrowCount*100}%` }}/></div></div><span className="statistics-borrow-count"><strong>{book.borrowCount}</strong> 次</span></li>)}</ol> : <Empty title="还没有借阅记录" description="登记第一笔借阅后，这里会显示累计借阅最多的实体书。"/>}<div className="statistics-panel-note">按累计借阅次数排序 · 同名副本分别统计</div></section></div>
   <section className="panel statistics-categories"><div className="panel-header"><div><span className="eyebrow">ON OUR SHELVES</span><h2>馆藏分类分布</h2></div><span className="subtext">共 {data.categories.length} 个分类 · {data.totals.books} 册</span></div>{data.categories.length ? <div className="statistics-category-grid">{data.categories.map(category => <div className="statistics-category" key={category.name}><div className="split"><span>{category.name}</span><span><strong>{category.count}</strong> 册 <small>{data.totals.books ? Math.round(category.count/data.totals.books*100) : 0}%</small></span></div><div className="statistics-track" aria-hidden="true"><i style={{width:`${data.totals.books ? category.count/data.totals.books*100 : 0}%`}}/></div></div>)}</div> : <Empty title="书架正在等待第一本书" description="录入馆藏后，分类分布会自动出现。"/>}<div className="statistics-panel-note">统计全部现有馆藏，包含停用图书；空分类归入“未分类”。</div></section>
  </>}
 </>;
}
