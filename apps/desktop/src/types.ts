export interface Pack {
  uuid: string;
  name: string;
  genre: string | null;
  cover_url: string | null;
  sample_count: number;
  created_at: string | null;
}

export interface Sample {
  id: number;
  local_path: string;
  filename: string;
  audio_key: string | null;
  bpm: number | null;
  chord_type: string | null;
  duration: number | null; // milliseconds
  genre: string | null;
  sample_type: string | null; // "oneshot" | "loop"
  tags: string | null;
  pack_uuid: string | null;
  pack_name: string | null;
  pack_genre: string | null;
  created_at: string | null;
}

export interface Playlist {
  id: number;
  name: string;
  color: string | null;
  sample_count: number;
  created_at: string | null;
}

export interface WaveformData {
  peaks: number[];
  colors: [number, number, number][];
  duration_secs: number;
}

export interface LibraryData {
  packs: Pack[];
  total_samples: number;
}

export interface LibraryStatus {
  has_data: boolean;
  pack_count: number;
  sample_count: number;
  splice_available: boolean;
}

export interface ImportProgress {
  current: number;
  total: number;
  current_file: string;
  current_pack: number;
  total_packs: number;
  current_pack_name: string;
}

export interface ImportResult {
  files_copied: number;
  files_skipped: number;
  total_packs: number;
}

export interface ExportProgress {
  current: number;
  total: number;
  current_file: string;
}

export interface PackConflict {
  name: string;
  existing_uuid: string;
  existing_sample_count: number;
}

export interface FolderNode {
  name: string;
  path: string;
  audio_count: number;       // 이 폴더 직속 오디오 파일 수
  total_audio_count: number;  // 하위 포함 전체 오디오 파일 수
  children: FolderNode[];
}

// ── Filter Search Params ──────────────────────────────────────────

export type SampleType = "all" | "oneshot" | "loop";
export type SortBy = "filename" | "bpm" | "duration" | "recent" | "shuffle";
export type SortDir = "asc" | "desc";

export interface SampleFilterSearch {
  q?: string;
  genres?: string[];
  instruments?: string[];
  bpmMin?: number;
  bpmMax?: number;
  keys?: string[];
  type?: SampleType;
  include?: string[];
  exclude?: string[];
  sortBy?: SortBy;
  sortDir?: SortDir;
}

export interface PacksSearch {
  q?: string;
}
