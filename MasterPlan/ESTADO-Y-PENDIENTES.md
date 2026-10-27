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
- [x] **Web desplegada** en `https://prestige-web-seguridata.vercel.app` (el alias de producción real; la URL supuesta antes pertenecía a otro proyecto). Lección: Vercel fija las variables al crear el despliegue y dos despliegues simultáneos del monorepo dejaron uno con 404; el tercero, lanzado solo, quedó bien. Login verificado por el dueño. Los 9 usuarios tienen la contraseña estándar de pruebas, sin cambio obligatorio.
- [x] **Adquisiciones de gastos cargada** (18 oct): el seed `seed:example-gastos` corrió dentro del contenedor del BFF con sus servicios reales (cifrado y auditoría) y creó la tabla `roles-adquisiciones` (1 fila, `javazquez`), la tabla `responsables-gasto` y el formato «Solicitud de gastos (Adquisiciones)» publicado (8 variables, 20 pasos, 2 anexos; firmas ACCEPT, AUTOGRAFA y DIGITAL). Después se copiaron del sandbox las 62 filas de la matriz (incluidas las 9 reglas de reembolso de jefes de área, 6 con modalidad Reembolso) por inserción directa en una transacción; esa copia no deja eventos de auditoría propios (la base tiene 7 de la creación con el seed). El seed local desde Windows/WSL se colgó sin salida visible, por lo que se corrió en el contenedor.
- Pendiente: asociar el formato al proceso `adquisiciones-gastos` y publicar los procesos del caso (Process Studio); crear el cliente MCP (`deploy/keycloak/provision-mcp.mjs`); relay SMTP real; sin swap en el servidor (revisión del 21 oct: ~284 MB de RAM disponibles de 3.8 GB y Keycloak al 80 % de su límite de 768 MB; swap de 1 GB pendiente, requiere `sudo` con contraseña del dueño); verificar de punta a punta una solicitud de gasto sin enviar correos reales.
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

### Rediseño de la interfaz (21 oct)
- [x] **Navegación** agrupada por tarea (Mi trabajo, Documentos, Personas, Configuración), acción principal «Enviar documento», encabezado sólido y componentes comunes (PageHeader, Select, Textarea, Field, EmptyState).
- [x] **Pantallas rediseñadas:** Inicio con cola de acción, Por firmar y Enviados con filtros, Mis documentos en lista, Altas de identidad, Operación, Conexiones, portal del firmante, firma interna, evidencia y login. Los iconos van sin figura de fondo (regla del dueño).
- [x] **Steppers** con icono desnudo y línea fina (asistente de formatos y Procesos); Enviar documento conserva el original centrado, con resumen lateral en tarjeta carbón.
- [x] **El proceso como frase** (propuesta C): pasos de Procesos, de formatos, condiciones de tablas de consulta y firmantes de Enviar se leen como oraciones con recuadros editables y panel de ruta en carbón. Se quitó el arrastre de pasos en el editor de formatos (ahora subir y bajar).
- [x] **Formatos como asistente por pasos** con revisión final; **tabla de consulta** con pestañas y rejilla acotada; **Procesos** en lenguaje llano con el diagrama BPMN plegado y opcional.
- [x] **Panel de firma** con visor de la solicitud y de cada adjunto (pestañas) y «Guardar en mis archivos» (descarga). Los adjuntos se ven también en el expediente.
- [x] **Cotizaciones: mínimo 1** en el formato «Solicitud de gastos (Adquisiciones)», en Supabase (producción) y en el sandbox local; el editor de formatos ya permite definir por anexo si es obligatorio, el mínimo y el máximo. Los nombres de paso del proceso aún dicen «≥3 cotizaciones» (pendiente de decidir si cambian).
- [x] **Concepto de gasto dependiente del tipo (21 oct, solo en código; sin desplegar):** las variables de un flujo aceptan `dependsOn` (la lista toma sus opciones del valor de otra lista). En «Solicitud de gastos», al elegir el tipo (p. ej. «Gastos de oficina, seguros y comunicación») el campo Concepto ofrece solo sus conceptos, según `Responsables Gasto Monday (3).xlsx` (68 conceptos repartidos en 5 tipos; `CONCEPTOS_POR_TIPO`). El BFF rechaza un concepto que no corresponda al tipo y el editor de formatos permite definir la dependencia. Pruebas: backend 1,262/1,262 y frontend 286/286, tsc limpio; **no se probó contra el BFF vivo**. Para verlo en datos reales: reiniciar el BFF (la plataforma versiona sola el proceso `adquisiciones-gastos`) y correr `seed:example-gastos --force` para regenerar el formato publicado. **Hecho el 21 oct en el sandbox local** (BFF vivo con el código nuevo, proceso v6 y formato regenerado con `dependsOn`).
- [x] **Vista previa del documento en vivo al llenar un formato (21 oct):** volvió como columna lateral fija junto al formulario (antes del commit `6584be5` estaba así; ese commit la dejó plegada abajo tras «Ver cómo quedará»). Cada dato se escribe en su lugar de la hoja al teclear, los huecos vacíos se insinúan con contorno tenue, el dato enfocado se resalta con su nombre, hay navegación de páginas y la columna tiene pestañas «Documento / Ruta de envío» (la ruta avisa cuántas personas faltan por elegir). Componente `components/formats/live-preview.tsx`; 5 pruebas nuevas. **Sin revisión visual en navegador** (falta sesión de un usuario real).
- Frontend: 283/283 pruebas y tsc limpio al cierre. Falta revisión visual del asistente de formato y de «Probar una consulta» en móvil. El portal del firmante externo (`/firmar/[token]`) todavía no muestra adjuntos (el endpoint de adjuntos exige sesión).
- Operación local: la VM de WSL se apaga si no queda una sesión de `wsl` abierta; lanzar `bun run dev` como sesión larga y no cerrarla. Si quedan `node` huérfanos de Windows, `prisma generate` falla (EPERM) hasta detenerlos.

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

### Dominios unificados (27 oct)
- [x] Web: `https://prestige.seguridata.site` (principal). Keycloak: `https://prestige-auth.seguridata.site` (el host `kc-prestige` redirige 301). BFF: `https://api-prestige.seguridata.site`. Sin cambios de DNS (los tres ya existían en IONOS).
- [x] Causa del error de ingreso: `OIDC_REDIRECT_URI` y `OIDC_POST_LOGOUT_REDIRECT` en Vercel apuntaban a `prestige-web-seguridata.vercel.app`; el callback caía en otro host que la cookie de sesión. Corregidas junto con `KEYCLOAK_ISSUER`; cliente `prestige-web` del realm con los URIs nuevos; `prestige.env` del servidor y BFF (CORS, `PUBLIC_WEB_URL`) alineados; redeploy de producción hecho.
- Salud del BFF: `/operations/health`. Nota de operación: al editar el Caddyfile del servidor hay que reiniciar `zeus-caddy-1` (un `sed -i` rompe el bind mount y `caddy reload` dice «config is unchanged»).

### Alta de onboarding crea la cuenta de acceso (27 oct)
- [x] Quien se da de alta en onboarding recibe un usuario de Keycloak (roles `sender` y `signer`, `tenant` del alta). Usuario = inicial del nombre + primer apellido; si ya existe, inicial del segundo nombre + primer apellido; si no hay segundo nombre, inicial del nombre + segundo apellido; agotado eso, un número al final. Se muestra junto al nombre en la lista y en el detalle. El formulario pide nombre(s), primer apellido y segundo apellido por separado para no adivinar el orden.
- [x] Correos apagados: contraseña inicial **temporal común** (Keycloak obliga a cambiarla en el primer ingreso), tomada de `ONBOARDING_DEFAULT_PASSWORD` en `prestige.env` del servidor, nunca del repo. Passwords por token se evaluaron y se difieren: requieren tabla y migración, endpoint público de activación, página nueva y, sobre todo, un canal de entrega que hoy no existe (sin correo).
- [x] El BFF usa una cuenta de servicio de permisos mínimos (`prestige-onboarding-admin`: `manage-users`, `view-users`, `query-users`, `view-realm`), creada con `deploy/server/provision-onboarding-admin.sh` por la administración estándar de Keycloak. No toca el realm, sus flujos ni sus temas. Rechazar un alta deshabilita la cuenta (no la borra) y queda auditado.
- Pendiente: al contar con relay SMTP real, pasar de contraseña común a enlace de activación; revisar si proveedores y clientes deben recibir cuenta (hoy todos los tipos de alta la reciben).
