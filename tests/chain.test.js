/**
 * 五步链路端到端测试（判据 B1/B2/C1）：happy path 确定性、人拍板分支、model 失败路径、事件流完整。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/leyin-quote/workflow.js'
import { aggregateCost, simulateCapacity, decideQuote, buildQuote } from '../instances/leyin-quote/functions.js'
import { gates } from '../instances/leyin-quote/gates.js'

const FUNCS = new Map([
  ['leyin:cost', aggregateCost],
  ['leyin:capacity', simulateCapacity],
  ['leyin:decision', decideQuote],
  ['leyin:quote', buildQuote],
])

/** 确定性 mock 模型：同 inquiry 同输出（POC 阶段模拟 E0 解析）。 */
function mockModel({ input, schema }) {
  // 从 inquiry JSON 解析（模拟数据：inquiry 里带结构化提示）
  const parsed = JSON.parse(input.inquiry)
  return {
    product: parsed.product ?? '冷萃咖啡液',
    quantity: parsed.quantity ?? 100,
    color: parsed.color ?? '原味',
    coating: parsed.coating ?? '无',
    bean: parsed.bean ?? '埃塞俄比亚耶加雪菲',
    dueDate: parsed.dueDate ?? '2026-09-15',
  }
}

function makeEngine(modelFn = mockModel) {
  return new UcWorkflowEngine({
    functions: FUNCS,
    gates: { run: (id, ctx) => (gates[id] ?? (() => true))(ctx) },
    modelFn,
  })
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

test('happy path：五步跑完，报价单确定且带经验引用', async () => {
  const engine = makeEngine()
  const pkg = compile(contract, new Set(FUNCS.keys()))
  const r = await engine.execute(pkg, BASE_INPUT)
  assert.equal(r.status, 'done')
  assert.equal(r.output.quote.knowhowRef, 'knowhow-报价单-001')
  assert.equal(r.output.quote.product, '冷萃咖啡液')
  assert.equal(r.output.quote.totalPrice, 962.5)
  // 事件流完整：run_start + 5×(step_start/step_end) + run_done
  assert.ok(r.events.some(e => e.type === 'run_start'))
  assert.ok(r.events.some(e => e.type === 'run_done'))
  assert.equal(r.events.filter(e => e.type === 'step_end').length, 5)
})

test('B1 确定性：同输入两次运行输出逐字节一致', async () => {
  const engine = makeEngine()
  const pkg = compile(contract, new Set(FUNCS.keys()))
  const a = await engine.execute(pkg, BASE_INPUT)
  const b = await engine.execute(pkg, BASE_INPUT)
  assert.equal(JSON.stringify(a.output), JSON.stringify(b.output))
})

test('人拍板：毛利低于底线 → wait_human 挂起', async () => {
  const engine = makeEngine()
  const pkg = compile(contract, new Set(FUNCS.keys()))
  const input = { ...BASE_INPUT, marginTarget: 0.10, marginFloor: 0.15 }
  const r = await engine.execute(pkg, input)
  assert.equal(r.status, 'wait_human')
  assert.equal(r.pending.stepId, 'decision')
  assert.ok(r.events.some(e => e.type === 'run_pending' && e.kind === 'human'))
})

test('B2 model 输出违反 schema → failed，不静默放行', async () => {
  const badModel = () => ({ product: '冷萃咖啡液' }) // 缺必填字段
  const engine = makeEngine(badModel)
  const pkg = compile(contract, new Set(FUNCS.keys()))
  const r = await engine.execute(pkg, BASE_INPUT)
  assert.equal(r.status, 'failed')
  assert.ok(r.events.some(e => e.type === 'step_schema_fail'))
})

test('Gate 拦截：decision 后置闸挂起事件带 gate 记录', async () => {
  const engine = makeEngine()
  const pkg = compile(contract, new Set(FUNCS.keys()))
  const input = { ...BASE_INPUT, marginTarget: 0.10, marginFloor: 0.15 }
  const r = await engine.execute(pkg, input)
  const gateEvent = r.events.find(e => e.type === 'gate' && e.gate === 'gate-margin-floor')
  assert.ok(gateEvent)
  assert.equal(gateEvent.pass, false)
})
