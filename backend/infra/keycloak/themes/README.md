> **Fuente de la verdad (17 oct 2026):** la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa) manda sobre estado, pendientes y decisiones. El [espejo en el repo](../../../../MasterPlan/ESTADO-Y-PENDIENTES.md) lo replica; los documentos históricos y las especificaciones técnicas conservan su alcance.

# Tema de login de Prestige (Keycloak)

Tema `prestige` (login) sobre `keycloak.v2`: panel carbón con la propuesta de valor y formulario a la derecha, en español. Siempre claro (no sigue el modo oscuro del sistema).

## Cómo se activa

- `docker-compose.yml` monta `infra/keycloak/themes` en `/opt/keycloak/themes`.
- `prestige-realm.json` fija `loginTheme: prestige` y el idioma `es`. **El import solo corre al crear el realm**: en un Keycloak que ya existe hay que aplicarlo a mano:

```bash
docker exec <contenedor-keycloak> /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin
docker exec <contenedor-keycloak> /opt/keycloak/bin/kcadm.sh update realms/prestige \
  -s loginTheme=prestige -s displayName=Prestige \
  -s internationalizationEnabled=true -s 'supportedLocales=["es"]' -s defaultLocale=es
```

(o en la consola: *Realm settings → Themes → Login theme: prestige* y *Localization*).

Con `start-dev` no hay caché de temas: los cambios en CSS y plantillas se ven al recargar.

## Archivos

| Archivo | Para qué |
|---|---|
| `login/theme.properties` | Hereda de `keycloak.v2` y apila `fonts.css` y `prestige.css`. |
| `login/template.ftl` | Copia de la plantilla base más el panel de marca. Sin script de modo oscuro. |
| `login/login.ftl` | Copia de la base más subtítulo y aviso para firmantes externos. |
| `login/messages/messages_{es,en}.properties` | Textos del panel y overrides (`loginAccountTitle`, `usernameOrEmail`). |
| `login/resources/css/prestige.css` | Estilos de marca (carbón `#191919`, verde `#84BD00` solo como acento). |
| `login/resources/fonts/` | IBM Plex autoalojada (SIL OFL 1.1), subconjunto latin. El login no llama a Google Fonts. |

## Tema por tenant: Tecate (demo de multitenancy)

`prestige-tecate` muestra cómo un segundo cliente tiene su propia marca sin tocar el código de la app. Es un tema **hijo** de `prestige` (`parent=prestige`): hereda plantilla, fuentes y textos, y solo cambia la paleta y agrega el logo. La marca **«PRESTIGE por SeguriData»** se conserva igual que en el original.

| Pieza | Valor |
|---|---|
| Paleta | Rojo `#E3121A` (muestreado del logo entregado), plata `#C9CED3`, negro y blanco. Sustituye al verde de SeguriData. No hay especificación oficial pública de la marca. |
| Archivos | `prestige-tecate/login/theme.properties`, `css/tecate.css`, `img/tecate-logo.png`, `messages/messages_{es,en}.properties` (solo 3 textos propios). |
| Logo | PNG transparente: va sobre una tarjeta blanca con borde plateado porque el águila y el sombreado son negros. |
| Cliente OIDC | `prestige-web-tecate`, con el atributo `login_theme=prestige-tecate`. El tema se asigna **por cliente**, no por realm. |
| Tenant | Slug `tecate`. El usuario lleva el atributo `tenant=tecate`, que el token expone como claim y el BFF resuelve con `TenantContextGuard`. |
| Usuario | Un solo administrador: `tecate-admin`, rol `admin` (nunca `platform_admin`), grupo `tecate`. |

### Cómo se activa en un sandbox

```bash
# 1) Keycloak: cliente, grupo y usuario (idempotente; sin --apply solo describe)
KEYCLOAK_URL=http://localhost:8081 KEYCLOAK_ADMIN_PASSWORD=... TECATE_ADMIN_PASSWORD=... \
  node backend/bff/prisma/scripts/provision-tecate-demo.mjs --sandbox --apply

# 2) Prestige: tenant y membresía (desde backend/bff, en WSL)
bun run bootstrap:tenant -- --tenant tecate --tenant-name Tecate --user-id tecate-admin \
  --roles admin --name "Administrador Tecate" --email admin@tecate.example
```

La contraseña del administrador se pasa por entorno y no se guarda en el repo. Un realm nuevo ya trae el cliente por `prestige-realm.json`; el usuario y el tenant siguen requiriendo los dos pasos.

### Cómo se ve

- `http://localhost:3001/login?tenant=tecate` (o `/api/auth/login?tenant=tecate`) abre Keycloak con el cliente de Tecate y su tema.
- Sin `tenant`, o con un tenant desconocido, se usa `prestige-web` y el tema original. La lista de clientes por tenant es cerrada (`OIDC_TENANT_CLIENTS` en el frontend, por defecto `tecate=prestige-web-tecate`): el navegador no puede elegir un `client_id` arbitrario.
- Si `KEYCLOAK_AUDIENCE` está definida en el BFF, debe incluir ambos clientes separados por coma (`prestige-web,prestige-web-tecate`).

### Límites del aislamiento

El aislamiento de datos es el de siempre: claim `tenant` + membresía en `TenantMembership`. El tema por cliente es solo marca; no impide que un usuario de otro tenant abra la pantalla de Tecate (si entra, su token trae su propio tenant y ve sus propios datos). Un realm por tenant daría aislamiento total de identidades, pero el BFF valida un solo emisor y habría que soportar varios.

## Al subir de versión de Keycloak

`template.ftl` y `login.ftl` son copias de `keycloak.v2` 26.0.x. Al actualizar Keycloak, compáralas con las nuevas y reaplica las diferencias (el panel `<aside class="prestige-brand">`, la ausencia del bloque de modo oscuro, el subtítulo y `.prestige-note`).

Las demás pantallas (recuperar contraseña, OTP, etc.) heredan el estilo por CSS pero no tienen el panel de marca propio de cada una más allá del de `template.ftl`.
