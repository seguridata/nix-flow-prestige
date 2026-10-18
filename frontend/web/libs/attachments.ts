/** Anexos de un formato (ADR-008 §7): especificación, validación en el navegador y estado del contador. */

export type AttachmentAccept = "pdf" | "image" | "excel" | "word" | "any";

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

export const MAX_SPECS = 10;
export const MAX_FILES_PER_SPEC = 20;
export const MAX_SIZE_MB = 25;
export const SPEC_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export const ACCEPT_LABEL: Record<AttachmentAccept, string> = {
  pdf: "PDF",
  image: "Imágenes",
  excel: "Excel",
  word: "Word",
  any: "Cualquier archivo",
};

const EXTENSIONS: Record<Exclude<AttachmentAccept, "any">, string[]> = {
  pdf: [".pdf"],
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic"],
  excel: [".xls", ".xlsx", ".csv"],
  word: [".doc", ".docx"],
};

const MIME_PREFIX: Record<Exclude<AttachmentAccept, "any">, string[]> = {
  pdf: ["application/pdf"],
  image: ["image/"],
  excel: [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml",
    "text/csv",
  ],
  word: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml"],
};

export function emptySpec(taken: readonly string[] = []): AttachmentSpec {
  let n = taken.length + 1;
  while (taken.includes(`anexo_${n}`)) n++;
  return { key: `anexo_${n}`, label: "", required: true, min: 1, max: 1, accept: ["pdf"], maxSizeMB: 10 };
}

/** Valor del atributo `accept` de un `<input type="file">`. Vacío = cualquier archivo. */
export function acceptAttribute(spec: Pick<AttachmentSpec, "accept">): string {
  if (spec.accept.length === 0 || spec.accept.includes("any")) return "";
  return spec.accept.flatMap((a) => (a === "any" ? [] : [...EXTENSIONS[a], ...MIME_PREFIX[a].map((m) => (m.endsWith("/") ? `${m}*` : m))])).join(",");
}

export function acceptText(spec: Pick<AttachmentSpec, "accept">): string {
  if (spec.accept.length === 0 || spec.accept.includes("any")) return "cualquier archivo";
  return spec.accept.map((a) => ACCEPT_LABEL[a]).join(", ");
}

export function fileMatches(spec: Pick<AttachmentSpec, "accept">, file: { name: string; type: string }): boolean {
  if (spec.accept.length === 0 || spec.accept.includes("any")) return true;
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return spec.accept.some((a) => {
    if (a === "any") return true;
    return EXTENSIONS[a].some((e) => name.endsWith(e)) || (mime !== "" && MIME_PREFIX[a].some((p) => mime.startsWith(p)));
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Error (en español) de un archivo antes de subirlo, o `null` si cabe. `current` = cuántos lleva ya la especificación. */
export function validateFile(
  spec: AttachmentSpec,
  file: { name: string; size: number; type: string },
  current: number,
): string | null {
  if (current >= spec.max) return `Ya llegaste al máximo de ${spec.max} ${spec.max === 1 ? "archivo" : "archivos"} en «${spec.label}».`;
  if (!fileMatches(spec, file)) return `«${file.name}» no es un tipo permitido. Se aceptan: ${acceptText(spec)}.`;
  if (file.size === 0) return `«${file.name}» está vacío.`;
  if (file.size > spec.maxSizeMB * 1024 * 1024)
    return `«${file.name}» pesa ${formatBytes(file.size)} y el máximo es ${spec.maxSizeMB} MB.`;
  return null;
}

/** Mínimo efectivo: lo obligatorio pide al menos uno aunque `min` sea 0. */
export const effectiveMin = (spec: Pick<AttachmentSpec, "required" | "min">): number => (spec.required ? Math.max(1, spec.min) : spec.min);

export interface AttachmentStatus {
  met: boolean;
  /** Archivos que faltan para llegar al mínimo. */
  missing: number;
  atMax: boolean;
  /** Texto del contador, p. ej. «2 de 3 cotizaciones requeridas». */
  text: string;
}

/** Estado del contador de una especificación según los archivos ya cargados (`count`). */
export function attachmentStatus(spec: AttachmentSpec, count: number): AttachmentStatus {
  const min = effectiveMin(spec);
  const missing = Math.max(0, min - count);
  const met = missing === 0;
  const atMax = count >= spec.max;
  const label = spec.label.trim().toLowerCase() || "archivos";
  const text =
    min > 0
      ? `${Math.min(count, min)} de ${min} ${label} requeridas`
      : count === 0
        ? `Opcional: sin archivos`
        : `${count} ${count === 1 ? "archivo cargado" : "archivos cargados"} (opcional)`;
  return { met, missing, atMax, text };
}

/** Falta algo para poder enviar: `counts` es cuántos archivos ya subidos tiene cada especificación. */
export function unmetSpecs(specs: readonly AttachmentSpec[], counts: Readonly<Record<string, number>>): AttachmentSpec[] {
  return specs.filter((s) => !attachmentStatus(s, counts[s.key] ?? 0).met);
}

/** Errores de la especificación de anexos del administrador. */
export function specProblems(specs: readonly AttachmentSpec[]): string[] {
  const out: string[] = [];
  if (specs.length > MAX_SPECS) out.push(`Máximo ${MAX_SPECS} anexos por formato.`);
  const seen = new Set<string>();
  specs.forEach((s, i) => {
    const n = s.label.trim() ? `«${s.label.trim()}»` : `El anexo ${i + 1}`;
    if (!s.label.trim()) out.push(`El anexo ${i + 1} necesita una etiqueta.`);
    if (!SPEC_KEY_RE.test(s.key)) out.push(`${n}: la clave debe empezar con letra y usar solo letras, números y guion bajo.`);
    if (seen.has(s.key)) out.push(`${n}: la clave «${s.key}» está repetida.`);
    seen.add(s.key);
    if (!Number.isInteger(s.min) || s.min < 0) out.push(`${n}: el mínimo debe ser 0 o más.`);
    if (!Number.isInteger(s.max) || s.max < 1) out.push(`${n}: el máximo debe ser al menos 1.`);
    if (s.max > MAX_FILES_PER_SPEC) out.push(`${n}: el máximo es ${MAX_FILES_PER_SPEC} archivos.`);
    if (s.min > s.max) out.push(`${n}: el mínimo no puede ser mayor que el máximo.`);
    if (s.accept.length === 0) out.push(`${n}: elige al menos un tipo de archivo.`);
    if (!(s.maxSizeMB > 0) || s.maxSizeMB > MAX_SIZE_MB) out.push(`${n}: el tamaño máximo va de 1 a ${MAX_SIZE_MB} MB.`);
  });
  return out;
}

/**
 * Errores por anexo que devuelve el servidor al crear la solicitud. El contrato admite una lista
 * `errors: [{ specKey, message }]` o un mapa `{ [specKey]: mensaje }` (en `errors` o en `attachments`).
 */
export function attachmentErrorsFrom(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body || typeof body !== "object") return out;
  const add = (key: unknown, msg: unknown) => {
    if (typeof key !== "string" || !key) return;
    const text = Array.isArray(msg) ? msg.filter((m) => typeof m === "string").join(" ") : typeof msg === "string" ? msg : "";
    if (text) out[key] = out[key] ? `${out[key]} ${text}` : text;
  };
  const b = body as Record<string, unknown>;
  for (const bag of [b.errors, b.attachments]) {
    if (Array.isArray(bag)) {
      for (const e of bag) {
        if (e && typeof e === "object") {
          const o = e as Record<string, unknown>;
          add(o.specKey ?? o.key ?? o.spec, o.message ?? o.error);
        }
      }
    } else if (bag && typeof bag === "object") {
      for (const [k, v] of Object.entries(bag)) add(k, v);
    }
  }
  return out;
}
