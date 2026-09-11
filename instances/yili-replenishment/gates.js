/**
 * 伊利补货 UC · 声明式 Gate（v0.1）。
 * 每个 Gate 只声明“过了没有/过不了去哪”，业务阈值不写进引擎。
 * @module instances/yili-replenishment/gates
 */

export const gateDefs = new Map()

gateDefs.set('gate-parse', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.parse-output.passed', operator: 'truthy' },
  ],
})

gateDefs.set('gate-recommend', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.recommend-output.passed', operator: 'truthy' },
    { path: '$steps.recommend-output.evidence', operator: 'non_empty' },
  ],
})

gateDefs.set('gate-approve', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.approve-output.actor_role', operator: 'non_empty' },
    { path: '$steps.approve-output.status', operator: 'in', value: ['approved', 'rejected'] },
    { path: '$steps.approve-output.rationale', operator: 'non_empty' },
  ],
})

gateDefs.set('gate-finalize', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.finalize-output.passed', operator: 'truthy' },
  ],
})

gateDefs.set('gate-output', {
  on_fail: 'FAIL',
  checks: [
    { path: '$output.decision.status', operator: 'in', value: ['approved', 'rejected'] },
    { path: '$output.decision.sku', operator: 'non_empty' },
  ],
})
