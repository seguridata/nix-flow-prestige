/** Definición de flujo (misma forma que el BFF: backend/bff/src/flow/flow.types.ts). */
import {
  describeQuery,
  KEY_RE,
  queryProblems,
  type LookupPerson,
  type LookupQuery,
  type LookupTableSummary,
  type SourceVar,
} from "@/libs/lookup";

/** Server-owned identity is available to lookups, never as an editable form input. */
export const BUILTIN_LOOKUP_SOURCES: SourceVar[] = [{ key: "solicitante", label: "Solicitante (usuario autenticado)" }];

export type VarType = "text" | "date" | "number" | "select";
export type Op = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface FlowVariable {
  key: string;
  label: string;
  type: VarType;
  required: boolean;
  options?: string[];
  /** Lista dependiente: las opciones salen del valor de otra lista (p. ej. concepto según el tipo de gasto). `options` es la unión. */
  dependsOn?: { variable: string; options: Record<string, string[]> };
}

/**
 * Deja las listas dependientes coherentes tras editar variables: quita la dependencia si el padre ya no es una lista
 * de selección y descarta de cada lista lo que ya no es opción del padre o del propio campo.
 */
export function pruneDependencies(variables: FlowVariable[]): FlowVariable[] {
  return variables.map((v) => {
    if (!v.dependsOn) return v;
    const parent = variables.find((x) => x.key === v.dependsOn!.variable);
    if (v.type !== "select" || parent?.type !== "select" || parent.key === v.key || parent.dependsOn) {
      return { ...v, dependsOn: undefined };
    }
    const own = new Set(v.options ?? []);
    const parentOpts = new Set(parent.options ?? []);
    const options = Object.fromEntries(
      Object.entries(v.dependsOn.options)
        .filter(([k]) => parentOpts.has(k))
        .map(([k, l]) => [k, l.filter((o) => own.has(o))]),
    );
    return { ...v, dependsOn: { variable: v.dependsOn.variable, options } };
  });
}

/** Opciones que corresponden a la variable según los valores ya capturados (sin dependencia: todas). */
export function optionsFor(v: FlowVariable, values: Readonly<Record<string, string | number | undefined>>): string[] {
  if (!v.dependsOn) return v.options ?? [];
  const parent = values[v.dependsOn.variable];
  return parent === undefined || parent === "" ? [] : (v.dependsOn.options[String(parent)] ?? []);
}

export interface Condition {
  variable: string;
  op: Op;
  value: string | number;
}

export type Who =
  | { type: "initiator" }
  | { type: "fixed"; signerId: string; name?: string; email?: string }
  | { type: "ask"; prompt: string }
  /**
   * Lo resuelve una tabla de consulta (ADR-008): `query` elige la fila y `person` dice qué columnas
   * traen a la persona. Sin coincidencia se pregunta con `prompt`.
   */
  | { type: "lookup"; query: LookupQuery; person: LookupPerson; prompt: string };

export type LookupWho = Extract<Who, { type: "lookup" }>;

/** Variable calculada desde una tabla: se resuelve antes de decidir qué pasos aplican y sirve en `when`. */
export interface DerivedVariable {
  key: string;
  label: string;
  type: VarType;
  query: LookupQuery;
  /** Columna de la fila ganadora que se copia a la variable. */
  column: string;
  /** Sin coincidencia: queda vacía (`empty`, por defecto) o no se puede crear la solicitud (`fail`). */
  onMiss?: "empty" | "fail";
}

export interface FlowStep {
  id: string;
  label: string;
  who: Who;
  role: "FIRMANTE" | "REVISOR";
  /** Todas deben cumplirse (Y). Vacío o ausente = el paso siempre aplica. */
  when?: Condition[];
}

export interface Flow {
  variables: FlowVariable[];
  /** Variables calculadas desde una tabla de consulta. */
  derived?: DerivedVariable[];
  steps: FlowStep[];
  order: "SECUENCIAL" | "PARALELO";
  slaHours: number;
}

export const VAR_TYPE_LABEL: Record<VarType, string> = {
  text: "Texto",
  date: "Fecha",
  number: "Número",
  select: "Lista de opciones",
};

export const OP_LABEL: Record<Op, string> = {
  ">": "es mayor que",
  ">=": "es mayor o igual que",
  "<": "es menor que",
  "<=": "es menor o igual que",
  "==": "es igual a",
  "!=": "es distinto de",
};

/** Operadores que tienen sentido según el tipo de la variable. */
export function opsFor(type: VarType): Op[] {
  return type === "number" || type === "date" ? [">", ">=", "<", "<=", "==", "!="] : ["==", "!="];
}

export function emptyFlow(): Flow {
  return {
    variables: [],
    steps: [{ id: newId("paso"), label: "Firma de quien solicita", who: { type: "initiator" }, role: "FIRMANTE" }],
    order: "SECUENCIAL",
    slaHours: 72,
  };
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Clave estable para una variable a partir de su etiqueta ("Días de vacaciones" → "dias_de_vacaciones"). */
export function slugKey(label: string, taken: readonly string[] = []): string {
  const base =
    label
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "campo";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Variables del formulario más las calculadas: lo que puede usarse en una condición de `when`. */
export function allVariables(flow: Pick<Flow, "variables" | "derived">): FlowVariable[] {
  return [
    ...flow.variables,
    ...(flow.derived ?? []).map((d): FlowVariable => ({ key: d.key, label: d.label, type: d.type, required: false })),
  ];
}

/** "Si Días de vacaciones es mayor que 5" — para mostrar la condición en lenguaje natural. */
export function describeWhen(when: Condition[] | undefined, variables: readonly FlowVariable[]): string {
  if (!when?.length) return "Siempre";
  return when
    .map((c) => {
      const label = variables.find((v) => v.key === c.variable)?.label ?? c.variable;
      return `${label} ${OP_LABEL[c.op]} ${c.value}`;
    })
    .join(" y ");
}

export interface DescribeCtx {
  /** Nombre visible de cada tabla por su clave. */
  tableNames?: Readonly<Record<string, string>>;
  variables?: readonly SourceVar[];
}

export function describeWho(who: Who, ctx: DescribeCtx = {}): string {
  if (who.type === "initiator") return "Quien solicita";
  if (who.type === "fixed") return who.name || who.email || who.signerId;
  if (who.type === "lookup") {
    // Quien no es administrador recibe el participante sin la consulta (el usuario nunca ve las tablas): se asigna solo.
    const query = (who as { query?: LookupQuery }).query;
    if (!query) return "Se asigna automáticamente según los datos del formato";
    const name = ctx.tableNames?.[query.table] ?? query.table;
    return `Según la tabla «${name}»: ${describeQuery(query, undefined, ctx.variables)}`;
  }
  return who.prompt || "Se elige al usar el formato";
}

/**
 * Errores que el BFF también rechazaría, para avisar antes de guardar. Con `tables` (las tablas de
 * consulta del tenant) también comprueba que existan, estén activas y que las columnas citadas existan.
 */
export function flowProblems(flow: Flow, tables?: readonly LookupTableSummary[]): string[] {
  const out: string[] = [];
  if (flow.steps.length === 0) out.push("Agrega al menos un paso.");
  const keys = new Set<string>(["solicitante"]);
  for (const v of flow.variables) {
    if (!v.label.trim()) out.push("Hay una variable sin nombre.");
    if (v.key === "solicitante") out.push("La clave solicitante está reservada al usuario autenticado; usa otra clave para este dato.");
    else if (keys.has(v.key)) out.push(`La variable «${v.label}» está repetida.`);
    keys.add(v.key);
    if (v.type === "select" && !(v.options?.length)) out.push(`«${v.label}» necesita al menos una opción.`);
    if (v.dependsOn) {
      const parent = flow.variables.find((x) => x.key === v.dependsOn!.variable);
      if (v.type !== "select" || parent?.type !== "select" || parent.key === v.key || parent.dependsOn) {
        out.push(`«${v.label}» depende de una lista que no es válida.`);
      } else if (Object.values(v.dependsOn.options).every((l) => l.length === 0)) {
        out.push(`«${v.label}» no tiene opciones para ningún valor de «${parent.label}».`);
      }
    }
  }
  const sourcesForDerived: SourceVar[] = [...BUILTIN_LOOKUP_SOURCES, ...flow.variables.map((v) => ({ key: v.key, label: v.label || v.key }))];
  const tableOf = (key: string) => tables?.find((t) => t.key === key);
  const tableMissing = (key: string, where: string) =>
    tables && key.trim() && !tableOf(key) ? [`${where}: la tabla «${key}» ya no existe.`] : [];

  for (const d of flow.derived ?? []) {
    const where = `Variable calculada «${d.label || d.key || "sin nombre"}»`;
    if (!d.label.trim()) out.push("Hay una variable calculada sin nombre.");
    if (!KEY_RE.test(d.key)) out.push(`${where}: la clave debe empezar con letra y usar solo letras, números y guion bajo.`);
    if (d.key === "solicitante") out.push(`${where}: solicitante está reservado al usuario autenticado.`);
    else if (keys.has(d.key)) out.push(`${where}: la clave «${d.key}» ya la usa otro dato.`);
    keys.add(d.key);
    const t = tableOf(d.query.table);
    out.push(...tableMissing(d.query.table, where));
    out.push(...queryProblems(d.query, { where, table: t, sources: sourcesForDerived }));
    if (!d.column) out.push(`${where}: elige la columna que se copia.`);
    else if (t && !t.columns.some((c) => c.key === d.column)) out.push(`${where}: la columna «${d.column}» ya no existe en la tabla.`);
  }

  const every = allVariables(flow);
  const sourcesForSteps: SourceVar[] = [...BUILTIN_LOOKUP_SOURCES, ...every.map((v) => ({ key: v.key, label: v.label || v.key }))];
  for (const s of flow.steps) {
    const name = s.label || "Paso";
    if (!s.label.trim()) out.push("Hay un paso sin nombre.");
    if (s.who.type === "fixed" && !s.who.signerId.trim()) out.push(`«${name}»: elige a quién se envía.`);
    if (s.who.type === "ask" && !s.who.prompt.trim()) out.push(`«${name}»: escribe qué se le pregunta a quien usa el formato.`);
    if (s.who.type === "lookup") {
      const w = s.who;
      const t = tableOf(w.query.table);
      out.push(...tableMissing(w.query.table, `«${name}»`));
      out.push(...queryProblems(w.query, { where: `«${name}»`, table: t, sources: sourcesForSteps }));
      if (!w.person.signerId.trim()) out.push(`«${name}»: elige la columna que identifica a la persona.`);
      for (const [label, col] of [
        ["identificador", w.person.signerId],
        ["nombre", w.person.name],
        ["correo", w.person.email],
      ] as const) {
        if (col && t && !t.columns.some((c) => c.key === col)) out.push(`«${name}»: la columna de ${label} «${col}» ya no existe en la tabla.`);
      }
      if (!w.prompt.trim()) out.push(`«${name}»: escribe la pregunta que se hace si la tabla no encuentra a nadie.`);
    }
    for (const c of s.when ?? []) {
      if (!every.some((v) => v.key === c.variable)) out.push(`«${name}»: la condición usa una variable que ya no existe.`);
      if (String(c.value).trim() === "") out.push(`«${name}»: falta el valor de la condición.`);
    }
  }
  return out;
}
