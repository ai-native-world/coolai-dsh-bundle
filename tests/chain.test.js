/**
 * 乐饮报价五步链路测试（durable 引擎版）：
 * happy path 确定性、Gate 拦截转人拍板、approve/reject 分支、驳回即新 Run、跨引擎实例恢复、model 失败路径。
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

/** 确定性 mock 模型：同 inquiry 同输出；可注入字段删除/覆盖制造破坏。 */
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

function makeEngine(store = new MemoryRunStore(), modelFn = mockModel()) {
  const engine = new UcWorkflowEngine({ functions: new Map(FUNCS), gates: { run: () => true, defs: gateDefs }, modelFn, store })
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

test('happy path：五步跑完，报价单确定且带经验引用', async () => {
  const r = await makeEngine().execute(PKG, BASE_INPUT)
  assert.equal(r.status, 'done')
  assert.equal(r.output.quote.knowhowRef, 'knowhow-报价单-001')
  assert.equal(r.output.quote.product, '冷萃咖啡液')
  assert.equal(r.output.quote.totalPrice, 962.5)
  assert.ok(r.events.some(e => e.type === 'run_start'))
  assert.ok(r.events.some(e => e.type === 'run_done'))
  assert.equal(r.events.filter(e => e.type === 'step_end').length, 5)
})

test('B1 确定性：同输入两次运行输出逐字节一致', async () => {
  const engine = makeEngine()
  const a = await engine.execute(PKG, BASE_INPUT)
  const b = await engine.execute(PKG, BASE_INPUT)
  assert.equal(JSON.stringify(a.output), JSON.stringify(b.output))
})

test('人拍板：毛利低于底线 → Gate 拦截 → review 挂起', async () => {
  const r = await makeEngine().execute(PKG, { ...BASE_INPUT, marginTarget: 0.10, marginFloor: 0.15 })
  assert.equal(r.status, 'wait_human')
  assert.equal(r.pending.stepId, 'review')
  const gateEvent = r.events.find(e => e.type === 'gate' && e.gate === 'gate-margin-floor')
  assert.ok(gateEvent)
  assert.equal(gateEvent.pass, false)
})

test('approve 分支：人批准低毛利订单 → 继续产出报价单', async () => {
  const store = new MemoryRunStore()
  const engine = makeEngine(store)
  const started = await engine.execute(PKG, { ...BASE_INPUT, marginTarget: 0.10, marginFloor: 0.15 })
  assert.equal(started.status, 'wait_human')
  const done = await engine.resume(started.runId, { decision: 'approve', rationale: '客户确认低毛利订单，特批放行' })
  assert.equal(done.status, 'done')
  assert.equal(done.output.quote.knowhowRef, 'knowhow-报价单-001')
})

test('reject 分支：人驳回 → failed（驳回即新 Run，不覆盖原 Run）', async () => {
  const store = new MemoryRunStore()
  const engine = makeEngine(store)
  const started = await engine.execute(PKG, { ...BASE_INPUT, marginTarget: 0.10, marginFloor: 0.15 })
  const rejected = await engine.resume(started.runId, { decision: 'reject', rationale: '毛利低于公司底线，驳回' })
  assert.equal(rejected.status, 'failed')
  // 原 Run 终态保持 failed，不覆盖
  const runRecord = await store.load(started.runId)
  assert.equal(runRecord.status, 'failed')
  // 重报 = 新 Run，可正常完成
  const retry = await engine.execute(PKG, { ...BASE_INPUT, marginTarget: 0.25 })
  assert.equal(retry.status, 'done')
  assert.notEqual(retry.runId, started.runId)
})

test('durable：跨引擎实例恢复（模拟进程重启，同 store）', async () => {
  const store = new MemoryRunStore()
  const first = makeEngine(store)
  const started = await first.execute(PKG, { ...BASE_INPUT, marginTarget: 0.10, marginFloor: 0.15 })
  assert.equal(started.status, 'wait_human')
  // 模拟重启：新引擎实例，同 store，注册同 workflow 后 resume
  const second = makeEngine(store)
  const done = await second.resume(started.runId, { decision: 'approve', rationale: '重启后恢复批准' })
  assert.equal(done.status, 'done')
  assert.equal(done.output.quote.totalPrice, 847) // 770×1.10（marginTarget 0.10）
})

test('B2 model 输出违反 schema → failed，不静默放行', async () => {
  const engine = makeEngine(new MemoryRunStore(), mockModel(out => { delete out.color }))
  const r = await engine.execute(PKG, BASE_INPUT)
  assert.equal(r.status, 'failed')
  assert.ok(r.events.some(e => e.type === 'step_schema_fail'))
})

test('交期不可行：feasible=false → gate-feasible 拦截 → review 挂起', async () => {
  const r = await makeEngine().execute(PKG, { ...BASE_INPUT, inquiry: JSON.stringify({ product: '冷萃咖啡液', quantity: 300, dueDate: '2026-08-25' }) })
  assert.equal(r.status, 'wait_human')
  assert.equal(r.pending.stepId, 'review')
  const gateEvent = r.events.find(e => e.type === 'gate' && e.gate === 'gate-feasible')
  assert.ok(gateEvent)
  assert.equal(gateEvent.pass, false)
})
