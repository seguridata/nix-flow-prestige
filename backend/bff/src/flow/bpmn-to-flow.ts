import { XMLParser } from 'fast-xml-parser';
import { ISO_DATE_RE, STEP_ID_RE, isObj, validateFlow } from './flow';
import type { Condition, DerivedVariable, Flow, FlowStep, FlowVariable, LookupPerson, LookupQuery, Op } from './flow.types';

export interface BpmnToFlowResult {
  /** Solo si el diagrama se pudo convertir y el flujo pasa `validateFlow`. */
  flow?: Flow;
  errors: string[];
  /** Valores que se completaron por defecto (rol, participante, variables…). */
  warnings: string[];
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (isObj(v) ? v : {});
const asList = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const attrOf = (el: Rec, name: string): string | undefined => {
  const v = el[`@_${name}`];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
};
const textOf = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (isObj(v) && typeof v['#text'] === 'string') return v['#text'];
  return '';
};

/** Lo único que Prestige sabe ejecutar. Cualquier otro elemento del proceso se rechaza. */
const BPMN_NODES = ['startEvent', 'endEvent', 'userTask', 'businessRuleTask', 'exclusiveGateway'] as const;
const BPMN_IGNORED = new Set(['sequenceFlow', 'extensionElements', 'documentation']);

/** Inversa de `exprOf`: `${a > 5 && b == 'x'}` → condiciones. Solo entiende esa gramática. */
function parseConditions(raw: string): { conditions?: Condition[]; error?: string } {
  let s = raw.trim();
  const wrapped = /^\$\{([\s\S]*)\}$/.exec(s);
  if (wrapped) s = wrapped[1]!.trim();

  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      cur += ch;
      if (ch === '\\') cur += s[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === '&' && s[i + 1] === '&') {
      parts.push(cur);
      cur = '';
      i++;
    } else cur += ch;
  }
  if (quote) return { error: 'hay comillas sin cerrar' };
  parts.push(cur);

  const conditions: Condition[] = [];
  for (const part of parts) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*([\s\S]+?)\s*$/.exec(part);
    if (!m) return { error: `no se entiende «${part.trim()}» (solo se admite variable, operador y valor, unidos con &&)` };
    const variable = m[1]!;
    const op = m[2]!;
    const rawValue = m[3]!;
    let value: string | number;
    if (/^-?\d+(\.\d+)?$/.test(rawValue)) value = Number(rawValue);
    else if (rawValue.length >= 2 && (rawValue[0] === "'" || rawValue[0] === '"') && rawValue.endsWith(rawValue[0])) {
      value = rawValue.slice(1, -1).replace(/\\([\s\S])/g, '$1');
    } else return { error: `el valor «${rawValue}» no es un número ni un texto entre comillas` };
    conditions.push({ variable, op: op as Op, value });
  }
  return { conditions };
}

interface Node {
  id: string;
  type: (typeof BPMN_NODES)[number];
  el: Rec;
}
interface Edge {
  target: string;
  cond?: string;
}

/**
 * Convierte un BPMN en un `Flow` ejecutable. Es la inversa de `flowToBpmn`: solo acepta el
 * subconjunto que Prestige ejecuta (inicio → tareas de usuario, con pasos condicionales como
 * decisión → tarea → unión, → un único fin). Lo demás se rechaza con un mensaje claro.
 * `known.variables` son las variables ya definidas (p. ej. del flujo anterior), para no perderlas.
 */
export function bpmnToFlow(xml: string, known: { variables?: FlowVariable[] } = {}): BpmnToFlowResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (): BpmnToFlowResult => ({ errors, warnings });

  let doc: Rec;
  try {
    if (typeof xml !== 'string' || !xml.trim()) throw new Error('vacío');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      isArray: (name) => name === 'sequenceFlow' || (BPMN_NODES as readonly string[]).includes(name),
    });
    doc = asRec(parser.parse(xml, true));
  } catch {
    errors.push('El archivo no es un XML válido.');
    return fail();
  }
  const defs = asRec(doc.definitions);
  if (!Object.keys(defs).length) {
    errors.push('El archivo no parece un diagrama BPMN (falta «definitions»).');
    return fail();
  }
  if (defs.collaboration !== undefined) {
    errors.push('El diagrama tiene una colaboración con varios participantes; Prestige solo ejecuta un proceso.');
    return fail();
  }
  const processes = asList(defs.process);
  if (processes.length !== 1) {
    errors.push(processes.length ? 'El diagrama tiene más de un proceso; deja solo uno.' : 'El diagrama no tiene ningún proceso.');
    return fail();
  }
  const proc = asRec(processes[0]);

  for (const key of Object.keys(proc)) {
    if (key.startsWith('@_') || key === '#text') continue;
    if ((BPMN_NODES as readonly string[]).includes(key) || BPMN_IGNORED.has(key)) continue;
    errors.push(`El diagrama usa «${key}», que Prestige todavía no sabe ejecutar. Usa solo inicio, tareas de usuario, compuertas exclusivas y fin.`);
  }
  if (errors.length) return fail();

  const nodes = new Map<string, Node>();
  for (const type of BPMN_NODES) {
    for (const raw of asList(proc[type])) {
      const el = asRec(raw);
      const id = attrOf(el, 'id');
      if (!id) {
        errors.push(`Hay un elemento «${type}» sin identificador.`);
        continue;
      }
      if (nodes.has(id)) {
        errors.push(`El identificador «${id}» está repetido en el diagrama.`);
        continue;
      }
      nodes.set(id, { id, type, el });
    }
  }
  const label = (n: Node) => attrOf(n.el, 'name')?.trim() || n.id;

  const out = new Map<string, Edge[]>();
  for (const raw of asList(proc.sequenceFlow)) {
    const f = asRec(raw);
    const source = attrOf(f, 'sourceRef');
    const target = attrOf(f, 'targetRef');
    if (!source || !target || !nodes.has(source) || !nodes.has(target)) {
      errors.push('Hay una flecha que no está conectada a dos elementos del diagrama.');
      continue;
    }
    const cond = textOf(f.conditionExpression).trim() || undefined;
    out.set(source, [...(out.get(source) ?? []), { target, cond }]);
  }
  if (errors.length) return fail();

  const starts = [...nodes.values()].filter((n) => n.type === 'startEvent');
  const ends = [...nodes.values()].filter((n) => n.type === 'endEvent');
  if (starts.length !== 1) errors.push(starts.length ? 'El diagrama tiene más de un evento de inicio.' : 'Falta el evento de inicio.');
  if (ends.length !== 1) {
    errors.push(
      ends.length
        ? `Prestige ejecuta un solo camino y el diagrama tiene ${ends.length} eventos de fin (por ejemplo, rechazos como salida alterna).`
        : 'Falta el evento de fin.',
    );
  }
  if (errors.length) return fail();

  const steps: FlowStep[] = [];
  const ruleDerived: DerivedVariable[] = [];
  let enteredUserPath = false;
  const usedIds = new Set<string>();
  const visited = new Set<string>();

  const makeStep = (n: Node, when?: Condition[]): FlowStep => {
    const idx = steps.length + 1;
    let name = attrOf(n.el, 'name')?.trim() ?? '';
    if (!name) {
      name = `Paso ${idx}`;
      warnings.push(`La tarea «${n.id}» no tiene nombre; se llamó «${name}».`);
    }
    let id = (attrOf(n.el, 'stepId') ?? n.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    if (!STEP_ID_RE.test(id) || usedIds.has(id)) id = `paso_${idx}`;
    while (usedIds.has(id)) id = `${id}_`.slice(0, 40);
    usedIds.add(id);

    const roleAttr = attrOf(n.el, 'role');
    let role: FlowStep['role'] = 'FIRMANTE';
    if (roleAttr === 'FIRMANTE' || roleAttr === 'REVISOR') role = roleAttr;
    else warnings.push(`«${name}» no tiene rol; se usó FIRMANTE.`);

    const whoAttr = attrOf(n.el, 'who');
    let who: FlowStep['who'];
    if (whoAttr === 'initiator') who = { type: 'initiator' };
    else if (whoAttr?.startsWith('fixed:')) {
      who = { type: 'fixed', signerId: whoAttr.slice('fixed:'.length) };
      const signerName = attrOf(n.el, 'signerName');
      const signerEmail = attrOf(n.el, 'signerEmail');
      if (signerName) who.name = signerName;
      if (signerEmail) who.email = signerEmail;
    } else if (whoAttr === 'lookup') {
      const prompt = attrOf(n.el, 'prompt')?.trim() || `¿Quién participa en «${name}»?`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(attrOf(n.el, 'lookup') ?? '');
      } catch {
        parsed = undefined;
      }
      if (isObj(parsed) && isObj(parsed.query) && isObj(parsed.person)) {
        // La forma exacta (tabla, columnas, operadores) la valida `validateFlow` al final.
        who = { type: 'lookup', query: parsed.query as unknown as LookupQuery, person: parsed.person as unknown as LookupPerson, prompt };
      } else {
        who = { type: 'ask', prompt };
        warnings.push(`«${name}» tiene una consulta que no se pudo leer; se preguntará al crear el sobre.`);
      }
    } else if (whoAttr === 'ask') {
      who = { type: 'ask', prompt: attrOf(n.el, 'prompt')?.trim() || `¿Quién participa en «${name}»?` };
    } else {
      who = { type: 'ask', prompt: `¿Quién participa en «${name}»?` };
      warnings.push(`«${name}» no dice quién participa; se preguntará al crear el sobre.`);
    }
    const step: FlowStep = { id, label: name, who, role };
    if (when?.length) step.when = when;
    return step;
  };

  const only = (n: Node): Edge | undefined => {
    const e = out.get(n.id) ?? [];
    if (e.length === 1) return e[0];
    errors.push(`«${label(n)}» debe tener exactamente una flecha de salida (tiene ${e.length}).`);
    return undefined;
  };

  let cur: Node | undefined = starts[0];
  while (cur && !errors.length) {
    if (visited.has(cur.id)) {
      errors.push(`El diagrama tiene un bucle en «${label(cur)}»; Prestige solo ejecuta pasos en línea.`);
      break;
    }
    visited.add(cur.id);

    if (cur.type === 'endEvent') break;

    if (cur.type === 'businessRuleTask') {
      if (enteredUserPath) {
        errors.push(`La consulta «${label(cur)}» debe estar antes de todas las tareas y decisiones: las consultas se evalúan al crear la solicitud.`);
        break;
      }
      let definition: unknown;
      try { definition = JSON.parse(attrOf(cur.el, 'lookup') ?? ''); } catch { definition = undefined; }
      if (!isObj(definition)) {
        errors.push(`La tarea de regla «${label(cur)}» requiere prestige:lookup con una variable derivada tipada (key, label, type, query, column).`);
        break;
      }
      ruleDerived.push(definition as unknown as DerivedVariable);
      const e = only(cur);
      if (e?.cond) errors.push(`La consulta «${label(cur)}» no admite una salida condicional.`);
      cur = e && nodes.get(e.target);
      continue;
    }

    if (cur.type === 'userTask' || cur.type === 'exclusiveGateway') enteredUserPath = true;
    if (cur.type === 'startEvent' || cur.type === 'userTask') {
      if (cur.type === 'userTask') steps.push(makeStep(cur));
      const e = only(cur);
      cur = e && nodes.get(e.target);
      continue;
    }

    // exclusiveGateway: decisión de un paso condicional (decisión → tarea → unión).
    const outs = out.get(cur.id) ?? [];
    const conditional = outs.filter((e) => e.cond);
    const byDefault = outs.filter((e) => !e.cond);
    if (outs.length !== 2 || conditional.length !== 1 || byDefault.length !== 1) {
      errors.push(`La compuerta «${label(cur)}» debe tener dos salidas: una con condición hacia una tarea y otra por defecto hacia la unión.`);
      break;
    }
    const task = nodes.get(conditional[0]!.target);
    if (!task || task.type !== 'userTask') {
      errors.push(`La salida con condición de «${label(cur)}» debe llevar a una tarea de usuario.`);
      break;
    }
    const taskOut = only(task);
    const join = taskOut && nodes.get(taskOut.target);
    if (!join || join.type !== 'exclusiveGateway') {
      errors.push(`Después de «${label(task)}» falta la compuerta de unión.`);
      break;
    }
    if (byDefault[0]!.target !== join.id) {
      errors.push(`La salida por defecto de «${label(cur)}» debe saltar la tarea y llegar a la misma unión que «${label(task)}».`);
      break;
    }
    const parsed = parseConditions(conditional[0]!.cond!);
    if (!parsed.conditions) {
      errors.push(`La condición de «${label(task)}» no es válida: ${parsed.error}.`);
      break;
    }
    steps.push(makeStep(task, parsed.conditions));
    visited.add(task.id);
    visited.add(join.id);
    const afterJoin = only(join);
    cur = afterJoin && nodes.get(afterJoin.target);
  }
  if (errors.length) return fail();
  if (!cur || cur.type !== 'endEvent') {
    errors.push('El camino principal no llega al evento de fin.');
    return fail();
  }
  const loose = [...nodes.values()].filter((n) => !visited.has(n.id));
  if (loose.length) {
    errors.push(`Hay elementos sin conectar al camino principal: ${loose.map((n) => `«${label(n)}»`).join(', ')}.`);
    return fail();
  }

  // Variables: las del propio BPMN, luego las conocidas y, por último, las inferidas de las condiciones.
  const variables: FlowVariable[] = [];
  const addVar = (v: FlowVariable) => {
    if (!variables.some((x) => x.key === v.key)) variables.push(v);
  };
  const embedded = attrOf(proc, 'variables');
  if (embedded) {
    try {
      const list: unknown = JSON.parse(embedded);
      if (Array.isArray(list)) list.forEach((v) => isObj(v) && addVar(v as unknown as FlowVariable));
    } catch {
      warnings.push('No se pudieron leer las variables guardadas en el diagrama.');
    }
  }
  (known.variables ?? []).forEach(addVar);

  // Variables derivadas de una tabla (las condiciones pueden citarlas: no se infieren como capturadas).
  const derived: DerivedVariable[] = [...ruleDerived];
  const embeddedDerived = attrOf(proc, 'derived');
  if (embeddedDerived) {
    try {
      const list: unknown = JSON.parse(embeddedDerived);
      if (Array.isArray(list)) list.forEach((d) => isObj(d) && derived.push(d as unknown as DerivedVariable));
    } catch {
      warnings.push('No se pudieron leer las variables derivadas guardadas en el diagrama.');
    }
  }
  for (const step of steps) {
    for (const c of step.when ?? []) {
      if (derived.some((d) => d.key === c.variable)) continue;
      if (variables.some((v) => v.key === c.variable)) continue;
      const type: FlowVariable['type'] =
        typeof c.value === 'number' ? 'number' : ISO_DATE_RE.test(c.value) ? 'date' : 'text';
      addVar({ key: c.variable, label: c.variable, type, required: true });
      warnings.push(`La variable «${c.variable}» se infirió de una condición (tipo ${type}); revisa su etiqueta.`);
    }
  }

  const sla = Number(attrOf(proc, 'slaHours'));
  if (!Number.isFinite(sla)) warnings.push('El diagrama no trae plazo; se usaron 72 horas.');
  const flow: Flow = {
    variables,
    steps,
    order: attrOf(proc, 'order') === 'PARALELO' ? 'PARALELO' : 'SECUENCIAL',
    slaHours: Number.isFinite(sla) ? sla : 72,
    ...(derived.length ? { derived } : {}),
  };

  errors.push(...validateFlow(flow));
  return errors.length ? fail() : { flow, errors, warnings };
}
