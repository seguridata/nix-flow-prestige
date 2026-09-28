# PROGRESO — Homologación P1 (MasterPlan)

> Documento vivo. Se actualiza al cerrar cada sprint, no es una foto fija.
> Última actualización: 2026-09-26, commit `27719e1` en `develop`.
> **DoD P1 completo: 11/11.** Ver "Qué sigue" al final para lo que queda fuera de P1.

## Cómo leer esto

- **Hecho** = código en `develop`, `tsc --noEmit` limpio, tests verdes, verificado en esta sesión.
- **Parcial** = existe algo relacionado pero no cumple el DoD del sprint tal cual está escrito en `PLAN-SPRINTS.md`.
- **No verificado** = no se revisó todavía en esta ronda de trabajo (no significa "falta"; significa "pendiente de auditar").
- **Falta** = confirmado que no existe.

## Punto de partida (hallazgo importante)

`MasterPlan/REPORTE.md` audita el repo en el commit `d80a296` y lo describe como P0 puro (sesión `maria`, `DIGITAL`=HMAC, sin tenants). Eso ya no es cierto: entre `d80a296` y el inicio de este trabajo (`86b5561`) hay **55 commits** de una fase previa ("Fase A/B") que ya entregó OIDC real, firma `DIGITAL` PAdES/CAdES con CA propia, sello RFC 3161, aislamiento por tenant, cadena de auditoría, de-base64 de documentos y onboarding a storage cifrado, motor DMN real, correo real con outbox/DLQ, y OpenAPI + webhooks firmados. Ver `Documentacion/07-estado-y-ruta.html` para el detalle con nombre de commit.

Consecuencia: varios ítems que `PLAN-SPRINTS.md` pide como "nuevo" ya estaban hechos. Este documento no re-ejecuta lo que ya funciona; verifica el DoD real de cada sprint contra el código y solo construye lo que falta.

---

## Sprint 0 — Congelar reglas

**Parcial.** El paquete vive en `MasterPlan/` (no en `docs/p1/` como sugiere el propio paquete, porque `docs/` está en `.gitignore` salvo `datos-sensibles.md`). No hay tracker de tickets externo. `ALLOW_DEV_HMAC` no aplica ya (`DIGITAL` no es HMAC, ver Sprint 6).

## Sprint 1 — Auth + tenants + upload + sha256 + freeze

**Hecho.** Commits `5659271`, `f4d9191`.

- `DocumentsService.freeze()`: rehashea contra storage antes de congelar → `409 HASH_MISMATCH` si no coincide.
- `replaceContent()` sobre un documento `locked` → `409 DOCUMENT_FROZEN`.
- `TenantContextGuard`: resuelve tenant por `X-Tenant-Id` contra `TenantMembership`.
- Tests añadidos (no existían): `documents.service.spec.ts` — freeze idempotente, hash-mismatch, aislamiento cross-tenant (404).
- Consentimiento LFPDPPP para INE/biometría (ya venía del árbol de trabajo, se integró en el mismo commit).

**Pendiente de este sprint:** ninguno conocido.

## Sprint 2 — Envelope + magic link + pantalla + acepto + log

**Hecho.** Commits `9edeb86`, `0567a5a`.

- Magic link de un uso: ya existía como `OneTimeLinkService` (Fase A/B) — token de 32 bytes, solo se guarda el SHA-256, TTL, `consume()` atómico. Test ya cubría reuse/expirado → 410.
- Consentimiento versionado + cadena `ProcessAuditEvent.prevHash`: ya existían.
- **Lo que faltaba de verdad:** el método de firma `ACCEPT` ("Acepto", sin trazo ni certificado). Se agregó `AcceptSignerAdapter`, enum Prisma, DTO, y — hallazgo del propio trabajo — el portal externo `/firmar/[token]` no lo ofrecía aunque el backend ya lo soportaba (`0567a5a`).

**Pendiente de este sprint:** ninguno conocido.

## Sprint 3 — Passkeys

**Hecho.** Commit `c229038`.

- Módulo `backend/bff/src/webauthn/` con `@simplewebauthn/server` v14.
- Registro de passkeys para usuarios internos (Keycloak).
- Ceremonia: challenge = `sha256(frozenHash|signatureRequestId|nonce)`, contador anti-replay, evento `PASSKEY_ASSERTED`.
- Adaptador `PASSKEY` + gate `requirePasskey` en `sign()`.
- Frontend: botón "Verificar con passkey" en `/firmar/[token]`.
- 13 tests nuevos, 101/101 backend, 29/29 frontend, `tsc` limpio.

**Pendiente de este sprint:** ninguno conocido.

## Sprint 4 — Adapter IdV

**Hecho, reinterpretado.** Commit `5154f11`.

Auditoría confirmó (cero coincidencias en todo el repo): `backend/bff/src/idv/`, `IdvSession`, `IdvProvider`, `EnvelopeTemplate` **no existen**. Lo que sí existe, real y funcional, bajo otros nombres:

- `HeuristicIdentityVerifier` + `RenapoIdentityVerifier` (`src/identity/`) — CURP/OCR/vigencia INE; RENAPO sin `RENAPO_URL` → 503, nunca aprueba en falso.
- `BiometricEngine` con tres implementaciones: `NoopBiometricEngine`, `RemoteBiometricEngine` (HTTP a proveedor), `LocalFaceBiometricEngine` (face-api + liveness heurístico local, sin vendor).
- `OnboardingCase.ineFront/ineBack/selfie` ya son `Json` (claves de storage cifrado) — el "quitar base64" del SPEC ya estaba resuelto de Fase A/B.

**Decisión de diseño (confirmada con el usuario):** no construir el puerto `IdvProvider.start()/getResult()` + webhook HMAC que pide `SPEC.md` §9 — ese contrato asume un vendor de redirect tipo Onfido/Metamap que hoy no existe (`PLAN-SPRINTS.md` mismo lo marca como riesgo: "vendor IdV caro, sandbox hasta tener contrato"). En su lugar:

- `KycPolicy` (`NONE|ONCE|EVERY_SIGN`) + `SignatureRequest.kycPolicy`.
- Gate en `sign()`: `ONCE` exige un `OnboardingCase` `HABILITADO` del firmante (por email) dentro de 90 días; `EVERY_SIGN` exige que ese alta sea posterior a la creación del envelope.
- UI: toggle `requirePasskey` + selector de `kycPolicy` en el wizard de envío (`app/new/page.tsx`) — antes no eran seteables desde ningún lado.

**Hallazgo colateral (bug del propio Sprint 3, corregido aquí):** `PASSKEY` faltaba en `METHODS`/`allowedMethods` del DTO y la política de firma — el endpoint público habría rechazado `method: PASSKEY` con 400 antes de llegar al servicio. Los tests de Sprint 3 no lo detectaron porque llaman al servicio directo, sin pasar por la validación del DTO.

**Fuera de alcance, explícito:** un vendor IdV de redirect real (`HttpIdvProvider`) y su webhook siguen sin construirse — no hay contrato con un proveedor todavía. Cuando lo haya, se agrega detrás de una interfaz nueva sin tocar el gate `kycPolicy` ya construido.

## Sprint 5 — Plantillas + evidence zip

**Hecho.** Commit `b23834d`.

- Evidence zip: ya existía (Fase B) un dossier ZIP más completo que el `pack/` mínimo del SPEC — manifiesto firmado Ed25519, PDF congelado + copia firmada, sello RFC 3161, certificados de la CA, verificador offline embebido. Faltaban `events.jsonl` (bitácora `ProcessAuditEvent` con `prevHash`/`hash`) y `pack.sha256` (sha256 de cada archivo, verificable con `sha256sum -c`) — agregados.
- `consents.json`/`idv.json`/`signatures.json` del SPEC **no se separaron como archivos propios**: esos datos ya viven consolidados dentro de `manifiesto.json` (`consentRecords`, `signatures`, `chainOfCustody`). Decisión: no fragmentar una fuente de verdad ya coherente solo para calzar nombres de archivo del SPEC.
- `EnvelopeTemplate` (Prisma): `order`/`kycPolicy`/`allowedMethods`/`requirePasskey`/`slaHours` reutilizables por tenant. `POST /signature-requests` acepta `templateId` (defaults + override explícito). `GET/POST /signature-requests/templates`.

**Pendiente de este sprint:** UI para gestionar plantillas (crear/editar/elegir al enviar) — hoy solo backend + tests; el wizard de envío sigue mandando campos explícitos.

## Sprint 6 — Ajuste duro + puerta a P2

**Hecho, reinterpretado.** Commit `27719e1`.

- El supuesto original de este sprint (`DigitalSignerAdapter` sigue siendo HMAC, hay que ocultarlo tras `ALLOW_DEV_HMAC`) ya no aplicaba: `DIGITAL` es PAdES/CAdES real con CA propia desde Fase B, no HMAC.
- `/public/links/*` gana un `@Throttle` propio de 20/min (antes solo el límite global de 120/min aplicaba a esta superficie no autenticada).
- `contentBase64`: confirmado con grep sobre todo el repo — cero coincidencias. No es que se dejó de escribir; ya no existe el campo en ningún lado.
- `MasterPlan/P2-KMS.md`: una página con la ruta a HSM/KMS real (qué cambia, qué no cambia, orden de trabajo).

---

## DoD P1 (checklist maestro)

Ver `PLAN-SPRINTS.md` sección "DoD P1" para el checklist con evidencia de commit por ítem. **11 de 11 confirmados.** Commits del ciclo completo: `5659271` → `f4d9191` → `9edeb86` → `0567a5a` → `c229038` → `5154f11` → `b23834d` → `27719e1`.

## Lo que quedó explícitamente fuera de P1 (no es deuda oculta, es alcance)

- **Vendor IdV de redirect real** (`HttpIdvProvider` estilo Onfido/Metamap + webhook HMAC): sin contrato, sin URL, no se construyó. El gate `kycPolicy` ya está listo para consumir un resultado de identidad más fuerte el día que exista ese vendor.
- **HSM/KMS real**: ver `MasterPlan/P2-KMS.md`. `DigitalSignerAdapter` sigue en CA de software (Fase B), no HMAC pero tampoco HSM.
- **NOM-151 real**: el manifiesto tiene los campos (`timestampProvider`, `timestampTokenHash`) pero no hay constancia de un PSC acreditado.
- **UI de gestión de `EnvelopeTemplate`**: el backend y los tests existen; no hay pantalla para crear/editar/elegir plantilla al enviar.
- **RLS de Postgres, aislamiento físico por tenant**: `Documentacion/07-estado-y-ruta.html` "Fase 2" en adelante — es la siguiente fase del roadmap más amplio, no de este MasterPlan.

## Qué sigue (sugerido, fuera de este paquete)

1. Decidir vendor IdV real cuando haya presupuesto/contrato; conectar detrás de una interfaz nueva sin tocar el gate `kycPolicy`.
2. HSM/KMS por el puerto `Pkcs11KeyCustodian` ya existente (ver `P2-KMS.md`).
3. UI de `EnvelopeTemplate` si el flujo de "plantillas reutilizables" resulta valioso en uso real.
4. Retomar `Documentacion/07-estado-y-ruta.html` Fase 2 en adelante (RLS, llave/bucket por tenant, Keycloak producción) — trabajo de plataforma, no de este MasterPlan.
