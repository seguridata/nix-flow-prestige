"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Crosshair, FileUp, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FlowEditor } from "@/components/formats/flow-editor";
import { PdfSurface, useContainerWidth } from "@/components/formats/pdf-surface";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ENVELOPE_METHOD_OPTIONS, KYC_OPTIONS } from "@/libs/envelope-template";
import { emptyFlow, flowProblems, type Flow } from "@/libs/flow";
import { placeField, syncFields, unplacedVariables } from "@/libs/format-draft";
import type { SignatureMethod } from "@/libs/types";
import { cn } from "@/libs/utils";
import {
  createFormat,
  deleteFormat,
  fetchFlowDefinitions,
  fetchSignaturePolicy,
  formatPdfUrl,
  setFormatPublished,
  updateFormat,
  type FormatDetail,
  type FormatDraft,
  type FormatField,
} from "@/services/formats-service";

const PREFILLS: { value: NonNullable<FormatField["prefill"]> | ""; label: string }[] = [
  { value: "", label: "Lo escribe quien usa el formato" },
  { value: "user.name", label: "Nombre de quien solicita" },
  { value: "user.email", label: "Correo de quien solicita" },
  { value: "today", label: "Fecha de hoy" },
];

const selectClass =
  "h-10 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40";

/** Alta y edición de un formato: PDF base, datos, flujo, colocación de campos y reglas de firma. */
export function FormatEditor({ initial }: { initial?: FormatDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);

  const [saved, setSaved] = useState<FormatDetail | undefined>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [flow, setFlow] = useState<Flow>(initial?.flow ?? { ...emptyFlow() });
  const [flowRef, setFlowRef] = useState<{ key: string; version: number } | null>(
    initial?.flowKey && initial.flowVersion ? { key: initial.flowKey, version: initial.flowVersion } : null,
  );
  const [fields, setFields] = useState<FormatField[]>(initial?.fields ?? []);
  const [methods, setMethods] = useState<SignatureMethod[] | null>((initial?.methods as SignatureMethod[] | undefined) ?? null);
  const [kycPolicy, setKycPolicy] = useState<FormatDraft["kycPolicy"]>(initial?.kycPolicy ?? "NONE");
  const [requirePasskey, setRequirePasskey] = useState(initial?.requirePasskey ?? false);
  const [dirty, setDirty] = useState(!initial);
  const [pages, setPages] = useState(initial?.pageCount ?? 1);
  const [page, setPage] = useState(1);
  const [placing, setPlacing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const policy = useQuery({ queryKey: ["signature-policy"], queryFn: fetchSignaturePolicy, staleTime: 5 * 60_000 });
  const allowed = policy.data?.allowedMethods;
  // Sin elección propia se parte de Autógrafa (lo natural en un formato) si la política la permite.
  // Un formato guardado puede traer métodos que la política ya no permite: no se arrastran en silencio.
  const chosenMethods: SignatureMethod[] = (
    methods ?? (allowed ? (allowed.includes("AUTOGRAFA") ? ["AUTOGRAFA"] : allowed.slice(0, 1)) : [])
  ).filter((m) => !allowed || allowed.includes(m));

  const published = useQuery({ queryKey: ["flows", "published"], queryFn: () => fetchFlowDefinitions(true) });
  const baseFlows = (published.data ?? []).filter((d) => d.flow);

  const cleanFields = useMemo(() => syncFields(fields, flow.variables), [fields, flow.variables]);
  const unplaced = unplacedVariables(cleanFields, flow.variables);
  const problems = [
    ...(name.trim().length < 3 ? ["Ponle un nombre al formato (mínimo 3 letras)."] : []),
    ...(!saved && !file ? ["Sube el PDF base."] : []),
    ...flowProblems(flow),
  ];

  const draft = (): FormatDraft => ({
    name: name.trim(),
    description: description.trim() || undefined,
    category: category.trim() || undefined,
    fields: cleanFields,
    signatureBoxes: saved?.signatureBoxes ?? [],
    flow,
    flowKey: flowRef?.key,
    flowVersion: flowRef?.version,
    methods: chosenMethods,
    kycPolicy,
    requirePasskey,
  });

  const save = useMutation({
    mutationFn: () => (saved ? updateFormat(saved.id, draft()) : createFormat(file!, draft())),
    onSuccess: async (f) => {
      const wasNew = !saved;
      setSaved(f);
      setFields(f.fields);
      setDirty(false);
      setFile(null);
      toast.success(wasNew ? "Formato creado como borrador." : "Cambios guardados.");
      await queryClient.invalidateQueries({ queryKey: ["formats"] });
      await queryClient.invalidateQueries({ queryKey: ["format", f.id] });
      if (wasNew) router.replace(`/formatos/${f.id}/editar` as never);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: (next: boolean) => setFormatPublished(saved!.id, next),
    onSuccess: async (f) => {
      setSaved(f);
      toast.success(f.published ? "Formato publicado: ya lo ve todo el mundo." : "Formato despublicado.");
      await queryClient.invalidateQueries({ queryKey: ["formats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteFormat(saved!.id),
    onSuccess: async () => {
      toast.success("Formato eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["formats"] });
      router.push("/formatos" as never);
    },
    onError: (e: Error) => {
      setConfirmDelete(false);
      toast.error(e.message);
    },
  });

  const { ref, width } = useContainerWidth(560);
  const pdfSource: string | File | null = file ?? (saved ? formatPdfUrl(saved.id) : null);
  const placingVar = flow.variables.find((v) => v.key === placing) ?? null;

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
      <div className="space-y-10">
        <Link href={"/formatos" as never} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Todos los formatos
        </Link>

        <section aria-labelledby="ed-gen" className="space-y-4">
          <h2 id="ed-gen" className="text-base font-semibold">
            Documento base
          </h2>
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <FileUp className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{file ? file.name : saved ? "PDF guardado" : "Aún no hay PDF"}</span>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (saved) {
                  toast.error("Para cambiar el PDF, crea un formato nuevo: así los envíos ya hechos conservan su documento.");
                  return;
                }
                setFile(f);
                setDirty(true);
                if (!name.trim()) setName(f.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " "));
              }}
            />
            {!saved ? (
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
                {file ? "Cambiar" : "Elegir PDF"}
              </Button>
            ) : null}
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Nombre del formato</span>
            <Input value={name} maxLength={120} placeholder="Ej. Solicitud de vacaciones" onChange={(e) => touch(setName)(e.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Categoría (opcional)</span>
              <Input value={category} maxLength={60} placeholder="Ej. Recursos Humanos" onChange={(e) => touch(setCategory)(e.target.value)} />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Descripción (opcional)</span>
              <Input value={description} maxLength={300} onChange={(e) => touch(setDescription)(e.target.value)} />
            </label>
          </div>
        </section>

        <section aria-labelledby="ed-flujo" className="space-y-4">
          <div>
            <h2 id="ed-flujo" className="text-base font-semibold">
              Flujo de firmas
            </h2>
            {baseFlows.length > 0 ? (
              <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Partir de un flujo publicado:</span>
                <select
                  className={selectClass}
                  value=""
                  onChange={(e) => {
                    const def = baseFlows.find((d) => d.id === e.target.value);
                    if (!def?.flow) return;
                    setFlow(def.flow);
                    setFlowRef({ key: def.key, version: def.version });
                    setDirty(true);
                  }}
                >
                  <option value="">{flowRef ? `Basado en «${flowRef.key}» v${flowRef.version}` : "Elige uno…"}</option>
                  {baseFlows.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · v{d.version}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <FlowEditor
            value={flow}
            onChange={(f) => {
              setFlow(f);
              setFlowRef(null);
              setDirty(true);
            }}
          />
        </section>

        <section aria-labelledby="ed-campos" className="space-y-3">
          <div>
            <h2 id="ed-campos" className="text-base font-semibold">
              Dónde va cada dato
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Elige un dato y dibuja un rectángulo sobre el documento.</p>
          </div>
          {flow.variables.length === 0 ? (
            <p className="text-sm text-muted-foreground">Primero agrega los datos que se piden, arriba.</p>
          ) : (
            <ul className="space-y-2">
              {flow.variables.map((v) => {
                const f = cleanFields.find((x) => x.key === v.key);
                return (
                  <li key={v.key} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{v.label || v.key}</span>
                        <span className="block text-xs text-muted-foreground">{f ? `Colocado en la página ${f.page}` : "Sin colocar: no aparecerá en el documento"}</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant={placing === v.key ? "default" : "outline"}
                        aria-pressed={placing === v.key}
                        onClick={() => {
                          setPlacing(placing === v.key ? null : v.key);
                          if (f) setPage(f.page);
                        }}
                      >
                        <Crosshair /> {placing === v.key ? "Dibuja sobre el PDF" : f ? "Recolocar" : "Colocar"}
                      </Button>
                      {f ? (
                        <Button type="button" size="icon" variant="ghost" aria-label={`Quitar «${v.label || v.key}» del documento`} onClick={() => touch(setFields)(fields.filter((x) => x.key !== v.key))}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                    {f ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {v.type === "text" || v.type === "date" ? (
                          <select
                            className={selectClass}
                            aria-label={`Valor inicial de ${v.label}`}
                            value={f.prefill ?? ""}
                            onChange={(e) => touch(setFields)(fields.map((x) => (x.key === v.key ? { ...x, prefill: (e.target.value || undefined) as FormatField["prefill"] } : x)))}
                          >
                            {PREFILLS.filter((p) => v.type === "text" || p.value === "" || p.value === "today").map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <label className="flex items-center gap-1.5 text-sm">
                          Tamaño
                          <Input
                            type="number"
                            min={6}
                            max={32}
                            className="h-10 w-20"
                            value={f.fontSize ?? 11}
                            onChange={(e) => touch(setFields)(fields.map((x) => (x.key === v.key ? { ...x, fontSize: Math.max(6, Math.min(32, Number(e.target.value) || 11)) } : x)))}
                          />
                        </label>
                        <select
                          className={selectClass}
                          aria-label="Alineación"
                          value={f.align ?? "left"}
                          onChange={(e) => touch(setFields)(fields.map((x) => (x.key === v.key ? { ...x, align: e.target.value as "left" | "center" } : x)))}
                        >
                          <option value="left">Alinear a la izquierda</option>
                          <option value="center">Centrar</option>
                        </select>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="ed-reglas" className="space-y-4">
          <h2 id="ed-reglas" className="text-base font-semibold">
            Reglas de firma
          </h2>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Métodos permitidos</legend>
            <div className="flex flex-wrap gap-2">
              {ENVELOPE_METHOD_OPTIONS.filter((m) => !allowed || allowed.includes(m.value)).map((m) => {
                const on = chosenMethods.includes(m.value);
                return (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => touch(setMethods)(on ? chosenMethods.filter((x) => x !== m.value) : [...chosenMethods, m.value])}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted",
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              Verificación de identidad
              <select className={selectClass} value={kycPolicy} onChange={(e) => touch(setKycPolicy)(e.target.value as FormatDraft["kycPolicy"])}>
                {KYC_OPTIONS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={requirePasskey} onCheckedChange={touch(setRequirePasskey)} />
              Exigir passkey
            </label>
          </div>
        </section>

        {problems.length > 0 && dirty ? (
          <ul role="status" className="space-y-1 rounded-md border border-border bg-muted/50 p-3 text-sm">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : null}
        {unplaced.length > 0 && saved ? (
          <p className="text-sm text-muted-foreground">
            Sin colocar en el documento: {unplaced.map((v) => v.label || v.key).join(", ")}. Se piden, pero no aparecen impresos.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button disabled={problems.length > 0 || !dirty || chosenMethods.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando…" : saved ? "Guardar cambios" : "Crear formato"}
          </Button>
          {saved ? (
            <Button variant="outline" disabled={dirty || publish.isPending} onClick={() => publish.mutate(!saved.published)}>
              {saved.published ? "Despublicar" : "Publicar para todos"}
            </Button>
          ) : null}
          {saved ? (
            <Button variant="ghost" className="ml-auto text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Eliminar
            </Button>
          ) : null}
          {dirty && saved ? <span className="w-full text-sm text-muted-foreground">Guarda los cambios para poder publicar.</span> : null}
          {chosenMethods.length === 0 ? <span className="w-full text-sm text-muted-foreground">Elige al menos un método de firma.</span> : null}
        </div>
      </div>

      <div ref={ref} className="min-w-0 xl:sticky xl:top-6 xl:self-start">
        {pdfSource ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{placingVar ? `Dibuja dónde va «${placingVar.label || placingVar.key}»` : "Vista del documento"}</p>
              {pages > 1 ? (
                <div className="flex items-center gap-1 text-sm">
                  <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Anterior
                  </Button>
                  <span className="px-2 tabular-nums">
                    {page} de {pages}
                  </span>
                  <Button type="button" size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Siguiente
                  </Button>
                </div>
              ) : null}
            </div>
            <PdfSurface
              file={pdfSource}
              page={page}
              width={width}
              onPages={setPages}
              onDraw={
                placingVar
                  ? (r) => {
                      touch(setFields)(placeField(fields, placingVar, { page, ...r }));
                      setPlacing(null);
                    }
                  : undefined
              }
            >
              {cleanFields
                .filter((f) => f.page === page)
                .map((f) => (
                  <span
                    key={f.key}
                    className="pointer-events-none absolute flex items-center overflow-hidden border border-dashed border-foreground bg-primary/20 px-1 text-[11px] font-medium leading-none"
                    style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                  >
                    {f.label || f.key}
                  </span>
                ))}
            </PdfSurface>
          </>
        ) : (
          <div className="grid h-80 place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">Elige un PDF para ver el documento aquí.</div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Eliminar «${saved?.name ?? ""}»?`}
        description="Deja de aparecer en la biblioteca. Los documentos que ya se enviaron con este formato no se tocan."
        confirmLabel="Eliminar formato"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
