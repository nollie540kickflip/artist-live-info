DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  end_date TEXT,
  venue TEXT NOT NULL DEFAULT '',
  doors_time TEXT,
  start_time TEXT,
  ticket_sale_at TEXT,
  status TEXT NOT NULL DEFAULT 'interested',
  link TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
