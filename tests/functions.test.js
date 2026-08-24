/**
 * 纯函数确定性测试（判据 B1）：同输入两次输出逐字节一致 + 数值正确。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateCost, simulateCapacity, decideQuote, buildQuote } from '../instances/leyin-quote/functions.js'

test('成本归集数值正确', () => {
  const r = aggregateCost({ quantity: 100, materialUnitPrice: 5.5, machiningRate: 2.2 })
  assert.equal(r.materialCost, 550)
  assert.equal(r.machiningCost, 220)
  assert.equal(r.totalCost, 770)
})

test('产能推演数值正确 + 交期可行', () => {
  const r = simulateCapacity({ quantity: 300, dueDate: '2026-09-15', today: '2026-08-24', lineCapacityDaily: 100, scheduledLoad: 500 })
  assert.equal(r.estDays, 3)
  assert.equal(r.loadAfter, 800)
  assert.equal(r.feasible, true)
})

test('产能推演交期不可行', () => {
  const r = simulateCapacity({ quantity: 300, dueDate: '2026-08-25', today: '2026-08-24', lineCapacityDaily: 100, scheduledLoad: 0 })
  assert.equal(r.feasible, false)
})

test('报价决策毛利底线判定', () => {
  const ok = decideQuote({ totalCost: 770, quantity: 100, marginTarget: 0.25, marginFloor: 0.15 })
  assert.equal(ok.marginOk, true)
  const bad = decideQuote({ totalCost: 770, quantity: 100, marginTarget: 0.10, marginFloor: 0.15 })
  assert.equal(bad.marginOk, false)
})

test('报价单确定性：同输入两次输出逐字节一致', () => {
  const a = JSON.stringify(buildQuote({ product: '冷萃咖啡液', quantity: 100, dueDate: '2026-09-15', unitPrice: 9.625 }))
  const b = JSON.stringify(buildQuote({ product: '冷萃咖啡液', quantity: 100, dueDate: '2026-09-15', unitPrice: 9.625 }))
  assert.equal(a, b)
})

test('报价单带经验引用 knowhow ID', () => {
  const r = buildQuote({ product: '冷萃咖啡液', quantity: 100, dueDate: '2026-09-15', unitPrice: 9.625 })
  assert.equal(r.doc.knowhowRef, 'knowhow-报价单-001')
  assert.ok(r.doc.quoteId.startsWith('Q-'))
})
