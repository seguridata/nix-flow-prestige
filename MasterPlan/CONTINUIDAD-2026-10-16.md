# Continuidad de Claude — 16 de octubre de 2026

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

1. Recuperar WSL y suficiente espacio; levantar con `bun run dev -- --no-demo` (no recrear usuarios ficticios).
2. Reiniciar BFF con nuevo código y credenciales MinIO. Repetir verificación HTTP con draygoza y ejecutar seed del formato de gastos con la nueva modalidad.
3. Probar UI real: borradores → revisión → guardar FORM, y anexos → envío → descarga autorizada.
4. Ejecutar build y escaneo de imágenes con espacio suficiente; verificar colector OTLP.

## Pendientes que siguen abiertos

El usuario confirmó dejar pendientes **rangos de aprobación por monto, equivalencias de seis áreas y servidor/clúster destino**. También faltan aprobación legal IA, proveedor biométrico/Seguriliv y credenciales/certificados de producción.

Siguen abiertos en código: RLS, validación de operaciones unique de la guarda, cuotas por tenant, colas por tier, OCR/biometría/estampado en Temporal, pooling dimensionado, branding/CA/keyId por tenant, paginación/virtualización general, versiones y aprobación de tablas, fuentes externas sincronizadas, asistente Excel, conversiones de los otros procesos, conjunto real de evaluación IA y MCP de solo lectura. Exportar/purgar tenants no se ejecutó y la purga necesita autorización explícita. **Esta tanda no cierra todo el backlog.**
