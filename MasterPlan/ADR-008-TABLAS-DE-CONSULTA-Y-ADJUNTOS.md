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
GET    /lookup-tables/:id/rows?cursor&limit&q&active → {items:[{id,values,position,active}],nextCursor,total}
         (límite máx. 200, default 50; `total` cuenta lo que cumple los filtros; `q` busca en las celdas sin mayúsculas ni acentos;
          el cursor es `position:id`; orden por `position` y desempate por `id`)
POST   /lookup-tables/:id/rows {values}
PUT    /lookup-tables/:id/rows/:rowId {values?,active?}    (`values` reemplaza la fila completa; lo que no venga queda vacío)
DELETE /lookup-tables/:id/rows/:rowId
POST   /lookup-tables/:id/rows/:rowId/move {direction:'up'|'down'} | {toTop:true} | {afterRowId:id|null}
         → {id,moved,index,position,total,revision,changed:[{id,position}]}  (una transacción con bloqueo; solo reescribe las filas afectadas)
POST   /lookup-tables/:id/rows/reorder {ids:[...]}         (compatibilidad)
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

## 10. Decisiones de implementación (2026-10-16)

- **El usuario no ve la consulta:** a quien no es administrador, el participante `lookup` le llega como `{type:'lookup', prompt}` y las variables derivadas solo con clave, etiqueta y tipo.
  El preview devuelve por paso `resolved` (persona), `unresolved` (todas las entradas estaban completas y la tabla no devolvió a nadie) o `awaiting` (faltan datos obligatorios;
  solo clave y etiqueta de las variables). Nunca salen la tabla, sus columnas ni la consulta.
- **Límites:** 500 caracteres por celda de texto, 30 columnas, 5000 filas por tabla. Las importaciones usan un parser propio de 12 MB (`LOOKUP_IMPORT_BODY_LIMIT`); el resto de la API sigue en 2 MB.
- **Semántica fina:** `isEmpty`/`isNotEmpty` miran la celda de la fila; si la solicitud no trae valor y la celda sí, la condición falla (incluso con `neq`); una celda vacía cumple siempre salvo `emptyMatchesAny:false`
  (la condición `etapa` de Adquisiciones lo usa para que una fila sin etapa no autorice a nadie).
- **Métodos de firma:** se validan contra la política del tenant al guardar y publicar un formato; sin `methods` se guardan los permitidos de {ACCEPT, AUTOGRAFA, DIGITAL}. Un cambio posterior de la política
  se reporta al llenar el formato (400 claro, sin crear nada).
- **Anexos:** lectura solo para el dueño del expediente y los participantes de sus solicitudes (ni un administrador ajeno los lee); no son firmables; no cuentan como documentos en las carpetas; el paquete de evidencia
  incluye `anexos.json` (nombre, tamaño y hash). Sin Redis la carga previa responde 503 (no hay respaldo en memoria: no hay estado en el proceso).
- **Auditoría:** `LOOKUP_TABLE_*`, `LOOKUP_ROW_*` (incluye `LOOKUP_ROW_MOVED`), `LOOKUP_ROWS_IMPORTED`, `LOOKUP_RESOLVED` y `ATTACHMENTS_ADDED`, con ids, claves, conteos y hashes; nunca valores de celdas, nombres ni correos.
- **Guarda de tenant (ADR-004):** las consultas que la guarda marcaba quedaron acotadas por `tenantId` o por `runAsSystem` con razón explícita; un resolvedor `slug → uuid` con caché corta sirve a las tablas que guardan el UUID.
  `TENANT_GUARD=enforce` queda listo para activarse (ver la cabecera de `tenant-guard.ts`).

## 11. Límites conocidos

- El flujo sigue siendo lineal: la consulta decide con lo que se sabe **al crear la solicitud**, no con resultados de pasos anteriores.
- Las solicitudes en curso conservan lo congelado; cambiar una tabla no las reencamina.

## 10. Importación BPMN de consultas explícitas (2026-10-16)

Un `bpmn:businessRuleTask` representa una **variable derivada**, no un paso de firma. Debe estar en el camino lineal obligatorio inmediatamente después del inicio (puede haber varias consultas seguidas), antes de cualquier tarea de usuario o compuerta. Esta restricción conserva la semántica del motor: todas las consultas se resuelven al crear la solicitud, antes de decidir los pasos activos. Una consulta posterior o condicional se rechaza, no se adelanta silenciosamente.

El atributo `prestige:lookup` contiene un objeto JSON con el contrato `DerivedVariable`: `key`, `label`, `type`, `query`, `column` y opcionalmente `onMiss`. Ejemplo conceptual (en XML, escapar las comillas como `&quot;`):

```json
{"key":"nivel","label":"Nivel de aprobación","type":"number","query":{"table":"niveles","match":[{"column":"usuario","op":"eq","source":{"var":"solicitante"}}]},"column":"nivel","onMiss":"fail"}
```

La importación agrega la definición a `Flow.derived` y aplica `validateFlow`: claves únicas, tipos válidos, operadores y fuentes existentes. La existencia de tabla y columnas se valida al guardar el formato con `assertTables`, en el tenant del administrador. No se infieren reglas DMN ni consultas a partir del nombre de la tarea. Extensión ausente o inválida bloquea la conversión. Al exportar de nuevo, las consultas se normalizan a `prestige:derived` del proceso, manteniendo su semántica.

`solicitante` es una fuente integrada de texto reservada: el BFF la obtiene de `actorId` autenticado (`preferred_username`), tanto en la vista previa como al crear el expediente. No puede declararse como campo editable o variable derivada, y cualquier valor enviado por el cliente se sustituye antes de consultar.
