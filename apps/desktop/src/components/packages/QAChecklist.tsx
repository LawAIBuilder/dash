import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type QACheckItem = {
  check_id?: string;
  label?: string;
  status?: string;
  detail?: string;
};

type Props = {
  items: QACheckItem[];
  className?: string;
};

function statusVariant(status: string | undefined): "default" | "secondary" | "destructive" | "outline" {
  const s = (status ?? "").toLowerCase();
  if (s === "pass") return "secondary";
  if (s === "fail") return "destructive";
  if (s === "warn") return "outline";
  return "secondary";
}

export function QAChecklist({ items, className }: Props) {
  if (items.length === 0) {
    return (
      <div className={cn("text-muted-foreground text-sm", className)}>No QA checklist items in this run output.</div>
    );
  }

  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item, i) => (
        <li
          key={item.check_id ?? `qa-${i}`}
          className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium">{item.label ?? item.check_id ?? "Check"}</div>
            {item.detail ? <div className="text-muted-foreground mt-0.5 text-xs">{item.detail}</div> : null}
          </div>
          <Badge variant={statusVariant(item.status)} className="shrink-0 capitalize">
            {item.status ?? "—"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
