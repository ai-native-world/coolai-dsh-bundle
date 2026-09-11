/**
 * 伊利 UC36 保供与需求协同/预测可见性 · 确定性工作流合同 v0.1（最小跑通用）。
 * 感知(需求信号) → 预警与影响测算 → 人(供应链/商务)分配与承诺 → 最终验收。
 * 门槛：预测准确率 70%（R47）、保供KPI 95%；权限语义：预警 A3、分配/承诺 A2、重大决策 A1。
 * @module instances/yili-uc36-supply-visibility/workflow
 */

const STAGE_OUTPUT = {
  type: 'object',
  required: ['passed', 'result', 'evidence', 'uncertainties'],
  properties: {
    passed: { type: 'boolean' },
    result: { type: 'object' },
    evidence: { type: 'array', minItems: 1, items: { type: 'string' } },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
}

const T = {
  PASS: (next) => ({ PASS: next, FAIL: '$fail' }),
  SUCCESS: { PASS: '$success', FAIL: '$fail' },
}

export const contract = {
  id: 'yili-uc36-supply-visibility',
  version: '0.1.0',
  input_gates: [],
  output_gates: ['gate-output'],
  inputSchema: {
    type: 'object',
    required: ['forecast_version', 'forecast_accuracy', 'supply_gap', 'supply_kpi',
               'customer_cancel', 'financial_impact', 'data_ref'],
    properties: {
      forecast_version: { type: 'string', minLength: 1 },
      forecast_accuracy: { type: 'number', minimum: 0, maximum: 100 },
      supply_gap: { type: 'number' },
      supply_kpi: { type: 'number', minimum: 0, maximum: 100 },
      customer_cancel: { type: 'boolean' },
      financial_impact: { type: 'number' },
      data_ref: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['warning', 'decision'],
    properties: {
      warning: { type: 'object' },
      decision: { type: 'object' },
    },
    additionalProperties: false,
  },
  steps: [
    {
      id: 'parse',
      name: '需求信号录入与完整性校验',
      executor: { kind: 'function', ref: 'uc36:parse' },
      input: {
        forecast_version: '$input.forecast_version',
        forecast_accuracy: '$input.forecast_accuracy',
        supply_gap: '$input.supply_gap',
        supply_kpi: '$input.supply_kpi',
        customer_cancel: '$input.customer_cancel',
        financial_impact: '$input.financial_impact',
        data_ref: '$input.data_ref',
      },
      outputKey: 'parse-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-parse'],
      transitions: T.PASS('assess'),
    },
    {
      id: 'assess',
      name: '供应预警与影响测算',
      executor: { kind: 'function', ref: 'uc36:assess' },
      input: {
        forecast_accuracy: '$input.forecast_accuracy',
        supply_gap: '$input.supply_gap',
        supply_kpi: '$input.supply_kpi',
        customer_cancel: '$input.customer_cancel',
        financial_impact: '$input.financial_impact',
        data_ref: '$input.data_ref',
      },
      outputKey: 'assess-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-assess'],
      transitions: T.PASS('decide'),
    },
    {
      id: 'decide',
      name: '供应链/商务分配与承诺确认（A2 人审）',
      executor: { kind: 'human', ref: 'human://supply-owner' },
      input: {
        warning: '$steps.assess-output.result.warning',
        allowed_statuses: ['approved', 'deferred', 'rejected'],
      },
      outputKey: 'decide-output',
      outputSchema: {
        type: 'object',
        required: ['actor_role', 'status', 'rationale'],
        properties: {
          actor_role: { type: 'string', minLength: 1 },
          status: { enum: ['approved', 'deferred', 'rejected'] },
          rationale: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      preGates: [],
      postGates: ['gate-decide'],
      transitions: T.PASS('finalize'),
    },
    {
      id: 'finalize',
      name: '保供/需求协同决策最终验收',
      executor: { kind: 'function', ref: 'uc36:finalize' },
      input: {
        forecast_version: '$input.forecast_version',
        warning: '$steps.assess-output.result.warning',
        decision: '$steps.decide-output',
      },
      outputKey: 'finalize-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-finalize'],
      transitions: T.SUCCESS,
    },
  ],
  outputMapping: {
    warning: '$steps.assess-output.result.warning',
    decision: '$steps.finalize-output.result.decision',
  },
}
