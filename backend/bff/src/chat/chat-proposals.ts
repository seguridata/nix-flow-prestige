import { validateFlow } from '../flow/flow';
import type { Flow } from '../flow/flow.types';
import { parseTemplateMeta } from '../document-templates/template-meta';
import { extractJson } from '../ai/llm-json';

/** Tope de propuestas por respuesta: el chat orienta, no genera lotes. */
export const MAX_PROPOSALS = 2;
export const MAX_REPLY = 4000;

export type ProposalKind = 'flow' | 'template';

/** Borrador de flujo: se guarda como versión sin publicar de un proceso del tenant. */
export interface FlowDraftProposal {
  kind: 'flow';
  name: string;
  description: string | null;
  flow: Flow;
}

/**
 * Borrador de formato SIN PDF base: nombre, descripción y flujo (con sus variables). Las posiciones de campos
 * y de cajas de firma las pone una persona en el editor de formatos, junto con el PDF.
 */
export interface TemplateDraftProposal {
  kind: 'template';
  name: string;
  description: string | null;
  flow: Flow;
}

export type DraftProposal = FlowDraftProposal | TemplateDraftProposal;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Completa ids de paso y la lista de variables, sin inventar decisiones de negocio. */
function normalizeFlow(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((s, i) => (isObj(s) ? { ...s, id: typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `paso_${i + 1}` } : s))
    : raw.steps;
  return { ...raw, variables: Array.isArray(raw.variables) ? raw.variables : [], steps };
}

/**
 * Reconstruye el flujo con una lista blanca de claves. Lo que el modelo agregue (`published`, `action`,
 * `signerId`, correos…) no llega a la base de datos. El chat no asigna firmantes concretos.
 */
export function sanitizeFlow(input: unknown): { flow?: Flow; errors: string[] } {
  const raw = normalizeFlow(input);
  const errors = validateFlow(raw);
  if (errors.length) return { errors };
  const f = raw as Flow;
  const loose = f.steps.find((s) => s.who.type === 'fixed');
  if (loose) return { errors: [`El paso «${loose.id}» fija a una persona concreta; el chat solo propone «initiator» o «ask».`] };
  const flow: Flow = {
    order: f.order,
    slaHours: f.slaHours,
    variables: f.variables.map((v) => ({
      key: v.key,
      label: v.label,
      type: v.type,
      required: v.required,
      ...(v.type === 'select' && v.options ? { options: [...v.options] } : {}),
    })),
    steps: f.steps.map((s) => ({
      id: s.id,
      label: s.label,
      role: s.role,
      // `fixed` ya se rechazó arriba; `matrix` ya pasó validateFlow y se reconstruye con lista blanca.
      who:
        s.who.type === 'ask'
          ? { type: 'ask' as const, prompt: s.who.prompt }
          : s.who.type === 'matrix'
            ? { type: 'matrix' as const, stage: s.who.stage, prompt: s.who.prompt }
            : { type: 'initiator' as const },
      ...(s.when?.length ? { when: s.when.map((c) => ({ variable: c.variable, op: c.op, value: c.value })) } : {}),
    })),
  };
  return { flow, errors: [] };
}

/** Valida UNA propuesta (de la respuesta del modelo o reenviada por el cliente al guardar). Nunca lanza. */
export function validateProposal(raw: unknown): { proposal?: DraftProposal; errors: string[] } {
  if (!isObj(raw)) return { errors: ['La propuesta debe ser un objeto.'] };
  const kind = raw.kind;
  if (kind !== 'flow' && kind !== 'template') return { errors: ['Tipo de propuesta no permitido (solo «flow» o «template»).'] };

  const name = str(raw.name, 120);
  const description = str(raw.description, 500) || null;
  const checked = sanitizeFlow(raw.flow);
  if (!checked.flow) return { errors: checked.errors };

  if (kind === 'flow') {
    if (name.length < 3) return { errors: ['El nombre debe tener entre 3 y 120 caracteres.'] };
    return { proposal: { kind, name, description, flow: checked.flow }, errors: [] };
  }
  // Formato: la misma validación que al crear uno a mano (sin campos ni cajas: faltan el PDF y las posiciones).
  const parsed = parseTemplateMeta(
    { name, description, category: null, fields: [], signatureBoxes: [], flow: checked.flow, methods: [], kycPolicy: 'NONE', requirePasskey: false },
    1,
  );
  if (!parsed.meta) return { errors: parsed.errors };
  return { proposal: { kind, name: parsed.meta.name, description: parsed.meta.description ?? null, flow: parsed.meta.flow }, errors: [] };
}

export interface ParsedReply {
  reply: string;
  proposals: DraftProposal[];
  /** Motivos por los que se descartó una propuesta (para el usuario y la auditoría). */
  rejected: string[];
}

/**
 * Lee la respuesta del modelo. Solo se toman `reply` (texto) y `proposals` (lista); cualquier otra clave
 * (acciones, herramientas, «publicar»…) se ignora: el modelo no tiene forma de provocar efectos.
 */
export function parseModelReply(text: string): ParsedReply {
  const raw = extractJson(text);
  if (!isObj(raw)) return { reply: str(text, MAX_REPLY), proposals: [], rejected: [] };
  const reply = str(raw.reply, MAX_REPLY);
  const proposals: DraftProposal[] = [];
  const rejected: string[] = [];
  const list = Array.isArray(raw.proposals) ? raw.proposals : [];
  if (list.length > MAX_PROPOSALS) rejected.push(`Se ignoraron ${list.length - MAX_PROPOSALS} propuestas de más (máximo ${MAX_PROPOSALS}).`);
  list.slice(0, MAX_PROPOSALS).forEach((p, i) => {
    const r = validateProposal(p);
    if (r.proposal) proposals.push(r.proposal);
    else rejected.push(`Propuesta ${i + 1} descartada: ${r.errors.slice(0, 3).join(' ')}`);
  });
  return { reply: reply || 'Listo.', proposals, rejected };
}
