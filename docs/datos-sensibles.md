# Datos sensibles en Prestige

Criterio para quien toque onboarding, almacenamiento o firma. No hace falta redescubrirlo.

La LFPDPPP vigente (publicada en el DOF el 20 de marzo de 2025, en vigor desde el 21 de marzo de 2025) trata como sensibles los datos que afectan la esfera más íntima de la persona o cuyo mal uso pueda discriminarla o ponerla en riesgo grave. Esos datos exigen consentimiento **expreso y por escrito** del titular: firma autógrafa, firma electrónica o cualquier mecanismo de autenticación. No basta el consentimiento tácito del aviso de privacidad.

## Qué es sensible aquí, y por qué

| Dato | Por qué es sensible | Dónde vive |
|---|---|---|
| Fotografía y prueba de vida | Biometría facial. Identifica a la persona y no se puede "cambiar" si se filtra. | Objeto cifrado en MinIO (`onboarding/selfie`). En base solo hay la referencia, el hash y el resultado del motor. |
| Frente y reverso de la INE | Credencial oficial: fotografía, CURP, domicilio y datos que la credencial trae. Es identificación y, por la fotografía, también biometría. | Objeto cifrado en MinIO (`onboarding/ine`). La base guarda hash, OCR y el resultado de la verificación, no la imagen. |
| CURP y el texto del OCR | Identifican a la persona y salen de la credencial. | Columnas del alta y el JSON de OCR. No van en listados públicos. |
| Llave maestra de almacenamiento (`STORAGE_MASTER_KEY`) | Abre todas las llaves de datos con las que se cifró cada objeto (AES-256-GCM). Quien la tiene lee INE, selfies y PDF. | Solo el entorno del BFF. 32 bytes en base64, generados con `bun run gen-keys`. Nunca en git. |
| Passphrase de los PKCS#12 (`PKI_PASSPHRASE`) y los `.p12` | Abren la llave privada con la que el firmante produce el PAdES. | `backend/bff/pki/` (gitignored) y la variable de entorno. `prestige-pki-dev` solo en la máquina local cuyos certificados ya se cifraron con esa frase. |
| Llave Ed25519 del manifiesto de evidencia | Firma el expediente que después se verifica. | `backend/bff/pki/manifest-signing.key.pem`, creada por `bun run pki:init`. |
| Secreto del worker (`WORKER_SHARED_SECRET`) | Autentica el canal Temporal → BFF. No es un dato de la persona, pero abre operaciones que sellan evidencia y expiran solicitudes. | Entorno del BFF y del worker. También sale de `bun run gen-keys`. |
| Secreto de la cookie de sesión (`SESSION_SECRET`) | Firma la sesión del portal. Con él se puede fabricar una sesión. | Solo `frontend/web/.env.local`. El `.env.example` lleva un placeholder. |

`bun run gen-keys` imprime `STORAGE_MASTER_KEY`, `WORKER_SHARED_SECRET` y `SESSION_SECRET`. No escribe archivos. `bun run pki:init` crea la CA y la llave del manifiesto si no existen; no rota una passphrase que ya cifró PKCS#12.

`bun run audit:env` vuelve a hacer esta revisión sin imprimir valores.

## Consentimiento antes de capturar

El alta no guarda INE ni abre la cámara hasta que el titular acepta el texto versionado (`BIOMETRIC_CONSENT_VERSION`). La casilla nace desmarcada. El expediente conserva la fecha, la versión, el hash del texto, la IP, el agente de usuario y quién lo registró. El mismo texto queda en la auditoría del alta. Sin esa constancia, el BFF rechaza la captura, la verificación y la habilitación de firma.

## Qué no se hace con esto

- No se sube la imagen al navegador como base64 persistido.
- No se listan las referencias de storage ni el sobre de cifrado en el listado de altas.
- Un alta de otro tenant no se lee ni se modifica: el identificador solo vale dentro del tenant del token.
- El bucket `prestige-docs` queda con versionado y Object Lock en modo GOVERNANCE por 30 días. GOVERNANCE se puede levantar con permiso de bypass; COMPLIANCE no, y por eso no es el modo de este entorno.
- `bun run backup:local` copia Postgres y el bucket a `backups/local/`. Es la misma máquina si no se cambia `BACKUP_DIR`. No sustituye una copia en otro sitio.

## Superficie sin JWT de Keycloak

Estas rutas son públicas a propósito. El resto exige el access token.

| Ruta | Por qué está abierta | Qué la autoriza |
|---|---|---|
| `GET /health` | Sonda del proceso. | No devuelve datos de personas. |
| `GET /evidence/:id/verify` | Cualquiera con el expediente puede comprobar la firma. | Recalcula; no entrega el documento. |
| `GET /signature-requests/consent` | El titular lee el texto antes de aceptar. | Solo el texto y su versión. |
| `GET /signature-requests/capabilities` | El portal sabe qué métodos de firma están configurados. | Sí/no y un motivo. Sin llaves ni secretos. |
| `GET/POST /public/links/:token` | El firmante externo no tiene cuenta en Keycloak. | Enlace de un solo uso (32 bytes, solo el hash en base, con caducidad). La firma lo consume. |
| `POST /internal/workflows/*` | El worker de Temporal no es un usuario. | `@Public()` solo salta Keycloak. `WorkerGuard` exige el HMAC del minuto. |
