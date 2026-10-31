import { PageHeader, Empty } from '../../shared/ui';
import type { PageProps } from '../../shared/navigation';
export default function ModulePage(_props: PageProps) { return <><PageHeader eyebrow="QINGHE LIBRARY" title="图书管理" description="让每一本书，都有清楚的去向。"/><section className="panel"><Empty title="框架已就绪" description="模块功能正在开发中。"/></section></>; }
