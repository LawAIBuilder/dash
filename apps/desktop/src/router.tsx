import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { CaseConnectionsPage } from "@/pages/cases/CaseConnectionsPage";
import { CaseDocumentsPage } from "@/pages/cases/CaseDocumentsPage";
import { CaseExhibitsPage } from "@/pages/cases/CaseExhibitsPage";
import { CaseListPage } from "@/pages/cases/CaseListPage";
import { CaseOverviewPage } from "@/pages/cases/CaseOverviewPage";
import { CaseReviewPage } from "@/pages/cases/CaseReviewPage";
import { CaseTemplatesPage } from "@/pages/cases/CaseTemplatesPage";
import { RouteErrorPage } from "@/pages/RouteErrorPage";

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
        element: <CaseListPage />
      },
      {
        path: "cases/:caseId",
        element: <CaseOverviewPage />
      },
      {
        path: "cases/:caseId/documents",
        element: <CaseDocumentsPage />
      },
      {
        path: "cases/:caseId/review",
        element: <CaseReviewPage />
      },
      {
        path: "cases/:caseId/connections",
        element: <CaseConnectionsPage />
      },
      {
        path: "cases/:caseId/exhibits",
        element: <CaseExhibitsPage />
      },
      {
        path: "cases/:caseId/templates",
        element: <CaseTemplatesPage />
      }
    ]
  }
]);
