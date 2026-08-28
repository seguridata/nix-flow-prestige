# Prestige

Plataforma propia de firma electrónica, workflow y evidencia verificable de **SeguriData**. Sustituye a **Resolve**, el BPM actual (HD Soluciones): inseguro, con vulnerabilidades activas y el incidente CFE originado en ese mismo producto.

Prestige no es un rebrand ni una copia de Resolve. Se construye internamente y orquesta el caso ancla — un contrato corporativo firmado en secuencia o en paralelo — sobre **Temporal**, con expediente criptográfico verificable al final.

Identidad visual: [`branding.md`](./branding.md) + isotipo oficial en `frontend/web/public/brand/seguridata-logo.png`. Expediente de negocio: [`docs/`](./docs).

## Stack

| Capa                | Tecnología                        | Por qué                                                 |
| ------------------- | --------------------------------- | ------------------------------------------------------- |
| Frontend            | Next.js 16 + DM + Tailwind v4     | Marca SeguriData, glass discreto, Motion                |
| UI                  | Primitivas propias (shadcn/Radix) | Control total del brand; no MUI/Ant genérico            |
| Animación           | Motion (`motion/react`)           | Microinteracciones 150–220 ms, `prefers-reduced-motion` |
| Búsqueda            | cmdk                              | Paleta ⌘K                                               |
| Autógrafa           | signature_pad + pdf-lib           | Trazo real incrustado en el PDF                         |
| Backend             | NestJS 10                         | Dominios + Workflow Port                                |
| Motor BPM           | Tempomarral                       | Ejecución durable; sustituye Flowable                   |
| Object storage      | MinIO (S3)                        | Documentos fuera de Postgres                            |
| ORM / DB            | Prisma 6 + PostgreSQL             | Fuente de verdad de firma y evidencia                   |
| Caché / tiempo real | Redis + Socket.IO                 | Listo para escala                                       |
| Identidad           | Keycloak (`prestige`)             | OIDC real                                               |

## Cinco herramientas de alto impacto

1. **Temporal** — motor durable (señales de firma, timers de SLA, query de estado).
2. **MinIO** — object storage S3; URLs prefirmadas cuando el endpoint está arriba.
3. **pdf-lib** — sella la autógrafa sobre el PDF en el BFF.
4. **signature_pad** — captura del trazo en la ceremonia de firma.
5. **cmdk** — comando global para bandeja, envío, operación y Temporal UI.

## Tres features nuevas (completas)

1. **Cockpit de proceso** (`/operations`) — salud Postgres/MinIO/Temporal, adaptadores, lista de instancias.
2. **Ceremonia de firma** — consentimiento v1.1 + método + autógrafa incrustada + señal a Temporal.
3. **Bandeja + paleta de comandos** — shell de producto con logo oficial y navegación de operación.

Biometría: adaptador listo (`BIOMETRIC_PROVIDER_URL`, `BIOMETRIC_API_KEY`). Sin URL no llama a terceros.

## Imágenes de marca

| Archivo                                           | Origen                     | Uso                      |
| ------------------------------------------------- | -------------------------- | ------------------------ |
| `frontend/web/public/brand/seguridata-logo.png`   | Isotipo oficial SeguriData | Header, sidebar, favicon |
| `frontend/web/public/brand/favicon.png`           | Brand studio               | Icono de pestaña         |
| `frontend/web/public/brand/apple-touch-icon.png`  | Brand studio               | iOS                      |
| `frontend/web/public/brand/hero-texture.png`      | Brand studio               | Textura editorial        |
| `frontend/web/public/brand/brand-wash.png`        | Fondo corporativo claro    | Apoyo visual             |
| `frontend/web/public/brand/product-signature.png` | Producto firma             | Referencia de producto   |
| `frontend/web/public/brand/product-timestamp.png` | Producto TSA               | Referencia de producto   |
| `frontend/web/public/brand/empty-inbox.jpg`       | Empty state editorial      | Bandeja vacía            |
| `frontend/web/public/brand/evidence-seal.jpg`     | Sello de evidencia         | Visor M11                |

## Cómo levantarlo

Requiere **Bun ≥ 1.3** y **Docker Desktop** (Compose v2). Los comandos salen de la raíz del repo.

En PowerShell, `cp` y `cd` funcionan. Usa `curl.exe` (el alias `curl` es `Invoke-WebRequest`). Si `localhost` no responde, usa `127.0.0.1`.

Puertos que deben estar libres: `3000` (BFF), `3001` (app), `5432` (Postgres), `6379` (Redis), `7233` (Temporal), `8081` (Keycloak), `8088` (Temporal UI), `9000`/`9001` (MinIO).

### Un comando

Desde la raíz del repo:

```bash
bun run dev
```

Infra Docker (Postgres, Keycloak, Temporal, MinIO, Redis) + Prisma + frontend (`:3001`) + BFF y worker Temporal (`:3000`). Copia `.env` si faltan e instala dependencias.

`Ctrl+C` para front y BFF. La infra Docker sigue; `bun run down` la baja. Para rehacer el sandbox: `bun run dev -- --reset`.

App: http://127.0.0.1:3001 (sesión local `maria`). BFF: http://127.0.0.1:3000.

### Paso a paso (manual)

Cada paso se ejecuta desde la **raíz del repo** (la carpeta que contiene `backend/` y `frontend/`).

### 1. Variables de Compose

```bash
cp backend/.env.example backend/.env
```

Ese `.env` solo tiene usuario/clave de Postgres y MinIO. Si el archivo ya existe, no lo pises.

### 2. Infraestructura

```bash
docker compose --env-file backend/.env -f backend/docker-compose.yml up -d
```

Eso levanta el proyecto `prestige-sandbox`: Postgres, Keycloak, Temporal, Temporal UI, MinIO (+ init del bucket `prestige-docs`) y Redis. El BFF y el worker **no** van en Docker: corren en el host.

`Started` no significa listo. Postgres y Redis marcan `healthy` en segundos; Keycloak y Temporal tardan 15–40 s en la primera subida (Keycloak importa el realm `prestige`).

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Esperado: `prestige-sandbox-postgres-1` y `prestige-sandbox-redis-1` en `(healthy)`. `prestige-sandbox-minio-init-1` crea el bucket y **sale**; no debe quedar corriendo.

### 3. Comprobar que los servicios contestan

```bash
curl.exe -sI http://127.0.0.1:8081/realms/prestige/.well-known/openid-configuration
curl.exe -sI http://127.0.0.1:8088/
curl.exe -sI http://127.0.0.1:9000/minio/health/live
docker exec prestige-sandbox-redis-1 redis-cli ping
```

Keycloak, Temporal UI y MinIO deben devolver HTTP `200`. Redis debe responder `PONG`. Si Keycloak hace timeout, espera y reintenta: el contenedor ya está `Up` pero Quarkus sigue arrancando.

En bash/macOS sustituye `curl.exe` por `curl`.

### 4. Dependencias del monorepo

```bash
bun install
```

Instala workspaces `frontend/web` y `backend/bff` (Bun workspaces + Turbo).

### 5. Schema de Postgres (Prisma)

El schema vive en `backend/bff`. Prisma hay que correrlo **ahí**, no en `backend/`:

```bash
cd backend/bff
cp .env.example .env
bunx prisma migrate deploy
bunx prisma generate
cd ../..
```

`backend/bff/.env` apunta a `postgresql://prestige:prestige@127.0.0.1:5432/prestige`. Si el volumen de Postgres ya existía, `migrate deploy` puede decir `No pending migrations to apply`: está bien.

### 6. App + BFF + worker Temporal

Con la infra ya arriba, el mismo comando arranca el resto:

```bash
bun run dev
```

Turbo arranca en paralelo:

| Proceso         | Qué es                                 | Puerto   |
| --------------- | -------------------------------------- | -------- |
| `@prestige/web` | Next.js 16 (Turbopack)                 | **3001** |
| `@prestige/bff` | NestJS + worker Temporal (`tsx watch`) | **3000** |

En la consola del BFF debe aparecer `Prestige BFF escuchando en http://localhost:3000` y `Postgres conectado`. El worker loguea `Prestige Temporal worker en cola "prestige"` cuando Temporal ya acepta gRPC en `7233`; si aún no, reintenta solo.

Comprueba el BFF:

```bash
curl.exe -s http://127.0.0.1:3000/operations/health
```

`postgres` debe ser `true`.

### 7. Abrir el producto

| Servicio      | URL                              | Credenciales                                 |
| ------------- | -------------------------------- | -------------------------------------------- |
| App           | http://localhost:3001            | sesión local `maria` (aún no hay login OIDC) |
| BFF           | http://localhost:3000            | —                                            |
| Cockpit       | http://localhost:3001/operations | salud Postgres / MinIO / Temporal            |
| Temporal UI   | http://localhost:8088            | —                                            |
| MinIO consola | http://localhost:9001            | `prestige` / `prestige-minio`                |
| Keycloak      | http://localhost:8081            | `admin` / `admin` (realm `prestige`)         |
| Redis         | `127.0.0.1:6379`                 | sin clave                                    |

La app llama al BFF en `http://localhost:3000` (`NEXT_PUBLIC_API_URL` si hace falta otra URL).

### Parar

- App y BFF: `Ctrl+C` en la terminal de `bun run dev`.
- Infra: `bun run down`. Equivale a `docker compose --env-file backend/.env -f backend/docker-compose.yml down`. Los datos de Postgres y MinIO quedan en volúmenes (`pgdata`, `miniodata`). Para borrar datos: `bun run down -- --volumes`.

### Si algo falla

| Síntoma                                | Qué hacer                                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose` no existe             | Docker Desktop con Compose v2. El comando es `docker compose` (espacio). Desde la raíz usa `--env-file backend/.env -f backend/docker-compose.yml`. |
| Keycloak timeout a `localhost`         | En Windows prueba `127.0.0.1:8081`. Si sigue, espera: el log debe decir `Listening on: http://0.0.0.0:8080`.                                        |
| Prisma: `Could not find Prisma Schema` | Estás fuera de `backend/bff`. `cd` ahí y vuelve a `bunx prisma migrate deploy`.                                                                     |
| `No se pudo conectar a Postgres`       | `docker ps`: postgres `healthy`, y `DATABASE_URL` en `backend/bff/.env`.                                                                            |
| App en 3000 o BFF no arranca           | El BFF usa 3000 y la app 3001. Cierra otro proceso en esos puertos.                                                                                 |
| Worker no conecta a Temporal           | Normal los primeros segundos. El worker reintenta cada 3 s.                                                                                         |
| MinIO init “exited”                    | Esperado. Creó `prestige-docs` y terminó.                                                                                                           |

Solo van en `.env` las URLs y secretos de conexión (ver `backend/bff/.env.example`). No commitees `.env`.

## Qué es real

- Persistencia Postgres, guard JWT Keycloak, WebSocket, orden secuencial, evidencia SHA-256 verificable, campos sobre PDF, Temporal (con fallback local si el motor aún no responde), MinIO opcional, consentimiento persistido, autógrafa sellada.

Pendiente explícito: login OIDC en el cliente, HSM/PKI de producción, proveedor biométrico de pago, constancia NOM-151.
