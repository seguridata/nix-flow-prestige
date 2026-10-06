# Retomar el repo

Foto del 2026-10-05. El detalle está en `PROGRESO.md`.

## Dónde quedamos

- P1 cerrado el 2026-09-26. DoD 11/11. Último commit de sprint: `27719e1`. El paquete se versionó en `3c98372`.
- `fix/p1-hardening` tiene el hardening `4726f71` … `fe45256`, el seguimiento en `663d5f5` y la UI de plantillas en `4981fd2`. `develop` toma esta rama desde `3c98372`.
- No reescribas ese seguimiento ni la UI. Ya están en esos commits.

## Cerrado en `663d5f5`

- `allowed-methods.ts` (BFF y frontend): tras un `DIGITAL`, `AUTOGRAFA` sale de `allowedMethodsNow` y `sign()` responde `409 METHOD_NOT_ALLOWED_AFTER_SIGNATURE`. Alta secuencial mixta avisa `VISUAL_AFTER_DIGITAL_ORDER`.
- `GET /evidence/by-request/:id` → 404 si no hay evidencia o es de otro tenant. El cliente trata ese 404 como `null`.
- `POST /webauthn/authenticate/begin` → `409 REQUEST_NOT_OPEN` si la solicitud del tenant ya no está abierta.
- `WorkflowReconcilerService`: cada minuto, advisory lock, un reintento como máximo.
- `bun run bootstrap:tenant` y `bun run backfill:tenant-ids` (este solo toca filas NULL; lo ambiguo se queda NULL; las membresías aportan `tenant.slug`).
- Init de MinIO: `retention set --default GOVERNANCE 30d` siempre. Un bucket viejo sin lock hace fallar el init.
- Guía de un entorno con datos: `backend/infra/README-despliegue-tenants.md`. Orden: migración, claim `tenant` en Keycloak, `bootstrap:tenant`, `backfill:tenant-ids`. El sandbox local ya lo corrió; el conteo está en `PROGRESO.md`.

## Qué no reabrir

- `DIGITAL` ya es PAdES con CA interna. No hay HMAC ni `ALLOW_DEV_HMAC` que implementar.
- No crees `src/idv/`, `IdvSession` ni un webhook de vendor. No hay contrato. El gate `kycPolicy` no se toca.
- La UI de plantillas ya está (`4981fd2`): elegir en el wizard y crear en `/plantillas`. No hay edición ni borrado. No persistas `templateId`: el backend lo aplica al crear y lo descarta.
- `TenantMembership.tenantId` es el uuid. El aislamiento compara el slug.
- El custodio PKCS#11 está en `09e6ac3` (`P2-KMS.md`). Este sandbox sigue en software. OCSP/CRL y NOM-151 siguen abiertos.

## Arranque local

Docker corre en WSL Ubuntu, no en Docker Desktop. Desde PowerShell:

```powershell
wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Users/Dave/Documents/Develop/Projects/SeguriLab/Nix-flow-prestige && bun run dev'
```

`bun run dev` levanta el compose `prestige-sandbox` (`backend/docker-compose.yml`), aplica migraciones, siembra el demo y arranca web `:3001`, BFF `:3000` y el worker. El portal habla con el BFF por `127.0.0.1`, no por `localhost`.

Realm Keycloak `prestige` en `:8081`. Firmante demo `maria` / `maria123`, tenant `seguridata`. Quien envía y administra plantillas en el demo es `roberto` (sender y admin). El portal se abre en `localhost:3001`: el issuer del realm es `localhost`, no `127.0.0.1`.
