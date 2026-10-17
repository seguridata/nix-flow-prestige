# Continuidad de Claude — 16 de octubre de 2026

## Tanda Prestige Studio y MCP OAuth — 16 de octubre de 2026

La experiencia de Procesos se reorganizó para que el catálogo muestre una sola fila por clave, con búsqueda y filtros. La administración permite crear, archivar y recuperar procesos; el archivo por tenant es reversible y conserva versiones, solicitudes, documentos y auditoría. En el sandbox `seguridata` se revisó el plan y se conservaron `adquisiciones-gastos`, `flujo-de-adquisicion`, `renovacion-licenciamiento`, `proveedores-estrategicos` y `subproceso-gestion-de-proveedores-estrategicos`. Se archivaron cuatro claves ajenas: contrato de prueba, firma de tres partes, onboarding de identidad y vacaciones. Los formatos ya asociados mantienen su publicación y snapshot; deben retirarse desde Formatos si también se quiere impedir nuevas solicitudes.

El constructor vertical guarda nuevas versiones Flow y BPMN a partir de etapas; el editor BPMN queda como vista avanzada. Publicar exige preflight real de tablas y condiciones. El laboratorio consulta el mismo resolvedor y las tablas activas sin crear solicitudes, correos ni firmas. El historial compara cambios y restaura como nueva versión borrador. Importación/exportación verifica SHA-256, y el panel de impacto presenta usos registrados sin inventar atribución de versión. El seguimiento filtra instancias por proceso y muestra estado y error útiles.

La ruta `/conexiones` explica e informa la configuración real de Prestige MCP. Se incorporó servidor Streamable HTTP OAuth de solo lectura, con cinco herramientas limitadas por tenant y actor, y guardas para issuer, audience, scope, roles y membresía. Keycloak sandbox tiene el cliente `prestige-mcp-client` provisionado de forma repetible con PKCE S256 y consentimiento. **El recorrido real de consentimiento, llamada de herramientas y aislamiento todavía está pendiente de la verificación OAuth con navegador**; no se declara como validado hasta completar esa prueba.

Verificación de código: backend **1,218/1,218** pruebas (117 archivos), frontend **269/269**, `tsc --noEmit` en ambos proyectos y build Nest del BFF aprobados. El test que excedió el timeout en la primera corrida pasó aislado y en la repetición con concurrencia limitada. También se levantó el BFF en Windows y `/operations/health/ready` devolvió PostgreSQL, Redis y object storage listos; el navegador autenticado mostró el catálogo reducido. El startup de WSL desde `/mnt/c` fue lento y el host Windows rechazó el puerto publicado de Keycloak; por eso **el consentimiento y las llamadas MCP vía OAuth aún no tienen prueba E2E**. La composición móvil de 390×844 fue revisada; no equivale a gestos en un dispositivo físico.

El formato existente «Solicitud de gastos (Adquisiciones)» quedó asociado a `adquisiciones-gastos` v1 con el seed oficial, sin modificar campos, flujo, anexos ni publicación. El dry run posterior confirma que ya no hay cambios pendientes y las 62 filas de responsables permanecen intactas.

Cinco capacidades de alto impacto añadidas: (1) ciclo de vida reversible de procesos; (2) constructor persistente de etapas; (3) preflight más laboratorio real; (4) comparación/restauración e intercambio verificable de paquetes; (5) análisis de impacto y seguimiento filtrado de ejecuciones. Cinco mejoras visuales: (1) catálogo compacto con búsqueda/filtros y una fila por proceso; (2) pasos verticales editables; (3) historial lateral con diferencias; (4) guía visible proceso→flujo→formato→solicitud y contexto de publicación; (5) estados/errores de ejecución, controles por teclado y disposición adaptada a móvil.

Documentación nueva: [PROCESS-STUDIO.md](PROCESS-STUDIO.md) y [MCP-OAUTH.md](MCP-OAUTH.md). Referencias oficiales de autorización: [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [SDK TypeScript](https://github.com/modelcontextprotocol/typescript-sdk) y [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers).

Siguen pendientes los rangos por monto, las equivalencias de seis áreas de Monday, el clúster destino y el resto del backlog de producción (RLS, staging, imágenes/Trivy, Temporal Cloud, OCR, biometría y legal IA, entre otros). La lista de claves conservadas y los formatos que permanecen publicados están descritos arriba.

Fuente: Notion «Prestige: pendientes tras multitenant, deploy y chatbot», página `3fac115a-cdaa-8128-84a9-de319b704baa`, y sesión Claude `1f6cabab-1f4b-45b9-be8d-dae4a55af010`. La sesión terminó después de `bea0a8e` al agotarse su límite semanal. Rama: `develop`.

## Cambios y evidencia

- **Identidad local:** provisioning repetible de nueve usuarios reales, roles y membresías; draygoza con rol de plataforma. Se retiraron María, Roberto y Carlos. Se aplicó mediante Keycloak real. Contraseñas solo en variables de proceso; nunca en archivos versionados. Para usuarios nuevos sin correo confirmado, el perfil del realm sandbox permite omitirlo.
- **Responsables:** nueve reglas aplicadas mediante API auditada; Marketing/CRM/Aliados a Alejandro Jiménez y reembolsos de jefes a Javier Alarcón o Alberto Yarza según decisión. `solicitante` se obtiene del usuario autenticado y no admite suplantación desde campos del formulario. Modalidad explícita Compra/Reembolso. Falta regenerar el formato existente y probar el recorrido completo con el BFF recompilado.
- **Storage:** 30 objetos migrados en MinIO real, comprobando SHA-256 antes y después. No se alteraron bytes firmados ni se eliminaron originales. Segunda ejecución dry-run: **0 pendientes**. Script paginado, reentrante y CAS; modo estricto AAD configurable, aún sin activar en el proceso vivo. Las referencias históricas de auditoría no se reescriben.
- **MinIO:** usuario de aplicación limitado al bucket y contenedor sin root; acceso a objetos aprobado y administración denegada. Credenciales privadas actualizadas, pendiente reinicio BFF para leer el entorno nuevo. Detalle en `deploy/LOCAL-VALIDATION.md`.
- **Temporal:** soporte compartido API key/TLS o mTLS y cola configurable entre BFF, reconciliador y worker. No se ha conectado a Cloud real ni se implementó enrutamiento automático por tier.
- **Keycloak producción:** imagen construida y `start --optimized` probado con Postgres aislado; discovery OIDC HTTP 200. Recursos exclusivos de la prueba retirados.
- **Chatbot:** listado de borradores en Chat y Formatos; revisión editable y conversión a formato digital mediante acción humana. No publica automáticamente. Controller probado con servidor Nest HTTP, guards y DTO reales, sustituyendo dependencias externas en la prueba.
- **BPMN:** `businessRuleTask` con extensión explícita `prestige:lookup` se convierte a variable derivada. Reglas solo previas e incondicionales, rechazando semántica temporal no soportada. Ver ADR-008.
- **Aislamiento:** eliminadas excepciones globales por modelo/operación; contexto sistema acotado a consultas batch del reconciliador y outbox. No equivale a RLS ni a protección nueva de todas las operaciones por clave única.
- **Observabilidad:** span y métricas HTTP con `tenant.id`, ruta normalizada y estado de error. Exportador OTLP de métricas configurado; falta verificar recepción en colector real.
- **Contratos:** OpenAPI/Postman para tablas, formatos, anexos y Chat; validador ejecutable coteja 30 operaciones de controllers, referencias, roles, estados y parámetros. Sin credenciales demo en Postman.
- **CI:** build/Trivy para tres imágenes y `.dockerignore` que excluye env y PKI. Workflow remoto no ejecutado.

## Verificación de esta tanda

- Backend: **1,179 tests, 115 archivos, todos aprobados** (`npx vitest run --maxWorkers=2`).
- Frontend: **259 tests, 29 archivos, todos aprobados** (`npx vitest run --maxWorkers=2`).
- Backend y frontend: TypeScript aprobado en pruebas dirigidas; comprobación final registrada en la sesión.
- Contratos: `python backend/contracts/validate-contracts.py` aprobado.
- HTTP real antes del incidente: OIDC con ayarza, 401 sin token, 403 con tenant ajeno, salud Postgres/MinIO y listados de tablas/formatos/borradores aprobados. Script reproducible: `backend/bff/scripts/verify-prestige-local.mjs`.
- QA navegador, Grok en vivo y recorrido final de anexos: **pendientes**, no afirmarlos como verificados.

## Incidente del entorno

Los builds Docker BFF/web agotaron C: (~430 MB libres) y WSL devolvió EIO y luego `Wsl/Service/CreateInstance/E_FAIL`. Se recuperaron ~2.4 GB eliminando exclusivamente `frontend/web/.next` (salida regenerable). WSL siguió sin iniciar; no se reinició la distribución ni se tocaron servicios ajenos. Se solicitó autorización para reiniciar solo Ubuntu porque podría interrumpir otros servicios. No repetir builds de imágenes con este margen de disco. Los volúmenes de datos no se borraron.

## Siguiente paso técnico

### Reanudación tras liberar disco (16 de octubre, tarde)

- WSL recuperado reiniciando su máquina virtual después de comprobar que Ubuntu era la única distribución instalada y estaba detenida. Los volúmenes persistentes se conservaron.
- Corregida la provisión repetida de MinIO: `mc admin policy attach` devuelve error cuando la asociación ya existe; se acepta únicamente ese resultado idempotente. Acceso al bucket aprobado y administración denegada tras reiniciar.
- `backfill-storage-aad.ts --verify` añade una comprobación de solo lectura: descifrado estricto y SHA-256 de todas las referencias. **55 referencias verificadas**, sin modificar objetos. Modo estricto activado en el entorno privado local.
- Corregido `saveFormDocument`: excluye campos de ubicación PDF que `CreateFormDto` rechaza. Pruebas dirigidas frontend aprobadas.
- Colector OTLP real recibió traza, contador y duración con `tenant.id` y ruta normalizada. Prueba con interceptor real y contexto autenticado sintético; no equivale a comprobar todo el pipeline HTTP del BFF.
- Backend levantado con `bun run dev -- --no-demo`; worker Temporal RUNNING. `GET /operations/health`: Postgres y objectStorage verdaderos, ambos `true`.
- Verificación HTTP autenticada repetida tras el reinicio: OIDC `draygoza`, 401 sin token, 403 con tenant ajeno, y 200 para salud, tablas, formatos y borradores.
- Formato de gastos generado con modalidad. Seed de decisiones HTTP repetible: primera pasada hizo 3 escrituras (solo formato), la segunda cero; tablas de responsables y roles sin cambios. **20 previews**: seis reembolsos, seis intentos de suplantación rechazados, seis compras de Marketing y dos conceptos CRM/Aliados. Ruteo esperado aprobado.
- Corrección del payload FORM: test dirigido 4/4 y `tsc` frontend aprobados. E2E real de navegador aprobado: login, borrador sintético, revisión, formato FORM no publicado, publicación temporal de QA, PDF base, carga de PDF por selector, comprobación de hash/tamaño/estado y eliminación con HTTP 204. Limpieza del formato hecha; borrador de Redis removido tras la primera corrida fallida.
- Encontrado y corregido HTTP 400 en la campana de notificaciones: el front enviaba `userId` en query, pero `PageQueryDto` lo rechaza y el BFF ya obtiene el actor del JWT. La UI ahora llama `/me/notifications` sin identidad enviada por el cliente; GET autenticado devuelve HTTP 200.

Los pasos siguientes se mantienen abiertos hasta registrar sus resultados reales.

1. Construir imagen web y ejecutar Trivy cuando se pueda reservar disco sin afectar el sandbox. BFF Docker ya construida y comprobada a nivel Node/Prisma.
2. Consolidar commit de MinIO/collector tras validación YAML/Compose. No hay despliegue a clúster.

## Pendientes que siguen abiertos

El usuario confirmó dejar pendientes **rangos de aprobación por monto, equivalencias de seis áreas y servidor/clúster destino**. También faltan aprobación legal IA, proveedor biométrico/Seguriliv y credenciales/certificados de producción.

Siguen abiertos en código: RLS, validación de operaciones unique de la guarda, cuotas por tenant, colas por tier, OCR/biometría/estampado en Temporal, pooling dimensionado, branding/CA/keyId por tenant, paginación/virtualización general, versiones y aprobación de tablas, fuentes externas sincronizadas, asistente Excel, conversiones de los otros procesos, conjunto real de evaluación IA y MCP de solo lectura. Exportar/purgar tenants no se ejecutó y la purga necesita autorización explícita. **Esta tanda no cierra todo el backlog.**
