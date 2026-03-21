import { useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function RouteErrorPage() {
  const error = useRouteError() as Error | undefined;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-lg rounded-xl border bg-card p-8 text-center">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The workspace hit an unexpected rendering error. You can refresh the page or go back to your cases list.
        </p>
        {error?.message ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive">
            {error.message}
          </div>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" onClick={() => window.location.assign("/cases")}>
            Go to cases
          </Button>
          <Button onClick={() => window.location.reload()}>Refresh</Button>
        </div>
      </div>
    </div>
  );
}
