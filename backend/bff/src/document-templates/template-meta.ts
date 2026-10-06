import { validateFlow } from '../flow/flow';
import type { Flow } from '../flow/flow.types';
import type { SignatureBox, TemplateField } from './template.types';

const METHODS = ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA', 'ACCEPT', 'PASSKEY'];
const KYC = ['NONE', 'ONCE', 'EVERY_SIGN'];
const PREFILL = ['user.name', 'user.email', 'today'];
const MAX_FIELDS = 100;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const frac = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export interface TemplateMeta {
  name: string;
  description?: string | null;
  category?: string | null;
  fields: TemplateField[];
  signatureBoxes: SignatureBox[];
  flow: Flow;
  methods: string[];
  kycPolicy: string;
  requirePasskey: boolean;
  flowKey?: string | null;
  flowVersion?: number | null;
}

function rect(o: Record<string, unknown>, label: string, pageCount: number, errors: string[]) {
  if (!Number.isInteger(o.page) || (o.page as number) < 1 || (o.page as number) > pageCount) {
    errors.push(`${label}: la página debe estar entre 1 y ${pageCount}`);
  }
  if (!frac(o.x) || !frac(o.y) || !frac(o.w) || !frac(o.h)) {
    errors.push(`${label}: x, y, w y h deben ser fracciones entre 0 y 1`);
  } else if ((o.w as number) <= 0 || (o.h as number) <= 0) {
    errors.push(`${label}: el ancho y el alto deben ser mayores que 0`);
  } else if ((o.x as number) + (o.w as number) > 1.001 || (o.y as number) + (o.h as number) > 1.001) {
    errors.push(`${label}: la caja se sale de la página`);
  }
}

/**
 * Valida el cuerpo de un formato (alta o edición) y lo devuelve normalizado.
 * `pageCount` sale del PDF base. Los errores van en español.
 */
export function parseTemplateMeta(input: unknown, pageCount: number): { meta?: TemplateMeta; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(input)) return { errors: ['Los datos del formato deben ser un objeto'] };

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 3 || name.length > 120) errors.push('El nombre debe tener entre 3 y 120 caracteres');
  if (input.description != null && (typeof input.description !== 'string' || input.description.length > 500)) {
    errors.push('La descripción admite hasta 500 caracteres');
  }
  if (input.category != null && (typeof input.category !== 'string' || input.category.length > 60)) {
    errors.push('La categoría admite hasta 60 caracteres');
  }

  const flowErrors = validateFlow(input.flow);
  errors.push(...flowErrors);
  const flow = flowErrors.length === 0 ? (input.flow as Flow) : undefined;
  const varKeys = new Set(flow?.variables.map((v) => v.key));
  const stepIds = new Set(flow?.steps.map((s) => s.id));

  const rawFields = input.fields ?? [];
  const fields: TemplateField[] = [];
  if (!Array.isArray(rawFields)) errors.push('Los campos deben ser una lista');
  else {
    if (rawFields.length > MAX_FIELDS) errors.push(`Máximo ${MAX_FIELDS} campos por formato`);
    rawFields.forEach((f, i) => {
      const label = `Campo ${i + 1}`;
      if (!isObj(f)) return errors.push(`${label}: formato inválido`);
      if (flow && !varKeys.has(String(f.key))) {
        errors.push(`${label}: «${String(f.key)}» no es una variable del flujo`);
      }
      rect(f, label, pageCount, errors);
      if (f.fontSize !== undefined && !(typeof f.fontSize === 'number' && f.fontSize >= 4 && f.fontSize <= 48)) {
        errors.push(`${label}: el tamaño de letra va de 4 a 48`);
      }
      if (f.align !== undefined && f.align !== 'left' && f.align !== 'center') errors.push(`${label}: alineación inválida`);
      if (f.prefill !== undefined && !PREFILL.includes(String(f.prefill))) errors.push(`${label}: valor de autollenado inválido`);
      fields.push(f as unknown as TemplateField);
    });
  }

  const rawBoxes = input.signatureBoxes ?? [];
  const boxes: SignatureBox[] = [];
  if (!Array.isArray(rawBoxes)) errors.push('Las cajas de firma deben ser una lista');
  else {
    rawBoxes.forEach((b, i) => {
      const label = `Caja de firma ${i + 1}`;
      if (!isObj(b)) return errors.push(`${label}: formato inválido`);
      if (flow && !stepIds.has(String(b.stepId))) errors.push(`${label}: «${String(b.stepId)}» no es un paso del flujo`);
      rect(b, label, pageCount, errors);
      boxes.push(b as unknown as SignatureBox);
    });
  }

  const methods = input.methods ?? [];
  if (!Array.isArray(methods) || methods.some((m) => !METHODS.includes(String(m)))) {
    errors.push('Los métodos de firma no son válidos');
  }
  const kycPolicy = input.kycPolicy ?? 'NONE';
  if (!KYC.includes(String(kycPolicy))) errors.push('La política de identidad no es válida');
  if (input.requirePasskey !== undefined && typeof input.requirePasskey !== 'boolean') {
    errors.push('requirePasskey debe ser verdadero o falso');
  }
  if (input.flowKey != null && (typeof input.flowKey !== 'string' || input.flowKey.length > 120)) {
    errors.push('flowKey inválida');
  }
  if (input.flowVersion != null && !Number.isInteger(input.flowVersion)) errors.push('flowVersion inválida');

  if (errors.length || !flow) return { errors };
  return {
    errors,
    meta: {
      name,
      description: (input.description as string | null | undefined) ?? null,
      category: (input.category as string | null | undefined) ?? null,
      fields,
      signatureBoxes: boxes,
      flow,
      methods: methods as string[],
      kycPolicy: String(kycPolicy),
      requirePasskey: Boolean(input.requirePasskey),
      flowKey: (input.flowKey as string | null | undefined) ?? null,
      flowVersion: (input.flowVersion as number | null | undefined) ?? null,
    },
  };
}
