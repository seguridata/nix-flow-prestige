import {
  MAX_STEPS,
  type Condition,
  type Flow,
  type FlowStep,
  type FlowValues,
  type FlowVariable,
  type Op,
  type ResolvedStep,
} from './flow.types';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const STEP_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPS: Op[] = ['>', '>=', '<', '<=', '==', '!='];
const ORDERED_OPS: Op[] = ['>', '>=', '<', '<='];
const VAR_TYPES = ['text', 'date', 'number', 'select'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  }

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

/** Evalúa las condiciones de cada paso contra los valores capturados. Sin valor → la condición no se cumple. */
export function resolveFlow(flow: Flow, values: FlowValues): ResolvedStep[] {
  const vars = new Map(flow.variables.map((v) => [v.key, v]));
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
  for (const step of flow.steps) {
    for (const c of step.when ?? []) {
      const raw = values[c.variable];
      if (raw === undefined || raw === null || String(raw).trim() === '') out.add(c.variable);
    }
  }
  return [...out];
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
    const ext = [
      `prestige:stepId="${esc(step.id)}"`,
      `prestige:role="${step.role}"`,
      `prestige:who="${esc(step.who.type === 'fixed' ? `fixed:${step.who.signerId}` : step.who.type)}"`,
    ].join(' ');
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
  <bpmn:process id="${processId}" name="${esc(meta.name)}" isExecutable="false" prestige:order="${flow.order}" prestige:slaHours="${flow.slaHours}">
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
