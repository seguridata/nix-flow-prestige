> **Fuente de la verdad (17 oct 2026):** la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa) manda sobre estado, pendientes y decisiones. [`ESTADO-Y-PENDIENTES.md`](ESTADO-Y-PENDIENTES.md) es su espejo en el repo.

# MasterPlan — índice

Esta carpeta guarda la documentación técnica vigente de Prestige. El estado y los pendientes **no** viven aquí a mano: se mantienen en Notion y se replican en `ESTADO-Y-PENDIENTES.md`. Los planes por sprint, los reportes de auditoría y las bitácoras de sesión se eliminaron el 17 oct 2026 por desfasados; siguen en el historial de Git.

Orden de lectura para retomar:

1. [`ESTADO-Y-PENDIENTES.md`](ESTADO-Y-PENDIENTES.md): dónde estamos, qué falta, decisiones tomadas y reglas de trabajo.
2. [`AGENTS.md`](AGENTS.md): reglas para quien programa.
3. [`REQUERIMIENTO-Y-DECISIONES.md`](REQUERIMIENTO-Y-DECISIONES.md): lo que pidió el dueño tal cual y las decisiones D1–D10 que no se re-litigan.

Referencia técnica:

| Documento | Qué explica |
| --- | --- |
| [`SPEC.md`](SPEC.md) | Contrato técnico con el que se cerró P1 (auth, tenants, freeze, firma, evidencia). |
| [`DATA-MODEL.md`](DATA-MODEL.md) | Modelo de datos pedido y diferencias con el esquema real. |
| [`ARQUITECTURA-MULTITENANT-Y-ESCALA.md`](ARQUITECTURA-MULTITENANT-Y-ESCALA.md) | Aislamiento por tenant, cuellos de botella y ruta de escala. |
| [`ADR-008-TABLAS-DE-CONSULTA-Y-ADJUNTOS.md`](ADR-008-TABLAS-DE-CONSULTA-Y-ADJUNTOS.md) | Tablas de consulta, formatos digitales y anexos. |
| [`PROCESS-STUDIO.md`](PROCESS-STUDIO.md) | De un proceso a una solicitud real: catálogo, constructor, laboratorio y versiones. |
| [`MCP-OAUTH.md`](MCP-OAUTH.md) | Servidor MCP de lectura con OAuth/PKCE y cómo validarlo. |
| [`PAGINACION-BANDEJA.md`](PAGINACION-BANDEJA.md) | Paginación por cursor de formatos, bandeja y enviados. |
| [`P2-KMS.md`](P2-KMS.md) | Paso a HSM/PKCS#11 y constancia, cuando se abra. |

Documentación fuera de esta carpeta: `README.md` raíz (cómo levantar el stack), `deploy/` (Kubernetes y validación local), `backend/infra/` (correo, despliegue por tenant, interoperabilidad Adobe), `Documentacion/` (informes de definición, arquitectura, stack, seguridad, procesos y multitenant) y `docs/datos-sensibles.md`.
