import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { useTheme, type Theme } from "@/contexts/ThemeContext";
import { useI18n, type Locale } from "@/contexts/I18nContext";
import { useApp } from "@/contexts/AppContext";
import {
  Download,
  Sun,
  Moon,
  Monitor,
  Check,
  Loader2,
  RefreshCw,
  Trash2,
  Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Sample, ExportProgress, ImportProgress, ImportResult } from "@/types";

const localeOptions: { value: Locale; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const { packs, refreshLibrary } = useApp();
  const totalSamples = packs.reduce((s, p) => s + p.sample_count, 0);

  // ── Splice Import state ─────────────────────────────────────────
  const [spliceImporting, setSpliceImporting] = useState(false);
  const [spliceProgress, setSpliceProgress] = useState<ImportProgress | null>(null);
  const [spliceResult, setSpliceResult] = useState<ImportResult | null>(null);
  const [spliceError, setSpliceError] = useState<string | null>(null);

  useEffect(() => {
    if (!spliceImporting) return;
    let cancelled = false;
    const unsub = listen<ImportProgress>("import-progress", (event) => {
      if (!cancelled) setSpliceProgress(event.payload);
    });
    return () => {
      cancelled = true;
      unsub.then((fn) => fn());
    };
  }, [spliceImporting]);

  const handleSpliceImport = useCallback(async () => {
    setSpliceImporting(true);
    setSpliceError(null);
    setSpliceProgress(null);
    setSpliceResult(null);
    try {
      const res = await invoke<ImportResult>("import_from_splice");
      setSpliceResult(res);
      refreshLibrary();
      setTimeout(() => {
        setSpliceResult(null);
      }, 3000);
    } catch (err) {
      setSpliceError(String(err));
    } finally {
      setSpliceImporting(false);
    }
  }, [refreshLibrary]);

  const splicePct = spliceProgress
    ? Math.round((spliceProgress.current / spliceProgress.total) * 100)
    : 0;

  // ── Export state ────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [exportDone, setExportDone] = useState(false);

  useEffect(() => {
    if (!exporting) return;
    let cancelled = false;
    const unsub = listen<ExportProgress>("export-progress", (event) => {
      if (!cancelled) setExportProgress(event.payload);
    });
    return () => {
      cancelled = true;
      unsub.then((fn) => fn());
    };
  }, [exporting]);

  const handleExportAll = useCallback(async () => {
    try {
      // 1. 저장 위치 선택
      const destPath = await save({
        title: t("settings.exportDialogTitle"),
        defaultPath: "slice-export.zip",
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (!destPath) return;

      setExporting(true);
      setExportDone(false);
      setExportProgress(null);

      // 2. 전체 샘플 목록 가져오기
      const samples = await invoke<Sample[]>("get_all_samples");
      const sampleIds = samples.map((s) => s.id);

      if (sampleIds.length === 0) {
        setExporting(false);
        return;
      }

      // 3. ZIP 내보내기
      await invoke<number>("export_samples", {
        sampleIds,
        destPath,
      });

      setExportDone(true);
      setTimeout(() => {
        setExportDone(false);
        setExporting(false);
        setExportProgress(null);
      }, 2000);
    } catch (err) {
      console.error("export failed:", err);
      setExporting(false);
      setExportProgress(null);
    }
  }, []);

  const exportPct = exportProgress
    ? Math.round((exportProgress.current / exportProgress.total) * 100)
    : 0;

  // ── Delete All state ─────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<number | null>(null);

  const handleDeleteAll = useCallback(async () => {
    setDeleting(true);
    try {
      const count = await invoke<number>("delete_all_samples");
      setDeleteResult(count);
      setDeleteConfirm(false);
      refreshLibrary();
      setTimeout(() => setDeleteResult(null), 3000);
    } catch (err) {
      console.error("delete all failed:", err);
    } finally {
      setDeleting(false);
    }
  }, [refreshLibrary]);

  const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("settings.themeLight"), icon: Sun },
    { value: "dark", label: t("settings.themeDark"), icon: Moon },
    { value: "system", label: t("settings.themeSystem"), icon: Monitor },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("settings.title")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.subtitle")}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-xl space-y-6">
          {/* ── 언어 설정 ──────────────────────────────────────── */}
          <section className="rounded-xl bg-card">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">{t("settings.language")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.languageDesc")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-0">
              {localeOptions.map(({ value, label }) => {
                const isActive = locale === value;
                return (
                  <button
                    key={value}
                    onClick={() => setLocale(value)}
                    className={cn(
                      "flex flex-col items-center gap-2.5 rounded-xl p-4 transition-all",
                      isActive
                        ? "bg-muted-foreground/10 text-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Languages size={22} />
                    <span className="text-xs font-medium">{label}</span>
                    {isActive && (
                      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground">
                        <Check size={10} className="text-background" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── 테마 설정 ──────────────────────────────────────── */}
          <section className="rounded-xl bg-card">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">{t("settings.theme")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.themeDesc")}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 p-5 pt-0">
              {themeOptions.map(({ value, label, icon: Icon }) => {
                const isActive = theme === value;
                return (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={cn(
                      "flex flex-col items-center gap-2.5 rounded-xl p-4 transition-all",
                      isActive
                        ? "bg-muted-foreground/10 text-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon size={22} />
                    <span className="text-xs font-medium">{label}</span>
                    {isActive && (
                      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground">
                        <Check size={10} className="text-background" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Splice 불러오기 ─────────────────────────────────── */}
          <section className="rounded-xl bg-card">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">{t("settings.spliceImport")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.spliceImportDesc")}
              </p>
            </div>
            <div className="p-5 pt-0">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {t("settings.syncDesc")}
                </div>
                <button
                  onClick={handleSpliceImport}
                  disabled={spliceImporting}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                    spliceImporting
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  {spliceResult ? (
                    <>
                      <Check size={16} />
                      {t("common.done")}
                    </>
                  ) : spliceImporting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {t("settings.importing")}
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} />
                      {t("settings.spliceSync")}
                    </>
                  )}
                </button>
              </div>

              {/* 진행 바 */}
              {spliceImporting && spliceProgress && (
                <div className="mt-4 space-y-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-muted-foreground transition-all duration-200"
                      style={{ width: `${splicePct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="max-w-[70%] truncate">
                      {spliceProgress.current_file}
                    </span>
                    <span>
                      {spliceProgress.current.toLocaleString()} /{" "}
                      {spliceProgress.total.toLocaleString()} ({splicePct}%)
                    </span>
                  </div>
                </div>
              )}

              {/* 완료 메시지 */}
              {spliceResult && (
                <div className="mt-4 rounded-lg bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
                  {t("settings.importResult", { packs: spliceResult.total_packs, files: spliceResult.files_copied })}
                  {spliceResult.files_skipped > 0 && (
                    <span className="text-emerald-500/70">
                      {" "}{t("settings.skipped", { count: spliceResult.files_skipped })}
                    </span>
                  )}
                </div>
              )}

              {/* 에러 메시지 */}
              {spliceError && (
                <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                  {spliceError}
                </div>
              )}
            </div>
          </section>

          {/* ── 전체 내보내기 ──────────────────────────────────── */}
          <section className="rounded-xl bg-card">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">{t("settings.exportLib")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.exportDesc")}
              </p>
            </div>
            <div className="p-5 pt-0">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {t("settings.packsAndSamples", { packs: packs.length, samples: totalSamples.toLocaleString() })}
                </div>
                <button
                  onClick={handleExportAll}
                  disabled={exporting || totalSamples === 0}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                    exporting
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  {exportDone ? (
                    <>
                      <Check size={16} />
                      {t("common.done")}
                    </>
                  ) : exporting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {t("settings.exporting")}
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      {t("settings.exportAll")}
                    </>
                  )}
                </button>
              </div>

              {/* 진행 바 */}
              {exporting && exportProgress && (
                <div className="mt-4 space-y-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-muted-foreground transition-all duration-200"
                      style={{ width: `${exportPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="max-w-[70%] truncate">
                      {exportProgress.current_file}
                    </span>
                    <span>
                      {exportProgress.current.toLocaleString()} /{" "}
                      {exportProgress.total.toLocaleString()} ({exportPct}%)
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── 모든 샘플 삭제 ──────────────────────────────────── */}
          <section className="rounded-xl bg-card border border-destructive/20">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold text-destructive">{t("settings.deleteAll")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.deleteAllDesc")}
              </p>
            </div>
            <div className="p-5 pt-0">
              {deleteResult != null ? (
                <div className="rounded-lg bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
                  {t("settings.deletedResult", { count: deleteResult.toLocaleString() })}
                </div>
              ) : !deleteConfirm ? (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {t("settings.packsAndSamples", { packs: packs.length, samples: totalSamples.toLocaleString() })}
                  </div>
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    disabled={totalSamples === 0}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                      totalSamples === 0
                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                        : "bg-destructive/10 text-destructive hover:bg-destructive/20",
                    )}
                  >
                    <Trash2 size={16} />
                    {t("settings.deleteAllBtn")}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {t("settings.deleteConfirmMsg")}<br />
                    <span className="text-xs opacity-70">
                      {t("settings.deleteConfirmDetail", { count: totalSamples.toLocaleString() })}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      disabled={deleting}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={handleDeleteAll}
                      disabled={deleting}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                        deleting
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                      )}
                    >
                      {deleting ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          {t("settings.deleting")}
                        </>
                      ) : (
                        <>
                          <Trash2 size={16} />
                          {t("settings.deleteConfirm")}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
