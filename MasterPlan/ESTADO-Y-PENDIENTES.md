# ESTADO Y PENDIENTES — retoma aquí

> **Léelo primero.** Es el documento de relevo entre sesiones: qué hay hoy, qué se decidió, qué falta y cómo seguir sin perder tiempo.
> Se actualiza con cada tanda de trabajo. **Última actualización: 2026-10-16**, contra `develop` en `d83c4a0` (más lo marcado «en curso»).
> La lista viva de pendientes también está en Notion (página «Prestige: pendientes tras multitenant, deploy y chatbot»); este archivo es la copia versionada.

## 1. Retomar en 5 minutos

1. Lee en este orden: este archivo → [ADR-008](ADR-008-TABLAS-DE-CONSULTA-Y-ADJUNTOS.md) → [ARQUITECTURA-MULTITENANT-Y-ESCALA.md](ARQUITECTURA-MULTITENANT-Y-ESCALA.md) → [AGENTS.md](AGENTS.md) (reglas duras).
2. Rama: **`develop`**, commits temáticos **directos, sin PRs** (instrucción del dueño, 2026-10-15). Un PR de `develop` a `main` solo cuando él lo pida y **nunca se fusiona sin avisarle**.
3. Verificar antes de dar algo por hecho (ver §5): `tsc` y `vitest` de backend y front, y una prueba con HTTP real. No te fíes solo del reporte de un agente.
4. Stack local: Docker corre **en WSL**; `bun run dev` se ejecuta en WSL sobre la ruta de Windows (nada se copia a WSL). Detalles y trampas en §5.
5. Trabajo pesado: agentes con **archivos disjuntos**; el esquema de Prisma y las migraciones los hace quien orquesta **antes** de lanzar a los agentes.

## 2. Qué existe hoy (en `develop`)

| Área | Estado | Dónde |
|---|---|---|
| IA con Grok (texto a flujo, revisión, PDF a formato), proveedor detrás de `LlmProvider`; la IA **propone y nunca publica** | Hecho, probado de punta a punta | `backend/bff/src/ai` |
| Chatbot interno que solo guarda borradores (flujo y formato) | Hecho; falta probarlo en vivo contra Grok y en el navegador | `backend/bff/src/chat`, `frontend/web/components/chat` |
| Aislamiento multitenant: `tenantId` NOT NULL en 7 tablas, `OutOfOffice` por tenant, índices, guarda de tenant | Hecho. **`UserNotification.tenantId` sigue nullable** (ver §4) | `backend/bff/prisma`, `src/prisma/tenant-guard.ts` |
| Guarda de tenant (ADR-004) | `enforce` por defecto en desarrollo y tests; **producción en `log`** hasta validar staging. Barrido estático como prueba de regresión | `src/prisma/tenant-guard*.ts`, `tenant-id-resolver.ts` |
| Cifrado con AAD de tenant, tenant validado en `getObject/deleteObject` | Hecho; falta backfill de claves antiguas y re-cifrado | `src/storage` |
| **Tablas de consulta** (solo admin): 14 operadores, filas ordenadas, import CSV/Excel, exportar, probar consulta, paginación y mover filas | Hecho y verificado | `src/lookup-tables`, `frontend/web/app/tablas-consulta` |
| Participante `lookup` y variables derivadas en el flujo; resultado congelado en `LOOKUP_RESOLVED` | Hecho | `src/flow`, `src/lookup-tables/flow-resolver.service.ts` |
| **Formatos digitales** (hoja base generada) y **anexos** (carga previa, validación por contenido real, cifrado, hash) | Hecho y verificado | `src/document-templates`, `src/attachments` |
| Métodos de firma del formato validados contra la política del tenant | Hecho | `src/document-templates/signature-methods.ts` |
| **Caso real «Solicitud de gastos (Adquisiciones)»** cargado de ejemplo (`bun run seed:example-gastos`, idempotente) | Hecho. Tabla `responsables-gasto` (53 filas) y `roles-adquisiciones` | `prisma/scripts/seed-example-gastos*.ts`, `src/process/adquisiciones.flows.ts` |
| Deploy: PKI desde Secret, Keycloak de producción, README de despliegue | Escrito; **nada aplicado a un clúster** | `deploy/`, `backend/docker-compose.prod.yml` |
| SDK TypeScript regenerado | Hecho | `backend/sdk/typescript/schema.d.ts` |

## 3. Decisiones tomadas

- **2026-10-15** — Sin PRs: commit directo a `develop`. El dueño delega las decisiones («lo mejor para el proyecto, sin que el esfuerzo pese»).
- **2026-10-16** — Las tablas de consulta son **solo para admin**; el usuario nunca las ve, solo ve «Se enviará a: …».
- **2026-10-16** — Guarda de tenant en `enforce` fuera de producción; producción en `log` hasta validar staging.
- **2026-10-16** — Anexos: lectura solo para el dueño del expediente y los participantes de sus solicitudes (ni un admin ajeno); no son firmables.
- **2026-10-16 (respuestas del dueño en Notion)**
  - `UserNotification` huérfanas: **borrar** las 11 y contraer la columna a `NOT NULL`.
  - MinIO: lo decide el equipo técnico → **usuario de servicio sin permisos de raíz y política limitada al bucket** (no usar las credenciales de raíz desde la app).
  - Temporal en producción: **Temporal Cloud** (o lo que resulte mejor); el de desarrollo no cambia.
  - Nuevo Director de DDN: **Alejandro Jiménez**, responsable de todo lo de Marketing y CRM.
  - Reembolsos de gastos de jefes de área: si el solicitante es **Olga García, Alejandro Díaz o Bernardo Calatayud** → autoriza **Javier Alarcón**; si es **Margarita Ramírez, Alejandro Jiménez o Jesús Vázquez** → autoriza **Alberto Yarza**.
  - Ejecutivo de Administración y Tesorería: **Jesús Vázquez** (editable desde la pantalla de tablas).
  - Usuarios reales de Keycloak: crear a los responsables de la matriz como administradores y a **`draygoza` (David Raygoza, Admin Master)**; borrar los ficticios (María, Roberto, Carlos). La contraseña la dio el dueño en Notion: **no se escribe en el repo, ni aquí, ni en commits** (cambiarla antes de cualquier uso fuera del sandbox local).

## 4. Pendientes

Convención: `[x]` hecho · `[ ]` pendiente · **(en curso)** lo está haciendo alguien ahora · **(dueño)** necesita un dato o decisión del dueño.

### En curso (tanda del 2026-10-16)
- [ ] **(en curso)** `UserNotification.tenantId` a `NOT NULL` (migración que borra las 11 huérfanas).
- [ ] **(en curso)** Cargar a Alejandro Jiménez como responsable de Marketing, CRM y «Aliados» y el ruteo de reembolsos de jefes de área (requiere la variable integrada `solicitante` en las consultas).
- [ ] **(en curso)** Provisionar usuarios reales en Keycloak y borrar los ficticios (script repetible; la contraseña llega por variable de entorno, nunca en un archivo).
- [ ] **(en curso)** MinIO sin root, soporte de Temporal Cloud, probar la imagen de Keycloak de producción y el compose de producción en local.

### Datos que faltan (dueño)
- [ ] **(dueño)** Rangos de monto: el PDF `SD-MATRIZ-APROBACION-GASTO`. El campo `monto` existe pero la tabla aún no decide por rangos.
- [ ] **(dueño)** Equivalencia de 6 áreas de Monday con la matriz: **VP Tecnología, Comercial, Seguridad-Infraestructura, Logalty, Seguridad 4B, Soporte** (explicación sencilla en Notion). Mientras no se defina, esos pasos le preguntan a quien llena el formato.
- [ ] **(dueño)** Tres conceptos sin responsable en el Excel: Seguros corporativos (Multimodal), Reparaciones, Licencias, software y actualización.
- [ ] **(dueño)** Aprobación de legal para enviar texto de documentos al proveedor de IA (ADR-006).

### Técnicos
- [ ] Activar `TENANT_GUARD=enforce` en producción tras validar un staging real.
- [ ] RLS en Postgres (`SET LOCAL app.tenant`, rol que omita RLS para ticks y worker), con interruptor y despliegue por etapas.
- [ ] Cifrado: backfill de claves S3 antiguas, re-cifrado con AAD, adaptar `prisma/scripts/backfill-storage.ts`, exigir AAD en modo estricto.
- [ ] Cuota de almacenamiento y de solicitudes por tenant (incluye anexos); `tenant.id` en spans y métricas.
- [ ] PgBouncer o `connection_limit` por réplica; cola de Temporal por tier y secreto de worker por entorno.
- [ ] Mover OCR, biometría y estampado de PDF a Temporal (hoy dentro de la petición, acotados por semáforo).
- [ ] CI que construya y escanee las imágenes. Aplicar `deploy/k8s` en un clúster real (`storageClassName` RWX, egress con CIDR reales, hosts, Secrets reales, Keycloak con más de una réplica).
- [ ] PKCS#11: módulo en la imagen, `graphene-pk11` y certificado de una CA reconocida.
- [ ] Branding por tenant (hoy fijo «SeguriData»); CA intermedia y `keyId` por tenant en la evidencia.
- [ ] Exportar y purgar tenants (ADR-007): **destructivo, solo con aprobación explícita del dueño**.
- [ ] Paginación y virtualización de los listados del front.

### Producto (ADR-008, siguientes fases)
- [ ] `businessRuleTask` de BPMN como consulta a tabla al convertir a flujo.
- [ ] Versionado con vigencia y aprobación de cambios de las tablas (configuración sensible).
- [ ] Fuentes externas sincronizadas (tablero de Monday, hoja de Google) y asistente que propone una tabla desde un Excel (la IA propone, una persona revisa).
- [ ] Pasar «Renovación de licenciamiento» y «Proveedores estratégicos» de `ask` a consulta de tabla.
- [ ] Pantalla para ver y descargar los anexos de un expediente ajeno, si el producto lo necesita.
- [ ] Chatbot: probar en vivo contra Grok y en el navegador; UI en Formatos que convierta los borradores de formato (hoy en Redis, 30 días) en formatos digitales; mostrar `GET /chat/drafts/templates` en el panel; spec de controller con la app real; siguiente fase: MCP de solo lectura.
- [ ] Calidad de la IA: conjunto de formatos reales para medir (en un PDF de vacaciones el modelo hizo condicional la firma del jefe en vez de crear el paso de RH).
- [ ] Probar la carga de anexos con clics reales en el navegador (la API se probó con HTTP real).
- [ ] Contrato OpenAPI escrito a mano (`backend/contracts/openapi.yaml`) y Postman: añadir las rutas nuevas.
- [ ] Llevar al repo las pruebas de punta a punta (hoy son scripts del scratchpad de una sesión) como pruebas ejecutables.

## 5. Reglas de trabajo y trampas conocidas

- **Archivos con CRLF**: `sed -i` los pasa a LF y el diff marca todo el archivo. Usa la herramienta de edición o un script que respete CRLF y revisa `git diff --stat` (solo líneas reales). `git ls-files --eol <archivo>` dice cuál es el fin de línea.
- **El BFF no recompila solo** al editar desde Windows sobre `/mnt/c` (no hay inotify): hay que reiniciar el árbol y la primera compilación tarda ~6 minutos. El front (Next) sí recompila en caliente.
- **Reiniciar**: detener solo el árbol de `bun scripts/dev.ts` y lo que escucha en 3000 y 3001. **El puerto 4000 es el monitor de otro sistema: no tocarlo ni matar procesos por patrón de ruta.** Relanzar con `bun run dev` desde WSL (cargando `~/.nvm/nvm.sh`; `node` no está en el PATH de un `bash` sin login).
- **Docker**: los contenedores pueden desaparecer (WSL reiniciado) pero los volúmenes `prestige-sandbox_pgdata` y `_miniodata` persisten; `docker compose up -d postgres` desde `backend/` basta para migrar.
- **Prisma**: `migrate deploy` y `generate` se corren **en WSL**. Una migración a mano debe coincidir con `schema.prisma` (el CI corre `prisma migrate diff`); se genera con una base shadow temporal.
- **`tenantId` de negocio es el slug**; `TenantMembership.tenantId` y `Policy.tenantId` guardan el uuid del `Tenant` (usa `TenantIdResolver`, no filtres por la relación `tenant`).
- **Secretos**: nunca en archivos, commits, Notion ni reportes. `.env` está protegido; usa `.env.example` para los nombres.
- **Verificación**: `npx tsc --noEmit` y `npx vitest run` desde `backend/bff` y `frontend/web` (Windows). `digital.adapter.spec` y algún test de firma fallan **por carga** al correr toda la suite en paralelo y pasan solos.
- **Pruebas con HTTP real**: password grant contra Keycloak con `client_id=prestige-web` desde WSL (`curl`); desde Windows `localhost:3000` puede dar timeout.
- Cada tanda grande: ADR/contrato primero, esquema y migraciones por quien orquesta, agentes con archivos disjuntos, verificación propia, commits temáticos, y **actualizar este archivo y Notion**.

## 6. Mapa rápido de archivos

- Tablas de consulta: `backend/bff/src/lookup-tables/` (motor `lookup-engine.ts`, resolvedor `flow-resolver.service.ts`), front `frontend/web/app/tablas-consulta/` y `components/lookup/`.
- Flujo y participantes: `backend/bff/src/flow/` (`flow.ts`, `flow.types.ts`, `bpmn-to-flow.ts`).
- Formatos y anexos: `backend/bff/src/document-templates/` (`form-pdf.ts`, `signature-methods.ts`), `backend/bff/src/attachments/`; front `frontend/web/app/formatos/` y `components/formats/`.
- Caso de Adquisiciones: `backend/bff/src/process/adquisiciones*.ts`, `backend/bff/prisma/scripts/seed-example-gastos*.ts`.
- Guarda de tenant: `backend/bff/src/prisma/` (`tenant-guard.ts`, `tenant-id-resolver.ts`).
- Deploy: `deploy/k8s/`, `deploy/keycloak/`, `backend/docker-compose*.yml`.
