import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCaseList, useCreateCase } from "@/hooks/useCaseList";
import { getDisplayErrorMessage } from "@/lib/api-client";
import { formatDateTime, formatLabel } from "@/ui/formatters";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { StatePanel } from "@/components/case/StatePanel";

export function CaseListPage() {
  const navigate = useNavigate();
  const { data: cases = [], isLoading, error } = useCaseList();
  const createCase = useCreateCase();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    case_type: "wc",
    box_root_folder_id: "",
    employee_name: "",
    employer_name: "",
    hearing_date: ""
  });

  const filteredCases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return cases;
    }
    return cases.filter((item) =>
      [item.name, item.employee_name, item.employer_name, item.case_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [cases, search]);

  async function handleCreateCase() {
    try {
      const created = await createCase.mutateAsync({
        name: form.name.trim(),
        case_type: form.case_type,
        box_root_folder_id: form.box_root_folder_id.trim() || null,
        employee_name: form.employee_name.trim() || null,
        employer_name: form.employer_name.trim() || null,
        hearing_date: form.hearing_date.trim() || null
      });
      toast.success("Case created");
      setOpen(false);
      setForm({
        name: "",
        case_type: "wc",
        box_root_folder_id: "",
        employee_name: "",
        employer_name: "",
        hearing_date: ""
      });
      navigate(`/cases/${created.id}`);
    } catch (createError) {
      toast.error(getDisplayErrorMessage(createError, "Case creation failed"));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Cases</h2>
          <p className="text-sm text-muted-foreground">
            Start from a real matter list instead of pasting UUIDs into a debug screen.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" />
              New case
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create case</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <label htmlFor="case-name" className="text-sm font-medium">
                  Matter name
                </label>
                <Input
                  id="case-name"
                  placeholder="Matter name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="case-box-root" className="text-sm font-medium">
                  Box Client File folder ID
                </label>
                <Input
                  id="case-box-root"
                  placeholder="Box Client File folder ID"
                  value={form.box_root_folder_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, box_root_folder_id: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="case-employee-name" className="text-sm font-medium">
                  Employee name
                </label>
                <Input
                  id="case-employee-name"
                  placeholder="Employee name"
                  value={form.employee_name}
                  onChange={(event) => setForm((current) => ({ ...current, employee_name: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="case-employer-name" className="text-sm font-medium">
                  Employer name
                </label>
                <Input
                  id="case-employer-name"
                  placeholder="Employer name"
                  value={form.employer_name}
                  onChange={(event) => setForm((current) => ({ ...current, employer_name: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="case-hearing-date" className="text-sm font-medium">
                  Hearing date
                </label>
                <Input
                  id="case-hearing-date"
                  placeholder="YYYY-MM-DD"
                  value={form.hearing_date}
                  onChange={(event) => setForm((current) => ({ ...current, hearing_date: event.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!form.name.trim() || createCase.isPending} onClick={() => void handleCreateCase()}>
                {createCase.isPending ? "Creating…" : "Create case"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All matters</CardTitle>
          <CardDescription>Each row shows Box sync health and top-level hearing context.</CardDescription>
          <div className="relative max-w-sm">
            <label className="sr-only" htmlFor="case-search">
              Search matters
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="case-search"
              className="pl-9"
              placeholder="Search matters…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <StatePanel variant="error" message={getDisplayErrorMessage(error, "Failed to load cases.")} />
          ) : null}

          {isLoading ? (
            <PageSkeleton rows={5} />
          ) : filteredCases.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matter</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Hearing</TableHead>
                    <TableHead>Box</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCases.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/cases/${item.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/cases/${item.id}`);
                        }
                      }}
                    >
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.id}</div>
                      </TableCell>
                      <TableCell>{item.employee_name ?? "—"}</TableCell>
                      <TableCell>{item.employer_name ?? "—"}</TableCell>
                      <TableCell>{formatLabel(item.case_type)}</TableCell>
                      <TableCell>{item.hearing_date ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{formatLabel(item.box_connection_status ?? "inactive")}</Badge>
                      </TableCell>
                      <TableCell>{item.source_item_count ?? 0}</TableCell>
                      <TableCell>{formatDateTime(item.updated_at ?? item.created_at ?? null)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <StatePanel message="No matters yet. Create the first case and link a Box folder to begin." className="text-center" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
