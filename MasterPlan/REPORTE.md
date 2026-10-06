# Reporte de homologación — Prestige (NIX Flow) → plan de cimiento

> **Auditoría histórica.** Foto del commit `d80a296` (2026-09-26). El repo ya no está en ese punto: P1 cerró y `fix/p1-hardening` endureció tenant, firma y operación. Para el estado actual leer `PROGRESO.md`. Este archivo se conserva como el diagnóstico que originó el paquete; no se reescribe para que parezca el presente.

Fecha: 2026-09-26  
Repo auditado: `https://github.com/seguridata/nix-flow-prestige` @ `d80a296`  
Destinatario: equipo full stack que iba a construir P1.

---

## 1. Para qué es este paquete

Alinear el código existente con el plan:

Auth + tenants + upload + sha256 + freeze → envelope + magic link + acepto + log → passkeys → IdV → plantillas → evidence zip → (después) firma digital KMS.

Decisión de fase:

- **Hoy: P0** prototipo de producto con UI y BPM.
- **Destino de este trabajo: P1** cimiento de integridad.
- **No en este trabajo: P2** KMS/PAdES/NOM-151.

Decisión de repo: **no se empieza de 0.** Se homologa.

---

## 2. Qué hay hoy (auditoría)

### Stack real

Next 16 + Nest 10 BFF + Prisma/Postgres + MinIO + Temporal + Keycloak + Redis + signature_pad + pdf-lib. Bun workspaces + Turbo. Coincide con un producto, no con un spike.

### Dominio que ya está bien

- `Case` con `tenantId`.
- `Document` con `hash`, `locked`, `version`, `objectKey`.
- `SignatureRequest` + `Signer` + orden seq/par + SLA.
- Campos sobre PDF.
- `EvidenceManifest` (original/presented/signed/package hash).
- Consentimiento versionado.
- `ProcessAuditEvent`.
- Onboarding con máquina de estados INE / prueba de vida.
- Adapters `DIGITAL | AUTOGRAFA | BIOMETRICA`.
- Temporal worker + fallback.
- Cockpit `/operations`.

### Deuda que impide llamar a esto “cimiento”

1. `contentBase64` duplica el PDF en SQL.  
2. `PdfStampService` reescribe bytes → el hash de freeze no sobrevive la ceremonia.  
3. `DigitalSignerAdapter` es HMAC(`prestige-dev-only`).  
4. INE y selfie en Text.  
5. Front con sesión `maria`; OIDC no cerrado.  
6. No hay token de un uso.  
7. No hay passkeys.  
8. Biometría es un fetch opcional, no un puerto IdV con OCR/CURP/liveness/face.  
9. `tenantId` no está en Document/Request.  
10. Audit events sin cadena `prevHash`.  
11. Timestamp del manifiesto sin TSA.

Detalle de archivos:

| Archivo | Problema P1 |
|---|---|
| `documents.service.ts` | escribe base64 + hash; no freeze endpoint |
| `pdf-stamp.service.ts` | muta PDF |
| `digital.adapter.ts` | HMAC |
| `biometric.adapter.ts` | HTTP genérico, no contrato IdV |
| `onboarding` schema | blobs PII |
| `jwt-auth.guard.ts` | listo; el cliente no lo usa de verdad |
| `evidence.service.ts` | manifiesto útil; pack zip no es artefacto de storage |

---

## 3. Arquitectura destino P1

Cinco piezas (las del plan), mapeadas al repo:

```
frontend/web          puerta (OIDC + /sign/[token] + WebAuthn)
backend/bff
  auth + membership   tenant
  documents+storage   upload / sha256 / freeze / MinIO
  signature-requests  envelope + tokens
  signing             ritual (ACCEPT / AUTOGRAFA / PASSKEY)
  idv/                puerto nuevo
  evidence            pack zip + chain
  temporal            orquestación (igual)
```

Cajas fuertes:

- MinIO: PDFs canónicos + packs + fotos IdV  
- Postgres: metadata, tokens hasheados, eventos  
- Keycloak: identidad interna  

Flujo canónico:

```
OIDC interno | magic link externo
    → (IdV si policy)
    → passkey si required
    → consent
    → rehash S3 == frozenHash
    → evento encadenado
    → close + zip
```

Passkey no sella el PDF. El sello KMS es P2.

---

## 4. Homologar: quitar / modificar / agregar

### Quitar (o dejar de usar)

- Escritura de `Document.contentBase64`.
- Escritura de `OnboardingCase.ineFrontBase64|ineBackBase64|selfieBase64`.
- Stamp persistente al canónico.
- Sesión `maria` como camino principal.
- Copy de UI “firma digital” para HMAC.
- Cualquier alcance NOM-151 / blockchain / FIEL en P1.

### Modificar

- `DocumentsService` → bytes only + freeze.
- `SignatureRequestsService` → tokens + kycPolicy + no mutar PDF.
- `PdfStampService` → preview only.
- `BiometricSignerAdapter` → consume `IdvSession` ya verificada.
- `DigitalSignerAdapter` → `devOnly` + env gate.
- `ProcessAuditEvent` → chain.
- `EvidenceService` → zip en MinIO.
- Onboarding → flags + object keys.
- JWT guard → tenant header.

### Agregar

- `Membership`, `EnvelopeToken`, `PasskeyCredential`, `EnvelopeTemplate`, `IdvSession`.
- Módulo `idv/` (sandbox + http).
- Rutas `/v1/sign/:token/*`, `/v1/webauthn/*`, `/v1/webhooks/idv`.
- Página ceremonia si no está atada a token opaco.
- Tests de aislamiento y hash mismatch.

---

## 5. Sprints

Ver `PLAN-SPRINTS.md`. Resumen:

0. Docs al repo  
1. Auth/tenant/upload/freeze  
2. Envelope/link/acepto/log  
3. Passkeys  
4. IdV  
5. Plantillas + zip  
6. Cierre P1 + puerta P2  

KMS no se cuela en 1–5.

---

## 6. Objetivos medibles P1

1. Un PDF freeze tiene el mismo `sha256` después de 3 firmantes.  
2. Tenant B obtiene 404 en ids de A.  
3. Token usado devuelve 410.  
4. Pack zip verifica `sha256sum -c document.sha256`.  
5. Onboarding sandbox no inserta strings base64 de imagen.  
6. En producción, endpoint DIGITAL HMAC responde 403.

---

## 7. Cómo trabajar día a día

1. Leer `AGENTS.md`.  
2. Tomar el sprint abierto.  
3. Prisma migrate con el nombre del sprint.  
4. Tests del DoD del sprint.  
5. PR chico.  
6. No mezclar preview visual con canónico.

Comando de dev sigue siendo `bun run dev` del README del repo.

---

## 8. Relación con PSC / NOM-151 / SeguriData

El producto nace en SeguriData y el README menciona constancia NOM-151 como pendiente. Correcto. En P1 el manifiesto ya tiene huecos `timestampProvider` / `timestampTokenHash`. Se llenan en P2/P3 con un `TimestampPort`. No se construye la Autoridad de Constancias en estos sprints.

La “firma digital” de negocio es certificado/clave SeguriData (PSC), no FIEL SAT. SAT queda como conector futuro opcional, no default.

---

## 9. Conclusión

Prestige ya es el chasis. P0 se siente producto; P1 lo vuelve defendible. El riesgo no es técnico de stack (el stack está bien). El riesgo es seguir incrustando PNG y llamando HMAC “digital”. Este paquete corta eso y pone el orden de build que pediste.
