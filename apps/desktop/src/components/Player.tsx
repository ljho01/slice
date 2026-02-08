import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pause, Play, Square, Music, Scissors, Undo2, SkipForward, Repeat1 } from "lucide-react";
import Waveform from "@/components/Waveform";
import { cn } from "@/lib/utils";
import { useI18n } from "@/contexts/I18nContext";
import type { Sample, WaveformData } from "@/types";

// 물리 키코드 기반 (한글 입력기에서도 동작)
const CHOP_CODES = [
  "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma",
  "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK",
];
const CHOP_LABELS = ["Z", "X", "C", "V", "B", "N", "M", ",", "A", "S", "D", "F", "G", "H", "J", "K"];

interface PlayerProps {
  sample: Sample;
  isPlaying: boolean;
  progress: number;
  duration: number;
  waveform: WaveformData | null;
  onTogglePlay: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  transpose: number;
  onTranspose: (semitones: number) => void;
  chopMode: number | null;
  onChopModeChange: (mode: number | null) => void;
  onChopPlay: (startTime: number, endTime: number) => void;
  onChopStop: () => void;
  reversed: boolean;
  onReverse: (val: boolean) => void;
  autoplay: "off" | "next" | "repeat";
  onAutoplayChange: (val: "off" | "next" | "repeat") => void;
}

function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Player({
  sample,
  isPlaying,
  progress,
  duration,
  waveform,
  onTogglePlay,
  onStop,
  onSeek,
  transpose,
  onTranspose,
  chopMode,
  onChopModeChange,
  onChopPlay,
  onChopStop,
  reversed,
  onReverse,
  autoplay,
  onAutoplayChange,
}: PlayerProps) {
  // ── Space key handler ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        onTogglePlay();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onTogglePlay]);

  // ── Chop ──────────────────────────────────────────────────────────
  const activeChopIdxRef = useRef<number | null>(null);
  const chopSegEndRef = useRef<number>(0);
  const [activeChopIdx, setActiveChopIdx] = useState<number | null>(null);

  // Chop keyboard handlers (e.code 기반 — IME/한글 입력 무관)
  useEffect(() => {
    if (!chopMode || !duration) return;

    const segDur = duration / chopMode;
    const codes = CHOP_CODES.slice(0, chopMode);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const idx = codes.indexOf(e.code);
      if (idx === -1) return;
      e.preventDefault();

      const start = idx * segDur;
      const end = Math.min((idx + 1) * segDur, duration);

      activeChopIdxRef.current = idx;
      chopSegEndRef.current = end;
      setActiveChopIdx(idx);
      onChopPlay(start, end);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const idx = codes.indexOf(e.code);
      if (idx !== -1 && idx === activeChopIdxRef.current) {
        activeChopIdxRef.current = null;
        chopSegEndRef.current = 0;
        setActiveChopIdx(null);
        onChopStop();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (activeChopIdxRef.current !== null) {
        activeChopIdxRef.current = null;
        chopSegEndRef.current = 0;
        setActiveChopIdx(null);
      }
    };
  }, [chopMode, duration, onChopPlay, onChopStop]);

  // Auto-stop when segment end is reached
  useEffect(() => {
    if (activeChopIdx !== null && chopSegEndRef.current > 0 && progress >= chopSegEndRef.current) {
      activeChopIdxRef.current = null;
      chopSegEndRef.current = 0;
      setActiveChopIdx(null);
      onChopStop();
    }
  }, [progress, activeChopIdx, onChopStop]);

  const { t } = useI18n();
  const pct = duration > 0 ? progress / duration : 0;

  const handleWaveformSeek = (fraction: number) => {
    onSeek(fraction * duration);
  };

  const activeChopIndex = activeChopIdx;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[min(560px,90vw)]">
      <div className="flex flex-col gap-2.5 rounded-2xl bg-card/80 backdrop-blur-xl shadow-xl border px-5 py-4">
        {/* Top row: controls + info + time + buttons */}
        <div className="flex items-center gap-3">
          {/* Controls */}
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/80"
              onClick={onTogglePlay}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              onClick={onStop}
            >
              <Square size={12} />
            </Button>
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{sample.filename}</p>
            <p className="truncate text-2xs text-muted-foreground">{sample.pack_name}</p>
          </div>

          {/* Time */}
          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
            {fmt(progress)} / {fmt(duration)}
          </span>

          {/* Transpose / Reverse / Autoplay / Chop */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Transpose */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium tabular-nums transition-colors cursor-pointer",
                    transpose !== 0
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Music size={10} />
                  {transpose > 0 ? `+${transpose}` : transpose < 0 ? transpose : "0"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-3" align="end" side="top">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">Transpose</span>
                  {transpose !== 0 && (
                    <button
                      className="text-2xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={() => onTranspose(0)}
                    >
                      {t("player.reset")}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                    onClick={() => onTranspose(Math.max(-12, transpose - 1))}
                    disabled={transpose <= -12}
                  >
                    −
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-lg font-bold tabular-nums">
                      {transpose > 0 ? `+${transpose}` : transpose}
                    </span>
                    <span className="text-2xs text-muted-foreground ml-1">st</span>
                  </div>
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                    onClick={() => onTranspose(Math.min(12, transpose + 1))}
                    disabled={transpose >= 12}
                  >
                    +
                  </button>
                </div>
                {/* Quick presets */}
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {[-12, -7, -5, 0, 5, 7, 12].map((v) => (
                    <button
                      key={v}
                      className={`rounded px-1.5 py-0.5 text-2xs font-medium transition-colors cursor-pointer ${transpose === v
                        ? "bg-muted-foreground/20 text-foreground"
                        : "text-muted-foreground/60 hover:text-foreground hover:bg-secondary"
                        }`}
                      onClick={() => onTranspose(v)}
                    >
                      {v > 0 ? `+${v}` : v}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Reverse */}
            <button
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium transition-colors cursor-pointer",
                reversed
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onReverse(!reversed)}
            >
              <Undo2 size={10} />
              REV
            </button>

            {/* Autoplay: off → next → repeat → off */}
            <button
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium transition-colors cursor-pointer",
                autoplay !== "off"
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                const next = autoplay === "off" ? "next" : autoplay === "next" ? "repeat" : "off";
                onAutoplayChange(next);
              }}
            >
              {autoplay === "repeat" ? <Repeat1 size={10} /> : <SkipForward size={10} />}
              {autoplay === "repeat" ? "LOOP" : "AUTO"}
            </button>

            {/* Chop */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium transition-colors cursor-pointer",
                    chopMode
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Scissors size={10} />
                  {chopMode || "–"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-3" align="end" side="top">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">Chop</span>
                  {chopMode && (
                    <button
                      className="text-2xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={() => onChopModeChange(null)}
                    >
                      {t("player.chopOff")}
                    </button>
                  )}
                </div>
                <div className="flex gap-1">
                  {[4, 8, 16].map((n) => (
                    <button
                      key={n}
                      className={cn(
                        "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer",
                        chopMode === n
                          ? "bg-muted-foreground/20 text-foreground"
                          : "bg-secondary text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => onChopModeChange(chopMode === n ? null : n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Waveform */}
        {waveform ? (
          <Waveform
            peaks={reversed ? [...waveform.peaks].reverse() : waveform.peaks}
            colors={reversed ? [...waveform.colors].reverse() : waveform.colors}
            progress={pct}
            onSeek={handleWaveformSeek}
            className="h-[28px] w-full"
            chopDivisions={chopMode}
            activeChopIndex={activeChopIndex}
          />
        ) : (
          <div
            className="group relative h-1 w-full cursor-pointer rounded-full bg-muted"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek(((e.clientX - rect.left) / rect.width) * duration);
            }}
          >
            <div
              className="h-full rounded-full bg-muted-foreground transition-[width] duration-100"
              style={{ width: `${pct * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-foreground shadow opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${pct * 100}% - 5px)` }}
            />
          </div>
        )}

        {/* Chop Pads */}
        {chopMode && (
          <div className="flex flex-col gap-0.5">
            <div className="flex gap-0.5">
              {CHOP_LABELS.slice(0, Math.min(chopMode, 8)).map((label, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex-1 h-6 flex items-center justify-center rounded text-2xs font-mono font-medium transition-colors",
                    activeChopIdx === i
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {label}
                </div>
              ))}
            </div>
            {chopMode === 16 && (
              <div className="flex gap-0.5">
                {CHOP_LABELS.slice(8, 16).map((label, i) => (
                  <div
                    key={i + 8}
                    className={cn(
                      "flex-1 h-6 flex items-center justify-center rounded text-2xs font-mono font-medium transition-colors",
                      activeChopIdx === i + 8
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {label}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
