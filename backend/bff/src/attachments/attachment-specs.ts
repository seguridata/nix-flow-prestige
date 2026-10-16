/**
 * ADR-008 §7 — especificación de anexos de un formato (`DocumentTemplate.attachmentSpecs`).
 * Validación estricta, sin dependencias de Nest/Prisma (la usan el alta/edición de formatos, el staging y `instantiate`).
 */
export const ATTACHMENT_ACCEPT = ['pdf', 'image', 'excel', 'word', 'any'] as const;
export type AttachmentAccept = (typeof ATTACHMENT_ACCEPT)[number];

export interface AttachmentSpec {
  key: string;
  label: string;
  help?: string;
  required: boolean;
  min: number;
  max: number;
  accept: AttachmentAccept[];
  maxSizeMB: number;
}

export const MAX_ATTACHMENT_SPECS = 10;
export const MAX_FILES_PER_SPEC = 20;
export const MAX_ATTACHMENT_MB = 25;

/** Misma regla que las claves de variable del flujo (`flow.ts`). */
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Valida y normaliza la lista de especificaciones. `undefined`/`null` equivalen a «sin anexos».
 * Los errores van en español; con errores `specs` no es confiable.
 */
export function parseAttachmentSpecs(raw: unknown): { specs: AttachmentSpec[]; errors: string[] } {
  const errors: string[] = [];
  if (raw === undefined || raw === null) return { specs: [], errors };
  if (!Array.isArray(raw)) return { specs: [], errors: ['Los anexos deben ser una lista'] };
  if (raw.length > MAX_ATTACHMENT_SPECS) errors.push(`Máximo ${MAX_ATTACHMENT_SPECS} especificaciones de anexos por formato`);

  const specs: AttachmentSpec[] = [];
  const seen = new Set<string>();
  raw.slice(0, MAX_ATTACHMENT_SPECS + 1).forEach((s, i) => {
    const n = `Anexo ${i + 1}`;
    if (!isObj(s)) return errors.push(`${n}: formato inválido`);

    const key = typeof s.key === 'string' ? s.key : '';
    if (!KEY_RE.test(key)) {
      errors.push(`${n}: la clave debe empezar con letra y usar solo letras, números y guion bajo (máx. 40)`);
    } else if (seen.has(key.toLowerCase())) {
      errors.push(`${n}: la clave «${key}» está repetida`);
    } else seen.add(key.toLowerCase());

    const label = typeof s.label === 'string' ? s.label.trim() : '';
    if (label.length < 1 || label.length > 120) errors.push(`${n}: la etiqueta debe tener entre 1 y 120 caracteres`);

    let help: string | undefined;
    if (s.help !== undefined && s.help !== null) {
      if (typeof s.help !== 'string' || s.help.length > 300) errors.push(`${n}: la ayuda admite hasta 300 caracteres`);
      else help = s.help.trim() || undefined;
    }

    if (typeof s.required !== 'boolean') errors.push(`${n}: «required» debe ser verdadero o falso`);
    const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
    if (!isInt(s.min) || !isInt(s.max)) {
      errors.push(`${n}: el mínimo y el máximo deben ser enteros`);
    } else {
      if (s.min < 0) errors.push(`${n}: el mínimo no puede ser negativo`);
      if (s.max < 1 || s.max > MAX_FILES_PER_SPEC) errors.push(`${n}: el máximo va de 1 a ${MAX_FILES_PER_SPEC} archivos`);
      if (s.min > s.max) errors.push(`${n}: el mínimo no puede ser mayor que el máximo`);
      if (typeof s.required === 'boolean') {
        if (s.required && s.min < 1) errors.push(`${n}: si es obligatorio el mínimo debe ser al menos 1`);
        if (!s.required && s.min > 0) errors.push(`${n}: si el mínimo es mayor que 0 el anexo debe ser obligatorio`);
      }
    }

    const accept = Array.isArray(s.accept) ? s.accept : null;
    if (!accept || accept.length === 0 || accept.some((a) => !(ATTACHMENT_ACCEPT as readonly unknown[]).includes(a))) {
      errors.push(`${n}: los tipos aceptados deben ser una lista de ${ATTACHMENT_ACCEPT.join(', ')}`);
    }

    if (typeof s.maxSizeMB !== 'number' || !Number.isFinite(s.maxSizeMB) || s.maxSizeMB <= 0 || s.maxSizeMB > MAX_ATTACHMENT_MB) {
      errors.push(`${n}: el tamaño máximo debe ser mayor que 0 y de hasta ${MAX_ATTACHMENT_MB} MB`);
    }

    if (errors.length === 0 || errors.every((e) => !e.startsWith(n))) {
      const acc = [...new Set(accept as AttachmentAccept[])];
      specs.push({
        key,
        label,
        ...(help ? { help } : {}),
        required: s.required as boolean,
        min: s.min as number,
        max: s.max as number,
        accept: acc.includes('any') ? ['any'] : acc,
        maxSizeMB: s.maxSizeMB as number,
      });
    }
  });
  return { specs, errors };
}
