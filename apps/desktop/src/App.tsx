import { Outlet } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "@/contexts/AppContext";
import { useI18n } from "@/contexts/I18nContext";
import NavRail from "@/components/NavRail";
import Player from "@/components/Player";
import ImportScreen from "@/components/ImportScreen";
import FolderTreeSelector from "@/components/FolderTreeSelector";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** macOS 트래픽 라이트 높이만큼의 투명 드래그 히트박스 */
function DragRegion() {
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.buttons === 1) {
      e.preventDefault();
      getCurrentWindow().startDragging();
    }
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className="fixed top-0 left-0 right-0 h-[28px] z-9999"
    />
  );
}

export default function App() {
  const {
    phase,
    libraryStatus,
    currentSample,
    isPlaying,
    progress,
    duration,
    waveformData,
    transpose,
    togglePlay,
    stop,
    seek,
    setTransposeValue,
    chopMode,
    setChopMode,
    playChopSegment,
    stopChop,
    reversed,
    setReversedValue,
    onImportComplete,
    externalImporting,
    externalProgress,
    folderTree,
    cancelFolderSelect,
    confirmFolderSelect,
  } = useApp();
  const { t } = useI18n();

  // ── Loading ─────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <DragRegion />
        <svg className="h-8 w-8 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
      </div>
    );
  }

  // ── Import ──────────────────────────────────────────────────────
  if (phase === "import" && libraryStatus) {
    return (
      <>
        <DragRegion />
        <ImportScreen status={libraryStatus} onComplete={onImportComplete} />
      </>
    );
  }

  // ── Ready ───────────────────────────────────────────────────────
  const extPct = externalProgress
    ? Math.round((externalProgress.current / externalProgress.total) * 100)
    : 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden select-none">
      <DragRegion />
      <div className="flex flex-1 overflow-hidden">
        <NavRail />
        <main className="flex flex-1 flex-col overflow-hidden pt-[28px]">
          <Outlet />
        </main>
      </div>
      {currentSample && (
        <Player
          sample={currentSample}
          isPlaying={isPlaying}
          progress={progress}
          duration={duration}
          waveform={waveformData}
          onTogglePlay={togglePlay}
          onStop={stop}
          onSeek={seek}
          transpose={transpose}
          onTranspose={setTransposeValue}
          chopMode={chopMode}
          onChopModeChange={setChopMode}
          onChopPlay={playChopSegment}
          onChopStop={stopChop}
          reversed={reversed}
          onReverse={setReversedValue}
        />
      )}

      {/* 폴더 트리 선택 다이얼로그 */}
      <Dialog open={!!folderTree} onOpenChange={(open) => { if (!open) cancelFolderSelect(); }}>
        <DialogContent className="max-w-lg p-0 gap-0 max-h-[70vh] flex flex-col overflow-hidden">
          {folderTree && (
            <FolderTreeSelector
              tree={folderTree}
              onConfirm={confirmFolderSelect}
              onCancel={cancelFolderSelect}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 외부 임포트 진행 오버레이 */}
      {externalImporting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl bg-background p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <svg className="h-6 w-6 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
              </svg>
            </div>
            <div className="w-full text-center">
              <h3 className="text-base font-semibold text-foreground">{t("app.externalImporting")}</h3>
              {externalProgress && externalProgress.total_packs > 1 && (
                <p className="mt-1 text-sm text-foreground/80">
                  {externalProgress.current_pack_name}
                  <span className="text-muted-foreground ml-1.5">
                    ({externalProgress.current_pack}/{externalProgress.total_packs} {t("import.packUnit")})
                  </span>
                </p>
              )}
              {externalProgress && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {externalProgress.current.toLocaleString()} / {externalProgress.total.toLocaleString()} {t("import.fileUnit")} ({extPct}%)
                </p>
              )}
            </div>
            {/* 팩 프로그레스 */}
            {externalProgress && externalProgress.total_packs > 1 && (
              <div className="w-full">
                <div className="flex justify-between text-[10px] text-muted-foreground/60 mb-1">
                  <span>{t("app.packProgress")}</span>
                  <span>{externalProgress.current_pack}/{externalProgress.total_packs}</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/40 transition-all duration-300"
                    style={{ width: `${Math.round((externalProgress.current_pack / externalProgress.total_packs) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {/* 파일 프로그레스 */}
            <div className="w-full">
              {externalProgress && externalProgress.total_packs > 1 && (
                <div className="flex justify-between text-[10px] text-muted-foreground/60 mb-1">
                  <span>{t("app.fileProgress")}</span>
                  <span>{extPct}%</span>
                </div>
              )}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-muted-foreground transition-all duration-200"
                  style={{ width: `${extPct}%` }}
                />
              </div>
            </div>
            {externalProgress && (
              <p className="max-w-full truncate text-xs text-muted-foreground/60">
                {externalProgress.current_file}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
