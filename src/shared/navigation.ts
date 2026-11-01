export type Page = 'catalog' | 'readers' | 'circulation' | 'loans' | 'data' | 'statistics';
export interface Route { page: Page; readerId?: number; bookId?: number; loanId?: number; tab?: 'checkout' | 'return' }
export interface PageProps { route: Route; navigate: (route: Route) => void }
