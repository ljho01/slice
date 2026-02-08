import {
  createRouter,
  createRoute,
  createRootRoute,
  createHashHistory,
} from "@tanstack/react-router";
import App from "@/App";
import HomePage from "@/routes/HomePage";
import PacksPage from "@/routes/PacksPage";
import PackDetailPage from "@/routes/PackDetailPage";
import SoundsPage from "@/routes/SoundsPage";
import SettingsPage from "@/routes/SettingsPage";
import type { SampleFilterSearch, SampleType, SortBy, SortDir, PacksSearch } from "@/types";

// ── Search Params Validation ──────────────────────────────────────

const VALID_SORT_BY = ["filename", "bpm", "duration", "recent", "shuffle"];

function validateSampleSearch(search: Record<string, unknown>): SampleFilterSearch {
  return {
    q: typeof search.q === "string" ? search.q : undefined,
    genres: Array.isArray(search.genres) ? (search.genres as string[]) : undefined,
    instruments: Array.isArray(search.instruments) ? (search.instruments as string[]) : undefined,
    bpmMin: typeof search.bpmMin === "number" ? search.bpmMin : undefined,
    bpmMax: typeof search.bpmMax === "number" ? search.bpmMax : undefined,
    keys: Array.isArray(search.keys) ? (search.keys as string[]) : undefined,
    type: ["oneshot", "loop"].includes(search.type as string)
      ? (search.type as SampleType)
      : undefined,
    include: Array.isArray(search.include) ? (search.include as string[]) : undefined,
    exclude: Array.isArray(search.exclude) ? (search.exclude as string[]) : undefined,
    sortBy: VALID_SORT_BY.includes(search.sortBy as string)
      ? (search.sortBy as SortBy)
      : undefined,
    sortDir: (search.sortDir === "asc" || search.sortDir === "desc")
      ? (search.sortDir as SortDir)
      : undefined,
  };
}

function validatePacksSearch(search: Record<string, unknown>): PacksSearch {
  return {
    q: typeof search.q === "string" ? search.q : undefined,
  };
}

// ── Root Route ────────────────────────────────────────────────────
const rootRoute = createRootRoute({
  component: App,
});

// ── Index (/) ─────────────────────────────────────────────────────
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

// ── Packs layout (/packs/*) ──────────────────────────────────────
const packsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "packs",
});

const packsIndexRoute = createRoute({
  getParentRoute: () => packsRoute,
  path: "/",
  component: PacksPage,
  validateSearch: validatePacksSearch,
});

const packDetailRoute = createRoute({
  getParentRoute: () => packsRoute,
  path: "$packId",
  component: PackDetailPage,
  validateSearch: validateSampleSearch,
});

// ── Sounds (/sounds) ─────────────────────────────────────────────
const soundsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "sounds",
  component: SoundsPage,
  validateSearch: validateSampleSearch,
});

// ── Settings (/settings) ──────────────────────────────────────────
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsPage,
});

// ── Route Tree ────────────────────────────────────────────────────
const routeTree = rootRoute.addChildren([
  indexRoute,
  packsRoute.addChildren([packsIndexRoute, packDetailRoute]),
  soundsRoute,
  settingsRoute,
]);

// ── Router ────────────────────────────────────────────────────────
const hashHistory = createHashHistory();

export const router = createRouter({
  routeTree,
  history: hashHistory,
});

// ── Type Registration ─────────────────────────────────────────────
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
