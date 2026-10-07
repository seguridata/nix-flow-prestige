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

## Al subir de versión de Keycloak

`template.ftl` y `login.ftl` son copias de `keycloak.v2` 26.0.x. Al actualizar Keycloak, compáralas con las nuevas y reaplica las diferencias (el panel `<aside class="prestige-brand">`, la ausencia del bloque de modo oscuro, el subtítulo y `.prestige-note`).

Las demás pantallas (recuperar contraseña, OTP, etc.) heredan el estilo por CSS pero no tienen el panel de marca propio de cada una más allá del de `template.ftl`.
