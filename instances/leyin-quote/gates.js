/**
 * 乐饮报价 UC · 声明式 Gate 定义（durable 版，供引擎 gateDefs 消费）。
 * @module instances/leyin-quote/gates
 */

export const gateDefs = new Map([
  ['gate-inquiry', {
    on_fail: 'NEEDS_INPUT',
    checks: [{ path: '$input.inquiry', operator: 'non_empty' }],
  }],
  ['gate-feasible', {
    on_fail: 'HUMAN_REQUIRED',
    checks: [{ path: '$steps.capacity.feasible', operator: 'truthy' }],
  }],
  ['gate-margin-floor', {
    on_fail: 'HUMAN_REQUIRED',
    checks: [{ path: '$steps.decision.marginOk', operator: 'truthy' }],
  }],
  ['gate-review-valid', {
    on_fail: 'FAIL',
    checks: [
      { path: '$steps.review.decision', operator: 'in', value: ['approve', 'reject'] },
      { path: '$steps.review.rationale', operator: 'non_empty' },
    ],
  }],
  ['gate-output-quote', {
    on_fail: 'FAIL',
    checks: [
      { path: '$output.quote.quoteId', operator: 'non_empty' },
      { path: '$output.quote.knowhowRef', operator: 'present' },
      { path: '$output.quote.totalPrice', operator: 'present' },
    ],
  }],
])
