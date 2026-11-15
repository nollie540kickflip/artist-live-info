import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { asc, eq } from "drizzle-orm";
import * as schema from "./schema";

const statusSchema = z.enum(["got", "interested", "waiting", "skipped"]);

const showSchema = z.object({
  id: z.number(),
  artist: z.string(),
  artist_id: z.number().nullable(),
  origin: z.string(),
  title: z.string(),
  event_date: z.string(),
  end_date: z.string().nullable(),
  venue: z.string(),
  doors_time: z.string().nullable(),
  start_time: z.string().nullable(),
  ticket_sale_at: z.string().nullable(),
  status: statusSchema,
  link: z.string(),
  memo: z.string(),
});

const showInput = z.object({
  artist: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  venue: z.string().trim().max(200).default(""),
  doors_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  ticket_sale_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  status: statusSchema.default("interested"),
  link: z.string().trim().max(1000).default(""),
  memo: z.string().max(2000).default(""),
});

const artistSchema = z.object({
  id: z.number(),
  name: z.string(),
  official_url: z.string(),
  search_keyword: z.string(),
  memo: z.string(),
  last_fetched_at: z.string().nullable(),
});

const artistInput = z.object({
  name: z.string().trim().min(1).max(100),
  official_url: z.string().trim().max(1000).default(""),
  search_keyword: z.string().trim().max(200).default(""),
  memo: z.string().max(2000).default(""),
});

// One show as reported by the auto-fetch research task. Every field must come
// from a public source the task actually checked; the task is told not to
// guess. source_name records where the show was confirmed.
const fetchedShow = z.object({
  title: z.string().trim().min(1).max(200),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  venue: z.string().trim().max(200).default(""),
  doors_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  ticket_sale_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  link: z.string().trim().max(1000).default(""),
  source_name: z.string().trim().max(200).default(""),
});

type ShowRow = typeof schema.shows.$inferSelect;
type ArtistRow = typeof schema.artists.$inferSelect;

function toShow(row: ShowRow): z.infer<typeof showSchema> {
  return {
    id: row.id,
    artist: row.artist,
    artist_id: row.artistId,
    origin: row.origin,
    title: row.title,
    event_date: row.eventDate,
    end_date: row.endDate,
    venue: row.venue,
    doors_time: row.doorsTime,
    start_time: row.startTime,
    ticket_sale_at: row.ticketSaleAt,
    status: row.status,
    link: row.link,
    memo: row.memo,
  };
}

function toArtist(row: ArtistRow): z.infer<typeof artistSchema> {
  return {
    id: row.id,
    name: row.name,
    official_url: row.officialUrl,
    search_keyword: row.searchKeyword,
    memo: row.memo,
    last_fetched_at: row.lastFetchedAt ? row.lastFetchedAt.toISOString() : null,
  };
}

function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// --- Same-show matching -------------------------------------------------
// Titles for the same show vary a lot between a hand-entered seed row and
// an auto-fetched row (short tour nickname vs the full official title), so
// matching combines: normalized-title containment, a shared distinctive
// keyword (latin tour words like "duo", or a shared title fragment), and
// venue evidence (same venue, a venue that contains the other, or a bare
// city label like 浜松 that the full hall name contains).

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[\s「」『』"“”'’（）()【】[\]・:：/／\-—~〜]/g, "");
}

function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === "" || nb === "") return false;
  if (na === nb) return true;
  if (na.length < 4 || nb.length < 4) return false;
  return na.includes(nb) || nb.includes(na);
}

function titlesShareKeyword(a: string, b: string): boolean {
  const ka = a.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const kb = new Set(b.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  if (ka.some((k) => kb.has(k))) return true;
  // Shared title fragment (e.g. ザ・トリオ・プロジェクト in both a short
  // seed title and the long official title).
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na.length < 6 || nb.length < 6) return false;
  for (let i = 0; i + 6 <= na.length; i += 1) {
    if (nb.includes(na.slice(i, i + 6))) return true;
  }
  return false;
}

function normalizeVenue(v: string): string {
  return v
    .toLowerCase()
    .replace(/[\s　・:：/／\-—~〜（）()【】[\]]/g, "");
}

function venuesOverlap(a: string, b: string): boolean {
  const na = normalizeVenue(a);
  const nb = normalizeVenue(b);
  if (na === "" || nb === "") return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length < 2) return false;
  return longer.includes(shorter);
}

// A bare city/area label (浜松, 名古屋, 大阪…) as the whole venue: the seed
// rows carry only the city, so it cannot be containment-checked against a
// full hall name in another city spelling (e.g. フェスティバルホール).
function isBarePlaceVenue(v: string): boolean {
  const n = normalizeVenue(v);
  return n !== "" && n.length <= 4;
}

type ShowLike = { eventDate: string; title: string; venue: string };

function isSameShow(a: ShowLike, b: ShowLike): boolean {
  if (a.eventDate !== b.eventDate) return false;
  if (titlesMatch(a.title, b.title)) return true;
  if (!titlesShareKeyword(a.title, b.title)) return false;
  return (
    venuesOverlap(a.venue, b.venue) ||
    isBarePlaceVenue(a.venue) ||
    isBarePlaceVenue(b.venue)
  );
}

function richerVenue(a: string, b: string): string {
  if (a === "") return b;
  if (b === "") return a;
  if (venuesOverlap(a, b)) return a.length >= b.length ? a : b;
  return a;
}

// How much detail a row carries; the richer row survives a dedupe merge.
function showRichness(r: ShowRow): number {
  let n = Math.min(r.venue.length, 10) + Math.min(r.title.length, 24) / 4;
  if (r.doorsTime) n += 5;
  if (r.startTime) n += 5;
  if (r.ticketSaleAt) n += 5;
  if (r.link) n += 5;
  if (r.endDate) n += 3;
  if (r.origin === "auto") n += 2;
  return n;
}

// Starts one detached research task per artist. The task browses public
// sources and reports back through saveFetchedShows; this action only kicks
// it off, so it returns immediately.
async function startFetchTasks(
  ctx: Ctx,
  targets: ArtistRow[],
): Promise<number> {
  const today = todayJst();
  let started = 0;
  for (const a of targets) {
    const lines = [
      `アーティスト「${a.name}」の今後のライブ／コンサート情報を公開情報から調べて、web artifact「お気に入りアーティスト ライブ情報」（slug: oqi-niru-riateisuto-raibuqing-bao）の saveFetchedShows アクションで保存してください。`,
      ``,
      `対象アーティスト:`,
      `- 名前: ${a.name}`,
      `- 公式サイト: ${a.officialUrl || "（未登録）"}`,
      `- 検索キーワード: ${a.searchKeyword || "（なし）"}`,
      ``,
      `手順:`,
      `1. 公式サイトや公演・チケット情報サイトなどの公開情報を検索し、日本公演を優先して、今日（${today}、Asia/Tokyo）以降に開催される公演を確認する。`,
      `2. 情報源で実際に確認できた公演だけを集める。確認できない公演は推測で作らない。過去の公演は含めない。`,
      `3. 保存は必ず saveFetchedShows アクションだけを使う（addShow／updateShow／deleteShow は使わないこと。ユーザーのステータスやメモを守るため）。artist_id=${a.id} で呼び、確認できた公演を shows 配列で渡す。各公演には title（公演名／ツアー名）、event_date（YYYY-MM-DD）、end_date（期間公演の最終日、なければ null）、venue（会場名）、doors_time／start_time（HH:mm、分からなければ null）、ticket_sale_at（YYYY-MM-DDTHH:mm、分からなければ null）、link（公式ページや公演ページのURL）、source_name（確認した情報源の名称）を入れる。`,
      `4. 確認できた公演が1件もなければ、shows を空配列にして saveFetchedShows を呼ぶ（取得日時だけが記録される）。`,
    ];
    await ctx.agent.spawnTask(lines.join("\n"), {
      expectsAction: "saveFetchedShows",
    });
    started += 1;
  }
  return started;
}

// Initial data the user confirmed (assistant proposal, option 1). Venue is
// kept exactly as supplied — city names where no hall was named; official
// links were not supplied, so link stays empty for the user to fill in.
const SEED_SHOWS: Array<z.infer<typeof showInput>> = [
  { artist: "上原ひろみ", title: "Duoツアー", event_date: "2026-11-23", venue: "浜松", status: "interested", link: "", memo: "" },
  { artist: "上原ひろみ", title: "Duoツアー", event_date: "2026-11-26", venue: "名古屋", status: "interested", link: "", memo: "" },
  { artist: "上原ひろみ", title: "MET JAZZ TOKYO DAY 0", event_date: "2026-11-29", venue: "東京", status: "interested", link: "", memo: "" },
  { artist: "上原ひろみ", title: "Duoツアー", event_date: "2026-12-01", venue: "大阪", status: "interested", link: "", memo: "" },
  { artist: "上原ひろみ", title: "Duoツアー", event_date: "2026-12-06", venue: "東京", status: "interested", link: "", memo: "" },
  { artist: "上原ひろみ", title: "Duoツアー", event_date: "2026-12-13", venue: "仙台", status: "interested", link: "", memo: "" },
  {
    artist: "上原ひろみ",
    title: "ザ・トリオ・プロジェクト（ブルーノート東京）",
    event_date: "2026-12-28",
    end_date: "2027-01-03",
    venue: "ブルーノート東京",
    ticket_sale_at: "2026-11-20T12:00",
    status: "waiting",
    link: "",
    memo: "期間公演（12/28〜1/3）。一般予約は2026年11月20日12:00開始。",
  },
  {
    artist: "XG",
    title: "Spotify On Stage Tokyo 2026",
    event_date: "2026-12-20",
    venue: "東京ガーデンシアター",
    doors_time: "16:30",
    start_time: "17:30",
    status: "interested",
    link: "",
    memo: "",
  },
  {
    artist: "XG",
    title: "WORLD TOUR: THE CORE FINAL「7」",
    event_date: "2027-02-11",
    venue: "東京ドーム",
    status: "got",
    link: "",
    memo: "チケット取得済み。",
  },
];

const saveFetchedResponse = z.object({
  ok: z.literal(true),
  added: z.number(),
  updated: z.number(),
});

export const Actions = {
  listShows: defineAction({
    description: "Lists all saved live shows, ordered by event date ascending.",
    request: z.object({}),
    response: z.object({ shows: z.array(showSchema) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.shows)
        .orderBy(asc(schema.shows.eventDate), asc(schema.shows.id));
      return { shows: rows.map(toShow) };
    },
  }),

  addShow: defineAction({
    description: "Adds one live show manually and returns its id.",
    request: showInput,
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const artistRows = await db
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.name, args.artist))
        .limit(1);
      const result = await db
        .insert(schema.shows)
        .values({
          artist: args.artist,
          artistId: artistRows[0]?.id ?? null,
          origin: "manual",
          title: args.title,
          eventDate: args.event_date,
          endDate: args.end_date ?? null,
          venue: args.venue,
          doorsTime: args.doors_time ?? null,
          startTime: args.start_time ?? null,
          ticketSaleAt: args.ticket_sale_at ?? null,
          status: args.status,
          link: args.link,
          memo: args.memo,
        })
        .returning({ id: schema.shows.id });
      const inserted = result[0];
      if (!inserted) throw new Error("addShow: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateShow: defineAction({
    description: "Updates one live show by id.",
    request: showInput.extend({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const artistRows = await db
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.name, args.artist))
        .limit(1);
      await db
        .update(schema.shows)
        .set({
          artist: args.artist,
          artistId: artistRows[0]?.id ?? null,
          title: args.title,
          eventDate: args.event_date,
          endDate: args.end_date ?? null,
          venue: args.venue,
          doorsTime: args.doors_time ?? null,
          startTime: args.start_time ?? null,
          ticketSaleAt: args.ticket_sale_at ?? null,
          status: args.status,
          link: args.link,
          memo: args.memo,
          updatedAt: new Date(),
        })
        .where(eq(schema.shows.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteShow: defineAction({
    description: "Deletes one live show by id.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.shows).where(eq(schema.shows.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listArtists: defineAction({
    description:
      "Lists the user-registered artists with their last auto-fetch time.",
    request: z.object({}),
    response: z.object({ artists: z.array(artistSchema) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.artists)
        .orderBy(asc(schema.artists.id));
      return { artists: rows.map(toArtist) };
    },
  }),

  addArtist: defineAction({
    description:
      "Registers an artist and immediately starts the first auto-fetch of their live shows.",
    request: artistInput,
    response: z.object({ id: z.number(), fetch_started: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.name, args.name))
        .limit(1);
      if (existing[0]) {
        throw new Error(`「${args.name}」はすでに登録されています。`);
      }
      const result = await db
        .insert(schema.artists)
        .values({
          name: args.name,
          officialUrl: args.official_url,
          searchKeyword: args.search_keyword,
          memo: args.memo,
        })
        .returning();
      const artist = result[0];
      if (!artist) throw new Error("addArtist: insert returned no rows");
      // Link any pre-existing manual shows that already carry this name.
      await db
        .update(schema.shows)
        .set({ artistId: artist.id })
        .where(eq(schema.shows.artist, artist.name));
      let fetchStarted = false;
      try {
        fetchStarted = (await startFetchTasks(ctx, [artist])) > 0;
      } catch {
        fetchStarted = false;
      }
      ctx.invalidateQueries();
      return { id: artist.id, fetch_started: fetchStarted };
    },
  }),

  updateArtist: defineAction({
    description: "Updates one registered artist by id.",
    request: artistInput.extend({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.id, args.id))
        .limit(1);
      const artist = rows[0];
      if (!artist) throw new Error("updateArtist: artist not found");
      const dup = await db
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.name, args.name))
        .limit(1);
      if (dup[0] && dup[0].id !== args.id) {
        throw new Error(`「${args.name}」はすでに登録されています。`);
      }
      await db
        .update(schema.artists)
        .set({
          name: args.name,
          officialUrl: args.official_url,
          searchKeyword: args.search_keyword,
          memo: args.memo,
          updatedAt: new Date(),
        })
        .where(eq(schema.artists.id, args.id));
      if (artist.name !== args.name) {
        await db
          .update(schema.shows)
          .set({ artist: args.name })
          .where(eq(schema.shows.artistId, args.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteArtist: defineAction({
    description:
      "Deletes one registered artist and all of their shows. The artist is not re-created automatically afterwards.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.shows)
        .where(eq(schema.shows.artistId, args.id));
      await db.delete(schema.artists).where(eq(schema.artists.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  refreshShows: defineAction({
    description:
      "Starts an auto-fetch of upcoming live shows from public sources for all registered artists (or one artist when artist_id is given). Results arrive asynchronously via saveFetchedShows.",
    request: z.object({
      artist_id: z.number().int().positive().optional(),
    }),
    response: z.object({ started: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = args.artist_id
        ? await db
            .select()
            .from(schema.artists)
            .where(eq(schema.artists.id, args.artist_id))
        : await db.select().from(schema.artists).orderBy(asc(schema.artists.id));
      const started = await startFetchTasks(ctx, rows);
      return { started };
    },
  }),

  saveFetchedShows: defineAction({
    description:
      "Saves shows found by the auto-fetch research task for one artist: new shows are added, changed details on existing shows are updated, and the user's status and memo on existing shows are never overwritten. Also records the artist's last-fetched time.",
    request: z.object({
      artist_id: z.number().int().positive(),
      shows: z.array(fetchedShow).max(100),
    }),
    response: saveFetchedResponse,
    async handler(
      ctx,
      args,
    ): Promise<z.infer<typeof saveFetchedResponse>> {
      const db = ctx.db<typeof schema>();
      const artistRows = await db
        .select()
        .from(schema.artists)
        .where(eq(schema.artists.id, args.artist_id))
        .limit(1);
      const artist = artistRows[0];
      if (!artist) throw new Error("saveFetchedShows: artist not found");

      const allShows = await db.select().from(schema.shows);
      const existing = allShows.filter(
        (e) => e.artistId === artist.id || e.artist === artist.name,
      );

      let added = 0;
      let updated = 0;
      const seenKeys = new Set<string>();
      const usedIds = new Set<number>();
      for (const s of args.shows) {
        const key = `${s.event_date}|${normalizeTitle(s.title)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        // Match on title, or — for seed rows whose short title differs
        // completely from the official one — on same date + shared tour
        // keyword + venue/city evidence (see isSameShow).
        const incoming: ShowLike = {
          eventDate: s.event_date,
          title: s.title,
          venue: s.venue,
        };
        const match = existing.find(
          (e) => !usedIds.has(e.id) && isSameShow(e, incoming),
        );
        if (match) {
          usedIds.add(match.id);
          // Update source-provided details only; status and memo belong to
          // the user and are preserved. Empty incoming values never erase
          // known details. When the match came from the venue/keyword
          // fallback, adopt the fuller official title and venue.
          const titleMatched = titlesMatch(match.title, s.title);
          await db
            .update(schema.shows)
            .set({
              title:
                !titleMatched && s.title.length > match.title.length
                  ? s.title
                  : match.title,
              endDate: s.end_date ?? match.endDate,
              venue:
                s.venue !== ""
                  ? venuesOverlap(match.venue, s.venue)
                    ? richerVenue(match.venue, s.venue)
                    : s.venue
                  : match.venue,
              doorsTime: s.doors_time ?? match.doorsTime,
              startTime: s.start_time ?? match.startTime,
              ticketSaleAt: s.ticket_sale_at ?? match.ticketSaleAt,
              link: s.link !== "" ? s.link : match.link,
              origin: "auto",
              updatedAt: new Date(),
            })
            .where(eq(schema.shows.id, match.id));
          updated += 1;
        } else {
          await db.insert(schema.shows).values({
            artist: artist.name,
            artistId: artist.id,
            origin: "auto",
            title: s.title,
            eventDate: s.event_date,
            endDate: s.end_date ?? null,
            venue: s.venue,
            doorsTime: s.doors_time ?? null,
            startTime: s.start_time ?? null,
            ticketSaleAt: s.ticket_sale_at ?? null,
            status: "interested",
            link: s.link,
            memo:
              s.source_name !== "" ? `情報源：${s.source_name}` : "",
          });
          added += 1;
        }
      }

      await db
        .update(schema.artists)
        .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.artists.id, artist.id));
      ctx.invalidateQueries();
      return { ok: true, added, updated };
    },
  }),

  dedupeShows: defineAction({
    description:
      "One-time cleanup: merges duplicate show rows for the same concert (same artist and date, matched by title or by tour keyword + venue/city) into the richer row, preserving any user-set status and memo, and deletes the merged-away rows.",
    request: z.object({}),
    response: z.object({ ok: z.literal(true), merged: z.number() }),
    async handler(ctx): Promise<{ ok: true; merged: number }> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.shows);
      const groups = new Map<string, ShowRow[]>();
      for (const r of rows) {
        const key = `${r.artist}|${r.eventDate}`;
        const g = groups.get(key);
        if (g) g.push(r);
        else groups.set(key, [r]);
      }
      let merged = 0;
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const sorted = [...group].sort(
          (a, b) => showRichness(b) - showRichness(a),
        );
        const survivors: ShowRow[] = [];
        for (const row of sorted) {
          const target = survivors.find((s) => isSameShow(s, row));
          if (!target) {
            survivors.push({ ...row });
            continue;
          }
          // Merge row into target. Target is the richer row, so its
          // details win; gaps are filled from row. A non-default status
          // on either side is kept (auto-fetch never resets a user's
          // status), and memos are combined rather than dropped.
          const status =
            target.status !== "interested" ? target.status : row.status;
          const memo = [target.memo, row.memo]
            .filter((m, i, arr) => m !== "" && arr.indexOf(m) === i)
            .join("\n");
          const mergedRow: ShowRow = {
            ...target,
            endDate: target.endDate ?? row.endDate,
            venue: richerVenue(target.venue, row.venue),
            doorsTime: target.doorsTime ?? row.doorsTime,
            startTime: target.startTime ?? row.startTime,
            ticketSaleAt: target.ticketSaleAt ?? row.ticketSaleAt,
            link: target.link !== "" ? target.link : row.link,
            origin:
              target.origin === "auto" || row.origin === "auto"
                ? "auto"
                : target.origin,
            status,
            memo,
          };
          await db
            .update(schema.shows)
            .set({
              endDate: mergedRow.endDate,
              venue: mergedRow.venue,
              doorsTime: mergedRow.doorsTime,
              startTime: mergedRow.startTime,
              ticketSaleAt: mergedRow.ticketSaleAt,
              link: mergedRow.link,
              origin: mergedRow.origin,
              status: mergedRow.status,
              memo: mergedRow.memo,
              updatedAt: new Date(),
            })
            .where(eq(schema.shows.id, target.id));
          await db.delete(schema.shows).where(eq(schema.shows.id, row.id));
          Object.assign(target, mergedRow);
          merged += 1;
        }
      }
      if (merged > 0) ctx.invalidateQueries();
      return { ok: true, merged };
    },
  }),

  seedInitial: defineAction({
    description:
      "Seeds the confirmed initial artists and shows (上原ひろみ / XG) only when the shows table is empty; safe to call repeatedly.",
    request: z.object({}),
    response: z.object({ seeded: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select({ id: schema.shows.id }).from(schema.shows).limit(1);
      if (existing.length > 0) return { seeded: 0 };
      let count = 0;
      for (const s of SEED_SHOWS) {
        let artistRows = await db
          .select()
          .from(schema.artists)
          .where(eq(schema.artists.name, s.artist))
          .limit(1);
        if (!artistRows[0]) {
          await db.insert(schema.artists).values({ name: s.artist });
          artistRows = await db
            .select()
            .from(schema.artists)
            .where(eq(schema.artists.name, s.artist))
            .limit(1);
        }
        await db.insert(schema.shows).values({
          artist: s.artist,
          artistId: artistRows[0]?.id ?? null,
          origin: "manual",
          title: s.title,
          eventDate: s.event_date,
          endDate: s.end_date ?? null,
          venue: s.venue,
          doorsTime: s.doors_time ?? null,
          startTime: s.start_time ?? null,
          ticketSaleAt: s.ticket_sale_at ?? null,
          status: s.status,
          link: s.link,
          memo: s.memo,
        });
        count += 1;
      }
      ctx.invalidateQueries();
      return { seeded: count };
    },
  }),
} satisfies ActionsModule;
