# Keycloak de producción de Prestige: imagen OPTIMIZADA (build previo) para arrancar con `start --optimized`.
# Contexto de build = raíz del monorepo:
#   docker build -f deploy/keycloak/Dockerfile -t prestige-keycloak:26.0 .
FROM quay.io/keycloak/keycloak:26.0 AS builder
# Opciones de build (no se pueden cambiar en runtime con --optimized).
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true
COPY backend/infra/keycloak/themes /opt/keycloak/themes
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.0
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
