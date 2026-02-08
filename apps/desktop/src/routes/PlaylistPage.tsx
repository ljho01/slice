import { useState, useEffect, useCallback } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts/AppContext";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import SampleBrowser from "@/components/SampleBrowser";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, MoreHorizontal, Palette, Pencil, Trash2, X } from "lucide-react";
import type { Sample, SampleFilterSearch } from "@/types";

const route = getRouteApi("/playlist/$playlistId");

const PLAYLIST_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#d946ef", // fuchsia
  "#ec4899", // pink
];

function cleanSampleSearch(prev: SampleFilterSearch, updates: Partial<SampleFilterSearch>): SampleFilterSearch {
  const next: SampleFilterSearch = { ...prev, ...updates };
  const clean: SampleFilterSearch = {};
  if (next.q) clean.q = next.q;
  if (next.genres?.length) clean.genres = next.genres;
  if (next.instruments?.length) clean.instruments = next.instruments;
  if (next.bpmMin != null) clean.bpmMin = next.bpmMin;
  if (next.bpmMax != null) clean.bpmMax = next.bpmMax;
  if (next.keys?.length) clean.keys = next.keys;
  if (next.type && next.type !== "all") clean.type = next.type;
  if (next.include?.length) clean.include = next.include;
  if (next.exclude?.length) clean.exclude = next.exclude;
  if (next.sortBy && next.sortBy !== "filename") clean.sortBy = next.sortBy;
  if (next.sortDir === "desc") clean.sortDir = next.sortDir;
  return clean;
}

export default function PlaylistPage() {
  const { playlistId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate({ from: "/playlist/$playlistId" });
  const { playlists, currentSample, isPlaying, playSample, removeFromPlaylist, renamePlaylist, updatePlaylistColor, deletePlaylist } = useApp();
  const { t } = useI18n();

  const numericId = Number(playlistId);
  const playlist = playlists.find((p) => p.id === numericId);

  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);

  const loadSamples = useCallback(() => {
    setLoading(true);
    setSamples([]);
    invoke<Sample[]>("get_playlist_samples", { playlistId: numericId })
      .then(setSamples)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [numericId]);

  useEffect(() => {
    loadSamples();
  }, [loadSamples]);

  const handleBack = useCallback(() => {
    navigate({ to: "/" });
  }, [navigate]);

  const handleRemoveSample = useCallback(
    async (sample: Sample) => {
      try {
        await removeFromPlaylist(numericId, [sample.id]);
        setSamples((prev) => prev.filter((s) => s.id !== sample.id));
      } catch (err) {
        console.error("remove_from_playlist failed:", err);
      }
    },
    [numericId, removeFromPlaylist],
  );

  const handleEditSample = useCallback((updated: Sample) => {
    setSamples((prev) => prev.map((s) => s.id === updated.id ? updated : s));
  }, []);

  const handleNavigateToPack = useCallback(
    (packUuid: string) => {
      navigate({ to: "/packs/$packId", params: { packId: packUuid } });
    },
    [navigate],
  );

  const handleFiltersChange = useCallback(
    (updates: Partial<SampleFilterSearch> | null) => {
      navigate({
        search: updates === null ? {} : cleanSampleSearch(search, updates),
        replace: true,
      });
    },
    [navigate, search],
  );

  const handleStartRename = useCallback(() => {
    setNewName(playlist?.name || "");
    setRenaming(true);
    setMenuOpen(false);
  }, [playlist]);

  const handleConfirmRename = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await renamePlaylist(numericId, newName.trim());
    } catch (err) {
      console.error("rename_playlist failed:", err);
    }
    setRenaming(false);
  }, [numericId, newName, renamePlaylist]);

  const handleColorChange = useCallback(async (color: string | null) => {
    try {
      await updatePlaylistColor(numericId, color);
    } catch (err) {
      console.error("update_playlist_color failed:", err);
    }
    setColorOpen(false);
    setMenuOpen(false);
  }, [numericId, updatePlaylistColor]);

  const handleDelete = useCallback(async () => {
    try {
      await deletePlaylist(numericId);
      navigate({ to: "/" });
    } catch (err) {
      console.error("delete_playlist failed:", err);
    }
  }, [numericId, deletePlaylist, navigate]);

  const titleExtra = (
    <>
      {renaming ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            className="h-7 rounded-md border border-border bg-background px-2 text-sm font-bold outline-none focus:ring-1 focus:ring-ring"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={handleConfirmRename}
          />
        </div>
      ) : (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer">
              <MoreHorizontal size={16} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"
              onClick={handleStartRename}
            >
              <Pencil size={14} />
              {t("playlist.rename")}
            </button>
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"
                >
                  <Palette size={14} />
                  {t("playlist.color")}
                  {playlist?.color && (
                    <span
                      className="ml-auto h-3.5 w-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: playlist.color }}
                    />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-auto p-2">
                <div className="grid grid-cols-4 gap-1.5">
                  {PLAYLIST_COLORS.map((c) => (
                    <button
                      key={c}
                      className={cn(
                        "h-7 w-7 rounded-full transition-all flex items-center justify-center cursor-pointer hover:scale-110",
                      )}
                      style={{ backgroundColor: c }}
                      onClick={() => handleColorChange(c)}
                    >
                      {playlist?.color === c && <Check size={14} className="text-white" />}
                    </button>
                  ))}
                </div>
                {playlist?.color && (
                  <button
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
                    onClick={() => handleColorChange(null)}
                  >
                    <X size={12} />
                    {t("common.reset")}
                  </button>
                )}
              </PopoverContent>
            </Popover>
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
              onClick={handleDelete}
            >
              <Trash2 size={14} />
              {t("playlist.delete")}
            </button>
          </PopoverContent>
        </Popover>
      )}
    </>
  );

  return (
    <SampleBrowser
      samples={samples}
      loading={loading}
      title={renaming ? "" : (playlist?.name || t("playlist.title"))}
      subtitle={t("playlist.sampleCount", { count: samples.length })}
      showBack
      onBack={handleBack}
      currentSample={currentSample}
      isPlaying={isPlaying}
      onPlaySample={playSample}
      onDeleteSample={handleRemoveSample}
      onEditSample={handleEditSample}
      onNavigateToPack={handleNavigateToPack}
      filters={search}
      onFiltersChange={handleFiltersChange}
      deleteLabel={t("playlist.removeFrom")}
      titleExtra={titleExtra}
    />
  );
}
