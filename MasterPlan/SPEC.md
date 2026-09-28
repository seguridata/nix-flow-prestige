# SPEC P1 — Prestige homologado al plan de cimiento

Versión: 2026-09-26  
Repo: `seguridata/nix-flow-prestige`  
Stack vigente: Next.js 16 (`frontend/web`) + NestJS BFF (`backend/bff`) + Prisma 6 + PostgreSQL + MinIO + Temporal + Keycloak + Redis.

## 1. Objetivo

Homologar Prestige al plan:

1. Auth + tenants + upload + sha256 + freeze  
2. Envelope + magic link + pantalla firmar + acepto + log  
3. Passkeys  
4. Adapter IdV (INE OCR + CURP + liveness + face match)  
5. Políticas por plantilla (`kycPolicy`, seq/par)  
6. Evidence zip  
7. Firma digital KMS — **después**, no en P1

## 2. Principios (no negociables)

1. El PDF congelado no se reescribe.  
2. Se firma / se acepta un **hash**, no “un botón”.  
3. Passkey = puerta. Clave de documento = sello (P2).  
4. IdV es un puerto. El BFF no implementa liveness.  
5. PII biométrica no vive en Postgres como base64.  
6. Toda fila caliente lleva `tenantId`.  
7. Links de firma: un uso, TTL, atados a `docVersionId + hash`.  
8. HMAC interno no se llama “firma digital” en UI ni en API pública.

## 3. Vocabulario

| Término | Significado |
|---|---|
| Case / Expediente | `Case` existente |
| DocumentVersion | Una versión inmutable de bytes + `sha256` |
| Freeze | `locked=true` sobre esa versión; no hay PATCH de bytes |
| Envelope | Hoy `SignatureRequest` — se renombra en API a `envelope` |
| Recipient | Hoy `Signer` |
| Ceremony | Flujo `/sign/[token]` |
| Evidence pack | ZIP: pdf canónico + events.jsonl + idv.json + manifest.json |
| IdV session | Resultado de vendor, referenciado por id |

## 4. Contrato de integridad

```
upload(bytes) → objectKey + sha256
freeze(documentId) → locked, frozenHash = sha256
present(token) → stream exactamente esos bytes
beforeAccept → sha256(storage[objectKey]) == frozenHash
accept → event(ACCEPT, hash, actor, prevEventHash)
close → pack.zip + packSha256
```

Si el hash no cuadra: `409 HASH_MISMATCH`, no hay evento de firma.

## 5. Auth y tenants

### 5.1 Internos

- Keycloak realm `prestige` ya existe.
- El front deja de usar sesión `maria`.
- BFF: JWT obligatorio excepto `@Public()` en `/sign/:token/*` y webhooks IdV.
- Claims: `sub`, `email`, `tenant_id` (o `tenantId` en token / tabla `Membership`).

### 5.2 Tabla Membership (nueva)

```
Membership { userId, tenantId, role: OWNER|ADMIN|MEMBER|AUDITOR }
```

Un usuario puede estar en N tenants. El request elige tenant con header `X-Tenant-Id`.

### 5.3 Externos (firmante invitado)

No tienen cuenta. Entran con magic link. Opcional: passkey de ceremonia (descubrible por `token`, no por usuario permanente).

## 6. Upload + freeze

### API

```
POST /v1/cases/:caseId/documents
  multipart PDF
  → { id, version, sha256, objectKey, locked:false }

POST /v1/documents/:id/freeze
  → { id, version, sha256, locked:true }

GET  /v1/documents/:id/bytes
  URL prefirmada MinIO, nunca base64 en JSON
```

### Cambios de modelo

- Dejar de escribir `contentBase64` en create (columna nullable, deprecar, migrar off).
- `Document.tenantId` obligatorio.
- `Document.sha256` (renombrar `hash` en API; en DB se puede alias).
- Freeze incrementa versión solo si había draft no locked. Un locked no recibe otro upload in-place: se crea `Document` hijo o `DocumentVersion` nueva.

Preferencia P1: tabla nueva `DocumentVersion` y `Document` apunta a `currentVersionId`. Si el tiempo aprieta: un `Document` = una versión y “nueva versión” = nuevo row.

## 7. Envelope + magic link + acepto

### API

```
POST /v1/envelopes
  { documentId, order: SEQUENTIAL|PARALLEL, kycPolicy, recipients[], slaHours, templateId? }

POST /v1/envelopes/:id/start
  genera tokens, arranca Temporal (o fallback ya existente)

GET  /v1/sign/:token          @Public
POST /v1/sign/:token/consent  { textVersion }
POST /v1/sign/:token/complete { method: ACCEPT|AUTOGRAFA|PASSKEY, assertion?, stroke? }
```

### Token

- Random 256-bit, se guarda **solo hash** del token (`sha256(token)`).
- TTL default 72h o `expiresAt` del request.
- Un uso para `complete`. Consent puede repetirse misma versión de texto.
- Binding: `envelopeId + recipientId + frozenHash`.

### Pantalla firmar (`frontend/web`)

Orden:

1. Validar token.  
2. Mostrar consentimiento v1.1 (ya existe).  
3. Si `kycPolicy` lo exige y no hay IdV fresco → wizard IdV.  
4. Si passkey requerida → WebAuthn.  
5. Preview PDF (bytes congelados).  
6. Acepto / autógrafa (trazo se guarda aparte).  
7. Recibo.

Autógrafa: **no** llamar `PdfStampService` sobre el objeto MinIO canónico. Guardar PNG + metadata en evidence. Overlay solo en `preview-copy` efímera.

## 8. Passkeys

Librería server: `@simplewebauthn/server`.  
Client: `@simplewebauthn/browser`.

```
POST /v1/webauthn/register/begin    (usuario interno)
POST /v1/webauthn/register/finish
POST /v1/sign/:token/passkey/begin  challenge = sha256(frozenHash || envelopeId || nonce)
POST /v1/sign/:token/passkey/finish
```

Persistir: `PasskeyCredential { userId?, recipientId?, credentialId, publicKey, counter, transports }`.

Passkey **no** produce PAdES. Produce evento `PASSKEY_ASSERTED` + se permite `complete`.

## 9. Adapter IdV

### Puerto

```ts
interface IdvProvider {
  start(input: {
    tenantId: string
    purpose: 'onboarding' | 'ceremony'
    subject: { fullName?: string; email?: string; curp?: string }
    returnUrl: string
  }): Promise<{ sessionId: string; sessionUrl: string }>

  getResult(sessionId: string): Promise<IdvResult>
}

type IdvResult = {
  sessionId: string
  vendor: string
  curp?: string
  ocr?: { nombre?: string; cic?: string; vigencia?: string }
  renapoStatus: 'VALID' | 'INVALID' | 'UNKNOWN'
  ineNominalStatus: 'VIGENTE' | 'NO_VIGENTE' | 'UNKNOWN'
  liveness: boolean
  faceScore: number | null
  faceMatch: boolean
  rawRef: string // id en vendor, no payload PII
}
```

### Implementaciones P1

- `SandboxIdvProvider` — siempre OK en `NODE_ENV=development` si no hay URL.  
- `HttpIdvProvider` — `IDV_PROVIDER_URL` + `IDV_API_KEY` (reemplaza el fetch actual de `biometric.adapter.ts`).

Webhook: `POST /v1/webhooks/idv` HMAC, `@Public`.

### Onboarding (`OnboardingCase`)

Quitar `ineFrontBase64`, `ineBackBase64`, `selfieBase64`.  
Dejar: hashes, scores, `biometricSessionId`, flags.  
Fotos → MinIO prefix `tenant/idv/{sessionId}/` con retención corta.

`kycPolicy` del envelope:

- `none` — no IdV  
- `once` — IdV vigente ≤ 90 días para ese email/CURP  
- `every_sign` — IdV en esta ceremonia

## 10. Políticas por plantilla

Nueva tabla `EnvelopeTemplate`:

```
id, tenantId, name,
order: SEQUENTIAL|PARALLEL,
kycPolicy: none|once|every_sign,
allowedMethods: ACCEPT|AUTOGRAFA|PASSKEY|DIGITAL_DEV,
requirePasskey: boolean,
slaHours: int
```

`POST /v1/envelopes` puede mandar `templateId` o override explícito.

## 11. Log encadenado

`ProcessAuditEvent` ya existe. P1:

- Campos: `tenantId`, `prevHash`, `eventHash`.  
- `eventHash = sha256(prevHash|ts|actor|action|docSha|canonicalJson(payload))`.  
- Insert-only. Sin `UPDATE`/`DELETE` en código.

Eventos mínimos: `DOC_UPLOADED`, `DOC_FROZEN`, `ENVELOPE_STARTED`, `TOKEN_ISSUED`, `CONSENT`, `IDV_COMPLETED`, `PASSKEY_ASSERTED`, `ACCEPTED`, `REJECTED`, `HASH_MISMATCH`, `ENVELOPE_CLOSED`, `PACK_BUILT`.

## 12. Evidence zip

Al `COMPLETADA`:

```
pack/
  document.pdf          # bytes congelados
  document.sha256
  events.jsonl
  consents.json
  idv.json              # ids + scores, sin fotos
  signatures.json       # métodos usados
  manifest.json         # EvidenceManifest
  pack.sha256
```

`GET /v1/envelopes/:id/pack` → URL prefirmada.  
`EvidenceManifest.packageHash` = sha256 del zip.

## 13. Qué hacer con DIGITAL en P1 (corregido 2026-09-26, verificado contra código)

Esta sección asumía `DigitalSignerAdapter = HMAC`. Es falso para el código
actual: ya firma PAdES real (X.509 emitido por una CA interna + PKCS#7
CAdES-detached, `backend/bff/src/signing/digital.adapter.ts`), con el
custodio de llave conmutable a HSM vía `KEY_CUSTODIAN=pkcs11`. No hay
HMAC que gatear, y `ALLOW_DEV_HMAC` no está referenciado en ningún código —
es un flag vestigial en `.env.example`, documentado ahí para que ningún
entorno futuro vuelva a vender un HMAC como firma digital.

Lo que sigue siendo cierto y sí aplica en P1:

- El PDF congelado no se reescribe: la firma persiste en `presented*`
  (columnas nuevas), nunca en `objectKey`/`hash` del `Document`.
- `capabilities()` debe seguir reportando de forma honesta si el custodio
  es software o HSM (ya lo hace).

P2 real, dado lo anterior: mover el custodio de software a HSM/KMS
(`KEY_CUSTODIAN=pkcs11` ya es el enchufe) y cerrar TSA/NOM-151. No es
"construir KMS/PAdES desde cero" como decía este spec — eso ya existe.

## 14. Temporal

No se quita. Se reduce el alcance:

- Workflow: esperar señales `consent`, `signed`, `rejected`, timer SLA.  
- Al firmar, el BFF persiste primero (fuente de verdad = Postgres). Luego `signal`.  
- Si Temporal cae, el fallback local actual sigue; el pack se arma igual.

No se diseña BPMN nuevo en P1.

## 15. Seguridad P1

- TLS en deploy.  
- Tokens: hash at rest.  
- MinIO: keys `tenantId/caseId/docId/versionId.pdf`.  
- Webhooks IdV: HMAC.  
- Rate limit `/sign/*` por IP.  
- No loguear CURP ni tokens en claro.  
- Secret HMAC de dev distinto por entorno; nunca default en prod.

## 16. Fuera de alcance P1

NOM-151 emisión, HSM, FIEL SAT, blockchain, smart contracts, NFC INE nativo, white-label multi-CA.
