import { BadGatewayException, BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditChainService } from '../collaboration/audit-chain.service';
import { validateFlow } from '../flow/flow';
import type { Flow } from '../flow/flow.types';
import { AiQuotaService } from './ai-quota.service';
import { reviewFlowWithAi } from './flow-review-ai';
import { proposeFlow } from './flow-proposal';
import { PdfLayoutError } from './pdf-layout';
import { proposeTemplate } from './template-proposal';
import { reviewFlow, type Finding } from './flow-review';
import { LLM_PROVIDER, LlmProviderError, type LlmProvider } from './llm.types';
import { maskPii } from './pii-mask';

export interface AiActor {
  tenantId: string;
  actorId: string;
  name?: string;
}

export const MIN_TEXT = 20;
export const MAX_TEXT = 8000;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * IA para armar y revisar flujos. Principios, todos por tenant:
 *  - la IA PROPONE: nada se guarda ni se publica aquí; el administrador revisa y crea el borrador;
 *  - todo lo que devuelve el modelo pasa por `validateFlow`;
 *  - los datos personales se enmascaran antes de salir;
 *  - cada tenant tiene su cuota y su rastro de auditoría (sin guardar el texto enviado).
 */
@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    private readonly quota: AiQuotaService,
    private readonly audit: AuditChainService,
  ) {}

  private async record(actor: AiActor, action: string, payload: Record<string, unknown>) {
    try {
      await this.audit.append({ tenantId: actor.tenantId, actorId: actor.actorId, actorName: actor.name, action, payload: { provider: this.provider.name, ...payload } });
    } catch (e) {
      this.log.error(`No se pudo registrar ${action} en la auditoría: ${(e as Error).message}`);
    }
  }

  private async guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LlmProviderError) throw new BadGatewayException(e.message);
      throw e;
    }
  }

  async flowFromText(actor: AiActor, text: string) {
    const clean = text.trim();
    if (clean.length < MIN_TEXT) throw new BadRequestException(`Describe el proceso con al menos ${MIN_TEXT} caracteres.`);
    if (clean.length > MAX_TEXT) throw new BadRequestException(`La descripción admite hasta ${MAX_TEXT} caracteres.`);

    await this.quota.consume(actor.tenantId);
    const masked = maskPii(clean);
    const result = await this.guarded(() => proposeFlow(this.provider, masked.text));

    await this.record(actor, 'AI_FLOW_PROPOSED', {
      model: result.model,
      attempts: result.attempts,
      ok: Boolean(result.flow),
      inputChars: clean.length,
      masked: masked.counts,
      tokens: result.usage,
    });

    const warnings = Object.keys(masked.counts).length
      ? [`Se enmascararon datos personales antes de enviar el texto a la IA (${Object.entries(masked.counts).map(([k, n]) => `${n} ${k}`).join(', ')}).`]
      : [];
    return {
      flow: result.flow ?? null,
      errors: result.errors,
      warnings,
      review: result.flow ? reviewFlow(result.flow) : [],
      meta: { model: result.model ?? null, attempts: result.attempts },
    };
  }

  /** Reglas siempre; la opinión de la IA solo si se pide, y cuenta contra la cuota. */
  async review(actor: AiActor, flow: unknown, useAi: boolean) {
    const errors = validateFlow(flow);
    const findings: Finding[] = reviewFlow(flow as Flow);
    if (!useAi || errors.length) return { findings, ai: false };

    await this.quota.consume(actor.tenantId);
    const masked = maskPii(JSON.stringify(flow));
    const ai = await this.guarded(() => reviewFlowWithAi(this.provider, JSON.parse(masked.text) as Flow));
    await this.record(actor, 'AI_FLOW_REVIEWED', { model: ai.model, found: ai.findings.length, masked: masked.counts, tokens: ai.usage });
    return { findings: [...findings, ...ai.findings], ai: true };
  }

  /**
   * PDF con campos de formulario → formato completo para revisar. Al modelo solo le llega la estructura
   * de los campos y la descripción (enmascarada), nunca el contenido del PDF. No se guarda nada.
   */
  async templateFromPdf(actor: AiActor, pdf: Buffer | undefined, description: string) {
    if (!pdf || pdf.length === 0) throw new BadRequestException('Sube un archivo PDF.');
    if (pdf.length > MAX_PDF_BYTES) throw new BadRequestException('El PDF admite hasta 10 MB.');
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('El archivo no es un PDF.');
    if (description.length > 2000) throw new BadRequestException('La descripción admite hasta 2000 caracteres.');

    const masked = maskPii(description);
    let result;
    try {
      result = await this.guarded(() => proposeTemplate(this.provider, pdf, masked.text, () => this.quota.consume(actor.tenantId)));
    } catch (e) {
      if (e instanceof PdfLayoutError) throw new BadRequestException(e.message);
      throw e;
    }
    if (result.attempts > 0) {
      await this.record(actor, 'AI_TEMPLATE_PROPOSED', {
        model: result.model,
        attempts: result.attempts,
        ok: Boolean(result.meta),
        candidates: result.candidates,
        pdfBytes: pdf.length,
        masked: masked.counts,
        tokens: result.usage,
      });
    }
    return {
      meta: result.meta ?? null,
      errors: result.errors,
      warnings: result.warnings,
      info: { model: result.model ?? null, attempts: result.attempts, candidates: result.candidates },
    };
  }
}
