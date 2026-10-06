# Propuesta de UI de Prestige: "mostrar la prueba"

Maquetas y traspaso de la propuesta del 5 de octubre de 2026. Las imágenes son **maquetas con datos sintéticos** (nombres, hashes y fechas inventados), generadas en Higgsfield (GPT Image 2.5, calidad alta 2k). Sirven como referencia de calidad y de estructura, no como contrato pixel a pixel.

Contexto de producto: [`../../PRODUCT.md`](../../PRODUCT.md).
Versión navegable de la propuesta: https://claude.ai/artifact/QPiyiiPZ85qKWQoxPWhqF8 (privada, la comparte su dueño).

## Decisiones confirmadas
- Alcance: bandeja, portal del firmante, onboarding de identidad y evidencia.
- Marca: **evolucionar dentro de SeguriData** (verde `#84bd00`, carbón `#191919`, pizarra `#5b6770`, niebla `#f3f3f3`; DM Sans e IBM Plex Mono). Un solo acento.
- Usuario prioritario: el operador interno, con pocos sobres pero críticos.
- Dolor principal: no se ve de un vistazo el estado de los sobres (y un poco, que se ve genérico).
- Sensación buscada: seguridad verificable.

## Las cuatro superficies
| Archivo | Superficie | Estado |
|---|---|---|
| `01-bandeja.jpg` | Bandeja del operador | **Construida** en el PR #5 (`app/inbox/page.tsx`, `components/inbox/`). Sin ver en navegador. |
| `02-portal-firmante-movil.jpg` | Portal del firmante externo (`/firmar/[token]`), móvil | Solo maqueta |
| `03-onboarding-identidad.jpg` | Onboarding de identidad (RH) | Solo maqueta. El diálogo de anulación y el modo de revisión ya están en el código (PR #3). |
| `04-evidencia-verificacion.jpg` | Evidencia y verificación | Solo maqueta |

## Defectos de las maquetas que NO se deben copiar
- Portal: la fila "Autógrafa" deshabilitada trae la etiqueta "DISPONIBLE" (contradice su texto) y el consentimiento viene marcado de origen; debe empezar sin marcar.
- Los hashes salen con ".." en lugar de "…".
- Encabezados en mayúsculas ("LÍNEA DE EVIDENCIA", "CADENA DE CUSTODIA", cabeceras de tabla): se pueden quitar.
- Bandeja: tres filas con el mismo riel se leen como tarjetas repetidas; la que requiere acción debe pesar más.
- Onboarding: la placa de la INE imita el formato oficial; en la UI real va la imagen capturada.

## Lo que falta para cada superficie
- **Bandeja:** probarla con `bun run dev` y `bun run demo` (capturas de escritorio y móvil, contraste con datos reales). Falta el vencimiento ("vence en 2 días"): `/me/inbox` y `/me/sent` no devuelven `expiresAt`, requiere cambio de backend. No hay vista móvil propia del panel de evidencia (se apila debajo de la lista).
- **Portal del firmante:** hoy no muestra el PDF; la huella verificada necesita el contenido o un endpoint que la entregue. Aplicar la regla de `allowedMethodsNow` para explicar el método no disponible.
- **Onboarding:** reutilizar `reviewMode` (`engine`, `manual`, `manual-override`) que ya guarda la auditoría `SIGNER_ENABLED`.
- **Evidencia:** la pantalla necesita el desglose de comprobaciones del servidor. El verificador real devuelve menos detalle que los cinco chequeos de la maqueta. La nota de la CA interna y de la ausencia de NOM-151 es una afirmación verdadera y debe mantenerse.

## Reglas que ya salieron de esta propuesta
- "Íntegro" solo se muestra si el verificador del servidor lo confirmó (sobre completado). En un sobre abierto solo se afirma que el documento está congelado.
- El estado nunca depende solo del color: forma (check, aro grueso, cruz) y texto.
- El verde `#84bd00` no alcanza contraste como color de texto sobre blanco: usarlo como relleno, con texto en carbón.
- Sin eyebrows, sin numeración decorativa, sin efecto glass, una sola entrada animada como máximo.

## Cómo retomar
1. Levantar el stack: `bun run dev` y `bun run demo`; entrar a `http://localhost:3001` (usar `localhost`, no `127.0.0.1`).
2. Revisar el PR #5 y tomar capturas de la bandeja en escritorio (1440) y móvil (390).
3. Elegir la siguiente superficie. Recomendado: el portal del firmante, que es lo que ve cada contraparte.
4. Para generar nuevas maquetas con el mismo lenguaje, partir de los tokens de arriba y de `app/globals.css`.
