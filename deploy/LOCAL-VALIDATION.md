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
