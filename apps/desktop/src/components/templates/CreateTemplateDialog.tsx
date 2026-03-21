import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getStarterTemplate, WC_STARTER_TEMPLATES, type StarterTemplateKey } from "@/data/wc-starter-templates";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; starterKey: StarterTemplateKey }) => Promise<void>;
  isPending?: boolean;
};

export function CreateTemplateDialog({ open, onOpenChange, onCreate, isPending }: Props) {
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const [name, setName] = useState("");
  const [starterKey, setStarterKey] = useState<StarterTemplateKey>("blank");

  function handleClose(next: boolean) {
    if (!next) {
      setName("");
      setStarterKey("blank");
    }
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    await onCreate({ name: trimmed, starterKey });
    handleClose(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New document template</DialogTitle>
            <DialogDescription>Choose a name and optional starter content. You can edit everything after.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <label htmlFor={nameId} className="text-sm font-medium">
                Template name
              </label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lien notice to carrier"
                autoFocus
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium" id={`${baseId}-starter-label`}>
                Starter
              </span>
              <Select value={starterKey} onValueChange={(v) => setStarterKey(v as StarterTemplateKey)}>
                <SelectTrigger aria-labelledby={`${baseId}-starter-label`} className="w-full">
                  <SelectValue placeholder="Starter" />
                </SelectTrigger>
                <SelectContent>
                  {WC_STARTER_TEMPLATES.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{getStarterTemplate(starterKey).description}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
