import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { CaseConnectionsPage } from "@/pages/cases/CaseConnectionsPage";
import { CaseDocumentsPage } from "@/pages/cases/CaseDocumentsPage";
import { CaseListPage } from "@/pages/cases/CaseListPage";
import { CaseOverviewPage } from "@/pages/cases/CaseOverviewPage";
import { CaseReviewPage } from "@/pages/cases/CaseReviewPage";
import { LegacyDashboardPage } from "@/pages/LegacyDashboardPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/cases" replace />
  },
  {
    path: "/",
    element: <AppShell />,
    children: [
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
      }
    ]
  },
  {
    path: "/legacy",
    element: <LegacyDashboardPage />
  }
]);
