/**
 * 伊利 UC36 保供与需求协同/预测可见性 · E2E + 对抗性反例（v0.1）。
 * 覆盖：正常预警+人批、无异常信号、缺字段 fail-closed、预测准确率非法、低于70%门槛审批留痕、暂缓承诺。
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
import { parse, assess, finalize } from '../instances/yili-uc36-supply-visibility/functions.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = p => JSON.parse(readFileSync(join(HERE, '../instances/yili-uc36-supply-visibility/fixtures', p), 'utf8'))

const FUNCS = new Map([
  ['uc36:parse', parse],
  ['uc36:assess', assess],
  ['uc36:finalize', finalize],
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

test('供应异常：预警 + 人批准 → done，warning 触发，低于70%门槛带复盘', async () => {
  const r = await run('warning.json', 'human-approve.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.warning.triggered, true)
  assert.equal(r.output.warning.forecast_review_required, true)
  assert.equal(r.output.decision.status, 'approved')
  assert.equal(r.output.decision.forecast_version, 'F2026-09-W37')
})

test('无异常信号：不预警 → done（warning.triggered=false）', async () => {
  const r = await run('healthy.json', 'human-approve.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.warning.triggered, false)
})

test('缺预测准确率：input schema fail-closed（0 步）', async () => {
  const r = await run('missing-accuracy.json')
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'INPUT_SCHEMA_INVALID')
  assert.equal(r.stepsStarted, 0)
})

test('预测准确率非法(>100)：parse 拒绝 → FAILED', async () => {
  const r = await run('warning.json', null, { mutation: i => { i.forecast_accuracy = 120 } })
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'FAILED')
})

test('低于70%门槛也可批准，但必须留复盘/影响说明（R47）', async () => {
  const r = await run('warning.json', 'human-approve.json')
  assert.equal(r.output.decision.forecast_review_required, true)
  assert.ok(r.output.decision.rationale.length > 0)
})

test('供应缺口可暂缓承诺 → done（deferred）', async () => {
  const r = await run('warning.json', 'human-deferred.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.decision.status, 'deferred')
})
