#!/usr/bin/env bash
# Crea (o reutiliza) la cuenta de servicio con la que el BFF da de alta usuarios desde onboarding.
# Solo usa la administración estándar de Keycloak (kcadm): un cliente confidencial con "service account"
# y los roles mínimos de realm-management. No modifica el realm, sus flujos ni sus temas.
#
# Se ejecuta en el servidor, dentro de ~/prestige:
#   ONBOARDING_DEFAULT_PASSWORD='<contraseña temporal>' ./provision-onboarding-admin.sh
#
# Escribe KEYCLOAK_ADMIN_CLIENT_ID / KEYCLOAK_ADMIN_CLIENT_SECRET (y, si se pasa, ONBOARDING_DEFAULT_PASSWORD)
# en prestige.env. No imprime ningún secreto. Después: docker compose --env-file prestige.env up -d bff worker
set -euo pipefail

ENV_FILE="${ENV_FILE:-prestige.env}"
REALM="${REALM:-prestige}"
CLIENT_ID="${KEYCLOAK_ADMIN_CLIENT_ID:-prestige-onboarding-admin}"
KC="docker exec prestige-keycloak /opt/keycloak/bin/kcadm.sh"

set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

$KC config credentials --server http://localhost:8080 --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

id="$($KC get clients -r "$REALM" -q "clientId=$CLIENT_ID" --fields id --format csv --noquotes | tr -d '\r')"
if [ -z "$id" ]; then
  $KC create clients -r "$REALM" \
    -s "clientId=$CLIENT_ID" -s enabled=true -s publicClient=false \
    -s clientAuthenticatorType=client-secret -s serviceAccountsEnabled=true \
    -s standardFlowEnabled=false -s implicitFlowEnabled=false -s directAccessGrantsEnabled=false \
    -s fullScopeAllowed=false -s 'description=BFF de Prestige: alta de usuarios desde onboarding' >/dev/null
  id="$($KC get clients -r "$REALM" -q "clientId=$CLIENT_ID" --fields id --format csv --noquotes | tr -d '\r')"
fi

# Roles mínimos: administrar usuarios y leer el realm (para resolver los roles que se asignan).
$KC add-roles -r "$REALM" --uusername "service-account-$CLIENT_ID" --cclientid realm-management \
  --rolename manage-users --rolename view-users --rolename query-users --rolename view-realm

secret="$($KC get "clients/$id/client-secret" -r "$REALM" --fields value --format csv --noquotes | tr -d '\r')"
[ -n "$secret" ] || { echo "No se pudo leer el secreto del cliente" >&2; exit 1; }

set_var() { # reemplaza o agrega NAME=valor en el archivo de entorno
  local name="$1" value="$2"
  grep -v "^${name}=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE.tmp"
  cat "$ENV_FILE.tmp" > "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
}
set_var KEYCLOAK_ADMIN_CLIENT_ID "$CLIENT_ID"
set_var KEYCLOAK_ADMIN_CLIENT_SECRET "$secret"
if [ -n "${ONBOARDING_DEFAULT_PASSWORD:-}" ]; then set_var ONBOARDING_DEFAULT_PASSWORD "$ONBOARDING_DEFAULT_PASSWORD"; fi

echo "Cuenta de servicio '$CLIENT_ID' lista en el realm '$REALM'. Variables escritas en $ENV_FILE."
