/**
 * Demo de Prestige — carga un escenario realista usando el API REAL del BFF
 * (nada de inserciones directas para lo que tiene flujo: workflow, cadena de
 * auditoría, evidencia y bandeja de salida de correo se ejercitan de verdad).
 *
 *   cd backend/bff && bun prisma/scripts/demo-seed.ts
 *   (o automático al final de `bun run dev`)
 *
 * Idempotente: si ya existe el caso "DEMO — …" no hace nada. Para rehacerlo:
 *   bun prisma/scripts/demo-seed.ts --reset
 */
import { PrismaClient } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import jpeg from 'jpeg-js';

// IPv4 explícito: en Windows `localhost` resuelve a ::1 primero y `fetch`
// puede colgarse 10 s (UND_ERR_CONNECT_TIMEOUT) contra el BFF de Node.
const BFF = process.env.DEMO_BFF_URL ?? 'http://127.0.0.1:3000';
const KC =
  (process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8081/realms/prestige') +
  '/protocol/openid-connect/token';
const DEMO_CASE = 'DEMO — Adquisición de servicios 2026';
const prisma = new PrismaClient();
const reset = process.argv.includes('--reset');

const c = {
  ok: (m: string) => console.log(`\x1b[32m  ✓\x1b[0m ${m}`),
  info: (m: string) => console.log(`\x1b[36m[demo]\x1b[0m ${m}`),
  warn: (m: string) => console.log(`\x1b[33m  !\x1b[0m ${m}`),
};

async function token(username: string, password: string): Promise<string> {
  const r = await fetch(KC, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'prestige-web', username, password }),
  });
  if (!r.ok) throw new Error(`token ${username}: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token as string;
}

function client(tok: string) {
  return async <T = any>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> => {
    const r = await fetch(`${BFF}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${tok}`,
        ...(form ? {} : body ? { 'content-type': 'application/json' } : {}),
      },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const t = await r.text();
    const j = t ? JSON.parse(t) : {};
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 300)}`);
    return j as T;
  };
}

async function pdf(title: string, paragraphs: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  page.drawText('PRESTIGE', { x: 60, y: 790, size: 10, font: bold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(title, { x: 60, y: 760, size: 18, font: bold });
  let y = 720;
  for (const p of paragraphs) {
    for (const line of wrap(p, 92)) {
      page.drawText(line, { x: 60, y, size: 11, font, color: rgb(0.15, 0.15, 0.15) });
      y -= 16;
    }
    y -= 10;
  }
  page.drawText('_______________________', { x: 60, y: 120, size: 11, font });
  page.drawText('Firma', { x: 60, y: 104, size: 9, font });
  return doc.save({ useObjectStreams: false });
}

/** `new Blob` en bun-types no acepta `Uint8Array<ArrayBufferLike>` directo. */
function blob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type });
}

function wrap(s: string, n: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > n) {
      out.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

function demoJpeg(w = 320, h = 200, shade = 210): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const noise = ((i * 2654435761) % 44) - 22;
    data[i * 4] = shade + noise;
    data[i * 4 + 1] = shade + noise;
    data[i * 4 + 2] = shade + noise - 6;
    data[i * 4 + 3] = 255;
  }
  return new Uint8Array(jpeg.encode({ data, width: w, height: h }, 82).data);
}

// CURP sintética válida (dígito verificador correcto).
const DICT = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
function curpCheck(b17: string) {
  let s = 0;
  for (let i = 0; i < 17; i++) s += Math.max(0, DICT.indexOf(b17[i])) * (18 - i);
  const d = 10 - (s % 10);
  return d === 10 ? 0 : d;
}
const DEMO_CURP = 'TOAA900312MDFRRN0' + curpCheck('TOAA900312MDFRRN0');

async function uploadDoc(api: ReturnType<typeof client>, caseId: string, filename: string, bytes: Uint8Array) {
  const form = new FormData();
  form.append('file', blob(bytes, 'application/pdf'), filename);
  form.append('caseId', caseId);
  return api<{ id: string }>('POST', '/documents', undefined, form);
}

async function main() {
  c.info(`Sembrando demo contra ${BFF} …`);

  const existing = await prisma.case.findFirst({ where: { title: DEMO_CASE } }).catch(() => null);
  if (existing && !reset) {
    c.info('La demo ya está cargada (caso "DEMO — …"). Nada que hacer. Usa --reset para rehacerla.');
    return;
  }
  if (existing && reset) {
    c.warn('--reset: borro el caso DEMO y sus datos derivados…');
    const docs = await prisma.document.findMany({ where: { caseId: existing.id }, select: { id: true } });
    const docIds = docs.map((d) => d.id);
    const reqs = await prisma.signatureRequest.findMany({ where: { documentId: { in: docIds } }, select: { id: true } });
    const reqIds = reqs.map((r) => r.id);
    await prisma.evidenceManifest.deleteMany({ where: { signatureRequestId: { in: reqIds } } });
    await prisma.signatureEventTimestamp.deleteMany({ where: { signatureRequestId: { in: reqIds } } });
    await prisma.oneTimeLink.deleteMany({ where: { signatureRequestId: { in: reqIds } } });
    await prisma.humanTask.deleteMany({ where: { signatureRequestId: { in: reqIds } } });
    await prisma.consentAcceptance.deleteMany({ where: { signatureRequestId: { in: reqIds } } });
    await prisma.workflowRun.deleteMany({ where: { signatureRequestId: { in: reqIds } } });
    await prisma.signer.deleteMany({ where: { signatureRequestId: { in: reqIds } } });
    await prisma.signatureRequest.deleteMany({ where: { id: { in: reqIds } } });
    await prisma.signatureField.deleteMany({ where: { documentId: { in: docIds } } });
    await prisma.documentComment.deleteMany({ where: { documentId: { in: docIds } } });
    await prisma.document.deleteMany({ where: { id: { in: docIds } } });
    await prisma.case.delete({ where: { id: existing.id } });
    await prisma.onboardingCase.deleteMany({ where: { fullName: 'Ana Torres Rincón' } });
  }

  const [roberto, maria, carlos] = await Promise.all([
    token('roberto', 'roberto123'),
    token('maria', 'maria123'),
    token('carlos', 'carlos123'),
  ]);
  const R = client(roberto);
  const M = client(maria);
  const C = client(carlos);
  c.ok('tokens de roberto / maria / carlos');

  // ---- Control plane (roberto = admin) ----
  try {
    await R('PUT', '/admin/tenants/seguridata/policies', {
      key: 'signature.policy',
      value: { allowedMethods: ['DIGITAL', 'AUTOGRAFA'], defaultSlaHours: 72, defaultOrder: 'SECUENCIAL', requireTimestamp: true },
    });
    for (const [userId, name, email, roles] of [
      ['roberto', 'Roberto Díaz', 'roberto@seguridata.mx', ['sender', 'rh', 'admin', 'auditor']],
      ['maria', 'María González', 'maria@seguridata.mx', ['signer']],
      ['carlos', 'Carlos Ramírez', 'carlos@seguridata.mx', ['signer', 'auditor']],
    ] as const) {
      await R('PUT', '/admin/tenants/seguridata/members', { userId, name, email, roles });
    }
    for (const [kind, key, label] of [
      ['doc-type', 'contrato', 'Contrato'],
      ['doc-type', 'anexo', 'Anexo'],
      ['doc-type', 'convenio', 'Convenio'],
      ['rechazo', 'datos-incorrectos', 'Datos incorrectos'],
    ] as const) {
      await R('PUT', '/admin/tenants/seguridata/catalogs', { kind, key, label });
    }
    c.ok('control plane: política de firma, 3 miembros, catálogos');
  } catch (e) {
    c.warn(`control plane: ${(e as Error).message}`);
  }

  // ---- Webhook de ejemplo ----
  try {
    await R('POST', '/webhooks/subscriptions', {
      url: 'https://example.com/webhooks/prestige',
      events: ['mx.seguridata.prestige.request.completed', 'mx.seguridata.prestige.evidence.sealed'],
      description: 'Integración demo (endpoint de ejemplo)',
    });
    c.ok('suscripción de webhook de ejemplo');
  } catch (e) {
    c.warn(`webhook: ${(e as Error).message}`);
  }

  // ---- Caso + documentos ----
  const kase = await R<{ id: string }>('POST', '/cases', { title: DEMO_CASE });
  const docA = await uploadDoc(R, kase.id, 'Contrato marco de servicios.pdf', await pdf('Contrato marco de servicios', [
    'Las partes acuerdan la prestación de servicios profesionales bajo los términos del presente contrato marco, con vigencia de doce meses prorrogables.',
    'El proveedor se obliga a entregar los reportes mensuales de avance y a mantener la confidencialidad de la información recibida.',
    'La contraprestación se pagará contra entrega y aceptación de cada hito, conforme al anexo técnico.',
  ]));
  const docB = await uploadDoc(R, kase.id, 'Anexo técnico.pdf', await pdf('Anexo técnico — Hitos y entregables', [
    'Hito 1: Diagnóstico y plan de trabajo (semana 2).',
    'Hito 2: Implementación del módulo de firma electrónica avanzada (semana 8).',
    'Hito 3: Pruebas de interoperabilidad y puesta en producción (semana 12).',
  ]));
  const docC = await uploadDoc(R, kase.id, 'Convenio de confidencialidad.pdf', await pdf('Convenio de confidencialidad', [
    'El receptor se compromete a no divulgar la información confidencial y a usarla únicamente para los fines del proyecto.',
    'Las obligaciones de confidencialidad subsisten por cinco años posteriores a la terminación del contrato.',
  ]));
  c.ok(`caso "${DEMO_CASE}" + 3 documentos`);

  // ---- Solicitud 1: SECUENCIAL en progreso — muestra el paso de turno.
  // maría firma → a roberto le TOCA (recibe "es tu turno" + correo) → carlos
  // queda EN ESPERA DE TURNO (sin aviso todavía).
  const req1 = await R<{ id: string }>('POST', '/signature-requests', {
    documentId: docA.id,
    methods: ['DIGITAL'],
    order: 'SECUENCIAL',
    slaHours: 120,
    signers: [
      { signerId: 'maria', name: 'María González', email: 'maria@seguridata.mx', role: 'FIRMANTE' },
      { signerId: 'roberto', name: 'Roberto Díaz', email: 'roberto@seguridata.mx', role: 'FIRMANTE' },
      { signerId: 'carlos', name: 'Carlos Ramírez', email: 'carlos@seguridata.mx', role: 'FIRMANTE' },
    ],
  });
  await M('POST', `/signature-requests/${req1.id}/actions/sign`, { method: 'DIGITAL', consentAccepted: true });
  c.ok('solicitud 1 (Contrato marco) — SECUENCIAL: maría firmó · turno de roberto · carlos en espera');

  // ---- Solicitud 2: PARALELO, COMPLETADA + evidencia ----
  const req2 = await R<{ id: string }>('POST', '/signature-requests', {
    documentId: docB.id,
    methods: ['DIGITAL'],
    order: 'PARALELO',
    slaHours: 72,
    signers: [
      { signerId: 'maria', name: 'María González', email: 'maria@seguridata.mx', role: 'FIRMANTE' },
      { signerId: 'carlos', name: 'Carlos Ramírez', email: 'carlos@seguridata.mx', role: 'FIRMANTE' },
    ],
  });
  await M('POST', `/signature-requests/${req2.id}/actions/sign`, { method: 'DIGITAL', consentAccepted: true });
  await C('POST', `/signature-requests/${req2.id}/actions/sign`, { method: 'DIGITAL', consentAccepted: true });
  c.ok('solicitud 2 (Anexo técnico) — PARALELO, COMPLETADA → manifiesto de evidencia generado');

  // ---- Solicitud 3: firmante externo (invitación + enlace de un solo uso) ----
  const req3 = await R<{ id: string }>('POST', '/signature-requests', {
    documentId: docC.id,
    methods: ['DIGITAL', 'AUTOGRAFA'],
    order: 'PARALELO',
    slaHours: 168,
    signers: [
      { signerId: 'contraparte.demo', name: 'Contraparte Externa S.A.', email: 'contraparte@ejemplo.mx', role: 'FIRMANTE' },
    ],
  });
  c.ok('solicitud 3 (Convenio) — firmante externo: invitación + enlace de un solo uso en la bandeja de correo');

  // ---- Onboarding en revisión ----
  try {
    const ob = await R<{ id: string }>('POST', '/onboarding', {
      kind: 'EMPLEADO',
      fullName: 'Ana Torres Rincón',
      email: `ana.torres.${Date.now()}@seguridata.mx`,
      curp: DEMO_CURP,
      biometricConsent: true,
    });
    for (const part of ['front', 'back'] as const) {
      const f = new FormData();
      f.append('file', blob(demoJpeg(), 'image/jpeg'), `ine-${part}.jpg`);
      f.append('part', part);
      await R('POST', `/onboarding/${ob.id}/ine`, undefined, f);
    }
    const sf = new FormData();
    sf.append('file', blob(demoJpeg(280, 280, 190), 'image/jpeg'), 'selfie.jpg');
    await R('POST', `/onboarding/${ob.id}/liveness`, undefined, sf);
    c.ok('onboarding "Ana Torres Rincón" — INE (OCR) + prueba de vida → EN_REVISIÓN');
  } catch (e) {
    c.warn(`onboarding: ${(e as Error).message}`);
  }

  c.info('Demo lista. Entra a http://127.0.0.1:3001 y accede con maria/maria123, carlos/carlos123 o roberto/roberto123.');
  c.info('Bandeja de correo de la demo: http://127.0.0.1:8025 (Mailpit).');
}

main()
  .catch((e) => {
    console.error(`\x1b[31m[demo] falló:\x1b[0m ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
