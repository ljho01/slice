import { useState, useMemo, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import PackEditDialog from "@/components/PackEditDialog";
import { ChevronDown, FolderOpen, Search, Plus, Trash2, Pencil, X, Grid3x3, List, ArrowUpDown } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import type { Pack } from "@/types";

interface PacksViewProps {
  packs: Pack[];
  loading: boolean;
  onSelectPack: (pack: Pack) => void;
  onDeletePack?: (pack: Pack) => void;
  onEditPack?: (updated: Pack) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  onImportExternal?: () => void;
}

type ViewMode = "grid" | "list";
type SortOption = "name-asc" | "name-desc" | "samples-desc" | "samples-asc";

export default function PacksView({ packs, loading, onSelectPack, onDeletePack, onEditPack, filter, onFilterChange, onImportExternal }: PacksViewProps) {
  const { t } = useI18n();
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");

  const sortLabels: Record<SortOption, string> = {
    "name-asc": t("packs.sortNameAsc"),
    "name-desc": t("packs.sortNameDesc"),
    "samples-desc": t("packs.sortSamplesDesc"),
    "samples-asc": t("packs.sortSamplesAsc"),
  };

  // 팩 편집 다이얼로그 상태
  const [editingPack, setEditingPack] = useState<Pack | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const handleEditPack = useCallback((pack: Pack) => {
    setEditingPack(pack);
    setEditOpen(true);
  }, []);

  const handleEditSaved = useCallback((updated: Pack) => {
    onEditPack?.(updated);
  }, [onEditPack]);

  const genres = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of packs) {
      if (p.genre) map.set(p.genre, (map.get(p.genre) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([genre, count]) => ({ genre, count }));
  }, [packs]);

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres((prev) => {
      const n = new Set(prev);
      if (n.has(genre)) n.delete(genre); else n.add(genre);
      return n;
    });
  }, []);

  const filtered = useMemo(() => {
    let r = packs;
    if (filter) {
      const q = filter.toLowerCase();
      r = r.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.genre || "").toLowerCase().includes(q)
      );
    }
    if (selectedGenres.size > 0) {
      r = r.filter((p) => p.genre != null && selectedGenres.has(p.genre));
    }

    // 정렬 적용
    const sorted = [...r];
    switch (sortBy) {
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "samples-desc":
        sorted.sort((a, b) => b.sample_count - a.sample_count);
        break;
      case "samples-asc":
        sorted.sort((a, b) => a.sample_count - b.sample_count);
        break;
    }
    return sorted;
  }, [packs, filter, selectedGenres, sortBy]);

  const totalSamples = packs.reduce((s, p) => s + p.sample_count, 0);
  const activeCount = selectedGenres.size;

  const genreLabel = selectedGenres.size === 0
    ? "Genre"
    : selectedGenres.size === 1
      ? [...selectedGenres][0]
      : t("browser.genreCount", { count: selectedGenres.size });

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("packs.scanning")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Packs</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filtered.length !== packs.length
              ? t("packs.filteredCount", { filtered: filtered.length, total: packs.length })
              : t("packs.countLabel", { count: packs.length })} · {t("packs.sampleCountLabel", { count: totalSamples.toLocaleString() })}
          </p>
        </div>
        {onImportExternal && (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onImportExternal}>
            <Plus size={14} />
            {t("packs.addExternal")}
          </Button>
        )}
      </div>

      {/* Filter row: Genre dropdown + sort + view mode + search */}
      <div className="flex items-center gap-1.5 px-6 py-2">
        {/* Genre dropdown */}
        {genres.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors cursor-pointer shrink-0",
                selectedGenres.size > 0 ? "bg-blue-500/15 text-blue-300" : "bg-secondary text-muted-foreground hover:text-foreground"
              )}>
                {genreLabel}
                <ChevronDown size={11} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-0 overflow-hidden" align="start">
              <div className="max-h-64 overflow-y-auto p-1">
                {genres.map(({ genre, count }) => (
                  <label
                    key={genre}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
                  >
                    <Checkbox
                      checked={selectedGenres.has(genre)}
                      onCheckedChange={() => toggleGenre(genre)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1 text-xs font-medium">{genre}</span>
                    <span className="text-2xs text-muted-foreground">{count}</span>
                  </label>
                ))}
              </div>
              {selectedGenres.size > 0 && (
                <div className="p-1.5 flex justify-end">
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => setSelectedGenres(new Set())}>
                    {t("common.reset")}
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        {activeCount > 0 && (
          <Button variant="ghost" size="sm" className="h-6 text-2xs text-foreground/70 px-1.5" onClick={() => setSelectedGenres(new Set())}>
            <X size={11} className="mr-0.5" /> {t("packs.clearFilters")}
          </Button>
        )}

        {/* 정렬 드롭다운 */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors cursor-pointer shrink-0 bg-secondary text-muted-foreground hover:text-foreground">
              <ArrowUpDown size={11} />
              {sortLabels[sortBy]}
              <ChevronDown size={11} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-1" align="start">
            {(Object.entries(sortLabels) as [SortOption, string][]).map(([key, label]) => (
              <button
                key={key}
                className={cn(
                  "flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-xs font-medium hover:bg-secondary",
                  sortBy === key && "bg-blue-500/15 text-blue-300"
                )}
                onClick={() => setSortBy(key)}
              >
                {label}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Spacer */}
        <div className="flex-1" />

        {/* 뷰 모드 토글 */}
        <div className="flex shrink-0 rounded-full bg-secondary p-0.5">
          <button
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-colors cursor-pointer",
              viewMode === "grid" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setViewMode("grid")}
            title={t("packs.gridView")}
          >
            <Grid3x3 size={14} />
          </button>
          <button
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-colors cursor-pointer",
              viewMode === "list" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setViewMode("list")}
            title={t("packs.listView")}
          >
            <List size={14} />
          </button>
        </div>

        {/* Search — expandable */}
        <div className={cn(
          "relative shrink-0 flex items-center transition-all duration-200 ease-out",
          searchOpen || filter ? "w-44" : "w-8"
        )}>
          {searchOpen || filter ? (
            <>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} />
              <Input
                ref={searchInputRef}
                placeholder={t("packs.searchPacks")}
                value={filter}
                onChange={(e) => onFilterChange(e.target.value)}
                onBlur={() => { if (!filter) setSearchOpen(false); }}
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
      </div>

      {/* Grid / List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {filter || activeCount > 0 ? t("packs.noPacksFiltered") : t("packs.noPacks")}
          </p>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-6">
            {filtered.map((pack) => (
              <ContextMenu key={pack.uuid}>
                <ContextMenuTrigger asChild>
                  <button
                    className="flex flex-col gap-2 rounded-lg bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-secondary"
                    onClick={() => onSelectPack(pack)}
                  >
                    <FolderOpen size={24} className="text-muted-foreground opacity-70" />
                    <span className="line-clamp-2 text-sm font-semibold leading-snug">
                      {pack.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {pack.sample_count} samples
                      </span>
                      {pack.genre && (
                        <Badge variant="secondary" className="h-4 rounded px-1 text-2xs font-normal">
                          {pack.genre}
                        </Badge>
                      )}
                    </div>
                  </button>
                </ContextMenuTrigger>
                {(onEditPack || onDeletePack) && (
                  <ContextMenuContent>
                    {onEditPack && (
                      <ContextMenuItem onClick={() => handleEditPack(pack)}>
                        <Pencil size={14} />
                        {t("browser.editProperties")}
                      </ContextMenuItem>
                    )}
                    {onEditPack && onDeletePack && <ContextMenuSeparator />}
                    {onDeletePack && (
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => onDeletePack(pack)}
                      >
                        <Trash2 size={14} />
                        {t("packs.deletePack", { count: pack.sample_count })}
                      </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                )}
              </ContextMenu>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-6">
            {filtered.map((pack) => (
              <ContextMenu key={pack.uuid}>
                <ContextMenuTrigger asChild>
                  <button
                    className="flex items-center gap-3 rounded-lg bg-card px-4 py-3 text-left transition-all hover:bg-secondary"
                    onClick={() => onSelectPack(pack)}
                  >
                    <FolderOpen size={20} className="shrink-0 text-muted-foreground opacity-70" />
                    <span className="flex-1 truncate text-sm font-semibold">
                      {pack.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {pack.sample_count} samples
                      </span>
                      {pack.genre && (
                        <Badge variant="secondary" className="h-5 rounded px-2 text-xs font-normal">
                          {pack.genre}
                        </Badge>
                      )}
                    </div>
                  </button>
                </ContextMenuTrigger>
                {(onEditPack || onDeletePack) && (
                  <ContextMenuContent>
                    {onEditPack && (
                      <ContextMenuItem onClick={() => handleEditPack(pack)}>
                        <Pencil size={14} />
                        {t("browser.editProperties")}
                      </ContextMenuItem>
                    )}
                    {onEditPack && onDeletePack && <ContextMenuSeparator />}
                    {onDeletePack && (
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => onDeletePack(pack)}
                      >
                        <Trash2 size={14} />
                        {t("packs.deletePack", { count: pack.sample_count })}
                      </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                )}
              </ContextMenu>
            ))}
          </div>
        )}
      </div>

      {/* 팩 편집 다이얼로그 */}
      <PackEditDialog
        pack={editingPack}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={handleEditSaved}
      />
    </div>
  );
}
