import React, { useState, useMemo, useCallback, useRef, useEffect, startTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ListMusic,
  Loader2,
  Pause,
  Pencil,
  Plus,
  Search,
  Shuffle,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import SampleEditDialog from "@/components/SampleEditDialog";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { useI18n } from "@/contexts/I18nContext";
import { useApp } from "@/contexts/AppContext";
import { toast } from "sonner";
import type { Sample, WaveformData, ExportProgress, SampleFilterSearch, SampleType, SortBy, SortDir } from "@/types";

/* ── String → soft pastel color (deterministic) ── */
function stringToColor(str: string): { bg: string; text: string; border: string } {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return {
    bg: `hsla(${hue}, 45%, 58%, 0.12)`,
    text: `hsl(${hue}, 40%, 68%)`,
    border: `hsla(${hue}, 35%, 52%, 0.22)`,
  };
}

/* ── Format key display ── */
function formatKey(audioKey: string | null, chordType: string | null): string | null {
  if (!audioKey) return null;
  const k = audioKey.charAt(0).toUpperCase() + audioKey.slice(1);
  if (chordType === "minor") return k + "m";
  return k;
}


/* ── Format duration (ms → display) ── */
function formatDuration(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null;
  const totalSecs = Math.round(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "Z"); // SQLite datetime은 UTC
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear().toString().slice(2);
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}.${m}.${day}`;
}

/* ── Instrument keywords ── */
const INSTRUMENT_KEYWORDS = new Set([
  "drums", "snares", "hats", "kicks", "percussion", "cymbals", "toms",
  "tambourine", "shaker", "claps", "congas", "bongos", "rim", "hi-hats",
  "synth", "pads", "leads", "keys", "piano", "organ", "rhodes", "plucks",
  "bass", "sub", "808",
  "guitar", "electric guitar", "acoustic guitar",
  "vocals", "voice", "adlib", "vocal chops",
  "strings", "violin", "cello", "viola",
  "brass", "trumpet", "saxophone", "horn", "flute", "woodwinds",
  "bells", "mallets", "marimba", "xylophone", "vibraphone",
  "fx", "risers", "sweeps", "impacts", "textures", "foley", "noise",
  "grooves", "fills", "tops", "loops",
]);

/* ── Tag / genre / key extraction ── */

function extractMeta(samples: Sample[]) {
  const genres = new Map<string, number>();
  const bpmSet = new Set<number>();
  const keys = new Map<string, number>();
  const tagMap = new Map<string, number>();
  const instMap = new Map<string, number>();

  for (const s of samples) {
    const g = s.genre || s.pack_genre;
    if (g) genres.set(g, (genres.get(g) || 0) + 1);
    if (s.bpm) bpmSet.add(s.bpm);
    const keyStr = formatKey(s.audio_key, s.chord_type);
    if (keyStr) keys.set(keyStr, (keys.get(keyStr) || 0) + 1);
    if (s.tags) {
      for (const raw of s.tags.split(",")) {
        const t = raw.trim();
        if (!t) continue;
        tagMap.set(t, (tagMap.get(t) || 0) + 1);
        if (INSTRUMENT_KEYWORDS.has(t.toLowerCase())) {
          instMap.set(t, (instMap.get(t) || 0) + 1);
        }
      }
    }
  }

  return {
    genres: [...genres.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })),
    allBpms: [...bpmSet].sort((a, b) => a - b),
    keys: [...keys.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, count]) => ({ key, count })),
    tags: [...tagMap.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })),
    instruments: [...instMap.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })),
  };
}

/* ── Apply filters ── */
interface BpmRange { min: number; max: number }

function applyFilters(
  samples: Sample[],
  selectedGenres: Set<string>,
  bpmRange: BpmRange | null,
  selectedKeys: Set<string>,
  sampleType: SampleType,
  selectedInstruments: Set<string>,
  includeTags: Set<string>,
  excludeTags: Set<string>,
  query: string,
): Sample[] {
  let r = samples;

  if (query.length >= 2) {
    const q = query.toLowerCase();
    r = r.filter((s) =>
      s.filename.toLowerCase().includes(q) ||
      (s.pack_name || "").toLowerCase().includes(q) ||
      (s.tags || "").toLowerCase().includes(q)
    );
  }

  if (selectedGenres.size > 0) {
    r = r.filter((s) => {
      const g = s.genre || s.pack_genre;
      return g != null && selectedGenres.has(g);
    });
  }

  if (bpmRange) r = r.filter((s) => s.bpm != null && s.bpm >= bpmRange.min && s.bpm <= bpmRange.max);

  if (selectedKeys.size) {
    r = r.filter((s) => {
      const k = formatKey(s.audio_key, s.chord_type);
      return k != null && selectedKeys.has(k);
    });
  }

  if (sampleType !== "all") {
    r = r.filter((s) => s.sample_type === sampleType);
  }

  if (selectedInstruments.size > 0) {
    r = r.filter((s) => {
      if (!s.tags) return false;
      const st = s.tags.split(",").map((t) => t.trim());
      return st.some((t) => selectedInstruments.has(t));
    });
  }

  if (includeTags.size > 0) {
    r = r.filter((s) => {
      if (!s.tags) return false;
      const st = s.tags.split(",").map((t) => t.trim());
      return st.some((t) => includeTags.has(t));
    });
  }

  if (excludeTags.size > 0) {
    r = r.filter((s) => {
      if (!s.tags) return true;
      const st = s.tags.split(",").map((t) => t.trim());
      return !st.some((t) => excludeTags.has(t));
    });
  }

  return r;
}

/* ── Sort samples ── */
function sortSamples(samples: Sample[], sortBy: SortBy, sortDir: SortDir): Sample[] {
  if (sortBy === "shuffle") {
    const arr = [...samples];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const dir = sortDir === "desc" ? -1 : 1;
  const sorted = [...samples];
  switch (sortBy) {
    case "bpm":
      sorted.sort((a, b) => {
        if (a.bpm == null) return 1;
        if (b.bpm == null) return -1;
        return (a.bpm - b.bpm) * dir;
      });
      break;
    case "duration":
      sorted.sort((a, b) => {
        if (a.duration == null) return 1;
        if (b.duration == null) return -1;
        return (a.duration - b.duration) * dir;
      });
      break;
    case "recent":
      sorted.sort((a, b) => {
        const aDate = a.created_at || "";
        const bDate = b.created_at || "";
        return (bDate.localeCompare(aDate)) * dir;
      });
      break;
    case "filename":
    default:
      sorted.sort((a, b) => a.filename.localeCompare(b.filename) * dir);
      break;
  }
  return sorted;
}

/* ── Drag icon path cache ── */
let _dragIconPath: string | null = null;
async function getDragIcon(): Promise<string> {
  if (!_dragIconPath) {
    _dragIconPath = await invoke<string>("get_drag_icon_path");
  }
  return _dragIconPath;
}

// tauri-plugin-drag callback gives screen coordinates, but the webview needs viewport
// coordinates. Try a few candidate offsets so drag-to-playlist works with/without window chrome.
function getPlaylistDropTargetId(cursorPos: { x: number; y: number }): number | null {
  const x = Number(cursorPos.x);
  const y = Number(cursorPos.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const frameInsetX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const titleInsetY = Math.max(0, window.outerHeight - window.innerHeight - frameInsetX);
  const candidates: Array<[number, number]> = [
    [x - window.screenX, y - window.screenY],
    [x - window.screenX - frameInsetX, y - window.screenY - titleInsetY],
    [x - window.screenX - frameInsetX, y - window.screenY - (window.outerHeight - window.innerHeight)],
  ];

  for (const [cx, cy] of candidates) {
    const node = document.elementFromPoint(cx, cy);
    if (!(node instanceof Element)) continue;
    const target = node.closest<HTMLElement>("[data-playlist-drop-id]");
    if (!target) continue;
    const raw = target.dataset.playlistDropId;
    if (!raw) continue;
    const id = Number(raw);
    if (Number.isFinite(id)) return id;
  }

  return null;
}

/* ── MiniWaveform: debounced + throttled + memory‑cached ── */
interface WaveformCacheEntry {
  peaks: number[];
  colors: [number, number, number][];
}
const waveformMemCache = new Map<string, WaveformCacheEntry>();

/**
 * Cancellable LIFO queue — 동시 요청 1개로 CPU 과부하 방지
 * LIFO: 가장 최근에 추가된(=현재 화면에 보이는) 항목을 우선 처리
 * 컴포넌트 언마운트 시 큐에서 제거 가능
 */
interface _QueueItem {
  fn: () => Promise<void>;
  cancelled: boolean;
}
let _activeReqs = 0;
const _MAX_CONCURRENT = 1;
const _queue: _QueueItem[] = [];

function _processQueue() {
  while (_activeReqs < _MAX_CONCURRENT && _queue.length > 0) {
    const item = _queue.pop()!;          // LIFO: 최근 항목 우선
    if (item.cancelled) continue;        // 취소된 항목 건너뛰기
    _activeReqs++;
    item.fn().finally(() => {
      _activeReqs--;
      // 다음 항목 처리 전 메인스레드에 양보 → UI 블로킹 방지
      setTimeout(_processQueue, 0);
    });
    return; // setTimeout이 다음 처리를 이어가므로 여기서 중단
  }
}

function _enqueue(fn: () => Promise<void>): () => void {
  const item: _QueueItem = { fn, cancelled: false };
  _queue.push(item);
  if (_activeReqs < _MAX_CONCURRENT) _processQueue();
  return () => { item.cancelled = true; };
}

function downsample(peaks: number[], target: number): number[] {
  if (peaks.length <= target) return peaks;
  const ratio = peaks.length / target;
  return Array.from({ length: target }, (_, i) => {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let max = 0;
    for (let j = start; j < end; j++) if (peaks[j] > max) max = peaks[j];
    return max;
  });
}

function downsampleColors(colors: [number, number, number][], target: number): [number, number, number][] {
  if (colors.length <= target) return colors;
  const ratio = colors.length / target;
  return Array.from({ length: target }, (_, i) => {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let r = 0, g = 0, b = 0;
    const n = (end - start) || 1;
    for (let j = start; j < end; j++) {
      r += colors[j][0]; g += colors[j][1]; b += colors[j][2];
    }
    return [r / n, g / n, b / n] as [number, number, number];
  });
}

const MINI_W = 128;
const MINI_H = 32;
const MINI_BARS = 48;
const MINI_BAR_W = MINI_W / MINI_BARS;

/** peak 진폭으로 밝기 조절 — 큰 소리는 밝게, 잔잔한 부분은 어둡게 */
function miniRgb(c: [number, number, number], peak: number): string {
  const lum = 0.45 + 0.55 * peak;
  return `rgb(${Math.round(c[0] * lum * 255)},${Math.round(c[1] * lum * 255)},${Math.round(c[2] * lum * 255)})`;
}

function MiniWaveform({ path, isActive }: { path: string; isActive: boolean }) {
  const [data, setData] = useState<WaveformCacheEntry | null>(() => waveformMemCache.get(path) ?? null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    let cancelQueue: (() => void) | null = null;

    const timer = setTimeout(() => {
      if (cancelled) return;
      cancelQueue = _enqueue(async () => {
        if (cancelled) return;
        try {
          const d = await invoke<WaveformData>("get_waveform", { path });
          const entry: WaveformCacheEntry = { peaks: d.peaks, colors: d.colors };
          waveformMemCache.set(path, entry);
          if (!cancelled) {
            // startTransition: 파형 렌더링을 낮은 우선순위로 처리 → UI 인터랙션 우선
            startTransition(() => setData(entry));
          }
        } catch { /* ignore */ }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelQueue?.();   // 큐에서 제거 → 불필요한 디코딩 방지
    };
  }, [path, data]);

  const display = data ? downsample(data.peaks, MINI_BARS) : null;
  const displayColors = data?.colors ? downsampleColors(data.colors, MINI_BARS) : null;

  if (!display) {
    return (
      <svg viewBox={`0 0 ${MINI_W} ${MINI_H}`} className="h-7 w-28 shrink-0">
        <rect x={0} y={MINI_H / 2 - 0.5} width={MINI_W} height={1} rx={0.5} className="fill-muted-foreground/20" />
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${MINI_W} ${MINI_H}`} className="h-7 w-28 shrink-0">
      {display.map((peak, i) => {
        const h = Math.max(peak * MINI_H * 0.9, 0.5);
        const color = displayColors?.[i];
        return color ? (
          <rect
            key={i}
            x={i * MINI_BAR_W + 0.2}
            y={(MINI_H - h) / 2}
            width={MINI_BAR_W - 0.4}
            height={h}
            rx={0.25}
            fill={miniRgb(color, peak)}
            fillOpacity={isActive ? 1.0 : 0.55}
          />
        ) : (
          <rect
            key={i}
            x={i * MINI_BAR_W + 0.2}
            y={(MINI_H - h) / 2}
            width={MINI_BAR_W - 0.4}
            height={h}
            rx={0.25}
            className={isActive ? "fill-foreground" : "fill-muted-foreground/50"}
          />
        );
      })}
    </svg>
  );
}

/* ── Main Component ── */
interface Props {
  samples: Sample[];
  loading: boolean;
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  currentSample: Sample | null;
  isPlaying: boolean;
  onPlaySample: (sample: Sample) => void;
  onDeleteSample?: (sample: Sample) => void;
  onEditSample?: (updated: Sample) => void;
  onNavigateToPack?: (packUuid: string) => void;
  filters: SampleFilterSearch;
  onFiltersChange: (updates: Partial<SampleFilterSearch> | null) => void;
  deleteLabel?: string;
  titleExtra?: React.ReactNode;
}

export default function SampleBrowser({
  samples, loading, title, subtitle,
  showBack, onBack, currentSample, isPlaying, onPlaySample, onDeleteSample, onEditSample, onNavigateToPack,
  filters, onFiltersChange, deleteLabel, titleExtra,
}: Props) {
  const { registerPlayNext, addToPlaylist, playlists } = useApp();
  const { t } = useI18n();
  const [editingSample, setEditingSample] = useState<Sample | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const handleEditSample = useCallback((sample: Sample) => {
    setEditingSample(sample);
    setEditOpen(true);
  }, []);

  const handleEditSaved = useCallback((updated: Sample) => {
    onEditSample?.(updated);
  }, [onEditSample]);

  const handleDropToPlaylist = useCallback(async (sampleId: number, cursorPos: { x: number; y: number }) => {
    const playlistId = getPlaylistDropTargetId(cursorPos);
    if (!playlistId) return;

    const pl = playlists.find((p) => p.id === playlistId);
    try {
      await addToPlaylist(playlistId, [sampleId]);
      toast(t("playlist.addedToast", { name: pl?.name || "" }), { icon: <Check size={14} /> });
    } catch (err) {
      console.error("addToPlaylist via drag failed:", err);
    }
  }, [addToPlaylist, playlists, t]);

  const query = filters.q || "";
  const selectedGenres = useMemo(() => new Set(filters.genres || []), [filters.genres]);
  const selectedInstruments = useMemo(() => new Set(filters.instruments || []), [filters.instruments]);
  const bpmRange = useMemo<BpmRange | null>(() => {
    if (filters.bpmMin != null && filters.bpmMax != null)
      return { min: filters.bpmMin, max: filters.bpmMax };
    return null;
  }, [filters.bpmMin, filters.bpmMax]);
  const selectedKeys = useMemo(() => new Set(filters.keys || []), [filters.keys]);
  const sampleType: SampleType = filters.type || "all";
  const includeTags = useMemo(() => new Set(filters.include || []), [filters.include]);
  const excludeTags = useMemo(() => new Set(filters.exclude || []), [filters.exclude]);
  const [keySearch, setKeySearch] = useState("");
  const [instSearch, setInstSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);

  const sortBy: SortBy = filters.sortBy || "filename";
  const sortDir: SortDir = filters.sortDir || "asc";
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const meta = useMemo(() => extractMeta(samples), [samples]);
  const filtered = useMemo(
    () => applyFilters(samples, selectedGenres, bpmRange, selectedKeys, sampleType, selectedInstruments, includeTags, excludeTags, query),
    [samples, selectedGenres, bpmRange, selectedKeys, sampleType, selectedInstruments, includeTags, excludeTags, query]
  );

  const sorted = useMemo(() => {
    const result = sortSamples(filtered, sortBy, sortDir);
    return result;
  }, [filtered, sortBy, sortDir, shuffleSeed]);

  // 페이지네이션: 50개 단위
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const displayed = useMemo(() => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sorted, page]);

  // 필터가 변경되면 페이지 리셋
  useEffect(() => {
    setPage(0);
  }, [filtered, sortBy, shuffleSeed]);

  // 필터된 결과에서 존재하는 태그만 추출 (+ 현재 exclude된 태그는 유지)
  const availableTags = useMemo(() => {
    const tagMap = new Map<string, number>();
    for (const s of sorted) {
      if (s.tags) {
        for (const raw of s.tags.split(",")) {
          const t = raw.trim();
          if (!t) continue;
          tagMap.set(t, (tagMap.get(t) || 0) + 1);
        }
      }
    }
    // exclude된 태그는 필터 결과에 없지만 목록에 유지 (해제할 수 있도록)
    for (const t of excludeTags) {
      if (!tagMap.has(t)) tagMap.set(t, 0);
    }
    return [...tagMap.entries()]
      .sort((a, b) => {
        // 적용된 태그(include/exclude) 우선 정렬
        const aActive = includeTags.has(a[0]) || excludeTags.has(a[0]) ? 1 : 0;
        const bActive = includeTags.has(b[0]) || excludeTags.has(b[0]) ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return b[1] - a[1];
      })
      .map(([tag, count]) => ({ tag, count }));
  }, [sorted, includeTags, excludeTags]);

  const bpmMin = useMemo(() => (meta.allBpms.length ? Math.min(...meta.allBpms) : 60), [meta.allBpms]);
  const bpmMax = useMemo(() => (meta.allBpms.length ? Math.max(...meta.allBpms) : 190), [meta.allBpms]);

  const activeCount = useMemo(() => {
    let c = selectedGenres.size + selectedInstruments.size;
    if (bpmRange) c++;
    c += selectedKeys.size;
    if (sampleType !== "all") c++;
    c += includeTags.size;
    c += excludeTags.size;
    return c;
  }, [selectedGenres, selectedInstruments, bpmRange, selectedKeys, sampleType, includeTags, excludeTags]);

  const typeCounts = useMemo(() => {
    let os = 0, lp = 0;
    for (const s of samples) {
      if (s.sample_type === "oneshot") os++;
      else if (s.sample_type === "loop") lp++;
    }
    return { oneshot: os, loop: lp };
  }, [samples]);

  const toggleGenre = useCallback((genre: string) => {
    const n = new Set(selectedGenres);
    if (n.has(genre)) n.delete(genre); else n.add(genre);
    onFiltersChange({ genres: [...n] });
  }, [selectedGenres, onFiltersChange]);

  const toggleInstrument = useCallback((inst: string) => {
    const n = new Set(selectedInstruments);
    if (n.has(inst)) n.delete(inst); else n.add(inst);
    onFiltersChange({ instruments: [...n] });
  }, [selectedInstruments, onFiltersChange]);

  // 3-state cycle: none → include → exclude → none
  const cycleTag = useCallback((tag: string) => {
    const newInclude = new Set(includeTags);
    const newExclude = new Set(excludeTags);
    if (newInclude.has(tag)) {
      // include → exclude
      newInclude.delete(tag);
      newExclude.add(tag);
    } else if (newExclude.has(tag)) {
      // exclude → none
      newExclude.delete(tag);
    } else {
      // none → include
      newInclude.add(tag);
    }
    onFiltersChange({ include: [...newInclude], exclude: [...newExclude] });
  }, [includeTags, excludeTags, onFiltersChange]);

  const removeTag = useCallback((tag: string) => {
    const newInclude = new Set(includeTags);
    const newExclude = new Set(excludeTags);
    newInclude.delete(tag);
    newExclude.delete(tag);
    onFiltersChange({ include: [...newInclude], exclude: [...newExclude] });
  }, [includeTags, excludeTags, onFiltersChange]);

  const clearAll = useCallback(() => {
    onFiltersChange(null);
  }, [onFiltersChange]);

  const handleExport = useCallback(async () => {
    if (exporting || sorted.length === 0) return;
    try {
      const filePath = await save({
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
        defaultPath: "slice-export.zip",
      });
      if (!filePath) return;

      setExporting(true);
      setExportProgress(null);

      const unlisten = await listen<ExportProgress>("export-progress", (event) => {
        setExportProgress(event.payload);
      });

      try {
        const ids = sorted.map((s) => s.id);
        await invoke<number>("export_samples", { sampleIds: ids, destPath: filePath });
      } finally {
        unlisten();
        setExporting(false);
        setExportProgress(null);
      }
    } catch (err) {
      console.error("Export failed:", err);
      setExporting(false);
      setExportProgress(null);
    }
  }, [exporting, sorted]);

  const toggleKey = useCallback((key: string) => {
    const n = new Set(selectedKeys);
    if (n.has(key)) n.delete(key); else n.add(key);
    onFiltersChange({ keys: [...n] });
  }, [selectedKeys, onFiltersChange]);

  const filteredTags = useMemo(() => {
    if (!tagSearch) return availableTags;
    const q = tagSearch.toLowerCase();
    return availableTags.filter((t) => t.tag.toLowerCase().includes(q));
  }, [availableTags, tagSearch]);

  const filteredKeys = useMemo(() => {
    if (!keySearch) return meta.keys;
    const q = keySearch.toLowerCase();
    return meta.keys.filter((k) => k.key.toLowerCase().includes(q));
  }, [meta.keys, keySearch]);

  const filteredInstruments = useMemo(() => {
    if (!instSearch) return meta.instruments;
    const q = instSearch.toLowerCase();
    return meta.instruments.filter((i) => i.tag.toLowerCase().includes(q));
  }, [meta.instruments, instSearch]);

  const instLabel = selectedInstruments.size === 0
    ? "Instrument"
    : selectedInstruments.size === 1
      ? [...selectedInstruments][0]
      : t("browser.instrumentCount", { count: selectedInstruments.size });

  // ── Keyboard arrow navigation ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (displayed.length === 0) return;

      const pageStart = page * PAGE_SIZE;
      const curIdx = currentSample
        ? displayed.findIndex((s) => s.local_path === currentSample.local_path)
        : -1;

      if (e.key === "ArrowDown") {
        if (curIdx < 0) {
          onPlaySample(displayed[0]);
        } else if (curIdx >= displayed.length - 1) {
          // 현재 페이지 마지막 항목 → 다음 페이지로
          if (page < totalPages - 1) {
            setPage((p) => p + 1);
            // 다음 페이지 첫 항목 재생
            const nextPageFirst = sorted[pageStart + PAGE_SIZE];
            if (nextPageFirst) onPlaySample(nextPageFirst);
          }
        } else {
          onPlaySample(displayed[curIdx + 1]);
        }
      } else {
        if (curIdx <= 0) {
          // 현재 페이지 첫 항목 → 이전 페이지로
          if (page > 0) {
            setPage((p) => p - 1);
            const prevPageLast = sorted[pageStart - 1];
            if (prevPageLast) onPlaySample(prevPageLast);
          }
        } else {
          onPlaySample(displayed[curIdx - 1]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [displayed, sorted, currentSample, onPlaySample, page, totalPages]);

  // ── Autoplay: registerPlayNext 콜백 등록 ──
  const sortedRef = useRef(sorted);
  sortedRef.current = sorted;
  const playSampleRef = useRef(onPlaySample);
  playSampleRef.current = onPlaySample;
  const currentSampleRef = useRef(currentSample);
  currentSampleRef.current = currentSample;
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    registerPlayNext(() => {
      const list = sortedRef.current;
      const cur = currentSampleRef.current;
      if (!cur || list.length === 0) return;

      const idx = list.findIndex((s) => s.local_path === cur.local_path);
      if (idx < 0 || idx >= list.length - 1) return;

      const nextSample = list[idx + 1];

      // 페이지 경계 처리
      const nextPage = Math.floor((idx + 1) / PAGE_SIZE);
      if (nextPage !== pageRef.current) {
        setPage(nextPage);
      }

      playSampleRef.current(nextSample);
    });
    return () => registerPlayNext(null);
  }, [registerPlayNext]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("browser.loading")}</p>
      </div>
    );
  }

  const genreLabel = selectedGenres.size === 0
    ? "Genre"
    : selectedGenres.size === 1
      ? [...selectedGenres][0]
      : t("browser.genreCount", { count: selectedGenres.size });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 gap-4">
        <div className="flex items-center gap-3">
          {showBack && (
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={onBack}>
              <ArrowLeft size={16} />
            </Button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{title}</h1>
              {titleExtra}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {subtitle || t("browser.sampleCount", { filtered: sorted.length.toLocaleString(), total: samples.length.toLocaleString() })}
            </p>
          </div>
        </div>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-foreground/70" onClick={clearAll}>
            <X size={13} className="mr-1" /> {t("browser.clearFilters", { count: activeCount })}
          </Button>
        )}
      </div>

      {/* Row 1: Dropdowns + active tags + Tags toggle button */}
      <div className="flex items-center gap-1.5 px-6 py-2 min-w-0">
        {/* Genre dropdown */}
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors cursor-pointer shrink-0",
              selectedGenres.size > 0 ? "bg-black text-white dark:bg-white dark:text-black" : "bg-secondary text-muted-foreground hover:text-foreground"
            )}>
              {genreLabel}
              <ChevronDown size={11} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-0 overflow-hidden" align="start">
            <div className="max-h-64 overflow-y-auto p-1">
              {meta.genres.map(({ tag, count }) => (
                <label
                  key={tag}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
                >
                  <Checkbox
                    checked={selectedGenres.has(tag)}
                    onCheckedChange={() => toggleGenre(tag)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="flex-1 text-xs font-medium">{tag}</span>
                  <span className="text-2xs text-muted-foreground">{count}</span>
                </label>
              ))}
            </div>
            {selectedGenres.size > 0 && (
              <div className="p-1.5 flex justify-end">
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => onFiltersChange({ genres: [] })}>
                  {t("common.reset")}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Instrument dropdown */}
        {meta.instruments.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors cursor-pointer shrink-0",
                selectedInstruments.size > 0 ? "bg-black text-white dark:bg-white dark:text-black" : "bg-secondary text-muted-foreground hover:text-foreground"
              )}>
                {instLabel}
                <ChevronDown size={11} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-0 overflow-hidden" align="start">
              <div className="p-2">
                <Input
                  placeholder={t("browser.searchInstruments")}
                  value={instSearch}
                  onChange={(e) => setInstSearch(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                {filteredInstruments.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">{t("browser.noResults")}</p>
                ) : (
                  filteredInstruments.map(({ tag, count }) => (
                    <label
                      key={tag}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
                    >
                      <Checkbox
                        checked={selectedInstruments.has(tag)}
                        onCheckedChange={() => toggleInstrument(tag)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="flex-1 text-xs font-medium">{tag}</span>
                      <span className="text-2xs text-muted-foreground">{count}</span>
                    </label>
                  ))
                )}
              </div>
              {selectedInstruments.size > 0 && (
                <div className="p-1.5 flex justify-end">
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => onFiltersChange({ instruments: [] })}>
                    {t("common.reset")}
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* Tags popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors shrink-0",
                availableTags.length === 0
                  ? "bg-secondary/50 text-muted-foreground/40 cursor-not-allowed"
                  : "bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
              )}
              disabled={availableTags.length === 0}
            >
              Tags
              <ChevronDown size={11} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0 overflow-hidden" align="start">
            <div className="p-2">
              <div className="relative">
                <Tag className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} />
                <Input
                  placeholder={t("browser.searchTags")}
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 p-3 overflow-y-auto max-h-72">
              {filteredTags.map(({ tag }) => {
                const isIncluded = includeTags.has(tag);
                const isExcluded = excludeTags.has(tag);
                return (
                  <button
                    key={tag}
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap",
                      isIncluded
                        ? "bg-blue-500 text-white"
                        : isExcluded
                          ? "bg-red-500/10 text-red-400 line-through"
                          : "bg-secondary/60 text-muted-foreground hover:text-foreground hover:bg-secondary"
                    )}
                    onClick={() => cycleTag(tag)}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {/* Active tag filters (inline, horizontally scrollable) */}
        {(includeTags.size > 0 || excludeTags.size > 0) && (
          <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 scrollbar-none">
            {[...includeTags].map((tag) => (
              <button
                key={`inc-${tag}`}
                className="inline-flex items-center gap-1 rounded-full bg-blue-500 text-white px-2.5 py-1 text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
                onClick={() => removeTag(tag)}
              >
                {tag}
                <X size={10} className="opacity-70" />
              </button>
            ))}
            {[...excludeTags].map((tag) => (
              <button
                key={`exc-${tag}`}
                className="inline-flex items-center gap-1 rounded-full bg-red-500/10 text-red-400 line-through px-2.5 py-1 text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
                onClick={() => removeTag(tag)}
              >
                {tag}
                <X size={10} className="opacity-70 no-underline" />
              </button>
            ))}
          </div>
        )}

        {/* Spacer pushes right group */}
        <div className="flex-1 shrink min-w-0" />

        {/* Sample search — expandable */}
        <div className={cn(
          "relative shrink-0 flex items-center transition-all duration-200 ease-out",
          searchOpen || query ? "w-44" : "w-8"
        )}>
          {searchOpen || query ? (
            <>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} />
              <Input
                ref={searchInputRef}
                placeholder={t("browser.searchSamples")}
                value={query}
                onChange={(e) => onFiltersChange({ q: e.target.value })}
                onBlur={() => { if (!query) setSearchOpen(false); }}
                className="h-8 pl-7 text-sm rounded-full"
                autoFocus
              />
            </>
          ) : (
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              onClick={() => { setSearchOpen(true); }}
            >
              <Search size={14} />
            </button>
          )}
        </div>

        {/* Sort dropdown */}
        <Popover open={sortOpen} onOpenChange={setSortOpen}>
          <PopoverTrigger asChild>
            <button className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0">
              {sortBy === "shuffle" ? <Shuffle size={14} /> : <ArrowUpDown size={14} />}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-0 overflow-hidden" align="end">
            <div className="p-1">
              {([
                { value: "filename" as SortBy, label: t("browser.sortFilename"), canDir: true },
                { value: "bpm" as SortBy, label: "BPM", canDir: true },
                { value: "duration" as SortBy, label: t("browser.sortDuration"), canDir: true },
                { value: "recent" as SortBy, label: t("browser.sortRecent"), canDir: true },
                { value: "shuffle" as SortBy, label: t("browser.sortShuffle"), canDir: false },
              ]).map(({ value, label, canDir }) => {
                const isSelected = sortBy === value;
                return (
                  <button
                    key={value}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors cursor-pointer text-left",
                      isSelected
                        ? "bg-secondary text-foreground font-medium"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                    onClick={() => {
                      if (value === "shuffle") {
                        onFiltersChange({ sortBy: value, sortDir: undefined });
                        setShuffleSeed((s) => s + 1);
                        setSortOpen(false);
                      } else if (isSelected && canDir) {
                        // 이미 선택된 항목 → asc/desc 토글
                        onFiltersChange({ sortDir: sortDir === "asc" ? "desc" : "asc" });
                      } else {
                        // 새 항목 선택 → asc 기본
                        onFiltersChange({ sortBy: value, sortDir: undefined });
                        setSortOpen(false);
                      }
                    }}
                  >
                    <span className="flex-1">{label}</span>
                    {isSelected && canDir && (
                      sortDir === "desc"
                        ? <ArrowDown size={13} className="text-muted-foreground" />
                        : <ArrowUp size={13} className="text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {/* BPM dropdown */}
        {meta.allBpms.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap",
                bpmRange ? "bg-black text-white dark:bg-white dark:text-black" : "bg-secondary text-muted-foreground hover:text-foreground"
              )}>
                {bpmRange ? `${bpmRange.min}–${bpmRange.max}` : "BPM"}
                <ChevronDown size={11} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="end">
              <div className="flex items-baseline gap-1.5 mb-4">
                <span className="text-lg font-bold text-foreground tabular-nums">{bpmRange?.min ?? bpmMin}</span>
                <span className="text-muted-foreground">–</span>
                <span className="text-lg font-bold text-foreground tabular-nums">{bpmRange?.max ?? bpmMax}</span>
                <span className="text-xs text-muted-foreground ml-1">BPM</span>
              </div>
              <Slider
                min={bpmMin}
                max={bpmMax}
                step={1}
                value={[bpmRange?.min ?? bpmMin, bpmRange?.max ?? bpmMax]}
                onValueChange={([lo, hi]) => onFiltersChange({ bpmMin: lo, bpmMax: hi })}
                className="w-full"
              />
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => onFiltersChange({ bpmMin: undefined, bpmMax: undefined })}>
                  {t("common.reset")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Key dropdown */}
        {meta.keys.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap",
                selectedKeys.size > 0 ? "bg-black text-white dark:bg-white dark:text-black" : "bg-secondary text-muted-foreground hover:text-foreground"
              )}>
                {selectedKeys.size > 0
                  ? selectedKeys.size <= 2 ? [...selectedKeys].join(", ") : t("browser.keyCount", { count: selectedKeys.size })
                  : "Key"}
                <ChevronDown size={11} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-0 overflow-hidden" align="end">
              <div className="p-2">
                <Input
                  placeholder={t("browser.searchKeys")}
                  value={keySearch}
                  onChange={(e) => setKeySearch(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <div className="max-h-56 overflow-y-auto p-1">
                {filteredKeys.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">{t("browser.noResults")}</p>
                ) : (
                  filteredKeys.map(({ key, count }) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary"
                    >
                      <Checkbox
                        checked={selectedKeys.has(key)}
                        onCheckedChange={() => toggleKey(key)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="flex-1 text-xs font-medium">{key}</span>
                      <span className="text-2xs text-muted-foreground">{count}</span>
                    </label>
                  ))
                )}
              </div>
              {selectedKeys.size > 0 && (
                <div className="p-1.5 flex justify-end">
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => onFiltersChange({ keys: [] })}>
                    {t("common.reset")}
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* Type cycle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap",
                sampleType === "oneshot" ? "bg-orange-500/15 text-orange-300" : sampleType === "loop" ? "bg-green-500/15 text-green-300" : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
              onClick={() => {
                const cycle: SampleType[] = ["all", "oneshot", "loop"];
                const next = cycle[(cycle.indexOf(sampleType) + 1) % cycle.length];
                onFiltersChange({ type: next });
              }}
            >
              {sampleType === "oneshot" ? "One Shot" : sampleType === "loop" ? "Loop" : "All"}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Type</TooltipContent>
        </Tooltip>
      </div>

      {/* Sample List — virtualized */}
      <VirtualSampleList
        filtered={sorted}
        displayed={displayed}
        currentSample={currentSample}
        isPlaying={isPlaying}
        onPlaySample={onPlaySample}
        onDeleteSample={onDeleteSample}
        onEditSample={handleEditSample}
        query={query}
        activeCount={activeCount}
        onGenreClick={toggleGenre}
        onTagClick={cycleTag}
        onNavigateToPack={onNavigateToPack}
        deleteLabel={deleteLabel}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onDropToPlaylist={handleDropToPlaylist}
      />

      {/* 샘플 편집 다이얼로그 */}
      <SampleEditDialog
        sample={editingSample}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={handleEditSaved}
      />
    </div>
  );
}

/* ── Playlist sub-menu for context menu ── */
function PlaylistSubMenu({ sampleId }: { sampleId: number }) {
  const { playlists, addToPlaylist, createPlaylist } = useApp();
  const { t } = useI18n();

  const handleAddToPlaylist = useCallback(
    async (playlistId: number) => {
      try {
        await addToPlaylist(playlistId, [sampleId]);
      } catch (err) {
        console.error("add_to_playlist failed:", err);
      }
    },
    [addToPlaylist, sampleId],
  );

  const handleCreateAndAdd = useCallback(async () => {
    try {
      const pl = await createPlaylist(t("playlist.new"));
      await addToPlaylist(pl.id, [sampleId]);
    } catch (err) {
      console.error("create_playlist failed:", err);
    }
  }, [createPlaylist, addToPlaylist, sampleId, t]);

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <ListMusic size={14} />
        {t("playlist.addTo")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {playlists.map((pl) => (
          <ContextMenuItem key={pl.id} onClick={() => handleAddToPlaylist(pl.id)}>
            {pl.name}
            <span className="ml-auto text-xs text-muted-foreground">{pl.sample_count}</span>
          </ContextMenuItem>
        ))}
        {playlists.length > 0 && <ContextMenuSeparator />}
        <ContextMenuItem onClick={handleCreateAndAdd}>
          <Plus size={14} />
          {t("playlist.createFirst")}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/* ── Virtualized sample list ── */
const ROW_HEIGHT = 48;

function VirtualSampleList({
  filtered,
  displayed,
  currentSample,
  isPlaying,
  onPlaySample,
  onDeleteSample,
  onEditSample,
  query,
  activeCount,
  onGenreClick,
  onTagClick,
  onNavigateToPack,
  deleteLabel,
  page,
  totalPages,
  onPageChange,
  onDropToPlaylist,
}: {
  filtered: Sample[];
  displayed: Sample[];
  currentSample: Sample | null;
  isPlaying: boolean;
  onPlaySample: (s: Sample) => void;
  onDeleteSample?: (s: Sample) => void;
  onEditSample?: (s: Sample) => void;
  query: string;
  activeCount: number;
  onGenreClick: (genre: string) => void;
  onTagClick: (tag: string) => void;
  onNavigateToPack?: (packUuid: string) => void;
  deleteLabel?: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onDropToPlaylist: (sampleId: number, cursorPos: { x: number; y: number }) => void;
}) {
  const { t } = useI18n();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: displayed.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  // 페이지 변경 시 스크롤 맨 위로
  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [page]);

  if (filtered.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <p className="py-16 text-center text-sm text-muted-foreground">
          {query || activeCount > 0 ? t("browser.noSamplesFiltered") : t("browser.noSamples")}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={parentRef} className="h-full overflow-y-auto overscroll-contain p-6">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vItem) => {
          const sample = displayed[vItem.index];
          const isCurrent = currentSample?.local_path === sample.local_path;
          const isActive = isCurrent && isPlaying;
          const keyStr = formatKey(sample.audio_key, sample.chord_type);
          const durStr = formatDuration(sample.duration);
          const dateStr = formatDate(sample.created_at);

          const packInitial = (sample.pack_name || "?").charAt(0).toUpperCase();
          const genre = sample.genre || sample.pack_genre;
          const sampleTags = sample.tags ? sample.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 3) : [];

          const rowContent = (
            <div
              className={cn(
                "group/row absolute left-0 w-full flex cursor-pointer rounded-xl items-center px-2 transition-colors gap-3",
                isActive ? "bg-muted" : "hover:bg-secondary"
              )}
              style={{ top: vItem.start, height: ROW_HEIGHT }}
              onClick={() => onPlaySample(sample)}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                const startX = e.clientX;
                const startY = e.clientY;
                const THRESHOLD = 5;
                let fired = false;

                const onMove = (me: MouseEvent) => {
                  if (fired) return;
                  if (Math.abs(me.clientX - startX) > THRESHOLD || Math.abs(me.clientY - startY) > THRESHOLD) {
                    fired = true;
                    cleanup();
                    getDragIcon()
                      .then((icon) =>
                        startDrag(
                          { item: [sample.local_path], icon, mode: "copy" },
                          ({ cursorPos }) => {
                            onDropToPlaylist(sample.id, {
                              x: Number(cursorPos.x),
                              y: Number(cursorPos.y),
                            });
                          },
                        ),
                      )
                      .catch((err) => {
                        console.error("startDrag failed:", err);
                      });
                  }
                };
                const onUp = () => cleanup();
                const cleanup = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            >
              {/* Thumbnail — click → navigate to pack */}
              <div
                className={cn(
                  "relative h-9 w-9 shrink-0 rounded-md flex items-center justify-center overflow-hidden bg-muted",
                  onNavigateToPack && sample.pack_uuid && "cursor-pointer hover:bg-muted-foreground/15"
                )}
                onClick={(e) => {
                  if (onNavigateToPack && sample.pack_uuid) {
                    e.stopPropagation();
                    onNavigateToPack(sample.pack_uuid);
                  }
                }}
                title={sample.pack_name ? t("browser.viewPack", { name: sample.pack_name }) : undefined}
              >
                <span className="text-sm font-bold select-none text-muted-foreground">
                  {packInitial}
                </span>
                {/* Active indicator — only when playing */}
                {isActive && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 pointer-events-none">
                    <Pause size={14} className="text-foreground" />
                  </div>
                )}
              </div>

              {/* Title + tags — fixed width, truncated */}
              <div className="w-96 shrink-0 min-w-0">
                <p className={cn("truncate text-xs font-medium leading-tight", isActive && "text-foreground")}>
                  {sample.filename}
                </p>
                <div className="flex items-center gap-1 mt-[3px] min-w-0 overflow-hidden">
                  {genre && (
                    <button
                      className="shrink-0 rounded px-1.5 py-px text-2xs font-medium leading-tight text-muted-foreground hover:text-foreground transition-colors"
                      onClick={(e) => { e.stopPropagation(); onGenreClick(genre); }}
                    >
                      {genre}
                    </button>
                  )}
                  {sampleTags.map((tag) => (
                    <button
                      key={tag}
                      className="shrink-0 rounded px-1.5 py-px text-2xs font-medium leading-tight text-muted-foreground/60 hover:text-foreground transition-colors"
                      onClick={(e) => { e.stopPropagation(); onTagClick(tag); }}
                    >
                      {tag}
                    </button>
                  ))}
                  {!genre && sampleTags.length === 0 && (
                    <span className="text-2xs text-muted-foreground/40 truncate">{sample.pack_name}</span>
                  )}
                </div>
              </div>

              {/* Waveform + Duration + Date group */}
              <div className="shrink-0 hidden md:flex items-center gap-4">
                <div className="w-24 shrink-0 hidden lg:block">
                  <MiniWaveform path={sample.local_path} isActive={isActive} />
                </div>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
                  {durStr || "-"}
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground/40">
                  {dateStr || "-"}
                </span>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Key */}
              <span className={cn(
                "w-9 shrink-0 text-center text-xs tabular-nums",
                keyStr ? "text-muted-foreground" : "text-muted-foreground/30"
              )}>
                {keyStr || "–"}
              </span>
              {/* BPM */}
              <span className={cn(
                "w-10 shrink-0 text-center text-xs tabular-nums",
                sample.bpm != null && sample.bpm > 0
                  ? "text-muted-foreground"
                  : "text-muted-foreground/30"
              )}>
                {sample.bpm != null && sample.bpm > 0 ? sample.bpm : "–"}
              </span>
            </div>
          );

          return (
            <ContextMenu key={sample.local_path}>
              <ContextMenuTrigger asChild>
                {rowContent}
              </ContextMenuTrigger>
              <ContextMenuContent>
                {onEditSample && (
                  <ContextMenuItem
                    onClick={() => onEditSample(sample)}
                  >
                    <Pencil size={14} />
                    {t("browser.editProperties")}
                  </ContextMenuItem>
                )}
                <PlaylistSubMenu sampleId={sample.id} />
                {onDeleteSample && <ContextMenuSeparator />}
                {onDeleteSample && (
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => onDeleteSample(sample)}
                  >
                    <Trash2 size={14} />
                    {deleteLabel || t("browser.deleteSample")}
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
          })}
        </div>
      </div>

      {/* 페이지 컨트롤 — 플로팅 */}
      {totalPages > 1 && (
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-xl border border-border/50 bg-popover/80 backdrop-blur-lg px-3 py-1.5 shadow-lg">
          <span className="text-xs tabular-nums text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              disabled={page <= 0}
              onClick={() => onPageChange(page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ArrowUp size={14} />
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => onPageChange(page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ArrowDown size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
