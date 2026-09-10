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
- [~] Autorización por recurso — roles sí; el scoping fino (firmante solo ve lo suyo en `GET /signature-requests`) queda pendiente (`A-07`)
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

**Fase A — Ceremonia de firma a pantalla completa (TP-16)**
- [ ] Flujo guiado documento → consentimiento → método → firma → acuse, fuera del `AppShell`, una acción por pantalla, barra de progreso
- [ ] Pantalla + PDF de acuse con QR al verificador, hash y sello de tiempo

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
- [ ] Auditoría inmutable encadenada para `ProcessAuditEvent` (M11)
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
- [ ] Auditoría inmutable encadenada para `ProcessAuditEvent` (M11)

### OLA 3 — Resto de módulos parciales

**M05 — Diseñador de procesos**
- [ ] Motor DMN real (`dmn-eval-js`) evaluando `dmnXml` + `decisionRules` (D6)
- [ ] Catálogo de actividades BPMN permitidas + validación al publicar
- [ ] Resolver divergencia BPMN de diseño ↔ workflow TS en Temporal (generar workflow desde BPMN o mapeo versionado)

**M07 — Bandejas / SLA**
- [ ] Recordatorios (nudges 24/48/72 h) + escalamiento al superior sobre timers de Temporal
- [ ] Reasignación por ausencia; delegación y «fuera de oficina» (`delegatedTo` ya está en el modelo)
- [ ] Prioridades en la bandeja

**M13 — Notificaciones**
- [ ] `nodemailer` + plantillas MJML; **Mailpit** en compose (D7)
- [ ] Enlaces de un solo uso firmados con expiración (portal del firmante externo)
- [ ] `NotificationOutbox` con reintentos + DLQ
- [ ] SPF/DKIM/DMARC documentados para producción

**M14 — APIs / webhooks / eventos**
- [ ] OpenAPI completo (`@nestjs/swagger`) — validar contra `backend/contracts/openapi.yaml`
- [ ] Webhooks firmados (HMAC por suscriptor) + idempotencia + DLQ
- [ ] Eventos CloudEvents (`request.completed`, `evidence.sealed`, `onboarding.enabled`)
- [ ] SDK generado (TS/Python) + colección Postman

**M15 — Administración / observabilidad**
- [ ] Control plane: CRUD de tenants, políticas, usuarios, catálogos
- [ ] OpenTelemetry (HTTP + Express + Prisma) exportando OTLP (D8); colector opcional en compose
- [ ] Alertas SLO / presupuesto de error para el caso ancla y `WorkflowRun` en `LOCAL`/roto

**M16 — Onboarding / identidad**
- [ ] OCR/MRZ real de INE (`tesseract.js`) (D9)
- [ ] Puerto `IdentityVerifier` (vigencia INE/RENAPO) conmutable por env
- [ ] Face-match + liveness real (`@vladmandic/face-api`) como default; puerto `BiometricEngine` para el motor 3D de SeguriData
- [ ] INE/selfie fuera de Postgres (ya cubierto por Ola 1 de-base64)

**M01 / M02 / M03 / M12** — cerrados por Ola 1 (portal con login real, identidad+tenant, documentos en storage, custodia). Verificar cierre completo al final.

### TRANSVERSAL (continuo)

- [ ] CI (GitHub Actions): `lint · typecheck · test · build · e2e Playwright · prisma migrate check · escaneo deps/secretos`; bloquear merge si baja cobertura
- [ ] Escaneo SAST + dependencias + secretos + CVE de imágenes + SBOM
- [ ] Cobertura de pruebas por servicio + contract tests del `SignerAdapter` + tests de *tamper* de la cadena de evidencia
- [ ] Backup + PITR de la BD primaria + simulacros de restauración; pooling de conexiones (PgBouncer / límite Prisma)
- [ ] Gestión de secretos en runtime (vault/KMS) + rotación (llave de firma JWT, secretos de webhook, credenciales de cliente Keycloak)
- [ ] Feature flags / kill-switch para Fase E y para *dark launch* de HSM/TSA
- [ ] Manifiesto de despliegue de producción (compose de prod o k8s) + IaC + entorno de staging
- [ ] Endurecer Temporal para producción (retención de historia, autoescalado de workers, versionado de workflows con `patched()`)
- [ ] LFPDPPP: aviso de privacidad + derechos ARCO; DPA con proveedor biométrico y subprocesadores; retención/legal-hold en todos los almacenes
- [ ] Accesibilidad AA (foco, contraste sobre carbón, teclado en Kanban/⌘K, `aria-live`); i18n es-MX; textos legales versionados fuera del código
- [ ] Actualizar `docs/README.md` (aún dice `fakeSign()`) y documentos de julio para que no contradigan al código

### Detalle Fase A — `A-01`..`A-12` (del informe original)

- [x] `A-01` Login OIDC en el portal (Auth Code + PKCE) contra Keycloak realm `prestige`
- [x] `A-02` Sesión real (cookie httpOnly + refresh); eliminar `session-store` con `maria`
- [x] `A-03` `middleware.ts` protege rutas + página de sesión expirada
- [x] `A-04` Quitar `@Public()` ruta por ruta (dejar solo health, consent, verificador)
- [x] `A-05` `requestedBy`/`actorId`/`actorName` del token en todos los controllers
- [x] `A-06` `tenantId` del token; quitar literal `'seguridata'` (onboarding, cases body)
- [~] `A-07` Autorización por recurso — roles listos; scoping fino de GET /signature-requests pendiente
- [x] `A-08` Roles en el realm: `signer`, `sender`, `rh`, `auditor`, `admin`; guards por rol
- [x] `A-09` Guard real del canal interno worker→BFF (`/internal/*`); firmar token en `activities.ts`
- [x] `A-10` Handshake Socket.IO autenticado + tenant/documento; CORS del gateway unificado
- [ ] `A-11` Step-up auth para acciones sensibles
- [ ] `A-12` Enlaces de un solo uso con expiración para firmantes externos sin cuenta Keycloak

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
- **Fase A y Fase B: núcleos DONE y verificados e2e.** Pendientes acotados (ver checklist §7 OLA 2): firma `pending`/reconciliación (firma asíncrona), sello por evento, política de firma M10, auditoría inmutable encadenada, interop Adobe, y `A-07`/`A-11`/`A-12`.
- **Retomar en:** (1) cerrar los pendientes de Fase B de arriba; (2) **OLA 3** — M05 (motor DMN `dmn-eval-js`), M07 (recordatorios/escalamiento/delegación), M13 (correo real + Mailpit + enlaces de un uso), M14 (webhooks firmados + idempotencia + DLQ + OpenAPI), M15 (control plane + OTel), M16 (OCR `tesseract` + face-match `face-api`); (3) transversal: DTOs/excepciones/paginación restantes, Redis (D10), ceremonia a pantalla completa, CI.
- Verificación pendiente: login OIDC **completo en navegador** (el `curl` llega al redirect a Keycloak; falta rellenar el form y volver por `/api/auth/callback`). Playwright o manual.

### Sesión 2 — (pendiente)
- ...
