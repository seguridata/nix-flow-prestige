> **Fuente de la verdad (17 oct 2026):** la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa) manda sobre estado, pendientes y decisiones. El [espejo en el repo](ESTADO-Y-PENDIENTES.md) lo replica; los documentos históricos y las especificaciones técnicas conservan su alcance.

# Estudio de procesos: de una ruta a una solicitud real

La entrada es **Procesos** (`/process`). El catálogo presenta una tarjeta por proceso. Las versiones anteriores se consultan en **Historial**, en lugar de mezclarse con los procesos disponibles. Los administradores diseñan y publican; las personas remitentes usan los flujos publicados a través de un formato.

## Cuatro conceptos

| Concepto | Qué contiene | Cuándo se usa |
|---|---|---|
| Proceso | Definición versionada de la ruta de negocio, su diagrama y su configuración | Para diseñar y mantener Gastos, Adquisiciones o un subproceso |
| Flujo | Pasos ejecutables, participantes, condiciones, datos y plazo de una versión del proceso | Para decidir quién participa en cada solicitud |
| Formato | Documento o formulario con sus campos y el flujo elegido | Para capturar una solicitud con la ruta correcta |
| Solicitud | Un expediente concreto, con documento, participantes resueltos y estado | Para revisar, aprobar, firmar y consultar evidencia |

El recorrido recomendado es **diseñar etapas → comprobar y publicar flujo → asociar a un formato → crear solicitud**. Guardar un diagrama o probar una ruta no envía documentos.

## Crear y mantener un proceso

1. En **Procesos**, elige crear un proceso e indica su nombre. Nace como borrador propio del espacio.
2. En **Etapas y responsables**, agrega pasos en la secuencia vertical. Cada paso necesita una etiqueta, un rol y una persona o una regla para encontrarla. Puedes mover los pasos hacia arriba o abajo y quitar los que sobren.
3. Define los datos que debe capturar la persona solicitante. Las condiciones de un paso determinan cuándo participa. Configura orden secuencial o paralelo y plazo en horas.
4. Para responsables variables, utiliza consultas a las tablas del espacio. Estas tablas son configuración administrativa; las personas que envían solicitudes reciben el responsable resuelto. La variable `solicitante` sale de la identidad autenticada y el formulario no puede suplantarla.
5. Guarda las etapas. El sistema crea una nueva versión borrador y regenera su BPMN a partir del flujo ejecutable.

**Diagrama avanzado** permite trabajar con BPMN. Guardar XML crea un borrador sin flujo ejecutable: hay que convertirlo a etapas y guardarlas antes de publicar. La conversión explica los elementos no ejecutables; no transforma tareas arbitrarias en integraciones ficticias. La tabla DMN se muestra cuando existe una decisión específica; la tabla genérica de SLA no se presenta como una decisión de Adquisiciones.

## Comprobar, probar y publicar

La comprobación previa verifica la estructura ejecutable, las condiciones, las tablas activas y la compatibilidad de sus columnas. Reporta errores que impiden publicar y advertencias, por ejemplo pasos que requieren seleccionar una persona. Una tabla vacía que alimenta una variable derivada obligatoria impide publicar. También se rechaza un proceso archivado o un diagrama que todavía no tiene flujo guardado.

En **Probar recorrido**, introduce datos del caso que quieres revisar. El servidor usa el mismo `FlowResolverService` que las solicitudes reales y las tablas activas del tenant. Muestra pasos aplicables y omitidos, responsables encontrados, datos pendientes y selecciones necesarias. Utiliza al usuario autenticado como solicitante. **No crea una solicitud, no envía correo y no registra una aprobación ni una firma.** Los datos de prueba permiten entender las decisiones; la resolución se volverá a efectuar al crear la solicitud real.

Publicar realiza nuevamente la comprobación en el servidor. Solo una versión propia de la misma clave queda publicada. Un borrador posterior conserva la versión ya publicada hasta publicar el reemplazo. Una definición compartida de plataforma se convierte en copia propia al guardarla; no se modifica globalmente.

Desde **Asociar a un formato y usar**, elige o configura el formato. La versión de flujo asociada queda identificada en el formato mediante `flowKey` y `flowVersion`. Crear la solicitud desde ese formato captura datos, resuelve participantes y continúa el flujo normal del producto. Publicar un proceso por sí solo no crea solicitudes ni ejecuta automáticamente un diagrama BPMN arbitrario en Temporal.

## Historial, comparación y restauración

**Historial** permite revisar versiones del mismo proceso y comparar su configuración. Restaurar una versión crea una versión nueva sin publicar, preservando la original y su número. También vuelve a mostrar el proceso en el catálogo si estaba archivado. Revisa y publica ese nuevo borrador cuando corresponda.

Las versiones de una copia propia y de la definición de plataforma tienen espacios de numeración distintos. Cuando existe copia propia, el catálogo y su historial muestran la propia. Una copia propia borrador oculta la publicación de plataforma de la misma clave en el selector de flujos; debes publicar la copia para usarla en nuevas solicitudes.

## Eliminar del catálogo sin perder evidencia

El control de eliminar **archiva para el espacio actual**. Oculta la clave en Procesos y en los flujos publicados, y despublica sus versiones propias. No borra definiciones, solicitudes, documentos, ejecuciones, firmas ni auditorías. Una definición compartida se oculta mediante una preferencia del espacio, sin eliminarla para otros tenants. Las referencias históricas y la lectura de versiones continúan disponibles.

Los formatos que ya tienen un flujo asociado conservan su copia de esa configuración y su propia publicación. Archivar un proceso no retira automáticamente esos formatos ni impide sus solicitudes nuevas. Revisa el impacto y retira la publicación de los formatos correspondientes cuando también quieras detener su uso.

La limpieza de Gastos/Adquisiciones utiliza `backend/bff/scripts/prune-process-catalog.ts`. Su modo predeterminado es informativo. Conserva las claves `adquisiciones-gastos`, `renovacion-licenciamiento`, `proveedores-estrategicos` y `flujo-de-adquisicion`, además de procesos cuyo nombre contiene la palabra completa «gastos», «adquisición» o «adquisiciones». No conserva contratos por ser contratos ni acepta una coincidencia amplia con «compras». Antes de aplicar se revisa el plan de claves concretas. El modo de aplicación exige base local `prestige`, `--sandbox` y confirmación explícita del slug mediante `--confirm-tenant`. Todas las operaciones siguen acotadas al tenant.

```sh
node --env-file=.env --import tsx scripts/prune-process-catalog.ts --tenant=seguridata
# Solo después de revisar el plan:
node --env-file=.env --import tsx scripts/prune-process-catalog.ts --tenant=seguridata --apply --sandbox --confirm-tenant=seguridata
```

El script no borra históricos. Las preferencias se pueden revertir con el endpoint de desarchivar. La caché antigua de listados tiene TTL de 60 segundos; la API de archivo invalida la caché inmediatamente.

## Paquetes verificables

Exportar descarga un paquete JSON de configuración con `format: "prestige-process"`, `version: 1`, `payload` y `sha256`. El contenido incluye nombre, descripción y flujo; no exporta documentos, filas de tablas, sesiones ni credenciales. Los participantes fijos y las referencias a tablas forman parte de la configuración del flujo: revisa esos datos antes de compartirlo.

Importar verifica la versión del formato, la integridad SHA-256 de un JSON con claves ordenadas y la estructura del flujo. Si el archivo fue alterado sin actualizar su hash, se rechaza. El hash detecta cambios; **no es una firma digital ni acredita autoría**. Una importación válida crea una clave propia nueva, un borrador y un BPMN regenerado; no publica ni copia las tablas del espacio de origen. Comprueba las dependencias del nuevo espacio antes de publicar.

## Impacto y seguimiento

El panel de impacto cuenta los formatos asociados por versión y las ejecuciones registradas con la clave exacta del proceso, agrupadas por estado. Las ejecuciones históricas guardan clave pero no versión: `versionAttribution: "not-recorded"` lo señala. Las ejecuciones con un alias histórico distinto no se atribuyen por suposición al proceso actual.

**Solicitudes en ejecución** presenta las ejecuciones que corresponden al proceso seleccionado, con estados y contexto. Un registro fallido es una ejecución conservada para diagnóstico; archivarlo del catálogo no reescribe su resultado. La solicitud y su evidencia siguen siendo la referencia para conocer qué se aprobó o firmó realmente.

## API disponible

Todas las rutas requieren autenticación y contexto de tenant. Las marcadas **admin** exigen ese rol efectivo. Ninguna recibe el tenant desde un cuerpo controlado por el cliente.

| Método y ruta | Resultado | Acceso |
|---|---|---|
| `GET /process-catalog` | Una definición vigente por clave, `versionCount`, `publishedVersion`, `source` | admin |
| `GET /process-definitions?published=true` | Una versión publicada por clave, excluye archivados y respeta copias propias; noadmin recibe `publicFlow` sin XML, DMN ni reglas internas | Autenticado |
| `POST /process-definitions` | Crea `{name,description?,flow}` como borrador propio | admin |
| `PUT /process-definitions/:key/flow` | Guarda `{flow,name?,description?}` como nueva versión y regenera BPMN | admin |
| `PUT /process-definitions/:key` | Guarda XML como nuevo borrador sin flujo ejecutable | admin |
| `GET /process-definitions/:key/versions` | Historial del dueño efectivo | admin |
| `GET /process-definitions/:key/versions/:version` | Una versión exacta del dueño efectivo | admin |
| `POST /process-definitions/:key/versions/:version/restore` | Nueva versión borrador desde una anterior; desarchiva | admin |
| `DELETE /process-definitions/:key` | Archivo reversible del catálogo del tenant | admin |
| `POST /process-definitions/:key/unarchive` | Muestra de nuevo sin publicar | admin |
| `POST /process-definitions/:key/preflight` | `{ready,valid,errors,warnings,checks,summary,definition}` | admin |
| `POST /process-definitions/:key/preview-flow` | Recorrido real con `{values,version?,flow?}`; no crea solicitud | admin |
| `POST /process-definitions/:key/versions/:version/publish` | Publicación con comprobación previa obligatoria | admin |
| `POST /process-definitions/:key/versions/:version/unpublish` | Retira publicación propia | admin |
| `GET /process-definitions/:key/export` | Paquete JSON verificable de la última versión | admin |
| `POST /process-packages/import` | Valida paquete y crea borrador nuevo | admin |
| `GET /process-definitions/:key/impact` | Uso por estado y formatos por versión | admin |

`preflight` acepta `{}` para revisar la última versión, `{version}` para una guardada o `{flow}` para comprobar un borrador en edición. Publicar siempre comprueba la versión guardada. Las respuestas de laboratorio incluyen `values`, `steps`, `lookups`, `derived`, `order` y `slaHours`. Los pasos indican `active`, `participant`, `awaiting` y `needsSelection` para explicar el resultado sin inventar una persona.
