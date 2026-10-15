"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleOff, Download, Pencil, Plus, Trash2, TriangleAlert, Upload, Users } from "lucide-react";
import { toast } from "sonner";

import { PersonPicker, type Person } from "@/components/formats/person-picker";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CSV_COLUMNS,
  CSV_TEMPLATE,
  parseExpenseCsv,
  STAGE_LABEL,
  validateRow,
  type CsvParseResult,
  type ExpenseResponsible,
  type ExpenseResponsibleInput,
  type ExpenseStage,
} from "@/libs/expense-responsibles";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import {
  createExpenseResponsible,
  deleteExpenseResponsible,
  fetchExpenseResponsibles,
  importExpenseResponsibles,
  updateExpenseResponsible,
} from "@/services/expense-responsibles-service";

const selectClass =
  "h-10 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40";

const money = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 2 });
/** El backend guarda «*» cuando una fila de la etapa por tipo de gasto vale para cualquier área. */
const areaLabel = (area: string) => (area === "*" ? "Todas" : area);

function amountRange(min: number | null, max: number | null) {
  if (min === null && max === null) return "Cualquier monto";
  if (min !== null && max !== null) return `${money(min)} a ${money(max)}`;
  return min !== null ? `Desde ${money(min)}` : `Hasta ${money(max!)}`;
}

const toInput = (r: ExpenseResponsible): ExpenseResponsibleInput => ({
  area: r.area,
  expenseType: r.expenseType,
  concept: r.concept,
  stage: r.stage,
  minAmount: r.minAmount,
  maxAmount: r.maxAmount,
  signerId: r.signerId,
  name: r.name,
  email: r.email,
  active: r.active,
});

export default function ResponsablesGastoPage() {
  const { roles } = useSession();
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["expense-responsibles"], queryFn: fetchExpenseResponsibles, enabled: isAdmin });

  const [stage, setStage] = useState<"" | ExpenseStage>("");
  const [area, setArea] = useState("");
  const [type, setType] = useState("");
  const [concept, setConcept] = useState("");
  const [editing, setEditing] = useState<ExpenseResponsible | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<ExpenseResponsible | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["expense-responsibles"] });

  const toggle = useMutation({
    mutationFn: (r: ExpenseResponsible) => updateExpenseResponsible(r.id, { ...toInput(r), active: !r.active }),
    onSuccess: (_d, r) => {
      toast.success(r.active ? "Responsable desactivado." : "Responsable activado.");
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cambiar el estado."),
  });
  const remove = useMutation({
    mutationFn: (r: ExpenseResponsible) => deleteExpenseResponsible(r.id),
    onSuccess: () => {
      toast.success("Responsable eliminado.");
      setRemoving(null);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar."),
  });

  const all = useMemo(() => list.data ?? [], [list.data]);
  const areas = useMemo(() => [...new Set(all.map((r) => r.area).filter((a) => a !== "*"))].sort((a, b) => a.localeCompare(b, "es-MX")), [all]);
  const rows = useMemo(() => {
    const q = type.trim().toLowerCase();
    const c = concept.trim().toLowerCase();
    return all
      .filter((r) => (!stage || r.stage === stage) && (!area || r.area === area) && (!q || (r.expenseType ?? "").toLowerCase().includes(q)) && (!c || (r.concept ?? "").toLowerCase().includes(c)))
      .sort((a, b) => a.area.localeCompare(b.area, "es-MX") || (a.expenseType ?? "").localeCompare(b.expenseType ?? "", "es-MX"));
  }, [all, stage, area, type, concept]);

  return (
    <AppShell title="Responsables de gasto">
      {!isAdmin ? (
        <p className="max-w-md text-sm text-muted-foreground">Solo el administrador puede ver y editar la matriz de responsables de gasto.</p>
      ) : (
        <div className="max-w-5xl">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <p className="max-w-xl text-sm text-muted-foreground">
              La matriz indica quién autoriza un gasto según el área, el tipo de gasto y el monto. Los pasos de un flujo «Según matriz de
              gastos» se asignan solos cuando hay coincidencia; si no, se pregunta a quien usa el formato.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload /> Importar CSV
              </Button>
              <Button onClick={() => setEditing("new")}>
                <Plus /> Nuevo responsable
              </Button>
            </div>
          </div>

          <form
            role="search"
            aria-label="Filtrar la matriz"
            className="mb-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => e.preventDefault()}
          >
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Etapa</span>
              <select className={cn(selectClass, "min-w-56")} value={stage} onChange={(e) => setStage(e.target.value as "" | ExpenseStage)}>
                <option value="">Todas</option>
                {(Object.keys(STAGE_LABEL) as ExpenseStage[]).map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Área</span>
              <select className={cn(selectClass, "min-w-44")} value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">Todas</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Tipo de gasto</span>
              <Input className="h-10 w-48" placeholder="Buscar…" value={type} onChange={(e) => setType(e.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Concepto</span>
              <Input className="h-10 w-56" placeholder="Buscar…" value={concept} onChange={(e) => setConcept(e.target.value)} />
            </label>
            {stage || area || type || concept ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setStage("");
                  setArea("");
                  setType("");
                  setConcept("");
                }}
              >
                Quitar filtros
              </Button>
            ) : null}
          </form>

          {list.isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Cargando la matriz">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          ) : list.isError ? (
            <div role="alert" className="rounded-lg border border-border p-5 text-sm">
              No se pudo cargar la matriz de responsables. {list.error instanceof Error ? list.error.message : ""}{" "}
              <Button variant="link" onClick={() => list.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : all.length === 0 ? (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-14 text-center">
              <Users className="size-8 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-base font-medium">Aún no hay responsables de gasto</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Agrégalos uno por uno o importa un CSV. Descarga la plantilla desde «Importar CSV».
              </p>
            </div>
          ) : rows.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              Ningún responsable coincide con los filtros.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <caption className="sr-only">Matriz de responsables de gasto ({rows.length} filas)</caption>
                <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-medium">Etapa</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Área</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Tipo de gasto</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Concepto</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Monto</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Responsable</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Estado</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={cn("border-b border-border last:border-0", !r.active && "text-muted-foreground")}>
                      <td className="px-3 py-2.5">{STAGE_LABEL[r.stage]}</td>
                      <td className="px-3 py-2.5">{areaLabel(r.area)}</td>
                      <td className="px-3 py-2.5">{r.expenseType ?? "—"}</td>
                      <td className="px-3 py-2.5">{r.concept ?? "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{amountRange(r.minAmount, r.maxAmount)}</td>
                      <td className="px-3 py-2.5">
                        <span className="block font-medium">{r.name}</span>
                        <span className="block text-xs text-muted-foreground">{r.email || r.signerId}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant={r.active ? "success" : "neutral"}>
                          {r.active ? <CircleCheck className="size-3.5" aria-hidden /> : <CircleOff className="size-3.5" aria-hidden />}
                          {r.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>
                            {r.active ? "Desactivar" : "Activar"}
                            <span className="sr-only"> a {r.name} en {areaLabel(r.area)}</span>
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`Editar a ${r.name} en ${areaLabel(r.area)}`} onClick={() => setEditing(r)}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`Eliminar a ${r.name} en ${areaLabel(r.area)}`} onClick={() => setRemoving(r)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {editing ? (
            <RowDialog
              key={editing === "new" ? "new" : editing.id}
              row={editing === "new" ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void refresh();
              }}
            />
          ) : null}
          {importing ? (
            <ImportDialog
              currentCount={all.length}
              onClose={() => setImporting(false)}
              onDone={() => {
                setImporting(false);
                void refresh();
              }}
            />
          ) : null}
          <ConfirmDialog
            open={removing !== null}
            onOpenChange={(o) => !o && setRemoving(null)}
            title="¿Eliminar este responsable?"
            description={
              removing
                ? `Se quitará a ${removing.name} de ${STAGE_LABEL[removing.stage].toLowerCase()} en ${areaLabel(removing.area)}. Los pasos que dependían de esta fila volverán a preguntar a quien use el formato.`
                : ""
            }
            confirmLabel="Eliminar"
            destructive
            pending={remove.isPending}
            onConfirm={() => removing && remove.mutate(removing)}
          />
        </div>
      )}
    </AppShell>
  );
}

function RowDialog({ row, onClose, onSaved }: { row: ExpenseResponsible | null; onClose: () => void; onSaved: () => void }) {
  const uid = useId();
  const [stage, setStage] = useState<ExpenseStage>(row?.stage ?? "area");
  const [area, setArea] = useState(row?.area && row.area !== "*" ? row.area : "");
  const [expenseType, setExpenseType] = useState(row?.expenseType ?? "");
  const [concept, setConcept] = useState(row?.concept ?? "");
  const [min, setMin] = useState(row?.minAmount?.toString() ?? "");
  const [max, setMax] = useState(row?.maxAmount?.toString() ?? "");
  const [person, setPerson] = useState<Person | null>(row ? { signerId: row.signerId, name: row.name, email: row.email } : null);
  const [active, setActive] = useState(row?.active ?? true);
  const [errors, setErrors] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: (body: ExpenseResponsibleInput) => (row ? updateExpenseResponsible(row.id, body) : createExpenseResponsible(body)),
    onSuccess: () => {
      toast.success(row ? "Responsable actualizado." : "Responsable agregado.");
      onSaved();
    },
    onError: (e: Error) => setErrors([e.message || "No se pudo guardar."]),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = validateRow({
      stage,
      area,
      expenseType,
      concept,
      minAmount: min,
      maxAmount: max,
      signerId: person?.signerId ?? "",
      name: person?.name ?? person?.email ?? person?.signerId ?? "",
      email: person?.email ?? "",
    });
    const problems = [...res.errors];
    if (!person) problems.splice(0, problems.length, ...problems.filter((p) => !/responsable|nombre/.test(p)), "Elige a la persona responsable.");
    setErrors(problems);
    if (res.row && person) save.mutate({ ...res.row, active });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? "Editar responsable" : "Nuevo responsable"}</DialogTitle>
          <DialogDescription>Quién autoriza el gasto cuando coinciden la etapa, el área, el tipo de gasto y el monto.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-stage`} className="text-sm font-medium">Etapa</label>
            <select id={`${uid}-stage`} className={cn(selectClass, "w-full")} value={stage} onChange={(e) => setStage(e.target.value as ExpenseStage)}>
              {(Object.keys(STAGE_LABEL) as ExpenseStage[]).map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-area`} className="text-sm font-medium">Área</label>
            <Input id={`${uid}-area`} className="h-10" value={area} onChange={(e) => setArea(e.target.value)} aria-required="true" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-type`} className="text-sm font-medium">
              Tipo de gasto{" "}
              <span className="font-normal text-muted-foreground">{stage === "tipoGasto" ? "(obligatorio)" : "(opcional)"}</span>
            </label>
            <Input id={`${uid}-type`} className="h-10" value={expenseType} onChange={(e) => setExpenseType(e.target.value)} aria-required={stage === "tipoGasto"} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-concept`} className="text-sm font-medium">
              Concepto <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Input id={`${uid}-concept`} className="h-10" placeholder="Ej. Renta oficinas" value={concept} onChange={(e) => setConcept(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-min`} className="text-sm font-medium">Monto mínimo <span className="font-normal text-muted-foreground">(opcional)</span></label>
              <Input id={`${uid}-min`} className="h-10" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-max`} className="text-sm font-medium">Monto máximo <span className="font-normal text-muted-foreground">(opcional)</span></label>
              <Input id={`${uid}-max`} className="h-10" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Responsable</span>
            <PersonPicker label="Responsable del gasto" value={person} onChange={setPerson} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[#84bd00]" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Activo (se usa al resolver los pasos)
          </label>

          {errors.length > 0 ? (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-[#fbe9e7] p-3 text-sm text-[#8c2018]">
              {errors.map((m) => (
                <li key={m} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {m}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function downloadTemplate() {
  const blob = new Blob(["﻿" + CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-responsables-gasto.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function ImportDialog({ currentCount, onClose, onDone }: { currentCount: number; onClose: () => void; onDone: () => void }) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const [replace, setReplace] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const send = useMutation({
    mutationFn: () => importExpenseResponsibles(result!.rows, replace),
    onSuccess: () => {
      toast.success(`Se importaron ${result!.rows.length} filas${replace ? " y se reemplazó la matriz anterior" : ""}.`);
      onDone();
    },
    onError: (e: Error) => {
      setConfirming(false);
      toast.error(e.message || "No se pudo importar.");
    },
  });

  async function onFile(f: File | undefined) {
    setResult(null);
    setFileName(f?.name ?? "");
    if (!f) return;
    setResult(parseExpenseCsv(await f.text()));
  }

  const ok = result !== null && result.errors.length === 0 && result.rows.length > 0;
  const shownErrors = result?.errors.slice(0, 50) ?? [];

  return (
    <>
      <Dialog open={!confirming} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Importar responsables desde CSV</DialogTitle>
            <DialogDescription>
              Columnas: <span className="font-mono text-xs">{CSV_COLUMNS.join(", ")}</span>. Separador coma o punto y coma. La etapa es
              «area» o «tipoGasto». Se valida todo el archivo antes de enviar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download /> Descargar plantilla CSV
            </Button>

            <div className="space-y-1.5">
              <label htmlFor={`${uid}-file`} className="text-sm font-medium">Archivo CSV</label>
              <input
                id={`${uid}-file`}
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void onFile(e.target.files?.[0])}
                className="block w-full text-sm file:mr-3 file:h-10 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium"
              />
            </div>

            {result ? (
              ok ? (
                <p role="status" className="flex items-start gap-2 rounded-md bg-[#eaf3d6] p-3 text-sm text-[#3f5900]">
                  <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {fileName}: {result.rows.length} {result.rows.length === 1 ? "fila válida" : "filas válidas"}, listas para importar.
                </p>
              ) : (
                <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-[#fbe9e7] p-3 text-sm text-[#8c2018]">
                  <p className="flex items-start gap-2 font-medium">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {result.errors.length} {result.errors.length === 1 ? "error" : "errores"} en {fileName}. No se envió nada; corrige el archivo y súbelo de nuevo.
                  </p>
                  <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-9">
                    {shownErrors.map((e, i) => (
                      <li key={i}>{e.line > 0 ? `Línea ${e.line}: ` : ""}{e.message}</li>
                    ))}
                  </ul>
                  {result.errors.length > shownErrors.length ? <p className="pl-6">…y {result.errors.length - shownErrors.length} más.</p> : null}
                </div>
              )
            ) : null}

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[#84bd00]" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <span>
                Reemplazar las existentes
                <span className="block text-xs text-muted-foreground">
                  {replace
                    ? `Se borrarán las ${currentCount} filas actuales y quedarán solo las del archivo.`
                    : "Si no la marcas, las filas del archivo se suman a las que ya existen."}
                </span>
              </span>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" disabled={!ok || send.isPending} onClick={() => (replace ? setConfirming(true) : send.mutate())}>
              {send.isPending ? "Importando…" : replace ? "Reemplazar e importar…" : "Importar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="¿Reemplazar toda la matriz?"
        description={`Se borrarán las ${currentCount} filas actuales y se cargarán ${result?.rows.length ?? 0} del archivo. Esta acción no se puede deshacer.`}
        confirmLabel="Sí, reemplazar"
        destructive
        pending={send.isPending}
        onConfirm={() => send.mutate()}
      />
    </>
  );
}
