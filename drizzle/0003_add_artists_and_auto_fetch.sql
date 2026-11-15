CREATE TABLE artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  official_url TEXT NOT NULL DEFAULT '',
  search_keyword TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  last_fetched_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE shows ADD COLUMN artist_id INTEGER;
--> statement-breakpoint
ALTER TABLE shows ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
--> statement-breakpoint
INSERT INTO artists (name, official_url, search_keyword, memo, last_fetched_at, created_at, updated_at)
SELECT artist, '', '', '', NULL, MIN(created_at), MIN(updated_at) FROM shows GROUP BY artist;
--> statement-breakpoint
UPDATE shows SET artist_id = (SELECT id FROM artists WHERE artists.name = shows.artist);
