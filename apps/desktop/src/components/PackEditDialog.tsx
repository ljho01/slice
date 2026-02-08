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
import type { Pack } from "@/types";

interface Props {
  pack: Pack | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: Pack) => void;
}

export default function PackEditDialog({ pack, open, onOpenChange, onSaved }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [saving, setSaving] = useState(false);

  // pack이 변경될 때 폼 초기화
  useEffect(() => {
    if (pack) {
      setName(pack.name || "");
      setGenre(pack.genre || "");
    }
  }, [pack]);

  const handleSave = useCallback(async () => {
    if (!pack || saving) return;
    setSaving(true);
    try {
      const update = {
        uuid: pack.uuid,
        name: name.trim() || pack.name,
        genre: genre.trim() || null,
      };
      const updated = await invoke<Pack>("update_pack", { update });
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      console.error("update_pack failed:", err);
    } finally {
      setSaving(false);
    }
  }, [pack, name, genre, saving, onSaved, onOpenChange]);

  if (!pack) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("packEdit.title")}</DialogTitle>
          <DialogDescription className="truncate">
            {pack.name}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* 팩 이름 */}
          <div className="grid gap-1.5">
            <Label htmlFor="edit-pack-name">{t("packEdit.packName")}</Label>
            <Input
              id="edit-pack-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("packEdit.packName")}
              className="h-9"
            />
          </div>

          {/* 장르 */}
          <div className="grid gap-1.5">
            <Label htmlFor="edit-pack-genre">{t("packEdit.genre")}</Label>
            <Input
              id="edit-pack-genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="예: Hip Hop, Trap, House"
              className="h-9"
            />
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
