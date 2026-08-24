/**
 * D5 · 乐饮报价 10 坑破坏测试（立项书硬验收第 4 条：Gate 真实拦截，10 坑 ≥9 检出）。
 * 每个坑断言 run 不进入 done（被拦），并记录拦截机制；最后汇总断言 ≥9。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { MemoryRunStore, UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/leyin-quote/workflow.js'
import { gateDefs } from '../instances/leyin-quote/gates.js'
import { aggregateCost, simulateCapacity, decideQuote, buildQuote } from '../instances/leyin-quote/functions.js'

const FUNCS = new Map([
  ['leyin:cost', aggregateCost],
  ['leyin:capacity', simulateCapacity],
  ['leyin:decision', decideQuote],
  ['leyin:quote', buildQuote],
])
const PKG = compile(contract, new Set(FUNCS.keys()))

function mockModel(mutate) {
  return ({ input }) => {
    const parsed = JSON.parse(input.inquiry)
    const out = {
      product: parsed.product ?? '冷萃咖啡液',
      quantity: parsed.quantity ?? 100,
      color: parsed.color ?? '原味',
      coating: parsed.coating ?? '无',
      bean: parsed.bean ?? '埃塞俄比亚耶加雪菲',
      dueDate: parsed.dueDate ?? '2026-09-15',
    }
    if (mutate) mutate(out)
    return out
  }
}

function makeEngine(modelFn = mockModel()) {
  const engine = new UcWorkflowEngine({ functions: new Map(FUNCS), gates: { run: () => true, defs: gateDefs }, modelFn, store: new MemoryRunStore() })
  engine.registerWorkflow(PKG)
  return engine
}

const BASE_INPUT = {
  inquiry: JSON.stringify({ product: '冷萃咖啡液', quantity: 100, dueDate: '2026-09-15' }),
  today: '2026-08-24',
  materialUnitPrice: 5.5,
  machiningRate: 2.2,
  marginTarget: 0.25,
  marginFloor: 0.15,
  lineCapacityDaily: 100,
  scheduledLoad: 500,
}

const intercepts = []
function record(name, r) {
  const mechanism = r.code ?? (r.status === 'wait_human' ? `挂起@${r.pending?.stepId}` : r.status)
  intercepts.push({ name, mechanism })
  assert.notEqual(r.status, 'done', `${name} 未被拦截（run 已 done）`)
  return r
}

test('坑1 缺颜色要求 → model 输出 schema 失败', async () => {
  const r = await makeEngine(mockModel(o => { delete o.color })).execute(PKG, BASE_INPUT)
  record('坑1-缺颜色', r)
})

test('坑2 缺镀膜工艺 → model 输出 schema 失败', async () => {
  const r = await makeEngine(mockModel(o => { delete o.coating })).execute(PKG, BASE_INPUT)
  record('坑2-缺镀膜', r)
})

test('坑3 缺豆种风味 → model 输出 schema 失败', async () => {
  const r = await makeEngine(mockModel(o => { delete o.bean })).execute(PKG, BASE_INPUT)
  record('坑3-缺豆种', r)
})

test('坑4 缺交期 → model 输出 schema 失败', async () => {
  const r = await makeEngine(mockModel(o => { delete o.dueDate })).execute(PKG, BASE_INPUT)
  record('坑4-缺交期', r)
})

test('坑5 超毛利底线 → gate-margin-floor 拦截 → 人拍板挂起（不自动放行）', async () => {
  const r = await makeEngine().execute(PKG, { ...BASE_INPUT, marginTarget: 0.10, marginFloor: 0.15 })
  assert.equal(r.status, 'wait_human')
  assert.equal(r.pending.stepId, 'review')
  record('坑5-超毛利底线', r)
})

test('坑6 缺物料单价 → INPUT_SCHEMA_INVALID 0 步', async () => {
  const input = structuredClone(BASE_INPUT)
  delete input.materialUnitPrice
  const r = await makeEngine().execute(PKG, input)
  assert.equal(r.code, 'INPUT_SCHEMA_INVALID')
  assert.equal(r.stepsStarted, 0)
  record('坑6-缺物料单价', r)
})

test('坑7 数量非法(0) → parse 输出 schema 拒绝', async () => {
  const r = await makeEngine(mockModel(o => { o.quantity = 0 })).execute(PKG, BASE_INPUT)
  assert.equal(r.status, 'failed')
  record('坑7-数量为0', r)
})

test('坑8 交期不可行 → gate-feasible 拦截 → 人拍板挂起', async () => {
  const input = { ...BASE_INPUT, inquiry: JSON.stringify({ product: '冷萃咖啡液', quantity: 300, dueDate: '2026-08-25' }) }
  const r = await makeEngine().execute(PKG, input)
  assert.equal(r.status, 'wait_human')
  assert.equal(r.pending.stepId, 'review')
  record('坑8-交期不可行', r)
})

test('坑9 缺产能数据 → INPUT_SCHEMA_INVALID 0 步', async () => {
  const input = structuredClone(BASE_INPUT)
  delete input.lineCapacityDaily
  const r = await makeEngine().execute(PKG, input)
  assert.equal(r.code, 'INPUT_SCHEMA_INVALID')
  assert.equal(r.stepsStarted, 0)
  record('坑9-缺产能数据', r)
})

test('坑10 日期非法 → capacity 不可判 → gate-feasible 拦截 → 人拍板挂起', async () => {
  const r = await makeEngine().execute(PKG, { ...BASE_INPUT, today: 'not-a-date' })
  assert.equal(r.status, 'wait_human')
  assert.equal(r.pending.stepId, 'review')
  record('坑10-日期非法', r)
})

test('汇总：10 坑全部被拦（≥9 检出硬线）', () => {
  console.log('拦截清单:', intercepts.map(i => `${i.name}=${i.mechanism}`).join(' | '))
  assert.ok(intercepts.length >= 9, `检出 ${intercepts.length} < 9`)
  assert.equal(intercepts.length, 10)
})
