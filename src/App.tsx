import { useState } from 'react';
import { BookOpen, Library, UsersRound, ArrowLeftRight, ClipboardList, Database, ArrowUpRight } from 'lucide-react';
import Catalog from './modules/catalog';
import Readers from './modules/readers';
import Circulation from './modules/circulation';
import Loans from './modules/circulation/LoansPage';
import Data from './modules/data';
import type { Page, Route } from './shared/navigation';
const items = [
 { page: 'catalog', label: '图书管理', icon: Library },
 { page: 'readers', label: '读者管理', icon: UsersRound },
 { page: 'circulation', label: '借还工作台', icon: ArrowLeftRight },
 { page: 'loans', label: '借阅记录', icon: ClipboardList },
 { page: 'data', label: '数据管理', icon: Database },
] as const;
export default function App() {
 const [route, setRoute] = useState<Route>({ page: 'catalog' });
 const [visited, setVisited] = useState<Set<Page>>(new Set(['catalog']));
 const [routes, setRoutes] = useState<Partial<Record<Page, Route>>>({ catalog: route });
 function navigate(next: Route) {
   setRoute(next); setVisited(old => new Set([...old, next.page]));
   setRoutes(old => ({ ...old, [next.page]: next }));
 }
 const pages = { catalog: Catalog, readers: Readers, circulation: Circulation, loans: Loans, data: Data };
 return <div className="app-shell"><aside className="sidebar">
   <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate({ page: 'catalog' }); }}><span className="brand-icon"><BookOpen size={25} strokeWidth={1.5}/></span><span>青禾<span className="brand-en">QINGHE LIBRARY</span></span></a>
   <div className="nav-label">图书室工作空间</div>
   <nav aria-label="主导航">{items.map(({ page, label, icon: Icon }) => <button key={page} className={`nav-item ${route.page === page ? 'active' : ''}`} aria-current={route.page === page ? 'page' : undefined} onClick={() => navigate(routes[page] ?? { page })}><Icon size={19} strokeWidth={1.7}/><span>{label}</span>{route.page === page && <span className="nav-dot"/>}</button>)}</nav>
   <div className="sidebar-note"><span className="note-number">一本书，一次相遇。</span><p>让借阅有序，让阅读发生。</p><BookOpen size={56} strokeWidth={.6}/></div>
   <div className="local-status"><i/> 本地工作空间 <span>离线可用</span></div>
 </aside><div className="main-shell"><div className="topbar"><span>工作空间 <span className="slash">/</span> {items.find(i => i.page === route.page)?.label}</span><span className="topbar-right">单机版 <ArrowUpRight size={14}/></span></div><main>
  {Object.entries(pages).map(([page, Component]) => visited.has(page as Page) && <div key={page} hidden={route.page !== page}><Component route={routes[page as Page] ?? { page: page as Page }} navigate={navigate}/></div>)}
 </main><footer className="app-footer"><span>青禾图书管理</span><span>每一份记录，安心保存在本机。</span><span>v0.1.0</span></footer></div></div>;
}
