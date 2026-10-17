# Paginación de bandeja y enviados

Implementación del 17 de octubre de 2026. Código y pruebas focales terminados. La prueba contra el BFF/Keycloak/Postgres local activo corresponde al orquestador; las pruebas HTTP de esta tanda usan Nest y servicios reales con un adaptador de base de datos de prueba.

## Contrato y composición

`GET /me/inbox` y `GET /me/sent` aceptan `PageQueryDto`: `limit` entre 1 y 200 y `cursor` opaco. Sin parámetros conservan el array legado con máximo 200 registros; con parámetros devuelven `{ items: InboxItem[], nextCursor: string | null }`.

La identidad siempre sale del JWT y el tenant de la membresía validada. Un cursor debe pertenecer al mismo tenant y a la bandeja del actor (firmante/delegado en entrada; solicitante en enviados); de lo contrario responde 400 genérico sin revelar si existe. Las fallas de infraestructura conservan su error de servidor.

Las solicitudes se paginan antes de componer documentos, expedientes y turnos, manteniendo `createdAt desc, id desc` y el cursor original. La composición no reordena registros con fechas iguales. Los lotes de documentos y expedientes siguen filtrados por tenant. OpenAPI documenta ambos endpoints, parámetros y los esquemas `InboxEnvelope` / `InboxEnvelopePage`.

## Interfaz

`/inbox` y `/sent` usan consultas infinitas independientes con claves que incluyen tenant, actor y criterio normalizado. Cambiar de espacio, usuario o criterio inicia otra consulta desde la primera página y reinicia la selección efectiva de bandeja. Las peticiones reciben AbortSignal y se deduplican por `signatureRequestId` sin alterar el orden del servidor.

Se cargan lotes de 50. «Cargar más» permanece visible aunque la búsqueda no coincida con registros cargados. La búsqueda conserva su texto y aclara que actúa sobre resultados cargados; no se presenta como búsqueda global. Un error de página siguiente conserva los anteriores y permite reintentar.

Los helpers legados `fetchInbox` / `fetchSent` mantienen el contrato array para overview y Process Studio y ya no envían identidad por query string. La caché de overview incluye tenant. La cancelación invalida consultas del actor y tenant actuales.

## Evidencia de esta tanda

- Backend: **10/10 pruebas** de inbox; cinco son HTTP con Nest y servicios reales de composición/listado. Adaptador de BD de prueba con **205 solicitudes**, fechas iguales, recorrido sin duplicados, array legado de 200, cursor final, cursor ajeno a tenant/actor, anonimato, tenant prohibido, límites inválidos y delegación.
- Frontend: **6/6 pruebas** de la interfaz real con React Query y sesión. Cubren 205 registros, búsqueda sin coincidencias, conservación del filtro, recuperación tras error, deduplicación y cambio de tenant/criterio.
- TypeScript backend/frontend: verificación ejecutada por esta tanda; ver el reporte del orquestador para el resultado consolidado de cambios simultáneos.

No se generaron solicitudes de negocio, firmas ni PDFs para las pruebas ni se ampliaron permisos.
