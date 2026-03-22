import { useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import {
  Bot,
  TriangleAlert,
  FileText,
  FolderOpen,
  Home,
  LayoutTemplate,
  Loader2,
  Link2,
  ListChecks,
  LogOut,
  LockKeyhole,
  Package,
  RefreshCw,
  Rows3,
  ShieldCheck,
  Users
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { hasBrowserApiKeyAuth } from "@/config";
import { useAuthSession, useLogin, useLogout } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { getDisplayErrorMessage } from "@/lib/api-client";
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
  const authSession = useAuthSession();
  const login = useLogin();
  const logout = useLogout();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const sessionEnabled = authSession.data?.session_enabled ?? false;
  const serverApiKeyFallbackEnabled = authSession.data?.api_key_fallback_enabled ?? false;
  const browserApiKeyMode = hasBrowserApiKeyAuth();
  const browserApiKeyFallbackRequired = !sessionEnabled && serverApiKeyFallbackEnabled && !browserApiKeyMode;
  const requiresLogin = sessionEnabled && !authSession.data?.authenticated;
  const canLoadWorkspace = !authSession.isLoading && !authSession.error && !requiresLogin && !browserApiKeyFallbackRequired;
  const { projection, refresh, isFetching } = useProjection(caseId, { enabled: canLoadWorkspace });
  const matterName = projection?.slices.case_header?.name ?? "Matter";

  if (authSession.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--workbench-paper)] p-6">
        <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-lg">
          <CardContent className="flex items-center gap-3 p-6">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div>
              <div className="font-medium">Checking workspace access</div>
              <div className="text-sm text-muted-foreground">Loading auth state and current session…</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (authSession.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--workbench-paper)] p-6">
        <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">Auth check failed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {getDisplayErrorMessage(authSession.error, "Could not determine workspace auth state.")}
            </p>
            <Button variant="outline" onClick={() => void authSession.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (browserApiKeyFallbackRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--workbench-paper)] p-6">
        <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-lg">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="size-4" />
              Browser API-key fallback is not configured
            </div>
            <CardTitle className="text-2xl tracking-tight">Workspace access is blocked</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This API is running without browser session auth, so the desktop app needs shared-key browser fallback
              to reach the workspace. Set `VITE_WC_API_KEY` and `VITE_WC_ENABLE_API_KEY_FALLBACK=1` in the desktop
              build, or enable `WC_SESSION_SECRET` on the API server.
            </p>
            {serverApiKeyFallbackEnabled ? (
              <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900">
                The API reports shared-key fallback is available, but this desktop build is not forwarding a browser
                API key.
              </div>
            ) : null}
            <Button variant="outline" onClick={() => void authSession.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (requiresLogin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--workbench-paper)] p-6">
        <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-lg">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" />
              Hosted internal auth enabled
            </div>
            <CardTitle className="text-2xl tracking-tight">Sign in to WC Legal Prep</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This hosted workspace now uses server-authenticated sessions for browser access. Shared browser API keys
              remain transitional fallback only.
            </p>
            {authSession.data?.bootstrap_admin_pending ? (
              <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900">
                No active users are provisioned yet. Set `WC_BOOTSTRAP_ADMIN_EMAIL` and `WC_BOOTSTRAP_ADMIN_PASSWORD`
                on the API service, then restart it.
              </div>
            ) : null}
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void login.mutateAsync({ email, password }).catch(() => undefined);
              }}
            >
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="auth-email">
                  Email
                </label>
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="attorney@firm.example"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="auth-password">
                  Password
                </label>
                <Input
                  id="auth-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              {login.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {getDisplayErrorMessage(login.error, "Login failed")}
                </div>
              ) : null}
              <Button className="w-full" type="submit" disabled={login.isPending || authSession.data?.bootstrap_admin_pending}>
                {login.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <LockKeyhole className="mr-2 size-4" />}
                Sign in
              </Button>
            </form>
            {browserApiKeyMode && serverApiKeyFallbackEnabled ? (
              <div className="text-xs text-muted-foreground">
                Browser API-key mode is still configured locally, but this server requires session login for normal
                hosted use.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

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
              <div className="flex items-center gap-4">
                {caseId ? (
                  <div className="text-right text-sm text-muted-foreground">
                    <div>Projection-backed workspace</div>
                    <div>{truncateMiddle(caseId, 12, 8)}</div>
                  </div>
                ) : null}
                {authSession.data?.authenticated && authSession.data.user ? (
                  <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                    <div className="text-right">
                      <div className="text-sm font-medium">{authSession.data.user.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {authSession.data.user.role} · {authSession.data.user.email}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Sign out"
                      disabled={logout.isPending}
                      onClick={() => {
                        void logout.mutateAsync().then(() => {
                          window.location.assign("/");
                        }).catch(() => undefined);
                      }}
                    >
                      {logout.isPending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                    </Button>
                  </div>
                ) : browserApiKeyMode && serverApiKeyFallbackEnabled ? (
                  <Badge variant="outline">Shared API key mode</Badge>
                ) : null}
              </div>
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
