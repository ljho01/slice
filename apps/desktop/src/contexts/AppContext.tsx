import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "@/contexts/I18nContext";
import type { Pack, Sample, LibraryData, LibraryStatus, WaveformData, ImportProgress, ImportResult, SampleFilterSearch, FolderNode } from "@/types";

type AppPhase = "loading" | "import" | "ready";

interface AppContextType {
  phase: AppPhase;
  libraryStatus: LibraryStatus | null;
  packs: Pack[];
  libraryLoading: boolean;

  currentSample: Sample | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  waveformData: WaveformData | null;
  transpose: number;

  playSample: (sample: Sample) => void;
  togglePlay: () => void;
  stop: () => void;
  seek: (t: number) => void;
  setTransposeValue: (semitones: number) => void;

  chopMode: number | null;
  setChopMode: (mode: number | null) => void;
  playChopSegment: (startTime: number, endTime: number) => void;
  stopChop: () => void;

  reversed: boolean;
  setReversedValue: (val: boolean) => void;

  onImportComplete: () => void;

  // 수정
  updatePack: (updated: Pack) => void;

  // 삭제
  deleteSample: (sampleId: number) => Promise<void>;
  deletePack: (packUuid: string) => Promise<void>;

  // 외부 임포트
  externalImporting: boolean;
  externalProgress: ImportProgress | null;
  importExternalFolder: () => Promise<void>;
  folderTree: FolderNode | null;
  cancelFolderSelect: () => void;
  confirmFolderSelect: (selectedPaths: string[], replaceMap: Record<string, string>) => Promise<void>;
  refreshLibrary: () => void;

  lastSoundsSearch: SampleFilterSearch;
  setLastSoundsSearch: (search: SampleFilterSearch) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  // ── Phase ───────────────────────────────────────────────────────
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const status = await invoke<LibraryStatus>("check_library_status");
        setLibraryStatus(status);
        setPhase(status.has_data ? "ready" : "import");
      } catch (err) {
        console.error("check_library_status failed:", err);
        setPhase("import");
      }
    })();
  }, []);

  // ── Library ─────────────────────────────────────────────────────
  const [packs, setPacks] = useState<Pack[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);

  useEffect(() => {
    if (phase !== "ready") return;
    setLibraryLoading(true);
    invoke<LibraryData>("scan_library")
      .then((data) => setPacks(data.packs))
      .catch((err) => console.error("scan_library failed:", err))
      .finally(() => setLibraryLoading(false));
  }, [phase]);

  // ── Audio ───────────────────────────────────────────────────────
  const [currentSample, setCurrentSample] = useState<Sample | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [transpose, setTranspose] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  // Web Audio API (chop 전용 — 저레이턴시)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const chopSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const chopRafRef = useRef<number>(0);
  const chopOffsetRef = useRef<number>(0);
  const chopCtxStartRef = useRef<number>(0);
  const chopEndRef = useRef<number>(0);
  const transposeRef = useRef(0);

  // ── Reverse ────────────────────────────────────────────────────────
  const [reversed, setReversed] = useState(false);
  const reversedRef = useRef(false);
  const reversedBufferRef = useRef<AudioBuffer | null>(null);
  const isPlayingRef = useRef(false);

  // Reversed normal playback (Web Audio API)
  const revSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const revRafRef = useRef<number>(0);
  const revPosRef = useRef(0);
  const revCtxStartRef = useRef<number>(0);
  const pendingRevPlayRef = useRef(false);

  const startProgressLoop = useCallback(() => {
    const tick = () => {
      if (audioRef.current) setProgress(audioRef.current.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopProgressLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Reversed playback helpers ──────────────────────────────────────
  const startRevPlayback = useCallback(
    (fromPos: number) => {
      const ctx = audioCtxRef.current;
      const buf = reversedBufferRef.current;
      if (!ctx || !buf) return;
      if (ctx.state === "suspended") ctx.resume();

      // Cleanup previous reversed source
      if (revSourceRef.current) {
        try { revSourceRef.current.stop(); } catch { /* ignore */ }
        revSourceRef.current.disconnect();
      }
      cancelAnimationFrame(revRafRef.current);

      // Pause HTML5 audio if playing
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        stopProgressLoop();
      }

      const rate = Math.pow(2, transposeRef.current / 12);
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.playbackRate.value = rate;
      source.connect(ctx.destination);

      const remaining = buf.duration - fromPos;
      if (remaining <= 0) {
        setProgress(0);
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      source.start(0, fromPos, remaining);
      revSourceRef.current = source;
      revPosRef.current = fromPos;
      revCtxStartRef.current = ctx.currentTime;

      setIsPlaying(true);
      isPlayingRef.current = true;

      const dur = buf.duration;
      const tick = () => {
        if (!revSourceRef.current) return;
        const r = Math.pow(2, transposeRef.current / 12);
        const elapsed = (ctx.currentTime - revCtxStartRef.current) * r;
        const pos = revPosRef.current + elapsed;
        if (pos >= dur) {
          setProgress(dur);
          setIsPlaying(false);
          isPlayingRef.current = false;
          revSourceRef.current = null;
          return;
        }
        setProgress(pos);
        revRafRef.current = requestAnimationFrame(tick);
      };
      revRafRef.current = requestAnimationFrame(tick);

      source.onended = () => {
        if (revSourceRef.current === source) {
          revSourceRef.current = null;
          cancelAnimationFrame(revRafRef.current);
          setIsPlaying(false);
          isPlayingRef.current = false;
          setProgress(0);
        }
      };
    },
    [stopProgressLoop],
  );

  const pauseRevPlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !revSourceRef.current) return;

    const rate = Math.pow(2, transposeRef.current / 12);
    const elapsed = (ctx.currentTime - revCtxStartRef.current) * rate;
    revPosRef.current += elapsed;

    try { revSourceRef.current.stop(); } catch { /* ignore */ }
    revSourceRef.current.disconnect();
    revSourceRef.current = null;
    cancelAnimationFrame(revRafRef.current);

    setIsPlaying(false);
    isPlayingRef.current = false;
  }, []);

  const stopRevPlayback = useCallback(() => {
    if (revSourceRef.current) {
      try { revSourceRef.current.stop(); } catch { /* ignore */ }
      revSourceRef.current.disconnect();
      revSourceRef.current = null;
    }
    cancelAnimationFrame(revRafRef.current);
    revPosRef.current = 0;
    setIsPlaying(false);
    isPlayingRef.current = false;
    setProgress(0);
  }, []);

  const onMeta = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  }, []);

  const onEnded = useCallback(() => {
    stopProgressLoop();
    setIsPlaying(false);
    setProgress(0);
  }, [stopProgressLoop]);

  const playSample = useCallback(
    (sample: Sample) => {
      const isReversed = reversedRef.current;
      const isSameSample = currentSample?.local_path === sample.local_path;

      if (isSameSample && isPlaying) {
        // Toggle pause
        if (isReversed) {
          pauseRevPlayback();
        } else {
          audioRef.current?.pause();
          stopProgressLoop();
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
        return;
      }

      // Cleanup previous playback
      stopRevPlayback();
      if (audioRef.current) {
        audioRef.current.pause();
        stopProgressLoop();
        audioRef.current.removeEventListener("loadedmetadata", onMeta);
        audioRef.current.removeEventListener("ended", onEnded);
      }

      // Always create HTML5 Audio (for metadata + non-reversed playback)
      const audio = new Audio(convertFileSrc(sample.local_path));
      audioRef.current = audio;
      audio.addEventListener("loadedmetadata", onMeta);
      audio.addEventListener("ended", onEnded);
      audio.preservesPitch = false;
      audio.playbackRate = Math.pow(2, transposeRef.current / 12);

      setCurrentSample(sample);
      setProgress(0);
      setDuration(0);

      if (isReversed) {
        if (isSameSample && reversedBufferRef.current) {
          // Buffer already available for this sample
          setDuration(reversedBufferRef.current.duration);
          startRevPlayback(0);
        } else {
          // Wait for buffer decode
          pendingRevPlayRef.current = true;
          setIsPlaying(true);
          isPlayingRef.current = true;
        }
      } else {
        audio.play().catch(console.error);
        startProgressLoop();
        setIsPlaying(true);
        isPlayingRef.current = true;
      }
    },
    [currentSample, isPlaying, onMeta, onEnded, startProgressLoop, stopProgressLoop, startRevPlayback, pauseRevPlayback, stopRevPlayback],
  );

  const togglePlay = useCallback(() => {
    if (reversedRef.current) {
      if (isPlaying) {
        pauseRevPlayback();
      } else {
        startRevPlayback(revPosRef.current);
      }
      return;
    }
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      stopProgressLoop();
      setIsPlaying(false);
      isPlayingRef.current = false;
    } else {
      audioRef.current.play().catch(console.error);
      startProgressLoop();
      setIsPlaying(true);
      isPlayingRef.current = true;
    }
  }, [isPlaying, startProgressLoop, stopProgressLoop, pauseRevPlayback, startRevPlayback]);

  const stop = useCallback(() => {
    stopRevPlayback();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    stopProgressLoop();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setProgress(0);
  }, [stopProgressLoop, stopRevPlayback]);

  const seek = useCallback((t: number) => {
    if (reversedRef.current) {
      const wasPlaying = isPlayingRef.current && revSourceRef.current !== null;
      if (revSourceRef.current) {
        try { revSourceRef.current.stop(); } catch { /* ignore */ }
        revSourceRef.current.disconnect();
        revSourceRef.current = null;
        cancelAnimationFrame(revRafRef.current);
      }
      revPosRef.current = t;
      setProgress(t);
      if (wasPlaying) {
        startRevPlayback(t);
      }
    } else {
      if (audioRef.current) {
        audioRef.current.currentTime = t;
        setProgress(t);
      }
    }
  }, [startRevPlayback]);

  const setTransposeValue = useCallback((semitones: number) => {
    setTranspose(semitones);
    if (audioRef.current) {
      audioRef.current.preservesPitch = false;
      audioRef.current.playbackRate = Math.pow(2, semitones / 12);
    }
    // 역재생 중이면 새 rate로 재시작
    if (reversedRef.current && revSourceRef.current && audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      const oldRate = Math.pow(2, transposeRef.current / 12);
      const elapsed = (ctx.currentTime - revCtxStartRef.current) * oldRate;
      const currentPos = revPosRef.current + elapsed;

      try { revSourceRef.current.stop(); } catch { /* ignore */ }
      revSourceRef.current.disconnect();
      revSourceRef.current = null;
      cancelAnimationFrame(revRafRef.current);

      transposeRef.current = semitones;
      startRevPlayback(currentPos);
    }
  }, [startRevPlayback]);

  // transposeRef 동기화 (Web Audio API에서 사용)
  useEffect(() => {
    transposeRef.current = transpose;
  }, [transpose]);

  // reversedRef / isPlayingRef 동기화
  useEffect(() => {
    reversedRef.current = reversed;
  }, [reversed]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // ── setReversedValue (토글 시 위치 매핑 포함) ──────────────────────
  const setReversedValue = useCallback(
    (val: boolean) => {
      if (val === reversedRef.current) return;

      const wasPlaying = isPlayingRef.current;

      // 현재 위치 계산
      let currentPos: number;
      if (reversedRef.current && revSourceRef.current && audioCtxRef.current) {
        const rate = Math.pow(2, transposeRef.current / 12);
        const elapsed = (audioCtxRef.current.currentTime - revCtxStartRef.current) * rate;
        currentPos = revPosRef.current + elapsed;
      } else if (reversedRef.current) {
        currentPos = revPosRef.current;
      } else {
        currentPos = audioRef.current?.currentTime ?? 0;
      }

      const dur = audioRef.current?.duration || (audioBufferRef.current?.duration ?? 0);

      // 전부 정지
      if (revSourceRef.current) {
        try { revSourceRef.current.stop(); } catch { /* ignore */ }
        revSourceRef.current.disconnect();
        revSourceRef.current = null;
      }
      cancelAnimationFrame(revRafRef.current);
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      stopProgressLoop();
      cancelAnimationFrame(chopRafRef.current);
      if (chopSourceRef.current) {
        try { chopSourceRef.current.stop(); } catch { /* ignore */ }
        chopSourceRef.current.disconnect();
        chopSourceRef.current = null;
      }

      // 상태 업데이트
      setReversed(val);
      reversedRef.current = val;

      // 위치 매핑: newPos = duration - oldPos
      const mappedPos = dur > 0 ? Math.max(0, Math.min(dur, dur - currentPos)) : 0;
      setProgress(mappedPos);

      if (!wasPlaying || dur <= 0) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        if (!val && audioRef.current) {
          audioRef.current.currentTime = mappedPos;
        }
        revPosRef.current = mappedPos;
        return;
      }

      // 새 모드에서 재생 재개
      if (val) {
        revPosRef.current = mappedPos;
        if (reversedBufferRef.current) {
          startRevPlayback(mappedPos);
        } else {
          pendingRevPlayRef.current = true;
          setIsPlaying(true);
          isPlayingRef.current = true;
        }
      } else {
        if (audioRef.current) {
          audioRef.current.currentTime = mappedPos;
          audioRef.current.play().catch(console.error);
          startProgressLoop();
          setIsPlaying(true);
          isPlayingRef.current = true;
        }
      }
    },
    [stopProgressLoop, startProgressLoop, startRevPlayback],
  );

  // ── Chop (Web Audio API) ───────────────────────────────────────────
  const [chopMode, setChopMode] = useState<number | null>(null);

  const playChopSegment = useCallback(
    (startTime: number, endTime: number) => {
      const isReversed = reversedRef.current;

      // 역재생 일반 소스가 활성화되어 있으면 정지
      if (revSourceRef.current) {
        try { revSourceRef.current.stop(); } catch { /* ignore */ }
        revSourceRef.current.disconnect();
        revSourceRef.current = null;
        cancelAnimationFrame(revRafRef.current);
      }

      const ctx = audioCtxRef.current;
      const buffer = isReversed ? reversedBufferRef.current : audioBufferRef.current;

      // AudioBuffer가 아직 디코딩 안 됐으면 기존 <audio> 방식 fallback (비역재생만)
      if (!ctx || !buffer) {
        if (!isReversed && audioRef.current) {
          stopProgressLoop();
          audioRef.current.currentTime = startTime;
          setProgress(startTime);
          audioRef.current.play().catch(console.error);
          setIsPlaying(true);
          isPlayingRef.current = true;
          startProgressLoop();
        }
        return;
      }

      if (ctx.state === "suspended") ctx.resume();

      // 이전 chop 소스 정리
      if (chopSourceRef.current) {
        try { chopSourceRef.current.stop(); } catch { /* ignore */ }
        chopSourceRef.current.disconnect();
      }
      cancelAnimationFrame(chopRafRef.current);

      // 일반 재생 중이면 일시정지
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        stopProgressLoop();
      }

      const rate = Math.pow(2, transposeRef.current / 12);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(ctx.destination);

      const segDuration = endTime - startTime;
      source.start(0, startTime, segDuration);
      chopSourceRef.current = source;
      chopOffsetRef.current = startTime;
      chopCtxStartRef.current = ctx.currentTime;
      chopEndRef.current = endTime;

      setIsPlaying(true);
      isPlayingRef.current = true;
      setProgress(startTime);

      // 진행률 추적 RAF
      const tick = () => {
        const elapsed = (ctx.currentTime - chopCtxStartRef.current) * rate;
        const pos = chopOffsetRef.current + elapsed;
        if (pos >= chopEndRef.current) {
          setProgress(chopEndRef.current);
          return; // 세그먼트 끝 → RAF 종료, Player가 cleanup
        }
        setProgress(pos);
        chopRafRef.current = requestAnimationFrame(tick);
      };
      chopRafRef.current = requestAnimationFrame(tick);

      source.onended = () => {
        chopSourceRef.current = null;
      };
    },
    [stopProgressLoop, startProgressLoop],
  );

  const stopChop = useCallback(() => {
    cancelAnimationFrame(chopRafRef.current);
    if (chopSourceRef.current) {
      try {
        chopSourceRef.current.stop();
      } catch { }
      chopSourceRef.current.disconnect();
      chopSourceRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // cleanup RAF + Web Audio
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(chopRafRef.current);
      cancelAnimationFrame(revRafRef.current);
      if (chopSourceRef.current) {
        try { chopSourceRef.current.stop(); } catch { /* ignore */ }
        chopSourceRef.current.disconnect();
      }
      if (revSourceRef.current) {
        try { revSourceRef.current.stop(); } catch { /* ignore */ }
        revSourceRef.current.disconnect();
      }
    },
    [],
  );

  // Waveform 로드
  useEffect(() => {
    if (!currentSample) {
      setWaveformData(null);
      return;
    }
    let cancelled = false;
    setWaveformData(null);
    invoke<WaveformData>("get_waveform", { path: currentSample.local_path })
      .then((data) => {
        if (!cancelled) setWaveformData(data);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [currentSample?.local_path]);

  // AudioBuffer 디코딩 (Web Audio API — chop/reverse 재생용)
  useEffect(() => {
    if (!currentSample) {
      audioBufferRef.current = null;
      reversedBufferRef.current = null;
      return;
    }
    let cancelled = false;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    fetch(convertFileSrc(currentSample.local_path))
      .then((res) => res.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        if (cancelled) return;
        audioBufferRef.current = decoded;

        // Reversed buffer 생성
        const rev = ctx.createBuffer(
          decoded.numberOfChannels,
          decoded.length,
          decoded.sampleRate,
        );
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const src = decoded.getChannelData(ch);
          const dst = rev.getChannelData(ch);
          for (let i = 0; i < src.length; i++) {
            dst[i] = src[src.length - 1 - i];
          }
        }
        reversedBufferRef.current = rev;

        // 역재생 대기 중이면 시작
        if (pendingRevPlayRef.current) {
          pendingRevPlayRef.current = false;
          setDuration(decoded.duration);
          startRevPlayback(0);
        }
      })
      .catch((err) => console.error("AudioBuffer decode failed:", err));
    return () => {
      cancelled = true;
    };
  }, [currentSample?.local_path, startRevPlayback]);

  // Import 완료
  const onImportComplete = useCallback(() => {
    setPhase("ready");
  }, []);

  // ── 라이브러리 새로고침 ──────────────────────────────────────────
  const refreshLibrary = useCallback(() => {
    setLibraryLoading(true);
    invoke<LibraryData>("scan_library")
      .then((data) => setPacks(data.packs))
      .catch((err) => console.error("scan_library failed:", err))
      .finally(() => setLibraryLoading(false));
  }, []);

  // ── 팩 수정 ───────────────────────────────────────────────────────
  const updatePack = useCallback((updated: Pack) => {
    setPacks((prev) => prev.map((p) => (p.uuid === updated.uuid ? updated : p)));
  }, []);

  // ── 삭제 ─────────────────────────────────────────────────────────
  const deleteSample = useCallback(async (sampleId: number) => {
    await invoke("delete_sample", { sampleId });
    // 재생 중인 샘플이 삭제된 경우 정지
    if (currentSample?.id === sampleId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      stopProgressLoop();
      setIsPlaying(false);
      setProgress(0);
      setCurrentSample(null);
    }
    refreshLibrary();
  }, [currentSample, stopProgressLoop, refreshLibrary]);

  const deletePack = useCallback(async (packUuid: string) => {
    await invoke<number>("delete_pack", { packUuid });
    // 재생 중인 샘플이 삭제된 팩에 속하는 경우 정지
    if (currentSample?.pack_uuid === packUuid) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      stopProgressLoop();
      setIsPlaying(false);
      setProgress(0);
      setCurrentSample(null);
    }
    refreshLibrary();
  }, [currentSample, stopProgressLoop, refreshLibrary]);

  // ── 외부 폴더 임포트 ─────────────────────────────────────────────
  const [externalImporting, setExternalImporting] = useState(false);
  const [externalProgress, setExternalProgress] = useState<ImportProgress | null>(null);
  const [folderTree, setFolderTree] = useState<FolderNode | null>(null);

  // 진행 상황 리스너
  useEffect(() => {
    if (!externalImporting) return;
    let cancelled = false;
    const unsub = listen<ImportProgress>("import-progress", (event) => {
      if (!cancelled) setExternalProgress(event.payload);
    });
    return () => {
      cancelled = true;
      unsub.then((fn) => fn());
    };
  }, [externalImporting]);

  // 1단계: 폴더 선택 → 스캔 → 트리 표시
  const importExternalFolder = useCallback(async () => {
    const selected = await open({ directory: true, title: t("import.folderDialogTitle") });
    if (!selected) return;

    try {
      const tree = await invoke<FolderNode>("scan_external_folder", { folderPath: selected });
      // 하위 폴더 없이 직접 오디오 파일만 있는 경우 → 바로 임포트
      if (tree.children.length === 0 && tree.audio_count > 0) {
        setExternalImporting(true);
        setExternalProgress(null);
        try {
          await invoke<ImportResult>("import_external_folder", { selectedPaths: [tree.path], replaceMap: {} });
          refreshLibrary();
        } finally {
          setExternalImporting(false);
          setExternalProgress(null);
        }
      } else {
        // 트리 보여주기
        setFolderTree(tree);
      }
    } catch (err) {
      console.error("scan_external_folder failed:", err);
    }
  }, [refreshLibrary]);

  // 트리 선택 취소
  const cancelFolderSelect = useCallback(() => {
    setFolderTree(null);
  }, []);

  // 2단계: 선택된 폴더들 임포트
  const confirmFolderSelect = useCallback(async (selectedPaths: string[], replaceMap: Record<string, string>) => {
    setFolderTree(null);
    setExternalImporting(true);
    setExternalProgress(null);
    try {
      await invoke<ImportResult>("import_external_folder", { selectedPaths, replaceMap });
      refreshLibrary();
    } catch (err) {
      console.error("import_external_folder failed:", err);
    } finally {
      setExternalImporting(false);
      setExternalProgress(null);
    }
  }, [refreshLibrary]);

  // ── Last Sounds Search (필터 유지) ──────────────────────────────
  const [lastSoundsSearch, setLastSoundsSearch] = useState<SampleFilterSearch>({});

  return (
    <AppContext.Provider
      value={{
        phase,
        libraryStatus,
        packs,
        libraryLoading,
        currentSample,
        isPlaying,
        progress,
        duration,
        waveformData,
        transpose,
        playSample,
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
        updatePack,
        deleteSample,
        deletePack,
        externalImporting,
        externalProgress,
        importExternalFolder,
        folderTree,
        cancelFolderSelect,
        confirmFolderSelect,
        refreshLibrary,
        lastSoundsSearch,
        setLastSoundsSearch,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
