import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const SHOW_STATUSES = ["got", "interested", "waiting", "skipped"] as const;
export type ShowStatus = (typeof SHOW_STATUSES)[number];

export const artists = sqliteTable("artists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  officialUrl: text("official_url").notNull().default(""),
  searchKeyword: text("search_keyword").notNull().default(""),
  memo: text("memo").notNull().default(""),
  // Last successful auto-fetch completion time for this artist.
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const shows = sqliteTable("shows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  artist: text("artist").notNull(),
  // Registered artist this show belongs to (null for legacy/manual rows).
  artistId: integer("artist_id"),
  // 'auto' = brought in by auto-fetch, 'manual' = entered/seeded by hand.
  origin: text("origin").notNull().default("manual"),
  title: text("title").notNull(),
  // Calendar date of the show, YYYY-MM-DD (Asia/Tokyo wall date).
  eventDate: text("event_date").notNull(),
  // Optional last day for multi-day runs, YYYY-MM-DD.
  endDate: text("end_date"),
  venue: text("venue").notNull().default(""),
  // Optional HH:mm strings.
  doorsTime: text("doors_time"),
  startTime: text("start_time"),
  // Optional ticket-sale start, YYYY-MM-DDTHH:mm local string.
  ticketSaleAt: text("ticket_sale_at"),
  status: text("status", { enum: SHOW_STATUSES }).notNull().default("interested"),
  link: text("link").notNull().default(""),
  memo: text("memo").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
