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

describe('AiService.templateFromPdf', () => {
  async function pdf(withField = true): Promise<Buffer> {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    if (withField) {
      const form = doc.getForm();
      form.createTextField('nombre').addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
      form.createTextField('firma').addToPage(page, { x: 50, y: 100, width: 200, height: 50 });
    }
    return Buffer.from(await doc.save());
  }
  // Los candidatos se ordenan por posición: c1 = «nombre» (arriba), c2 = «firma» (abajo).
  const reply = {
    name: 'Formato de prueba',
    fields: [{ candidate: 'c1', label: 'Nombre', type: 'text', required: true }],
    signatureBoxes: [{ candidate: 'c2', stepId: 'firma' }],
    flow: { order: 'SECUENCIAL', slaHours: 24, steps: [{ id: 'firma', label: 'Firma', role: 'FIRMANTE', who: { type: 'initiator' } }] },
  };

  it('propone un formato, audita con el tenant y no guarda el contenido', async () => {
    const { svc, audit } = setup(JSON.stringify(reply));
    const r = await svc.templateFromPdf(actor('t7'), await pdf(), 'Formato con CURP GOMA800101HDFRRN09');
    expect(r.errors).toEqual([]);
    expect(r.meta?.fields[0]).toMatchObject({ key: 'nombre', page: 1 });
    const call = audit.append.mock.calls[0]![0];
    expect(call).toMatchObject({ tenantId: 't7', action: 'AI_TEMPLATE_PROPOSED' });
    expect(call.payload.masked).toMatchObject({ CURP: 1 });
  });

  it('rechaza lo que no es PDF sin gastar cuota ni llamar al modelo', async () => {
    const { svc, calls } = setup();
    await expect(svc.templateFromPdf(actor('t'), Buffer.from('hola mundo'), '')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.templateFromPdf(actor('t'), undefined, '')).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('un PDF sin campos no llama al modelo ni gasta cuota y explica por qué', async () => {
    const { svc, calls, audit } = setup();
    for (let i = 0; i < 5; i++) {
      const r = await svc.templateFromPdf(actor('sc'), await pdf(false), '');
      expect(r.meta).toBeNull();
      expect(r.errors.join(' ')).toContain('no tiene campos');
    }
    expect(calls).toHaveLength(0);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('un PDF corrupto con cabecera válida es un 400', async () => {
    const { svc } = setup();
    await expect(svc.templateFromPdf(actor('t'), Buffer.from('%PDF-1.7 basura'), '')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('respeta la cuota por tenant', async () => {
    const { svc } = setup(JSON.stringify(reply));
    const bytes = await pdf();
    await svc.templateFromPdf(actor('q'), bytes, '');
    await svc.templateFromPdf(actor('q'), bytes, '');
    await expect(svc.templateFromPdf(actor('q'), bytes, '')).rejects.toBeInstanceOf(HttpException);
    await expect(svc.templateFromPdf(actor('otro'), bytes, '')).resolves.toBeDefined();
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
