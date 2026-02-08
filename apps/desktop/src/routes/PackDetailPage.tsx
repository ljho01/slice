import { useState, useEffect, useCallback } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts/AppContext";
import SampleBrowser from "@/components/SampleBrowser";
import type { Sample, SampleFilterSearch } from "@/types";

const route = getRouteApi("/packs/$packId");

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

export default function PackDetailPage() {
  const { packId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate({ from: "/packs/$packId" });
  const { packs, currentSample, isPlaying, playSample, deleteSample } = useApp();

  const pack = packs.find((p) => p.uuid === packId);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setSamples([]);
    invoke<Sample[]>("get_pack_samples", { packUuid: packId })
      .then(setSamples)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [packId]);

  const handleBack = useCallback(() => {
    navigate({ to: "/packs" });
  }, [navigate]);

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
      navigate({
        search: updates === null ? {} : cleanSampleSearch(search, updates),
        replace: true,
      });
    },
    [navigate, search],
  );

  return (
    <SampleBrowser
      samples={samples}
      loading={loading}
      title={pack?.name || "팩"}
      subtitle={`${samples.length} 샘플`}
      showBack
      onBack={handleBack}
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
