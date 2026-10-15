import type { Condition, Flow, FlowStep } from '../flow/flow.types';

/**
 * Flujos por defecto de Adquisiciones (SD-ADMINFINANZAS-03 v08), interpretados desde los BPMN de `adquisiciones.ts`.
 *
 * Un flujo de Prestige es una línea de pasos; una compuerta solo puede saltar un paso según las variables que se
 * capturan al crear el sobre. Por eso:
 *  - las ramas por tipo de gasto sí se modelan (variable `tipoGasto`, pasos con `when`);
 *  - los resultados que solo se conocen durante la ejecución (¿aprobado?, ¿hay presupuesto?, ¿se acepta la entrega?,
 *    ¿saldo a favor?) NO se pueden bifurcar: quedan dentro de un paso REVISOR, que rechaza para detener el proceso;
 *  - el bucle de reemplazo (T24) no existe en un flujo lineal: se pide el reemplazo fuera del flujo y se vuelve a verificar;
 *  - los carriles pasan a la pregunta «¿Quién…?» de cada paso y los pasos contiguos de un mismo carril se condensan
 *    para no pasar del máximo de pasos.
 */

export const TIPOS_GASTO = [
  'Bienes y servicios',
  'Costo de venta directo (Entrust)',
  'Gastos de oficina, seguros y comunicación',
  'Marketing',
  'Viaje',
] as const;
type Tipo = (typeof TIPOS_GASTO)[number];

/** «solo si» el tipo de gasto es uno de estos; las condiciones se unen con AND, así que se excluyen los demás. */
const soloSi = (...tipos: Tipo[]): Condition[] =>
  TIPOS_GASTO.filter((t) => !tipos.includes(t)).map((t) => ({ variable: 'tipoGasto', op: '!=' as const, value: t }));

const ask = (prompt: string) => ({ type: 'ask' as const, prompt });
const SOLICITANTE = '¿Quién es el solicitante o responsable de área?';
const AYF = '¿Quién es el ejecutivo de Administración y Tesorería?';
const APROBADORES = '¿Quiénes aprueban (jefe directo y responsable según la matriz de gastos)?';

const BIENES_Y_DIRECTO: Tipo[] = ['Bienes y servicios', 'Costo de venta directo (Entrust)'];
const OFICINA_Y_MARKETING: Tipo[] = ['Gastos de oficina, seguros y comunicación', 'Marketing'];

const step = (s: FlowStep): FlowStep => s;

export const ADQUISICIONES_FLOW: Flow = {
  order: 'SECUENCIAL',
  slaHours: 72,
  variables: [
    { key: 'tipoGasto', label: 'Tipo de gasto', type: 'select', required: true, options: [...TIPOS_GASTO] },
  ],
  steps: [
    step({ id: 'T01', label: '1. Generar requerimiento con ≥3 cotizaciones', role: 'FIRMANTE', who: { type: 'initiator' } }),
    step({ id: 'T01b', label: 'Aprobar solicitud (jefe directo y responsable por matriz)', role: 'FIRMANTE', who: ask(APROBADORES) }),
    step({ id: 'T02', label: '2-3. Validar aprobaciones, presupuesto y congruencia de la compra (sin aprobación o presupuesto, se rechaza)', role: 'REVISOR', who: ask(AYF) }),
    step({ id: 'T04', label: '4. Validar cotizaciones (≥3; mystery shopper)', role: 'REVISOR', who: ask(AYF) }),
    step({ id: 'T05', label: '5-6. Negociar condiciones, documentar la negociación y elegir propuesta', role: 'REVISOR', who: ask(AYF) }),
    step({ id: 'T07', label: '7-8. Solicitar y recibir cotización de Entrust', role: 'REVISOR', who: ask(AYF), when: soloSi('Costo de venta directo (Entrust)') }),
    step({ id: 'T09', label: '9. Generar orden de compra (FOR-ADF-03)', role: 'REVISOR', who: ask(AYF), when: soloSi(...BIENES_Y_DIRECTO) }),
    step({ id: 'T14', label: '14-15. Subir formato de reembolso y comprobantes (FOR-ADF-02) y revisarlos según el tipo de gasto', role: 'REVISOR', who: ask(SOLICITANTE), when: soloSi(...OFICINA_Y_MARKETING) }),
    step({ id: 'T10', label: '10. Solicitar reserva de hotel / avión', role: 'FIRMANTE', who: ask(SOLICITANTE), when: soloSi('Viaje') }),
    step({ id: 'T11', label: '11-12. Cotizar con 3 agencias e informar la mejor opción al solicitante', role: 'REVISOR', who: ask(AYF), when: soloSi('Viaje') }),
    step({ id: 'T13', label: '13. Confirmar conformidad de lo cotizado', role: 'FIRMANTE', who: ask(SOLICITANTE), when: soloSi('Viaje') }),
    step({ id: 'T16', label: '16. Notificar compra o reserva y registrar en SAP', role: 'REVISOR', who: ask(AYF) }),
    step({ id: 'T18', label: '18. Solicitar el bien o servicio al proveedor', role: 'REVISOR', who: ask(AYF), when: soloSi('Bienes y servicios') }),
    step({ id: 'T19', label: '19-21. Solicitar equipo Entrust, recibir guía y gestionar el retiro en aduana', role: 'REVISOR', who: ask(AYF), when: soloSi('Costo de venta directo (Entrust)') }),
    step({ id: 'T30', label: '30-32. Compra en línea, factura, pago con tarjeta y pago de la tarjeta el día de vencimiento', role: 'REVISOR', who: ask(AYF), when: soloSi('Gastos de oficina, seguros y comunicación') }),
    step({ id: 'T17', label: '17, 33-35. Pagar anticipo, revisar saldo y pagar el reembolso o notificar el cargo', role: 'REVISOR', who: ask(AYF), when: soloSi('Marketing', 'Viaje') }),
    step({ id: 'T22', label: '22-23. Notificar al responsable y verificar el bien o servicio recibido (si no se acepta, se pide el reemplazo y se vuelve a verificar)', role: 'REVISOR', who: ask(SOLICITANTE), when: soloSi(...BIENES_Y_DIRECTO) }),
    step({ id: 'T25', label: '25. Aceptar lo recibido y solicitar la factura', role: 'FIRMANTE', who: ask(SOLICITANTE), when: soloSi(...BIENES_Y_DIRECTO) }),
    step({ id: 'T26', label: '26. Aprobar factura (valida SAT)', role: 'FIRMANTE', who: ask(APROBADORES), when: soloSi(...BIENES_Y_DIRECTO) }),
    step({ id: 'T27', label: '27-28. Autorizar el pago, iniciar Tesorería y ejecutar la liberación de pagos', role: 'FIRMANTE', who: ask(AYF), when: soloSi(...BIENES_Y_DIRECTO) }),
  ],
};

export const RENOVACION_LICENCIAS_FLOW: Flow = {
  order: 'SECUENCIAL',
  slaHours: 72,
  variables: [],
  steps: [
    step({ id: 'R1', label: '1. Monitorear vencimientos de licencias y mantenimientos (revisión mensual de lo que vence en 90 días)', role: 'REVISOR', who: ask(SOLICITANTE) }),
    step({ id: 'R2', label: '2. Solicitar el pago de renovación a A&F por correo (mínimo 60 días antes del vencimiento)', role: 'FIRMANTE', who: ask(SOLICITANTE) }),
    step({ id: 'R3', label: '3. Validar la renovación contra el presupuesto aprobado (fuera de presupuesto: se rechaza y regresa al responsable hasta tener autorización de la dirección general)', role: 'REVISOR', who: ask(AYF) }),
    step({ id: 'RC', label: 'Proceder a compra directa (continúa en el proceso Adquisiciones, Gastos)', role: 'REVISOR', who: ask(AYF) }),
  ],
};

export const PROVEEDORES_ESTRATEGICOS_FLOW: Flow = {
  order: 'SECUENCIAL',
  slaHours: 72,
  variables: [],
  steps: [
    step({ id: 'G1', label: '1. Revisar desempeño de proveedores estratégicos y calendario de renovaciones', role: 'REVISOR', who: ask('¿Quién es el ejecutivo de A&F y el responsable del área?') }),
    step({ id: 'G2', label: '2. Negociar anualmente precios, descuentos, niveles de servicio y vigencias', role: 'REVISOR', who: ask('¿Quién es el ejecutivo de A&F y el responsable del área?') }),
    step({ id: 'G3', label: '3. Actualizar la lista de proveedores estratégicos aprobados', role: 'REVISOR', who: ask(AYF) }),
  ],
};
