# AGENTS.md — Prestige P1

Instrucciones para humanos y agentes de código que toquen `seguridata/nix-flow-prestige`.

## Nota de estado (2026-09-26, verificado contra código)

Este paquete se escribió auditando un commit (`d80a296`) anterior al merge de
`feat/fase-a-b-produccion`. Ese merge ya resolvió buena parte de lo que
`REPORTE.md` describe como pendiente: `Document.tenantId`/`objectKey`/`enc`
sin `contentBase64`, cadena de auditoría (`ProcessAuditEvent.prevHash`),
`TenantMembership`, `OneTimeLink`. Antes de asumir que algo "falta", revisa
el código: puede que ya exista con otro nombre.

El cambio que más importa para las reglas de abajo: **`DigitalSignerAdapter`
no es HMAC.** Ya firma PAdES real — certificado X.509 de una CA interna,
PKCS#7 CAdES-detached, verificable en Adobe Acrobat
(`backend/bff/src/signing/digital.adapter.ts`), con custodio de llave
conmutable a HSM por `KEY_CUSTODIAN=pkcs11`. La regla 4 y la "regla de oro"
de `00-FASES.md` que hablan de HMAC ya no describen el código: no hay HMAC
que gatear con `DEV_ONLY`. Lo que sigue pendiente para lo que el plan llama
"P2" es más angosto de lo que dice el paquete: mover el custodio de software
a HSM/KMS real y cerrar TSA/NOM-151 — no construir PAdES desde cero.

## Misión

Homologar el repo al cimiento P1. No construir P2 (KMS/PAdES) hasta que P1 cierre.

Leer antes de codear:

- `00-FASES.md`
- `SPEC.md`
- `PLAN-SPRINTS.md`
- `DATA-MODEL.md`

## Repo layout (no inventar otro)

- App: `frontend/web` (Next.js, puerto 3001)
- API: `backend/bff` (NestJS, puerto 3000)
- Schema: `backend/bff/prisma/schema.prisma`
- Infra: `backend/docker-compose.yml`
- Firmas: `backend/bff/src/signing/`
- Evidencia: `backend/bff/src/evidence/`
- Onboarding: `backend/bff/src/onboarding/`

## Reglas duras

1. No llamés `pdf-lib` `save()` sobre el objectKey canónico.  
2. No escribas INE/selfie en columnas Prisma Text.  
3. No expongas `contentBase64` en endpoints nuevos.  
4. No etiquetes un sello sin PKI real (ninguno queda en P1) como “firma digital” en UI.  
5. Toda query de negocio filtra `tenantId`.  
6. Eventos de auditoría: insert only + `prevHash`.  
7. `@Public()` solo: health, `/sign/:token/*`, webhook IdV.  
8. No agregues NOM-151, blockchain ni FIEL en P1.  
9. No borres Temporal; no diseñes procesos BPMN nuevos.  
10. Si un cambio rompe el freeze, el cambio se rechaza.

## Cómo implementar (orden)

Respeta `PLAN-SPRINTS.md`. Un sprint = un PR temático. No mezcles passkeys con KMS.

## Patrones de código

### Adapters

Nuevos proveedores detrás de interfaz.  
`HttpIdvProvider` / `SandboxIdvProvider` en `backend/bff/src/idv/`.  
`biometric.adapter.ts` deja de ser el IdV: o delega al puerto o se queda como método de ceremonia que *consume* un `IdvResult` ya persistido.

### Tokens

```
plain = randomBytes(32).toString('base64url')
stored = sha256(plain)
```

Se envía `plain` una vez (mail/UI). Se busca por hash.

### Hash de archivo

```
sha256 = createHash('sha256').update(bytes).digest('hex')
```

Nunca hashear el string base64 si podés hashear bytes.

### Passkeys

Challenge de ceremonia = SHA-256 de `frozenHash || envelopeId || nonce`.  
Verificar con SimpleWebAuthn. Guardar `counter`.

## Tests mínimos por PR

- Freeze: segundo write a bytes → 409.  
- Hash mismatch en complete → 409, sin Signer.status=FIRMADO.  
- Token reuse → 410.  
- Tenant A no lee Document de B.  
- Pack contiene `document.sha256` igual al freeze.  
- Sandbox IdV no guarda base64 de INE en SQL.

Los specs existentes en `signature-requests.service.spec.ts` se actualizan; no se ignoran.

## Estilo

TypeScript strict. Bun. Prisma migrate con nombre explícito (`p1_freeze_tokens`, etc.).  
UI: seguir brand Prestige (no rediseñar).  
Textos de firma: “Acepto” / “Autógrafa” / “Passkey”. Nunca “e.firma SAT” ni “FIEL”.

## Definition of Done P1

Checklist en `PLAN-SPRINTS.md` sección DoD. Si falta un ítem, no se abre sprint KMS.
