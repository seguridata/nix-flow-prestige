# P2 — Firma digital real en KMS/HSM (una página)

> Fuera de alcance del paquete P1, y sigue fuera del hardening de `fix/p1-hardening` (2026-10-05). P1 está cerrado. La regla de oro vigente está en `00-FASES.md`: el canónico no se muta y `DIGITAL` ya es PAdES/CAdES con CA propia. P2 es sustituir esa CA de software por un HSM real y cerrar la constancia. No es construir PAdES desde cero.

## Qué cambia respecto a hoy

| Hoy (CA de software) | P2 (KMS/HSM) |
|---|---|
| `SoftwareKeyCustodian` genera y guarda la clave privada en disco (`PKI_DIR`), cifrada con `PKI_PASSPHRASE` | La clave privada nunca sale del HSM/KMS; solo se invoca una operación de firma |
| CA raíz + intermedia propias del proyecto | Certificado emitido por una CA que Adobe/Acrobat reconozca (AATL) o por la PSC de SeguriData |
| `Pkcs11KeyCustodian` existe como interfaz pero lanza "servicio no disponible" | `Pkcs11KeyCustodian` se conecta a un módulo PKCS#11 real (slot + PIN) |

## Qué NO cambia

- El contrato `SignerAdapter`/`KeyCustodian` ya está detrás de interfaz (`backend/bff/src/signing/pki/key-custodian.ts`) — sustituir la implementación no debería tocar `SigningRouter`, `DigitalSignerAdapter` ni el pipeline de `signature-requests.service.ts`.
- El formato de firma sigue siendo PAdES-B / CAdES-detached (`@signpdf`), ya validado con `openssl verify` y el verificador offline propio.
- El sello de tiempo RFC 3161 ya es real (Fase B); P2 solo necesita decidir si la TSA usada es de confianza pública (`trustedChain: true`) — hoy es `false` porque la CA es propia.

## Trabajo concreto de P2

1. **Custodio HSM real**: implementar `Pkcs11KeyCustodian` contra un HSM/KMS (AWS KMS, Azure Key Vault, o PKCS#11 físico). Algoritmo `ECDSA_P256` (o el que el HSM elegido soporte) en vez de RSA de software.
2. **Cadena de confianza pública**: certificado del firmante encadenando a una raíz en el trust store de Adobe (AATL) o a la PSC acreditada de SeguriData — no la CA interna del taller.
3. **OCSP/CRL**: incrustar material de validación de largo plazo (LTV) en el PDF para que Acrobat valide sin conexión ni ancla manual.
4. **Constancia NOM-151**: contratar y conectar un prestador de servicios de certificación (PSC) que emita la constancia real; el manifiesto ya tiene los campos `timestampProvider`/`timestampTokenHash` listos para recibirla.
5. **Verificar el pack**: el verificador offline (`verifier/verify.mjs`) y `EvidenceService.verify()` deben aceptar la nueva cadena de confianza sin cambiar su lógica de comparación de hashes — solo la validación de la cadena X.509 cambia de "propia" a "pública".

## Riesgo de no hacerlo en orden

P1 ya cerró freeze y tenant. Firmar con HSM hereda esa base: el canónico no se reescribe y la petición lleva el slug del guard. P2 no se mete en el mismo PR que el hardening de `fix/p1-hardening`.
