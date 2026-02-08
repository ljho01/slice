import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import type { Sample } from "@/types";

const KEY_OPTIONS = [
  "", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  "Db", "Eb", "Gb", "Ab", "Bb",
];

interface Props {
  sample: Sample | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: Sample) => void;
}

export default function SampleEditDialog({ sample, open, onOpenChange, onSaved }: Props) {
  const { t } = useI18n();
  const [filename, setFilename] = useState("");
  const [tags, setTags] = useState("");
  const [genre, setGenre] = useState("");
  const [audioKey, setAudioKey] = useState("");
  const [chordType, setChordType] = useState("");
  const [bpm, setBpm] = useState("");
  const [sampleType, setSampleType] = useState("");
  const [saving, setSaving] = useState(false);

  // sample이 변경될 때 폼 초기화
  useEffect(() => {
    if (sample) {
      setFilename(sample.filename || "");
      setTags(sample.tags || "");
      setGenre(sample.genre || "");
      setAudioKey(sample.audio_key || "");
      setChordType(sample.chord_type || "");
      setBpm(sample.bpm != null ? String(sample.bpm) : "");
      setSampleType(sample.sample_type || "");
    }
  }, [sample]);

  const handleSave = useCallback(async () => {
    if (!sample || saving) return;
    setSaving(true);
    try {
      const update = {
        id: sample.id,
        filename: filename.trim() || sample.filename,
        tags: tags.trim() || null,
        genre: genre.trim() || null,
        audio_key: audioKey || null,
        chord_type: chordType || null,
        bpm: bpm ? parseInt(bpm, 10) : null,
        sample_type: sampleType || null,
      };
      const updated = await invoke<Sample>("update_sample", { update });
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      console.error("update_sample failed:", err);
    } finally {
      setSaving(false);
    }
  }, [sample, filename, tags, genre, audioKey, chordType, bpm, sampleType, saving, onSaved, onOpenChange]);

  if (!sample) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sampleEdit.title")}</DialogTitle>
          <DialogDescription className="truncate">
            {sample.filename}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* 파일명 */}
          <div className="grid gap-1.5">
            <Label htmlFor="edit-filename">{t("sampleEdit.filename")}</Label>
            <Input
              id="edit-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={t("sampleEdit.filename")}
              className="h-9"
            />
          </div>

          {/* 태그 */}
          <div className="grid gap-1.5">
            <Label htmlFor="edit-tags">{t("sampleEdit.tags")}</Label>
            <Input
              id="edit-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("sampleEdit.tagsPlaceholder")}
              className="h-9"
            />
            <p className="text-2xs text-muted-foreground">{t("sampleEdit.tagsHint")}</p>
          </div>

          {/* 장르 */}
          <div className="grid gap-1.5">
            <Label htmlFor="edit-genre">{t("sampleEdit.genre")}</Label>
            <Input
              id="edit-genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="예: Hip Hop, Trap, House"
              className="h-9"
            />
          </div>

          {/* 키 + 코드 타입 (한 줄) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-key">{t("sampleEdit.key")}</Label>
              <select
                id="edit-key"
                value={audioKey}
                onChange={(e) => setAudioKey(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t("common.none")}</option>
                {KEY_OPTIONS.filter(Boolean).map((k) => (
                  <option key={k} value={k.toLowerCase()}>{k}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-chord">{t("sampleEdit.chordType")}</Label>
              <select
                id="edit-chord"
                value={chordType}
                onChange={(e) => setChordType(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t("common.none")}</option>
                <option value="major">Major</option>
                <option value="minor">Minor</option>
              </select>
            </div>
          </div>

          {/* BPM + 타입 (한 줄) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-bpm">BPM</Label>
              <Input
                id="edit-bpm"
                type="number"
                min={0}
                max={999}
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                placeholder="예: 120"
                className="h-9"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-type">{t("sampleEdit.type")}</Label>
              <select
                id="edit-type"
                value={sampleType}
                onChange={(e) => setSampleType(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t("common.none")}</option>
                <option value="oneshot">One Shot</option>
                <option value="loop">Loop</option>
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
