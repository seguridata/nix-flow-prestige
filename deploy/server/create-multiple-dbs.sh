#!/bin/bash
# Crea una base de datos por cada nombre listado en POSTGRES_MULTIPLE_DATABASES.
# Postgres ya crea la base POSTGRES_USER/POSTGRES_PASSWORD por defecto (named
# after POSTGRES_USER); este script agrega las demas (keycloak, prestige, temporal).
set -euo pipefail

if [ -z "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
  exit 0
fi

echo "Creando bases de datos: ${POSTGRES_MULTIPLE_DATABASES}"

for db in $(echo "${POSTGRES_MULTIPLE_DATABASES}" | tr ',' ' '); do
  echo "  -> ${db}"
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" <<-EOSQL
    SELECT 'CREATE DATABASE ${db}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\gexec
    GRANT ALL PRIVILEGES ON DATABASE ${db} TO "${POSTGRES_USER}";
EOSQL
done
