// Generado a partir de SD-ADMINFINANZAS-03 v08 (Proceso de Adquisiciones - Gastos).
export const ADQUISICIONES_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_adquisiciones-gastos" targetNamespace="mx.seguridata.prestige" exporter="Prestige" exporterVersion="0.2.0">
<bpmn:collaboration id="Collab_adquisiciones-gastos">
  <bpmn:participant id="Part_adquisiciones-gastos" name="Proceso de Adquisiciones (Gastos)" processRef="adquisiciones-gastos" />
</bpmn:collaboration>
<bpmn:process id="adquisiciones-gastos" name="Proceso de Adquisiciones (Gastos)" isExecutable="true">
  <bpmn:laneSet id="LaneSet_1">
    <bpmn:lane id="Lane_Solicitante" name="Solicitante / Responsable de área">
      <bpmn:flowNodeRef>Start</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T01</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T14</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T10</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T13</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T23</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_E</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T24</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T25</bpmn:flowNodeRef>
    </bpmn:lane>
    <bpmn:lane id="Lane_Aprobadores" name="Aprobadores (jefe directo y matriz de gastos)">
      <bpmn:flowNodeRef>T01b</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T26</bpmn:flowNodeRef>
    </bpmn:lane>
    <bpmn:lane id="Lane_AF" name="Ejecutivo de Administración y Tesorería">
      <bpmn:flowNodeRef>T02</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_apr</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>End_NoApr</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T03</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_pres</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>End_NoPres</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T04</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T05</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T06</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_A</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_B</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_M</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T07</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T08</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T09</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T15</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T11</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T12</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>J3</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T16</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_A2</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_B2</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_C2</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T18</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T19</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T20</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T21</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T30</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T31</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T32</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>End_Card</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T17</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T33</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>G_S</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T35</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>End_Reemb</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T34</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>End_Cargo</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>M22</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T22</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T27</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>T28</bpmn:flowNodeRef>
      <bpmn:flowNodeRef>End_Ok</bpmn:flowNodeRef>
    </bpmn:lane>
  </bpmn:laneSet>
  <bpmn:startEvent id="Start" name="Necesidad de compra">
    <bpmn:outgoing>F_Start__T01</bpmn:outgoing>
  </bpmn:startEvent>
  <bpmn:userTask id="T01" name="1. Generar requerimiento con ≥3 cotizaciones">
    <bpmn:documentation>Responsable: Solicitante - Cabeza de área. Detalla necesidad, justificación, presupuesto estimado y proyecto asociado; lo sube al flujo de gestión de gastos. OLA 2 horas. Bienes/servicios para proyectos: solicitar en los primeros 5 días hábiles tras el cierre del contrato o inicio del proyecto confirmado en Monday.</bpmn:documentation>
    <bpmn:incoming>F_Start__T01</bpmn:incoming>
    <bpmn:outgoing>F_T01__T01b</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T01b" name="Aprobar solicitud (jefe directo y responsable por matriz)">
    <bpmn:documentation>Notificaciones automáticas desde el flujo de gastos: primero jefe directo, después responsable según la matriz de gastos (SD-MATRIZ-APROBACION-GASTO).</bpmn:documentation>
    <bpmn:incoming>F_T01__T01b</bpmn:incoming>
    <bpmn:outgoing>F_T01b__T02</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T02" name="2. Validar aprobaciones en flujo de gastos">
    <bpmn:documentation>Verifica aprobación del jefe de área y del aprobador de la matriz; si no existen no se da continuidad. OLA 20 minutos.</bpmn:documentation>
    <bpmn:incoming>F_T01b__T02</bpmn:incoming>
    <bpmn:outgoing>F_T02__G_apr</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:exclusiveGateway id="G_apr" name="¿Aprobaciones completas?">
    <bpmn:incoming>F_T02__G_apr</bpmn:incoming>
    <bpmn:outgoing>F_G_apr__T03</bpmn:outgoing>
    <bpmn:outgoing>F_G_apr__End_NoApr</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:endEvent id="End_NoApr" name="Sin aprobación: no continúa">
    <bpmn:incoming>F_G_apr__End_NoApr</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:userTask id="T03" name="3. Validar presupuesto y congruencia de la compra">
    <bpmn:documentation>Consulta presupuesto del área o aprobación fuera de presupuesto. Verifica: proyecto activo, inventario suficiente, cantidades congruentes, sin OC vigente no ejecutada para el mismo bien. Si hay duda cuestiona al solicitante. OLA 20 minutos.</bpmn:documentation>
    <bpmn:incoming>F_G_apr__T03</bpmn:incoming>
    <bpmn:outgoing>F_T03__G_pres</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:exclusiveGateway id="G_pres" name="¿Hay presupuesto o aprobación fuera de presupuesto?">
    <bpmn:incoming>F_T03__G_pres</bpmn:incoming>
    <bpmn:outgoing>F_G_pres__T04</bpmn:outgoing>
    <bpmn:outgoing>F_G_pres__End_NoPres</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:endEvent id="End_NoPres" name="Proceso concluido">
    <bpmn:incoming>F_G_pres__End_NoPres</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:userTask id="T04" name="4. Validar cotizaciones (≥3; mystery shopper)">
    <bpmn:documentation>Valida las tres cotizaciones (en algunos casos al menos 1). Puede aplicar mystery shopper. Entrust: alta en portal y requerimiento con mínimo 30 días hábiles de anticipación. OLA 16 horas.</bpmn:documentation>
    <bpmn:incoming>F_G_pres__T04</bpmn:incoming>
    <bpmn:outgoing>F_T04__T05</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T05" name="5. Negociar condiciones con proveedores">
    <bpmn:documentation>Precio, plazo, descuentos, garantía, soporte y forma de pago. Último push comercial: descuento adicional 3-5% y 10-15 días extra de crédito. Verifica lista de autorizados. Proveedor estratégico con negociación anual vigente: validar condiciones pactadas. OLA 8 horas.</bpmn:documentation>
    <bpmn:incoming>F_T04__T05</bpmn:incoming>
    <bpmn:outgoing>F_T05__T06</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T06" name="6. Documentar negociación y elegir propuesta">
    <bpmn:documentation>Si es proveedor nuevo solicita constancia fiscal y estado de cuenta bancario. OLA 30 minutos.</bpmn:documentation>
    <bpmn:incoming>F_T05__T06</bpmn:incoming>
    <bpmn:outgoing>F_T06__G_A</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:exclusiveGateway id="G_A" name="¿Bienes y servicios?">
    <bpmn:incoming>F_T06__G_A</bpmn:incoming>
    <bpmn:outgoing>F_G_A__T09</bpmn:outgoing>
    <bpmn:outgoing>F_G_A__G_B</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:exclusiveGateway id="G_B" name="¿Costo de venta directo?">
    <bpmn:incoming>F_G_A__G_B</bpmn:incoming>
    <bpmn:outgoing>F_G_B__T07</bpmn:outgoing>
    <bpmn:outgoing>F_G_B__G_M</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:exclusiveGateway id="G_M" name="¿Marketing?">
    <bpmn:incoming>F_G_B__G_M</bpmn:incoming>
    <bpmn:outgoing>F_G_M__T14</bpmn:outgoing>
    <bpmn:outgoing>F_G_M__T10</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:userTask id="T07" name="7. Solicitar cotización a Entrust">
    <bpmn:documentation>Equipos Entrust (módulos criptográficos, renovación de mantenimiento). Si detecta proyecto con implementación próxima sin OC, notifica al responsable del área. OLA: respuesta Entrust 1 día hábil.</bpmn:documentation>
    <bpmn:incoming>F_G_B__T07</bpmn:incoming>
    <bpmn:outgoing>F_T07__T08</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T08" name="8. Recibir cotización de Entrust">
    <bpmn:incoming>F_T07__T08</bpmn:incoming>
    <bpmn:outgoing>F_T08__T09</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T09" name="9. Generar orden de compra (FOR-ADF-03)">
    <bpmn:documentation>OC foliada con nombre, RFC, teléfono, contacto e importe del proveedor; proveedor autorizado y condiciones negociadas documentadas. En compras Entrust A&amp;F controla el envío; al notificar el agente aduanal la entrega, transfiere la recepción a Operaciones por correo.</bpmn:documentation>
    <bpmn:incoming>F_G_A__T09</bpmn:incoming>
    <bpmn:incoming>F_T08__T09</bpmn:incoming>
    <bpmn:outgoing>F_T09__J3</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T14" name="14. Subir formato de reembolso y comprobantes (FOR-ADF-02)">
    <bpmn:documentation>Tarjeta de crédito: reporte 5 días después del corte (día 8 de cada mes). Tarjeta de gasolina: reporte mensual apoyado en visitas a clientes en Monday.</bpmn:documentation>
    <bpmn:incoming>F_G_M__T14</bpmn:incoming>
    <bpmn:outgoing>F_T14__T15</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T15" name="15. Revisar documentos según tipo de gasto">
    <bpmn:documentation>Anticipo: monto y proyecto (comprobar dentro del mes en curso). Reembolso: formato y comprobantes con justificación. Tarjeta de crédito/gasolina: reporte y comprobantes. Aprobaciones según matriz. OLA máx. 8 horas hábiles.</bpmn:documentation>
    <bpmn:incoming>F_T14__T15</bpmn:incoming>
    <bpmn:outgoing>F_T15__J3</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T10" name="10. Solicitar reserva de hotel / avión">
    <bpmn:documentation>Vuelo: destino, fechas y horarios. Hotel: noches. Tope hotel colaboradores $1,200 + IVA; directivos $1,500 + IVA. OLA: anticipación mínima 4 días.</bpmn:documentation>
    <bpmn:incoming>F_G_M__T10</bpmn:incoming>
    <bpmn:outgoing>F_T10__T11</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T11" name="11. Cotizar con 3 agencias hotel / avión / auto">
    <bpmn:documentation>OLA 1 día.</bpmn:documentation>
    <bpmn:incoming>F_T10__T11</bpmn:incoming>
    <bpmn:outgoing>F_T11__T12</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T12" name="12. Informar la mejor opción al solicitante">
    <bpmn:documentation>OLA: 2 horas hábiles.</bpmn:documentation>
    <bpmn:incoming>F_T11__T12</bpmn:incoming>
    <bpmn:outgoing>F_T12__T13</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T13" name="13. Confirmar conformidad de lo cotizado">
    <bpmn:documentation>OLA: 2 horas hábiles.</bpmn:documentation>
    <bpmn:incoming>F_T12__T13</bpmn:incoming>
    <bpmn:outgoing>F_T13__J3</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:exclusiveGateway id="J3">
    <bpmn:incoming>F_T09__J3</bpmn:incoming>
    <bpmn:incoming>F_T15__J3</bpmn:incoming>
    <bpmn:incoming>F_T13__J3</bpmn:incoming>
    <bpmn:outgoing>F_J3__T16</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:userTask id="T16" name="16. Notificar compra/reserva y registrar en SAP">
    <bpmn:documentation>Notifica al solicitante la compra y/o reserva; registra factura, anticipo o reembolso en SAP.</bpmn:documentation>
    <bpmn:incoming>F_J3__T16</bpmn:incoming>
    <bpmn:outgoing>F_T16__G_A2</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:exclusiveGateway id="G_A2" name="¿Bienes y servicios?">
    <bpmn:incoming>F_T16__G_A2</bpmn:incoming>
    <bpmn:outgoing>F_G_A2__T18</bpmn:outgoing>
    <bpmn:outgoing>F_G_A2__G_B2</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:exclusiveGateway id="G_B2" name="¿Ventas costo directo?">
    <bpmn:incoming>F_G_A2__G_B2</bpmn:incoming>
    <bpmn:outgoing>F_G_B2__T19</bpmn:outgoing>
    <bpmn:outgoing>F_G_B2__G_C2</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:exclusiveGateway id="G_C2" name="¿Gastos de oficina, seguros y comunicación?">
    <bpmn:incoming>F_G_B2__G_C2</bpmn:incoming>
    <bpmn:outgoing>F_G_C2__T30</bpmn:outgoing>
    <bpmn:outgoing>F_G_C2__T17</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:userTask id="T18" name="18. Solicitar bien o servicio al proveedor">
    <bpmn:incoming>F_G_A2__T18</bpmn:incoming>
    <bpmn:outgoing>F_T18__M22</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T19" name="19. Solicitar equipo Entrust">
    <bpmn:documentation>Con existencia: envío a México máx. 4 días hábiles. Sin existencia: 15 días hábiles o más.</bpmn:documentation>
    <bpmn:incoming>F_G_B2__T19</bpmn:incoming>
    <bpmn:outgoing>F_T19__T20</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T20" name="20. Recibir guía y notificar producto en aduana">
    <bpmn:incoming>F_T19__T20</bpmn:incoming>
    <bpmn:outgoing>F_T20__T21</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T21" name="21. Gestionar retiro en aduana y notificar a Operaciones">
    <bpmn:documentation>Con Agente Aduanal; notifica a Operaciones fecha, horario y persona que entrega. OLA 5 días hábiles.</bpmn:documentation>
    <bpmn:incoming>F_T20__T21</bpmn:incoming>
    <bpmn:outgoing>F_T21__M22</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T30" name="30. Realizar compra en línea">
    <bpmn:incoming>F_G_C2__T30</bpmn:incoming>
    <bpmn:outgoing>F_T30__T31</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T31" name="31. Generar factura y pagar con tarjeta (mancomunado VP Tecnología)">
    <bpmn:documentation>Sube la factura a Monday.</bpmn:documentation>
    <bpmn:incoming>F_T30__T31</bpmn:incoming>
    <bpmn:outgoing>F_T31__T32</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T32" name="32. Pagar tarjeta corporativa el día de vencimiento">
    <bpmn:documentation>Coteja cargos contra facturas y registra comprobantes de pago en SAP.</bpmn:documentation>
    <bpmn:incoming>F_T31__T32</bpmn:incoming>
    <bpmn:outgoing>F_T32__End_Card</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:endEvent id="End_Card" name="Pago de tarjeta registrado">
    <bpmn:incoming>F_T32__End_Card</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:userTask id="T17" name="17. Pagar anticipo de gastos (Marketing)">
    <bpmn:documentation>Pagos miércoles y viernes si la solicitud llega antes de las 12:00 pm. Comprobación dentro del mes en curso.</bpmn:documentation>
    <bpmn:incoming>F_G_C2__T17</bpmn:incoming>
    <bpmn:outgoing>F_T17__T33</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T33" name="33. Revisar saldo a favor o cargo">
    <bpmn:incoming>F_T17__T33</bpmn:incoming>
    <bpmn:outgoing>F_T33__G_S</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:exclusiveGateway id="G_S" name="¿Saldo a favor?">
    <bpmn:incoming>F_T33__G_S</bpmn:incoming>
    <bpmn:outgoing>F_G_S__T35</bpmn:outgoing>
    <bpmn:outgoing>F_G_S__T34</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:userTask id="T35" name="35. Pagar reembolso en flujo semanal (mancomunado) y registrar en SAP">
    <bpmn:documentation>Pago los viernes hábiles si el reembolso se entrega de lunes a jueves de 9:00 a 18:00.</bpmn:documentation>
    <bpmn:incoming>F_G_S__T35</bpmn:incoming>
    <bpmn:outgoing>F_T35__End_Reemb</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:endEvent id="End_Reemb" name="Reembolso pagado">
    <bpmn:incoming>F_T35__End_Reemb</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:userTask id="T34" name="34. Notificar cargo al solicitante">
    <bpmn:documentation>El solicitante tiene una semana hábil para depositar y entregar comprobante. Si viaja constantemente se compensa en el siguiente viaje.</bpmn:documentation>
    <bpmn:incoming>F_G_S__T34</bpmn:incoming>
    <bpmn:outgoing>F_T34__End_Cargo</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:endEvent id="End_Cargo" name="Cargo notificado">
    <bpmn:incoming>F_T34__End_Cargo</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:exclusiveGateway id="M22">
    <bpmn:incoming>F_T21__M22</bpmn:incoming>
    <bpmn:incoming>F_T18__M22</bpmn:incoming>
    <bpmn:incoming>F_T24__M22</bpmn:incoming>
    <bpmn:outgoing>F_M22__T22</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:userTask id="T22" name="22. Notificar al responsable para recibir el bien o servicio">
    <bpmn:incoming>F_M22__T22</bpmn:incoming>
    <bpmn:outgoing>F_T22__T23</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T23" name="23. Verificar bien o servicio recibido">
    <bpmn:documentation>Bien físico: revisa producto. Servicio: revisa entregables contra el requerimiento definido.</bpmn:documentation>
    <bpmn:incoming>F_T22__T23</bpmn:incoming>
    <bpmn:outgoing>F_T23__G_E</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:exclusiveGateway id="G_E" name="¿Entrega aceptada?">
    <bpmn:incoming>F_T23__G_E</bpmn:incoming>
    <bpmn:outgoing>F_G_E__T25</bpmn:outgoing>
    <bpmn:outgoing>F_G_E__T24</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:userTask id="T24" name="24. Solicitar reemplazo o entregable correcto">
    <bpmn:documentation>Contacta al proveedor y solicita reemplazo.</bpmn:documentation>
    <bpmn:incoming>F_G_E__T24</bpmn:incoming>
    <bpmn:outgoing>F_T24__M22</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T25" name="25. Aceptar lo recibido y solicitar factura">
    <bpmn:documentation>Sube la aceptación al sistema de autorización.</bpmn:documentation>
    <bpmn:incoming>F_G_E__T25</bpmn:incoming>
    <bpmn:outgoing>F_T25__T26</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T26" name="26. Aprobar factura (valida SAT)">
    <bpmn:documentation>Revisan factura PDF/XML, constancia fiscal y estado de cuenta (proveedor nuevo). A&amp;F valida en el SAT antes de autorizar y sube evidencia PDF a Monday. OLA máx. 8 horas hábiles.</bpmn:documentation>
    <bpmn:incoming>F_T25__T26</bpmn:incoming>
    <bpmn:outgoing>F_T26__T27</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T27" name="27. Autorizar pago e iniciar proceso de Tesorería">
    <bpmn:incoming>F_T26__T27</bpmn:incoming>
    <bpmn:outgoing>F_T27__T28</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="T28" name="28. Ejecutar liberación de pagos">
    <bpmn:incoming>F_T27__T28</bpmn:incoming>
    <bpmn:outgoing>F_T28__End_Ok</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:endEvent id="End_Ok" name="Pago liberado">
    <bpmn:incoming>F_T28__End_Ok</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:sequenceFlow id="F_Start__T01" sourceRef="Start" targetRef="T01" />
  <bpmn:sequenceFlow id="F_T01__T01b" sourceRef="T01" targetRef="T01b" />
  <bpmn:sequenceFlow id="F_T01b__T02" sourceRef="T01b" targetRef="T02" />
  <bpmn:sequenceFlow id="F_T02__G_apr" sourceRef="T02" targetRef="G_apr" />
  <bpmn:sequenceFlow id="F_G_apr__T03" name="Sí" sourceRef="G_apr" targetRef="T03" />
  <bpmn:sequenceFlow id="F_G_apr__End_NoApr" name="No" sourceRef="G_apr" targetRef="End_NoApr" />
  <bpmn:sequenceFlow id="F_T03__G_pres" sourceRef="T03" targetRef="G_pres" />
  <bpmn:sequenceFlow id="F_G_pres__T04" name="Sí" sourceRef="G_pres" targetRef="T04" />
  <bpmn:sequenceFlow id="F_G_pres__End_NoPres" name="No" sourceRef="G_pres" targetRef="End_NoPres" />
  <bpmn:sequenceFlow id="F_T04__T05" sourceRef="T04" targetRef="T05" />
  <bpmn:sequenceFlow id="F_T05__T06" sourceRef="T05" targetRef="T06" />
  <bpmn:sequenceFlow id="F_T06__G_A" sourceRef="T06" targetRef="G_A" />
  <bpmn:sequenceFlow id="F_G_A__T09" name="Sí" sourceRef="G_A" targetRef="T09" />
  <bpmn:sequenceFlow id="F_G_A__G_B" name="No" sourceRef="G_A" targetRef="G_B" />
  <bpmn:sequenceFlow id="F_G_B__T07" name="Sí" sourceRef="G_B" targetRef="T07" />
  <bpmn:sequenceFlow id="F_G_B__G_M" name="No" sourceRef="G_B" targetRef="G_M" />
  <bpmn:sequenceFlow id="F_T07__T08" sourceRef="T07" targetRef="T08" />
  <bpmn:sequenceFlow id="F_T08__T09" sourceRef="T08" targetRef="T09" />
  <bpmn:sequenceFlow id="F_G_M__T14" name="Sí" sourceRef="G_M" targetRef="T14" />
  <bpmn:sequenceFlow id="F_G_M__T10" name="No" sourceRef="G_M" targetRef="T10" />
  <bpmn:sequenceFlow id="F_T14__T15" sourceRef="T14" targetRef="T15" />
  <bpmn:sequenceFlow id="F_T10__T11" sourceRef="T10" targetRef="T11" />
  <bpmn:sequenceFlow id="F_T11__T12" sourceRef="T11" targetRef="T12" />
  <bpmn:sequenceFlow id="F_T12__T13" sourceRef="T12" targetRef="T13" />
  <bpmn:sequenceFlow id="F_T09__J3" sourceRef="T09" targetRef="J3" />
  <bpmn:sequenceFlow id="F_T15__J3" sourceRef="T15" targetRef="J3" />
  <bpmn:sequenceFlow id="F_T13__J3" sourceRef="T13" targetRef="J3" />
  <bpmn:sequenceFlow id="F_J3__T16" sourceRef="J3" targetRef="T16" />
  <bpmn:sequenceFlow id="F_T16__G_A2" sourceRef="T16" targetRef="G_A2" />
  <bpmn:sequenceFlow id="F_G_A2__T18" name="Sí" sourceRef="G_A2" targetRef="T18" />
  <bpmn:sequenceFlow id="F_G_A2__G_B2" name="No" sourceRef="G_A2" targetRef="G_B2" />
  <bpmn:sequenceFlow id="F_G_B2__T19" name="Sí" sourceRef="G_B2" targetRef="T19" />
  <bpmn:sequenceFlow id="F_G_B2__G_C2" name="No" sourceRef="G_B2" targetRef="G_C2" />
  <bpmn:sequenceFlow id="F_G_C2__T30" name="Sí" sourceRef="G_C2" targetRef="T30" />
  <bpmn:sequenceFlow id="F_G_C2__T17" name="No" sourceRef="G_C2" targetRef="T17" />
  <bpmn:sequenceFlow id="F_T19__T20" sourceRef="T19" targetRef="T20" />
  <bpmn:sequenceFlow id="F_T20__T21" sourceRef="T20" targetRef="T21" />
  <bpmn:sequenceFlow id="F_T21__M22" sourceRef="T21" targetRef="M22" />
  <bpmn:sequenceFlow id="F_T18__M22" sourceRef="T18" targetRef="M22" />
  <bpmn:sequenceFlow id="F_T30__T31" sourceRef="T30" targetRef="T31" />
  <bpmn:sequenceFlow id="F_T31__T32" sourceRef="T31" targetRef="T32" />
  <bpmn:sequenceFlow id="F_T32__End_Card" sourceRef="T32" targetRef="End_Card" />
  <bpmn:sequenceFlow id="F_T17__T33" sourceRef="T17" targetRef="T33" />
  <bpmn:sequenceFlow id="F_T33__G_S" sourceRef="T33" targetRef="G_S" />
  <bpmn:sequenceFlow id="F_G_S__T35" name="Sí" sourceRef="G_S" targetRef="T35" />
  <bpmn:sequenceFlow id="F_G_S__T34" name="No" sourceRef="G_S" targetRef="T34" />
  <bpmn:sequenceFlow id="F_T35__End_Reemb" sourceRef="T35" targetRef="End_Reemb" />
  <bpmn:sequenceFlow id="F_T34__End_Cargo" sourceRef="T34" targetRef="End_Cargo" />
  <bpmn:sequenceFlow id="F_M22__T22" sourceRef="M22" targetRef="T22" />
  <bpmn:sequenceFlow id="F_T22__T23" sourceRef="T22" targetRef="T23" />
  <bpmn:sequenceFlow id="F_T23__G_E" sourceRef="T23" targetRef="G_E" />
  <bpmn:sequenceFlow id="F_G_E__T25" name="Sí" sourceRef="G_E" targetRef="T25" />
  <bpmn:sequenceFlow id="F_G_E__T24" name="No" sourceRef="G_E" targetRef="T24" />
  <bpmn:sequenceFlow id="F_T24__M22" sourceRef="T24" targetRef="M22" />
  <bpmn:sequenceFlow id="F_T25__T26" sourceRef="T25" targetRef="T26" />
  <bpmn:sequenceFlow id="F_T26__T27" sourceRef="T26" targetRef="T27" />
  <bpmn:sequenceFlow id="F_T27__T28" sourceRef="T27" targetRef="T28" />
  <bpmn:sequenceFlow id="F_T28__End_Ok" sourceRef="T28" targetRef="End_Ok" />
</bpmn:process>
<bpmndi:BPMNDiagram id="BPMNDiagram_adquisiciones-gastos">
  <bpmndi:BPMNPlane id="BPMNPlane_adquisiciones-gastos" bpmnElement="Collab_adquisiciones-gastos">
    <bpmndi:BPMNShape id="Part_adquisiciones-gastos_di" bpmnElement="Part_adquisiciones-gastos" isHorizontal="true"><dc:Bounds x="40" y="40" width="4975" height="1060" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Lane_Solicitante_di" bpmnElement="Lane_Solicitante" isHorizontal="true"><dc:Bounds x="70" y="40" width="4945" height="280" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Lane_Aprobadores_di" bpmnElement="Lane_Aprobadores" isHorizontal="true"><dc:Bounds x="70" y="320" width="4945" height="140" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Lane_AF_di" bpmnElement="Lane_AF" isHorizontal="true"><dc:Bounds x="70" y="460" width="4945" height="640" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="132" y="92" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="95" y="132" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T01_di" bpmnElement="T01"><dc:Bounds x="245" y="70" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T01b_di" bpmnElement="T01b"><dc:Bounds x="410" y="350" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T02_di" bpmnElement="T02"><dc:Bounds x="575" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_apr_di" bpmnElement="G_apr" isMarkerVisible="true"><dc:Bounds x="785" y="515" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="660" y="482" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_NoApr_di" bpmnElement="End_NoApr"><dc:Bounds x="792" y="642" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="755" y="682" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T03_di" bpmnElement="T03"><dc:Bounds x="905" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_pres_di" bpmnElement="G_pres" isMarkerVisible="true"><dc:Bounds x="1115" y="515" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="990" y="482" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_NoPres_di" bpmnElement="End_NoPres"><dc:Bounds x="1122" y="642" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="1085" y="682" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T04_di" bpmnElement="T04"><dc:Bounds x="1235" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T05_di" bpmnElement="T05"><dc:Bounds x="1400" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T06_di" bpmnElement="T06"><dc:Bounds x="1565" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_A_di" bpmnElement="G_A" isMarkerVisible="true"><dc:Bounds x="1775" y="515" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="1650" y="482" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_B_di" bpmnElement="G_B" isMarkerVisible="true"><dc:Bounds x="1775" y="635" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="1650" y="602" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_M_di" bpmnElement="G_M" isMarkerVisible="true"><dc:Bounds x="1775" y="755" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="1650" y="722" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T07_di" bpmnElement="T07"><dc:Bounds x="1895" y="620" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T08_di" bpmnElement="T08"><dc:Bounds x="2060" y="620" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T09_di" bpmnElement="T09"><dc:Bounds x="2225" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T14_di" bpmnElement="T14"><dc:Bounds x="1895" y="70" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T15_di" bpmnElement="T15"><dc:Bounds x="2060" y="740" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T10_di" bpmnElement="T10"><dc:Bounds x="1895" y="210" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T11_di" bpmnElement="T11"><dc:Bounds x="2060" y="860" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T12_di" bpmnElement="T12"><dc:Bounds x="2225" y="860" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T13_di" bpmnElement="T13"><dc:Bounds x="2390" y="210" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="J3_di" bpmnElement="J3" isMarkerVisible="true"><dc:Bounds x="2600" y="515" width="50" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T16_di" bpmnElement="T16"><dc:Bounds x="2720" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_A2_di" bpmnElement="G_A2" isMarkerVisible="true"><dc:Bounds x="2930" y="515" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="2805" y="482" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_B2_di" bpmnElement="G_B2" isMarkerVisible="true"><dc:Bounds x="2930" y="635" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="2805" y="602" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_C2_di" bpmnElement="G_C2" isMarkerVisible="true"><dc:Bounds x="2930" y="755" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="2805" y="722" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T18_di" bpmnElement="T18"><dc:Bounds x="3050" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T19_di" bpmnElement="T19"><dc:Bounds x="3050" y="620" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T20_di" bpmnElement="T20"><dc:Bounds x="3215" y="620" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T21_di" bpmnElement="T21"><dc:Bounds x="3380" y="620" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T30_di" bpmnElement="T30"><dc:Bounds x="3050" y="740" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T31_di" bpmnElement="T31"><dc:Bounds x="3215" y="740" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T32_di" bpmnElement="T32"><dc:Bounds x="3380" y="740" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_Card_di" bpmnElement="End_Card"><dc:Bounds x="3597" y="762" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="3560" y="802" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T17_di" bpmnElement="T17"><dc:Bounds x="3050" y="860" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T33_di" bpmnElement="T33"><dc:Bounds x="3215" y="860" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_S_di" bpmnElement="G_S" isMarkerVisible="true"><dc:Bounds x="3425" y="875" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="3300" y="842" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T35_di" bpmnElement="T35"><dc:Bounds x="3545" y="860" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_Reemb_di" bpmnElement="End_Reemb"><dc:Bounds x="3762" y="882" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="3725" y="922" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T34_di" bpmnElement="T34"><dc:Bounds x="3545" y="980" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_Cargo_di" bpmnElement="End_Cargo"><dc:Bounds x="3762" y="1002" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="3725" y="1042" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="M22_di" bpmnElement="M22" isMarkerVisible="true"><dc:Bounds x="3590" y="515" width="50" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T22_di" bpmnElement="T22"><dc:Bounds x="3710" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T23_di" bpmnElement="T23"><dc:Bounds x="3875" y="210" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_E_di" bpmnElement="G_E" isMarkerVisible="true"><dc:Bounds x="4085" y="225" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="3960" y="192" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T24_di" bpmnElement="T24"><dc:Bounds x="3875" y="70" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T25_di" bpmnElement="T25"><dc:Bounds x="4205" y="210" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T26_di" bpmnElement="T26"><dc:Bounds x="4370" y="350" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T27_di" bpmnElement="T27"><dc:Bounds x="4535" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T28_di" bpmnElement="T28"><dc:Bounds x="4700" y="500" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_Ok_di" bpmnElement="End_Ok"><dc:Bounds x="4917" y="522" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="4880" y="562" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F_Start__T01_di" bpmnElement="F_Start__T01"><di:waypoint x="168" y="110" /><di:waypoint x="245" y="110" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T01__T01b_di" bpmnElement="F_T01__T01b"><di:waypoint x="385" y="110" /><di:waypoint x="397" y="110" /><di:waypoint x="397" y="390" /><di:waypoint x="410" y="390" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T01b__T02_di" bpmnElement="F_T01b__T02"><di:waypoint x="550" y="390" /><di:waypoint x="562" y="390" /><di:waypoint x="562" y="540" /><di:waypoint x="575" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T02__G_apr_di" bpmnElement="F_T02__G_apr"><di:waypoint x="715" y="540" /><di:waypoint x="785" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_apr__T03_di" bpmnElement="F_G_apr__T03"><di:waypoint x="835" y="540" /><di:waypoint x="905" y="540" /><bpmndi:BPMNLabel><dc:Bounds x="841" y="522" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_apr__End_NoApr_di" bpmnElement="F_G_apr__End_NoApr"><di:waypoint x="810" y="565" /><di:waypoint x="810" y="642" /><bpmndi:BPMNLabel><dc:Bounds x="816" y="569" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T03__G_pres_di" bpmnElement="F_T03__G_pres"><di:waypoint x="1045" y="540" /><di:waypoint x="1115" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_pres__T04_di" bpmnElement="F_G_pres__T04"><di:waypoint x="1165" y="540" /><di:waypoint x="1235" y="540" /><bpmndi:BPMNLabel><dc:Bounds x="1171" y="522" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_pres__End_NoPres_di" bpmnElement="F_G_pres__End_NoPres"><di:waypoint x="1140" y="565" /><di:waypoint x="1140" y="642" /><bpmndi:BPMNLabel><dc:Bounds x="1146" y="569" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T04__T05_di" bpmnElement="F_T04__T05"><di:waypoint x="1375" y="540" /><di:waypoint x="1400" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T05__T06_di" bpmnElement="F_T05__T06"><di:waypoint x="1540" y="540" /><di:waypoint x="1565" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T06__G_A_di" bpmnElement="F_T06__G_A"><di:waypoint x="1705" y="540" /><di:waypoint x="1775" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_A__T09_di" bpmnElement="F_G_A__T09"><di:waypoint x="1825" y="540" /><di:waypoint x="2225" y="540" /><bpmndi:BPMNLabel><dc:Bounds x="1831" y="522" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_A__G_B_di" bpmnElement="F_G_A__G_B"><di:waypoint x="1800" y="565" /><di:waypoint x="1800" y="635" /><bpmndi:BPMNLabel><dc:Bounds x="1806" y="569" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_B__T07_di" bpmnElement="F_G_B__T07"><di:waypoint x="1825" y="660" /><di:waypoint x="1895" y="660" /><bpmndi:BPMNLabel><dc:Bounds x="1831" y="642" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_B__G_M_di" bpmnElement="F_G_B__G_M"><di:waypoint x="1800" y="685" /><di:waypoint x="1800" y="755" /><bpmndi:BPMNLabel><dc:Bounds x="1806" y="689" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T07__T08_di" bpmnElement="F_T07__T08"><di:waypoint x="2035" y="660" /><di:waypoint x="2060" y="660" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T08__T09_di" bpmnElement="F_T08__T09"><di:waypoint x="2200" y="660" /><di:waypoint x="2212" y="660" /><di:waypoint x="2212" y="540" /><di:waypoint x="2225" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_M__T14_di" bpmnElement="F_G_M__T14"><di:waypoint x="1825" y="780" /><di:waypoint x="1835" y="780" /><di:waypoint x="1835" y="110" /><di:waypoint x="1895" y="110" /><bpmndi:BPMNLabel><dc:Bounds x="1831" y="762" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_M__T10_di" bpmnElement="F_G_M__T10"><di:waypoint x="1825" y="780" /><di:waypoint x="1885" y="780" /><di:waypoint x="1885" y="250" /><di:waypoint x="1895" y="250" /><bpmndi:BPMNLabel><dc:Bounds x="1831" y="762" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T14__T15_di" bpmnElement="F_T14__T15"><di:waypoint x="2035" y="110" /><di:waypoint x="2047" y="110" /><di:waypoint x="2047" y="780" /><di:waypoint x="2060" y="780" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T10__T11_di" bpmnElement="F_T10__T11"><di:waypoint x="2035" y="250" /><di:waypoint x="2047" y="250" /><di:waypoint x="2047" y="900" /><di:waypoint x="2060" y="900" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T11__T12_di" bpmnElement="F_T11__T12"><di:waypoint x="2200" y="900" /><di:waypoint x="2225" y="900" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T12__T13_di" bpmnElement="F_T12__T13"><di:waypoint x="2365" y="900" /><di:waypoint x="2377" y="900" /><di:waypoint x="2377" y="250" /><di:waypoint x="2390" y="250" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T09__J3_di" bpmnElement="F_T09__J3"><di:waypoint x="2365" y="540" /><di:waypoint x="2600" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T15__J3_di" bpmnElement="F_T15__J3"><di:waypoint x="2200" y="780" /><di:waypoint x="2400" y="780" /><di:waypoint x="2400" y="540" /><di:waypoint x="2600" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T13__J3_di" bpmnElement="F_T13__J3"><di:waypoint x="2530" y="250" /><di:waypoint x="2565" y="250" /><di:waypoint x="2565" y="540" /><di:waypoint x="2600" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_J3__T16_di" bpmnElement="F_J3__T16"><di:waypoint x="2650" y="540" /><di:waypoint x="2720" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T16__G_A2_di" bpmnElement="F_T16__G_A2"><di:waypoint x="2860" y="540" /><di:waypoint x="2930" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_A2__T18_di" bpmnElement="F_G_A2__T18"><di:waypoint x="2980" y="540" /><di:waypoint x="3050" y="540" /><bpmndi:BPMNLabel><dc:Bounds x="2986" y="522" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_A2__G_B2_di" bpmnElement="F_G_A2__G_B2"><di:waypoint x="2955" y="565" /><di:waypoint x="2955" y="635" /><bpmndi:BPMNLabel><dc:Bounds x="2961" y="569" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_B2__T19_di" bpmnElement="F_G_B2__T19"><di:waypoint x="2980" y="660" /><di:waypoint x="3050" y="660" /><bpmndi:BPMNLabel><dc:Bounds x="2986" y="642" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_B2__G_C2_di" bpmnElement="F_G_B2__G_C2"><di:waypoint x="2955" y="685" /><di:waypoint x="2955" y="755" /><bpmndi:BPMNLabel><dc:Bounds x="2961" y="689" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_C2__T30_di" bpmnElement="F_G_C2__T30"><di:waypoint x="2980" y="780" /><di:waypoint x="3050" y="780" /><bpmndi:BPMNLabel><dc:Bounds x="2986" y="762" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_C2__T17_di" bpmnElement="F_G_C2__T17"><di:waypoint x="2980" y="780" /><di:waypoint x="3015" y="780" /><di:waypoint x="3015" y="900" /><di:waypoint x="3050" y="900" /><bpmndi:BPMNLabel><dc:Bounds x="2986" y="762" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T19__T20_di" bpmnElement="F_T19__T20"><di:waypoint x="3190" y="660" /><di:waypoint x="3215" y="660" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T20__T21_di" bpmnElement="F_T20__T21"><di:waypoint x="3355" y="660" /><di:waypoint x="3380" y="660" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T21__M22_di" bpmnElement="F_T21__M22"><di:waypoint x="3520" y="660" /><di:waypoint x="3555" y="660" /><di:waypoint x="3555" y="540" /><di:waypoint x="3590" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T18__M22_di" bpmnElement="F_T18__M22"><di:waypoint x="3190" y="540" /><di:waypoint x="3590" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T30__T31_di" bpmnElement="F_T30__T31"><di:waypoint x="3190" y="780" /><di:waypoint x="3215" y="780" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T31__T32_di" bpmnElement="F_T31__T32"><di:waypoint x="3355" y="780" /><di:waypoint x="3380" y="780" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T32__End_Card_di" bpmnElement="F_T32__End_Card"><di:waypoint x="3520" y="780" /><di:waypoint x="3597" y="780" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T17__T33_di" bpmnElement="F_T17__T33"><di:waypoint x="3190" y="900" /><di:waypoint x="3215" y="900" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T33__G_S_di" bpmnElement="F_T33__G_S"><di:waypoint x="3355" y="900" /><di:waypoint x="3425" y="900" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_S__T35_di" bpmnElement="F_G_S__T35"><di:waypoint x="3475" y="900" /><di:waypoint x="3545" y="900" /><bpmndi:BPMNLabel><dc:Bounds x="3481" y="882" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_S__T34_di" bpmnElement="F_G_S__T34"><di:waypoint x="3450" y="925" /><di:waypoint x="3450" y="1020" /><di:waypoint x="3545" y="1020" /><bpmndi:BPMNLabel><dc:Bounds x="3456" y="929" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T35__End_Reemb_di" bpmnElement="F_T35__End_Reemb"><di:waypoint x="3685" y="900" /><di:waypoint x="3762" y="900" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T34__End_Cargo_di" bpmnElement="F_T34__End_Cargo"><di:waypoint x="3685" y="1020" /><di:waypoint x="3762" y="1020" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_M22__T22_di" bpmnElement="F_M22__T22"><di:waypoint x="3640" y="540" /><di:waypoint x="3710" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T22__T23_di" bpmnElement="F_T22__T23"><di:waypoint x="3850" y="540" /><di:waypoint x="3862" y="540" /><di:waypoint x="3862" y="250" /><di:waypoint x="3875" y="250" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T23__G_E_di" bpmnElement="F_T23__G_E"><di:waypoint x="4015" y="250" /><di:waypoint x="4085" y="250" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_E__T25_di" bpmnElement="F_G_E__T25"><di:waypoint x="4135" y="250" /><di:waypoint x="4205" y="250" /><bpmndi:BPMNLabel><dc:Bounds x="4141" y="232" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G_E__T24_di" bpmnElement="F_G_E__T24"><di:waypoint x="4110" y="225" /><di:waypoint x="4110" y="110" /><di:waypoint x="4015" y="110" /><bpmndi:BPMNLabel><dc:Bounds x="4116" y="229" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T24__M22_di" bpmnElement="F_T24__M22"><di:waypoint x="3875" y="110" /><di:waypoint x="3615" y="110" /><di:waypoint x="3615" y="515" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T25__T26_di" bpmnElement="F_T25__T26"><di:waypoint x="4345" y="250" /><di:waypoint x="4357" y="250" /><di:waypoint x="4357" y="390" /><di:waypoint x="4370" y="390" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T26__T27_di" bpmnElement="F_T26__T27"><di:waypoint x="4510" y="390" /><di:waypoint x="4522" y="390" /><di:waypoint x="4522" y="540" /><di:waypoint x="4535" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T27__T28_di" bpmnElement="F_T27__T28"><di:waypoint x="4675" y="540" /><di:waypoint x="4700" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_T28__End_Ok_di" bpmnElement="F_T28__End_Ok"><di:waypoint x="4840" y="540" /><di:waypoint x="4917" y="540" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane>
</bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

export const RENOVACION_LICENCIAS_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_renovacion-licenciamiento" targetNamespace="mx.seguridata.prestige" exporter="Prestige" exporterVersion="0.2.0">
<bpmn:process id="renovacion-licenciamiento" name="Subproceso: Renovación de licenciamiento" isExecutable="true">
  <bpmn:startEvent id="S" name="Vencimiento de licencia o mantenimiento">
    <bpmn:outgoing>F_S__R1</bpmn:outgoing>
  </bpmn:startEvent>
  <bpmn:userTask id="R1" name="1. Monitorear vencimientos de licencias y mantenimientos">
    <bpmn:documentation>Responsable del área. El primer lunes de cada mes A&amp;F convoca revisión: ¿qué vence en 90 días?, ¿a quién le toca gestionarlas?, ¿están en presupuesto? OLA permanente.</bpmn:documentation>
    <bpmn:incoming>F_S__R1</bpmn:incoming>
    <bpmn:outgoing>F_R1__R2</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="R2" name="2. Solicitar pago de renovación a A&amp;F por correo">
    <bpmn:documentation>Responsable del área, con mínimo 60 días de anticipación al vencimiento.</bpmn:documentation>
    <bpmn:incoming>F_R1__R2</bpmn:incoming>
    <bpmn:outgoing>F_R2__R3</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="R3" name="3. Validar renovación contra presupuesto aprobado">
    <bpmn:documentation>Ejecutivo de administración y tesorería. OLA 30 min.</bpmn:documentation>
    <bpmn:incoming>F_R2__R3</bpmn:incoming>
    <bpmn:outgoing>F_R3__GR</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:exclusiveGateway id="GR" name="¿Está en presupuesto?">
    <bpmn:incoming>F_R3__GR</bpmn:incoming>
    <bpmn:outgoing>F_GR__RC</bpmn:outgoing>
    <bpmn:outgoing>F_GR__RX</bpmn:outgoing>
  </bpmn:exclusiveGateway>
  <bpmn:userTask id="RC" name="Proceder a compra directa (proceso principal)">
    <bpmn:documentation>Continúa en el proceso Adquisiciones (Gastos) hacia la compra directa, según el diagrama original.</bpmn:documentation>
    <bpmn:incoming>F_GR__RC</bpmn:incoming>
    <bpmn:outgoing>F_RC__RE1</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="RX" name="Rechazar y regresar al responsable de área">
    <bpmn:documentation>Se rechaza hasta contar con autorización de la dirección general.</bpmn:documentation>
    <bpmn:incoming>F_GR__RX</bpmn:incoming>
    <bpmn:outgoing>F_RX__RE2</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:endEvent id="RE1" name="Renovación enviada a compra">
    <bpmn:incoming>F_RC__RE1</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:endEvent id="RE2" name="Adquisición rechazada">
    <bpmn:incoming>F_RX__RE2</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:sequenceFlow id="F_S__R1" sourceRef="S" targetRef="R1" />
  <bpmn:sequenceFlow id="F_R1__R2" sourceRef="R1" targetRef="R2" />
  <bpmn:sequenceFlow id="F_R2__R3" sourceRef="R2" targetRef="R3" />
  <bpmn:sequenceFlow id="F_R3__GR" sourceRef="R3" targetRef="GR" />
  <bpmn:sequenceFlow id="F_GR__RC" name="Sí" sourceRef="GR" targetRef="RC" />
  <bpmn:sequenceFlow id="F_RC__RE1" sourceRef="RC" targetRef="RE1" />
  <bpmn:sequenceFlow id="F_RX__RE2" sourceRef="RX" targetRef="RE2" />
  <bpmn:sequenceFlow id="F_GR__RX" name="No" sourceRef="GR" targetRef="RX" />
</bpmn:process>
<bpmndi:BPMNDiagram id="BPMNDiagram_renovacion-licenciamiento">
  <bpmndi:BPMNPlane id="BPMNPlane_renovacion-licenciamiento" bpmnElement="renovacion-licenciamiento">
    <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="132" y="182" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="95" y="222" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="R1_di" bpmnElement="R1"><dc:Bounds x="250" y="160" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="R2_di" bpmnElement="R2"><dc:Bounds x="420" y="160" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="R3_di" bpmnElement="R3"><dc:Bounds x="590" y="160" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="GR_di" bpmnElement="GR" isMarkerVisible="true"><dc:Bounds x="805" y="175" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="680" y="142" width="140" height="32" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="RC_di" bpmnElement="RC"><dc:Bounds x="930" y="160" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="RX_di" bpmnElement="RX"><dc:Bounds x="930" y="290" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="RE1_di" bpmnElement="RE1"><dc:Bounds x="1152" y="182" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="1115" y="222" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="RE2_di" bpmnElement="RE2"><dc:Bounds x="1152" y="312" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="1115" y="352" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F_S__R1_di" bpmnElement="F_S__R1"><di:waypoint x="168" y="200" /><di:waypoint x="250" y="200" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_R1__R2_di" bpmnElement="F_R1__R2"><di:waypoint x="390" y="200" /><di:waypoint x="420" y="200" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_R2__R3_di" bpmnElement="F_R2__R3"><di:waypoint x="560" y="200" /><di:waypoint x="590" y="200" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_R3__GR_di" bpmnElement="F_R3__GR"><di:waypoint x="730" y="200" /><di:waypoint x="805" y="200" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_GR__RC_di" bpmnElement="F_GR__RC"><di:waypoint x="855" y="200" /><di:waypoint x="930" y="200" /><bpmndi:BPMNLabel><dc:Bounds x="861" y="182" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_RC__RE1_di" bpmnElement="F_RC__RE1"><di:waypoint x="1070" y="200" /><di:waypoint x="1152" y="200" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_RX__RE2_di" bpmnElement="F_RX__RE2"><di:waypoint x="1070" y="330" /><di:waypoint x="1152" y="330" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_GR__RX_di" bpmnElement="F_GR__RX"><di:waypoint x="830" y="225" /><di:waypoint x="830" y="330" /><di:waypoint x="930" y="330" /><bpmndi:BPMNLabel><dc:Bounds x="836" y="229" width="20" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane>
</bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

export const PROVEEDORES_ESTRATEGICOS_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_proveedores-estrategicos" targetNamespace="mx.seguridata.prestige" exporter="Prestige" exporterVersion="0.2.0">
<bpmn:process id="proveedores-estrategicos" name="Subproceso: Gestión de proveedores estratégicos" isExecutable="true">
  <bpmn:startEvent id="S" name="Revisión anual (diciembre)">
    <bpmn:outgoing>F_S__G1</bpmn:outgoing>
  </bpmn:startEvent>
  <bpmn:userTask id="G1" name="1. Revisar desempeño de proveedores estratégicos y calendario de renovaciones">
    <bpmn:documentation>A&amp;F + responsable del área. OLA: anual, primeros días de diciembre.</bpmn:documentation>
    <bpmn:incoming>F_S__G1</bpmn:incoming>
    <bpmn:outgoing>F_G1__G2</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="G2" name="2. Negociar anualmente precios, descuentos, niveles de servicio y vigencias">
    <bpmn:documentation>Compras anuales (proveedor estratégico con negociación vigente): no se renegocia en cada compra. No anuales: A&amp;F siempre hace el último push comercial (descuento adicional + días de crédito). OLA 1 día por proveedor.</bpmn:documentation>
    <bpmn:incoming>F_G1__G2</bpmn:incoming>
    <bpmn:outgoing>F_G2__G3</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:userTask id="G3" name="3. Actualizar lista de proveedores estratégicos aprobados">
    <bpmn:documentation>A&amp;F actualiza la lista y el resultado de negociación. OLA 1 día.</bpmn:documentation>
    <bpmn:incoming>F_G2__G3</bpmn:incoming>
    <bpmn:outgoing>F_G3__E</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:endEvent id="E" name="Lista actualizada">
    <bpmn:incoming>F_G3__E</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:sequenceFlow id="F_S__G1" sourceRef="S" targetRef="G1" />
  <bpmn:sequenceFlow id="F_G1__G2" sourceRef="G1" targetRef="G2" />
  <bpmn:sequenceFlow id="F_G2__G3" sourceRef="G2" targetRef="G3" />
  <bpmn:sequenceFlow id="F_G3__E" sourceRef="G3" targetRef="E" />
</bpmn:process>
<bpmndi:BPMNDiagram id="BPMNDiagram_proveedores-estrategicos">
  <bpmndi:BPMNPlane id="BPMNPlane_proveedores-estrategicos" bpmnElement="proveedores-estrategicos">
    <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="132" y="182" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="95" y="222" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G1_di" bpmnElement="G1"><dc:Bounds x="250" y="160" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G2_di" bpmnElement="G2"><dc:Bounds x="420" y="160" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G3_di" bpmnElement="G3"><dc:Bounds x="590" y="160" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="812" y="182" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="775" y="222" width="110" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F_S__G1_di" bpmnElement="F_S__G1"><di:waypoint x="168" y="200" /><di:waypoint x="250" y="200" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G1__G2_di" bpmnElement="F_G1__G2"><di:waypoint x="390" y="200" /><di:waypoint x="420" y="200" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G2__G3_di" bpmnElement="F_G2__G3"><di:waypoint x="560" y="200" /><di:waypoint x="590" y="200" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_G3__E_di" bpmnElement="F_G3__E"><di:waypoint x="730" y="200" /><di:waypoint x="812" y="200" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane>
</bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

