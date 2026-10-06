# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Prioridad (confirmada): el operador interno.** Personas de la organización que gestionan sobres y altas de identidad: el remitente (envía solicitudes de firma) y RH (da de alta y habilita identidades). Su jornada es de **pocos sobres, pero críticos**: importa más no equivocarse y entender el estado que procesar volumen. Trabajan en escritorio *(inferido de los roles; no confirmado)*.

También importan, en menor medida (confirmado por el usuario):
- **El firmante externo.** No tiene cuenta; recibe un enlace de un solo uso y firma con Acepto, autógrafa o passkey. Probablemente desde el celular *(inferido)*.
- **El auditor o verificador.** Comprueba que una firma es íntegra y qué ocurrió con el documento, sin confiar en la interfaz.

Roles que existen en el sistema: `sender`, `rh`, `admin`, `auditor`, `signer`, `platform_admin`.

## Product Purpose

Prestige (NIX Flow, de SeguriData) permite enviar documentos a firma con identidad verificable y dejar un expediente cuya integridad se puede comprobar después. Éxito: el operador sabe en todo momento en qué estado está cada sobre y qué requiere su acción; el firmante termina; el auditor puede comprobar.

## Positioning

La confianza se **demuestra, no se afirma**: el PDF original se congela con su SHA-256, la bitácora está encadenada, el expediente trae sello de tiempo RFC 3161 y un verificador que corre sin conectarse a Prestige. Prestige tampoco etiqueta como "firma digital" nada que no sea un PAdES real.

## Operating Context

- Un sobre (solicitud de firma) lleva uno o varios firmantes, en orden secuencial o en paralelo, con métodos permitidos, política de identidad (`kycPolicy`: ninguna, una vez o en cada firma), exigencia opcional de passkey y fecha de vencimiento.
- Estados de una solicitud: pendiente, en firma, completada, rechazada, cancelada y expirada.
- Las plantillas de sobre guardan esos valores por defecto. No se editan ni se borran: se crea otra con otro nombre.
- Onboarding de identidad: consentimiento biométrico (LFPDPPP), captura de INE, prueba de vida, verificación de la INE por RH y habilitación. Sin motor biométrico decide RH (revisión manual); si el motor corrió y no pasó, RH solo habilita anulando con un motivo que queda en la auditoría.
- Después de una firma PAdES ya no se puede agregar una firma visible (autógrafa): la solicitud expone qué métodos siguen disponibles.
- El portal del firmante vive en `/firmar/[token]`.

## Capabilities and Constraints

- Idioma de la interfaz: español de México.
- Vocabulario de firma: "Acepto", "Autógrafa", "Passkey" y "firma digital" (esta última solo para el PAdES de `DigitalSignerAdapter`). Nunca "e.firma SAT" ni "FIEL".
- El certificado de firma lo emite una CA interna: la cadena **no** es de confianza pública (`trustedChain` falso). La constancia NOM-151 no existe todavía y no debe sugerirse.
- Los métodos de firma disponibles dependen del estado del documento; la UI debe ocultar o explicar los que ya no aplican.
- El expediente se descarga como ZIP (manifiesto firmado, PDF congelado, copia firmada, sello de tiempo, certificados, verificador offline).
- Decisión abierta: si la UI mostrará o no hashes y fragmentos criptográficos al operador (ver Principios).

## Brand Commitments

- Marca SeguriData: verde `#84bd00`, carbón `#191919`, pizarra `#5b6770`, niebla `#f3f3f3` y blanco; DM Sans e IBM Plex Mono. Assets en `public/brand/` (logo, marca, ilustraciones de bandeja vacía, sello de evidencia, firma y sello de tiempo).
- **La propuesta evoluciona dentro de la marca** (confirmado): se conservan logo, verde y carbón. La regla del MasterPlan es "seguir brand Prestige".
- Sensación buscada (confirmado): **seguridad verificable**.

## Evidence on Hand

Flujos reales funcionando de punta a punta, con datos de demostración (`bun run demo`) para los usuarios `maria`, `carlos` y `roberto`. Hay evidencia técnica real que la UI puede mostrar (hash del canónico, sello RFC 3161, cadena de auditoría).
No existen testimonios, nombres de clientes ni métricas de uso: no se deben inventar.

## Product Principles

1. **Mostrar la prueba.** Lo verificable se enseña de forma legible (estado, sello, cadena), no se afirma con un candado decorativo.
2. **El estado se lee de un vistazo.** De cada sobre se ve quién falta, qué vence y qué requiere acción del operador.
3. **No decir más de lo que la criptografía respalda.** Cada etiqueta de firma o de identidad corresponde a lo que el sistema realmente verificó.
4. **Claridad antes que volumen.** Pocos sobres críticos: menos riesgo de error, no más densidad.
5. **Las decisiones humanas dejan rastro y se ven como tales.** Revisión manual y anulaciones son visibles, no escondidas.
