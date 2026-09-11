/**
 * 伊利 UC36 保供与需求协同/预测可见性 · 六步环 E2E + 对抗反例（v0.2）。
 * 六步：目标 → 感知 → 决策 → 执行(人审) → 验收(Gate) → 学习。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/yili-uc36-supply-visibility/workflow.js'
import { gateDefs } from '../instances/yili-uc36-supply-visibility/gates.js'
import { goal, perceive, decide, accept, learn } from '../instances/yili-uc36-supply-visibility/functions.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = p => JSON.parse(readFileSync(join(HERE, '../instances/yili-uc36-supply-visibility/fixtures', p), 'utf8'))

const FUNCS = new Map([
  ['uc36:goal', goal],
  ['uc36:perceive', perceive],
  ['uc36:decide', decide],
  ['uc36:accept', accept],
  ['uc36:learn', learn],
])

const makeEngine = () => new UcWorkflowEngine({ functions: FUNCS, gates: { run: () => true, defs: gateDefs } })
const PKG = compile(contract, new Set(FUNCS.keys()))

async function run(fixture, humanInput = null, { mutation } = {}) {
  const input = structuredClone(FIX(fixture))
  if (mutation) mutation(input)
  const engine = makeEngine()
  let r = await engine.execute(PKG, input)
  if (r.status === 'wait_human') {
    assert.ok(humanInput, `run 挂起等待人工确认，但未提供 humanInput`)
    r = await engine.resume(r.runId, structuredClone(FIX(humanInput)))
  }
  return r
}

test('六步走通：预警信号 → 执行人审 → 验收 Gate → 学习沉淀', async () => {
  const r = await run('warning-signal.json', 'human-approve.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.targets.forecast_accuracy, 70)
  assert.equal(r.output.warning.triggered, true)
  assert.equal(r.output.decision.status, 'approved')
  assert.deepEqual(r.output.learning.rules_applied, ['R47'])
})

test('无异常信号：不预警，学习闭环照常', async () => {
  const r = await run('healthy-signal.json', 'human-approve.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.warning.triggered, false)
  assert.equal(r.output.decision.status, 'approved')
})

test('信号缺关键字段：感知 fail-closed（Gate 拦截，不静默放行）', async () => {
  const r = await run('missing-signal.json')
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'GATE_FAILED')
})

test('预测准确率非法(>100)：感知拒绝', async () => {
  const r = await run('warning-signal.json', null, { mutation: i => { i.signal = i.signal.replace('60%', '120%') } })
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'GATE_FAILED')
})

test('低于70%门槛批准：学习记录必须引用 R47 复盘规则', async () => {
  const r = await run('warning-signal.json', 'human-approve.json')
  assert.equal(r.output.warning.forecast_review_required, true)
  assert.deepEqual(r.output.learning.rules_applied, ['R47'])
})

test('供应缺口可暂缓承诺 → done（deferred）', async () => {
  const r = await run('warning-signal.json', 'human-deferred.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.decision.status, 'deferred')
})
