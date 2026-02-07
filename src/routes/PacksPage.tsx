import { useCallback } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useApp } from "@/contexts/AppContext";
import PacksView from "@/components/PacksView";
import type { Pack } from "@/types";

const route = getRouteApi("/packs/");

export default function PacksPage() {
  const { packs, libraryLoading, importExternalFolder, deletePack, updatePack } = useApp();
  const navigate = useNavigate({ from: "/packs/" });
  const search = route.useSearch();

  const handleSelectPack = useCallback(
    (pack: Pack) => {
      navigate({ to: "/packs/$packId", params: { packId: pack.uuid } });
    },
    [navigate],
  );

  const handleDeletePack = useCallback(
    async (pack: Pack) => {
      try {
        await deletePack(pack.uuid);
      } catch (err) {
        console.error("delete_pack failed:", err);
      }
    },
    [deletePack],
  );

  const handleFilterChange = useCallback(
    (q: string) => {
      navigate({
        search: q ? { q } : {},
        replace: true,
      });
    },
    [navigate],
  );

  return (
    <PacksView
      packs={packs}
      loading={libraryLoading}
      onSelectPack={handleSelectPack}
      onDeletePack={handleDeletePack}
      onEditPack={updatePack}
      filter={search.q || ""}
      onFilterChange={handleFilterChange}
      onImportExternal={importExternalFolder}
    />
  );
}
