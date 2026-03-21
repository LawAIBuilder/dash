import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";

function getRouteErrorMessage(error: unknown): string | null {
  if (isRouteErrorResponse(error)) {
    if (typeof error.data === "string" && error.data.trim()) {
      return `${error.status} ${error.statusText}: ${error.data}`;
    }
    return `${error.status} ${error.statusText}`.trim();
  }

  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown route error";
    }
  }

  return null;
}

export function RouteErrorPage() {
  const error = useRouteError();
  const message = getRouteErrorMessage(error);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-lg rounded-xl border bg-card p-8 text-center">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The workspace hit an unexpected rendering error. You can refresh the page or go back to your cases list.
        </p>
        {message ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive">
            {message}
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
