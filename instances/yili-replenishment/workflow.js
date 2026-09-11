/**
 * 伊利补货 UC · 确定性工作流合同 v0.1（通用骨架）。
 * 感知(录入) → 计算(建议补货量) → 人工确认(计划员) → 最终验收。
 * 业务字段通用，不绑定客户系统；真实伊利口径后续替换 inputSchema/阈值/gate 即可。
 * @module instances/yili-replenishment/workflow
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
  id: 'yili-replenishment',
  version: '0.1.0',
  input_gates: [],
  output_gates: ['gate-output'],
  inputSchema: {
    type: 'object',
    required: ['sku', 'channel', 'stock_on_hand', 'safety_stock', 'daily_demand',
               'replenish_cycle_days', 'lead_time_days', 'due_date', 'data_ref'],
    properties: {
      sku: { type: 'string', minLength: 1 },
      channel: { type: 'string', minLength: 1 },
      stock_on_hand: { type: 'number', minimum: 0 },
      safety_stock: { type: 'number', minimum: 0 },
      daily_demand: { type: 'number', exclusiveMinimum: 0 },
      replenish_cycle_days: { type: 'integer', exclusiveMinimum: 0 },
      lead_time_days: { type: 'integer', minimum: 0 },
      due_date: { type: 'string', minLength: 1 },
      data_ref: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['replenish_order', 'decision'],
    properties: {
      replenish_order: { type: 'object' },
      decision: { type: 'object' },
    },
    additionalProperties: false,
  },
  steps: [
    {
      id: 'parse',
      name: '补货需求录入与完整性校验',
      executor: { kind: 'function', ref: 'replenish:parse' },
      input: {
        sku: '$input.sku',
        channel: '$input.channel',
        stock_on_hand: '$input.stock_on_hand',
        safety_stock: '$input.safety_stock',
        daily_demand: '$input.daily_demand',
        replenish_cycle_days: '$input.replenish_cycle_days',
        lead_time_days: '$input.lead_time_days',
        due_date: '$input.due_date',
        data_ref: '$input.data_ref',
      },
      outputKey: 'parse-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-parse'],
      transitions: T.PASS('recommend'),
    },
    {
      id: 'recommend',
      name: '计算建议补货量',
      executor: { kind: 'function', ref: 'replenish:recommend' },
      input: {
        sku: '$input.sku',
        channel: '$input.channel',
        stock_on_hand: '$input.stock_on_hand',
        safety_stock: '$input.safety_stock',
        daily_demand: '$input.daily_demand',
        replenish_cycle_days: '$input.replenish_cycle_days',
        lead_time_days: '$input.lead_time_days',
        due_date: '$input.due_date',
        data_ref: '$input.data_ref',
      },
      outputKey: 'recommend-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-recommend'],
      transitions: T.PASS('approve'),
    },
    {
      id: 'approve',
      name: '计划员/补货责任人确认',
      executor: { kind: 'human', ref: 'human://replenishment-owner' },
      input: {
        recommendation: '$steps.recommend-output.result',
        allowed_statuses: ['approved', 'rejected'],
      },
      outputKey: 'approve-output',
      outputSchema: {
        type: 'object',
        required: ['actor_role', 'status', 'rationale'],
        properties: {
          actor_role: { type: 'string', minLength: 1 },
          status: { enum: ['approved', 'rejected'] },
          rationale: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      preGates: [],
      postGates: ['gate-approve'],
      transitions: T.PASS('finalize'),
    },
    {
      id: 'finalize',
      name: '补货决策最终验收',
      executor: { kind: 'function', ref: 'replenish:finalize' },
      input: {
        sku: '$input.sku',
        recommendation: '$steps.recommend-output.result',
        decision: '$steps.approve-output',
      },
      outputKey: 'finalize-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-finalize'],
      transitions: T.SUCCESS,
    },
  ],
  outputMapping: {
    replenish_order: '$steps.recommend-output.result',
    decision: '$steps.finalize-output.result.decision',
  },
}
