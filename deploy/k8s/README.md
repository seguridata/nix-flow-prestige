> **Fuente de la verdad (17 oct 2026):** la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa) manda sobre estado, pendientes y decisiones. El [espejo en el repo](../../MasterPlan/ESTADO-Y-PENDIENTES.md) lo replica; los documentos históricos y las especificaciones técnicas conservan su alcance.

# Despliegue en Kubernetes

Estado: los manifiestos **no se han aplicado a ningún clúster**. YAML validado; imagen y Compose de Keycloak probados localmente con PostgreSQL y discovery OIDC HTTP 200 (2026-10-16).
No hay material criptográfico ni credenciales reales en esta carpeta: todo es `CHANGE_ME`/`example.com`.

## Estructura

| Ruta | Contenido |
|---|---|
| `base/` | BFF, worker, front, HPA, PDB, Job de migraciones, Ingress, NetworkPolicy, PVC de firmantes |
| `pki/pki-secret.example.yaml` | Forma del Secret `prestige-pki` (ejemplo, no se aplica) |
| `keycloak/` | Keycloak de producción + Postgres propio (`start --optimized`) |
| `overlays/pkcs11/` | Variante KMS/HSM (`KEY_CUSTODIAN=pkcs11`) |
| `base/config.example.yaml` | ConfigMaps y lista de claves de `prestige-secrets` (ejemplo) |
| `../keycloak/` | `Dockerfile` optimizado, realm de producción y su generador |
| `../../backend/docker-compose.prod.yml` | Keycloak de producción sin Kubernetes |

## Orden de despliegue

1. Namespace: `kubectl create namespace prestige`.
2. Construir y publicar imágenes: `prestige-bff` (`backend/bff/Dockerfile`), `prestige-web`, `prestige-keycloak` (`deploy/keycloak/Dockerfile`, contexto = raíz del repo). Fijar por digest.
3. Secrets y ConfigMaps (ver `base/config.example.yaml`): `prestige-secrets`, `prestige-web-secrets`, `prestige-config`, `prestige-web-config`, `prestige-pki`, `keycloak-secrets`, `keycloak-realm`. Mejor con External Secrets.
4. Keycloak: `kubectl apply -k deploy/k8s/keycloak`; esperar `kubectl -n prestige rollout status deploy/keycloak`. Después crear usuarios y asignar el atributo `tenant`.
5. Base: `kubectl apply -k deploy/k8s/base`. El Job `prestige-migrate` corre `prisma migrate deploy` una vez (hook PreSync/pre-upgrade con Argo CD/Helm; con `kubectl apply` simple, esperar `kubectl wait --for=condition=complete job/prestige-migrate` antes de escalar el BFF).
6. Verificar `GET /operations/health/ready` por réplica y que todas firmen con la misma CA.

## PKI compartida por todas las réplicas

El BFF monta el Secret `prestige-pki` de solo lectura en `/app/backend/bff/pki` (`PKI_DIR=./pki`). En producción el BFF **no genera CA**: si falta, falla cerrado. Las claves del Secret se colocan con `items` en `ca/root.cert.pem`, `ca/intermediate.cert.pem`, `ca/intermediate.key.pem`, `manifest-signing.key.pem` y `manifest-signing.pub.pem`. La llave privada de la raíz no se monta: guardarla fuera de línea.

Crear el Secret desde archivos generados fuera del clúster (p. ej. `bun run pki:init` en una máquina segura, que escribe en `backend/bff/pki/`):

```sh
kubectl -n prestige create secret generic prestige-pki \
  --from-file=root.cert.pem=ca/root.cert.pem \
  --from-file=intermediate.cert.pem=ca/intermediate.cert.pem \
  --from-file=intermediate.key.pem=ca/intermediate.key.pem \
  --from-file=manifest-signing.key.pem=manifest-signing.key.pem \
  --from-file=manifest-signing.pub.pem=manifest-signing.pub.pem
```

Luego destruir las copias locales de las llaves. `PKI_PASSPHRASE` va en `prestige-secrets`.

**P12 de firmantes.** El custodio de software emite un P12 por tenant y firmante en runtime. Un Secret de solo lectura no sirve para eso, y con disco local cada réplica emitiría un certificado distinto. Por eso se añadió `PKI_SIGNERS_DIR` (cambio mínimo en `backend/bff/src/signing/pki/software-key-custodian.ts`; sin la variable el comportamiento no cambia) y el PVC `prestige-signers` (RWX, `base/platform.yaml`) montado en `/var/lib/prestige/signers`. Requiere una `storageClass` RWX cifrada en reposo (ajustar `storageClassName`). Los P12 dependen de `PKI_PASSPHRASE` y de la intermedia: respaldarlos juntos.

### KMS / PKCS#11

`kubectl apply -k deploy/k8s/overlays/pkcs11` pone `KEY_CUSTODIAN=pkcs11` (`backend/bff/src/signing/signing.module.ts`) y las variables `PKCS11_MODULE`, `PKCS11_SLOT`, `PKCS11_KEY_LABEL` y `PKCS11_PIN` (esta última desde el Secret `prestige-pkcs11`: `kubectl -n prestige create secret generic prestige-pkcs11 --from-literal=PKCS11_PIN=...`). Con pkcs11 la llave del firmante no sale del token y no se usa el PVC de firmantes. Requisitos pendientes (ver `MasterPlan/P2-KMS.md`): módulo PKCS#11 del proveedor dentro de la imagen, paquete `graphene-pk11` (no está en `package.json`), certificado de una CA reconocida y un módulo accesible desde el clúster. `manifest-signing.*` (Ed25519) sigue viniendo del Secret `prestige-pki`. Con red por HSM de red, abrir el egress correspondiente en `egress-backends`.

## Keycloak de producción

Frente al compose de desarrollo (`start-dev`, admin/admin, usuarios demo) esta configuración usa `start --optimized` sobre una imagen construida con `kc.sh build`, `KC_HOSTNAME` fijo y estricto, `KC_PROXY_HEADERS=xforwarded` con `KC_HTTP_ENABLED=true` (TLS en el Ingress/proxy), Postgres propio, admin inicial por `KC_BOOTSTRAP_ADMIN_*` desde Secret y sin usuarios demo. El compose `backend/docker-compose.prod.yml` hace lo mismo sin Kubernetes.

Realm sin usuarios demo: `deploy/keycloak/prestige-realm.prod.json` se genera desde el realm de desarrollo (sin `users`, `sslRequired: external`, redirect URIs del origen indicado, sin direct access grants):

```sh
node deploy/keycloak/make-prod-realm.mjs https://prestige.example.com
kubectl -n prestige create configmap keycloak-realm --from-file=prestige-realm.json=deploy/keycloak/prestige-realm.prod.json
```

`--import-realm` solo importa si el realm no existe. Tras el primer arranque: cambiar la contraseña del admin bootstrap, crear usuarios reales con el atributo `tenant` (el BFF toma el tenant del token) y asignar roles. Mantener `KEYCLOAK_ISSUER` igual a `KC_HOSTNAME` + `/realms/prestige`. Más de una réplica de Keycloak requiere caché distribuida: no está configurada.

## Pendientes documentados (no implementados: requieren decisión)

- **Temporal Cloud implementado; conexión real pendiente.** API, reconciliador y worker comparten `temporal/connection-config.ts`. Configurar `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TLS=true` y `TEMPORAL_API_KEY` en Secret. Alternativa mTLS: `TEMPORAL_TLS_CERT_PATH` y `TEMPORAL_TLS_KEY_PATH` apuntan a archivos montados desde Secret; `TEMPORAL_TLS_CA_PATH` es opcional. No combinar API key y mTLS. `TEMPORAL_TASK_QUEUE` debe coincidir entre BFF y workers; no cambiar de cola workflows activos sin mantener sus workers. Desarrollo conserva localhost:7233 y cola prestige. Hace falta cuenta/namespace/credencial real para verificar Cloud.
- **MinIO sin root implementado en Compose.** El proceso usa UID 100/GID 101; un job inicial ajusta el volumen existente sin borrar objetos. `minio-init` crea una identidad de aplicación y adjunta `deploy/minio/prestige-app.json` limitada a prestige-docs, sin administración ni bypass de retención. Suministrar `S3_ACCESS_KEY`/`S3_SECRET_KEY` distintos de root al Compose y al BFF del host mediante gestor de secretos/entorno. Aplicar con `docker compose up -d minio-init`; verificar permisos antes de reiniciar el BFF con las nuevas credenciales. Producción gestionada requiere IAM equivalente del proveedor.
- **Egress**: `egress-backends` en `base/platform.yaml` sigue abierto a 0.0.0.0/0 en 5432/6379/7233/443/587; sustituir por los CIDR reales.
- **Keycloak HA y Postgres gestionado**, y `storageClassName` RWX: dependen del clúster elegido.

## Validación

`deploy/` se valida parseando todos los YAML (y `kubectl apply --dry-run=client` si hay `kubectl`). Ver el reporte de la entrega: no se aplicó a un clúster.

## CI de imágenes

El job `images` construye BFF, web y Keycloak y ejecuta Trivy. Falla por vulnerabilidades HIGH/CRITICAL con arreglo disponible; no publica imágenes. `.dockerignore` excluye secretos y PKI del contexto. Publicación por digest y despliegue requieren registro y clúster reales.
