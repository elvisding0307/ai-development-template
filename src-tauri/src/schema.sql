CREATE TABLE books (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
 title TEXT NOT NULL CHECK(length(trim(title)) > 0), author TEXT NOT NULL DEFAULT '',
 isbn TEXT NOT NULL DEFAULT '', publisher TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE readers (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL CHECK(length(trim(name)) > 0), phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE loans (
 id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id), reader_id INTEGER NOT NULL REFERENCES readers(id),
 borrowed_at TEXT NOT NULL, due_date TEXT NOT NULL, returned_at TEXT, returned_local_date TEXT,
 reader_code TEXT NOT NULL, reader_name TEXT NOT NULL, book_code TEXT NOT NULL, book_title TEXT NOT NULL,
 CHECK((returned_at IS NULL AND returned_local_date IS NULL) OR (returned_at IS NOT NULL AND returned_local_date IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_loan_per_book ON loans(book_id) WHERE returned_at IS NULL;
CREATE INDEX loans_by_reader ON loans(reader_id, returned_at);
CREATE INDEX loans_by_borrowed ON loans(borrowed_at DESC, id DESC);
