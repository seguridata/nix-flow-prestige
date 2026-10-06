# Despliegue sobre una instalación existente: tenants, Keycloak y auditoría

Guía operativa para actualizar un entorno que ya tiene datos (BD de Prestige y
volumen de Keycloak) al código con el endurecimiento P1. Todo lo que se cita
existe en el repositorio; las rutas son relativas a `backend/`.

Orden recomendado:

1. Aplicar migraciones (`bff/prisma/migrations`, `bunx prisma migrate deploy`).
2. Actualizar Keycloak (realm: rol `platform_admin` y claim `tenant`).
3. Sembrar el tenant y las membresías (`bootstrap:tenant`).
4. Configurar las variables nuevas del BFF y reiniciar BFF y worker.

## 1. Keycloak: reimportar el realm sobre un volumen existente

`docker-compose.yml` arranca Keycloak con `start-dev --import-realm` y monta
`infra/keycloak/prestige-realm.json` en `/opt/keycloak/data/import/`.
**`--import-realm` solo importa si el realm `prestige` no existe**: sobre un
volumen/BD de Keycloak existente se ignora y NO aplica los cambios del JSON.

### Qué cambió en `prestige-realm.json`

- Rol de realm nuevo `platform_admin` ("Operador de plataforma (control-plane
  multi-tenant). Solo SeguriData."). El usuario `roberto` del realm de demo lo
  trae asignado.
- Client `prestige-web`: mapper `tenant` (`oidc-usermodel-attribute-mapper`) que
  publica el atributo de usuario `tenant` como claim `tenant` (id token, access
  token y userinfo). Los usuarios de demo (`maria`, `carlos`, `roberto`) tienen
  el atributo `tenant = seguridata`.
- Client `prestige-web`: mapper `auth_time` (`oidc-usersessionmodel-note-mapper`,
  nota `AUTH_TIME`), necesario para `STEP_UP_ENFORCE`.

El BFF rechaza (401) todo token sin claim `tenant` (`JwtAuthGuard`), por lo que
**sin el mapper y el atributo nadie podrá entrar**.

### Opción A: entorno desechable (demo/dev) - recrear el volumen

```bash
docker compose down -v      # BORRA volúmenes: Postgres (todas las BDs) incluido
docker compose up -d
```

Esto destruye TODOS los datos (Keycloak, Prestige, Temporal). No usar con datos reales.

### Opción B: conservar los datos - cambios manuales en la consola de Keycloak

Consola: `http://localhost:8081` (en el compose de desarrollo, usuario
`KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD`), realm `prestige`.

1. **Rol `platform_admin`**: Realm roles > Create role > nombre `platform_admin`.
   Asignarlo solo a los operadores de plataforma (Users > usuario > Role mapping).
2. **Mapper de claim `tenant`**: Clients > `prestige-web` > Client scopes >
   `prestige-web-dedicated` > Add mapper > By configuration > *User Attribute*:
   - Name: `tenant`
   - User Attribute: `tenant`
   - Token Claim Name: `tenant`
   - Claim JSON Type: `String`
   - Add to ID token / Add to access token / Add to userinfo: activados
3. **Mapper `auth_time`** (solo si usarás `STEP_UP_ENFORCE=true`): mismo lugar,
   *User Session Note*: Name `auth_time`, User Session Note `AUTH_TIME`, Token
   Claim Name `auth_time`, Claim JSON Type `long`, ID token y access token activados.
4. **Usuario existente sin claim `tenant`**: Users > usuario > pestaña
   *Attributes* > Add attribute: clave `tenant`, valor = el **slug** del tenant
   (p. ej. `seguridata`) > Save. Con "Unmanaged attributes" desactivado en el
   realm (Realm settings > General), actívalo o declara el atributo en User
   profile, de lo contrario la pestaña Attributes no aparece. Hacer logout/login
   para que el token nuevo traiga el claim.
5. Si el cliente web usa otro `clientId`, añade los mapper a ese client.

Alternativa para quien prefiera partir del JSON: borrar el realm `prestige` en
la consola y reiniciar Keycloak con `--import-realm` (se pierden usuarios,
sesiones y credenciales del realm; solo aceptable si se re-crean a mano), o
usar la importación con sobrescritura de la CLI de Keycloak (`kc.sh import
--file ... --override true`), que también sobrescribe usuarios del realm.
Verifícalo primero en un entorno de prueba.

El valor del claim `tenant` debe ser el **slug** de un `Tenant` (ver sección 2):
es lo que se compara con `Tenant.slug` y lo que ya guardan `Case`, `Document` y
`SignatureRequest` en `tenantId` (por defecto `seguridata`).

## 2. Bootstrap del tenant (`bootstrap:tenant`)

`TenantContextGuard` es fail-closed: si el usuario no tiene ninguna fila activa
en `TenantMembership` recibe 403 "Usuario sin membresía de tenant". Una BD
heredada no tiene filas, así que hay que sembrar al menos el tenant y un
administrador. La membresía se busca por `userId` = `preferred_username` (o
`sub`) del token.

```bash
cd bff
# 1) Simulación: no escribe nada
bun run bootstrap:tenant -- --tenant seguridata --user-id roberto \
  --roles admin,sender,platform_admin --name "Roberto Díaz" --email roberto@seguridata.mx --dry-run
# 2) Aplicar
bun run bootstrap:tenant -- --tenant seguridata --user-id roberto \
  --roles admin,sender,platform_admin --name "Roberto Díaz" --email roberto@seguridata.mx
```

Equivalente directo: `bun run prisma/scripts/bootstrap-tenant.ts ...`.
Argumentos: `--tenant` (slug, obligatorio), `--user-id` (obligatorio), `--roles`
(por defecto `admin,sender,signer`; válidos: `signer, sender, rh, auditor, admin,
platform_admin`), `--name`, `--email`, `--tenant-name`, `--dry-run`, `--help`.
También por entorno: `BOOTSTRAP_TENANT`, `BOOTSTRAP_USER_ID`, `BOOTSTRAP_ROLES`,
`BOOTSTRAP_NAME`, `BOOTSTRAP_EMAIL`, `BOOTSTRAP_TENANT_NAME`. Usa `DATABASE_URL`.

Es idempotente (upsert de `Tenant` por `slug` y de `TenantMembership` por
`(tenantId, userId)`). Si el tenant ya existe no cambia su nombre ni `active`;
la membresía actualiza roles/nombre/correo y la reactiva. Los roles que cuentan
para autorización de las rutas son los del **token** (`realm_access.roles`); los
de la membresía son el directorio del tenant. Los demás usuarios se pueden dar
de alta después por el control-plane (`PUT /admin/tenants/<slug>/members`) con
ese primer administrador.

## 3. Variables de entorno nuevas / relevantes (BFF)

| Variable | Efecto | Producción |
|---|---|---|
| `KEYCLOAK_AUDIENCE` | Si se define, el token debe traerla en `aud` o `azp` (p. ej. `prestige-web`). Vacía = no se valida. | Recomendado definirla |
| `ALLOW_UNMAPPED_TENANT` | `true` permite usuarios sin `TenantMembership` aceptando el claim `tenant`. Ignorada si `NODE_ENV=production`. | **Solo desarrollo**; dejar `false` |
| `WEBHOOK_ALLOW_PRIVATE` | `true` permite destinos de webhook en redes privadas/loopback (guarda SSRF). Ignorada en producción. | **Solo desarrollo** |
| `WEBHOOK_SECRET_ROTATION_HOURS` | Horas que el secreto anterior de un webhook sigue firmando tras una rotación (por defecto 24). | Ajustar al tiempo que tarden los receptores en actualizar |
| `STEP_UP_ENFORCE` | `true` exige re-autenticación reciente en rutas `@StepUp()` (firma, habilitar identidad); sin claim `auth_time` responde 403 `step_up_required`. Con `false` solo se registra un aviso. | `true` (requiere el mapper `auth_time`) |

Para el worker de Temporal siguen siendo obligatorios `TEMPORAL_ADDRESS`,
`BFF_INTERNAL_URL` y `WORKER_SHARED_SECRET` (el mismo del BFF): un worker sin el
secreto deja los workflows en `Failed`. El BFF incluye un reconciliador
(`WorkflowReconciler`) que cada minuto marca `FALLIDO` los `WorkflowRun` en
`ACTIVO` cuyo workflow ya terminó mal en Temporal y reinicia una sola vez los de
solicitudes `EN_FIRMA` (marca `restarted:1` en `lastError`).

## 4. Inmutabilidad de `ProcessAuditEvent` (trigger)

La migración `20261005110000_p1_audit_immutability` crea la función
`prestige_audit_event_immutable()` y el trigger `"ProcessAuditEvent_immutable"`
(`BEFORE UPDATE OR DELETE ... FOR EACH ROW`). Bloquea todo UPDATE/DELETE de la
bitácora encadenada con `integrity_constraint_violation`. Única excepción: una
fila heredada **sin encadenar** (`seq` y `hash` NULL) puede actualizarse una vez,
lo que usa `bff/prisma/scripts/backfill-audit-chain.ts`
(`bun run backfill:audit-chain`) para encadenar eventos previos a M11.
`AuditAnchor` (cabeza de la cadena) no tiene trigger y sigue siendo editable.

**Cuándo desactivarlo (solo el DBA, en ventana de mantenimiento):** correcciones
de datos excepcionales que no puedan hacerse por la app, p. ej. rellenar
`tenantId` en eventos ya encadenados (el hash de la cadena no cubre `tenantId`,
así que no se rompe), o restaurar/migrar datos. Nunca para "limpiar" eventos.

```sql
-- ADVERTENCIA: mientras esté desactivado la bitácora deja de ser inmutable y
-- cualquier sesión puede alterarla. Hacerlo en UNA transacción corta, con
-- registro del cambio aprobado, y reactivar de inmediato.
BEGIN;
ALTER TABLE "ProcessAuditEvent" DISABLE TRIGGER "ProcessAuditEvent_immutable";
-- ... la corrección puntual y acotada (WHERE explícito) ...
ALTER TABLE "ProcessAuditEvent" ENABLE TRIGGER "ProcessAuditEvent_immutable";
COMMIT;
```

`DISABLE TRIGGER` requiere ser dueño de la tabla (o superusuario). Después,
verifica la cadena (endpoint `GET process-audit/verify` del BFF) y que el trigger quedó activo:
`SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'ProcessAuditEvent_immutable';`
(`tgenabled = 'O'` = activo).

## 5. Backfill de `tenantId`

Las migraciones ya rellenan `tenantId` en tablas hijas desde el padre:

- `20260911060000_a07_tenant_on_document_and_request`: `Document` (desde `Case`) y
  `SignatureRequest` (desde `Document`), con `DEFAULT 'seguridata'`.
- `20260926120000_p1_tenant_columns` y `20261005100000_p1_tenant_scoping`
  (columnas nullable + `UPDATE ... FROM` del padre) para `HumanTask`,
  `WorkflowRun`, `ProcessWatcher` (desde `SignatureRequest`), `SignatureField` y
  `DocumentComment` (desde `Document`), y `ProcessAuditEvent` (desde
  `SignatureRequest`, `Document` u `OnboardingCase`).

Quedan en NULL, por no tener padre del que derivar, `NotificationOutbox` y
`UserNotification`, además de cualquier fila de las anteriores cuyo padre no
exista. Las lecturas de `HumanTask`/`WorkflowRun` tienen como respaldo el
tenant de la solicitud (`tenantId: null, signatureRequest: { tenantId }`).
Comprobación tras migrar:

```sql
SELECT 'HumanTask' t, count(*) FROM "HumanTask" WHERE "tenantId" IS NULL
UNION ALL SELECT 'WorkflowRun', count(*) FROM "WorkflowRun" WHERE "tenantId" IS NULL
UNION ALL SELECT 'ProcessAuditEvent', count(*) FROM "ProcessAuditEvent" WHERE "tenantId" IS NULL
UNION ALL SELECT 'NotificationOutbox', count(*) FROM "NotificationOutbox" WHERE "tenantId" IS NULL
UNION ALL SELECT 'UserNotification', count(*) FROM "UserNotification" WHERE "tenantId" IS NULL;
```

Para un backfill repetido de filas nuevas (mismo `UPDATE ... FROM` de la
migración `20261005100000_p1_tenant_scoping`), ejecútalo tal cual: es idempotente
(`AND "tenantId" IS NULL`). **Para `ProcessAuditEvent` con filas ya encadenadas
el trigger de la sección 4 bloqueará el UPDATE**: usa el procedimiento del DBA de
esa sección. Si todo tu histórico es de un solo tenant, el valor a asignar es su
slug (p. ej. `seguridata`), el mismo que `Case`/`Document`/`SignatureRequest`.

## 6. Backfill de tenantId en outbox y notificaciones

`NotificationOutbox` y `UserNotification` no tienen padre. La migración las deja
en NULL. El script `backfill:tenant-ids` rellena solo esas filas, por lotes de
500, y es idempotente: una segunda pasada no reescribe lo ya asignado.

El valor que escribe es el **slug** del tenant (el claim `tenant` del token),
nunca el `id` uuid de la tabla `Tenant`. `TenantMembership.tenantId` es esa FK;
el script la traduce al slug y solo cuenta membresías activas. Si hay más de un
slug candidato, o ninguna pista, la fila sigue en NULL.

Reglas de `NotificationOutbox`, en este orden:

1. `dedupeKey` con prefijo `invite`, `reminder`, `escalation` o `completed` y
   segundo segmento igual al id de la solicitud → slug de esa `SignatureRequest`.
2. `payload.signatureRequestId` → slug de esa solicitud.
3. `toAddress` igual al correo de un firmante o de una membresía activa, solo si
   todos apuntan a un único slug.

Si las reglas 1 y 2 resuelven slugs distintos, la fila es ambigua y queda NULL.
La regla 3 no se usa cuando 1 o 2 ya resolvieron.

Reglas de `UserNotification`:

1. `href` `/documents/<id>` o `/onboarding/<id>` → slug del documento o del alta.
2. `userId` con membresía activa en un solo tenant → ese slug.

```bash
cd bff
bun run backfill:tenant-ids -- --dry-run
bun run backfill:tenant-ids
```

Cómo leer el resumen (sale en español, código de salida 0):

- Cada regla muestra cuántas filas **se asignarían** (`--dry-run`) o quedaron
  **asignadas**.
- **ambiguas**: siguen NULL. Hay varios slugs candidatos; hay que asignarlas a mano.
- **sin pistas**: siguen NULL. No hay solicitud, href ni membresía única de donde derivar.

La línea final cuenta cuántas filas permanecen en NULL entre las dos tablas.
