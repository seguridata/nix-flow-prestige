/** Definición de flujo (misma forma que el BFF: backend/bff/src/flow/flow.types.ts). */
export type VarType = "text" | "date" | "number" | "select";
export type Op = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface FlowVariable {
  key: string;
  label: string;
  type: VarType;
  required: boolean;
  options?: string[];
}

export interface Condition {
  variable: string;
  op: Op;
  value: string | number;
}

export type Who =
  | { type: "initiator" }
  | { type: "fixed"; signerId: string; name?: string; email?: string }
  | { type: "ask"; prompt: string };

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

export function describeWho(who: Who): string {
  if (who.type === "initiator") return "Quien solicita";
  if (who.type === "fixed") return who.name || who.email || who.signerId;
  return who.prompt || "Se elige al usar el formato";
}

/** Errores que el BFF también rechazaría, para avisar antes de guardar. */
export function flowProblems(flow: Flow): string[] {
  const out: string[] = [];
  if (flow.steps.length === 0) out.push("Agrega al menos un paso.");
  const keys = new Set<string>();
  for (const v of flow.variables) {
    if (!v.label.trim()) out.push("Hay una variable sin nombre.");
    if (keys.has(v.key)) out.push(`La variable «${v.label}» está repetida.`);
    keys.add(v.key);
    if (v.type === "select" && !(v.options?.length)) out.push(`«${v.label}» necesita al menos una opción.`);
  }
  for (const s of flow.steps) {
    if (!s.label.trim()) out.push("Hay un paso sin nombre.");
    if (s.who.type === "fixed" && !s.who.signerId.trim()) out.push(`«${s.label || "Paso"}»: elige a quién se envía.`);
    if (s.who.type === "ask" && !s.who.prompt.trim()) out.push(`«${s.label || "Paso"}»: escribe qué se le pregunta a quien usa el formato.`);
    for (const c of s.when ?? []) {
      if (!flow.variables.some((v) => v.key === c.variable)) out.push(`«${s.label || "Paso"}»: la condición usa una variable que ya no existe.`);
      if (String(c.value).trim() === "") out.push(`«${s.label || "Paso"}»: falta el valor de la condición.`);
    }
  }
  return out;
}
