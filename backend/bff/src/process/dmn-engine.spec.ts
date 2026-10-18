import { describe, expect, it } from 'vitest';
import { evaluateDmn } from './dmn-engine';
import { SLA_DMN } from './defaults';

const MONTO_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="d" namespace="x">
  <decision id="Decision_Monto" name="Politica por monto">
    <decisionTable id="T" hitPolicy="FIRST">
      <input id="i1"><inputExpression id="e1" typeRef="string"><text>tipo</text></inputExpression></input>
      <input id="i2"><inputExpression id="e2" typeRef="number"><text>monto</text></inputExpression></input>
      <output id="o1" name="slaHours" typeRef="number" />
      <output id="o2" name="order" typeRef="string" />
      <output id="o3" name="method" typeRef="string" />
      <rule id="r_grande"><inputEntry id="ie1"><text>"contrato"</text></inputEntry><inputEntry id="ie2"><text>&gt;= 1000000</text></inputEntry><outputEntry id="oe1"><text>24</text></outputEntry><outputEntry id="oe2"><text>"SECUENCIAL"</text></outputEntry><outputEntry id="oe3"><text>"DIGITAL"</text></outputEntry></rule>
      <rule id="r_chico"><inputEntry id="ie3"><text>"contrato"</text></inputEntry><inputEntry id="ie4"><text>&lt; 1000000</text></inputEntry><outputEntry id="oe4"><text>72</text></outputEntry><outputEntry id="oe5"><text>"PARALELO"</text></outputEntry><outputEntry id="oe6"><text>"AUTOGRAFA"</text></outputEntry></rule>
      <rule id="r_def"><inputEntry id="ie5"><text></text></inputEntry><inputEntry id="ie6"><text></text></inputEntry><outputEntry id="oe7"><text>48</text></outputEntry><outputEntry id="oe8"><text>"SECUENCIAL"</text></outputEntry><outputEntry id="oe9"><text>"DIGITAL"</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

describe('evaluateDmn — motor DMN real (FEEL)', () => {
  it('evalúa el SLA_DMN seed por tipo', () => {
    expect(evaluateDmn(SLA_DMN, { tipo: 'contrato' })?.outputs).toMatchObject({ slaHours: 72, order: 'SECUENCIAL' });
    expect(evaluateDmn(SLA_DMN, { tipo: 'urgente' })?.outputs).toMatchObject({ slaHours: 8, order: 'PARALELO' });
    expect(evaluateDmn(SLA_DMN, { tipo: 'loquesea' })?.outputs).toMatchObject({ slaHours: 48, order: 'SECUENCIAL' });
  });

  it('evalúa condiciones FEEL con varias entradas (monto)', () => {
    const grande = evaluateDmn(MONTO_DMN, { tipo: 'contrato', monto: 2_000_000 });
    expect(grande?.outputs).toMatchObject({ slaHours: 24, order: 'SECUENCIAL', method: 'DIGITAL' });
    expect(grande?.matchedRules).toEqual(['r_grande']);

    const chico = evaluateDmn(MONTO_DMN, { tipo: 'contrato', monto: 5_000 });
    expect(chico?.outputs).toMatchObject({ slaHours: 72, order: 'PARALELO', method: 'AUTOGRAFA' });

    const otro = evaluateDmn(MONTO_DMN, { tipo: 'interno', monto: 10 });
    expect(otro?.outputs).toMatchObject({ slaHours: 48, method: 'DIGITAL' });
  });
});
