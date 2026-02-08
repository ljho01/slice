import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryStatus, ImportProgress, ImportResult, FolderNode } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FolderOpen } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import FolderTreeSelector from "@/components/FolderTreeSelector";

interface ImportScreenProps {
  status: LibraryStatus;
  onComplete: () => void;
}

export default function ImportScreen({ status, onComplete }: ImportScreenProps) {
  const { t } = useI18n();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderTree, setFolderTree] = useState<FolderNode | null>(null);

  useEffect(() => {
    if (!importing) return;
    let cancelled = false;
    const setup = listen<ImportProgress>("import-progress", (event) => {
      if (!cancelled) setProgress(event.payload);
    });
    return () => {
      cancelled = true;
      setup.then((fn) => fn());
    };
  }, [importing]);

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setProgress(null);
    try {
      const res = await invoke<ImportResult>("import_from_splice");
      setResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleExternalImport = async () => {
    const selected = await open({ directory: true, title: t("import.folderDialogTitle") });
    if (!selected) return;

    setError(null);
    try {
      const tree = await invoke<FolderNode>("scan_external_folder", { folderPath: selected });
      // 하위 폴더 없이 직접 오디오 파일만 있는 경우 → 바로 임포트
      if (tree.children.length === 0 && tree.audio_count > 0) {
        await doImport([tree.path], {});
      } else {
        setFolderTree(tree);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const doImport = async (selectedPaths: string[], replaceMap: Record<string, string>) => {
    setFolderTree(null);
    setImporting(true);
    setError(null);
    setProgress(null);
    try {
      const res = await invoke<ImportResult>("import_external_folder", { selectedPaths, replaceMap });
      setResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  // ── 메인 컨텐츠 결정 ──────────────────────────────────────────────
  let content: React.ReactNode;

  if (result) {
    // Import 완료 화면
    content = (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
            <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t("import.complete")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("import.resultMsg", { packs: result.total_packs, files: result.files_copied })}
              {result.files_skipped > 0 && (
                <span className="block text-muted-foreground/70">
                  {t("import.skipped", { count: result.files_skipped })}
                </span>
              )}
            </p>
          </div>
          <Button onClick={onComplete} className="px-8">
            {t("import.openLibrary")}
          </Button>
        </div>
      </div>
    );
  } else if (importing) {
    // Import 진행 중
    content = (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex w-full max-w-md flex-col items-center gap-6 px-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted-foreground/10">
            <svg className="h-8 w-8 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
          </div>
          <div className="w-full text-center">
            <h2 className="text-xl font-semibold text-foreground">{t("import.copying")}</h2>
            {progress && progress.total_packs > 1 && (
              <p className="mt-1 text-sm text-foreground/80">
                {progress.current_pack_name}
                <span className="text-muted-foreground ml-1.5">
                  ({progress.current_pack}/{progress.total_packs} {t("import.packUnit")})
                </span>
              </p>
            )}
            {progress && (
              <p className="mt-1 text-xs text-muted-foreground">
                {progress.current.toLocaleString()} / {progress.total.toLocaleString()} {t("import.fileUnit")} ({pct}%)
              </p>
            )}
          </div>
          {/* 팩 프로그레스 */}
          {progress && progress.total_packs > 1 && (
            <div className="w-full">
              <div className="flex justify-between text-[10px] text-muted-foreground/60 mb-1">
                <span>{t("import.packProgress")}</span>
                <span>{progress.current_pack}/{progress.total_packs}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground/40 transition-all duration-300"
                  style={{ width: `${Math.round((progress.current_pack / progress.total_packs) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {/* 파일 프로그레스 */}
          <div className="w-full">
            {progress && progress.total_packs > 1 && (
              <div className="flex justify-between text-[10px] text-muted-foreground/60 mb-1">
                <span>{t("import.fileProgress")}</span>
                <span>{pct}%</span>
              </div>
            )}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-muted-foreground transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {progress && (
            <p className="max-w-full truncate text-xs text-muted-foreground/60">
              {progress.current_file}
            </p>
          )}
        </div>
      </div>
    );
  } else {
    // 초기 화면
    content = (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex max-w-md flex-col items-center gap-6 px-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted-foreground/10">
            <svg className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
            </svg>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("import.welcome")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("import.welcomeDesc")}
              <br />
              {t("import.welcomeNote")}
            </p>
          </div>

          <div className="flex flex-col items-center gap-3">
            {status.splice_available ? (
              <Button onClick={handleImport} size="lg" className="w-full px-8">
                {t("import.fromSplice")}
              </Button>
            ) : (
              <div className="rounded-lg bg-card/50 p-4">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">~/Splice</span>{" "}
                  {t("import.spliceNotFound1")}
                  <br />
                  {t("import.spliceNotFound2")}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 w-full">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground/60">{t("import.or")}</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button onClick={handleExternalImport} variant="outline" size="lg" className="w-full px-8 gap-2">
              <FolderOpen size={16} />
              {t("import.fromFolder")}
            </Button>
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {content}
      <Dialog open={!!folderTree} onOpenChange={(open) => { if (!open) setFolderTree(null); }}>
        <DialogContent className="max-w-lg p-0 gap-0 max-h-[70vh] flex flex-col overflow-hidden">
          {folderTree && (
            <FolderTreeSelector
              tree={folderTree}
              onConfirm={doImport}
              onCancel={() => setFolderTree(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
