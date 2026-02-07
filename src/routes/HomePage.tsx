import { Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/AppContext";
import { FolderOpen, Disc3, Music } from "lucide-react";

export default function HomePage() {
  const { packs, libraryLoading, lastSoundsSearch } = useApp();
  const totalSamples = packs.reduce((s, p) => s + p.sample_count, 0);
  const genreCount = new Set(packs.map((p) => p.genre).filter(Boolean)).size;

  if (libraryLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-muted-foreground" />
        <p className="text-sm text-muted-foreground">라이브러리 스캔 중...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Home</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">라이브러리 개요</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl bg-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <FolderOpen size={18} className="text-muted-foreground" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">팩</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">{packs.length}</p>
          </div>

          <div className="rounded-xl bg-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Music size={18} className="text-muted-foreground" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">샘플</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">{totalSamples.toLocaleString()}</p>
          </div>

          <div className="rounded-xl bg-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Disc3 size={18} className="text-muted-foreground" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">장르</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">{genreCount}</p>
          </div>
        </div>

        {/* Quick Navigation */}
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">바로가기</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/packs"
            className="group flex items-center gap-4 rounded-xl bg-card p-5 transition-all hover:-translate-y-0.5 hover:bg-secondary"
          >
            <FolderOpen size={24} className="text-muted-foreground group-hover:text-foreground" />
            <div>
              <p className="font-semibold">Packs</p>
              <p className="text-xs text-muted-foreground">{packs.length}개 팩 탐색</p>
            </div>
          </Link>

          <Link
            to="/sounds"
            search={lastSoundsSearch}
            className="group flex items-center gap-4 rounded-xl bg-card p-5 transition-all hover:-translate-y-0.5 hover:bg-secondary"
          >
            <Disc3 size={24} className="text-muted-foreground group-hover:text-foreground" />
            <div>
              <p className="font-semibold">Sounds</p>
              <p className="text-xs text-muted-foreground">전체 샘플 탐색</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
