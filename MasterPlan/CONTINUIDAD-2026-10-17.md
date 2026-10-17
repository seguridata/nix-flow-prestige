# Continuidad — 17 de octubre de 2026

## Cierre de pendientes locales de Prestige Studio

- **Ejecución asociada:** al crear una solicitud desde un formato vinculado, el backend lee su clave y versión del formato persistido, valida que la versión del proceso tenga flujo y que se haya publicado al menos una vez, y registra esa atribución en `WorkflowRun` y auditoría. La solicitud ya no queda etiquetada por defecto como contrato. Los formatos sin asociación conservan compatibilidad. Los valores que lleguen en el cuerpo HTTP no pueden elegir el proceso.
- **Acceso al catálogo:** pruebas HTTP confirman que configuración, versiones, BPMN y DMN completos requieren administración. Sender/signer solo reciben versiones publicadas con consultas internas sanitizadas; pedir `published=false` no abre borradores.
- **Edición BPMN:** el modelador conserva XML y deshacer al cambiar pestaña. Los cambios sin guardar activan confirmación antes de salir o reemplazar el diagrama/etapas; al cargar otra versión se libera la instancia anterior.
- **Contratos API:** OpenAPI y Postman incluyen las rutas existentes de Process Studio y MCP; el validador coteja 61 operaciones con cinco controllers, roles, metadata, scope y herramientas.

## Verificación

- Backend: **1,243/1,243** pruebas en 118 archivos, corrida con un worker para evitar timeouts de carga; TypeScript `--noEmit` pasó.
- Frontend: **272/272** pruebas en 34 archivos, corrida con un worker; TypeScript `--noEmit` pasó.
- Contratos: **8/8** pruebas negativas y validador estático aprobado: 61 operaciones cubiertas.
- OAuth MCP real sigue **pendiente**: metadata HTTP responde 200 y `/mcp` exige bearer (401), pero el sandbox WSL no permite completar consentimiento y verificación de token desde Windows. La instancia BFF aislada de WSL no abrió puerto; su usuario/membresía temporal se eliminaron. No declarar OAuth E2E ni navegador verificados.

## Siguiente trabajo y límites

Pendiente con información del dueño: rangos de aprobación por monto, equivalencia de las seis áreas de Monday y tres conceptos sin responsable. También sigue pendiente aprobación Legal para proveedor IA.

Pendiente de entorno: OAuth E2E en una topología donde BFF y Keycloak se alcancen, validar staging antes de `TENANT_GUARD=enforce` productivo, RLS, credenciales de Temporal Cloud/CA/HSM, imágenes/Trivy y despliegue al clúster real.

Pendientes de producto locales aún abiertos: paginación/virtualización de listados y versionado con aprobación/vigencia para tablas de consulta. La conversión `businessRuleTask` a consulta ya está implementada, aunque las casillas históricas en `ESTADO-Y-PENDIENTES.md` deben leerse junto con esta continuidad.

La lista anterior y sus decisiones de negocio permanecen en [ESTADO-Y-PENDIENTES.md](ESTADO-Y-PENDIENTES.md); las guías de proceso y OAuth están en [PROCESS-STUDIO.md](PROCESS-STUDIO.md) y [MCP-OAUTH.md](MCP-OAUTH.md).
