import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Music,
  Package,
  AlertTriangle,
  RefreshCw,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/contexts/I18nContext";
import type { FolderNode, PackConflict } from "@/types";

interface FolderTreeSelectorProps {
  tree: FolderNode;
  /** selectedPaths + replaceMap (폴더명 → 기존 UUID, 교체할 팩들) */
  onConfirm: (selectedPaths: string[], replaceMap: Record<string, string>) => void;
  onCancel: () => void;
}

// 선택된 경로가 다른 선택된 경로의 자식인지 확인
function isChildOfAny(path: string, paths: Set<string>): boolean {
  for (const p of paths) {
    if (p !== path && path.startsWith(p + "/")) return true;
  }
  return false;
}

// 경로에서 폴더명 추출
function folderNameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || "Unknown";
}

interface TreeNodeProps {
  node: FolderNode;
  depth: number;
  selected: Set<string>;
  expanded: Set<string>;
  onToggleSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
}

function TreeNode({ node, depth, selected, expanded, onToggleSelect, onToggleExpand }: TreeNodeProps) {
  const isSelected = selected.has(node.path);
  const isExpanded = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const isDisabled = isChildOfAny(node.path, selected) && !isSelected;

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 py-1 px-2 rounded-md transition-colors hover:bg-muted/50 ${isDisabled ? "opacity-40" : ""
          }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggleExpand(node.path)}
            className="shrink-0 p-0.5 rounded hover:bg-muted"
          >
            {isExpanded ? (
              <ChevronDown size={14} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={14} className="text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}

        <Checkbox
          checked={isSelected}
          disabled={isDisabled}
          onCheckedChange={() => onToggleSelect(node.path)}
          className="shrink-0"
        />

        {isExpanded ? (
          <FolderOpen size={16} className="shrink-0 text-amber-400" />
        ) : (
          <Folder size={16} className="shrink-0 text-amber-400/70" />
        )}

        <button
          onClick={() => (hasChildren ? onToggleExpand(node.path) : onToggleSelect(node.path))}
          className="flex-1 text-left text-sm text-foreground truncate"
        >
          {node.name}
        </button>

        <span className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground/60">
          <Music size={10} />
          {node.total_audio_count}
        </span>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 충돌 해결 UI ──────────────────────────────────────────────────

type ConflictAction = "replace" | "new";

interface ConflictResolverProps {
  conflicts: PackConflict[];
  onConfirm: (decisions: Record<string, ConflictAction>) => void;
  onBack: () => void;
}

function ConflictResolver({ conflicts, onConfirm, onBack }: ConflictResolverProps) {
  const { t } = useI18n();
  const [decisions, setDecisions] = useState<Record<string, ConflictAction>>(() => {
    const init: Record<string, ConflictAction> = {};
    for (const c of conflicts) {
      init[c.name] = "replace"; // 기본값: 교체
    }
    return init;
  });

  const setAll = (action: ConflictAction) => {
    const next: Record<string, ConflictAction> = {};
    for (const c of conflicts) next[c.name] = action;
    setDecisions(next);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 text-amber-400">
          <AlertTriangle size={18} />
          <h2 className="text-lg font-semibold text-foreground">{t("folder.conflictTitle")}</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("folder.conflictDesc")}
        </p>
      </div>

      {/* 충돌 목록 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-3 px-4 space-y-2">
          {conflicts.map((c) => (
            <div
              key={c.name}
              className="rounded-lg border border-border bg-muted/30 p-3"
            >
              <div className="flex items-center gap-2 mb-2.5">
                <Folder size={14} className="text-amber-400" />
                <span className="font-medium text-sm text-foreground">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t("folder.existingSamples", { count: c.existing_sample_count })}
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setDecisions((p) => ({ ...p, [c.name]: "replace" }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${decisions[c.name] === "replace"
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                >
                  <RefreshCw size={12} />
                  {t("folder.replaceExisting")}
                </button>
                <button
                  onClick={() => setDecisions((p) => ({ ...p, [c.name]: "new" }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${decisions[c.name] === "new"
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                >
                  <Plus size={12} />
                  {t("folder.addAsNew")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 하단 */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/30">
        <div className="flex gap-1.5">
          <Button variant="ghost" size="xs" onClick={() => setAll("replace")}>
            {t("folder.replaceAll")}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setAll("new")}>
            {t("folder.addAllNew")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            {t("common.back")}
          </Button>
          <Button size="sm" onClick={() => onConfirm(decisions)}>
            {t("common.import")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────

type Step = "tree" | "conflict" | "importing";

export default function FolderTreeSelector({ tree, onConfirm, onCancel }: FolderTreeSelectorProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("tree");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set([tree.path]);
    for (const child of tree.children) {
      if (child.children.length > 0) {
        initial.add(child.path);
      }
    }
    return initial;
  });
  const [conflicts, setConflicts] = useState<PackConflict[]>([]);
  const [checking, setChecking] = useState(false);

  const onToggleSelect = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        for (const p of next) {
          if (p.startsWith(path + "/")) next.delete(p);
        }
        for (const p of next) {
          if (path.startsWith(p + "/")) next.delete(p);
        }
        next.add(path);
      }
      return next;
    });
  }, []);

  const onToggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const summary = useMemo(() => {
    let totalFiles = 0;
    const findNode = (node: FolderNode, targetPath: string): FolderNode | null => {
      if (node.path === targetPath) return node;
      for (const child of node.children) {
        const found = findNode(child, targetPath);
        if (found) return found;
      }
      return null;
    };
    for (const path of selected) {
      const node = findNode(tree, path);
      if (node) totalFiles += node.total_audio_count;
    }
    return { packCount: selected.size, totalFiles };
  }, [selected, tree]);

  const allFirstLevel = useMemo(() => {
    if (tree.children.length === 0) return [tree.path];
    return tree.children.map((c) => c.path);
  }, [tree]);

  const isAllSelected = allFirstLevel.every((p) => selected.has(p));

  const toggleAll = useCallback(() => {
    if (isAllSelected) setSelected(new Set());
    else setSelected(new Set(allFirstLevel));
  }, [isAllSelected, allFirstLevel]);

  // "가져오기" 클릭 → 충돌 확인 → 충돌 있으면 충돌 UI, 없으면 바로 임포트
  const handleImportClick = useCallback(async () => {
    const paths = Array.from(selected);
    const names = paths.map(folderNameFromPath);

    setChecking(true);
    try {
      const result = await invoke<PackConflict[]>("check_pack_name_conflicts", { packNames: names });
      if (result.length > 0) {
        setConflicts(result);
        setStep("conflict");
      } else {
        // 충돌 없음 → 로딩 표시 후 진행
        setStep("importing");
        onConfirm(paths, {});
      }
    } catch (err) {
      console.error("check_pack_name_conflicts failed:", err);
      setStep("importing");
      onConfirm(paths, {});
    } finally {
      setChecking(false);
    }
  }, [selected, onConfirm]);

  // 충돌 해결 후 확인
  const handleConflictConfirm = useCallback(
    (decisions: Record<string, ConflictAction>) => {
      const paths = Array.from(selected);
      const replaceMap: Record<string, string> = {};
      for (const c of conflicts) {
        if (decisions[c.name] === "replace") {
          replaceMap[c.name] = c.existing_uuid;
        }
      }
      setStep("importing");
      onConfirm(paths, replaceMap);
    },
    [selected, conflicts, onConfirm],
  );

  // ── 임포트 시작 로딩 화면 ────────────────────────────────────────
  if (step === "importing") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 px-8">
        <svg className="h-10 w-10 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">{t("folder.startingImport")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("folder.preparingPacks", { count: selected.size })}
          </p>
        </div>
      </div>
    );
  }

  // ── 충돌 해결 화면 ──────────────────────────────────────────────
  if (step === "conflict") {
    return (
      <ConflictResolver
        conflicts={conflicts}
        onConfirm={handleConflictConfirm}
        onBack={() => setStep("tree")}
      />
    );
  }

  // ── 트리 선택 화면 ──────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full relative">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-4 flex-0">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("folder.selectFolders")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("folder.selectFoldersDesc")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={toggleAll}>
          {isAllSelected ? t("folder.deselectAll") : t("folder.selectAll")}
        </Button>
      </div>

      {/* 트리 */}
      <div className="flex-1 min-h-0 max-h-100 overflow-y-auto shrink">
        <div className="py-2 px-2">
          {tree.children.length > 0 ? (
            tree.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={0}
                selected={selected}
                expanded={expanded}
                onToggleSelect={onToggleSelect}
                onToggleExpand={onToggleExpand}
              />
            ))
          ) : (
            <TreeNode
              node={tree}
              depth={0}
              selected={selected}
              expanded={expanded}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
          )}

          {tree.children.length > 0 && tree.audio_count > 0 && (
            <div
              className={`group flex items-center gap-1.5 py-1 px-2 rounded-md transition-colors hover:bg-muted/50 ${isChildOfAny(tree.path, selected) ? "opacity-40" : ""
                }`}
              style={{ paddingLeft: "8px" }}
            >
              <span className="w-[18px] shrink-0" />
              <Checkbox
                checked={selected.has(tree.path)}
                onCheckedChange={() => onToggleSelect(tree.path)}
                className="shrink-0"
              />
              <Folder size={16} className="shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm text-muted-foreground italic truncate">
                {tree.name} {t("folder.rootFiles")}
              </span>
              <span className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground/60">
                <Music size={10} />
                {tree.audio_count}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 하단 요약 + 버튼 */}
      <div className="flex items-center flex-0 justify-between px-5 py-4 border-t border-border bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Package size={14} />
          {summary.packCount > 0 ? (
            <span>
              {t("folder.summary", { packs: summary.packCount, files: summary.totalFiles.toLocaleString() })}
            </span>
          ) : (
            <span>{t("folder.selectPrompt")}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={selected.size === 0 || checking}
            onClick={handleImportClick}
          >
            {checking ? t("folder.checking") : t("common.import")}
          </Button>
        </div>
      </div>
    </div>
  );
}
