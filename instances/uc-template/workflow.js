/**
 * 通用 UC 模板 v0.1（框架基线，不绑定任何具体客户/业务字段）。
 * 六步环：目标 → 感知 → 决策 → 执行(人审) → 验收(Gate) → 学习。
 * 业务实例 = 把 executor ref / 字段 / Gate 规则替换掉即可，骨架与审计口径不变。
 * @module instances/uc-template/workflow
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
  PASS: next => ({ PASS: next, FAIL: '$fail' }),
  SUCCESS: { PASS: '$success', FAIL: '$fail' },
}

export const contract = {
  id: 'uc-template',
  version: '0.1.0',
  input_gates: [],
  output_gates: ['gate-output'],
  inputSchema: {
    type: 'object',
    required: ['signal'],
    properties: {
      signal: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['decision', 'learning'],
    properties: {
      decision: { type: 'object' },
      learning: { type: 'object' },
    },
    additionalProperties: false,
  },
  steps: [
    {
      id: 'goal',
      name: '目标：锁定本 UC 的目标与约束',
      executor: { kind: 'function', ref: 'template:goal' },
      input: {},
      outputKey: 'goal-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-goal'],
      transitions: T.PASS('perceive'),
    },
    {
      id: 'perceive',
      name: '感知：从信号抽取结构化事实（模型）',
      executor: { kind: 'model', ref: 'template:perceive-llm' },
      input: { signal: '$input.signal' },
      outputKey: 'perceive-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-perceive'],
      transitions: T.PASS('decide'),
    },
    {
      id: 'decide',
      name: '决策：生成建议与理由（模型）',
      executor: { kind: 'model', ref: 'template:decide-llm' },
      input: { fields: '$steps.perceive-output.result.fields' },
      outputKey: 'decide-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-decide'],
      transitions: T.PASS('execute'),
    },
    {
      id: 'execute',
      name: '执行：责任人在此拍板（人审，不自动完成）',
      executor: { kind: 'human', ref: 'human://owner' },
      input: {
        recommendation: '$steps.decide-output.result.recommendation',
        allowed_statuses: ['approved', 'deferred', 'rejected'],
      },
      outputKey: 'execute-output',
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
      postGates: ['gate-execute'],
      transitions: T.PASS('accept'),
    },
    {
      id: 'accept',
      name: '验收：Gate 校验决策合法性',
      executor: { kind: 'function', ref: 'template:accept' },
      input: {
        decision: '$steps.execute-output',
        recommendation: '$steps.decide-output.result.recommendation',
      },
      outputKey: 'accept-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-accept'],
      transitions: T.PASS('learn'),
    },
    {
      id: 'learn',
      name: '学习：复盘沉淀',
      executor: { kind: 'function', ref: 'template:learn' },
      input: {
        decision: '$steps.execute-output',
        acceptance: '$steps.accept-output.result.acceptance',
      },
      outputKey: 'learn-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-learn'],
      transitions: T.SUCCESS,
    },
  ],
  outputMapping: {
    decision: '$steps.accept-output.result.decision',
    learning: '$steps.learn-output.result.learning',
  },
}
