# Plan de ejecución — Fase A, Fase B y cierre de módulos parciales

> **Ver `HANDOFF-FASE-A-B.md`** para el requerimiento textual del usuario, las
> reglas, las decisiones de arquitectura (D1–D10), las skills a cargar y la
> bitácora entre sesiones. Este archivo es el plan operativo resumido.

Rama: `feat/fase-a-b-produccion`. Commits por incremento verificable. Nada emulado:
cada adaptador a un servicio de confianza de SeguriData (HSM, TSA, INE/RENAPO,
biometría 3D) se implementa con un **default real** (cripto/OCR/OSS real) y se
cambia por `env` cuando esos endpoints estén disponibles.

Entorno: Docker corre en **WSL/Ubuntu**. Levantar todo con
`wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/Dave/Documents/Develop/Projects/SeguriLab/Nix-flow-prestige && bun run dev"`.

## Estado

Leyenda: `[ ]` pendiente · `[~]` en curso · `[x]` hecho y verificado

### Ola 1 — Base real (sin dependencias externas)

- [x] Limpieza: quitar `.playwright-mcp/`, PNGs sueltos, artefactos de build del control de versiones; `.gitignore`
- [x] Quitar `DemoModule` y los botones «prueba para firmar» del portal
- [x] Endurecer `main.ts`: `helmet`, CORS por lista, `@nestjs/throttler`, `ValidationPipe` global, `compression`, `enableShutdownHooks`, logger `pino`
- [ ] DTOs reales con `class-validator` en todos los controllers
- [ ] Paginación por cursor en todos los listados; acotar los `list()` sin `take`
- [ ] Redis real: cliente + adaptador Socket.IO-Redis + caché de lecturas calientes
- [ ] **Storage:** `Document.contentBase64` → objeto en MinIO (`objectKey` + `hash`), presigned GET/PUT, subida multipart en el portal; migración Prisma + backfill
- [ ] **Storage:** INE/selfie de `OnboardingCase` → MinIO con SSE; columnas base64 fuera
- [ ] Bajar límite de body a 2 MB
- [ ] **Fase A — Backend:** quitar `@Public()` salvo `/health`, `/consent`, `/verify`; `CurrentUser` en todos los controllers; `tenantId` y actor desde el token
- [ ] **Fase A — Backend:** `@Roles()` guard; roles `signer`, `sender`, `rh`, `auditor`, `admin` en el realm
- [ ] **Fase A — Backend:** guard de canal interno worker→BFF (token firmado); handshake de Socket.IO autenticado
- [ ] **Fase A — Frontend:** OIDC real (`openid-client`, Authorization Code + PKCE) contra `prestige-web`; cookie httpOnly; middleware; `api-client` manda `Bearer`; fuera `session-store` con `maria`
- [ ] **Fase A — Frontend:** ceremonia de firma a pantalla completa

### Ola 2 — Fase B (firma criptográfica real, M09/M10)

- [ ] `KeyCustodian` port: `SoftwareKeyCustodian` (PKCS#12 cifrado) por default; `Pkcs11KeyCustodian` para el HSM de SeguriData
- [ ] CA X.509 interna del proyecto (script `pki:init`), emisión de certificados de firmante
- [ ] Firma **PAdES** real sobre el PDF (`@signpdf/signpdf` + `pkijs`), validable en Adobe
- [ ] Validación de certificado: cadena, vigencia, OCSP/CRL (servicio reutilizable)
- [ ] Campo de firma visible por `SignatureField` para los tres métodos
- [ ] Cliente **RFC 3161** real: TSA self-hosted (`uts-server` en Docker) + fallback a TSA pública real
- [ ] Manifiesto de evidencia **firmado** (append-only) + verificador **offline** (paquete/CLI independiente)
- [ ] Sello de tiempo por evento `SIGNATURE_APPLIED`
- [ ] Política de firma versionada por caso (M10)
- [ ] Exportar expediente probatorio (ZIP)

### Ola 3 — Resto de módulos parciales

- [ ] **M05:** motor DMN real (`dmn-eval-js`) que evalúe `dmnXml` y `decisionRules`; catálogo de actividades BPMN; validación al publicar
- [ ] **M07:** recordatorios/escalamiento sobre timers de Temporal; delegación y «fuera de oficina»; prioridades
- [ ] **M13:** correo real (`nodemailer` + plantillas MJML), Mailpit en Docker para dev; enlaces de un solo uso con expiración; reintentos + DLQ
- [ ] **M14:** OpenAPI completo; webhooks firmados (HMAC) + idempotencia + DLQ; eventos CloudEvents; SDK generado
- [ ] **M15:** control plane (tenants, políticas, usuarios, catálogos); OpenTelemetry (HTTP + Prisma + Temporal); logs estructurados; dashboards
- [ ] **M16:** OCR/MRZ real de INE (`tesseract.js`); adaptador de vigencia INE/RENAPO (puerto); face-match/liveness real (`face-api`) como default; puerto para el motor 3D de SeguriData
- [ ] **M11:** auditoría inmutable encadenada para `ProcessAuditEvent`

### Transversal continuo

- [ ] CI (GitHub Actions): lint · typecheck · test · build · e2e · `prisma migrate` · escaneo deps/secretos
- [ ] Cobertura de pruebas por servicio + contract tests del `SignerAdapter` + tests de tamper de la cadena de evidencia
- [ ] Backup/PITR de la BD primaria; pooling de conexiones
- [ ] Gestión de secretos y rotación
- [ ] Manifiesto de despliegue de producción

## Requiere endpoints/credenciales de SeguriData para pasar de «real OSS» a «producción SeguriData»

| Servicio | Default real que queda operando | Variable para conmutar |
|---|---|---|
| HSM / PKI | CA interna + PKCS#12 cifrado (`SoftwareKeyCustodian`) | `KEY_CUSTODIAN=pkcs11`, `PKCS11_*` |
| TSA RFC 3161 | `uts-server` self-hosted + TSA pública | `TSA_URL` |
| INE / RENAPO | OCR local + verificación manual de RH | `INE_VERIFY_URL`, `RENAPO_URL` |
| Biometría | `face-api` (match + liveness) | `BIOMETRIC_PROVIDER_URL`, `BIOMETRIC_API_KEY` |
| Correo (M13) | Mailpit (dev) | `SMTP_URL` |
