import { Suspense, lazy } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PdfPreviewDialog = lazy(async () => {
  const mod = await import("./PdfPreviewDialog");
  return { default: mod.PdfPreviewDialog };
});

type LazyPdfPreviewDialogProps = {
  open: boolean;
  title: string;
  file: Blob | null;
  onOpenChange: (open: boolean) => void;
};

function PreviewDialogFallback({ open, title, onOpenChange }: Omit<LazyPdfPreviewDialogProps, "file">) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title || "PDF preview"}</DialogTitle>
        </DialogHeader>
        <div className="py-6 text-sm text-muted-foreground">Loading PDF preview…</div>
      </DialogContent>
    </Dialog>
  );
}

export function LazyPdfPreviewDialog(props: LazyPdfPreviewDialogProps) {
  if (!props.open && !props.file) {
    return null;
  }

  return (
    <Suspense fallback={<PreviewDialogFallback open={props.open} title={props.title} onOpenChange={props.onOpenChange} />}>
      <PdfPreviewDialog {...props} />
    </Suspense>
  );
}
