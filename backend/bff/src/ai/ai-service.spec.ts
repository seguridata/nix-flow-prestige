import { BadGatewayException, BadRequestException, HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Flow } from '../flow/flow.types';
import { AiQuotaService } from './ai-quota.service';
import { AiService } from './ai.service';
import { LlmProviderError, type LlmProvider, type LlmRequest } from './llm.types';

const flow: Flow = {
  order: 'SECUENCIAL',
  slaHours: 72,
  variables: [],
  steps: [{ id: 'a', label: 'Firma', who: { type: 'initiator' }, role: 'FIRMANTE' }],
};

function setup(reply: string | Error = JSON.stringify(flow)) {
  const calls: LlmRequest[] = [];
  const provider: LlmProvider = {
    name: 'fake',
    async complete(req) {
      calls.push(req);
      if (reply instanceof Error) throw reply;
      return { text: reply, model: 'm1', usage: { inputTokens: 7, outputTokens: 3 } };
    },
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const quota = new AiQuotaService({ client: () => null } as never);
  return { svc: new AiService(provider, quota, audit as never), calls, audit };
}

const actor = (tenantId: string) => ({ tenantId, actorId: 'maria', name: 'María' });
const DESC = 'Contrato donde firma quien solicita y luego el director';

beforeEach(() => {
  Object.assign(process.env, { AI_RPM_PER_TENANT: '2', AI_MONTHLY_PER_TENANT: '100' });
});

describe('AiService.flowFromText', () => {
  it('devuelve el flujo propuesto sin guardar nada', async () => {
    const { svc } = setup();
    const r = await svc.flowFromText(actor('t1'), DESC);
    expect(r.flow).toEqual(flow);
    expect(r.errors).toEqual([]);
    expect(r.meta).toEqual({ model: 'm1', attempts: 1 });
  });

  it('enmascara datos personales antes de enviar al modelo y lo avisa', async () => {
    const { svc, calls } = setup();
    const r = await svc.flowFromText(actor('t1'), `${DESC}. CURP GOMA800101HDFRRN09 y correo ana@acme.mx`);
    const sent = calls[0]!.messages[0]!.content;
    expect(sent).not.toMatch(/GOMA800101|ana@acme\.mx/);
    expect(r.warnings[0]).toContain('enmascararon');
  });

  it('audita con el tenant del actor y sin guardar el texto', async () => {
    const { svc, audit } = setup();
    await svc.flowFromText(actor('t9'), `${DESC} secretísimo`);
    const call = audit.append.mock.calls[0]![0];
    expect(call.tenantId).toBe('t9');
    expect(call.action).toBe('AI_FLOW_PROPOSED');
    expect(JSON.stringify(call.payload)).not.toContain('secretísimo');
    expect(call.payload).toMatchObject({ provider: 'fake', model: 'm1', ok: true, attempts: 1 });
  });

  it('la cuota es por tenant: agotar uno no afecta a otro', async () => {
    const { svc } = setup();
    await svc.flowFromText(actor('a'), DESC);
    await svc.flowFromText(actor('a'), DESC);
    await expect(svc.flowFromText(actor('a'), DESC)).rejects.toBeInstanceOf(HttpException);
    await expect(svc.flowFromText(actor('b'), DESC)).resolves.toBeDefined();
  });

  it('rechaza textos demasiado cortos o largos antes de gastar cuota o llamar al modelo', async () => {
    const { svc, calls } = setup();
    await expect(svc.flowFromText(actor('t'), 'corto')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.flowFromText(actor('t'), 'x'.repeat(8001))).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('un fallo del proveedor es un 502 y no revienta la auditoría', async () => {
    const { svc } = setup(new LlmProviderError('el proveedor respondió 500', 500));
    await expect(svc.flowFromText(actor('t'), DESC)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('si la auditoría falla, la propuesta se devuelve igual', async () => {
    const { svc, audit } = setup();
    audit.append.mockRejectedValue(new Error('db'));
    await expect(svc.flowFromText(actor('t'), DESC)).resolves.toMatchObject({ flow });
  });

  it('una respuesta inválida del modelo devuelve errores y flow null', async () => {
    const { svc } = setup('no es json');
    const r = await svc.flowFromText(actor('t'), DESC);
    expect(r.flow).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('AiService.review', () => {
  it('sin useAi solo corre reglas y no toca cuota ni modelo', async () => {
    const { svc, calls } = setup();
    const r = await svc.review(actor('t'), flow, false);
    expect(r.ai).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('con useAi suma los hallazgos del modelo, saneados', async () => {
    const reply = JSON.stringify({ hallazgos: [{ severity: 'warn', title: 'Orden raro', detail: 'x', stepId: 'a' }, { severity: 'bloqueante', title: 'Otro', stepId: 'inexistente' }, { title: '' }] });
    const { svc, audit } = setup(reply);
    const r = await svc.review(actor('t'), flow, true);
    const ia = r.findings.filter((f) => f.source === 'ia');
    expect(ia).toHaveLength(2);
    expect(ia[0]).toMatchObject({ severity: 'warn', stepId: 'a' });
    expect(ia[1]).toMatchObject({ severity: 'info' });
    expect(ia[1]!.stepId).toBeUndefined();
    expect(audit.append.mock.calls[0]![0].action).toBe('AI_FLOW_REVIEWED');
  });

  it('si el flujo es inválido no gasta IA y devuelve los errores de reglas', async () => {
    const { svc, calls } = setup();
    const r = await svc.review(actor('t'), { ...flow, steps: [] }, true);
    expect(calls).toHaveLength(0);
    expect(r.findings[0]?.severity).toBe('error');
  });
});
