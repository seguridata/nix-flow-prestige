> **Fuente de la verdad (17 oct 2026):** la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa) manda sobre estado, pendientes y decisiones. El [espejo en el repo](../MasterPlan/ESTADO-Y-PENDIENTES.md) lo replica; los documentos históricos y las especificaciones técnicas conservan su alcance.

# Validación local de infraestructura — 2026-10-16

No se aplicó ningún recurso a un clúster. No hay credenciales en este documento.

- Temporal: 30 tests pasan (9 configuración TLS/API key/mTLS/namespace/cola, 2 límites de worker, 12 reconciliador y 7 servicio de workflows).
- MinIO: contenedor real iniciado como `100:101`, con migración de permisos sobre el volumen existente; los objetos se conservaron. Identidad de aplicación nueva con acceso al bucket comprobado (`mc ls`), y operación administrativa denegada (`mc admin info`). Credenciales actualizadas únicamente en el entorno privado local.
- `docker compose config --quiet` pasa usando `backend/.env` y `backend/bff/.env`; el script `bun run dev` carga ambos y espera la provisión de MinIO.
- Keycloak: imagen de producción construida; Compose probado con PostgreSQL nuevo en proyecto aislado `prestige-idp-verify`, puerto 18081. Inicio optimizado y discovery OIDC del realm Prestige HTTP 200; issuer coincide con el hostname configurado. Los recursos exclusivos de esa prueba se retiraron al finalizar.
- 12 archivos YAML de deploy, Compose y CI parseados correctamente. `git diff --check` limpio para infraestructura.
- CI incluye build de BFF, web y Keycloak más Trivy (HIGH/CRITICAL corregibles). El workflow remoto y el escaneo no se han ejecutado en esta sesión.

Temporal Cloud requiere endpoint, namespace y credenciales reales para verificar una conexión. `TEMPORAL_TASK_QUEUE` permite colas por despliegue; el enrutamiento automático según tier de tenant queda pendiente. Hosts, CIDR, storage class, Secrets y despliegue del clúster continúan pendientes.

Builds Docker BFF y web interrumpidos por agotamiento de disco del host (~432 MB libres), con errores EIO de WSL. BFF alcanzó compilación Nest correcta y web compilación Next correcta; no se obtuvo imagen final de estos dos servicios. No repetir builds hasta recuperar espacio.

## Revalidación tras recuperar WSL

- MinIO: corregida la idempotencia de `mc admin policy attach`; una asociación existente devuelve error «no net effect». Se acepta únicamente ese caso y otros errores siguen deteniendo el init. Recreación + `compose wait minio-init` termina en código 0. Acceso al bucket permitido y administración denegada revalidados después del reinicio.
- OTLP real: `backend/bff/scripts/verify-tenant-otlp.ts` ejecutó el interceptor real con contexto autenticado sintético y exportó a un collector oficial aislado. Se comprobaron en el receptor el span `tenant-observability-smoke`, contador `prestige.http.requests`, histograma `prestige.http.duration`, `tenant.id=otel-smoke-tenant` y ruta de plantilla `/smoke/:id`. No es una prueba de autenticación del BFF completo. El collector temporal (puerto 14318, límite 128 MB) fue eliminado al terminar.
- El collector del sandbox (`backend/infra/otel-collector.yaml` y el servicio del compose) se retiró el 17 oct 2026: no recibía tráfico ni había destino donde guardar los datos. El SDK del BFF sigue apagado por defecto; en staging se apunta a un colector externo. El smoke usa recursos explícitos y `forceFlush` antes de cerrar; no depende del intervalo de exportación ni de detección asíncrona de recursos.
- El BFF local compiló con 0 errores y quedó respondiendo en puerto 3000 tras aliviar E/S. La prueba real OIDC/tenant/health/listados pasó. Imagen `prestige-bff:local-verify` construida (415,773,008 bytes); `node` y `@prisma/client` ejecutaron dentro del contenedor. No se inició un segundo BFF contra la base local para evitar ticks duplicados.
- E2E de navegador contra el stack real aprobado: borrador sintético, conversión por revisión humana, formato FORM y flujo de carga/eliminación de un PDF en MinIO con hash comprobado. Los datos de prueba del formato fueron limpiados.
- La campana del frontend devolvía 400 al incluir `userId` ajeno al DTO de paginación. Corregida para que el BFF determine el actor autenticado; GET protegido `/me/notifications` devuelve HTTP 200 y E2E navegador repetido aprobó.
