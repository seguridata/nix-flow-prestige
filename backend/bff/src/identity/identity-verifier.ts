import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { parseCurp } from './curp';
import type { IneOcrResult } from './ocr.service';

export const IDENTITY_VERIFIER = Symbol('IDENTITY_VERIFIER');

export interface IdentityCheckInput {
  declaredCurp?: string | null;
  declaredName?: string | null;
  ocr?: IneOcrResult | null;
}

export interface IdentityCheck {
  kind: string;
  ok: boolean;
  score: number; // 0..1
  reasons: string[];
  fields: {
    curp?: string;
    curpValid?: boolean;
    curpMatches?: boolean;
    vigencia?: string;
    vigente?: boolean;
    birthDate?: string;
    sex?: 'H' | 'M';
    state?: string;
  };
  at: string;
}

export interface IdentityVerifier {
  readonly kind: string;
  verify(input: IdentityCheckInput): Promise<IdentityCheck>;
}

/**
 * M16 — verificación heurística (sin terceros): estructura + dígito verificador
 * de la CURP, vigencia de la INE (año OCR >= año actual) y consistencia con lo
 * declarado en el alta. Suficiente para asistir a RH; el fallo NO rechaza solo.
 */
@Injectable()
export class HeuristicIdentityVerifier implements IdentityVerifier {
  readonly kind = 'heuristic';

  async verify(input: IdentityCheckInput): Promise<IdentityCheck> {
    const reasons: string[] = [];
    const ocrCurp = input.ocr?.fields.curp?.toUpperCase();
    const curp = ocrCurp ?? input.declaredCurp?.toUpperCase() ?? undefined;

    const parsed = parseCurp(curp);
    if (!curp) reasons.push('no se detectó CURP en la INE ni en el alta');
    else if (!parsed.valid) reasons.push(`CURP inválida: ${parsed.reasons.join(', ')}`);

    let curpMatches: boolean | undefined;
    if (ocrCurp && input.declaredCurp) {
      curpMatches = ocrCurp === input.declaredCurp.toUpperCase();
      if (!curpMatches) reasons.push('la CURP de la INE no coincide con la declarada');
    }

    const vigencia = input.ocr?.fields.vigencia;
    let vigente: boolean | undefined;
    if (vigencia) {
      vigente = Number(vigencia) >= new Date().getFullYear();
      if (!vigente) reasons.push(`INE vencida (vigencia ${vigencia})`);
    } else {
      reasons.push('no se detectó la vigencia de la INE');
    }

    const ocrOk = (input.ocr?.confidence ?? 0) >= 40;
    if (!ocrOk) reasons.push(`OCR de baja confianza (${input.ocr?.confidence ?? 0})`);

    // score: cada señal positiva suma.
    const signals = [parsed.valid, curpMatches !== false, vigente !== false, ocrOk];
    const score = signals.filter(Boolean).length / signals.length;
    const ok = parsed.valid && vigente !== false && curpMatches !== false;

    return {
      kind: this.kind,
      ok,
      score: Number(score.toFixed(2)),
      reasons,
      fields: {
        curp,
        curpValid: parsed.valid,
        curpMatches,
        vigencia,
        vigente,
        birthDate: parsed.birthDate,
        sex: parsed.sex,
        state: parsed.state,
      },
      at: new Date().toISOString(),
    };
  }
}

/**
 * M16 — esqueleto de verificación contra RENAPO / lista nominal del INE.
 * `IDENTITY_VERIFIER=renapo` + `RENAPO_URL` (+ credenciales). Sin `RENAPO_URL`
 * lanza 503 para no dar falsos positivos.
 */
@Injectable()
export class RenapoIdentityVerifier implements IdentityVerifier {
  readonly kind = 'renapo';
  private readonly log = new Logger(RenapoIdentityVerifier.name);

  async verify(input: IdentityCheckInput): Promise<IdentityCheck> {
    const url = process.env.RENAPO_URL;
    if (!url) {
      throw new ServiceUnavailableException('RENAPO_URL no configurado (IDENTITY_VERIFIER=renapo)');
    }
    const curp = input.ocr?.fields.curp ?? input.declaredCurp ?? '';
    const res = await fetch(`${url.replace(/\/$/, '')}/curp/${encodeURIComponent(curp)}`, {
      headers: { authorization: `Bearer ${process.env.RENAPO_API_KEY ?? ''}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new ServiceUnavailableException(`RENAPO respondió ${res.status}`);
    const data = (await res.json()) as { valid?: boolean; nombre?: string; vigente?: boolean };
    this.log.log(`RENAPO CURP ${curp}: valid=${data.valid} vigente=${data.vigente}`);
    return {
      kind: this.kind,
      ok: Boolean(data.valid && data.vigente),
      score: data.valid ? (data.vigente ? 1 : 0.5) : 0,
      reasons: data.valid ? [] : ['RENAPO no reconoce la CURP'],
      fields: { curp, curpValid: data.valid, vigente: data.vigente },
      at: new Date().toISOString(),
    };
  }
}
