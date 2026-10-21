import {
  LOOKUP_OPS,
  MAX_STEPS,
  type Condition,
  type DerivedVariable,
  type Flow,
  type FlowStep,
  type FlowValues,
  type FlowVariable,
  type LookupCondition,
  type LookupPerson,
  type LookupQuery,
  type Op,
  type ResolvedStep,
  type Who,
} from './flow.types';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
export const STEP_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPS: Op[] = ['>', '>=', '<', '<=', '==', '!='];
const ORDERED_OPS: Op[] = ['>', '>=', '<', '<='];
const VAR_TYPES = ['text', 'date', 'number', 'select'] as const;
/** Clave de columna de una tabla de consulta (ADR-008 §3). */
export const COLUMN_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** Clave (`key`) de una tabla de consulta. */
export const TABLE_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const MAX_LOOKUP_CONDITIONS = 10;
export const MAX_DERIVED = 20;
const MAX_LITERAL_LEN = 500;

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Valida la FORMA de una consulta: tabla, condiciones, operadores y fuentes. `varKeys` son las variables que la consulta
 * puede citar. Que la tabla y sus columnas existan se valida donde hay tablas (al crear el formato, `FlowResolverService`).
 */
export function validateLookupQuery(q: unknown, label: string, varKeys: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (!isObj(q)) return [`${label}: la consulta debe ser un objeto`];
  if (typeof q.table !== 'string' || !TABLE_KEY_RE.test(q.table)) errors.push(`${label}: falta la tabla de consulta o su clave no es válida`);
  if (!Array.isArray(q.match) || q.match.length === 0) {
    errors.push(`${label}: la consulta necesita al menos una condición`);
    return errors;
  }
  if (q.match.length > MAX_LOOKUP_CONDITIONS) errors.push(`${label}: máximo ${MAX_LOOKUP_CONDITIONS} condiciones por consulta`);
  q.match.forEach((c, i) => {
    const at = `${label}, condición ${i + 1}`;
    if (!isObj(c)) return errors.push(`${at}: formato inválido`);
    if (typeof c.column !== 'string' || !COLUMN_KEY_RE.test(c.column)) errors.push(`${at}: la columna «${String(c.column)}» no es una clave válida`);
    if (!(LOOKUP_OPS as readonly unknown[]).includes(c.op)) return errors.push(`${at}: operador «${String(c.op)}» inválido`);
    if (c.emptyMatchesAny !== undefined && typeof c.emptyMatchesAny !== 'boolean') {
      errors.push(`${at}: emptyMatchesAny debe ser verdadero o falso`);
    }
    if (c.op === 'isEmpty' || c.op === 'isNotEmpty') {
      if (c.source !== undefined) errors.push(`${at}: «${String(c.op)}» no lleva fuente de comparación`);
      return;
    }
    const src = c.source;
    if (!isObj(src)) return errors.push(`${at}: falta la fuente del valor (una variable o un valor fijo)`);
    const keys = Object.keys(src);
    if (keys.length !== 1) return errors.push(`${at}: la fuente debe ser { var } o { value }`);
    if (keys[0] === 'var') {
      if (typeof src.var !== 'string' || !varKeys.has(src.var)) errors.push(`${at}: usa la variable «${String(src.var)}», que no existe`);
    } else if (keys[0] === 'value') {
      const ok =
        (typeof src.value === 'number' && Number.isFinite(src.value)) ||
        (typeof src.value === 'string' && src.value.length <= MAX_LITERAL_LEN);
      if (!ok) errors.push(`${at}: el valor fijo debe ser un texto (máx. ${MAX_LITERAL_LEN}) o un número`);
    } else errors.push(`${at}: la fuente debe ser { var } o { value }`);
  });
  return errors;
}

/** Reconstruye una consulta (ya validada) con lista blanca de claves. */
export function cleanLookupQuery(q: LookupQuery): LookupQuery {
  return {
    table: q.table,
    match: q.match.map((c): LookupCondition => ({
      column: c.column,
      op: c.op,
      ...(c.source ? { source: 'var' in c.source ? { var: c.source.var } : { value: c.source.value } } : {}),
      ...(c.emptyMatchesAny === undefined ? {} : { emptyMatchesAny: c.emptyMatchesAny }),
    })),
  };
}

export const cleanLookupPerson = (p: LookupPerson): LookupPerson => ({
  signerId: p.signerId,
  ...(p.name ? { name: p.name } : {}),
  ...(p.email ? { email: p.email } : {}),
});

export const cleanDerived = (d: DerivedVariable): DerivedVariable => ({
  key: d.key,
  label: d.label,
  type: d.type,
  query: cleanLookupQuery(d.query),
  column: d.column,
  ...(d.onMiss ? { onMiss: d.onMiss } : {}),
});

/** Todas las consultas del flujo (variables derivadas y participantes `lookup`), para saber qué tablas y columnas cita. */
export function flowQueries(flow: Flow): { where: string; query: LookupQuery; columns: string[] }[] {
  const out: { where: string; query: LookupQuery; columns: string[] }[] = [];
  for (const d of flow.derived ?? []) out.push({ where: `variable derivada «${d.key}»`, query: d.query, columns: [d.column] });
  for (const s of flow.steps) {
    if (s.who.type === 'lookup') {
      const p = s.who.person;
      out.push({ where: `paso «${s.id}»`, query: s.who.query, columns: [p.signerId, ...(p.name ? [p.name] : []), ...(p.email ? [p.email] : [])] });
    }
  }
  return out;
}

/** Claves de las tablas que cita el flujo, sin repetir. */
export const flowTableKeys = (flow: Flow): string[] => [...new Set(flowQueries(flow).map((q) => q.query.table))];

/** Opciones que corresponden a `v` según el valor ya capturado de la variable de la que depende (sin dependencia: todas). */
export function optionsFor(v: FlowVariable, values: Readonly<Record<string, string | number | undefined>>): string[] {
  if (!v.dependsOn) return v.options ?? [];
  const parent = values[v.dependsOn.variable];
  return parent === undefined || parent === '' ? [] : (v.dependsOn.options[String(parent)] ?? []);
}

/** Valida las listas dependientes: el padre es un `select`, las claves son sus opciones y las opciones del hijo salen de su lista. */
export function validateDependsOn(variables: readonly FlowVariable[]): string[] {
  const errors: string[] = [];
  const byKey = new Map(variables.map((v) => [v.key, v]));
  for (const v of variables) {
    const d = (v as { dependsOn?: unknown }).dependsOn;
    if (d === undefined) continue;
    const at = `Variable «${v.key}»`;
    if (!isObj(d) || typeof d.variable !== 'string' || !isObj(d.options)) {
      errors.push(`${at}: la dependencia debe indicar la variable y las opciones por valor`);
      continue;
    }
    const parent = byKey.get(d.variable);
    if (v.type !== 'select') errors.push(`${at}: solo una lista de selección puede depender de otra`);
    else if (!parent || parent.type !== 'select') errors.push(`${at}: depende de «${d.variable}», que debe ser una lista de selección`);
    else if (parent.key === v.key || parent.dependsOn) errors.push(`${at}: no puede depender de sí misma ni de otra lista dependiente`);
    else {
      const own = new Set(v.options ?? []);
      const parentOpts = new Set(parent.options ?? []);
      for (const [value, list] of Object.entries(d.options)) {
        if (!parentOpts.has(value)) errors.push(`${at}: «${value}» no es una opción de «${parent.key}»`);
        else if (!Array.isArray(list) || list.some((o) => typeof o !== 'string' || !own.has(o))) {
          errors.push(`${at}: las opciones de «${value}» deben ser opciones de la lista`);
        }
      }
    }
  }
  return errors;
}

/** Valida la forma y la coherencia de un flujo. Devuelve los errores en español (vacío = válido). */
export function validateFlow(input: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(input)) return ['El flujo debe ser un objeto'];
  const { variables, steps, order, slaHours } = input;

  if (order !== 'SECUENCIAL' && order !== 'PARALELO') errors.push('El orden debe ser SECUENCIAL o PARALELO');
  if (typeof slaHours !== 'number' || !Number.isInteger(slaHours) || slaHours < 1 || slaHours > 2160) {
    errors.push('El plazo (slaHours) debe ser un entero entre 1 y 2160');
  }

  const vars = new Map<string, FlowVariable>();
  if (!Array.isArray(variables)) {
    errors.push('Las variables deben ser una lista');
  } else {
    variables.forEach((v, i) => {
      if (!isObj(v)) return errors.push(`Variable ${i + 1}: formato inválido`);
      const key = String(v.key ?? '');
      if (!KEY_RE.test(key)) {
        return errors.push(`Variable «${key}»: la clave debe empezar con letra y usar solo letras, números y guion bajo`);
      }
      if (key === 'solicitante') return errors.push('solicitante es una variable integrada reservada');
      if (vars.has(key)) return errors.push(`Variable «${key}» repetida`);
      if (typeof v.label !== 'string' || !v.label.trim()) errors.push(`Variable «${key}»: falta la etiqueta`);
      if (!(VAR_TYPES as readonly unknown[]).includes(v.type)) {
        return errors.push(`Variable «${key}»: tipo inválido`);
      }
      if (typeof v.required !== 'boolean') errors.push(`Variable «${key}»: required debe ser verdadero o falso`);
      if (v.type === 'select') {
        const opts = v.options;
        if (!Array.isArray(opts) || opts.length === 0 || opts.some((o) => typeof o !== 'string' || !o.trim())) {
          errors.push(`Variable «${key}»: una lista de selección necesita opciones`);
        }
      }
      vars.set(key, v as unknown as FlowVariable);
    });
    errors.push(...validateDependsOn(variables.filter(isObj) as unknown as FlowVariable[]));
  }

  // Variables derivadas de una tabla (ADR-008 §5): se calculan ANTES de decidir qué pasos aplican, así que pueden usarse en `when`.
  const declared = new Set([...vars.keys(), 'solicitante']);
  const derivedKeys = new Set<string>();
  if (input.derived !== undefined) {
    if (!Array.isArray(input.derived)) errors.push('Las variables derivadas deben ser una lista');
    else {
      if (input.derived.length > MAX_DERIVED) errors.push(`Máximo ${MAX_DERIVED} variables derivadas`);
      input.derived.forEach((d, i) => {
        if (!isObj(d)) return errors.push(`Variable derivada ${i + 1}: formato inválido`);
        const key = String(d.key ?? '');
        if (!KEY_RE.test(key)) return errors.push(`Variable derivada «${key}»: la clave debe empezar con letra y usar solo letras, números y guion bajo`);
        if (declared.has(key)) return errors.push(`Variable derivada «${key}»: ya existe una variable con esa clave`);
        if (derivedKeys.has(key)) return errors.push(`Variable derivada «${key}» repetida`);
        if (typeof d.label !== 'string' || !d.label.trim()) errors.push(`Variable derivada «${key}»: falta la etiqueta`);
        if (!(VAR_TYPES as readonly unknown[]).includes(d.type)) return errors.push(`Variable derivada «${key}»: tipo inválido`);
        if (typeof d.column !== 'string' || !COLUMN_KEY_RE.test(d.column)) errors.push(`Variable derivada «${key}»: falta la columna de la que toma su valor`);
        if (d.onMiss !== undefined && d.onMiss !== 'empty' && d.onMiss !== 'fail') errors.push(`Variable derivada «${key}»: onMiss debe ser empty o fail`);
        // Una derivada solo consulta con variables capturadas (no con otras derivadas): así no hay ciclos ni orden.
        errors.push(...validateLookupQuery(d.query, `Variable derivada «${key}»`, declared));
        derivedKeys.add(key);
        vars.set(key, { key, label: String(d.label ?? key), type: d.type as FlowVariable['type'], required: false });
      });
    }
  }
  const lookupVars = new Set([...vars.keys(), 'solicitante']);

  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push('El flujo necesita al menos un paso');
    return errors;
  }
  if (steps.length > MAX_STEPS) errors.push(`El flujo admite máximo ${MAX_STEPS} pasos`);

  const ids = new Set<string>();
  steps.forEach((s, i) => {
    const n = i + 1;
    if (!isObj(s)) return errors.push(`Paso ${n}: formato inválido`);
    const id = String(s.id ?? '');
    if (!STEP_ID_RE.test(id)) errors.push(`Paso ${n}: id inválido (letras, números, guion y guion bajo)`);
    else if (ids.has(id)) errors.push(`Paso «${id}» repetido`);
    ids.add(id);
    if (typeof s.label !== 'string' || !s.label.trim()) errors.push(`Paso ${n}: falta el nombre`);
    if (s.role !== 'FIRMANTE' && s.role !== 'REVISOR') errors.push(`Paso ${n}: el rol debe ser FIRMANTE o REVISOR`);

    const who = s.who;
    if (!isObj(who)) {
      errors.push(`Paso ${n}: falta definir quién participa`);
    } else if (who.type === 'fixed') {
      if (typeof who.signerId !== 'string' || !who.signerId.trim()) {
        errors.push(`Paso ${n}: la persona fija necesita un signerId`);
      }
    } else if (who.type === 'ask') {
      if (typeof who.prompt !== 'string' || !who.prompt.trim()) {
        errors.push(`Paso ${n}: «preguntar» necesita el texto de la pregunta`);
      }
    } else if (who.type === 'lookup') {
      errors.push(...validateLookupQuery(who.query, `Paso ${n}`, lookupVars));
      const person = who.person;
      if (!isObj(person) || typeof person.signerId !== 'string' || !COLUMN_KEY_RE.test(person.signerId)) {
        errors.push(`Paso ${n}: la consulta necesita la columna del responsable (person.signerId)`);
      } else {
        for (const k of ['name', 'email'] as const) {
          if (person[k] !== undefined && (typeof person[k] !== 'string' || !COLUMN_KEY_RE.test(person[k] as string))) {
            errors.push(`Paso ${n}: person.${k} debe ser la clave de una columna`);
          }
        }
      }
      if (typeof who.prompt !== 'string' || !who.prompt.trim()) {
        errors.push(`Paso ${n}: la consulta necesita la pregunta de respaldo`);
      }
    } else if (who.type !== 'initiator') {
      errors.push(`Paso ${n}: tipo de participante inválido`);
    }

    if (s.when !== undefined) {
      if (!Array.isArray(s.when)) return errors.push(`Paso ${n}: las condiciones deben ser una lista`);
      s.when.forEach((c, j) => {
        if (!isObj(c)) return errors.push(`Paso ${n}, condición ${j + 1}: formato inválido`);
        const v = vars.get(String(c.variable));
        if (!v) return errors.push(`Paso ${n}: la condición usa la variable «${String(c.variable)}», que no existe`);
        if (!OPS.includes(c.op as Op)) return errors.push(`Paso ${n}: operador «${String(c.op)}» inválido`);
        const ordered = ORDERED_OPS.includes(c.op as Op);
        if (ordered && v.type !== 'number' && v.type !== 'date') {
          return errors.push(`Paso ${n}: «${v.key}» es de tipo ${v.type}; solo admite = y ≠`);
        }
        if (v.type === 'number' && (typeof c.value !== 'number' || Number.isNaN(c.value))) {
          errors.push(`Paso ${n}: «${v.key}» se compara contra un número`);
        } else if (v.type === 'date' && !(typeof c.value === 'string' && ISO_DATE_RE.test(c.value))) {
          errors.push(`Paso ${n}: «${v.key}» se compara contra una fecha AAAA-MM-DD`);
        } else if ((v.type === 'text' || v.type === 'select') && typeof c.value !== 'string') {
          errors.push(`Paso ${n}: «${v.key}» se compara contra un texto`);
        }
      });
    }
  });
  return errors;
}

function holds(v: FlowVariable, c: Condition, raw: FlowValues[string]): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  if (v.type === 'number') {
    const a = Number(raw);
    const b = Number(c.value);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return compare(a, b, c.op);
  }
  if (v.type === 'date') {
    const a = String(raw).slice(0, 10);
    if (!ISO_DATE_RE.test(a)) return false;
    return compare(a, String(c.value), c.op);
  }
  return compare(String(raw).trim(), String(c.value).trim(), c.op);
}

function compare<T extends number | string>(a: T, b: T, op: Op): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
  }
}

/** Variables capturadas más las derivadas (estas últimas como no requeridas). */
export function allVariables(flow: Flow): FlowVariable[] {
  return [
    ...flow.variables,
    ...(flow.derived ?? []).map((d): FlowVariable => ({ key: d.key, label: d.label, type: d.type, required: false })),
  ];
}

/** Evalúa las condiciones de cada paso contra los valores capturados. Sin valor → la condición no se cumple. */
export function resolveFlow(flow: Flow, values: FlowValues): ResolvedStep[] {
  const vars = new Map(allVariables(flow).map((v) => [v.key, v]));
  return flow.steps.map((step) => ({
    step,
    active: (step.when ?? []).every((c) => {
      const v = vars.get(c.variable);
      return v ? holds(v, c, values[c.variable]) : false;
    }),
  }));
}

/** Variables requeridas por las condiciones de los pasos que aún no tienen valor. */
export function missingForConditions(flow: Flow, values: FlowValues): string[] {
  const out = new Set<string>();
  const derived = new Set((flow.derived ?? []).map((d) => d.key)); // las calcula el sistema, no se piden
  for (const step of flow.steps) {
    for (const c of step.when ?? []) {
      if (derived.has(c.variable)) continue;
      const raw = values[c.variable];
      if (raw === undefined || raw === null || String(raw).trim() === '') out.add(c.variable);
    }
  }
  return [...out];
}

// ───────────────────────── lo que ve quien llena el formato ─────────────────────────

/** El participante tal como lo ve un usuario: sin la configuración de la consulta (tabla, columnas, condiciones). */
export function publicWho(who: Who): Who | { type: 'lookup'; prompt: string } {
  return who.type === 'lookup' ? { type: 'lookup', prompt: who.prompt } : who;
}

/**
 * El flujo para quien NO es administrador (ADR-008 §2: un usuario nunca ve las tablas): conserva variables, pasos y
 * condiciones, pero las consultas se reducen a su pregunta de respaldo y las variables derivadas a clave, etiqueta y tipo.
 */
export function publicFlow<T>(flow: T): T {
  if (!isObj(flow) || !Array.isArray(flow.steps)) return flow;
  return {
    ...flow,
    steps: flow.steps.map((s: unknown) =>
      isObj(s) && isObj(s.who) && s.who.type === 'lookup' ? { ...s, who: { type: 'lookup', prompt: s.who.prompt } } : s,
    ),
    ...(Array.isArray(flow.derived)
      ? { derived: flow.derived.map((d: unknown) => (isObj(d) ? { key: d.key, label: d.label, type: d.type } : d)) }
      : {}),
  } as T;
}

// ───────────────────────── variables derivadas ─────────────────────────

/** Fila que devolvió una consulta (lo mínimo que necesita el flujo). */
export interface LookupHit {
  tableKey: string;
  /** null si la tabla no existe o está inactiva (no hubo qué consultar). */
  revision: number | null;
  rowId: string;
  values: Record<string, unknown>;
}

/** Ejecuta una consulta con los valores de la solicitud. Inyectable: el flujo no sabe de bases de datos. */
export type LookupExecutor = (query: LookupQuery, inputs: FlowValues) => Promise<LookupHit | null>;

export interface DerivedResult {
  key: string;
  table: string;
  revision: number | null;
  rowId: string | null;
}

/** Una variable derivada con `onMiss: 'fail'` no encontró fila (o su celda estaba vacía). */
export class DerivedMissError extends Error {
  constructor(
    readonly key: string,
    readonly label: string,
  ) {
    super(`No se pudo determinar «${label}» con la tabla de consulta`);
  }
}

/** Convierte la celda de la fila al tipo de la variable; null si está vacía o no cuadra. */
export function castCell(raw: unknown, type: FlowVariable['type']): string | number | null {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return null;
  if (type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'date') {
    const d = String(raw).trim().slice(0, 10);
    return ISO_DATE_RE.test(d) ? d : null;
  }
  return String(raw).trim();
}

/**
 * Calcula las variables derivadas y las suma a `values` (lo que el usuario mande con la clave de una derivada se
 * descarta). Con `strict` y `onMiss: 'fail'`, un fallo lanza `DerivedMissError`; si no, la variable queda vacía.
 */
export async function deriveValues(
  flow: Flow,
  values: FlowValues,
  run: LookupExecutor,
  opts: { strict?: boolean } = {},
): Promise<{ values: FlowValues; derived: DerivedResult[] }> {
  const out: FlowValues = { ...values };
  const derived: DerivedResult[] = [];
  const list = flow.derived ?? [];
  for (const d of list) delete out[d.key];
  const inputs: FlowValues = { ...out };
  for (const d of list) {
    // Las derivadas consultan solo con lo capturado (ver `validateFlow`).
    const hit = await run(d.query, inputs);
    const cell = hit ? castCell(hit.values[d.column], d.type) : null;
    if (cell === null) {
      if (opts.strict && d.onMiss === 'fail') throw new DerivedMissError(d.key, d.label);
      out[d.key] = undefined;
      derived.push({ key: d.key, table: d.query.table, revision: hit?.revision ?? null, rowId: null });
      continue;
    }
    out[d.key] = cell;
    derived.push({ key: d.key, table: d.query.table, revision: hit!.revision, rowId: hit!.rowId });
  }
  return { values: out, derived };
}

// ───────────────────────────── BPMN ─────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function exprOf(c: Condition): string {
  const v = typeof c.value === 'number' ? String(c.value) : `'${String(c.value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return `${c.variable} ${c.op} ${v}`;
}

interface Box { id: string; x: number; y: number; w: number; h: number }
interface Edge { id: string; points: [number, number][] }

/** BPMN 2.0 con diagrama (bpmndi) para que bpmn-js lo muestre. Layout horizontal calculado. */
export function flowToBpmn(flow: Flow, meta: { key: string; name: string }): string {
  const CY = 200;
  const processId = `Process_${meta.key.replace(/[^A-Za-z0-9_]/g, '_')}`;
  const nodes: string[] = [];
  const flows: string[] = [];
  const boxes: Box[] = [];
  const edges: Edge[] = [];
  let seq = 0;
  const nextFlow = () => `Flow_${++seq}`;

  const startId = 'Start';
  const endId = 'End';
  let x = 40;
  boxes.push({ id: startId, x, y: CY - 18, w: 36, h: 36 });
  nodes.push(`    <bpmn:startEvent id="${startId}" name="Inicio" />`);
  let prev = { id: startId, rightX: x + 36 };
  x += 36 + 60;

  const connect = (from: { id: string; rightX: number }, toId: string, toX: number, cond?: string, isDefault = false) => {
    const id = nextFlow();
    const attrs = `id="${id}" sourceRef="${from.id}" targetRef="${toId}"`;
    flows.push(
      cond
        ? `    <bpmn:sequenceFlow ${attrs}>\n      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${${esc(cond)}}</bpmn:conditionExpression>\n    </bpmn:sequenceFlow>`
        : `    <bpmn:sequenceFlow ${attrs} />`,
    );
    edges.push({ id, points: [[from.rightX, CY], [toX, CY]] });
    return { id, isDefault };
  };

  flow.steps.forEach((step: FlowStep, i) => {
    const sid = `Step_${i + 1}`;
    const extAttrs = [
      `prestige:stepId="${esc(step.id)}"`,
      `prestige:role="${step.role}"`,
      `prestige:who="${esc(step.who.type === 'fixed' ? `fixed:${step.who.signerId}` : step.who.type)}"`,
    ];
    // Lo necesario para reconstruir el flujo desde el BPMN (ver `bpmnToFlow`).
    if (step.who.type === 'ask' || step.who.type === 'lookup') extAttrs.push(`prestige:prompt="${esc(step.who.prompt)}"`);
    if (step.who.type === 'lookup') extAttrs.push(`prestige:lookup="${esc(JSON.stringify({ query: step.who.query, person: step.who.person }))}"`);
    if (step.who.type === 'fixed') {
      if (step.who.name) extAttrs.push(`prestige:signerName="${esc(step.who.name)}"`);
      if (step.who.email) extAttrs.push(`prestige:signerEmail="${esc(step.who.email)}"`);
    }
    const ext = extAttrs.join(' ');
    const taskXml = `    <bpmn:userTask id="${sid}" name="${esc(step.label)}" ${ext} />`;

    if (!step.when?.length) {
      connect(prev, sid, x);
      boxes.push({ id: sid, x, y: CY - 40, w: 100, h: 80 });
      nodes.push(taskXml);
      prev = { id: sid, rightX: x + 100 };
      x += 100 + 60;
      return;
    }

    // Paso condicional: gateway → tarea → unión, con un flujo por defecto que salta la tarea.
    const gw = `Gateway_${i + 1}`;
    const join = `Join_${i + 1}`;
    connect(prev, gw, x);
    boxes.push({ id: gw, x, y: CY - 25, w: 50, h: 50 });
    const gwRight = x + 50;
    const taskX = gwRight + 60;
    const joinX = taskX + 100 + 60;
    const cond = step.when.map(exprOf).join(' && ');

    const toTask = connect({ id: gw, rightX: gwRight }, sid, taskX, cond);
    boxes.push({ id: sid, x: taskX, y: CY - 40, w: 100, h: 80 });
    const taskToJoin = connect({ id: sid, rightX: taskX + 100 }, join, joinX);
    boxes.push({ id: join, x: joinX, y: CY - 25, w: 50, h: 50 });

    // Flujo por defecto: rodea la tarea por debajo.
    const skipId = nextFlow();
    flows.push(`    <bpmn:sequenceFlow id="${skipId}" name="Si no aplica" sourceRef="${gw}" targetRef="${join}" />`);
    edges.push({
      id: skipId,
      points: [[x + 25, CY + 25], [x + 25, CY + 110], [joinX + 25, CY + 110], [joinX + 25, CY + 25]],
    });

    nodes.push(
      `    <bpmn:exclusiveGateway id="${gw}" name="¿Aplica «${esc(step.label)}»?" default="${skipId}" />`,
      taskXml,
      `    <bpmn:exclusiveGateway id="${join}" />`,
    );
    void toTask;
    void taskToJoin;
    prev = { id: join, rightX: joinX + 50 };
    x = joinX + 50 + 60;
  });

  boxes.push({ id: endId, x, y: CY - 18, w: 36, h: 36 });
  nodes.push(`    <bpmn:endEvent id="${endId}" name="Fin" />`);
  connect(prev, endId, x);

  const shapes = boxes
    .map(
      (b) =>
        `      <bpmndi:BPMNShape id="${b.id}_di" bpmnElement="${b.id}"${b.id.startsWith('Gateway_') || b.id.startsWith('Join_') ? ' isMarkerVisible="true"' : ''}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`,
    )
    .join('\n');
  const edgeXml = edges
    .map(
      (e) =>
        `      <bpmndi:BPMNEdge id="${e.id}_di" bpmnElement="${e.id}">\n${e.points
          .map(([px, py]) => `        <di:waypoint x="${px}" y="${py}" />`)
          .join('\n')}\n      </bpmndi:BPMNEdge>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:prestige="http://prestige.seguridata.com/bpmn" id="Definitions_${meta.key.replace(/[^A-Za-z0-9_]/g, '_')}" targetNamespace="http://prestige.seguridata.com/bpmn">
  <bpmn:process id="${processId}" name="${esc(meta.name)}" isExecutable="false" prestige:order="${flow.order}" prestige:slaHours="${flow.slaHours}" prestige:variables="${esc(JSON.stringify(flow.variables))}"${flow.derived?.length ? ` prestige:derived="${esc(JSON.stringify(flow.derived))}"` : ''}>
${nodes.join('\n')}
${flows.join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="${processId}">
${shapes}
${edgeXml}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
