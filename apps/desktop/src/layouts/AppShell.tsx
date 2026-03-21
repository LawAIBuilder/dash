import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import {
  Bot,
  FileText,
  FolderOpen,
  Home,
  LayoutTemplate,
  Link2,
  ListChecks,
  Package,
  RefreshCw,
  Rows3,
  Users
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatLabel, truncateMiddle } from "@/ui/formatters";
import { useProjection } from "@/hooks/useProjection";

const matterNav = [
  { to: "", label: "Overview", icon: Home },
  { to: "documents", label: "Documents", icon: FolderOpen },
  { to: "review", label: "Review", icon: ListChecks },
  { to: "people", label: "People & Timeline", icon: Users },
  { to: "packages", label: "Packages", icon: Package },
  { to: "exhibits", label: "Exhibits", icon: Rows3 },
  { to: "templates", label: "Templates", icon: LayoutTemplate },
  { to: "ai", label: "Package runs (AI)", icon: Bot },
  { to: "connections", label: "Connections", icon: Link2 }
];

export function AppShell() {
  const { caseId } = useParams();
  const { projection, refresh, isFetching } = useProjection(caseId);
  const matterName = projection?.slices.case_header?.name ?? "Matter";

  return (
    <div className="min-h-screen bg-[var(--workbench-paper)] text-foreground">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow focus:not-sr-only"
      >
        Skip to main content
      </a>
      <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
        <aside className="workbench-sidebar border-r border-border/80 bg-card/90 backdrop-blur">
          <div className="flex h-full flex-col p-4">
            <div className="mb-6">
              <Link to="/cases" className="flex items-center gap-2">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <FileText className="size-5" />
                </div>
                <div>
                  <div className="text-muted-foreground text-sm font-medium">WC Legal Prep</div>
                  <div className="text-lg font-semibold tracking-tight">Matter workbench</div>
                </div>
              </Link>
            </div>

            <nav className="mb-6 space-y-2">
              <NavLink
                to="/cases"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )
                }
              >
                <FolderOpen className="size-4" />
                Cases
              </NavLink>
            </nav>

            {caseId ? (
              <>
                <div className="mb-4 rounded-xl border bg-background p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-muted-foreground">Active matter</div>
                    <Badge variant="outline">{formatLabel(projection?.slices.case_header?.status ?? "loading")}</Badge>
                  </div>
                  <div className="font-semibold">{matterName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{truncateMiddle(caseId, 12, 8)}</div>
                </div>

                <div className="space-y-1">
                  {matterNav.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.label}
                        end={item.to === ""}
                        to={item.to === "" ? `/cases/${caseId}` : `/cases/${caseId}/${item.to}`}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )
                        }
                      >
                        <Icon className="size-4" />
                        {item.label}
                      </NavLink>
                    );
                  })}
                </div>

                <div className="mt-auto pt-6">
                  <Button variant="outline" className="w-full justify-start gap-2" onClick={() => void refresh()}>
                    <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
                    Refresh projection
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed bg-background/80 p-4 text-sm text-muted-foreground">
                Pick a case to open the matter workspace.
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="workbench-header border-b border-border/80 bg-card/60 px-6 py-4 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-muted-foreground text-sm">Workers' compensation · legal workbench</div>
                <h1 className="text-2xl font-semibold tracking-tight">{caseId ? matterName : "Cases"}</h1>
              </div>
              {caseId ? (
                <div className="text-right text-sm text-muted-foreground">
                  <div>Projection-backed workspace</div>
                  <div>{truncateMiddle(caseId, 12, 8)}</div>
                </div>
              ) : null}
            </div>
          </header>

          <main id="main-content" className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
