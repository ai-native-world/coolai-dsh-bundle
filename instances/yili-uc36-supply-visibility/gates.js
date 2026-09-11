/**
 * 伊利 UC36 · 声明式 Gate（v0.2，六步环）。
 * @module instances/yili-uc36-supply-visibility/gates
 */

export const gateDefs = new Map()

gateDefs.set('gate-goal', {
  on_fail: 'FAIL',
  checks: [{ path: '$steps.goal-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-perceive', {
  on_fail: 'FAIL',
  checks: [{ path: '$steps.perceive-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-decide', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.decide-output.passed', operator: 'truthy' },
    { path: '$steps.decide-output.evidence', operator: 'non_empty' },
  ],
})

gateDefs.set('gate-execute', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.execute-output.actor_role', operator: 'non_empty' },
    { path: '$steps.execute-output.status', operator: 'in', value: ['approved', 'deferred', 'rejected'] },
    { path: '$steps.execute-output.rationale', operator: 'non_empty' },
  ],
})

gateDefs.set('gate-accept', {
  on_fail: 'FAIL',
  checks: [{ path: '$steps.accept-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-learn', {
  on_fail: 'FAIL',
  checks: [{ path: '$steps.learn-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-output', {
  on_fail: 'FAIL',
  checks: [
    { path: '$output.decision.status', operator: 'in', value: ['approved', 'deferred', 'rejected'] },
    { path: '$output.warning.triggered', operator: 'present' },
    { path: '$output.learning.rules_applied', operator: 'present' },
  ],
})
