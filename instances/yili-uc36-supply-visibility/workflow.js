/**
 * 伊利 UC36 保供与需求协同/预测可见性 · 六步环工作流合同 v0.2。
 * 目标 → 感知 → 决策 → 执行 → 验收 → 学习。
 * 执行节点 = 供应链/商务人审拍板（A2）；验收节点 = Gate 校验；学习节点 = 复盘沉淀。
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
  version: '0.2.0',
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
    required: ['targets', 'warning', 'decision', 'learning'],
    properties: {
      targets: { type: 'object' },
      warning: { type: 'object' },
      decision: { type: 'object' },
      learning: { type: 'object' },
    },
    additionalProperties: false,
  },
  steps: [
    {
      id: 'goal',
      name: '目标：锁定保供目标与门槛',
      executor: { kind: 'function', ref: 'uc36:goal' },
      input: {},
      outputKey: 'goal-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-goal'],
      transitions: T.PASS('perceive'),
    },
    {
      id: 'perceive',
      name: '感知：从需求信号抽取结构化字段（模型）',
      executor: { kind: 'model', ref: 'uc36:perceive-llm' },
      input: { signal: '$input.signal' },
      outputKey: 'perceive-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-perceive'],
      transitions: T.PASS('decide'),
    },
    {
      id: 'decide',
      name: '决策：供应预警与影响测算',
      executor: { kind: 'function', ref: 'uc36:decide' },
      input: { fields: '$steps.perceive-output.result.fields' },
      outputKey: 'decide-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-decide'],
      transitions: T.PASS('execute'),
    },
    {
      id: 'execute',
      name: '执行：供应链/商务分配与承诺（A2 人审）',
      executor: { kind: 'human', ref: 'human://supply-owner' },
      input: {
        recommendation: '$steps.decide-output.result.recommendation',
        warning: '$steps.decide-output.result.warning',
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
      name: '验收：Gate 校验目标与门槛',
      executor: { kind: 'function', ref: 'uc36:accept' },
      input: {
        fields: '$steps.perceive-output.result.fields',
        targets: '$steps.goal-output.result.targets',
        warning: '$steps.decide-output.result.warning',
        decision: '$steps.execute-output',
      },
      outputKey: 'accept-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-accept'],
      transitions: T.PASS('learn'),
    },
    {
      id: 'learn',
      name: '学习：复盘与规则沉淀',
      executor: { kind: 'function', ref: 'uc36:learn' },
      input: {
        warning: '$steps.decide-output.result.warning',
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
    targets: '$steps.goal-output.result.targets',
    warning: '$steps.decide-output.result.warning',
    decision: '$steps.accept-output.result.decision',
    learning: '$steps.learn-output.result.learning',
  },
}
