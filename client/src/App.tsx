import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type Show = ApiResponse<typeof api, "listShows">["shows"][number];
type Status = Show["status"];
type Artist = ApiResponse<typeof api, "listArtists">["artists"][number];

const STATUS_META: Record<Status, { label: string; bg: string; fg: string }> = {
  got: { label: "取得済み", bg: "#e8442e", fg: "#ffffff" },
  interested: { label: "気になる", bg: "#2f5d8a", fg: "#ffffff" },
  waiting: { label: "チケット発売待ち", bg: "#b98a1c", fg: "#ffffff" },
  skipped: { label: "見送り", bg: "#8a8578", fg: "#ffffff" },
};
const STATUS_ORDER: Status[] = ["got", "interested", "waiting", "skipped"];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseDate(s: string): Date {
  const [y = 1970, m = 1, d = 1] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weekday(s: string): string {
  return WEEKDAYS[parseDate(s).getDay()] ?? "";
}

function daysUntil(dateStr: string, fromStr: string): number {
  const a = parseDate(dateStr).getTime();
  const b = parseDate(fromStr).getTime();
  return Math.round((a - b) / 86400000);
}

function fmtSale(iso: string): string {
  const [datePart = "", timePart = ""] = iso.split("T");
  const [, m = "", d = ""] = datePart.split("-");
  return `${Number(m)}/${Number(d)}(${weekday(datePart)}) ${timePart}`;
}

function fmtFetched(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function isEnded(show: Show, today: string): boolean {
  return (show.end_date ?? show.event_date) < today;
}

type FormState = {
  artist: string;
  title: string;
  event_date: string;
  end_date: string;
  venue: string;
  doors_time: string;
  start_time: string;
  ticket_sale_at: string;
  status: Status;
  link: string;
  memo: string;
};

const EMPTY_FORM: FormState = {
  artist: "",
  title: "",
  event_date: "",
  end_date: "",
  venue: "",
  doors_time: "",
  start_time: "",
  ticket_sale_at: "",
  status: "interested",
  link: "",
  memo: "",
};

function formFromShow(s: Show): FormState {
  return {
    artist: s.artist,
    title: s.title,
    event_date: s.event_date,
    end_date: s.end_date ?? "",
    venue: s.venue,
    doors_time: s.doors_time ?? "",
    start_time: s.start_time ?? "",
    ticket_sale_at: s.ticket_sale_at ?? "",
    status: s.status,
    link: s.link,
    memo: s.memo,
  };
}

function formPayload(f: FormState) {
  return {
    artist: f.artist.trim(),
    title: f.title.trim(),
    event_date: f.event_date,
    end_date: f.end_date ? f.end_date : null,
    venue: f.venue.trim(),
    doors_time: f.doors_time ? f.doors_time : null,
    start_time: f.start_time ? f.start_time : null,
    ticket_sale_at: f.ticket_sale_at ? f.ticket_sale_at : null,
    status: f.status,
    link: f.link.trim(),
    memo: f.memo,
  };
}

type ArtistFormState = {
  name: string;
  official_url: string;
  search_keyword: string;
  memo: string;
};

const EMPTY_ARTIST_FORM: ArtistFormState = {
  name: "",
  official_url: "",
  search_keyword: "",
  memo: "",
};

function artistFormFrom(a: Artist): ArtistFormState {
  return {
    name: a.name,
    official_url: a.official_url,
    search_keyword: a.search_keyword,
    memo: a.memo,
  };
}

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";
const labelCls = "block text-sm font-bold text-[var(--text)] mb-1";

export function App() {
  const queryClient = useQueryClient();
  const today = todayJst();

  const showsQuery = useQuery({
    queryKey: ["shows"],
    queryFn: () => api.listShows({}),
  });
  const artistsQuery = useQuery({
    queryKey: ["artists"],
    queryFn: () => api.listArtists({}),
  });

  const [artistFilter, setArtistFilter] = useState<string>("すべて");
  const [selectedStatuses, setSelectedStatuses] = useState<Status[]>([]);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string>("");

  const [editingArtistId, setEditingArtistId] = useState<number | null>(null);
  const [addingArtist, setAddingArtist] = useState(false);
  const [artistForm, setArtistForm] =
    useState<ArtistFormState>(EMPTY_ARTIST_FORM);
  const [artistFormError, setArtistFormError] = useState<string>("");
  const [confirmDeleteArtistId, setConfirmDeleteArtistId] = useState<
    number | null
  >(null);

  // Auto-fetch watch: while set, poll until every watched artist reports a
  // last_fetched_at at or after `since` (or a 6-minute timeout).
  const [fetchWatch, setFetchWatch] = useState<{
    ids: number[];
    since: number;
  } | null>(null);
  const [fetchDone, setFetchDone] = useState(false);

  const invalidateShows = () =>
    queryClient.invalidateQueries({ queryKey: ["shows"] });
  const invalidateArtists = () =>
    queryClient.invalidateQueries({ queryKey: ["artists"] });
  const invalidateAll = () => {
    invalidateShows();
    invalidateArtists();
  };

  useEffect(() => {
    if (!statusMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        statusMenuRef.current &&
        !statusMenuRef.current.contains(e.target as Node)
      ) {
        setStatusMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStatusMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!fetchWatch) return;
    const iv = setInterval(() => {
      invalidateShows();
      invalidateArtists();
    }, 15000);
    const timeout = setTimeout(() => setFetchWatch(null), 6 * 60 * 1000);
    return () => {
      clearInterval(iv);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWatch]);

  const registeredArtists = useMemo(
    () => artistsQuery.data?.artists ?? [],
    [artistsQuery.data],
  );

  useEffect(() => {
    if (!fetchWatch) return;
    const done = fetchWatch.ids.every((id) => {
      const a = registeredArtists.find((x) => x.id === id);
      return (
        a?.last_fetched_at != null &&
        Date.parse(a.last_fetched_at) >= fetchWatch.since - 5000
      );
    });
    if (done) {
      setFetchWatch(null);
      setFetchDone(true);
      invalidateAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWatch, registeredArtists]);

  const startWatch = (ids: number[]) => {
    if (ids.length === 0) return;
    setFetchDone(false);
    setFetchWatch({ ids, since: Date.now() });
  };

  const addMutation = useMutation({
    mutationFn: async (f: FormState) => await api.addShow(formPayload(f)),
    onSuccess: () => {
      invalidateShows();
      setAdding(false);
      setForm(EMPTY_FORM);
    },
  });
  const updateMutation = useMutation({
    mutationFn: async (input: { id: number; f: FormState }) =>
      await api.updateShow({ id: input.id, ...formPayload(input.f) }),
    onSuccess: () => {
      invalidateShows();
      setEditingId(null);
    },
  });
  const statusMutation = useMutation({
    mutationFn: async (input: { show: Show; status: Status }) =>
      await api.updateShow({
        id: input.show.id,
        artist: input.show.artist,
        title: input.show.title,
        event_date: input.show.event_date,
        end_date: input.show.end_date,
        venue: input.show.venue,
        doors_time: input.show.doors_time,
        start_time: input.show.start_time,
        ticket_sale_at: input.show.ticket_sale_at,
        status: input.status,
        link: input.show.link,
        memo: input.show.memo,
      }),
    onSuccess: invalidateShows,
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => await api.deleteShow({ id }),
    onSuccess: () => {
      invalidateShows();
      setConfirmDeleteId(null);
      setEditingId(null);
    },
  });

  const addArtistMutation = useMutation({
    mutationFn: async (f: ArtistFormState) =>
      await api.addArtist({
        name: f.name.trim(),
        official_url: f.official_url.trim(),
        search_keyword: f.search_keyword.trim(),
        memo: f.memo,
      }),
    onSuccess: (res) => {
      invalidateAll();
      setAddingArtist(false);
      setArtistForm(EMPTY_ARTIST_FORM);
      if (res.fetch_started) startWatch([res.id]);
    },
    onError: (e) => {
      setArtistFormError(
        e instanceof Error ? e.message : "登録に失敗しました。",
      );
    },
  });
  const updateArtistMutation = useMutation({
    mutationFn: async (input: { id: number; f: ArtistFormState }) =>
      await api.updateArtist({
        id: input.id,
        name: input.f.name.trim(),
        official_url: input.f.official_url.trim(),
        search_keyword: input.f.search_keyword.trim(),
        memo: input.f.memo,
      }),
    onSuccess: () => {
      invalidateAll();
      setEditingArtistId(null);
    },
    onError: (e) => {
      setArtistFormError(
        e instanceof Error ? e.message : "保存に失敗しました。",
      );
    },
  });
  const deleteArtistMutation = useMutation({
    mutationFn: async (id: number) => await api.deleteArtist({ id }),
    onSuccess: (_res, id) => {
      invalidateAll();
      setConfirmDeleteArtistId(null);
      setEditingArtistId(null);
      const deleted = registeredArtists.find((a) => a.id === id);
      if (deleted && artistFilter === deleted.name) setArtistFilter("すべて");
    },
  });
  const refreshMutation = useMutation({
    mutationFn: async (artistId?: number) =>
      await api.refreshShows(artistId ? { artist_id: artistId } : {}),
    onSuccess: (_res, artistId) => {
      startWatch(
        artistId ? [artistId] : registeredArtists.map((a) => a.id),
      );
    },
  });

  const shows = useMemo(() => showsQuery.data?.shows ?? [], [showsQuery.data]);

  const filterArtists = useMemo(() => {
    const seen: string[] = [];
    for (const a of registeredArtists) if (!seen.includes(a.name)) seen.push(a.name);
    for (const s of shows) if (!seen.includes(s.artist)) seen.push(s.artist);
    return seen;
  }, [registeredArtists, shows]);

  const nextShow = useMemo(() => {
    const upcoming = shows.filter(
      (s) => !isEnded(s, today) && s.status !== "skipped",
    );
    return upcoming[0] ?? null;
  }, [shows, today]);

  const upcomingSales = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    const nowLocal = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
    return shows.filter(
      (s) =>
        s.ticket_sale_at != null &&
        s.ticket_sale_at > nowLocal &&
        s.status !== "skipped" &&
        s.status !== "got",
    );
  }, [shows]);

  // The same show can be fetched twice with title wording variants (e.g.
  // with/without the artist name prefix). For the sale alert, collapse
  // entries that share sale datetime + artist + venue into one, keeping
  // the shortest (usually cleanest) title.
  const dedupedSales = useMemo(() => {
    const byKey = new Map<string, Show>();
    for (const s of upcomingSales) {
      const key = `${s.ticket_sale_at}|${s.artist}|${s.venue}`;
      const existing = byKey.get(key);
      if (!existing || s.title.length < existing.title.length) {
        byKey.set(key, s);
      }
    }
    return [...byKey.values()].sort((a, b) =>
      (a.ticket_sale_at ?? "").localeCompare(b.ticket_sale_at ?? ""),
    );
  }, [upcomingSales]);

  // Ended shows are never shown: the user does not look at past shows.
  const upcomingShows = useMemo(
    () => shows.filter((s) => !isEnded(s, today)),
    [shows, today],
  );

  const allStatusesSelected =
    selectedStatuses.length === 0 ||
    selectedStatuses.length === STATUS_ORDER.length;

  const statusButtonLabel = allStatusesSelected
    ? "ステータス：すべて"
    : selectedStatuses.length === 1
      ? `ステータス：${STATUS_META[selectedStatuses[0] as Status].label}`
      : `ステータス：${STATUS_META[selectedStatuses[0] as Status].label}＋${selectedStatuses.length - 1}件`;

  const toggleStatus = (st: Status) => {
    setSelectedStatuses((prev) =>
      prev.includes(st) ? prev.filter((x) => x !== st) : [...prev, st],
    );
  };

  const visible = useMemo(() => {
    let list = upcomingShows.filter((s) => {
      if (artistFilter !== "すべて" && s.artist !== artistFilter) return false;
      if (!allStatusesSelected && !selectedStatuses.includes(s.status))
        return false;
      return true;
    });
    list = [...list].sort((a, b) =>
      sortAsc
        ? a.event_date.localeCompare(b.event_date) || a.id - b.id
        : b.event_date.localeCompare(a.event_date) || b.id - a.id,
    );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingShows, artistFilter, selectedStatuses, allStatusesSelected, sortAsc]);

  const submitForm = (e: FormEvent) => {
    e.preventDefault();
    if (!form.artist.trim()) return setFormError("アーティスト名を入力してください。");
    if (!form.title.trim()) return setFormError("公演名を入力してください。");
    if (!form.event_date) return setFormError("日付を選んでください。");
    if (form.end_date && form.end_date < form.event_date)
      return setFormError("終了日は開始日以降にしてください。");
    setFormError("");
    if (editingId != null) {
      updateMutation.mutate({ id: editingId, f: form });
    } else {
      addMutation.mutate(form);
    }
  };

  const startEdit = (s: Show) => {
    setAdding(false);
    setEditingId(s.id);
    setForm(formFromShow(s));
    setFormError("");
    setConfirmDeleteId(null);
  };

  const startAdd = () => {
    setEditingId(null);
    setAdding(true);
    setForm({
      ...EMPTY_FORM,
      artist: artistFilter !== "すべて" ? artistFilter : "",
    });
    setFormError("");
  };

  const formOpen = adding || editingId != null;

  const submitArtistForm = (e: FormEvent) => {
    e.preventDefault();
    if (!artistForm.name.trim())
      return setArtistFormError("アーティスト名を入力してください。");
    setArtistFormError("");
    if (editingArtistId != null) {
      updateArtistMutation.mutate({ id: editingArtistId, f: artistForm });
    } else {
      addArtistMutation.mutate(artistForm);
    }
  };

  const startAddArtist = () => {
    setTab("artists");
    setEditingArtistId(null);
    setAddingArtist(true);
    setArtistForm(EMPTY_ARTIST_FORM);
    setArtistFormError("");
    setConfirmDeleteArtistId(null);
  };

  const startEditArtist = (a: Artist) => {
    setTab("artists");
    setAddingArtist(false);
    setEditingArtistId(a.id);
    setArtistForm(artistFormFrom(a));
    setArtistFormError("");
    setConfirmDeleteArtistId(null);
  };

  const artistFormOpen = addingArtist || editingArtistId != null;
  const fetchingNow = fetchWatch != null;

  // UI layout: shows are the main view; artist management lives in its own
  // tab so the show list is reachable without scrolling.
  const [tab, setTab] = useState<"shows" | "artists">("shows");
  const [nextExpanded, setNextExpanded] = useState(false);
  const [salesExpanded, setSalesExpanded] = useState(false);

  const renderArtistForm = () => (
    <form
      onSubmit={submitArtistForm}
      className="mt-3 rounded-2xl border-2 border-[var(--text)] bg-[var(--surface)] p-4 shadow-[4px_4px_0_var(--text)]"
      aria-label={editingArtistId != null ? "アーティストを編集" : "アーティストを登録"}
    >
      <h3
        className="text-lg font-black text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {editingArtistId != null ? "アーティストを編集" : "アーティストを登録"}
      </h3>
      <div className="mt-3 grid gap-3">
        <div>
          <label htmlFor="a-name" className={labelCls}>アーティスト名 *</label>
          <input
            id="a-name"
            className={inputCls}
            value={artistForm.name}
            onChange={(e) =>
              setArtistForm({ ...artistForm, name: e.target.value })
            }
            placeholder="例：上原ひろみ"
          />
        </div>
        <div>
          <label htmlFor="a-url" className={labelCls}>公式サイトURL</label>
          <input
            id="a-url"
            type="url"
            inputMode="url"
            className={inputCls}
            value={artistForm.official_url}
            onChange={(e) =>
              setArtistForm({ ...artistForm, official_url: e.target.value })
            }
            placeholder="https://…"
          />
        </div>
        <div>
          <label htmlFor="a-keyword" className={labelCls}>検索用キーワード</label>
          <input
            id="a-keyword"
            className={inputCls}
            value={artistForm.search_keyword}
            onChange={(e) =>
              setArtistForm({ ...artistForm, search_keyword: e.target.value })
            }
            placeholder="例：Hiromi Uehara ライブ 2026"
          />
          <p className="mt-1 text-xs text-[var(--dim)]">
            自動取得の検索に使う補助キーワードです。英語表記などを入れておくと見つけやすくなります。
          </p>
        </div>
        <div>
          <label htmlFor="a-memo" className={labelCls}>メモ</label>
          <textarea
            id="a-memo"
            className={inputCls}
            rows={2}
            value={artistForm.memo}
            onChange={(e) =>
              setArtistForm({ ...artistForm, memo: e.target.value })
            }
          />
        </div>
      </div>
      {artistFormError && (
        <p className="mt-3 text-sm font-bold text-[var(--accent)]" role="alert">
          {artistFormError}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={addArtistMutation.isPending || updateArtistMutation.isPending}
          className="rounded-full bg-[var(--accent)] px-5 py-2 font-bold text-white disabled:opacity-50"
        >
          {editingArtistId != null ? "保存する" : "登録して取得を開始"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAddingArtist(false);
            setEditingArtistId(null);
          }}
          className="rounded-full border border-[var(--border)] px-5 py-2 font-bold text-[var(--text)]"
        >
          キャンセル
        </button>
        {editingArtistId != null &&
          (confirmDeleteArtistId === editingArtistId ? (
            <button
              type="button"
              onClick={() => deleteArtistMutation.mutate(editingArtistId)}
              disabled={deleteArtistMutation.isPending}
              className="ml-auto rounded-full bg-[#17181c] px-5 py-2 font-bold text-white disabled:opacity-50"
            >
              公演ごと本当に削除する
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDeleteArtistId(editingArtistId)}
              className="ml-auto rounded-full border border-[#17181c] px-5 py-2 font-bold text-[var(--text)]"
            >
              削除
            </button>
          ))}
      </div>
      {editingArtistId != null && (
        <p className="mt-2 text-xs text-[var(--dim)]">
          削除すると、このアーティストの公演もすべて削除されます。再登録しても自動では戻りません。
        </p>
      )}
    </form>
  );

  const renderForm = () => (
    <form
      onSubmit={submitForm}
      className="rounded-2xl border-2 border-[var(--text)] bg-[var(--surface)] p-4 shadow-[4px_4px_0_var(--text)]"
      aria-label={editingId != null ? "公演を編集" : "公演を手動で追加"}
    >
      <h2
        className="text-lg font-black text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {editingId != null ? "公演を編集" : "公演を手動で追加"}
      </h2>
      {editingId == null && (
        <p className="mt-1 text-sm text-[var(--dim)]">
          公演は通常、登録アーティストから自動で取得されます。自動取得で見つからなかった公演の補足用です。
        </p>
      )}
      <div className="mt-3 grid gap-3">
        <div>
          <label htmlFor="f-artist" className={labelCls}>アーティスト *</label>
          <input
            id="f-artist"
            className={inputCls}
            value={form.artist}
            onChange={(e) => setForm({ ...form, artist: e.target.value })}
            list="artist-suggestions"
            placeholder="例：上原ひろみ"
          />
          <datalist id="artist-suggestions">
            {filterArtists.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="f-title" className={labelCls}>公演名／ツアー名 *</label>
          <input
            id="f-title"
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="例：Duoツアー"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-date" className={labelCls}>日付 *</label>
            <input
              id="f-date"
              type="date"
              className={inputCls}
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="f-end" className={labelCls}>終了日（期間公演）</label>
            <input
              id="f-end"
              type="date"
              className={inputCls}
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label htmlFor="f-venue" className={labelCls}>会場</label>
          <input
            id="f-venue"
            className={inputCls}
            value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
            placeholder="例：東京ドーム"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-doors" className={labelCls}>開場</label>
            <input
              id="f-doors"
              type="time"
              className={inputCls}
              value={form.doors_time}
              onChange={(e) => setForm({ ...form, doors_time: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="f-start" className={labelCls}>開演</label>
            <input
              id="f-start"
              type="time"
              className={inputCls}
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-sale" className={labelCls}>チケット発売日時</label>
            <input
              id="f-sale"
              type="datetime-local"
              className={inputCls}
              value={form.ticket_sale_at}
              onChange={(e) =>
                setForm({ ...form, ticket_sale_at: e.target.value })
              }
            />
          </div>
          <div>
            <label htmlFor="f-status" className={labelCls}>ステータス</label>
            <select
              id="f-status"
              className={inputCls}
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as Status })
              }
            >
              {STATUS_ORDER.map((st) => (
                <option key={st} value={st}>
                  {STATUS_META[st].label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="f-link" className={labelCls}>公式リンク</label>
          <input
            id="f-link"
            type="url"
            inputMode="url"
            className={inputCls}
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
            placeholder="https://…"
          />
        </div>
        <div>
          <label htmlFor="f-memo" className={labelCls}>メモ</label>
          <textarea
            id="f-memo"
            className={inputCls}
            rows={3}
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
          />
        </div>
      </div>
      {formError && (
        <p className="mt-3 text-sm font-bold text-[var(--accent)]" role="alert">
          {formError}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={addMutation.isPending || updateMutation.isPending}
          className="rounded-full bg-[var(--accent)] px-5 py-2 font-bold text-white disabled:opacity-50"
        >
          {editingId != null ? "保存する" : "追加する"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            setEditingId(null);
          }}
          className="rounded-full border border-[var(--border)] px-5 py-2 font-bold text-[var(--text)]"
        >
          キャンセル
        </button>
        {editingId != null &&
          (confirmDeleteId === editingId ? (
            <button
              type="button"
              onClick={() => deleteMutation.mutate(editingId)}
              disabled={deleteMutation.isPending}
              className="ml-auto rounded-full bg-[#17181c] px-5 py-2 font-bold text-white disabled:opacity-50"
            >
              本当に削除する
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDeleteId(editingId)}
              className="ml-auto rounded-full border border-[#17181c] px-5 py-2 font-bold text-[var(--text)]"
            >
              削除
            </button>
          ))}
      </div>
    </form>
  );

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto max-w-3xl px-3 pb-10">
        {/* Next show: compact one-line strip (tap to expand details) */}
        {nextShow && (
          <section aria-label="次のライブ" className="mt-2">
            <button
              type="button"
              onClick={() => setNextExpanded((v) => !v)}
              aria-expanded={nextExpanded}
              className="flex w-full items-center gap-2 rounded-full bg-[#17181c] py-1.5 pl-1.5 pr-3 text-left text-[#f7f4ee]"
            >
              <span className="flex shrink-0 items-baseline gap-1 rounded-full bg-[var(--accent)] px-2.5 py-1 text-white">
                <span className="text-[10px] font-bold tracking-widest">NEXT</span>
                <span
                  className="text-sm font-black leading-none"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {Number(nextShow.event_date.split("-")[1] ?? 0)}/{Number(nextShow.event_date.split("-")[2] ?? 0)}
                </span>
                <span className="text-[10px] font-bold">
                  ({weekday(nextShow.event_date)})
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold text-[#ffb3a7]">
                あと{daysUntil(nextShow.event_date, today)}日
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-black">{nextShow.artist}</span>
                {" - "}
                {nextShow.title}
              </span>
              <span className="shrink-0 text-xs text-[#c9c4b8]" aria-hidden="true">
                {nextExpanded ? "▴" : "▾"}
              </span>
            </button>
            {nextExpanded && (
              <div className="mt-1 rounded-2xl bg-[#17181c] px-4 py-2.5 text-sm text-[#f7f4ee]">
                <p>
                  {nextShow.venue}
                  {nextShow.doors_time ? ` ／ 開場 ${nextShow.doors_time}` : ""}
                  {nextShow.start_time ? ` ／ 開演 ${nextShow.start_time}` : ""}
                </p>
                {nextShow.end_date && (
                  <p className="text-[#c9c4b8]">
                    期間：〜{Number(nextShow.end_date.split("-")[1] ?? 0)}/{Number(nextShow.end_date.split("-")[2] ?? 0)}
                  </p>
                )}
                {nextShow.ticket_sale_at && (
                  <p className="text-[#c9c4b8]">
                    チケット発売：{fmtSale(nextShow.ticket_sale_at)}
                  </p>
                )}
                {nextShow.memo && (
                  <p className="mt-1 whitespace-pre-wrap text-[#c9c4b8]">{nextShow.memo}</p>
                )}
                <div className="mt-2 flex gap-2">
                  {nextShow.link && (
                    <a
                      href={nextShow.link}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-[#c9c4b8] px-3 py-1 text-xs font-bold text-[#f7f4ee]"
                    >
                      公式ページ ↗
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(nextShow)}
                    className="rounded-full border border-[#c9c4b8] px-3 py-1 text-xs font-bold text-[#f7f4ee]"
                  >
                    編集
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Upcoming ticket sales: one-line alert bar, nearest only */}
        {dedupedSales.length > 0 && (
          <section aria-label="発売が近いチケット" className="mt-1.5">
            <button
              type="button"
              onClick={() => setSalesExpanded((v) => !v)}
              aria-expanded={salesExpanded}
              className="flex w-full items-center gap-2 rounded-full border border-[#b98a1c] bg-[var(--surface)] px-3 py-1.5 text-left"
            >
              <span className="shrink-0 text-xs font-black text-[#8a650f]">
                まもなく発売
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--text)]">
                <span className="font-bold">
                  {dedupedSales[0]?.ticket_sale_at ? fmtSale(dedupedSales[0].ticket_sale_at) : ""}
                </span>
                {" — "}
                {dedupedSales[0]?.artist}「{dedupedSales[0]?.title}」
              </span>
              {dedupedSales.length > 1 && (
                <span className="shrink-0 text-xs font-bold text-[#8a650f]">
                  他{dedupedSales.length - 1}件
                </span>
              )}
              <span className="shrink-0 text-xs text-[var(--dim)]" aria-hidden="true">
                {salesExpanded ? "▴" : "▾"}
              </span>
            </button>
            {salesExpanded && (
              <ul className="mt-1 space-y-1 rounded-2xl border border-[#b98a1c] bg-[var(--surface)] px-3 py-2">
                {dedupedSales.map((s) => (
                  <li key={s.id} className="text-xs text-[var(--text)]">
                    <span className="font-bold">
                      {s.ticket_sale_at ? fmtSale(s.ticket_sale_at) : ""}
                    </span>
                    {" — "}
                    {s.artist}「{s.title}」
                    {s.venue ? ` ／ ${s.venue}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Tabs: shows first, artist management second */}
        <div
          className="sticky top-0 z-20 -mx-3 mt-2 bg-[var(--bg)] px-3 py-1.5"
          role="tablist"
          aria-label="表示切り替え"
        >
          <div className="flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
            <button
              role="tab"
              aria-selected={tab === "shows"}
              onClick={() => setTab("shows")}
              className={`flex-1 rounded-full py-1.5 text-sm font-black ${
                tab === "shows"
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "text-[var(--dim)]"
              }`}
              style={{ fontFamily: "var(--font-display)" }}
            >
              ライブ一覧
              {upcomingShows.length > 0 ? ` (${upcomingShows.length})` : ""}
            </button>
            <button
              role="tab"
              aria-selected={tab === "artists"}
              onClick={() => setTab("artists")}
              className={`flex-1 rounded-full py-1.5 text-sm font-black ${
                tab === "artists"
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "text-[var(--dim)]"
              }`}
              style={{ fontFamily: "var(--font-display)" }}
            >
              アーティスト
              {registeredArtists.length > 0 ? ` (${registeredArtists.length})` : ""}
              {fetchingNow ? " ・取得中" : ""}
            </button>
          </div>
        </div>

        {tab === "artists" && (
        <>
        {/* Registered artists + auto-fetch */}
        <section aria-label="登録アーティスト" className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-[var(--dim)]">
              ライブ情報は毎日自動取得。新規登録で初回取得が始まります。
            </p>
            <button
              onClick={() => refreshMutation.mutate(undefined)}
              disabled={refreshMutation.isPending || fetchingNow || registeredArtists.length === 0}
              className="ml-auto rounded-full bg-[var(--text)] px-3 py-1.5 text-xs font-bold text-[var(--bg)] disabled:opacity-50"
            >
              {fetchingNow ? "取得中…" : "今すぐ更新"}
            </button>
          </div>
          {fetchingNow && (
            <p className="mt-1.5 text-xs font-bold text-[var(--text)]" role="status">
              ライブ情報を取得しています。反映まで数分かかることがあります…
            </p>
          )}
          {fetchDone && !fetchingNow && (
            <p className="mt-1.5 text-xs font-bold text-[var(--text)]" role="status">
              更新が完了しました。
            </p>
          )}
          {refreshMutation.isError && (
            <p className="mt-1.5 text-xs font-bold text-[var(--accent)]" role="alert">
              更新を開始できませんでした。時間をおいて再度お試しください。
            </p>
          )}
          {artistsQuery.isPending && (
            <p className="py-3 text-sm text-[var(--dim)]">読み込み中…</p>
          )}
          {artistsQuery.data && registeredArtists.length === 0 && !artistFormOpen && (
            <p className="py-3 text-sm text-[var(--dim)]">
              まだアーティストが登録されていません。下のボタンから登録してください。
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {registeredArtists.map((a) => {
              const count = upcomingShows.filter(
                (s) => s.artist_id === a.id || s.artist === a.name,
              ).length;
              const isFetchingThis =
                fetchWatch != null && fetchWatch.ids.includes(a.id);
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">
                      <span className="font-bold">{a.name}</span>
                      <span className="text-xs text-[var(--dim)]">
                        {" ／ "}公演 {count} 件{" ／ "}
                        {a.last_fetched_at
                          ? `最終取得 ${fmtFetched(a.last_fetched_at)}`
                          : "未取得"}
                        {isFetchingThis ? " ／ 取得中…" : ""}
                      </span>
                    </p>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => refreshMutation.mutate(a.id)}
                        disabled={refreshMutation.isPending || fetchingNow}
                        className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-bold text-[var(--text)] disabled:opacity-50"
                      >
                        更新
                      </button>
                      <button
                        onClick={() => startEditArtist(a)}
                        className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-bold text-[var(--text)]"
                      >
                        編集
                      </button>
                      {a.official_url && (
                        <a
                          href={a.official_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-[var(--border)] px-2.5 py-1 text-center text-xs font-bold text-[var(--text)]"
                        >
                          公式 ↗
                        </a>
                      )}
                    </div>
                  </div>
                  {(a.search_keyword || a.memo) && (
                    <p className="mt-0.5 truncate text-xs text-[var(--dim)]">
                      {a.search_keyword ? `検索キーワード：${a.search_keyword}` : ""}
                      {a.search_keyword && a.memo ? " ／ " : ""}
                      {a.memo}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {artistFormOpen ? (
            renderArtistForm()
          ) : (
            <button
              onClick={startAddArtist}
              className="mt-2 w-full rounded-xl border-2 border-dashed border-[var(--dim)] bg-transparent py-2.5 text-sm font-bold text-[var(--text)]"
            >
              ＋ アーティストを登録
            </button>
          )}
        </section>
        </>
        )}

        {tab === "shows" && (
        <>
        {/* Filters (sticky under the tab bar): each chip group is a
            single horizontally scrolling row so the list starts high.
            The selected chip sticks to the left edge while scrolling,
            so the active filter is always visible. */}
        <section
          aria-label="絞り込み"
          className="sticky top-[52px] z-10 -mx-3 bg-[var(--bg)] px-3 py-1.5"
        >
          <div
            className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="アーティストで絞り込み"
          >
            {["すべて", ...filterArtists].map((a) => {
              const selected = artistFilter === a;
              return (
                <button
                  key={a}
                  onClick={() => setArtistFilter(a)}
                  aria-pressed={selected}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${
                    selected
                      ? "sticky left-0 z-10 bg-[var(--accent)] text-white shadow"
                      : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                  }`}
                >
                  {a}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="relative min-w-0 flex-1" ref={statusMenuRef}>
              <button
                type="button"
                onClick={() => setStatusMenuOpen((v) => !v)}
                aria-expanded={statusMenuOpen}
                aria-haspopup="true"
                aria-label="ステータスで絞り込み"
                className={`flex w-full items-center justify-between gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                  allStatusesSelected
                    ? "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                    : "bg-[var(--text)] text-[var(--bg)]"
                }`}
              >
                <span className="min-w-0 truncate">{statusButtonLabel}</span>
                <span aria-hidden="true" className="shrink-0 text-[10px]">
                  {statusMenuOpen ? "▴" : "▾"}
                </span>
              </button>
              {statusMenuOpen && (
                <div
                  role="group"
                  aria-label="ステータスを選択"
                  className="absolute left-0 top-full z-30 mt-1 w-56 max-w-[80vw] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg"
                >
                  {STATUS_ORDER.map((st) => {
                    const checked =
                      allStatusesSelected || selectedStatuses.includes(st);
                    // When all are shown via empty selection, checking
                    // state reads as all-checked; toggling one off from
                    // that state selects only the others.
                    return (
                      <label
                        key={st}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (
                              selectedStatuses.length === 0 ||
                              selectedStatuses.length === STATUS_ORDER.length
                            ) {
                              setSelectedStatuses(
                                STATUS_ORDER.filter((x) => x !== st),
                              );
                            } else {
                              toggleStatus(st);
                            }
                          }}
                          className="h-4 w-4 shrink-0"
                        />
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: STATUS_META[st].bg }}
                          aria-hidden="true"
                        />
                        <span className="font-bold">{STATUS_META[st].label}</span>
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setSelectedStatuses([])}
                    className="mt-1 w-full rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--text)]"
                  >
                    すべてに戻す（クリア）
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setSortAsc((v) => !v)}
              aria-label={sortAsc ? "日付の新しい順に切り替え" : "日付の古い順に切り替え"}
              className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--text)]"
            >
              日付 {sortAsc ? "↑ 古い順" : "↓ 新しい順"}
            </button>
          </div>
        </section>


        {/* Show form (edit / manual add) — the add button itself sits
            below the list so the first card stays in the first view */}
        {formOpen && <div className="mt-2">{renderForm()}</div>}

        {/* List */}
        <section aria-label="公演リスト" className="mt-2">
          {showsQuery.isPending && (
            <p className="py-8 text-center text-sm text-[var(--dim)]">読み込み中…</p>
          )}
          {showsQuery.error && (
            <p className="py-8 text-center text-sm text-[var(--accent)]" role="alert">
              読み込みに失敗しました。再度開いてください。
            </p>
          )}
          {showsQuery.data && visible.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--dim)]">
              条件に合う公演がありません。
            </p>
          )}
          <ul className="space-y-2">
            {visible.map((s) => {
              const ended = isEnded(s, today);
              const meta = STATUS_META[s.status];
              const [, mm = "", dd = ""] = s.event_date.split("-");
              return (
                <li
                  key={s.id}
                  className={`overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${
                    ended ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-stretch">
                    <div className="flex w-16 shrink-0 flex-col items-center justify-center border-r-2 border-dashed border-[var(--border)] py-2">
                      <span className="text-xs font-bold text-[var(--dim)]">
                        {Number(mm)}月
                      </span>
                      <span
                        className="text-2xl font-black leading-none text-[var(--text)]"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {Number(dd)}
                      </span>
                      <span className="mt-0.5 text-xs font-bold text-[var(--dim)]">
                        ({weekday(s.event_date)})
                      </span>
                      {ended && (
                        <span className="mt-1 rounded bg-[var(--text)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--bg)]">
                          終了
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold tracking-wide text-[var(--dim)]">
                            {s.artist}
                            {s.origin === "auto" && (
                              <span className="ml-1.5 rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text)]">
                                自動取得
                              </span>
                            )}
                          </p>
                          <h3 className="truncate text-base font-bold text-[var(--text)]">
                            {s.title}
                          </h3>
                        </div>
                        <label className="shrink-0">
                          <span className="sr-only">{`${s.title}のステータス`}</span>
                          <select
                            aria-label={`${s.title}のステータス`}
                            value={s.status}
                            onChange={(e) =>
                              statusMutation.mutate({
                                show: s,
                                status: e.target.value as Status,
                              })
                            }
                            className="rounded-full px-2 py-1 text-xs font-bold"
                            style={{ backgroundColor: meta.bg, color: meta.fg }}
                          >
                            {STATUS_ORDER.map((st) => (
                              <option key={st} value={st}>
                                {STATUS_META[st].label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="mt-1 text-sm text-[var(--text)]">
                        {s.venue}
                        {s.end_date ? ` ／ 〜${Number(s.end_date.split("-")[1] ?? 0)}/${Number(s.end_date.split("-")[2] ?? 0)}` : ""}
                      </p>
                      {(s.doors_time || s.start_time) && (
                        <p className="text-sm text-[var(--dim)]">
                          {s.doors_time ? `開場 ${s.doors_time}` : ""}
                          {s.doors_time && s.start_time ? " ／ " : ""}
                          {s.start_time ? `開演 ${s.start_time}` : ""}
                        </p>
                      )}
                      {s.ticket_sale_at && (
                        <p className="text-sm text-[var(--dim)]">
                          チケット発売：{fmtSale(s.ticket_sale_at)}
                        </p>
                      )}
                      {s.memo && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--dim)]">
                          {s.memo}
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        {s.link && (
                          <a
                            href={s.link}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--text)]"
                          >
                            公式ページ ↗
                          </a>
                        )}
                        <button
                          onClick={() => startEdit(s)}
                          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--text)]"
                        >
                          編集
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {!formOpen && (
          <button
            onClick={startAdd}
            className="mt-3 w-full rounded-xl border-2 border-dashed border-[var(--dim)] bg-transparent py-2.5 text-sm font-bold text-[var(--text)]"
          >
            ＋ 公演を手動で追加
          </button>
        )}
        </>
        )}
      </main>
    </div>
  );
}
