/**
 * 通用 UC 模板 · 声明式 Gate（骨架版，规则元数据随实例替换）。
 * @module instances/uc-template/gates
 */

export const gateDefs = new Map()

gateDefs.set('gate-goal', {
  rule_id: 'T-G1',
  title: '目标与约束已锁定',
  constraint: 'goal 必须产出 passed=true 且带 evidence',
  on_fail: 'FAIL',
  checks: [{ path: '$steps.goal-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-perceive', {
  rule_id: 'T-D1',
  title: '感知字段完整性',
  constraint: 'perceive 必须通过模型抽取并通过 schema',
  on_fail: 'FAIL',
  checks: [{ path: '$steps.perceive-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-decide', {
  rule_id: 'T-D2',
  title: '决策建议非空',
  constraint: 'decide 必须给出 recommendation',
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.decide-output.passed', operator: 'truthy' },
    { path: '$steps.decide-output.evidence', operator: 'non_empty' },
  ],
})

gateDefs.set('gate-execute', {
  rule_id: 'T-A1',
  title: '人审决策合法',
  constraint: 'status 必须在 approved/deferred/rejected 内，且角色与理由非空',
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.execute-output.actor_role', operator: 'non_empty' },
    { path: '$steps.execute-output.status', operator: 'in', value: ['approved', 'deferred', 'rejected'] },
    { path: '$steps.execute-output.rationale', operator: 'non_empty' },
  ],
})

gateDefs.set('gate-accept', {
  rule_id: 'T-G2',
  title: '验收校验',
  constraint: 'accept 必须通过',
  on_fail: 'FAIL',
  checks: [{ path: '$steps.accept-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-learn', {
  rule_id: 'T-L1',
  title: '学习沉淀',
  constraint: 'learn 必须通过',
  on_fail: 'FAIL',
  checks: [{ path: '$steps.learn-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-output', {
  rule_id: 'T-G3',
  title: '输出契约校验',
  constraint: '最终输出必须满足 outputSchema',
  on_fail: 'FAIL',
  checks: [
    { path: '$output.decision.status', operator: 'in', value: ['approved', 'deferred', 'rejected'] },
    { path: '$output.learning.outcome', operator: 'present' },
  ],
})
