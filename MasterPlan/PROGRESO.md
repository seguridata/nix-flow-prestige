# PROGRESO — Homologación P1 y lo que vino después

> Documento vivo. La foto de los sprints P1 (abajo) no se reescribe: es el cierre del 2026-09-26.
> **Última revisión: 2026-10-05**, contra `fix/p1-hardening`.
> El seguimiento del hardening está en `663d5f5`. La UI de plantillas está en `4981fd2`.
> El paquete versionado de P1 es `3c98372`. `develop` lo tenía como HEAD y toma esta rama por fast-forward.
> **DoD P1: 11/11**, cerrado en `27719e1`. Esta revisión no re-ejecutó la suite; el estado sale de los commits, del código y del sandbox local.

## Cómo leer esto

- **Hecho** = está en `fix/p1-hardening` (o ya estaba en el cierre P1).
- **Cerrado en** = el commit citado.
- **Parcial** = existe y no cumple el texto original del sprint.
- **Fuera** = se decidió no construirlo, o sigue sin existir.

## Dónde está el repo hoy

P1 cerró. El endurecimiento de esa base también: aislamiento por tenant en las tablas que se habían quedado fuera, ceremonia que no invalida un PAdES, y operación de más de una instancia. El seguimiento está en `663d5f5`. Lo que queda abierto es P2 (`P2-KMS.md`), no otro sprint de P1.

`REPORTE.md` audita el commit `d80a296` y lo describe como P0 (sesión `maria`, `DIGITAL` = HMAC, sin tenants). Eso es historia. Entre `d80a296` y `86b5561` la Fase A/B ya había entregado OIDC, PAdES/CAdES con CA propia, sello RFC 3161, tenant en documento y solicitud, auditoría encadenada, documentos y onboarding fuera de Postgres, DMN, correo con outbox y OpenAPI con webhooks firmados. El detalle con commits está en `Documentacion/07-estado-y-ruta.html`.

---

## Sprint 0 — Congelar reglas

**Parcial, y así se queda.** El paquete vive en `MasterPlan/` (no en `docs/p1/`: `docs/` está en `.gitignore` salvo `datos-sensibles.md`). No hay tracker externo. `ALLOW_DEV_HMAC` no aplica: `DIGITAL` es PAdES, no HMAC.

## Sprint 1 — Auth + tenants + upload + sha256 + freeze

**Hecho.** Commits `5659271`, `f4d9191`.

- `DocumentsService.freeze()` rehashea contra storage antes de congelar → `409 HASH_MISMATCH`.
- `replaceContent()` sobre un documento `locked` → `409 DOCUMENT_FROZEN`.
- `TenantContextGuard` resuelve el tenant por `X-Tenant-Id` contra `TenantMembership` y deja `user.tenantId` en el **slug**.
- Tests: `documents.service.spec.ts` (freeze idempotente, hash-mismatch, aislamiento).
- Consentimiento LFPDPPP para INE y biometría.

El hardening del 2026-10-05 hizo el freeze obligatorio al crear la solicitud y el rehash en cada `sign()`. Ver más abajo.

## Sprint 2 — Envelope + magic link + pantalla + acepto + log

**Hecho.** Commits `9edeb86`, `0567a5a`.

- `OneTimeLinkService`: token de 32 bytes, solo se guarda el SHA-256, TTL, `consume()` atómico. Reuso o expirado → 410.
- Consentimiento versionado y cadena `ProcessAuditEvent.prevHash` ya existían.
- Método `ACCEPT` (`AcceptSignerAdapter`) y el portal `/firmar/[token]` lo ofrece desde `0567a5a`.

El hardening añadió `POST /public/links/:token/reject` (enlace de un uso) y el botón Rechazar.

## Sprint 3 — Passkeys

**Hecho.** Commit `c229038`, endurecido en `4726f71`.

- Módulo `backend/bff/src/webauthn/` con `@simplewebauthn/server` v14.
- Registro para usuarios internos (Keycloak) y ceremonia atada a `sha256(frozenHash|signatureRequestId|nonce)`.
- Contador anti-replay, evento `PASSKEY_ASSERTED`, adaptador `PASSKEY`, gate `requirePasskey`.
- Portal externo: “Verificar con passkey”.
- Hardening: la passkey queda atada al firmante, `userVerification` required, y los firmantes internos usan `POST /webauthn/authenticate/{begin,finish}`.

**Cerrado en `663d5f5`:** `begin` rechaza una solicitud que ya no está `PENDIENTE` o `EN_FIRMA` con `409 REQUEST_NOT_OPEN`. Hay spec de controlador y un e2e con autenticador de prueba (`passkey.e2e.spec.ts`).

## Sprint 4 — Adapter IdV

**Hecho, reinterpretado.** Commit `5154f11`.

No existe `backend/bff/src/idv/`, ni `IdvSession`, ni `IdvProvider`, ni webhook HMAC de un vendor de redirect. Lo que sí existe:

- `HeuristicIdentityVerifier` y `RenapoIdentityVerifier` (`src/identity/`). Sin `RENAPO_URL` el verificador responde 503 y no aprueba en falso.
- `BiometricEngine`: `NoopBiometricEngine`, `RemoteBiometricEngine`, `LocalFaceBiometricEngine`.
- INE y selfie de `OnboardingCase` son `Json` con clave de storage cifrado, más consentimiento biométrico.

Decisión: no construir el puerto `IdvProvider.start()/getResult()` del `SPEC.md` §9. En su lugar, `KycPolicy` (`NONE|ONCE|EVERY_SIGN`) y `SignatureRequest.kycPolicy`. `ONCE` exige un `OnboardingCase` `HABILITADO` del firmante (por email) de los últimos 90 días. `EVERY_SIGN` exige que ese alta sea posterior a la creación del sobre. El wizard de envío (`app/new/page.tsx`) ya setea `requirePasskey` y `kycPolicy`.

El mismo commit corrigió que `PASSKEY` faltaba en `METHODS` del DTO.

**Fuera, y así se queda.** No hay contrato de vendor. No se construye `src/idv/`, `IdvSession`, `IdvProvider` ni `HttpIdvProvider`, y no hay webhook de redirect. El gate `kycPolicy` no se toca.

## Sprint 5 — Plantillas + evidence zip

**Hecho en backend.** Commit `b23834d`.

- El dossier ZIP (Fase B) incluye manifiesto firmado Ed25519, PDF congelado, copia firmada, sello RFC 3161, certificados de la CA y verificador offline. Este sprint añadió `events.jsonl` y `pack.sha256`.
- `consents.json`, `idv.json` y `signatures.json` no son archivos aparte: viven dentro de `manifiesto.json`.
- `EnvelopeTemplate`: `order`, `kycPolicy`, `allowedMethods`, `requirePasskey`, `slaHours`. `POST /signature-requests` acepta `templateId` y aplica defaults. `GET/POST /signature-requests/templates`.

El `templateId` **no se guarda** en `SignatureRequest`: se resuelve al crear y se descarta.

**Cerrado en `4981fd2`.** El wizard de envío elige una plantilla y manda además los campos visibles: lo que se ve en pantalla gana. `/plantillas` lista y crea. El nombre es único por tenant; un duplicado muestra el 409 del BFF (`Ya existe un registro con esos datos únicos`). No hay edición ni borrado: cambiar una plantilla es crear otra con otro nombre.

## Sprint 6 — Ajuste duro + puerta a P2

**Hecho, reinterpretado.** Commit `27719e1`.

- `DIGITAL` ya era PAdES/CAdES. No hubo flag `ALLOW_DEV_HMAC`.
- `/public/links/*` tiene `@Throttle` de 20/min, encima del límite global de 120/min.
- `contentBase64`: cero coincidencias en el repo.
- `MasterPlan/P2-KMS.md` describe el paso a HSM.

---

## DoD P1

**11 de 11.** Checklist con evidencia en `PLAN-SPRINTS.md`. Commits del ciclo: `5659271` → `f4d9191` → `9edeb86` → `0567a5a` → `c229038` → `5154f11` → `b23834d` → `27719e1`. El paquete se versionó después, en `3c98372`.

---

## Hardening — en `fix/p1-hardening` (`4726f71` … `fe45256`, seguimiento `663d5f5`)

Auditoría del 2026-10-05. Siete commits encima del paquete, más el seguimiento `663d5f5`. Resumen de lo que el código hace ahora.

### Aislamiento

Migración `20261005100000_p1_tenant_scoping`: `tenantId` nullable en `ProcessAuditEvent`, `NotificationOutbox`, `HumanTask`, `DocumentComment`, `UserNotification`, `ProcessWatcher`, `WorkflowRun` y `SignatureField`, con backfill desde el padre cuando hay padre.

Filtran por tenant: `/operations`, auditoría, signature-fields, cancelar/delegar/consentir/rechazar, workflow y tareas, colaboración, outbox, control-plane (`platform_admin`) y el WebSocket.

`TenantContextGuard` falla cerrado. Token sin claim `tenant` → 401. Con membresía, el guard acepta slug, id del `Tenant` o el uuid de la membresía, y **normaliza `user.tenantId` al slug**. `TenantMembership.tenantId` es la FK (uuid); el resto de tablas calientes guardan el slug (`seguridata` en el demo). Un directorio vacío ya no abre el sandbox, salvo `ALLOW_UNMAPPED_TENANT=true` fuera de producción.

`NotificationOutbox` y `UserNotification` pueden seguir en `NULL` si no hay una pista única: la migración no tenía padre directo. El script que los rellena es `bun run backfill:tenant-ids` (`663d5f5`). En el sandbox local ya corrió; el resultado está más abajo.

La auditoría ya no mete CURP ni clave de elector en el payload. `verify` acotado ya no devuelve `headSeq`/`headHash` de la cadena global (`baea9aa`). Trigger de inmutabilidad en `ProcessAuditEvent` (`20261005110000_p1_audit_immutability`).

Guía de un entorno que ya tiene datos: `backend/infra/README-despliegue-tenants.md` (`663d5f5`). Cubre el realm (el import de Keycloak no pisa un volumen existente), el rol `platform_admin`, el claim `tenant` y `bootstrap:tenant`.

### Firma e integridad

- Freeze obligatorio al crear la solicitud. `sign()` rehashea el canónico, toma `FOR UPDATE` sobre `Document`, calcula `allSigned` dentro de la transacción, valida `expiresAt` y no devuelve el PDF.
- PAdES en serie por actualización incremental. Si no se puede garantizar, 409.
- Autógrafa o estampado visual sobre un PDF que ya tiene PAdES: `409 VISUAL_STAMP_AFTER_SIGNATURE_UNSUPPORTED` (`a0ef110`). El error de estampado ya no se traga. Detector: `signing/pdf-signatures.ts`.
- Evidencia: `checks.documentHash` compara solo el canónico. `checks.presentedHash` es el check de la copia de ceremonia (`baea9aa`). Un PDF `DIGITAL`/`AUTOGRAFA` con `valid: true` ya no sale con `documentHash: false`.
- Biometría: sesión obligatoria, `encodeURIComponent`, timeout y validación de la respuesta.
- Nombres de archivo con acentos: multer ya no los guarda como latin1 mal decodificado (`baea9aa`).

### Portal externo, webhooks, multi-instancia

- `POST /public/links/:token/reject` y botón Rechazar con confirmación. `recordConsent` es idempotente ante doble clic (`a0ef110`).
- Webhooks: dos secretos durante la rotación (`previousSecret` / `previousSecretUntil`, cabecera `x-prestige-signature-previous`). Migración `20261005120000_webhook_secret_rotation`. Defensa SSRF, secreto enmascarado, solo suscripciones activas.
- Outbox: `FOR UPDATE SKIP LOCKED`. El enlace de firma va cifrado, fuera del body.
- Advisory lock en los dispatchers de correo, webhooks y reconciliador. Seeds idempotentes.
- Throttler en Redis. `WorkerGuard` firma método + path + body. Scripts `start:prod` y worker.
- `WorkflowExecutionAlreadyStartedError` es idempotente: un segundo start ya no degrada el run a `LOCAL` (`baea9aa`).
- `GET /operations/health` hace `HeadBucket` (tope 2 s) y revisa Postgres; el body solo trae booleanos (`792e423`).
- Clientes ioredis con handler `error`. Si Redis no responde, el BFF no muere y el adaptador de Socket.IO no se instala (`baea9aa`).
- `assertRuntimeSecrets` completo en producción.

### Arranque y CI

- `WebhooksService` inyecta `resolveHost` con `@Optional() @Inject(WEBHOOK_HOST_RESOLVER)`. Sin eso Nest no arrancaba (`5aeaac6`).
- `bun run check:di` corre en CI después del build (`2844c76`). Los tests de vitest no emiten `design:paramtypes` y no ven este fallo.
- Dockerfile multi-stage, no-root, entrypoint con `migrate deploy`, servicios `bff` y `worker` en el profile `app`. `Dockerfile.dockerignore` ya no excluye `src/signing/pki`.
- Frontend: ESLint 9 en flat config, 0 errores (`792e423`).
- `minio/mc` fijado a `rancher/mirrored-minio-mc` (el tag anterior no existía). El bucket `prestige-docs` se crea con Object Lock y retención GOVERNANCE 30 días.
- Excepción de gitleaks afinada a dos falsos positivos de `PKI_PASSPHRASE`; la regla sigue activa (`fe45256`).

---

## Seguimiento cerrado en `663d5f5`

### Métodos usables después de un PAdES

`allowed-methods.ts` (BFF y `frontend/web/libs/allowed-methods.ts`).

- `AUTOGRAFA` reescribe el PDF. `DIGITAL` posterior firma en incremental. `BIOMETRICA`, `ACCEPT` y `PASSKEY` no tocan el PDF.
- Si algún firmante ya cerró con `usedMethod = DIGITAL`, `allowedMethodsNow` quita `AUTOGRAFA`.
- `sign()` rechaza antes el método visual: `409 METHOD_NOT_ALLOWED_AFTER_SIGNATURE`.
- Al crear un sobre `SECUENCIAL` que mezcla `DIGITAL` y un método visual, la respuesta trae el aviso `VISUAL_AFTER_DIGITAL_ORDER`. No rechaza el alta.
- El diálogo de firma y los dos portales (`/firmar/[token]` y la firma interna) ocultan el método que ya no aplica.
- `GET /evidence/by-request/:id` responde 404 tanto si la solicitud es de otro tenant como si no hay evidencia. El cliente trata ese 404 como `null`.

### Passkey en solicitud cerrada

`POST /webauthn/authenticate/begin` no emite challenge si la solicitud del tenant ya no está abierta (`409 REQUEST_NOT_OPEN`). Una solicitud ajena o inexistente sigue el 404 de `beginForUser`, sin distinguir.

### Reconciliador Temporal

`WorkflowReconcilerService` corre cada minuto, con advisory lock. Un `WorkflowRun` `ACTIVO` con más de 2 minutos sin tocarse se compara con Temporal. Estados `FAILED`, `TIMED_OUT`, `TERMINATED` o `CANCELLED` marcan el run `FALLIDO`. Si la solicitud sigue `EN_FIRMA`, reintenta **una** vez (`restarted:1` en `lastError`).

### Scripts de tenant

- `bun run bootstrap:tenant` — upsert del `Tenant` y de la primera `TenantMembership`. Sin esto, el guard fail-closed responde 403 en una base que todavía no tiene membresías. `--dry-run` no escribe.
- `bun run backfill:tenant-ids` — rellena `tenantId` NULL en `NotificationOutbox` y `UserNotification`. Lotes de 500, solo filas NULL, idempotente. Lo ambiguo o sin pista se queda NULL. Las membresías aportan `tenant.slug`, nunca el uuid de `TenantMembership.tenantId`.
- `bun run backfill:audit-chain` — el script ya estaba en el repo (M11); el `package.json` ahora lo expone.

### MinIO

`mc retention info` sale 0 aunque no haya retención por defecto, así que no servía de guarda. El init aplica `mc retention set --default GOVERNANCE 30d` siempre. Si el bucket ya existía sin lock, el init falla y hay que recrearlo vacío con `mc mb --with-lock`. GOVERNANCE se puede levantar con bypass; COMPLIANCE no es el modo de este entorno.

---

## Sandbox local con datos (2026-10-05)

Se aplicó `backend/infra/README-despliegue-tenants.md` al compose `prestige-sandbox`. No se vació el volumen. El init de MinIO no se volvió a correr y el bucket `prestige-docs` no se recreó.

- `prisma migrate deploy` ya tenía las migraciones aplicadas, incluidas `20261005100000_p1_tenant_scoping`, `20261005110000_p1_audit_immutability` y `20261005120000_webhook_secret_rotation`.
- Keycloak 26.0.8. El realm `prestige` ya existía, así que el import no lo pisa. Se creó el rol `platform_admin`. El mapper `tenant` del cliente `prestige-web` ya estaba. Se creó el mapper `auth_time` (`3f8ee4ef-f568-4f6c-9aa2-e10653c38bb5`) como en `prestige-realm.json`. Se añadió el atributo de perfil `tenant` y se puso `tenant=seguridata` en maria, carlos y roberto. A roberto se le sumó `platform_admin` sin quitar `signer`, `sender`, `rh` ni `admin`.
- El password grant trae `tenant` y no trae `auth_time`: ese grant no escribe la nota `AUTH_TIME`. El flujo del navegador sí. `STEP_UP_ENFORCE` está apagado. El login del portal como roberto en `localhost:3001` fue aceptado.
- `bootstrap:tenant` solo sobre roberto. El script reemplaza roles, así que se pasó la unión `sender,rh,admin,auditor,platform_admin` para no perder `rh` ni `auditor`. Nombre y correo no cambiaron (`Roberto Díaz`, `roberto@seguridata.mx`). maria y carlos no se reescribieron.
- `backfill:tenant-ids`. `NotificationOutbox`: 80 NULL pasaron a 0 (59 por `dedupeKey`, 21 por `toAddress`; 0 ambiguos). `UserNotification`: 160 NULL pasaron a 12 (101 por href, 47 por membresía única; 0 ambiguos). Esas 12 se quedan NULL: href `/inbox`, que la regla no usa, o un documento que no aporta un slug único. `ProcessAuditEvent`: 31 NULL, encadenados y sin fila de solicitud, documento ni onboarding; se dejan NULL. El trigger de inmutabilidad no se desactiva. `HumanTask` y `WorkflowRun`: 0 NULL.

---

## Lo que sigue fuera

- **Vendor IdV de redirect** y la tabla `IdvSession`. No hay contrato, así que no se construye. El gate `kycPolicy` no se toca: sigue consumiendo el alta de onboarding.
- **HSM/KMS.** `SoftwareKeyCustodian` es el default. `Pkcs11KeyCustodian.getSigningMaterial` responde que el servicio no está disponible. Ruta: `P2-KMS.md`.
- **Constancia NOM-151** de un PSC acreditado. Hay sello RFC 3161 (`TSA_URL`) y los campos `timestampProvider` / `timestampTokenHash`. `trustedChain` queda en falso.
- **OCSP/CRL y LTV** para que Acrobat valide sin ancla manual.
- **`templateId` persistido** en la solicitud. Hoy solo aplica defaults al crear. La UI no cambia eso.
- **RLS de Postgres** y llave o bucket por tenant. El aislamiento actual es de aplicación, más el `tenantId` de fila.
- **Filas que el backfill deja en NULL a propósito.** Sin pista única no se inventa un slug. Otro entorno con datos corre la misma guía.

Object Lock GOVERNANCE a 30 días ya está en el init de MinIO del sandbox. No es el capítulo de plataforma (RLS, Merkle, white-label) que `00-FASES.md` llama P3.

## Qué sigue

1. HSM por `Pkcs11KeyCustodian` cuando haya módulo y certificado de una CA que Acrobat reconozca. OCSP/CRL y la constancia NOM-151 van en ese mismo plan (`P2-KMS.md`), no en este cierre.
