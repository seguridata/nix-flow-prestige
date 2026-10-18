> **Espejo de la página de Notion de Prestige** (`3fac115a-cdaa-8128-84a9-de319b704baa`, https://app.notion.com/p/3fac115acdaa812884a9de319b704baa). Notion es la fuente de la verdad: si este archivo difiere, manda Notion. No se edita a mano; se regenera desde Notion al cerrar cada tanda.

# Prestige: estado y pendientes — fuente de la verdad (17 oct 2026)

> **Fuente de la verdad de Prestige desde el 17 oct 2026.** Esta página manda sobre los `.md` del repo, Monday y cualquier plan histórico. El repo conserva el detalle técnico (ADR, contratos, reglas); aquí vive el estado, los pendientes y las decisiones. Se actualiza al cerrar cada tanda.

## Corte vigente
17 oct 2026
- Rama `develop`; trabajo directo con commits temáticos. `main` solo recibe el PR que apruebe el dueño.
- **Publicado (18 oct):** el PR #13 (`develop` → `main`) está fusionado. `main` incluye todos los commits de `develop` hasta `e0d535c`, con el retiro del collector OTel, Notion como fuente de la verdad y una demo de Tecate que después se retiró (ver «Sonda de conectividad»). Los commits posteriores a `e0d535c` están solo en local.
- **Ramas:** solo existen `main` y `develop`, locales y remotas. Se borraron las 14 ramas ya fusionadas (verificado que todas estaban contenidas en `main`; `claude/bpmn-adquisiciones-diagram-844231` tenía un commit propio con su contenido idéntico ya presente) y los dos worktrees de `.claude/worktrees`.
- Estado general: la plataforma está implementada en gran parte y probada en sandbox local. **No hay despliegue de producción ni staging validado.** Este corte no volvió a correr pruebas ni a levantar servicios; los números de abajo son los últimos registrados.
- Contenedores del sandbox arriba al revisar: Keycloak, MinIO, Temporal, Redis, Mailpit y Postgres. BFF y web no se comprobaron.

## Realizado
### Base A/B y producto
- [x] Identidad OIDC/PKCE, roles, aislamiento de aplicación, canal interno autenticado y portal de enlaces de un uso.
- [x] Firma digital PAdES real, TSA RFC 3161, evidencia firmada, verificador offline y auditoría encadenada. La confianza productiva y la interoperabilidad externa no se deducen de esto.
- [x] DMN, recordatorios y delegación, correo con outbox, webhooks/SDK y control plane.
- [x] Tablas de consulta (solo admin) con 14 operadores, importación/exportación, paginación y resolución de participantes con auditoría.
- [x] Formatos digitales y anexos: validación por contenido, hash, cifrado AAD, permisos; métodos de firma sujetos a la política del tenant.
- [x] `UserNotification.tenantId NOT NULL`; huérfanas retiradas por migración.
- [x] Usuarios reales y membresías en Keycloak local; ficticios retirados. Nueve reglas de responsables, solicitante autenticado, modalidad Compra/Reembolso y 20 previews de ruteo aprobados.
- [x] 30 objetos antiguos migrados a AAD; 55 referencias verificadas en modo estricto; originales conservados.
- [x] MinIO local sin root e identidad limitada al bucket.
- [x] Soporte TLS/API key/mTLS de Temporal Cloud implementado (no hay conexión Cloud validada).
- [x] Imagen Keycloak de producción probada aislada; imagen BFF construida y comprobada (Node/Prisma). No es despliegue.
- [x] Chat: borradores visibles, revisión editable y conversión humana a FORM; E2E de navegador con borrador sintético y carga/retiro de PDF.
- [x] `businessRuleTask` con `prestige:lookup` como variable derivada (solo consultas previas incondicionales).
- [x] Observabilidad por tenant (span y métricas con `tenant.id`) verificada una vez contra un collector temporal con contexto sintético.

### Process Studio, MCP y paginación
- [x] Catálogo de procesos con archivo reversible, constructor de etapas, editor BPMN, preflight, laboratorio sin envío, comparación/restauración y paquetes SHA-256.
- [x] Formato de gastos asociado a `adquisiciones-gastos` v1; solicitudes atribuidas al proceso/versión persistidos (el payload no puede elegir otra); 62 filas de responsables intactas.
- [x] BPMN conserva XML/deshacer al cambiar de pestaña y protege cambios sin guardar.
- [x] MCP Streamable HTTP de lectura con cinco herramientas, tenant/actor, issuer/audience/scope/roles/membresía y cliente local PKCE S256. Metadata 200 y sin bearer 401.
- [x] Formatos, bandeja y enviados con cursor (lotes de 50), validación por tenant/actor, reintento y deduplicación; contrato legado compatible.
- [x] OpenAPI/Postman actualizados; validador de 61 operaciones.

### Sonda de conectividad Windows↔WSL (18 oct)
- [x] Una demo de multitenancy con marca (tema de Keycloak, cliente OIDC, usuario y tenant de Tecate) sirvió solo como sonda para saber si Windows alcanzaba los puertos de WSL. Resultado: **sí**. Desde Windows respondieron Keycloak en `localhost:8081` (HTTP 200 y las pantallas de login abrieron en el navegador) y la web en `localhost:3001` (redirect 307 a Keycloak). El BFF (3000) respondió health 200 solo desde WSL.
- [x] La demo se retiró completa: cliente, grupo, usuario y tenant `tecate` borrados del sandbox (la base quedó con `seguridata` y `acme`) y su código revertido en el repo. La demo llegó a `main` en el PR #13; el revert está en `develop` y requiere publicarse.
- La coexistencia entre dos tenants se verificó contra el BFF antes de retirarla: cada usuario ve solo los datos de su tenant y el tema no cambia la pertenencia.

### Despliegue ligero en el servidor (18 oct)
- [x] **Servidor en marcha** (`~/prestige`, compose en `deploy/server/`): BFF (sano; conecta con Supabase, Redis y Temporal; las 38 migraciones ya estaban aplicadas), worker, Keycloak 26 (realm importado sin usuarios demo), Temporal, Postgres para Keycloak/Temporal, Redis y Mailpit. PKI generada en el volumen. RAM disponible tras arrancar: ~1.2 GB de 3.8 GB; `gea` y `themis` siguen igual.
- [x] **Dominios con HTTPS y certificado válido** (Caddy existente, validado antes de recargar): `https://api-prestige.seguridata.site` (health 200) y `https://kc-prestige.seguridata.site` (discovery 200; `/admin` y `/realms/master` responden 404, la administración es por `docker exec prestige-keycloak kcadm.sh`).
- [x] **9 usuarios de Keycloak** creados con `tenant=seguridata`, roles `admin`, `signer` y `sender` (`draygoza` suma `platform_admin`) y contraseña temporal que obliga a cambiarla. El atributo `tenant` se declaró en el perfil de usuario (admin-only), porque Keycloak 26 ignora atributos no declarados.
- [x] **Vercel**: proyecto `prestige-web` (raíz `frontend/web`, ligado a `seguridata/nix-flow-prestige`, rama `main`) con 10 variables y la protección de Vercel desactivada para que el portal de firma externa sea público. **Aún sin desplegar**: se despliega con un push a `main` o con Redeploy en el panel. La URL `https://prestige-web.vercel.app` (usada en el realm y en las variables de redirección) es una suposición a confirmar tras el primer despliegue.
- **Limitación**: el BFF exige `SMTP_HOST` en producción; mientras no haya un relay real, Mailpit captura los correos y **no los entrega a nadie**, enlaces de firma incluidos.
- Pendiente: desplegar la web y probar el login completo; sembrar formato y tablas de gasto con el BFF corriendo (`seed:example-gastos`, matriz de 62 responsables y 9 reglas); crear el cliente MCP (`deploy/keycloak/provision-mcp.mjs`); relay SMTP real; sin swap en el servidor.
- Servidor `5.161.61.67` (3.8 GB de RAM, 3 CPU): tras quitar n8n, kronos y ares quedan 23 GB de disco y ~2.2 GB de RAM disponibles; `gea` y `themis` se quedan. Prestige allí necesita ~2.1 GB en reposo si todo es local, por lo que se reparte así: web en Vercel (equipo `Seguridata`), BFF + Keycloak + worker en el servidor, Postgres y Storage en Supabase, Redis de sesiones en Upstash. Estimación total del servidor: ~2.8 a 3.0 GB de 3.8 GB (estimada, sin prueba de carga).
- Temporal Cloud cuesta desde $100 USD/mes (Essentials); con 4 usuarios no se justifica. Propuesta: Temporal local por ahora (pendiente de confirmar).
- [x] Proyecto Supabase `Prestige` (`yhovbnxclzyrvsrkotdb`, `us-east-1`, Postgres 17) con el esquema aplicado el 18 oct por el Session pooler (puerto 5432): 37 migraciones de Prisma más `20261018130000_lock_supabase_data_api` (38 en total) y 36 tablas. Bucket privado `prestige-docs` creado; `storage.objects` con seguridad por fila y sin políticas (nadie con la clave pública lo lee).
- **Decisión: Supabase Storage** para documentos. Prestige habla S3 por `S3_ENDPOINT`, pero Supabase no ofrece Object Lock ni versionado, así que se pierde el candado GOVERNANCE de 30 días que hoy configura el compose de MinIO. Aceptado para desarrollo; para evidencia con garantía de inmutabilidad habría que usar AWS S3 con Object Lock.
- Keycloak se mantiene como proveedor de identidad (reemplazarlo por Supabase Auth se descartó por ahora: el BFF depende de las claves `tenant`, `realm_access.roles` y `auth_time`, del step-up y del consentimiento del MCP OAuth).
- [x] API de datos de Supabase cerrada. Aunque el changelog dice que las tablas nuevas ya no se exponen por defecto, al migrar este proyecto tenía 36 tablas sin RLS y 504 permisos para `anon` y `authenticated`. La migración `20261018130000_lock_supabase_data_api` activa RLS en todas (sin políticas: la API no ve filas), revoca esos permisos, también por defecto para objetos que cree `postgres`, y fija el `search_path` de `prestige_audit_event_immutable`. Verificado: 36 de 36 con RLS, 0 permisos de tablas y funciones para esos roles y el asesor sin errores ni advertencias (quedan 36 avisos informativos de «RLS sin políticas», que es lo deseado). Quedan 3 permisos por defecto de `supabase_admin`, rol interno de Supabase que no crea tablas de Prestige. El BFF no se ve afectado porque `postgres` ignora RLS. La cadena de conexión vive en `backend/bff/.env.supabase`, ignorado por Git.
- [x] Redis de Upstash (`noted-ox-133292`, TLS, puerto 6379) creado y probado desde esta máquina: PING, SET/GET/DEL con caducidad y Redis 8.4.0 (conexión inicial ~550 ms). Sirve para las sesiones de la web en Vercel sin cambiar código: `libs/session-store.ts` usa `ioredis` y basta una `REDIS_URL` con formato `rediss://default:<token>@host:6379`. Para el BFF propongo un Redis local en el servidor (8 MB): usa Redis para el throttler, el adaptador de Socket.IO y caché, y su volumen de comandos en Upstash podría exceder el plan; revisar límites del plan antes de apuntarlo allí. El dato vive en `frontend/web/.env.upstash`, ignorado por Git.
- [x] Tenant `seguridata` (activo, lo crea una migración) y sus 9 membresías sembradas en Supabase: `draygoza` con `platform_admin` y los demás con `admin`, `signer` y `sender`; sin los usuarios ficticios.
- [x] Supabase Storage probado de punta a punta con el cliente S3 del BFF (path-style, `us-east-1`, endpoint `https://<ref>.supabase.co/storage/v1/s3`): HeadBucket, escritura, lectura con contenido idéntico, listado y borrado en el bucket `prestige-docs`. Latencia desde esta máquina ~400 a 550 ms por operación; el chequeo de salud del BFF (`HeadBucket` con límite de 2 s) debería ir holgado desde el servidor, que está en la misma región (no medido). Llave y configuración en `backend/bff/.env.supabase`, ignorado por Git.
- Falta: formato y tablas de gasto (`seed:example-gastos` necesita el BFF completo con claves de cifrado y de almacenamiento), la matriz de 62 responsables y las 9 reglas (se aplican contra el BFF ya corriendo, y la matriz hay que importarla o exportarla del sandbox); dos dominios con HTTPS (API y Keycloak). Los usuarios de Keycloak del servidor también hay que provisionarlos allí.

### Retirado el 17 oct
- [x] **Collector OpenTelemetry del sandbox** (servicio de compose y `otel-collector.yaml`): no recibía tráfico ni había destino donde guardar datos. El SDK del BFF sigue apagado por defecto y el script `verify-tenant-otlp.ts` se conserva. Se retoma cuando se elija backend en staging.

## Evidencia y límites
- Suite backend: 1,243/1,243 (118 archivos). Frontend: 272/272 (34 archivos). TypeScript aprobado en ambos. Registrado antes de consolidar la paginación; no sumar pruebas dirigidas para inventar un total nuevo.
- Contratos: 61 operaciones, 8/8 pruebas negativas. No es OAuth interactivo.
- Paginación: pruebas dirigidas backend 10/10, UI/servicios 12/12, validador 8/8. El HTTP usó adaptador de BD de prueba; falta recorrido contra BFF, Keycloak y Postgres persistentes.
- OAuth MCP: solo metadata 200 y bearer 401. No hay consentimiento ni llamadas autenticadas E2E.
- Grok: no validado en vivo; el E2E de formatos usó borrador sintético.
- `digital.adapter.spec` y algún test de firma fallan por carga al correr la suite completa en paralelo y pasan solos.

## Pendientes
### P0 — Verificación próxima
- [ ] **OAuth MCP real.** Bloqueado por conectividad Windows↔WSL (Windows no llega al puerto de Keycloak en WSL). Intentos con portproxy/Hyper-V y BFF aislado fallaron y se retiraron. **Novedad 18 oct:** la sonda confirmó que Windows sí alcanza Keycloak (`localhost:8081`) y la web (`localhost:3001`), así que la conectividad ya no bloquea; falta correr el flujo completo contra el BFF (3000, comprobado solo desde WSL) y el consentimiento. Idea sin probar si reaparece: red espejo de WSL (`networkingMode=mirrored`). Cierre: login PKCE, consentimiento, token, cinco herramientas, denegaciones por scope/rol/tenant y aislamiento entre dos tenants.
- [ ] **Paginación contra stack persistente** (formatos, inbox, sent): múltiples páginas, delegación, cambio de tenant/actor, reintento y navegador, sin crear envíos ni firmas de negocio.
- [ ] **Suite completa posterior** al conjunto final de cambios.
- [ ] **Grok en vivo:** chatbot, flujo y PDF a formato, con revisión humana; sin documentos sensibles sin aprobación de Legal.

### P1 — Producción e infraestructura
- [ ] Staging real con dos tenants; `TENANT_GUARD=enforce` en producción solo tras validar (hoy `log`).
- [ ] RLS en Postgres (`SET LOCAL app.tenant`) con rol de sistema acotado; auditar operaciones por clave única de la guarda.
- [ ] Imagen web final, Trivy y ejecución remota del CI (el YAML existe; nunca corrió).
- [ ] Compose productivo y clúster real: hosts, TLS, Secrets, CIDR de egress, RWX para `prestige-signers`, réplicas y caché de Keycloak, usuarios del entorno real.
- [ ] Temporal Cloud con endpoint, namespace y credenciales; worker y reconciliador conectados; colas por tier.
- [ ] Pooling por réplica, backup/PITR con prueba de recuperación, rotación de secretos.
- [ ] PKCS#11 con módulo y certificado reales; CA de confianza, OCSP/CRL/LTV, QA manual de Adobe.
- [ ] NOM-151 solo con contrato de un PSC (RFC 3161 no es NOM-151).
- [ ] MinIO/S3 de producción y AAD estricto verificado en ese entorno.
- [ ] OCR, biometría y estampado de PDF a Temporal; proveedor biométrico real sujeto a contrato.
- [ ] Observabilidad: elegir backend (Tempo, Prometheus u otro) y recién entonces reintroducir un collector.

### P2 — Escala y producto
- [ ] Cuotas de almacenamiento y solicitudes por tenant.
- [ ] Versionado de tablas con vigencia y aprobación de cambios.
- [ ] Sincronización con Monday/Google y asistente Excel que solo proponga.
- [ ] Pasar «Renovación de licenciamiento» y «Proveedores estratégicos» de `ask` a consulta de tabla.
- [ ] Evaluar paginación/virtualización del resto de listados.
- [ ] Branding, CA intermedia y `keyId` por tenant.
- [ ] Dataset real de evaluación de IA (en un PDF de vacaciones el modelo hizo condicional la firma del jefe en lugar de crear el paso de RH).
- [ ] Exportar y purgar tenants (ADR-007); la purga requiere aprobación explícita.
- [ ] Pantalla de anexos de expediente ajeno, solo si el producto lo requiere.
- [ ] E2E reproducible en CI (hoy `ci.yml` no tiene paso de navegador) y revisión SAST/SBOM.
- [ ] Revalidar con evidencia: cajas de firma en editor, limpieza si falla la creación de solicitud, auditoría al publicar/despublicar, claim multiproceso de despachadores (hay advisory lock en el código; falta probar con dos instancias), rate limit del portal y rotación del secreto de webhook.
- [ ] Riesgo conocido: quien escriba en la base puede quitar el campo `aad` de un `enc` y saltarse el AAD.

### Pendientes del dueño
- [ ] PDF `SD-MATRIZ-APROBACION-GASTO` con los rangos por monto.
- [ ] Equivalencia de VP Tecnología, Comercial, Seguridad-Infraestructura, Logalty, Seguridad 4B y Soporte con la matriz.
- [ ] Responsables de Seguros corporativos (Multimodal), Reparaciones y Licencias/software/actualización.
- [ ] Servidor o clúster destino y parámetros de infraestructura.
- [ ] Aprobación de Legal para enviar contenido documental al proveedor de IA (ADR-006).
- [ ] Contratos, endpoints, credenciales y certificados de confianza e identidad de producción.
- [ ] Definir el piloto (área, documentos, criterio de éxito, runbook y rollback) y cliente o fecha objetivo.

### Decisiones ya respondidas (no volver a preguntar)
Borrar notificaciones huérfanas; MinIO sin root y app limitada al bucket; Temporal Cloud; Alejandro Jiménez para Marketing/CRM/Aliados; reembolsos de jefes de área a Javier Alarcón o a Alberto Yarza según el solicitante; Jesús Vázquez en Administración y Tesorería; usuarios reales con `draygoza` Admin Master y ficticios retirados. **No se registran contraseñas.**

## Reglas de trabajo
- Docker, Prisma y `bun run dev -- --no-demo` corren en WSL sobre la ruta Windows. BFF 3000, web 3001. **El puerto 4000 es un monitor ajeno: no tocarlo.**
- El BFF no recompila solo desde `/mnt/c`: reiniciar el árbol (primera compilación ~6 min). Esperar `/operations/health/ready`.
- No usar reset, borrar volúmenes ni reiniciar WSL sin evaluar efectos. No escribir secretos ni `.env` en repo, Notion, logs o respuestas.
- El tenant de negocio es el slug; las membresías usan UUID. Las tablas de consulta son solo admin.
- La IA propone y una persona revisa. No reescribir bytes de documentos congelados o firmados.
- Archivos con CRLF: no usar `sed -i`; revisar `git diff --stat`.
- Al cerrar una tanda: actualizar Notion primero y luego el espejo del repo. No marcar verificaciones externas por pruebas unitarias.

## Monday y tareas
- Tablero Prestige (id 18433023650, 103 ítems), auditado el 17 oct. Sin tareas nuevas: «Forzar tenant en comentario, notificación, enlace, correo y definición» pasó a Terminado (Validado en Pendiente) y 10 ítems recibieron comentario de corte. Muchos ítems de septiembre siguen con estado antiguo; no se ha depurado el resto.
- La base «Mis Tareas» de Notion no tiene filas abiertas asignadas.

## Documentación del repo
Índice y orden de lectura en `MasterPlan/README.md`. Se eliminaron por desfasados: el plan y el handoff de Fases A/B, el plan por sprints, el reporte de auditoría, el progreso por sprint, las fases, la guía de retoma, las continuidades de 16 y 17 oct y la página `Documentacion/07-estado-y-ruta.html`. Lo vigente de ellos (requerimiento original y decisiones D1–D10) quedó en `MasterPlan/REQUERIMIENTO-Y-DECISIONES.md`; el resto está en el historial de Git.
