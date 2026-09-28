# PLAN Y SPRINTS — de P0 a P1

Duración sugerida: 6 sprints de 5 días (un dev full stack fuerte) o 3 sprints con dos devs.  
No solapar KMS aquí.

## Sprint 0 — Congelar reglas (1 día)

- Copiar este paquete a `docs/p1/` del repo.
- Issue tracker: un ticket por sprint.
- Flag `ALLOW_DEV_HMAC=true` solo en `.env` local.
- Decidir: Document = una fila por versión (sí, P1).

Entrega: este paquete mergeado en `docs/`.

## Sprint 1 — Auth + tenants + upload + sha256 + freeze

**Código**

- Front: login OIDC contra Keycloak (`prestige`). Quitar hardcode `maria` del happy path (puede quedar botón “demo” detrás de `NEXT_PUBLIC_DEMO_SESSION`).
- `X-Tenant-Id` + `Membership`.
- `DocumentsService.create`: solo bytes → MinIO → `sha256` hex → row. No guardar `contentBase64`.
- `POST /documents/:id/freeze`.
- Guard: si `locked`, reject writes.
- `tenantId` en Document.

**Tests**

- upload hash estable.
- freeze lock.
- cross-tenant 404.

**DoD sprint:** puedo subir un PDF, ver el hex, freeze, y no puedo volver a subir encima.

## Sprint 2 — Envelope + magic link + pantalla + acepto + log

**Código**

- Alias API `/v1/envelopes` sobre `SignatureRequestsService` (no hace falta rename Prisma).
- `EnvelopeToken` + mail/log del link (en dev: devolver el token en JSON).
- `GET/POST /sign/:token` públicos.
- Consent ya existe: engancharlo al token.
- `complete` método `ACCEPT` (sin PNG).
- Autógrafa: persistir stroke/PNG en storage `evidence/…`, no `PdfStampService` al canónico. Dejar stamp solo en endpoint `/preview-stamp` no persistente.
- Cadena `prevHash` en `ProcessAuditEvent`.

**DoD:** un invitado abre link, acepta, envelope seq avanza, audit encadenado, PDF original mismo hash.

## Sprint 3 — Passkeys

**Código**

- Dependencias SimpleWebAuthn.
- Registro internos.
- Ceremony begin/finish con challenge atado al hash.
- Evento `PASSKEY_ASSERTED`.
- `requirePasskey` en request/template.

**DoD:** firmante con passkey completa ACCEPT; assertion verificada; counter incrementa; replay falla.

## Sprint 4 — Adapter IdV

**Código**

- Módulo `idv/` puerto + sandbox + http.
- Webhook HMAC.
- `IdvSession` table.
- Onboarding deja de guardar fotos en SQL; usa MinIO + session.
- Ceremony: si `kycPolicy=every_sign` bloquea complete hasta `liveness && faceMatch` (sandbox en dev).

**DoD:** flujo onboarding INE→vida→face en sandbox; ceremony respeta policy; cero base64 INE en Postgres.

## Sprint 5 — Plantillas + evidence zip

**Código**

- `EnvelopeTemplate` + `kycPolicy` + order.
- Al cerrar envelope: arma zip en MinIO, `packageHash`, endpoint download.
- Cockpit `/operations` muestra pack hash.

**DoD:** zip con pdf + sha256 + events.jsonl + idv.json + manifest; hash del pdf = freeze.

## Sprint 6 — Ajuste duro + puerta a P2

**Código**

- `DigitalSignerAdapter` exige `ALLOW_DEV_HMAC` y se oculta en UI prod.
- Rate limit sign.
- Limpieza: deprecar endpoints que devuelven `contentBase64`.
- Doc `P2-KMS.md` (una página): ECDSA P-256, clave en KMS, CMS detached, verificar pack.

**DoD P1 (cierra la fase):**

- [x] OIDC funciona — Fase A (`jwt-auth.guard.ts` real, sesión `maria` fuera del happy path)
- [x] tenant isolation testeada — `documents.service.spec.ts`, `auth-guards.spec.ts` (commit `4456c71` de Fase A/B)
- [x] freeze real — Sprint 1 (`f4d9191`): hash-mismatch y segundo-write → 409, testeado
- [x] magic link un uso — `OneTimeLinkService` (reuse/expirado → 410, testeado)
- [x] acepto + log encadenado — Sprint 2 (`9edeb86`, `0567a5a`): método `ACCEPT` + `ProcessAuditEvent` con `prevHash`
- [x] passkeys en ceremonia — Sprint 3: registro interno, ceremony begin/finish atado a `sha256(frozenHash|signatureRequestId|nonce)`, contador anti-replay, gate `requirePasskey`
- [x] IdV puerto + sandbox — reinterpretado (`5154f11`): `HeuristicIdentityVerifier`/`BiometricEngine` ya son el puerto+sandbox real; se agregó `kycPolicy` como gate de ceremonia. Vendor de redirect real sigue fuera de alcance (sin contrato)
- [x] templates kyc + orden — `EnvelopeTemplate` (`b23834d`): order/kycPolicy/allowedMethods/requirePasskey/slaHours, con `templateId` opcional en `POST /signature-requests`
- [x] evidence zip — ya existía (Fase B) más completo que el mínimo del SPEC; se agregó `events.jsonl` y `pack.sha256` (`b23834d`)
- [x] PDF canónico intacto — freeze verifica hash antes de aceptar; ninguna firma reescribe `objectKey`
- [x] HMAC no se vende como firma digital — `DIGITAL` ya es PAdES/CAdES real con CA interna (Fase B), no HMAC; copy de UI corregido (`0567a5a`)

## Después (P2, otro plan)

KMS/HSM → PAdES/CMS sobre `frozenHash` → vendor IdV de pago → puerto RFC 3161.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Preview legal “necesita ver la firma en el PDF” | Preview stamp efímero; pack lleva PNG aparte |
| Temporal desincronizado | Postgres gana; signal best-effort |
| Keycloak local lento | ya documentado en README; no bloquear tokens públicos |
| Vendor IdV caro | sandbox hasta tener contrato |
