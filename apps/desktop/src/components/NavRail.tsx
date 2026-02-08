import { useState, useCallback, type DragEvent } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts/AppContext";
import { useI18n } from "@/contexts/I18nContext";
import { Disc3, FolderOpen, Home, Plus, Settings, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/packs", label: "Packs", icon: FolderOpen },
  { to: "/sounds", label: "Sounds", icon: Disc3 },
] as const;

function hasSampleDragType(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes("application/x-slice-sample-id");
}

export default function NavRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { lastSoundsSearch, playlists, createPlaylist, deletePlaylist, addToPlaylist } = useApp();
  const { t } = useI18n();
  const path = location.pathname;

  const isSettingsActive = path.startsWith("/settings");

  const [creating, setCreating] = useState(false);
  const handleCreatePlaylist = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const pl = await createPlaylist(t("playlist.new"));
      navigate({ to: "/playlist/$playlistId", params: { playlistId: String(pl.id) } });
    } catch (err) {
      console.error("create_playlist failed:", err);
    } finally {
      setCreating(false);
    }
  }, [creating, createPlaylist, navigate, t]);

  // 드래그 앤 드롭 — 샘플을 플레이리스트에 추가
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  const handleDragOver = useCallback((e: DragEvent, playlistId: number) => {
    if (hasSampleDragType(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropTargetId(playlistId);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetId(null);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent, playlistId: number) => {
    e.preventDefault();
    setDropTargetId(null);
    const raw = e.dataTransfer.getData("application/x-slice-sample-id");
    if (!raw) return;
    const sampleId = Number(raw);
    if (!isFinite(sampleId)) return;
    const pl = playlists.find((p) => p.id === playlistId);
    try {
      await addToPlaylist(playlistId, [sampleId]);
      toast(t("playlist.addedToast", { name: pl?.name || "" }), { icon: <Check size={14} /> });
    } catch (err) {
      console.error("addToPlaylist failed:", err);
    }
  }, [addToPlaylist, playlists, t]);

  // 삭제 확인 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const wasOnPlaylist = path === `/playlist/${deleteTarget.id}`;
    try {
      await deletePlaylist(deleteTarget.id);
      if (wasOnPlaylist) navigate({ to: "/" });
    } catch (err) {
      console.error("delete_playlist failed:", err);
    }
    setDeleteTarget(null);
  }, [deleteTarget, deletePlaylist, navigate, path]);

  return (
    <nav className="w-16 h-full pl-3 pt-8 pb-3 flex flex-col">
      <div className="border flex flex-col bg-card gap-2 pt-5 items-center rounded-xl flex-1 min-h-0">
        {/* Logo */}
        <div className="pb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="6" width="4" height="12" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.7" />
            <rect x="8" y="3" width="4" height="18" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.5" />
            <rect x="14" y="8" width="4" height="8" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.7" />
            <rect x="20" y="5" width="4" height="14" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.5" />
          </svg>
        </div>

        {/* Tabs */}
        <div className="flex flex-col gap-1">
          {tabs.map(({ to, label, icon: Icon }) => {
            const isActive =
              to === "/" ? path === "/" : path.startsWith(to);

            return (
              <Tooltip key={to}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (to === "/sounds") {
                        navigate({ to: "/sounds", search: lastSoundsSearch });
                      } else {
                        navigate({ to });
                      }
                    }}
                    className={cn(
                      "flex items-center justify-center rounded-lg p-2.5 w-[40px] h-[40px] transition-colors cursor-pointer",
                      isActive
                        ? "bg-muted-foreground/15 text-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon size={20} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Playlists */}
        {playlists.length > 0 && (
          <>
            <div className="w-6 border-t border-border/50" />
            <div className="flex flex-col gap-1 overflow-y-auto max-h-[200px] scrollbar-none" onDragLeave={handleDragLeave}>
              {playlists.map((pl) => {
                const isActive = path === `/playlist/${pl.id}`;
                const hasColor = !!pl.color;
                const isDropTarget = dropTargetId === pl.id;
                return (
                  <ContextMenu key={pl.id}>
                    <Tooltip>
                      <ContextMenuTrigger asChild>
                        <TooltipTrigger asChild>
                          <button
                            data-playlist-drop-id={pl.id}
                            onClick={() =>
                              navigate({ to: "/playlist/$playlistId", params: { playlistId: String(pl.id) } })
                            }
                            onDragOver={(e) => handleDragOver(e, pl.id)}
                            onDragEnter={(e) => handleDragOver(e, pl.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, pl.id)}
                            className={cn(
                              "flex items-center justify-center rounded-lg w-[40px] h-[40px] transition-all cursor-pointer text-xs font-bold select-none",
                              isDropTarget
                                ? "ring-2 ring-primary scale-110 bg-primary/20 text-foreground"
                                : hasColor
                                  ? isActive ? "ring-2 ring-foreground/30" : "opacity-80 hover:opacity-100"
                                  : isActive
                                    ? "bg-muted-foreground/15 text-foreground"
                                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                            )}
                            style={hasColor && !isDropTarget ? { backgroundColor: pl.color!, color: "#fff" } : undefined}
                          >
                            {pl.name.charAt(0).toUpperCase()}
                          </button>
                        </TooltipTrigger>
                      </ContextMenuTrigger>
                      <TooltipContent>
                        {pl.name}
                        <span className="ml-1.5 text-muted-foreground">{pl.sample_count}</span>
                      </TooltipContent>
                    </Tooltip>
                    <ContextMenuContent>
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => setDeleteTarget({ id: pl.id, name: pl.name })}
                      >
                        <Trash2 size={14} />
                        {t("playlist.delete")}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          </>
        )}

        {/* Create Playlist */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCreatePlaylist}
              disabled={creating}
              className="flex items-center justify-center rounded-lg p-2 w-[40px] h-[40px] transition-colors cursor-pointer text-muted-foreground/40 hover:bg-secondary hover:text-foreground"
            >
              <Plus size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("playlist.createFirst")}</TooltipContent>
        </Tooltip>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings */}
        <div className="pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                className={cn(
                  "flex items-center justify-center rounded-lg p-2.5 w-[40px] h-[40px] transition-colors",
                  isSettingsActive
                    ? "bg-muted-foreground/15 text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Settings size={20} />
              </Link>
            </TooltipTrigger>
            <TooltipContent>{t("nav.settings")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 플레이리스트 삭제 확인 다이얼로그 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("playlist.deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("playlist.deleteConfirmDesc", { name: deleteTarget?.name || "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="ghost" size="sm">{t("common.cancel")}</Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={handleConfirmDelete}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
