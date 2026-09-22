# Correo saliente (M13)

El BFF **no** habla SMTP directo con Internet: encola cada mensaje en
`NotificationOutbox` y un despachador (`NotificationDispatcher`, cada 15 s) lo
entrega vía `nodemailer` contra `SMTP_*`. Reintentos con backoff exponencial
(1, 2, 4, 8, 16, 30 min); tras `maxAttempts` (6) el mensaje pasa a **DLQ** y se
inspecciona/reintenta desde `GET/POST /notifications/outbox*` (rol `admin`).

## Local

`docker compose … up -d` levanta **Mailpit**:

- SMTP: `localhost:1025` (sin auth, `MP_SMTP_AUTH_ACCEPT_ANY`)
- UI / API: <http://localhost:8025> (todos los correos, sin salir a Internet)

`.env` local:

```
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
MAIL_FROM=Prestige <no-reply@prestige.seguridata.mx>
PUBLIC_WEB_URL=http://localhost:3001
```

## Producción

Usar un relay/MTA administrado (SES, Sendgrid, Postmark, o el MTA de SeguriData).
`SMTP_SECURE=true` + `SMTP_USER`/`SMTP_PASS`. El dominio de `MAIL_FROM` debe
publicar los tres registros de autenticación:

### SPF (TXT en el dominio de envío)

```
prestige.seguridata.mx.  IN TXT  "v=spf1 include:<relay-spf> -all"
```

Incluir el `include:` del proveedor (p. ej. `include:amazonses.com`). `-all`
(fail duro) una vez verificado que todo el correo legítimo pasa por el relay.

### DKIM (CNAME/TXT que da el proveedor)

Firmar con selector propio, clave ≥ 2048 bits. El proveedor entrega 1–3
registros `CNAME` (`<selector>._domainkey.prestige.seguridata.mx`) o un `TXT`
con `v=DKIM1; k=rsa; p=<pubkey>`. Rotar el selector al menos una vez al año.

### DMARC (TXT en `_dmarc`)

```
_dmarc.prestige.seguridata.mx.  IN TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@seguridata.mx; ruf=mailto:dmarc@seguridata.mx; fo=1; adkim=s; aspf=s"
```

Empezar en `p=none` con `rua` para recibir reportes agregados; subir a
`quarantine` y luego `p=reject` cuando SPF y DKIM alineen el 100 % del volumen
legítimo durante 2–4 semanas.

### Operación

- Monitorear la DLQ (`GET /notifications/outbox/dlq`) y los reportes DMARC.
- `MAIL_FROM` con un buzón real que atienda rebotes y quejas (`abuse@`, `postmaster@`).
- Los enlaces de un solo uso (`OneTimeLink`) caducan a los 14 días por defecto
  (`ttlHours`); ajustar por política de la solicitud.
