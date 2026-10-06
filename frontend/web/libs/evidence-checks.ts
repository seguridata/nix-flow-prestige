/**
 * Lo que el verificador del servidor devuelve (`GET /evidence/:manifestId/verify`), convertido en
 * filas legibles. Solo hay filas para las comprobaciones que el servidor realmente hace; si una no
 * aplica (p. ej. el manifiesto no trae sello), se dice "no aplica", nunca se da por aprobada.
 */

export type CheckValue = boolean | "sin-firma" | "sin-sello" | "sin-sellos";

export interface ServerChecks {
  documentHash: boolean;
  presentedHash: boolean;
  signedHash: boolean;
  packageHash: boolean;
  chainOfCustody: boolean;
  manifestSignature: CheckValue;
  timestamp: CheckValue;
  auditChain: boolean;
  eventTimestamps: CheckValue;
}

export interface VerificationResult {
  valid: boolean;
  mismatches: string[];
  /** Los servidores anteriores no devuelven el desglose. */
  checks?: Partial<ServerChecks>;
}

export type CheckState = "pass" | "fail" | "absent";

export interface CheckRow {
  id: keyof ServerChecks;
  title: string;
  /** Una frase con lo que quedó comprobado (o por qué falló / no aplica). */
  description: string;
  state: CheckState;
}

interface Def {
  id: keyof ServerChecks;
  title: string;
  pass: string;
  fail: string;
  absent?: string;
}

const DEFS: Def[] = [
  {
    id: "documentHash",
    title: "Documento original",
    pass: "El hash del PDF congelado coincide con el del manifiesto.",
    fail: "El PDF original ya no coincide con el hash con que se congeló.",
  },
  {
    id: "presentedHash",
    title: "Copia presentada",
    pass: "La copia de la ceremonia coincide con el hash registrado.",
    fail: "La copia de la ceremonia no coincide con el hash registrado.",
  },
  {
    id: "signedHash",
    title: "Firmas registradas",
    pass: "Los datos de los firmantes coinciden con lo que se selló.",
    fail: "Los datos de los firmantes cambiaron respecto a lo sellado.",
  },
  {
    id: "packageHash",
    title: "Paquete de evidencia",
    pass: "El hash del paquete se recalculó y coincide.",
    fail: "El hash del paquete no coincide con el recálculo.",
  },
  {
    id: "chainOfCustody",
    title: "Cadena de custodia",
    pass: "Cada evento de firma encadena con el anterior.",
    fail: "Algún eslabón de la cadena de custodia no coincide.",
  },
  {
    id: "manifestSignature",
    title: "Firma del manifiesto",
    pass: "La firma Ed25519 del manifiesto es válida.",
    fail: "La firma Ed25519 del manifiesto no es válida.",
    absent: "Este manifiesto no trae firma Ed25519.",
  },
  {
    id: "timestamp",
    title: "Sello de tiempo RFC 3161",
    pass: "El sello de tiempo del paquete es válido.",
    fail: "El sello de tiempo del paquete no es válido.",
    absent: "Este expediente no tiene sello de tiempo.",
  },
  {
    id: "auditChain",
    title: "Cadena de auditoría",
    pass: "La bitácora encadenada no muestra alteraciones.",
    fail: "La bitácora encadenada está alterada o incompleta.",
  },
  {
    id: "eventTimestamps",
    title: "Sello por cada firma",
    pass: "Cada firma tiene su propio sello de tiempo válido.",
    fail: "Algún sello de tiempo de una firma es inválido o falta.",
    absent: "Las firmas de este expediente no traen sello individual.",
  },
];

/** Filas de comprobación en el orden del servidor; omite las que el servidor no devolvió. */
export function checkRows(checks: Partial<ServerChecks> | undefined): CheckRow[] {
  if (!checks) return [];
  const rows: CheckRow[] = [];
  for (const def of DEFS) {
    const value = checks[def.id];
    if (value === undefined) continue;
    const absent = typeof value === "string";
    const state: CheckState = absent ? "absent" : value ? "pass" : "fail";
    rows.push({
      id: def.id,
      title: def.title,
      state,
      description: state === "pass" ? def.pass : state === "fail" ? def.fail : (def.absent ?? "No aplica en este expediente."),
    });
  }
  return rows;
}

export type VerdictKind = "intact" | "failed" | "checking";

export interface Verdict {
  kind: VerdictKind;
  title: string;
  detail: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * El veredicto sale SIEMPRE de `valid` del servidor. "Íntegro" solo si el verificador lo confirmó; el
 * conteo cuenta únicamente comprobaciones que aplican, y lo que no aplica se declara aparte.
 */
export function verdictOf(result: VerificationResult | null | undefined): Verdict {
  if (!result) return { kind: "checking", title: "Verificando el expediente…", detail: "El servidor recalcula cada comprobación." };
  const rows = checkRows(result.checks);
  const applicable = rows.filter((r) => r.state !== "absent");
  const passed = applicable.filter((r) => r.state === "pass").length;
  const absent = rows.length - applicable.length;

  if (!result.valid) {
    const failed = applicable.length - passed;
    return {
      kind: "failed",
      title: "No se pudo confirmar la integridad",
      detail:
        failed > 0
          ? `${plural(failed, "comprobación falló", "comprobaciones fallaron")}. Revisa el detalle antes de confiar en este expediente.`
          : "El verificador del servidor reportó diferencias. Revisa el detalle.",
    };
  }
  if (applicable.length === 0) {
    return { kind: "intact", title: "Íntegro", detail: "El verificador del servidor lo confirmó." };
  }
  const base = `${plural(passed, "comprobación pasó", "comprobaciones pasaron")}`;
  return {
    kind: "intact",
    title: `Íntegro: ${passed} de ${applicable.length} comprobaciones pasaron`,
    detail:
      absent > 0
        ? `${base}. ${plural(absent, "no aplica", "no aplican")} en este expediente.`
        : "El verificador del servidor recalculó cada comprobación.",
  };
}

/** Siempre se muestra: es una afirmación verdadera sobre lo que este expediente NO es. */
export const TRUST_NOTE =
  "La cadena de certificados es de la CA interna de SeguriData; no es una autoridad pública de confianza. El expediente no incluye constancia NOM-151.";

/** El verificador sin conexión viene dentro del ZIP (ver LEEME.txt del expediente). */
export const OFFLINE_VERIFY_COMMAND = "cd verificador && npm install && node verify.mjs ..";

/** Eventos de la cadena de custodia en español (el manifiesto solo registra firmas hoy). */
export function custodyLabel(action: string): string {
  if (action === "SIGNATURE_APPLIED") return "Firma aplicada";
  return action.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
