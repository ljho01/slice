import { useState, useEffect, useCallback, useRef } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts/AppContext";
import SampleBrowser from "@/components/SampleBrowser";
import type { Sample, SampleFilterSearch } from "@/types";

const route = getRouteApi("/sounds");

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

export default function SoundsPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: "/sounds" });
  const { currentSample, isPlaying, playSample, deleteSample, setLastSoundsSearch } = useApp();

  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);

  // 현재 search를 context에 동기화 (페이지 진입 시 + 변경 시)
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      setLastSoundsSearch(search);
    }
  }, [search, setLastSoundsSearch]);

  const loadSamples = useCallback(() => {
    setLoading(true);
    invoke<Sample[]>("get_all_samples")
      .then(setSamples)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSamples();
  }, [loadSamples]);

  const handleDeleteSample = useCallback(
    async (sample: Sample) => {
      try {
        await deleteSample(sample.id);
        setSamples((prev) => prev.filter((s) => s.id !== sample.id));
      } catch (err) {
        console.error("delete_sample failed:", err);
      }
    },
    [deleteSample],
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
      const next = updates === null ? {} : cleanSampleSearch(search, updates);
      setLastSoundsSearch(next);
      navigate({
        search: next,
        replace: true,
      });
    },
    [navigate, search, setLastSoundsSearch],
  );

  return (
    <SampleBrowser
      samples={samples}
      loading={loading}
      title="All Sounds"
      currentSample={currentSample}
      isPlaying={isPlaying}
      onPlaySample={playSample}
      onDeleteSample={handleDeleteSample}
      onEditSample={handleEditSample}
      onNavigateToPack={handleNavigateToPack}
      filters={search}
      onFiltersChange={handleFiltersChange}
    />
  );
}
