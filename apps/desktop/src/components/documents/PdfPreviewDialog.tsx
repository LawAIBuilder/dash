import { useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export function PdfPreviewDialog({
  open,
  title,
  file,
  onOpenChange
}: {
  open: boolean;
  title: string;
  file: Blob | null;
  onOpenChange: (open: boolean) => void;
}) {
  const fileUrl = useMemo(() => {
    if (!file) {
      return null;
    }
    return URL.createObjectURL(file);
  }, [file]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[calc(90vh-72px)] overflow-auto bg-muted/30 p-6">
          {fileUrl ? (
            <Document file={fileUrl} loading={<div className="text-sm text-muted-foreground">Loading PDF…</div>}>
              <Page pageNumber={1} width={900} />
            </Document>
          ) : (
            <div className="text-sm text-muted-foreground">No PDF selected.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
