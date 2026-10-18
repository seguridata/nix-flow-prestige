# Requerimiento original y decisiones de arquitectura (Fases A/B)

> Extraído el 17 oct 2026 del antiguo `HANDOFF-FASE-A-B.md`, que se eliminó porque su checklist, estado y bitácora quedaron desfasados. Aquí se conserva solo lo que sigue vigente: lo que pidió el dueño tal cual y las decisiones de arquitectura que **no se re-litigan**. El estado y los pendientes viven en Notion y en [`ESTADO-Y-PENDIENTES.md`](ESTADO-Y-PENDIENTES.md).

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

## 6. Decisiones de arquitectura ya tomadas — NO re-litigar

| # | Decisión | Motivo |
|---|---|---|
| D1 | **Fase B — firma criptográfica real por software.** `KeyCustodian` port: `SoftwareKeyCustodian` (PKCS#12 cifrado con `STORAGE_MASTER_KEY`/KMS) por default; `Pkcs11KeyCustodian` para el HSM de SeguriData. CA X.509 interna del proyecto (`bun run pki:init`). Firma **PAdES** real sobre el PDF con `@signpdf/signpdf` + `pkijs`/`node-forge`, validable en Adobe. **Sello RFC 3161 real:** TSA self-hosted `uts-server` en Docker + fallback a TSA pública real (freeTSA.org / DigiCert). | La firma es criptográficamente real (PKCS#7 con cadena de confianza real). No hay HSM físico en el repo; el puerto permite conmutar sin tocar el dominio. |
| D2 | **Storage con cifrado en reposo a nivel app.** AES-256-GCM *envelope*: llave de datos por objeto envuelta por `STORAGE_MASTER_KEY` (base64 32 bytes; conmutar a KMS por env). El BFF **descifra y sirve** el binario por HTTP autenticado (`Content-Type: application/pdf`). Presigned URLs quedan para cuando se use SSE nativo del storage. MinIO pasa a **obligatorio** (sin fallback a base64). | «Cifrado en reposo» real sin depender de KMS de MinIO. Servir descifrado por el BFF evita exponer ciphertext al navegador. |
| D3 | **Identidad Fase A.** OIDC **Authorization Code + PKCE** con el cliente público `prestige-web` (ya en el realm). Sesión en **cookie httpOnly** firmada/cifrada (usar `iron-session` o JWT propio con `jose`). El `api-client` del portal manda `Authorization: Bearer <access_token>`. Se elimina `store/session-store.ts` (usuario `maria` hardcodeado). | El realm ya trae el cliente correcto; PKCE es el flujo recomendado para SPA/BFF. |
| D4 | **Canal interno worker→BFF.** Token firmado (HMAC con `WORKER_SHARED_SECRET`) en header `X-Prestige-Worker-Token`, verificado por un guard dedicado sobre `/internal/*`. El header `x-prestige-worker: 1` actual **no se valida** hoy — hay que reemplazarlo. | Cierra un canal hoy 100% abierto (`@Public()` sin comprobación). |
| D5 | **WebSocket autenticado.** El handshake de Socket.IO valida el `access_token` (query/auth), resuelve `tenantId` y verifica pertenencia al documento antes de `join`. Config CORS del gateway unificada con `CORS_ORIGINS` (hoy fija a `http://localhost:3001`, aparte de `main.ts`). | El gateway hoy no autentica ni filtra por tenant. |
| D6 | **Motor de reglas (M05).** Integrar `dmn-eval-js` (Red Hat, OSS real) para evaluar `dmnXml` **y** el `decisionRules` guardado en `ProcessDefinition`. `decide()` deja de usar la constante compilada. | Hoy `decide()` ignora ambos; `dmn-js` es solo editor. |
| D7 | **Notificaciones (M13).** `nodemailer` + plantillas MJML; **Mailpit** en `docker-compose` para dev (SMTP real capturado). Enlaces de un solo uso firmados con expiración. Reintentos + DLQ (tabla `NotificationOutbox`). | Correo real, sin depender de un SMTP externo para dev. |
| D8 | **Observabilidad (M15).** OpenTelemetry (`@opentelemetry/sdk-node` + instrumentaciones HTTP/Express/Prisma) exportando OTLP; apagado por defecto. El collector del sandbox se retiró el 17 oct 2026 (sin tráfico ni destino de almacenamiento); se reintroduce al elegir backend en staging. Logs `pino` ya integrados. | Estándar OSS, sin lock-in. |
| D9 | **Biometría / INE (M16).** OCR/MRZ real con `tesseract.js`; face-match + liveness con `@vladmandic/face-api` como default; puertos `IdentityVerifier` (INE/RENAPO) y `BiometricEngine` (motor 3D de SeguriData) conmutables por env. | Cumple «real» sin la API oficial; el puerto la integra después. |
| D10 | **Redis real.** Cliente `ioredis`; `@socket.io/redis-adapter` para presencia entre réplicas; caché de lecturas calientes (consentimiento, `capabilities`, process-defs, health). | Hoy Redis está en compose pero el BFF no lo usa; presencia en memoria de proceso. |

Las demás decisiones posteriores (tablas de consulta, formatos y anexos, MCP, Process Studio, paginación) están en `ADR-008-TABLAS-DE-CONSULTA-Y-ADJUNTOS.md`, `MCP-OAUTH.md`, `PROCESS-STUDIO.md` y `PAGINACION-BANDEJA.md`.
