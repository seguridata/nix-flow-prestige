> **Fuente de la verdad (17 oct 2026):** la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa) manda sobre estado, pendientes y decisiones. El [espejo en el repo](../../MasterPlan/ESTADO-Y-PENDIENTES.md) lo replica.

# Despliegue de Prestige en un servidor Docker pequeño

Pensado para un servidor de 3-4 GB de RAM que **ya aloja otros sistemas** detrás de un Caddy compartido. Prestige **no trae Caddy propio**: sus contenedores se unen a la red externa `proxy_net` y sus bloques se agregan al Caddy existente. Reparte Prestige para que quepa:

| Pieza | Dónde | Por qué |
|---|---|---|
| Web (Next.js) | **Vercel** (proyecto `prestige-web`, raíz `frontend/web`) | No consume RAM del servidor |
| Base de Prestige y documentos | **Supabase** (Postgres y Storage con protocolo S3) | Administrado; el bucket `prestige-docs` es privado |
| Sesiones de la web | **Upstash Redis** | Vercel no alcanza un Redis local |
| BFF, worker, Keycloak, Temporal, Postgres de Keycloak/Temporal y Redis del BFF | **Este compose** | Procesos permanentes que no caben en Vercel |

Estimación de memoria de este compose: ~1.6 GB (BFF 0.5, Keycloak 0.6, worker 0.25, Temporal 0.15, Postgres 0.13, Redis). Los `mem_limit` protegen a los demás sistemas del servidor. Son estimaciones, sin prueba de carga.

## Archivos

| Archivo | Para qué |
|---|---|
| `docker-compose.yml` | Los seis servicios, contenedores `prestige-*`. El BFF y Keycloak se unen a la red externa `proxy_net` (cambiable con `PROXY_NETWORK`). |
| `.env.server.example` | Plantilla de variables con leyenda (qué se genera, qué aporta el usuario, qué es opcional). El archivo real (`prestige.env`) vive solo en el servidor y está en `.gitignore`. |
| `Caddyfile.prestige` | Bloques a agregar al Caddy compartido (dominios por confirmar): `api-prestige` → BFF y `prestige-auth` → Keycloak. La consola de administración de Keycloak no se publica. |
| `create-multiple-dbs.sh` | Se copia de `backend/infra/`; crea las bases `keycloak`, `temporal` y `temporal_visibility`. |

## Pasos (en este orden)

0. **Red compartida**: debe existir `proxy_net` y el Caddy del servidor estar unido a ella. Si no existe: `docker network create proxy_net`.
1. **Imágenes** (se construyen fuera del servidor, porque compilar Next y Nest en 3.8 GB es el pico más peligroso) y se suben sin registro:
   ```bash
   docker build -f backend/bff/Dockerfile -t prestige-bff:prod .
   docker build -f deploy/keycloak/Dockerfile -t prestige-keycloak:26.0 .
   docker save prestige-bff:prod prestige-keycloak:26.0 | gzip | ssh servidor 'gunzip | docker load'
   ```
2. **`prestige.env` en el servidor**, a partir de `.env.server.example`, con `chmod 600`. Los secretos se generan allí y no pasan por el repo: `POSTGRES_PASSWORD` con `openssl rand -hex 24`, `KC_BOOTSTRAP_ADMIN_PASSWORD` con `openssl rand -base64 24`, y `STORAGE_MASTER_KEY`, `WORKER_SHARED_SECRET` y `PKI_PASSPHRASE` con `openssl rand -base64 32`. Verifica que `DATABASE_URL` apunte a la base correcta de Supabase (paso 5 aplica migraciones sobre ella).
3. **Realm de Keycloak**: genéralo con el dominio final de la web y cópialo junto al compose:
   ```bash
   node deploy/keycloak/make-prod-realm.mjs https://<web>
   scp deploy/keycloak/prestige-realm.prod.json servidor:~/prestige/deploy/server/prestige-realm.prod.json
   ```
   (el archivo copiado está en `.gitignore`; la ruta se cambia con `KEYCLOAK_REALM_FILE`).
4. **PKI** (una sola vez): genera la CA interna y la llave del manifiesto en el volumen `pki`, con el código del propio BFF:
   ```bash
   docker compose --env-file prestige.env run --rm --no-deps -e RUN_MIGRATIONS=false bff node -e "
     require('./dist/src/signing/pki/ca').ensureCaChain('./pki/ca');
     const { generateKeyPairSync } = require('crypto'); const fs = require('fs');
     const k = generateKeyPairSync('ed25519');
     fs.writeFileSync('./pki/manifest-signing.key.pem', k.privateKey.export({type:'pkcs8',format:'pem'}), { mode: 0o600 });
     fs.writeFileSync('./pki/manifest-signing.pub.pem', k.publicKey.export({type:'spki',format:'pem'}));"
   ```
5. **Arrancar**: `docker compose --env-file prestige.env up -d`. El BFF corre `prisma migrate deploy` al iniciar, contra Supabase.
6. **Caddy**: agregar los bloques de `Caddyfile.prestige` al Caddyfile del Caddy compartido y recargar (`caddy reload`). Los dominios deben apuntar al servidor.
7. **Alta de usuarios desde onboarding**: el BFF crea la cuenta de quien se da de alta (usuario = inicial del nombre + primer apellido; si ya existe, inicial del segundo nombre + primer apellido, o inicial del nombre + segundo apellido). Necesita una cuenta de servicio con permisos mínimos de usuarios; se crea una vez con `ONBOARDING_DEFAULT_PASSWORD='<temporal>' ./provision-onboarding-admin.sh`, que escribe `KEYCLOAK_ADMIN_CLIENT_ID` y `KEYCLOAK_ADMIN_CLIENT_SECRET` en `prestige.env`; luego `docker compose --env-file prestige.env up -d bff worker`. La contraseña inicial es temporal (Keycloak obliga a cambiarla en el primer ingreso) y vive solo en `prestige.env`. Sin esas variables el alta solo reserva el usuario.
8. **Usuarios de Keycloak** (consola no publicada): crearlos con `docker exec prestige-keycloak /opt/keycloak/bin/kcadm.sh`, con el atributo `tenant`, sus roles y una contraseña temporal que obligue a cambiarla.
9. **Web**: variables en Vercel (`KEYCLOAK_ISSUER`, `OIDC_*`, `BFF_URL`, `NEXT_PUBLIC_API_URL`, `SESSION_SECRET`, `REDIS_URL`) y despliegue desde `main`. Quitar la protección de Vercel del proyecto: el portal de firma externa tiene que ser público.

### Proxy compartido (copia de referencia)

`proxy/Caddyfile` y `proxy/docker-compose.yml` son copia de lo que corre en el servidor (`~/proxy`, 13 nov 2026), no parte del compose de Prestige. Destacan los **alias de red de Caddy** en `proxy_net` para los dominios públicos: el servidor no tiene hairpin NAT y sin ellos el BFF no alcanzaría `prestige-auth.seguridata.com` (el emisor OIDC) desde dentro de Docker. Si se agrega un dominio, hay que agregarlo también como alias.

### Advertencias

- **Sin SMTP real, los correos no llegan a nadie**: se quedan en Mailpit (enlaces de firma incluidos).
- **Supabase Storage no tiene Object Lock**: se pierde el candado de 30 días de MinIO.
- **El realm y `KEYCLOAK_ISSUER` deben coincidir con el dominio final de la web.** Si la web cambia de dominio, hay que regenerar el realm y reimportarlo.

## Verificación

- `https://api-prestige.<dominio>/operations/health/ready` responde 200.
- `https://prestige-auth.<dominio>/realms/prestige/.well-known/openid-configuration` responde 200 y `/admin/` responde 404 (en `Caddyfile.prestige`; en el servidor real se permite `/admin` y `/realms/master` solo desde la IP del dueño con `not remote_ip`).
- Inicio de sesión desde la web y una consulta autenticada al BFF.

## Límites conocidos

- Supabase Storage no ofrece Object Lock ni versionado: se pierde el candado GOVERNANCE de 30 días que configura el compose de MinIO.
- Temporal corre local con Postgres propio; Temporal Cloud cuesta desde ~$100 USD/mes y no se justifica con pocos usuarios.
- El BFF exige `SMTP_HOST` en producción. Mientras no haya un relay real, el compose incluye **Mailpit**, que recibe los correos (enlaces de firma incluidos) y **no los entrega a nadie**; su interfaz no está publicada. Para enviar correo de verdad hay que definir `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y `SMTP_PASS` en `prestige.env` y retirar ese servicio.
- Keycloak 26 ignora los atributos que no están declarados en su perfil de usuario: el atributo `tenant` se declara en el perfil con permisos de vista y edición solo para administradores (un usuario no puede cambiarse de empresa).
- Orden de comandos: `docker compose run -T` y `docker exec -i` leen la entrada estándar; dentro de scripts o bucles hay que redirigirles `< /dev/null` o se comen las líneas siguientes.
- Sin swap en el servidor (requiere `sudo`): un pico de memoria fuera de los límites puede matar procesos.
