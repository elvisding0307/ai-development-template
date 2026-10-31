export interface ListResult<T> { items: T[]; total: number }
export interface Book {
 id: number; code: string; title: string; author: string; isbn: string; publisher: string; category: string; location: string;
 enabled: boolean; createdAt: string; updatedAt: string; status: 'available' | 'borrowed' | 'disabled';
 activeLoan?: { id: number; readerName: string; dueDate: string } | null;
}
export interface Reader {
 id: number; code: string; name: string; phone: string; notes: string; enabled: boolean;
 createdAt: string; updatedAt: string; activeLoans: number;
}
export interface Loan {
 id: number; bookId: number; readerId: number; borrowedAt: string; dueDate: string;
 returnedAt: string | null; returnedLocalDate: string | null;
 readerCode: string; readerName: string; bookCode: string; bookTitle: string;
 status: 'active' | 'overdue' | 'returned'; overdueDays: number; returnedLate: boolean;
}
