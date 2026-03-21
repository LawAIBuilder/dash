import { Suspense, lazy, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { RouteErrorPage } from "@/pages/RouteErrorPage";

const CaseListPage = lazy(() =>
  import("@/pages/cases/CaseListPage").then((module) => ({ default: module.CaseListPage }))
);
const CaseOverviewPage = lazy(() =>
  import("@/pages/cases/CaseOverviewPage").then((module) => ({ default: module.CaseOverviewPage }))
);
const CaseDocumentsPage = lazy(() =>
  import("@/pages/cases/CaseDocumentsPage").then((module) => ({ default: module.CaseDocumentsPage }))
);
const CaseReviewPage = lazy(() =>
  import("@/pages/cases/CaseReviewPage").then((module) => ({ default: module.CaseReviewPage }))
);
const CasePeoplePage = lazy(() =>
  import("@/pages/cases/CasePeoplePage").then((module) => ({ default: module.CasePeoplePage }))
);
const CasePackagesPage = lazy(() =>
  import("@/pages/cases/CasePackagesPage").then((module) => ({ default: module.CasePackagesPage }))
);
const CaseConnectionsPage = lazy(() =>
  import("@/pages/cases/CaseConnectionsPage").then((module) => ({ default: module.CaseConnectionsPage }))
);
const CaseExhibitsPage = lazy(() =>
  import("@/pages/cases/CaseExhibitsPage").then((module) => ({ default: module.CaseExhibitsPage }))
);
const CaseTemplatesPage = lazy(() =>
  import("@/pages/cases/CaseTemplatesPage").then((module) => ({ default: module.CaseTemplatesPage }))
);
const CaseAIPage = lazy(() =>
  import("@/pages/cases/CaseAIPage").then((module) => ({ default: module.CaseAIPage }))
);

function withRouteSuspense(element: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground shadow-sm">
          Loading workspace...
        </div>
      }
    >
      {element}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        element: <Navigate to="/cases" replace />
      },
      {
        path: "cases",
        element: withRouteSuspense(<CaseListPage />)
      },
      {
        path: "cases/:caseId",
        element: withRouteSuspense(<CaseOverviewPage />)
      },
      {
        path: "cases/:caseId/documents",
        element: withRouteSuspense(<CaseDocumentsPage />)
      },
      {
        path: "cases/:caseId/review",
        element: withRouteSuspense(<CaseReviewPage />)
      },
      {
        path: "cases/:caseId/people",
        element: withRouteSuspense(<CasePeoplePage />)
      },
      {
        path: "cases/:caseId/packages",
        element: withRouteSuspense(<CasePackagesPage />)
      },
      {
        path: "cases/:caseId/connections",
        element: withRouteSuspense(<CaseConnectionsPage />)
      },
      {
        path: "cases/:caseId/exhibits",
        element: withRouteSuspense(<CaseExhibitsPage />)
      },
      {
        path: "cases/:caseId/templates",
        element: withRouteSuspense(<CaseTemplatesPage />)
      },
      {
        path: "cases/:caseId/ai",
        element: withRouteSuspense(<CaseAIPage />)
      }
    ]
  }
]);
