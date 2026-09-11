/**
 * 伊利补货 UC · E2E + 对抗性反例（v0.1）。
 * 覆盖：正常补货、无需补货、缺库存数据 fail-closed、人工驳回、交期非法。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/yili-replenishment/workflow.js'
import { gateDefs } from '../instances/yili-replenishment/gates.js'
import { parse, recommend, finalize } from '../instances/yili-replenishment/functions.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = p => JSON.parse(readFileSync(join(HERE, '../instances/yili-replenishment/fixtures', p), 'utf8'))

const FUNCS = new Map([
  ['replenish:parse', parse],
  ['replenish:recommend', recommend],
  ['replenish:finalize', finalize],
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

test('正常补货：低于安全库存 → 人批准 → done', async () => {
  const r = await run('replenish-normal.json', 'human-approve.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.replenish_order.status, 'replenish')
  assert.equal(r.output.replenish_order.recommend_qty, 330) // 200+30*7-80
  assert.equal(r.output.decision.status, 'approved')
})

test('库存充足：无需补货 → done（建议量 0）', async () => {
  const r = await run('replenish-no-action.json', 'human-reject.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.replenish_order.status, 'no_action')
  assert.equal(r.output.replenish_order.recommend_qty, 0)
  assert.equal(r.output.decision.status, 'rejected')
})

test('缺库存数据：input schema fail-closed（0 步，不静默放行）', async () => {
  const r = await run('replenish-missing-stock.json')
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'INPUT_SCHEMA_INVALID')
  assert.equal(r.stepsStarted, 0)
})

test('交期非法：parse 拒绝 → FAILED', async () => {
  const r = await run('replenish-normal.json', null, { mutation: i => { i.due_date = '2026/09/18' } })
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'FAILED')
})

test('人工驳回：decision 保留 rejected，不产生补货单', async () => {
  const r = await run('replenish-normal.json', 'human-reject.json')
  assert.equal(r.status, 'done')
  assert.equal(r.output.decision.status, 'rejected')
  assert.equal(r.output.decision.replenish_qty, 330)
})
