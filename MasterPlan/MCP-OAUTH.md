# Prestige MCP con OAuth

Prestige expone un servidor MCP **Streamable HTTP** en `/mcp`, usando el SDK oficial `@modelcontextprotocol/sdk` 1.32.1. Es de solo lectura. Keycloak mantiene el login, consentimiento, sesiones y renovación de tokens; Prestige verifica firma JWKS, issuer, caducidad, audiencia del recurso, scope `prestige:read`, rol y membresía activa. Los tokens web normales no dan acceso a MCP. No se aceptan credenciales en query strings, ni se reenvían tokens a servicios externos.

## Configuración

Variables BFF (reiniciar el proceso al cambiarlas):

```dotenv
MCP_RESOURCE_URL=http://localhost:3000/mcp
MCP_ENABLED=true
MCP_AUDIENCE=http://localhost:3000/mcp
KEYCLOAK_ISSUER=http://localhost:8081/realms/prestige
# Opcional: orígenes web MCP adicionales, exactos y separados por comas.
MCP_ALLOWED_ORIGINS=http://localhost:6274
```

En producción son obligatorias URLs HTTPS. Sin `MCP_RESOURCE_URL` explícita el MCP queda desactivado en producción; `MCP_ENABLED=false` también lo desactiva en cualquier entorno. En ese estado `/mcp` y metadata devuelven 503 y `/mcp/info` informa `enabled:false` con motivo. Habilitarlo explícitamente con configuración incompleta/insegura impide el arranque con un error de configuración. Configurar la URL pública exacta, sin query o fragmento. Prestige no deriva metadatos de Host o X-Forwarded-Host. El proxy debe admitir POST `/mcp` y los dos GET de metadatos (`/.well-known/oauth-protected-resource` y `/.well-known/oauth-protected-resource/mcp`). El transporte es stateless con respuestas JSON; GET/DELETE autenticados devuelven 405 al no ofrecer sesiones/SSE persistente.

## Provisionamiento Keycloak

Ejecutar desde la raíz, con `KEYCLOAK_ADMIN_PASSWORD` transitoria en entorno (nunca en archivos):

```sh
node deploy/keycloak/provision-mcp.mjs                 # inspección, sin cambios
node deploy/keycloak/provision-mcp.mjs --sandbox --apply
```

El script solo aplica al realm `prestige` en loopback. Es repetible y crea/actualiza:

- Cliente público `prestige-mcp-client`, authorization code, PKCE S256 obligatorio y consentimiento. Desactiva password grant, implicit flow, device flow y service accounts para este cliente.
- Scope opcional `prestige:read` y audience mapper con la URL del recurso. El claim de tenant viene del atributo de usuario existente, nunca del cliente.
- Roles autorizados explícitos (admin, sender, signer, platform_admin). La membresía de base de datos también se exige en cada petición; quitarla revoca el acceso a datos aunque el token no haya expirado.
- Callbacks exactos `http://127.0.0.1:9321/callback` y `http://localhost:9321/callback`. Para un cliente MCP diferente definir `MCP_REDIRECT_URIS` con sus callbacks exactos y volver a ejecutar. No se admiten comodines. En producción configurar lo mismo en Keycloak con un administrador de ese entorno.

El script usa `admin-cli` únicamente para administración transitoria de Keycloak local; el cliente MCP nunca admite password grant. No se habilita registro dinámico público ni se instala un servidor OAuth propio. Clientes con configuración manual deben suministrar el client ID prerregistrado. Otros clientes requieren registrar sus callbacks/clientes en Keycloak antes de usarlos.

## Conexión

URL: `http://localhost:3000/mcp`, transporte Streamable HTTP, OAuth client ID `prestige-mcp-client`, scope `openid prestige:read`. El cliente descubre Keycloak desde el desafío 401 `WWW-Authenticate` y los metadatos RFC9728. Solicita `resource` igual a la URL MCP en autorización y canje de código, con PKCE S256. El usuario inicia sesión y consiente en Keycloak. Ningún token se introduce en el frontend de Prestige.

GET `/mcp/info` requiere el token web normal y rol admin/platform_admin; entrega configuración pública para la pantalla Conexiones, sin secretos.

## Herramientas

| Herramienta | Datos y límites |
|---|---|
| `prestige_list_processes` | Última versión publicada por proceso del tenant; metadatos, sin XML ni reglas internas. |
| `prestige_list_formats` | Formatos publicados del tenant, tipo y proceso relacionado; sin campos sensibles ni objetos de almacenamiento. |
| `prestige_my_requests` | Solicitudes del solicitante, dueño del expediente o participante autenticado; estado y ejecución resumidos. |
| `prestige_my_tasks` | Tareas activas asignadas a ese usuario; prioridad y vencimiento. |
| `prestige_request_status` | Estado de una solicitud visible para ese usuario y sus propias tareas; no expone errores de infraestructura ni identidades de otros firmantes. |

Listados acotados a `limit` entre 1 y 50 (20 por defecto). Los argumentos adicionales se rechazan. No hay herramientas para publicar, firmar, aprobar, eliminar, descargar PDFs, consultar tablas administrativas ni leer credenciales. Las anotaciones readOnly son descriptivas: la protección real son consultas selectivas sin escrituras y filtros tenant/actor.

## Verificación reproducible

Con BFF y Keycloak activos y el cliente provisionado:

```sh
node backend/bff/scripts/verify-mcp-oauth.mjs
```

Abrir la URL de autorización que imprime el script y completar login/consentimiento. El callback local comprueba state y canjea el código con el verifier PKCE en memoria. Verifica metadata/401, negociación MCP, cinco herramientas, llamadas reales a los cuatro listados y rechazo de tenant ajeno y Origin hostil. No imprime ni almacena tokens o contraseñas. Timeout 5 minutos. La prueba requiere un usuario real con membresía activa; no genera datos sintéticos ni suplanta firmas.

## Referencias oficiales

- [MCP Authorization 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): discovery de recurso, audience binding, preregistro y PKCE.
- [SDK TypeScript oficial](https://github.com/modelcontextprotocol/typescript-sdk): transporte Streamable HTTP y schemas de protocolo.
- [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers) y [administración](https://www.keycloak.org/docs/latest/server_admin/index.html): discovery, clientes públicos, audience mappers y PKCE.
