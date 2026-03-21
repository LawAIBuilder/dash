import { useEffect, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);

  const fileUrl = useMemo(() => {
    if (!file) {
      return null;
    }
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    setPageNumber(1);
    setPageCount(null);
  }, [file, open]);

  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>{title}</DialogTitle>
            {pageCount ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="min-w-24 text-center text-sm text-muted-foreground">
                  Page {pageNumber} of {pageCount}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pageNumber >= pageCount}
                  onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : null}
          </div>
        </DialogHeader>
        <div className="max-h-[calc(90vh-72px)] overflow-auto bg-muted/30 p-6">
          {fileUrl ? (
            <Document
              file={fileUrl}
              loading={<div className="text-sm text-muted-foreground">Loading PDF…</div>}
              onLoadSuccess={({ numPages }) => {
                setPageCount(numPages);
                setPageNumber((current) => Math.min(current, numPages));
              }}
            >
              <Page pageNumber={pageNumber} width={900} />
            </Document>
          ) : (
            <div className="text-sm text-muted-foreground">No PDF selected.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
