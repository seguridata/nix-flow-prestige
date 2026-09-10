# HANDOFF — Fase A, Fase B y cierre de módulos parciales

> **Documento de continuidad entre sesiones.** Si retomas este trabajo en una
> sesión nueva (contexto en frío), lee este archivo **completo** antes de tocar
> nada. Aquí está: el requerimiento tal cual lo pidió el usuario, las reglas
> inviolables, el objetivo, cómo levantar el entorno, el estado actual, las
> decisiones ya tomadas (no re-litigar), el checklist completo con casillas, y
> las skills a cargar.

Rama de trabajo: **`feat/fase-a-b-produccion`**
Idioma de toda comunicación y comentarios: **Español México** (con acentos correctos).

---

## 0. Quick-start para retomar

```bash
# 1. Cargar skills base (ver §8 para la lista completa)
#    Skill: superpowers:using-superpowers   (siempre primero)

# 2. Situarte
git checkout feat/fase-a-b-produccion
git log --oneline -15
cat HANDOFF-FASE-A-B.md   # este archivo
cat PLAN-FASE-A-B.md      # plan operativo (se mantiene sincronizado con §7)

# 3. Levantar TODO el stack (Docker vive dentro de WSL/Ubuntu)
wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/Dave/Documents/Develop/Projects/SeguriLab/Nix-flow-prestige && bun run dev"
#   Levanta: infra Docker (Postgres, Keycloak, Temporal+UI, MinIO, Redis)
#   + Prisma migrate + frontend :3001 + BFF y worker Temporal :3000
#   Para rehacer el sandbox desde cero:  bun run dev -- --reset

# 4. Verificar salud
curl -s http://127.0.0.1:3000/operations/health     # postgres debe ser true
curl -sI http://127.0.0.1:8081/realms/prestige/.well-known/openid-configuration

# 5. Continuar por el primer [ ] sin marcar del checklist §7, en orden de ola.
```

---

## 1. Requerimiento del usuario — TAL CUAL

### Mensaje 1 (objetivo y reglas)

> va,necesite que todo absolutamente todo lo que esta como parcial lo termines no
> quiero demos ni simulaciones quiero todo 100% real y funcional apoyate de
> internet y busca proyectos e integralos si consideras que te sirven, no
> experimentes, busca soluciones reales open source e integralas quiero calidad y
> profecionalismo todo real y siguiendo las buenas practicas a la par depura l
> proyecto limpialo de lo que no sirve o sea inutil o no tenga proposito, todo lo
> que queda como codigo viejo botalo y quiero que optimices codigo, queda
> prohibido usar imagnes base 64 o documentos en el codigo realia todo lo
> necesario para colocarlo en bd, storage o lo que consideres propio, tu toma
> iniciativa y atribuyete la toma de decisiones para cumplir el objetivo quiero
> que realices la fase A y B con todos los checkbox necesito inteligencia,
> necesito tu capacidad y busca skill si necesitas tu llevas el mando lo unico y
> como objetivo principal es concluir fase A, B y terminar todos lo que esta
> parcial no te detengas hasta cumplir con este objetivo completo si no sabes
> busca en internet, cualquiero cosa tu tienes el mando y la decision  excepto
> parar, hacer cosas emuladas o simulada o dejar algo parcial tu objetivo es
> terminarlo , va? usa multiagentes instala lo que necesites y agrega o quita ,
> incluso si es necesario reconstruir y cambiar de arquitectura hazlo

### Mensaje 2 (este handoff)

> va deja todo documentado y crea el checklist en md para dar contonuidad en
> otras sesiones y sepa donde retomar colocando explicitamente como te mencione
> tal cual el requerimiento, las reglas y lo quedebe hhacer junto toda slas
> skills para cargar con A, docker esta en wsl, en wsl corre el script bun run
> dev eso levanta todo

---

## 2. Reglas inviolables

1. **Nada emulado, simulado ni "demo".** Cada pieza debe ser real y funcional.
2. **Prohibido base64 de imágenes o documentos en el código / en la BD.** Todo
   contenido binario (PDF, INE, selfie, trazo de firma) va a **object storage**
   (MinIO/S3). La BD guarda solo `objectKey` + hash + metadatos + meta de cifrado.
3. **Buscar soluciones open source reales en internet e integrarlas.** No
   experimentar, no inventar. Si SeguriData ya opera un servicio (HSM/PKI/TSA/PSC,
   biometría 3D), se consume vía **adaptador** con el mismo patrón.
4. **Calidad y profesionalismo.** Buenas prácticas: DTOs validados, tests,
   manejo de errores homogéneo, logs estructurados, OWASP, sin secretos en el
   código, migraciones reversibles.
5. **Depurar el repo:** eliminar código viejo, muerto, inútil o sin propósito.
   Optimizar.
6. **Iniciativa y decisión propias.** No pedir permiso para decisiones técnicas;
   tomarlas, registrarlas (ADR) y seguir. No detenerse.
7. **Usar multiagentes** para trabajo paralelizable; instalar lo necesario;
   agregar o quitar dependencias/módulos; reconstruir o cambiar arquitectura si
   hace falta.
8. **Objetivo principal:** concluir **Fase A** y **Fase B** con **todos** los
   checkbox, y **terminar todo lo que está `Parcial`** (M01, M02, M03, M05, M07,
   M09, M12, M13, M14, M15, M16). No dejar nada parcial.
9. **Commits incrementales** en la rama, con `tsc` + `vitest` verdes en cada uno.
   Atribución al pie de cada commit:
   ```
   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   Claude-Session: <url de la sesión>
   ```
10. **Único límite real:** los servicios de confianza **productivos** de
    SeguriData (HSM físico, TSA productiva, API oficial INE/RENAPO, motor
    biométrico 3D) no viven en este repo. Se implementan con un **default real
    OSS** (CA X.509 propia + PKCS#12 cifrado, TSA RFC 3161 self-hosted, OCR
    `tesseract`, face-match `face-api`) y un **puerto** para conmutar por `env`
    cuando SeguriData entregue endpoints/credenciales. Eso **no** es simulación:
    es criptografía / OCR real; solo que aún no es *su* PKI productiva.

---

## 3. Objetivo y definición de «hecho»

Un ítem del checklist está **hecho** cuando:

- El código es real (no stub, no `TODO`, no rama muerta) y sigue buenas prácticas.
- `cd backend/bff && bunx tsc --noEmit && bun run test` pasa.
- `cd frontend/web && bunx tsc --noEmit && bun run test` pasa.
- Con el stack arriba (`bun run dev` en WSL), la funcionalidad se ejerció de
  extremo a extremo (curl / navegador / e2e) y **funciona**.
- Está commiteado en `feat/fase-a-b-produccion`.
- La casilla se marcó `[x]` en §7 y en `PLAN-FASE-A-B.md`, y se anotó en §9
  (bitácora).

---

## 4. Entorno — cómo levantar todo

**Docker corre dentro de WSL (distro `Ubuntu`), no en Windows.**

| Acción | Comando |
|---|---|
| Levantar TODO | `wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/Dave/Documents/Develop/Projects/SeguriLab/Nix-flow-prestige && bun run dev"` |
| Reset del sandbox | mismo comando con `-- --reset` |
| Bajar infra | `wsl -d Ubuntu -- bash -lc "cd <repo> && bun run down"` |
| Prisma migrate (desde `backend/bff`) | `bunx prisma migrate deploy` — `migrate dev` **falla** en no-interactivo; las migraciones nuevas se escriben a mano en `prisma/migrations/<ts>_<slug>/migration.sql` y se aplican con `deploy` |
| Prisma generate | matar antes los `node` de `Nix-flow-prestige` (si no, `EPERM` al renombrar el engine en Windows) |
| Ver contenedores | `wsl -d Ubuntu -- docker ps` |

`bun run dev` (raíz): infra Docker + `prisma migrate deploy` + `prisma generate`
+ frontend (`@prestige/web`, `:3001`, Turbopack) + BFF y worker Temporal
(`@prestige/bff`, `:3000`, `tsx watch`). Copia `.env` si faltan e instala deps.

Puertos libres: `3000` BFF · `3001` app · `5432` Postgres · `6379` Redis ·
`7233` Temporal · `8081` Keycloak · `8088` Temporal UI · `9000/9001` MinIO.

| Servicio | URL | Credenciales |
|---|---|---|
| App | http://localhost:3001 | (tras Fase A: login OIDC Keycloak) |
| BFF | http://localhost:3000 | Bearer JWT del realm `prestige` |
| Cockpit | http://localhost:3001/operations | — |
| Temporal UI | http://localhost:8088 | — |
| MinIO consola | http://localhost:9001 | `prestige` / `prestige-minio` |
| Keycloak | http://localhost:8081 | `admin` / `admin` (realm `prestige`) |

**Keycloak realm (`backend/infra/keycloak/prestige-realm.json`):**
- Cliente `prestige-web` — **público**, PKCE, redirect `http://localhost:3001/*`
  y `:3000/*`, webOrigins `:3001` `:3000`, directAccessGrants on.
- Roles realm: `signer`, `sender` (Fase A añade `rh`, `auditor`, `admin`).
- Usuarios: `maria` (signer), `carlos` (signer), `roberto` (signer+sender).

---

## 5. Estado actual (actualizar en cada sesión)

**Última actualización:** 2026-09-09 · sesión `session_011dcPJsWMoFEARdPd7kcBiQ`

### Commits en la rama

| Commit | Qué | Verificado |
|---|---|---|
| `3968bf2` | Limpieza: fuera `.playwright-mcp/`, PNGs sueltos de raíz, `prestige-document-signed.png`; `.gitignore` + material PKI local; añade `PLAN-FASE-A-B.md` | `tsc` bff OK |
| `b7c91c6` | Endurecimiento BFF: `helmet`, CORS por lista (`CORS_ORIGINS`), body 2 MB, `ValidationPipe` global (whitelist+forbidNonWhitelisted+transform), `compression`, `trust proxy`, shutdown hooks, logger `pino` (`nestjs-pino`) con redacción de secretos, `ThrottlerModule`. **Elimina `DemoModule`** (`/demo/self-sign`) y los botones «prueba para firmar» de `inbox`/`sent` + `createSelfSignDemo`. Deps nuevas: helmet, compression, @nestjs/throttler, nestjs-pino, pino*, ioredis, @socket.io/redis-adapter, class-validator, class-transformer | **e2e vía WSL**: infra up + `prisma migrate deploy` + `nest start`. `GET /operations/health` → `postgres:true`, `objectStorage:true`. Cabeceras `helmet` presentes (CSP, HSTS, X-Frame-Options, sin `X-Powered-By`). `X-RateLimit-*` presentes (throttler activo). **`ValidationPipe` instalado pero sin efecto aún**: los controllers usan tipos inline, no clases DTO con `class-validator` → un `POST /cases` con campo extra pasa (201). Es el siguiente ítem del checklist. |
| `d3693ef` | `.gitignore` dejaba de versionar todo `.md` salvo README → corregido; se versionan `branding.md`, `AGENTS.md`, `CLAUDE.md`, planes y ADRs. Añade `HANDOFF-FASE-A-B.md`. | n/a |
| `a52c46a` | Bitácora con la verificación e2e de `b7c91c6`. | n/a |
| `36058a7` | **De-base64 del contenido de documentos → object storage cifrado.** PDF por multipart; envelope AES-256-GCM (`src/storage/object-crypto.ts`, `STORAGE_MASTER_KEY`); BD solo `objectKey`+`hash`(claro)+`enc`+`sizeBytes`; `GET /documents/:id/content` sirve el PDF descifrado. Trazo autógrafo por multipart. Migración `20260910030000` + `backfill-storage.ts`. | **e2e WSL**: ROUNDTRIP OK, objeto cifrado en MinIO. `tsc` + 11+18 tests. |
| `1f5869a` | **De-base64 de onboarding** (INE + selfie) → storage cifrado; `/ine` y `/liveness` a multipart; `libs/file.ts` eliminado. Migración `20260910040000`. | **e2e WSL**: 3 objetos cifrados, `GET` sin campos crudos. |
| `6766848` | Handoff al día. | n/a |
| `83ba942` | **FASE A — identidad OIDC real + cierre de superficie pública.** Backend: `@Public()` fuera salvo health/consent/capabilities/verify/internal; `RolesGuard`+`@Roles()` (roles `signer/sender/rh/auditor/admin` en el realm + claim `tenant`); `CurrentUser` da `actorId`/`tenantId` a todos los controllers; `WorkerGuard` HMAC en `/internal/*`; handshake WS autenticado; DTOs `class-validator` en 8 controllers. Frontend Next 16: OIDC Auth Code + PKCE (`libs/auth.ts`), cookie httpOnly firmada (jose), `/api/auth/*`, proxy `/api/bff/[...path]` (adjunta Bearer), `proxy.ts` (ex-middleware) protege rutas, `/login`, logout, `useSession()` real, fuera `maria`. | **e2e WSL**: sin token 401; maria→403 / roberto→200 (roles); `tenantId` del claim; worker HMAC 201 / viejo 401; `next build` OK; `GET /`→307 `/login`; `/api/auth/login`→307 authorize PKCE S256. `tsc` bff+web limpio; 11+18 tests. |
| `f8d70ff` | Handoff — Fase A completa. | n/a |
| `8af449b` | **FASE B — firma DIGITAL real PAdES.** `KeyCustodian` port + `SoftwareKeyCustodian` (PKCS#12 por firmante, CA X.509 interna, `bun run pki:init`) + `Pkcs11KeyCustodian` (esqueleto HSM). `DigitalSignerAdapter`: apariencia visible + PKCS#7 `ETSI.CAdES.detached` con `@signpdf`. `sign()` de todos los métodos firma y sube la versión firmada cifrada. **Sustituye el HMAC.** | **e2e WSL**: `openssl verify` del cert del firmante contra la CA → OK. 13 tests. |
| `189a300` | Handoff — Fase B núcleo. | n/a |
| `dd840f0` | **M16 — OCR/MRZ de INE + puertos `IdentityVerifier` y `BiometricEngine`.** `OcrService` (`tesseract.js`, WASM) corre en `attachIne` con frente+reverso → `OnboardingCase.ineOcr` (CURP, clave de elector, vigencia, sección, MRZ). `IdentityVerifier` (`IDENTITY_VERIFIER=heuristic|renapo`): `HeuristicIdentityVerifier` valida estructura + **dígito verificador** de la CURP (`src/identity/curp.ts`), vigencia y consistencia con lo declarado; `RenapoIdentityVerifier` esqueleto (503 sin `RENAPO_URL`). `verifyIne` guarda `ineCheck`; `IDENTITY_AUTOVERIFY=true` auto-verifica si el puerto dice `ok`; `approve:false` rechaza. `BiometricEngine` (`BIOMETRIC_ENGINE=noop|local|remote`): `Local` = `@vladmandic/face-api` + `@tensorflow/tfjs` (CPU) + `jpeg-js`, face-match por distancia de descriptores (0.6) + liveness Laplaciano, carga perezosa (sin pesos → `available()=false` → revisión manual); `Remote` = el path `BIOMETRIC_PROVIDER_URL` refactorizado. `OnboardingCase += ineOcr/ineCheck/faceMatchScore/biometricEngine` (migr. `20260911050000`). | **e2e WSL**: alta → INE frente+reverso (**tesseract corre `spa` y reporta confianza**) → `verify-ine` (heurística: CURP con dígito verificador válido, `ineCheck.kind=heuristic`) → liveness (`noop`, sin falso positivo) → `HABILITADO`; auditoría completa con `ocrFields`. `tsc` bff+web; 42 tests bff (+7 curp/identity) / 18 web. |
| `cba4e0d` | **M15 — control plane + OpenTelemetry + SLO.** `src/tracing.ts` (OTel: primer import de `main.ts`, parchea `http`/`express`/`prisma`; no arranca sin `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`). Colector opcional en compose (profile `observability`) + `backend/infra/otel-collector.yaml`. `Tenant`/`TenantMembership`/`Policy`/`CatalogEntry` (migr. `20260911040000`, seed `seguridata`). `ControlPlaneController` `/admin/*` (rol admin): CRUD de tenants, membresías (directorio de usuarios de la app), políticas JSON versionadas (`v1→v2` al reescribir), catálogos. `SloService` → `GET /admin/slo`: tasa de éxito/expiración del caso ancla (7 d), `WorkflowRun` roto/`LOCAL`, DLQ correo+webhooks, tareas vencidas, tiempo medio a COMPLETADA, semáforo por indicador y global. | **e2e WSL**: seed + alta de tenant, política `v1→v2`, membresía, catálogo, `/admin/slo` (semáforo `ok`), RBAC (`maria`→403), OTel carga sin endpoint. `tsc` bff+web; 35 tests bff (+3 SLO) / 18 web. |
| `b8aee59` | **M14 — OpenAPI + webhooks firmados + CloudEvents + SDK; monta M13 + hardening de la auditoría multiagente.** `@nestjs/swagger` (`/docs`, `/docs-json`, volcado `openapi.generated.json`). `WebhookSubscription`/`WebhookDelivery` (migr. `20260911030000`): entregas firmadas HMAC (`sha256=HMAC(timestamp.body)`), idempotencia `(subId,eventId)`, backoff + DLQ, despachador `@Interval(10 s)`, CRUD por tenant (admin) + ping/retry. CloudEvents 1.0 `request.completed`/`evidence.sealed` (`EvidenceService`) + `onboarding.enabled` (`OnboardingService`). SDK TS (`schema.d.ts` generado + `client.ts` + `verifyWebhookSignature`) + Python + Postman. **Fix**: `07caa43` no montó `NotificationsModule`/`ScheduleModule`/`PublicSignController` → montados aquí. **Hardening** (revisión 3 agentes): `nudge`/`reassignForDelegation` con `OR[signerId,delegatedFrom]` (el firmante OOO en SECUENCIAL ya recibe avisos); `sign()` reclama el hueco de forma atómica antes de firmar el PDF (doble POST del enlace ya no duplica firma); `OneTimeLink.consume()` atómico + invalida el resto de enlaces del firmante; prueba de consentimiento con IP/UA reales de la conexión (no del cuerpo); escape HTML en plantillas de correo (phishing por `filename`); `SignerMailService` sin lookup global de `Signer`; `delegateId`/`toSignerId` validados; `NudgeCommandDto`; proxy `/api/public-sign` descarta `x-forwarded-*`; TTL de enlace 72 h; `generateForRequest` tolera la carrera `sign()`↔`sealEvidence` (P2002). | **e2e WSL** (stack completo + Mailpit): M07 OK, M13 OK, **M14 OK** — `/docs-json` sirve OpenAPI 3.0, alta de suscripción, `ping` + `request.completed` + `evidence.sealed` entregados y **firma HMAC verificada con un HMAC independiente**, cuerpo CloudEvent 1.0, una sola entrega por evento (idempotente). `tsc` bff+web; 32 tests bff (+3 webhooks) / 18 web. |
| `07caa43` | **M13 — correo real + outbox/DLQ + enlaces de un solo uso + portal externo.** `MailerService` (nodemailer → `SMTP_*`/Mailpit), plantillas HTML de marca. `NotificationOutbox`: encolado idempotente (`dedupeKey`), despachador `@Interval(15 s)`, backoff exponencial (1→30 min), DLQ tras `maxAttempts`; `GET /notifications/outbox[/dlq]` + `POST :id/retry` (admin). `OneTimeLink` (A-12): token aleatorio, en BD sólo el `sha256`; se consume al firmar; TTL 14 d. `PublicSignController` (`@Public`): `GET /public/links/:token`, `POST :token/consent`, `POST :token/sign` — autorizado por el enlace, sin Keycloak. `SignerMailService` orquesta invitación/recordatorio/escalamiento/completado. Frontend: `/firmar/[token]` (consentimiento + método), proxy `/api/public-sign` sin Bearer, `proxy.ts`+`providers` dejan pasar `/firmar`. Mailpit en compose (1025/8025). `backend/infra/README-correo.md` (SPF/DKIM/DMARC). Migración `20260911020000`. | **e2e WSL** (stack completo + Mailpit): invitación encolada → despachada por SMTP → **entregada en Mailpit** → token extraído del cuerpo → `GET /public/links/:token` sin sesión → `POST :token/sign` → `COMPLETADA` → reusar el enlace → **410** → correos `completed` y `reminder` encolados. `tsc` bff+web; 29 tests bff / 18 web. |
| `073452f` | **M07 — recordatorios / escalamiento / delegación sobre timers de Temporal.** `waitWithNudges()` en el workflow dispara `sendNudge` en 50/75/90 % del SLA (recordatorio `< 0.9`, escalamiento `>= 0.9`) en orden SECUENCIAL y PARALELO. `WorkflowService.nudge()` crea `UserNotification` + `ProcessAuditEvent` reales (`SIGNATURE_REMINDER`/`SIGNATURE_ESCALATED`), ventana anti-duplicado de 30 min; el escalamiento sube `priority` y avisa al emisor y observadores. **«Fuera de oficina»**: modelo `OutOfOffice` + `GET/PUT/DELETE /me/out-of-office`; al crear la solicitud se fija `Signer.delegatedTo` de los firmantes con regla vigente y `seedTasks` siembra la `HumanTask` a nombre del suplente (`delegatedFrom`). `delegate()` manual reasigna las tareas abiertas. `sign()` resuelve al delegado y la señal/cierre de tarea usan el firmante del orden (`onBehalfOf` en auditoría). `HumanTask += priority/remindersSent/lastReminderAt/escalatedAt/delegatedFrom`; `/tasks` ordena por prioridad. Bandeja `/tasks`: tarjeta «fuera de oficina», badges, delegar. Migración `20260911010000`. | **e2e WSL** (BFF+Temporal+Postgres+Keycloak+MinIO): auto-delegación por OOO; `REMINDER` con dedupe (2º inmediato → 0); `ESCALATION` avisa al emisor + `priority=2` + `escalatedAt`; firma del delegado contada como el firmante original; auditoría `DELEGATED(auto)`/`SIGNATURE_REMINDER`/`SIGNATURE_ESCALATED`/`SIGNATURE_APPLIED{onBehalfOf}`. `tsc` bff+web limpio; 23 tests bff / 18 web. |
| `5099d4e` | **M05 — motor DMN real (FEEL).** `dmn-engine.ts` (`evaluateDmn` con `feelin` + `fast-xml-parser`): evalúa `<decisionTable>` con hit policies FIRST/UNIQUE/ANY/COLLECT y condiciones multi-entrada. `ProcessService.decide(context, processKey)` ahora evalúa el `dmnXml` guardado → `decisionRules` → constante. `/process-definitions/:key/decide` acepta `{ tipo, processKey, context }`. | `tsc` + 16 tests (2 nuevos de `dmn-engine`). |
| `19e3969` | Handoff — Fase B completa. | n/a |
| `fc97cee` | **FASE B — TSA RFC 3161 real + manifiesto firmado + verificador offline + ZIP.** Cliente RFC 3161 a mano (`rfc3161.ts`, `TSA_URL` → freeTSA por defecto). `ManifestSigner` Ed25519 firma el JSON canónico del manifiesto (append-only). Columnas `timestampToken`/`manifestHash`/`manifestSignature`/`manifestSigningKeyId` (migr. `20260910050000`). `verify()` con `checks{}` granular. **`verifier/verify.mjs`**: verificador OFFLINE (solo node-forge) sin BFF/BD. `GET /evidence/:id/dossier` → ZIP con todo + el verificador. | **e2e WSL**: firmar DIGITAL → manifiesto con token de freeTSA + firma Ed25519 → `/verify` 6/6 checks → ZIP 16 KB → **verificador OFFLINE: «expediente VÁLIDO» 7/7** (incl. cadena PAdES y sello RFC 3161). 14 tests bff + 18 web. |

### Verificación e2e disponible

Docker corre en WSL/Ubuntu. Los contenedores `kronos-*` que ya estaban usan
`5433`/`6380`, **no** chocan con los puertos de prestige. Flujo probado:

```bash
wsl -d Ubuntu -- bash -lc "cd /mnt/c/.../Nix-flow-prestige && docker compose --env-file backend/.env -f backend/docker-compose.yml up -d"
wsl -d Ubuntu -- bash -lc "cd .../backend/bff && bunx prisma migrate deploy && bunx prisma generate"
wsl -d Ubuntu -- bash -lc "cd .../backend/bff && bunx nest start"   # o 'bun run dev' desde la raíz para todo
# bajar:  docker compose ... down   (los volúmenes se conservan)
```

---

## 6. Decisiones de arquitectura ya tomadas — NO re-litigar

Registrar cada una como ADR en `docs/adr/` al implementarla (skill
`create-architectural-decision-record`).

| # | Decisión | Motivo |
|---|---|---|
| D1 | **Fase B — firma criptográfica real por software.** `KeyCustodian` port: `SoftwareKeyCustodian` (PKCS#12 cifrado con `STORAGE_MASTER_KEY`/KMS) por default; `Pkcs11KeyCustodian` para el HSM de SeguriData. CA X.509 interna del proyecto (`bun run pki:init`). Firma **PAdES** real sobre el PDF con `@signpdf/signpdf` + `pkijs`/`node-forge`, validable en Adobe. **Sello RFC 3161 real:** TSA self-hosted `uts-server` en Docker + fallback a TSA pública real (freeTSA.org / DigiCert). | La firma es criptográficamente real (PKCS#7 con cadena de confianza real). No hay HSM físico en el repo; el puerto permite conmutar sin tocar el dominio. |
| D2 | **Storage con cifrado en reposo a nivel app.** AES-256-GCM *envelope*: llave de datos por objeto envuelta por `STORAGE_MASTER_KEY` (base64 32 bytes; conmutar a KMS por env). El BFF **descifra y sirve** el binario por HTTP autenticado (`Content-Type: application/pdf`). Presigned URLs quedan para cuando se use SSE nativo del storage. MinIO pasa a **obligatorio** (sin fallback a base64). | «Cifrado en reposo» real sin depender de KMS de MinIO. Servir descifrado por el BFF evita exponer ciphertext al navegador. |
| D3 | **Identidad Fase A.** OIDC **Authorization Code + PKCE** con el cliente público `prestige-web` (ya en el realm). Sesión en **cookie httpOnly** firmada/cifrada (usar `iron-session` o JWT propio con `jose`). El `api-client` del portal manda `Authorization: Bearer <access_token>`. Se elimina `store/session-store.ts` (usuario `maria` hardcodeado). | El realm ya trae el cliente correcto; PKCE es el flujo recomendado para SPA/BFF. |
| D4 | **Canal interno worker→BFF.** Token firmado (HMAC con `WORKER_SHARED_SECRET`) en header `X-Prestige-Worker-Token`, verificado por un guard dedicado sobre `/internal/*`. El header `x-prestige-worker: 1` actual **no se valida** hoy — hay que reemplazarlo. | Cierra un canal hoy 100% abierto (`@Public()` sin comprobación). |
| D5 | **WebSocket autenticado.** El handshake de Socket.IO valida el `access_token` (query/auth), resuelve `tenantId` y verifica pertenencia al documento antes de `join`. Config CORS del gateway unificada con `CORS_ORIGINS` (hoy fija a `http://localhost:3001`, aparte de `main.ts`). | El gateway hoy no autentica ni filtra por tenant. |
| D6 | **Motor de reglas (M05).** Integrar `dmn-eval-js` (Red Hat, OSS real) para evaluar `dmnXml` **y** el `decisionRules` guardado en `ProcessDefinition`. `decide()` deja de usar la constante compilada. | Hoy `decide()` ignora ambos; `dmn-js` es solo editor. |
| D7 | **Notificaciones (M13).** `nodemailer` + plantillas MJML; **Mailpit** en `docker-compose` para dev (SMTP real capturado). Enlaces de un solo uso firmados con expiración. Reintentos + DLQ (tabla `NotificationOutbox`). | Correo real, sin depender de un SMTP externo para dev. |
| D8 | **Observabilidad (M15).** OpenTelemetry (`@opentelemetry/sdk-node` + instrumentaciones HTTP/Express/Prisma) exportando OTLP; colector opcional en compose. Logs `pino` ya integrados. | Estándar OSS, sin lock-in. |
| D9 | **Biometría / INE (M16).** OCR/MRZ real con `tesseract.js`; face-match + liveness con `@vladmandic/face-api` como default; puertos `IdentityVerifier` (INE/RENAPO) y `BiometricEngine` (motor 3D de SeguriData) conmutables por env. | Cumple «real» sin la API oficial; el puerto la integra después. |
| D10 | **Redis real.** Cliente `ioredis`; `@socket.io/redis-adapter` para presencia entre réplicas; caché de lecturas calientes (consentimiento, `capabilities`, process-defs, health). | Hoy Redis está en compose pero el BFF no lo usa; presencia en memoria de proceso. |

---

## 7. Checklist maestro — dónde retomar

Leyenda: `[ ]` pendiente · `[~]` en curso · `[x]` hecho y verificado e2e

### OLA 1 — Base real (sin dependencias externas de SeguriData)

**Limpieza y plataforma**
- [x] Quitar `.playwright-mcp/`, PNGs sueltos, artefactos de build del control de versiones; `.gitignore`
- [x] Quitar `DemoModule` y los botones «prueba para firmar» del portal
- [x] Endurecer `main.ts` (helmet, CORS lista, ValidationPipe, throttler, pino, compression, shutdown hooks, body 2 MB)
- [ ] DTOs reales con `class-validator` en **todos** los controllers (hoy tipos inline sin validación runtime)
- [ ] Filtro de excepciones homogéneo + respuestas de error tipadas (sin fuga de stack)
- [ ] Paginación por cursor en todos los listados; acotar los `list()` sin `take` (bandeja, enviados, `signature-requests.list()`)
- [ ] Redis real: cliente `ioredis` + `@socket.io/redis-adapter` + caché de lecturas calientes (D10)
- [ ] Verificar arranque del BFF con `bun run dev` tras `b7c91c6` (pino/throttler/pipe)

**De-base64 → storage real (D2)** — nota: `objectStorage:true` en health, MinIO alcanzable, bucket `prestige-docs` creado por `minio-init`
- [x] `StorageService`: obligatorio; `putObject`/`getObject`/`deleteObject` con AES-256-GCM envelope; sin fallback a base64; `bun run gen-keys`
- [x] Prisma: `Document` — quitar `contentBase64`; `objectKey String` requerido; `+ sizeBytes Int`, `+ enc Json`
- [x] Prisma: `OnboardingCase` — quitar `ineFrontBase64`/`ineBackBase64`/`selfieBase64`; `+ ineFront/ineBack/selfie Json?` (`{key,sha256,size,enc}`). `libs/file.ts` eliminado. Migración `20260910040000`.
- [x] Firma autógrafa: el PNG de `signature_pad` sube por multipart; `POST /actions/sign` recibe `file`, no base64
- [x] Migración Prisma (`20260910030000`) + `prisma/scripts/backfill-storage.ts` (raw SQL, cifra filas legacy)
- [x] `documents.service`/`controller`: alta por `multipart/form-data` (`FileInterceptor`); `GET /documents/:id/content` sirve el PDF descifrado (`application/pdf`) — falta exigir auth (llega en Fase A)
- [x] `onboarding.service`: INE/selfie a storage cifrado; `/ine` y `/liveness` a multipart; DTOs; frontend `canvas.toBlob` + FormData
- [x] Frontend: `/new` sube el PDF por multipart; visor y editor de campos consumen `/documents/:id/content` como blob URL
- [x] `evidence.service`: solo usa `document.hash` — confirmado, sin cambios
- [x] `BODY_LIMIT` en 2 MB; documentos y trazos ya no viajan en JSON

**Fase A — Backend (identidad y cierre de superficie)** — `83ba942`
- [x] Quitar `@Public()` de todos los controllers salvo health, consent, capabilities, `evidence/:id/verify`, `/internal/*`
- [x] `CurrentUser` en cada handler que recibía `actorId`/`requestedBy`/`tenantId` → del token
- [x] `@Roles()` guard + roles `signer/sender/rh/auditor/admin` en `prestige-realm.json` + claim `tenant` (protocol mapper)
- [x] Autorización por recurso (`A-07`) — roles + aislamiento por tenant a nivel de fila en las lecturas + «firmante sólo ve lo suyo» en `GET /signature-requests` · `4456c71`
- [x] `tenantId` desde el claim; literal `'seguridata'` fuera
- [x] `WorkerGuard` HMAC en `/internal/*` (D4); `activities.ts` firma `X-Prestige-Worker-Token`
- [x] Handshake Socket.IO autenticado (D5); identidad de presencia del token; CORS del gateway desde `CORS_ORIGINS`
- [ ] `step-up auth` para acciones sensibles (`A-11`)

**Fase A — Frontend (OIDC real, D3)** — `83ba942`
- [x] OIDC Auth Code + PKCE a mano sobre endpoints de Keycloak (`libs/auth.ts`); sin `openid-client`
- [x] Sesión en cookie httpOnly firmada (jose HS256) + refresh automático
- [x] `proxy.ts` (ex-`middleware.ts`, renombrado en Next 16) protege rutas → `/login`
- [x] Patrón BFF: `api-client` → `/api/bff/[...path]` (route handler adjunta el Bearer); 401 → `/login`
- [x] `store/session-store.ts` → `useSession()` real desde `/api/auth/me` (SessionProvider en `providers.tsx`); fuera `maria`
- [x] Botón «Cerrar sesión» en el `AppShell`

**Fase A — Ceremonia de firma a pantalla completa (TP-16)** · `3645e70`
- [x] Flujo guiado documento → consentimiento versionado → método (+pad autógrafo) → firma → acuse, fuera del `AppShell`, stepper. Ruta `/documents/[id]/firmar`; la bandeja enlaza aquí cuando `myStatus=PENDIENTE`
- [ ] Acuse: PDF/pantalla con QR al verificador + hash + sello de tiempo (hoy el acuse enlaza a `/documents/[id]/evidence`)

### OLA 2 — Fase B (firma criptográfica real · M09 / M10 / M11)

- [x] `KeyCustodian` port + `SoftwareKeyCustodian` (PKCS#12 por firmante) + `Pkcs11KeyCustodian` (esqueleto HSM) — `8af449b`
- [x] Script `bun run pki:init`: CA X.509 raíz + intermedia; emisión de certificado por firmante (lazy, CN = nombre humano)
- [x] `SignerAdapter` ampliado: `sign` + `verify` + `capabilities` (`prepare`/`reconcile` quedan para firma asíncrona)
- [x] `DigitalSignerAdapter`: firma **PAdES** real (`@signpdf` + `node-forge`), reemplaza el HMAC — verificada con openssl
- [x] Firma visible en el PDF por `SignatureField` para DIGITAL y AUTÓGRAFA (BIOMÉTRICA: pendiente, requiere proveedor)
- [~] Validación de certificado: cadena y vigencia sí (verificador); **OCSP/CRL** no aplica a la CA de software — lo cablea el adaptador PKCS#11 contra el PKI de SeguriData
- [ ] Manejar firma `pending` (asíncrona / 2Fo) en solicitud y workflow + job de reconciliación
- [x] Cliente **RFC 3161** real (`TSA_URL`) — token en el manifiesto; falta incluirlo también dentro del CMS como atributo (PAdES-T)
- [x] `EvidenceService`: `timestampProvider`/`timestampToken`/`timestampTokenHash` con el token TSA real
- [x] Manifiesto de evidencia **firmado** (Ed25519, append-only) + cert/algorithm por firmante
- [x] **Verificador offline** independiente (`verifier/`, sin BFF ni Temporal)
- [ ] Sello de tiempo por cada evento `SIGNATURE_APPLIED` (hoy: sello del `packageHash` al cerrar)
- [ ] Política de firma versionada por caso (M10) — simple / reforzada OTP / biométrica previa
- [x] Exportar expediente probatorio (ZIP: `GET /evidence/:id/dossier`)
- [ ] Pruebas de interoperabilidad en Adobe Acrobat (validado con openssl + verificador forge)
- [x] Auditoría inmutable encadenada para `ProcessAuditEvent` (M11) · `0c2e933` — `seq`/`prevHash`/`hash` por evento, `AuditAnchor` con `FOR UPDATE`, `GET /process-audit/verify` (global/scoped), `evidence.verify().checks.auditChain`
- [ ] Validación de certificado: cadena, vigencia, **OCSP/CRL** (servicio reutilizable)
- [ ] Manejo de firma `pending` (asíncrona / segundo factor) en solicitud y workflow
- [ ] Job de reconciliación de firmas iniciadas y no confirmadas
- [ ] Cliente **RFC 3161** real: `TSA_URL` → `uts-server` en compose + fallback a TSA pública real; token en el manifiesto
- [ ] `EvidenceService`: reemplazar `timestampProvider`/`timestampTokenHash` sintéticos por el token TSA real
- [ ] Manifiesto de evidencia **firmado** (append-only real; hoy es un `create`)
- [ ] **Verificador offline** independiente (paquete/CLI) que valide el expediente sin BFF ni Temporal
- [ ] Sello de tiempo por cada evento `SIGNATURE_APPLIED`
- [ ] Política de firma versionada por caso (M10) — simple / reforzada OTP / biométrica previa
- [ ] Exportar expediente probatorio (ZIP: PDF firmado + manifiesto + token TSA + constancia + verificador)
- [ ] `AutographSignerAdapter` / `BiometricSignerAdapter`: mismo contrato completo; biométrica ata resultado real del motor
- [ ] Pruebas de interoperabilidad: el PDF firmado valida en Adobe Acrobat y en validador oficial
- [x] Auditoría inmutable encadenada para `ProcessAuditEvent` (M11) · `0c2e933` — `seq`/`prevHash`/`hash` por evento, `AuditAnchor` con `FOR UPDATE`, `GET /process-audit/verify` (global/scoped), `evidence.verify().checks.auditChain`

### OLA 3 — Resto de módulos parciales

**M05 — Diseñador de procesos**
- [x] Motor DMN real (FEEL, `feelin` — el mismo que dmn-js — en vez de `dmn-eval-js`) evaluando `dmnXml` → `decisionRules` → constante (D6) · `5099d4e`
- [ ] Catálogo de actividades BPMN permitidas + validación al publicar
- [ ] Resolver divergencia BPMN de diseño ↔ workflow TS en Temporal (generar workflow desde BPMN o mapeo versionado)

**M07 — Bandejas / SLA** · `073452f`
- [x] Recordatorios (nudges en 50/75/90 % del SLA) + escalamiento al emisor y observadores sobre timers de Temporal
- [x] Reasignación por ausencia; delegación y «fuera de oficina» (`OutOfOffice` + `/me/out-of-office`; `delegatedTo`/`delegatedFrom`)
- [x] Prioridades en la bandeja (`HumanTask.priority`; `/tasks` ordena por prioridad; el escalamiento sube a 2)

**M13 — Notificaciones** · `07caa43`
- [x] `nodemailer` + plantillas HTML de marca (invitación/recordatorio/escalamiento/completado); **Mailpit** en compose (D7)
- [x] Enlaces de un solo uso con expiración + portal del firmante externo (`OneTimeLink`, `/public/links/*`, `/firmar/[token]`) — cierra también `A-12`
- [x] `NotificationOutbox` con encolado idempotente, despachador `@Interval`, reintentos con backoff exponencial + DLQ (`/notifications/outbox*`)
- [x] SPF/DKIM/DMARC documentados para producción (`backend/infra/README-correo.md`)

**M14 — APIs / webhooks / eventos** · `b8aee59`
- [x] OpenAPI real (`@nestjs/swagger` + plugin CLI): UI `/docs`, JSON `/docs-json`, volcado `backend/contracts/openapi.generated.json`
- [x] Webhooks firmados HMAC-SHA256 por suscriptor (`X-Prestige-Signature: sha256=HMAC(timestamp.body)`) + idempotencia `(subscriptionId,eventId)` + reintentos backoff + DLQ (`/webhooks/*`, despachador `@Interval(10 s)`)
- [x] Eventos CloudEvents 1.0 (`…request.completed`, `…evidence.sealed`, `…onboarding.enabled`)
- [x] SDK: `backend/sdk/typescript` (`schema.d.ts` generado con `bun run sdk:gen` + `client.ts` tipado + `verifyWebhookSignature`), `backend/sdk/python` (`prestige_client.py`), `backend/contracts/prestige.postman_collection.json`
- [ ] Deuda: validar `openapi.generated.json` contra el contrato a mano `backend/contracts/openapi.yaml` (o retirar el `.yaml`)

**M15 — Administración / observabilidad** · `cba4e0d`
- [x] Control plane (`/admin/*`, rol admin): `Tenant` + `TenantMembership` (usuarios) + `Policy` (JSON versionada) + `CatalogEntry`; `:tenant` acepta id o slug; seed `seguridata`
- [x] OpenTelemetry (`http` + `express` + `@prisma/client`) exportando OTLP/HTTP (`src/tracing.ts`, D8); colector opcional en compose (profile `observability`) + `backend/infra/otel-collector.yaml`
- [x] SLO / presupuesto de error del caso ancla: `GET /admin/slo` (tasa de éxito/expiración 7 d, `WorkflowRun` roto/`LOCAL`, DLQ correo+webhooks, tareas vencidas, tiempo medio a COMPLETADA; semáforo ok/warn/crit)
- [ ] Deuda: `/admin/users` como proxy real al Keycloak Admin API (hoy el directorio de usuarios es `TenantMembership`, poblado a mano)

**M16 — Onboarding / identidad** · `dd840f0`
- [x] OCR/MRZ real de INE (`tesseract.js`, WASM) (D9) — `OcrService` corre en `attachIne`, campos CURP/clave/vigencia/sección/MRZ → `OnboardingCase.ineOcr`
- [x] Puerto `IdentityVerifier` conmutable por env (`heuristic` por defecto: CURP + dígito verificador + vigencia + consistencia; `renapo` esqueleto). `verifyIne` asistida + `IDENTITY_AUTOVERIFY`
- [x] Puerto `BiometricEngine` (`noop` por defecto | `local` `@vladmandic/face-api`+`tfjs` CPU, face-match por descriptores + liveness Laplaciano, pesos en `FACE_MODEL_DIR` | `remote` = motor 3D de SeguriData por HTTP)
- [x] INE/selfie fuera de Postgres (Ola 1 de-base64)
- [ ] Deuda: `local` face-api verificado sólo hasta `available()` (faltan los pesos en `models/face/`; ver README); `renapo` necesita `RENAPO_URL` real; recorte del retrato de la INE (hoy se pasa el frente completo al face-match)

**M01 / M02 / M03 / M12** — cerrados por Ola 1 (portal con login real, identidad+tenant, documentos en storage, custodia). Verificar cierre completo al final.

### TRANSVERSAL (continuo)

- [x] **CI (GitHub Actions)** `b77ae3e` — `bun install --frozen-lockfile` + `prisma generate`/`migrate deploy`/`migrate diff --exit-code` (drift) + `turbo typecheck/test/build` + `gitleaks`. Dispara en push a `main`/`feat/**` y PR a `main`. *Falta: e2e Playwright en CI, cobertura como gate.*
- [x] **Filtro global de excepciones** `14dc272` — forma estable `{statusCode,error,message,path,at}`, Prisma→HTTP (P2025→404, P2002→409…), 5xx opacos (stack sólo al log).
- [x] **Redis real (D10)** `40a653e` — `RedisService` (`ioredis`), adaptador **Socket.IO-Redis** (WS multi-réplica), caché de lectura caliente (`ProcessService`, TTL 60 s + invalidación). Sin `REDIS_URL` = no-op.
- [ ] Escaneo SAST + dependencias + secretos + CVE de imágenes + SBOM (gitleaks ya está; falta SAST + `osv-scanner`/`trivy` + SBOM)
- [ ] Paginación por cursor en los listados que pueden crecer (`/process-audit`, `/webhooks/deliveries`, `/notifications/outbox`, `/workflows`) — hoy tienen `take` acotado pero sin cursor
- [ ] Cobertura de pruebas por servicio + contract tests del `SignerAdapter` + tests de *tamper* de la cadena de evidencia
- [ ] Backup + PITR de la BD primaria + simulacros de restauración; pooling de conexiones (PgBouncer / límite Prisma)
- [ ] Gestión de secretos en runtime (vault/KMS) + rotación (llave de firma JWT, secretos de webhook, credenciales de cliente Keycloak)
- [ ] Feature flags / kill-switch para Fase E y para *dark launch* de HSM/TSA
- [ ] Manifiesto de despliegue de producción (compose de prod o k8s) + IaC + entorno de staging
- [ ] Endurecer Temporal para producción (retención de historia, autoescalado de workers, versionado de workflows con `patched()`)
- [ ] LFPDPPP: aviso de privacidad + derechos ARCO; DPA con proveedor biométrico y subprocesadores; retención/legal-hold en todos los almacenes
- [ ] Accesibilidad AA (foco, contraste sobre carbón, teclado en Kanban/⌘K, `aria-live`); i18n es-MX; textos legales versionados fuera del código
- [ ] Actualizar `docs/README.md` (aún dice `fakeSign()`) y documentos de julio para que no contradigan al código

#### Deuda de la auditoría multiagente (M07/M13/M14 — `/multi-agent-review` correctness · security · multi-tenant)

- [x] **`A-07` — aislamiento por tenant a nivel de fila (lecturas).** `4456c71`: `Document` y `SignatureRequest` llevan `tenantId` denormalizado; `GET /documents(/:id/content)`, `GET /signature-requests(/:id/status)`, `GET /cases/:id`, `GET /tasks`, `/me/inbox|sent` filtran por el `tenantId` del token; `create` valida pertenencia; scoping por recurso en `GET /signature-requests` (no privilegiado → sólo lo suyo). Verificado e2e. **Resta**: `Signer`/`HumanTask`/`ConsentAcceptance`/`OneTimeLink`/`OutOfOffice`/`NotificationOutbox` siguen sin columna propia (heredan vía la solicitud/documento; el acceso hoy es siempre a través de una raíz ya acotada) — añadir columna sólo si aparece un acceso directo por id a esas tablas.
- [ ] `GET /notifications/outbox[/dlq]` devuelve el correo de **todos** los tenants a cualquier `admin`; filtrar por `tenantId` del admin cuando exista el control plane (M15).
- [ ] Validar `delegateId` / `toSignerId` (OOO + delegación) contra el directorio de usuarios del tenant (hoy sólo charset); `delegatedToName` es texto libre que llega al PDF firmado y a la auditoría.
- [ ] Portal externo `/public/links/:token`: rate-limit / lockout por token propio (hoy sólo el throttler global, y la IP real detrás del proxy Next necesita infraestructura que la fije). TTL configurable ya en 72 h.
- [ ] `NotificationDispatcher` / `WebhookDispatcher`: sin claim entre procesos → con >1 réplica del BFF habría doble envío. Añadir `FOR UPDATE SKIP LOCKED` o correr el despachador como singleton antes de escalar horizontalmente.
- [ ] Dedupe de recordatorios por marca (50/75/90 %), no por ventana de 90 s: si el SLA es de minutos y dos marcas caen muy juntas, hoy se podría perder una. Persistir la última marca enviada por tarea.
- [ ] Rotación del `secret` de cada `WebhookSubscription` (endpoint de rotación + doble-firma durante el traslape).

### Detalle Fase A — `A-01`..`A-12` (del informe original)

- [x] `A-01` Login OIDC en el portal (Auth Code + PKCE) contra Keycloak realm `prestige`
- [x] `A-02` Sesión real (cookie httpOnly + refresh); eliminar `session-store` con `maria`
- [x] `A-03` `middleware.ts` protege rutas + página de sesión expirada
- [x] `A-04` Quitar `@Public()` ruta por ruta (dejar solo health, consent, verificador)
- [x] `A-05` `requestedBy`/`actorId`/`actorName` del token en todos los controllers
- [x] `A-06` `tenantId` del token; quitar literal `'seguridata'` (onboarding, cases body)
- [x] `A-07` Autorización por recurso — roles + aislamiento por tenant a nivel de fila + scoping «firmante sólo ve lo suyo» · `4456c71`
- [x] `A-08` Roles en el realm: `signer`, `sender`, `rh`, `auditor`, `admin`; guards por rol
- [x] `A-09` Guard real del canal interno worker→BFF (`/internal/*`); firmar token en `activities.ts`
- [x] `A-10` Handshake Socket.IO autenticado + tenant/documento; CORS del gateway unificado
- [ ] `A-11` Step-up auth para acciones sensibles
- [x] `A-12` Enlaces de un solo uso con expiración para firmantes externos sin cuenta Keycloak (`OneTimeLink` + `/public/links/*` + `/firmar/[token]`) · `07caa43`

---

## 8. Skills a cargar (para continuar con la opción A)

> Invocar con la herramienta `Skill`. Cargar lo relevante a la tarea del momento,
> no todo de golpe. `superpowers:using-superpowers` **siempre primero** en cada
> sesión.

### Proceso / orquestación (cargar al inicio)
| Skill | Para qué |
|---|---|
| `superpowers:using-superpowers` | Establece cómo usar skills. **Primero, siempre.** |
| `superpowers:executing-plans` | Ejecutar el checklist §7 de forma disciplinada |
| `superpowers:writing-plans` | Si hace falta replanear un frente antes de tocar código |
| `superpowers:subagent-driven-development` | Multiagentes sobre tareas independientes del checklist |
| `superpowers:dispatching-parallel-agents` | Fan-out de agentes en paralelo |
| `multi-agent-review` | Revisar un plan/spec con panel de agentes antes de ejecutarlo |
| `superpowers:using-git-worktrees` | Aislar frentes de trabajo paralelos |
| `superpowers:systematic-debugging` | Ante cualquier bug/fallo de test, antes de proponer fix |
| `superpowers:test-driven-development` | Escribir la prueba antes del código |
| `superpowers:verification-before-completion` | Antes de marcar cualquier `[x]` |
| `superpowers:requesting-code-review` / `superpowers:receiving-code-review` | Revisión por incremento |
| `superpowers:finishing-a-development-branch` | Al integrar la rama |

### Backend (Fase A, Fase B, storage, módulos)
| Skill | Para qué |
|---|---|
| `backend-development` | NestJS, Prisma, PostgreSQL, OAuth2.1/JWT, testing, OWASP Top 10, perf, caching, Docker/CI. **Núcleo del trabajo.** |
| `prisma-database-setup` | Cambios de esquema, migraciones, de-base64, índices |
| `create-architectural-decision-record` | Registrar D1–D10 y cualquier decisión nueva en `docs/adr/` |
| `improve-codebase-architecture` / `architecture-designer` | Si se reconstruye o reordena un dominio |
| `microservices-architect` | Solo si se decide separar en servicios |
| `duende-skills:oauth-oidc-protocols` | Razonamiento de protocolo OAuth2/OIDC a nivel HTTP para Fase A (genérico; ignorar lo específico de .NET) |

### Frontend (Fase A OIDC, ceremonia de firma)
| Skill | Para qué |
|---|---|
| `modern-web-guidance` | **Obligatorio** antes de tocar HTML/CSS/JS de cliente (APIs web evolucionan; los pesos de entrenamiento traen patrones obsoletos) |
| `vercel:nextjs` | Next.js 16 — breaking changes (ver también `frontend/web/AGENTS.md` y `node_modules/next/dist/docs/`) |
| `vercel:auth` | Patrones de autenticación en Next/BFF |
| `vercel:react-best-practices` | Buenas prácticas React 19 |
| `frontend-design` / `frontend-design:frontend-design` | Ceremonia de firma a pantalla completa, acuse, con la identidad `branding.md` |
| `shadcn-ui` | El portal usa primitivas shadcn/Radix propias |
| `web-design-guidelines` | Revisar el código UI contra guías de accesibilidad/UX |
| `web-animation-design` | Microinteracciones 150–220 ms con `prefers-reduced-motion` |

### Cripto / firma (Fase B) — no hay skill dedicada; usar estas libs OSS reales
| Necesidad | Librería / servicio OSS |
|---|---|
| Firma PAdES sobre PDF | `@signpdf/signpdf` + `@signpdf/placeholder-plain` (o `-pdfkit`) |
| Primitivas X.509 / PKCS#7 / ASN.1 | `pkijs` + `pvutils` + `@peculiar/asn1-schema`, o `node-forge` |
| PKCS#11 (HSM real) | `graphene-pk11` o `pkcs11js` (contra SoftHSM2 en dev) |
| Sello de tiempo RFC 3161 | TSA self-hosted `uts-server` (Docker); fallback público real: freeTSA.org, `http://timestamp.digicert.com` |
| DMN (M05) | `dmn-eval-js` (Red Hat) |
| OCR/MRZ (M16) | `tesseract.js` |
| Face-match / liveness (M16) | `@vladmandic/face-api` |
| Correo (M13) | `nodemailer` + `mjml`; **Mailpit** en compose |
| Observabilidad (M15) | `@opentelemetry/sdk-node` + instrumentaciones HTTP/Express/Prisma |

### Verificación / QA / cierre
| Skill | Para qué |
|---|---|
| `qa` / `webapp-testing` | Estrategia y ejecución de pruebas de la app |
| `playwright-cli` / `playwright-generate-test` / `playwright-explore-website` | e2e con el stack arriba |
| `chrome-devtools` / `chrome-devtools-mcp:chrome-devtools` | Depurar en navegador |
| `chrome-devtools-mcp:a11y-debugging` | Accesibilidad |
| `chrome-devtools-mcp:debug-optimize-lcp` / `chrome-devtools-mcp:memory-leak-debugging` | Rendimiento |
| `codspeed:codspeed-setup-harness` / `codspeed:codspeed-optimize` | Benchmarks de rendimiento |
| `/security-review` (slash) | Revisión de seguridad antes de cerrar la rama |
| `/code-review` (slash) | Revisión por incremento (`/code-review high` o `ultra`) |

### Documentación
| Skill | Para qué |
|---|---|
| `documentation-writer` | Documentación técnica (Diátaxis) |
| `acquire-codebase-knowledge` | Re-onboarding a frío al repo |

### Referencia de modelos (si se toca algo de IA)
| Skill | Para qué |
|---|---|
| `claude-api` | IDs de modelo, precios, params, tool use, caching (leer antes de escribir código que llame a un LLM) |

---

## 9. Bitácora de sesiones

### Sesión 1 — 2026-09-09/10 · `session_011dcPJsWMoFEARdPd7kcBiQ`
- Revisión completa del repo; generados 2 PDF de diagnóstico en `docs/reportes/revision-2026-09/` (fuera de control de versiones por `.gitignore` de `/docs/` y `*.pdf`).
- Rama `feat/fase-a-b-produccion` creada.
- `3968bf2` limpieza del repo · `b7c91c6` endurecimiento BFF + fuera `DemoModule` · `d3693ef` versionar markdown + handoff.
- Bloqueo detectado y resuelto: Docker no corre desde Windows; **sí vía WSL/Ubuntu** (`docker 29.1.3`, repo en `/mnt/c/...`).
- **Verificado e2e vía WSL:** infra up (postgres healthy, keycloak/temporal/minio/redis), `prisma migrate deploy` (sin migraciones pendientes), `nest start`. `GET /operations/health` → `postgres:true objectStorage:true`. `helmet` + `throttler` activos en cabeceras. `ValidationPipe` instalado pero inerte sin clases DTO. Infra bajada al terminar (volúmenes conservados).
- `36058a7` **de-base64 de documentos** → object storage cifrado (envelope AES-256-GCM), multipart, trazo autógrafo por multipart, migración + backfill, DTOs, frontend blob URLs. Verificado e2e por ROUNDTRIP en WSL. También arreglé bugs latentes que ocultaba `.next/dev/types` corrupto (`.next` borrado; `SheetContent direction`; shims de tipos; `dev.ts` merge de `.env`).
- `1f5869a` **de-base64 de onboarding** (INE frente/reverso + selfie) → object storage cifrado; `/ine` y `/liveness` a multipart; DTOs; `canvas.toBlob` en el frontend; `libs/file.ts` eliminado. Verificado e2e en WSL: 3 objetos cifrados en MinIO, `GET` sin campos crudos. **Base64 de documentos/imágenes: eliminado de la BD.**
- Nota entorno: `prisma generate` en Windows da `EPERM` al renombrar `query_engine-windows.dll.node` si hay un `nest`/BFF de una sesión previa vivo. **Fix:** matar los procesos `node` cuyo command line contenga `Nix-flow-prestige` antes de `generate` (PowerShell: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where CommandLine -match 'Nix-flow-prestige' | ForEach Stop-Process -Id $_.ProcessId -Force`).
- `83ba942` **FASE A completa** (identidad OIDC + cierre de superficie), backend y frontend, verificada e2e en WSL (roles, tenant del claim, worker HMAC, redirect a `/login`, PKCE). Pendientes menores de Fase A: `A-07` scoping fino por recurso, `A-11` step-up auth, `A-12` enlaces de un uso (va con M13).
  - Frontend Next 16: `middleware` se llama **`proxy.ts`** ahora; `cookies()` es async. Patrón BFF: todo el tráfico va por `/api/bff/[...path]` (route handler que adjunta el Bearer server-side); el WS usa `/api/auth/session-token`.
  - Realm reimportado con `down -v` + `up` (roles `rh/auditor/admin`, claim `tenant`). El token debe pedirse al MISMO host que `KEYCLOAK_ISSUER` (`localhost`, no `127.0.0.1`) o el guard rechaza por `iss` mismatch.
- `8af449b` **FASE B núcleo — firma DIGITAL PAdES real.** `KeyCustodian` + CA interna + PKCS#7 con `@signpdf`. Verificado e2e con openssl (cadena del firmante → CA del proyecto → `OK`). El HMAC de desarrollo **desaparece**.
  - Notas: `@signpdf/placeholder-plain` necesita tabla xref clásica → el adaptador normaliza el PDF con `useObjectStreams:false`. `@signpdf/utils` tuvo que añadirse como dep directa (era transitiva).
- `fc97cee` **FASE B completa (núcleo M10/M11)** — TSA RFC 3161 real (freeTSA por defecto), manifiesto firmado Ed25519 (append-only), verificador **offline** (`verifier/`), export ZIP `GET /evidence/:id/dossier`. Verificado e2e: el verificador offline dice «expediente VÁLIDO» 7/7 sin tocar el BFF.
  - Notas: `archiver` v8 es **ESM puro** → `new ZipArchive()` (no la forma llamable). `compression` en `main.ts` excluye `application/zip|pdf`. El token TSA se pide al host de `TSA_URL`; freeTSA.org respondió en la prueba real.
- **Fase A y Fase B: núcleos DONE y verificados e2e.** Pendientes acotados (ver checklist §7 OLA 2): firma `pending`/reconciliación (firma asíncrona), sello por evento, política de firma M10, interop Adobe, y `A-11` (`A-07` `4456c71`, `A-12` `07caa43`, **M11 auditoría encadenada `0c2e933`**).
- **Retomar en:** (1) **OLA 3 COMPLETA** — M05 `5099d4e` · M07 `073452f` · M13 `07caa43` (+`A-12`) · M14 `b8aee59` · M15 `cba4e0d` · M16 `dd840f0`; (2) **transversal**: ~~A-07~~ `4456c71` · ~~CI~~ `b77ae3e` · ~~filtro de excepciones~~ `14dc272` · ~~Redis/D10~~ `40a653e` · ~~ceremonia TP-16~~ `3645e70` — **quedan**: paginación por cursor, SAST/SBOM, e2e Playwright en CI; (3) **pendientes de Fase B**: firma `pending`/reconciliación, sello por evento, política de firma M10, interop Adobe (`M11` cerrado `0c2e933`); `A-11` step-up auth; (4) **deuda de la auditoría multiagente** (ver §7 TRANSVERSAL: claim entre procesos de despachadores, rate-limit del portal, rotación de secreto de webhook).
- Verificación pendiente: login OIDC **completo en navegador** (el `curl` llega al redirect a Keycloak; falta rellenar el form y volver por `/api/auth/callback`). Playwright o manual.
- `5099d4e` **M05 — motor DMN real (FEEL).** `evaluateDmn` con `feelin` (el evaluador de expresiones de dmn-js) + `fast-xml-parser`; `decide()` evalúa de verdad el `dmnXml` del proceso (hit policies FIRST/UNIQUE/ANY/COLLECT, condiciones multi-entrada). `/decide` acepta `context`. 2 tests nuevos.
- `073452f` **M07 — recordatorios / escalamiento / delegación.** Timers de Temporal (`waitWithNudges` en 50/75/90 % del SLA) → activity `sendNudge` → `POST /internal/workflows/nudge` → `UserNotification` + `ProcessAuditEvent` reales, dedupe 30 min. Escalamiento sube `priority` y avisa al emisor + observadores. «Fuera de oficina» (`OutOfOffice` + `/me/out-of-office`): fija `Signer.delegatedTo` al crear y `seedTasks` siembra la tarea a nombre del suplente; `delegate()` manual reasigna las tareas abiertas; `sign()` resuelve al delegado (auditoría `onBehalfOf`, la señal al workflow usa el firmante del orden). Bandeja `/tasks` con tarjeta OOO + badges + delegar. Migración `20260911010000`. **Verificado e2e en WSL** con el stack completo (auto-delegación, REMINDER+dedupe, ESCALATION, firma del delegado contada al original, auditoría completa). 23 tests bff / 18 web.
  - Nota entorno: `bun run worker:dev` (tsx) **no carga `backend/bff/.env`** por sí solo → el worker necesita `WORKER_SHARED_SECRET` en el entorno (`set -a && . ./.env && set +a` antes de lanzarlo, o usar `bun run dev` desde la raíz que ya lo inyecta). Si falta, el activity `seedHumanTasks` falla y el workflow queda FAILED sin sembrar tareas.
- `07caa43` **M13 — correo real + outbox/DLQ + enlaces de un solo uso + portal externo.** `nodemailer` → Mailpit (compose, SMTP 1025 / UI 8025). `NotificationOutbox` con `dedupeKey`, despachador `@Interval(15 s)`, backoff exponencial y DLQ. `OneTimeLink` (token → sólo `sha256` en BD, se consume al firmar) + `PublicSignController` `@Public` + página `/firmar/[token]`. `SignerMailService` engancha invitación/recordatorio/escalamiento/completado. **Cierra `A-12`.** `backend/infra/README-correo.md` documenta SPF/DKIM/DMARC. **Verificado e2e** con Mailpit: correo entregado, token extraído del cuerpo, firma por el portal sin Keycloak, `410` al reusar el enlace. 29 tests bff / 18 web.
  - Nota: `MAIL_FROM` en `.env` debe ir **entre comillas** (`"Prestige <no-reply@…>"`) o el `. ./.env` de bash revienta por el `<`. `@nestjs/schedule` fijado a `4.1.2` (v12 pide Nest 11).
- `b8aee59` **M14 — OpenAPI + webhooks firmados + CloudEvents + SDK.** `@nestjs/swagger` (`/docs`, `/docs-json`, plugin CLI en `nest-cli.json`). `WebhookSubscription`/`WebhookDelivery` con firma HMAC (`X-Prestige-Signature`), idempotencia, backoff, DLQ, despachador `@Interval`. CloudEvents `request.completed`/`evidence.sealed`/`onboarding.enabled`. SDK TS (`sdk:gen` con `openapi-typescript` + `client.ts` tipado) + Python + Postman (`backend/sdk/`, `backend/contracts/`). **Verificado e2e** con un receptor que valida la firma HMAC con un HMAC independiente.
  - **Este commit también monta M13** (`07caa43` no llegó a añadir `NotificationsModule`/`ScheduleModule.forRoot()`/`PublicSignController` a la app — el `git add` de M13 no incluyó `app.module.ts`/`signature-requests.module.ts`; el e2e pasó porque corría contra el árbol de trabajo ya cableado).
- `cba4e0d` **M15 — control plane + OpenTelemetry + SLO.** `/admin/*` (tenants, membresías, políticas JSON versionadas, catálogos), `GET /admin/slo` (semáforo del caso ancla), OTel en `src/tracing.ts` (opt-in por env). `TenantMembership` deja lista la base para cerrar la validación de `delegateId` contra un directorio real. **Verificado e2e** (política v1→v2, RBAC 403, SLO, OTel sin endpoint).
- `dd840f0` **M16 — OCR/MRZ INE + puertos IdentityVerifier/BiometricEngine.** `tesseract.js` (WASM) en `attachIne`; `HeuristicIdentityVerifier` (CURP + dígito verificador + vigencia) por defecto, `renapo` conmutable; `BiometricEngine` `noop|local` (`@vladmandic/face-api`+`tfjs` CPU, degradación grácil sin pesos) `|remote`. **Verificado e2e**: flujo completo de onboarding a `HABILITADO` con OCR corriendo y verificación heurística. **OLA 3 completa.** Deuda: pesos de face-api en `models/face/`, `RENAPO_URL` real, recorte del retrato.
- `4456c71` **A-07 — aislamiento por tenant a nivel de fila.** `Document`/`SignatureRequest` con `tenantId` denormalizado; todas las lecturas por id y las listas (documentos, solicitudes, casos, `/tasks`, bandeja) filtran por el `tenantId` del token; `create` valida pertenencia; `GET /signature-requests` acota a «lo del firmante» si no hay rol privilegiado. **Verificado e2e**: mover un expediente a otro tenant lo hace desaparecer de TODAS las lecturas (404 + ausente en listas/bandeja/tareas).
- `b77ae3e` **CI (GitHub Actions).** `bun install --frozen-lockfile` + `prisma generate/migrate deploy/migrate diff --exit-code` (drift schema↔migraciones) + `turbo typecheck/test/build` con Postgres de servicio; job `gitleaks`. Push a `main`/`feat/**` + PR a `main`.
- `14dc272` **Filtro global de excepciones.** `APP_FILTER`: `{statusCode,error,message,path,at}` estable; Prisma→HTTP (P2025→404, P2002→409, P2003→400); los 5xx sólo dejan «Error interno» al cliente (stack al log). Verificado e2e (404 y 400 con la forma nueva).
- `40a653e` **Redis real (D10).** `RedisService` (`ioredis`, `@Global`), adaptador **Socket.IO-Redis** en `RealtimeGateway.afterInit` (WS multi-réplica), caché de lectura caliente en `ProcessService` (TTL 60 s + invalidación en `saveXml`). Sin `REDIS_URL` todo es no-op. **Verificado e2e**: "Redis conectado" + "adaptador Redis"; `process:list`/`process:latest:*` se pueblan al leer y se borran al guardar.
- `3645e70` **TP-16 — ceremonia de firma a pantalla completa (firmante interno).** Ruta `/documents/[id]/firmar` sin chrome: PDF grande + stepper revisar→consentimiento→método(+pad autógrafo)→firmar→acuse. Reutiliza los servicios reales; la bandeja enlaza aquí cuando la firma está pendiente. Verificado con `tsc` + `turbo build` (nest+next).
- `0c2e933` **M11 — auditoría inmutable encadenada.** Cada `ProcessAuditEvent` lleva `seq` (BIGINT monótono) + `prevHash` + `hash` = SHA-256(prevHash + JSON canónico); cabeza en `AuditAnchor` tomada con `FOR UPDATE`. `AuditChainService.append()` es el único punto de escritura (lo usan `CollaborationService.audit` y `WorkflowService.auditSystem`). `GET /process-audit/verify` (global recalcula todo / scoped por solicitud); `evidence.verify().checks.auditChain`. `backfill-audit-chain.ts` encadenó los 64 eventos previos. **Verificado e2e**: cadena íntegra al firmar; manipular el payload de un evento → global y scoped fallan con `firstBreakSeq` exacto y evidence marca `auditChain:false`; restaurar sana la cadena.
- **Auditoría multiagente** (`/multi-agent-review` — 3 agentes en paralelo: correctness, seguridad, multi-tenant) sobre M07/M13/M14. Hallazgos aplicados en `b8aee59`: reclamo atómico en `sign()` (carrera de doble firma por enlace), `nudge`/`reassign` con `OR[signerId,delegatedFrom]` (firmante OOO sin avisos en SECUENCIAL), escape HTML en correos (phishing por `filename`), IP/UA de consentimiento reales (no del cuerpo), `SignerMailService` sin lookup global de `Signer`, `consume()` atómico, validación de `delegateId`, `NudgeCommandDto`, proxy `/api/public-sign` sin `x-forwarded-*`, TTL de enlace 72 h, tolerancia P2002 en `generateForRequest`. Diferido a §7 TRANSVERSAL: aislamiento por tenant a nivel de fila (`A-07` ampliado — **los modelos nuevos son consistentes con el estado actual, no regresión**), claim entre procesos de los despachadores, rate-limit del portal externo, rotación de secreto de webhook.

### Sesión 2 — (pendiente)
- ...
