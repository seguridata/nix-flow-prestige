# ADR-008 — Tablas de consulta, formatos digitales y adjuntos

Estado: aprobado por el producto el 2026-10-16. Implementación por fases (ver §9).

## 1. Problema

El proceso de Adquisiciones (SD-ADMINFINANZAS-03) necesita que, **al llenar la solicitud**, el sistema sepa solo a quién se envía cada paso
(según área, tipo y concepto de gasto, monto…) consultando una tabla, y que la solicitud lleve **anexos** (≥3 cotizaciones).
La primera versión resolvió esto con una tabla hecha a la medida (`ExpenseResponsible`) y un participante `matrix`. Esa solución no sirve
para otros procesos que también consultan una fuente de datos. Este ADR la generaliza.

## 2. Principios

1. **Solo un administrador** crea o edita tablas de consulta, formatos y flujos. Un usuario normal **nunca ve las tablas**: solo ve los formatos
   publicados, los llena y adjunta lo que pide el formato. El sistema resuelve solo a quién va cada paso y cómo.
2. Todo es **multitenant** (`tenantId` del guard en toda lectura y escritura) y **sin estado en el proceso**.
3. Lo que decide a quién se envía algo es configuración sensible: cada cambio se **audita** (AuditChain, con `tenantId` y `actorId`).
4. El resultado de una consulta se **congela** al crear la solicitud (qué tabla, qué revisión, qué fila): cambiar la tabla después no altera
   solicitudes en curso. Queda en un evento de auditoría `LOOKUP_RESOLVED`.
5. La IA propone, nunca publica (ADR-006). Fuera de alcance de este ADR: asistente de Excel a tabla.

## 3. Tabla de consulta

`LookupTable` (por tenant, `key` único) con `columns` tipadas y filas `LookupRow` con `values` (JSON por clave de columna) y `position`
(orden de evaluación; **gana la primera fila que coincide**, el administrador ordena de lo más específico a lo más general).

Columna: `{ key, label, type: 'text' | 'number' | 'date' | 'select', options?: string[] }`. Claves con la misma regla que las variables
(`^[A-Za-z][A-Za-z0-9_]{0,39}$`). Máximo 30 columnas y 5000 filas por tabla. `revision` sube con cada cambio de columnas o filas.

## 4. Operadores

Una condición se lee **«valor de la solicitud» OPERADOR «valor de la fila»**:

| op | Se lee | Notas |
|---|---|---|
| `eq` / `neq` | es igual a / es diferente de | texto sin distinguir mayúsculas ni acentos; números y fechas por valor |
| `gt` `gte` `lt` `lte` | mayor que / mayor o igual / menor que / menor o igual | solo `number` y `date` |
| `contains` / `notContains` | contiene / no contiene | el valor de la solicitud contiene el texto de la fila |
| `startsWith` / `endsWith` | empieza con / termina con | texto |
| `in` / `notIn` | está en la lista / no está en la lista | la celda trae una lista separada por `;` o `,` |
| `isEmpty` / `isNotEmpty` | está vacío / no está vacío | sin fuente de comparación |

`emptyMatchesAny` (por defecto `true`): si la celda de la fila está vacía, esa condición se cumple («cualquiera»). Así una fila de
«responsable de Marketing» no necesita llenar el monto. Un rango se expresa con dos condiciones: `monto gte montoMin` y `monto lte montoMax`.

## 5. Modelo de flujo

```ts
type LookupOp = 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'contains'|'notContains'|'startsWith'|'endsWith'|'in'|'notIn'|'isEmpty'|'isNotEmpty';
interface LookupCondition { column: string; op: LookupOp; source?: { var: string } | { value: string | number }; emptyMatchesAny?: boolean }
interface LookupQuery { table: string /* key de la tabla */; match: LookupCondition[] }

// Nuevo participante (reemplaza a `matrix`):
{ type: 'lookup'; query: LookupQuery; person: { signerId: string; name?: string; email?: string } /* claves de columna */; prompt: string }

// Variables derivadas de una tabla (se calculan antes de decidir qué pasos aplican; sirven en `when`):
Flow.derived?: Array<{ key: string; label: string; type: VarType; query: LookupQuery; column: string; onMiss?: 'empty' | 'fail' }>
```

- Sin coincidencia: el participante `lookup` cae a «preguntar» con `prompt`; la variable derivada queda vacía (`onMiss:'empty'`) o la creación falla (`'fail'`).
- `validateFlow` verifica que las columnas y variables citadas existan en la definición (las tablas se validan al crear el formato: la tabla debe existir y estar activa).
- El tipo `matrix` desaparece; el flujo de Adquisiciones y los datos migran a `lookup`.

## 6. API (todo `@Roles('admin')`; no hay endpoint público de consulta)

```
GET    /lookup-tables                          → [{id,key,name,description,columns,revision,active,rowCount}]
POST   /lookup-tables {key,name,description?,columns[]}
GET    /lookup-tables/:id
PUT    /lookup-tables/:id {name?,description?,columns?,active?}
DELETE /lookup-tables/:id                      → 409 con la lista de formatos/flujos que la usan
GET    /lookup-tables/:id/rows?cursor&limit&q  → {items:[{id,values,position,active}],nextCursor}
POST   /lookup-tables/:id/rows {values}
PUT    /lookup-tables/:id/rows/:rowId {values?,active?}
DELETE /lookup-tables/:id/rows/:rowId
POST   /lookup-tables/:id/rows/reorder {ids:[...]}
POST   /lookup-tables/:id/rows/import {rows:[values],replace?}   (máx. 5000; todo o nada; replace solo del tenant)
POST   /lookup-tables/:id/test {query:LookupQuery, inputs:{[var]:value}} → {matches:[{rowId,position,values}], first:{...}|null, explain:[{rowId,failedAt?}]}
```

## 7. Formatos digitales y adjuntos

- `DocumentTemplate.kind`: `'PDF'` (hoy) o `'FORM'`. Un `FORM` no trae PDF del administrador: el sistema **genera la hoja base** (título, una caja por
  variable con su etiqueta, la lista de anexos y una caja de firma por paso). Después se comporta igual que un formato con PDF (rellenado, flujo, firmas).
  `POST /document-templates/form` (admin) crea o regenera (mientras no esté publicado).
- `DocumentTemplate.attachmentSpecs`: `[{ key, label, help?, required, min, max, accept: ('pdf'|'image'|'excel'|'word'|'any')[], maxSizeMB }]`
  (máx. 10 especificaciones, 20 archivos por una, 25 MB por archivo).
- Carga previa (staging, por tenant y usuario, caduca en 24 h):
  `POST /document-templates/:id/attachments?specKey=…` (multipart `file`) → `{stagedId,name,size,mime,sha256}`;
  `DELETE /document-templates/attachments/staged/:stagedId`.
- `instantiate` recibe `attachments: { [specKey]: stagedId[] }`. **Todo se valida antes de crear nada** (mínimo, máximo, tipo, tamaño, requerido, que
  el staging sea del mismo tenant y usuario). Cada anexo pasa a ser un `Document` del mismo expediente con `attachmentKey = specKey`, cifrado con AAD del
  tenant, con hash y congelado. Los firmantes y destinatarios de la solicitud pueden leerlos; nadie más fuera del tenant.
- `GET /cases/:caseId/attachments` → `[{documentId,attachmentKey,filename,sizeBytes,mimeType,hash}]` (la descarga usa el endpoint de documentos existente).
- El evento de auditoría `ATTACHMENTS_ADDED` y el paquete de evidencia incluyen nombre, tamaño y hash de cada anexo.

## 8. Qué ve cada quien

| Rol | Ve |
|---|---|
| Administrador | Tablas de consulta, editor de flujo (con consultas y variables derivadas), formatos PDF y digitales, especificación de anexos |
| Usuario | Formatos y solicitudes publicados; llena los datos, adjunta lo que pide el formato y ve «Se enviará a: …» ya resuelto. Nunca ve las tablas |

## 9. Fases

1. **Esta entrega:** tablas y motor de consulta, `lookup` y variables derivadas, migración de la matriz de gastos, formatos digitales, anexos con staging, pantallas
   de administración y de llenado.
2. `businessRuleTask` de BPMN como consulta al convertir a flujo.
3. Versionado con vigencia y aprobación de cambios; fuentes externas sincronizadas (Monday, Sheets); asistente de Excel a tabla (la IA propone, una persona revisa).

## 10. Límites conocidos

- El flujo sigue siendo lineal: la consulta decide con lo que se sabe **al crear la solicitud**, no con resultados de pasos anteriores.
- Las solicitudes en curso conservan lo congelado; cambiar una tabla no las reencamina.
