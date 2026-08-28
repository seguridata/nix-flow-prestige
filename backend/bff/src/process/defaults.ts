export const CONTRATO_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_PrestigeContrato" targetNamespace="mx.seguridata.prestige" exporter="Prestige" exporterVersion="0.2.0">
  <bpmn:process id="contrato-dos-partes" name="Contrato corporativo de dos partes" isExecutable="true">
    <bpmn:startEvent id="Start" name="Solicitud creada">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Legal" name="Revisión legal">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:userTask id="Task_FirmaA" name="Firma — Parte A">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gw_A" name="¿Aceptó A?">
      <bpmn:incoming>Flow_3</bpmn:incoming>
      <bpmn:outgoing>Flow_A_Yes</bpmn:outgoing>
      <bpmn:outgoing>Flow_A_No</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:userTask id="Task_FirmaB" name="Firma — Parte B">
      <bpmn:incoming>Flow_A_Yes</bpmn:incoming>
      <bpmn:outgoing>Flow_4</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gw_B" name="¿Aceptó B?">
      <bpmn:incoming>Flow_4</bpmn:incoming>
      <bpmn:outgoing>Flow_B_Yes</bpmn:outgoing>
      <bpmn:outgoing>Flow_B_No</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:serviceTask id="Task_Validar" name="Validar confianza">
      <bpmn:incoming>Flow_B_Yes</bpmn:incoming>
      <bpmn:outgoing>Flow_5</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:serviceTask id="Task_Evidencia" name="Construir evidencia">
      <bpmn:incoming>Flow_5</bpmn:incoming>
      <bpmn:outgoing>Flow_6</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End_Ok" name="Contrato cerrado">
      <bpmn:incoming>Flow_6</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Reject" name="Rechazado">
      <bpmn:incoming>Flow_A_No</bpmn:incoming>
      <bpmn:incoming>Flow_B_No</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start" targetRef="Task_Legal" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Legal" targetRef="Task_FirmaA" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_FirmaA" targetRef="Gw_A" />
    <bpmn:sequenceFlow id="Flow_A_Yes" name="Sí" sourceRef="Gw_A" targetRef="Task_FirmaB" />
    <bpmn:sequenceFlow id="Flow_A_No" name="No" sourceRef="Gw_A" targetRef="End_Reject" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_FirmaB" targetRef="Gw_B" />
    <bpmn:sequenceFlow id="Flow_B_Yes" name="Sí" sourceRef="Gw_B" targetRef="Task_Validar" />
    <bpmn:sequenceFlow id="Flow_B_No" name="No" sourceRef="Gw_B" targetRef="End_Reject" />
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Task_Validar" targetRef="Task_Evidencia" />
    <bpmn:sequenceFlow id="Flow_6" sourceRef="Task_Evidencia" targetRef="End_Ok" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="contrato-dos-partes">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start">
        <dc:Bounds x="152" y="222" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="132" y="265" width="77" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Legal_di" bpmnElement="Task_Legal">
        <dc:Bounds x="230" y="200" width="130" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_FirmaA_di" bpmnElement="Task_FirmaA">
        <dc:Bounds x="400" y="200" width="130" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gw_A_di" bpmnElement="Gw_A" isMarkerVisible="true">
        <dc:Bounds x="575" y="215" width="50" height="50" />
        <bpmndi:BPMNLabel><dc:Bounds x="568" y="188" width="64" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_FirmaB_di" bpmnElement="Task_FirmaB">
        <dc:Bounds x="670" y="200" width="130" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gw_B_di" bpmnElement="Gw_B" isMarkerVisible="true">
        <dc:Bounds x="845" y="215" width="50" height="50" />
        <bpmndi:BPMNLabel><dc:Bounds x="838" y="188" width="64" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Validar_di" bpmnElement="Task_Validar">
        <dc:Bounds x="940" y="200" width="130" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Evidencia_di" bpmnElement="Task_Evidencia">
        <dc:Bounds x="1110" y="200" width="140" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Ok_di" bpmnElement="End_Ok">
        <dc:Bounds x="1300" y="222" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="1278" y="265" width="84" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Reject_di" bpmnElement="End_Reject">
        <dc:Bounds x="582" y="340" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="572" y="383" width="56" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="188" y="240" /><di:waypoint x="230" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="360" y="240" /><di:waypoint x="400" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3"><di:waypoint x="530" y="240" /><di:waypoint x="575" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_A_Yes_di" bpmnElement="Flow_A_Yes"><di:waypoint x="625" y="240" /><di:waypoint x="670" y="240" /><bpmndi:BPMNLabel><dc:Bounds x="638" y="222" width="11" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_A_No_di" bpmnElement="Flow_A_No"><di:waypoint x="600" y="265" /><di:waypoint x="600" y="340" /><bpmndi:BPMNLabel><dc:Bounds x="608" y="298" width="15" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_4_di" bpmnElement="Flow_4"><di:waypoint x="800" y="240" /><di:waypoint x="845" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_B_Yes_di" bpmnElement="Flow_B_Yes"><di:waypoint x="895" y="240" /><di:waypoint x="940" y="240" /><bpmndi:BPMNLabel><dc:Bounds x="908" y="222" width="11" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_B_No_di" bpmnElement="Flow_B_No"><di:waypoint x="870" y="265" /><di:waypoint x="870" y="358" /><di:waypoint x="618" y="358" /><bpmndi:BPMNLabel><dc:Bounds x="730" y="340" width="15" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_5_di" bpmnElement="Flow_5"><di:waypoint x="1070" y="240" /><di:waypoint x="1110" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_6_di" bpmnElement="Flow_6"><di:waypoint x="1250" y="240" /><di:waypoint x="1300" y="240" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

export const ONBOARDING_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_PrestigeOnboarding" targetNamespace="mx.seguridata.prestige" exporter="Prestige" exporterVersion="0.2.0">
  <bpmn:process id="onboarding-identidad" name="Onboarding e identidad digital" isExecutable="true">
    <bpmn:startEvent id="Start_Onb" name="Alta iniciada">
      <bpmn:outgoing>Onb_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Datos" name="Captura de datos">
      <bpmn:incoming>Onb_1</bpmn:incoming>
      <bpmn:outgoing>Onb_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:userTask id="Task_INE" name="Captura INE">
      <bpmn:incoming>Onb_2</bpmn:incoming>
      <bpmn:outgoing>Onb_3</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gw_INE" name="¿INE válida?">
      <bpmn:incoming>Onb_3</bpmn:incoming>
      <bpmn:outgoing>Onb_INE_Yes</bpmn:outgoing>
      <bpmn:outgoing>Onb_INE_No</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:userTask id="Task_Vida" name="Prueba de vida">
      <bpmn:incoming>Onb_INE_Yes</bpmn:incoming>
      <bpmn:outgoing>Onb_4</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gw_Vida" name="¿Liveness ok?">
      <bpmn:incoming>Onb_4</bpmn:incoming>
      <bpmn:outgoing>Onb_Vida_Yes</bpmn:outgoing>
      <bpmn:outgoing>Onb_Vida_No</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:serviceTask id="Task_Match" name="Face-match">
      <bpmn:incoming>Onb_Vida_Yes</bpmn:incoming>
      <bpmn:outgoing>Onb_5</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:userTask id="Task_Enable" name="Habilitar firma">
      <bpmn:incoming>Onb_5</bpmn:incoming>
      <bpmn:outgoing>Onb_6</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="End_Onb_Ok" name="Identidad habilitada">
      <bpmn:incoming>Onb_6</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Onb_No" name="Alta rechazada">
      <bpmn:incoming>Onb_INE_No</bpmn:incoming>
      <bpmn:incoming>Onb_Vida_No</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Onb_1" sourceRef="Start_Onb" targetRef="Task_Datos" />
    <bpmn:sequenceFlow id="Onb_2" sourceRef="Task_Datos" targetRef="Task_INE" />
    <bpmn:sequenceFlow id="Onb_3" sourceRef="Task_INE" targetRef="Gw_INE" />
    <bpmn:sequenceFlow id="Onb_INE_Yes" name="Sí" sourceRef="Gw_INE" targetRef="Task_Vida" />
    <bpmn:sequenceFlow id="Onb_INE_No" name="No" sourceRef="Gw_INE" targetRef="End_Onb_No" />
    <bpmn:sequenceFlow id="Onb_4" sourceRef="Task_Vida" targetRef="Gw_Vida" />
    <bpmn:sequenceFlow id="Onb_Vida_Yes" name="Sí" sourceRef="Gw_Vida" targetRef="Task_Match" />
    <bpmn:sequenceFlow id="Onb_Vida_No" name="No" sourceRef="Gw_Vida" targetRef="End_Onb_No" />
    <bpmn:sequenceFlow id="Onb_5" sourceRef="Task_Match" targetRef="Task_Enable" />
    <bpmn:sequenceFlow id="Onb_6" sourceRef="Task_Enable" targetRef="End_Onb_Ok" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_Onb">
    <bpmndi:BPMNPlane id="BPMNPlane_Onb" bpmnElement="onboarding-identidad">
      <bpmndi:BPMNShape id="Start_Onb_di" bpmnElement="Start_Onb"><dc:Bounds x="152" y="222" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Datos_di" bpmnElement="Task_Datos"><dc:Bounds x="230" y="200" width="120" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_INE_di" bpmnElement="Task_INE"><dc:Bounds x="390" y="200" width="120" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gw_INE_di" bpmnElement="Gw_INE" isMarkerVisible="true"><dc:Bounds x="555" y="215" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Vida_di" bpmnElement="Task_Vida"><dc:Bounds x="650" y="200" width="120" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gw_Vida_di" bpmnElement="Gw_Vida" isMarkerVisible="true"><dc:Bounds x="815" y="215" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Match_di" bpmnElement="Task_Match"><dc:Bounds x="910" y="200" width="120" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Enable_di" bpmnElement="Task_Enable"><dc:Bounds x="1070" y="200" width="120" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Onb_Ok_di" bpmnElement="End_Onb_Ok"><dc:Bounds x="1240" y="222" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Onb_No_di" bpmnElement="End_Onb_No"><dc:Bounds x="562" y="340" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Onb_1_di" bpmnElement="Onb_1"><di:waypoint x="188" y="240" /><di:waypoint x="230" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_2_di" bpmnElement="Onb_2"><di:waypoint x="350" y="240" /><di:waypoint x="390" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_3_di" bpmnElement="Onb_3"><di:waypoint x="510" y="240" /><di:waypoint x="555" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_INE_Yes_di" bpmnElement="Onb_INE_Yes"><di:waypoint x="605" y="240" /><di:waypoint x="650" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_INE_No_di" bpmnElement="Onb_INE_No"><di:waypoint x="580" y="265" /><di:waypoint x="580" y="340" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_4_di" bpmnElement="Onb_4"><di:waypoint x="770" y="240" /><di:waypoint x="815" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_Vida_Yes_di" bpmnElement="Onb_Vida_Yes"><di:waypoint x="865" y="240" /><di:waypoint x="910" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_Vida_No_di" bpmnElement="Onb_Vida_No"><di:waypoint x="840" y="265" /><di:waypoint x="840" y="358" /><di:waypoint x="598" y="358" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_5_di" bpmnElement="Onb_5"><di:waypoint x="1030" y="240" /><di:waypoint x="1070" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Onb_6_di" bpmnElement="Onb_6"><di:waypoint x="1190" y="240" /><di:waypoint x="1240" y="240" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

export const SLA_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" id="prestige_sla" name="SLA Prestige" namespace="https://seguridata.mx/prestige/dmn">
  <decision id="Decision_SLA" name="Determinar SLA y orden">
    <decisionTable id="DecisionTable_SLA" hitPolicy="FIRST">
      <input id="Input_tipo"><inputExpression id="InputExpression_tipo" typeRef="string"><text>tipo</text></inputExpression></input>
      <output id="Output_sla" name="slaHours" typeRef="integer" />
      <output id="Output_order" name="order" typeRef="string" />
      <rule id="Rule_contrato"><inputEntry id="UT_c"><text>"contrato"</text></inputEntry><outputEntry id="LE_c1"><text>72</text></outputEntry><outputEntry id="LE_c2"><text>"SECUENCIAL"</text></outputEntry></rule>
      <rule id="Rule_interno"><inputEntry id="UT_i"><text>"interno"</text></inputEntry><outputEntry id="LE_i1"><text>24</text></outputEntry><outputEntry id="LE_i2"><text>"PARALELO"</text></outputEntry></rule>
      <rule id="Rule_urgente"><inputEntry id="UT_u"><text>"urgente"</text></inputEntry><outputEntry id="LE_u1"><text>8</text></outputEntry><outputEntry id="LE_u2"><text>"PARALELO"</text></outputEntry></rule>
      <rule id="Rule_onb"><inputEntry id="UT_o"><text>"onboarding"</text></inputEntry><outputEntry id="LE_o1"><text>48</text></outputEntry><outputEntry id="LE_o2"><text>"SECUENCIAL"</text></outputEntry></rule>
      <rule id="Rule_default"><inputEntry id="UT_d"><text></text></inputEntry><outputEntry id="LE_d1"><text>48</text></outputEntry><outputEntry id="LE_d2"><text>"SECUENCIAL"</text></outputEntry></rule>
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_1" dmnElementRef="Decision_SLA">
        <dc:Bounds height="80" width="180" x="150" y="80" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;

export const DEFAULT_DECISION_RULES = [
  { tipo: 'contrato', slaHours: 72, order: 'SECUENCIAL' },
  { tipo: 'interno', slaHours: 24, order: 'PARALELO' },
  { tipo: 'urgente', slaHours: 8, order: 'PARALELO' },
  { tipo: 'onboarding', slaHours: 48, order: 'SECUENCIAL' },
  { tipo: '*', slaHours: 48, order: 'SECUENCIAL' },
];
