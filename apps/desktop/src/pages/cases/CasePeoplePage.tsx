import { useParams } from "react-router-dom";
import { Users, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { usePeopleTimeline } from "@/hooks/usePeopleTimeline";
import { formatLabel } from "@/ui/formatters";

export function CasePeoplePage() {
  const { caseId } = useParams();
  const { people, timeline, refresh, isFetching, isLoading } = usePeopleTimeline(caseId);

  if (!caseId) {
    return null;
  }

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">People & Timeline</h2>
          <p className="text-muted-foreground text-sm">
            Promoted contacts and a chronological feed from sync and PracticePanther entities.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isFetching}>
          Refresh
        </Button>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Users className="text-muted-foreground size-5" />
          <CardTitle className="text-base">People</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {people.length === 0 ? (
            <p className="text-muted-foreground text-sm">No promoted people yet. Sync PracticePanther to populate contacts.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {people.map((row) => {
                const p = row as Record<string, unknown>;
                return (
                  <div key={String(p.id)} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                    <div>
                      <div className="font-medium">{String(p.name ?? "")}</div>
                      <div className="text-muted-foreground text-xs">{String(p.role ?? "")}</div>
                    </div>
                    <div className="text-muted-foreground max-w-md text-right text-xs">
                      {[p.email, p.phone].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Clock className="text-muted-foreground size-5" />
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-muted-foreground text-sm">No timeline entries yet.</p>
          ) : (
            <ul className="space-y-2">
              {timeline.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm"
                >
                  <div>
                    <Badge variant="outline" className="mb-1 font-normal">
                      {formatLabel(entry.kind)}
                    </Badge>
                    <div className="font-medium">{entry.label}</div>
                    {entry.detail ? <div className="text-muted-foreground text-xs">{entry.detail}</div> : null}
                  </div>
                  <div className="text-muted-foreground shrink-0 text-xs">{entry.occurred_at ?? ""}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
