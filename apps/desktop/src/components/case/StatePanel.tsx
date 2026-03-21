import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatePanel({
  title,
  message,
  variant = "empty",
  className
}: {
  title?: string;
  message: string;
  variant?: "empty" | "error";
  className?: string;
}) {
  const Icon = variant === "error" ? AlertTriangle : Inbox;

  return (
    <div
      className={cn(
        "rounded-lg border p-6 text-sm",
        variant === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-dashed text-muted-foreground",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div>
          {title ? <div className="font-medium">{title}</div> : null}
          <div className={title ? "mt-1" : ""}>{message}</div>
        </div>
      </div>
    </div>
  );
}
