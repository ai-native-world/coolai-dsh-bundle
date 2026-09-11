/**
 * 伊利 UC36 · 声明式 Gate（v0.1）。
 * 只声明“过没过/过不了去哪”，业务阈值（70%/95%）在 functions.js，不写进引擎。
 * @module instances/yili-uc36-supply-visibility/gates
 */

export const gateDefs = new Map()

gateDefs.set('gate-parse', {
  on_fail: 'FAIL',
  checks: [{ path: '$steps.parse-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-assess', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.assess-output.passed', operator: 'truthy' },
    { path: '$steps.assess-output.evidence', operator: 'non_empty' },
  ],
})

gateDefs.set('gate-decide', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.decide-output.actor_role', operator: 'non_empty' },
    { path: '$steps.decide-output.status', operator: 'in', value: ['approved', 'deferred', 'rejected'] },
    { path: '$steps.decide-output.rationale', operator: 'non_empty' },
  ],
})

gateDefs.set('gate-finalize', {
  on_fail: 'FAIL',
  checks: [{ path: '$steps.finalize-output.passed', operator: 'truthy' }],
})

gateDefs.set('gate-output', {
  on_fail: 'FAIL',
  checks: [
    { path: '$output.decision.status', operator: 'in', value: ['approved', 'deferred', 'rejected'] },
    { path: '$output.warning.triggered', operator: 'present' },
    { path: '$output.decision.forecast_version', operator: 'non_empty' },
  ],
})
