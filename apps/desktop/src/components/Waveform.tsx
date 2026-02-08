import { useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";

interface WaveformProps {
  peaks: number[];
  /** 주파수 기반 RGB 색상 (per bar) — Rekordbox 스타일 */
  colors?: [number, number, number][] | null;
  /** 재생 진행률 0–1 */
  progress: number;
  /** 클릭 시 seek (0–1) */
  onSeek?: (fraction: number) => void;
  className?: string;
  chopDivisions?: number | null;
  activeChopIndex?: number | null;
}

const BAR_COUNT = 128;

export default function Waveform({ peaks, colors, progress, onSeek, className, chopDivisions, activeChopIndex }: WaveformProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!onSeek || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(fraction);
    },
    [onSeek]
  );

  // 색상 문자열 캐시 — peak 진폭으로 밝기 조절 (큰 소리=밝게, 잔잔한=어둡게)
  const colorStrs = useMemo(() => {
    if (!colors || colors.length === 0) return null;
    return colors.map((c, i) => {
      const peak = peaks[i] ?? 0;
      // 최소 25% 밝기, peak가 1이면 100%
      const lum = 0.45 + 0.55 * peak;
      return `rgb(${Math.round(c[0] * lum * 255)},${Math.round(c[1] * lum * 255)},${Math.round(c[2] * lum * 255)})`;
    });
  }, [colors, peaks]);

  const viewW = BAR_COUNT;
  const viewH = 32;
  const barW = 1;
  const gap = 0.25;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${viewW} ${viewH}`}
      preserveAspectRatio="none"
      className={cn("w-full cursor-pointer", className)}
      onClick={handleClick}
    >
      {/* Chop active segment highlight */}
      {chopDivisions && activeChopIndex != null && activeChopIndex >= 0 && (
        <rect
          x={(activeChopIndex / chopDivisions) * viewW}
          y={0}
          width={viewW / chopDivisions}
          height={viewH}
          className="fill-foreground/10"
        />
      )}
      {peaks.map((peak, i) => {
        const h = Math.max(peak * viewH * 0.92, 0.8);
        const x = i * barW;
        const y = (viewH - h) / 2;
        const played = i / peaks.length < progress;
        const barColor = colorStrs?.[i];

        return barColor ? (
          <rect
            key={i}
            x={x + gap / 2}
            y={y}
            width={barW - gap}
            height={h}
            rx={0.3}
            fill={barColor}
            fillOpacity={played ? 1.0 : 0.35}
          />
        ) : (
          <rect
            key={i}
            x={x + gap / 2}
            y={y}
            width={barW - gap}
            height={h}
            rx={0.3}
            className={played ? "fill-foreground" : "fill-muted-foreground/50"}
          />
        );
      })}
      {/* Chop division lines */}
      {chopDivisions && chopDivisions > 0 &&
        Array.from({ length: chopDivisions - 1 }, (_, i) => (
          <line
            key={`chop-${i}`}
            x1={((i + 1) / chopDivisions) * viewW}
            y1={0}
            x2={((i + 1) / chopDivisions) * viewW}
            y2={viewH}
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={0.3}
            strokeOpacity={0.4}
            strokeDasharray="1 1"
          />
        ))}
      {/* Playhead line */}
      <line
        x1={progress * viewW}
        y1={0}
        x2={progress * viewW}
        y2={viewH}
        stroke="hsl(var(--muted-foreground))"
        strokeWidth={0.5}
        strokeOpacity={0.6}
      />
    </svg>
  );
}
