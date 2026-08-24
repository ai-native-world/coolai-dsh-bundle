/** 配方开发与小样验证 SOP：跨暂停、跨引擎恢复和对抗性验收。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { MemoryRunStore, UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/formula-validation-sop/workflow.js'
import { gateDefs } from '../instances/formula-validation-sop/gates.js'
import {
  normalizeRequirement, retrieveEvidence, generateCandidates,
  evaluateConstraints, compareCandidates, validateDecision,
} from '../instances/formula-reference/functions.js'
import {
  routeTrialDecision, buildTrialPlan, validateTrialResult,
  validateReleaseDecision, finalizeFormulaRun,
} from '../instances/formula-validation-sop/functions.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = path => JSON.parse(readFileSync(join(HERE, '..', path), 'utf8'))
const FUNCS = new Map([
  ['formula:normalize-requirement', normalizeRequirement],
  ['formula:retrieve-evidence', retrieveEvidence],
  ['formula:generate-candidates', generateCandidates],
  ['formula:evaluate-constraints', evaluateConstraints],
  ['formula:compare-candidates', compareCandidates],
  ['formula:validate-decision', validateDecision],
  ['formula-sop:route-decision', routeTrialDecision],
  ['formula-sop:build-trial-plan', buildTrialPlan],
  ['formula-sop:validate-trial-result', validateTrialResult],
  ['formula-sop:validate-release-decision', validateReleaseDecision],
  ['formula-sop:finalize', finalizeFormulaRun],
])
const PKG = compile(contract, new Set(FUNCS.keys()))

function engine(store = new MemoryRunStore()) {
  const instance = new UcWorkflowEngine({ functions: new Map(FUNCS), gates: { run: () => true, defs: gateDefs }, store })
  instance.registerWorkflow(PKG)
  return instance
}

async function reachTrialInput(store = new MemoryRunStore()) {
  const first = engine(store)
  const started = await first.execute(PKG, fixture('instances/formula-reference/fixtures/requirement-happy.synthetic.json'))
  assert.equal(started.status, 'wait_human')
  const selected = await first.resume(started.runId, fixture('instances/formula-reference/fixtures/decision-select.synthetic.json'))
  assert.equal(selected.status, 'wait_input')
  assert.equal(selected.pending.stepId, 'stage-9-input')
  assert.equal(selected.runId, started.runId)
  return { store, runId: started.runId }
}

test('完整 E2E：候选→真实小样→逐项验收→签署，始终使用同一个 Run ID', async () => {
  const { store, runId } = await reachTrialInput()
  const afterRestart = engine(store)
  const measured = await afterRestart.resume(runId, fixture('instances/formula-validation-sop/fixtures/trial-pass.synthetic.json'))
  assert.equal(measured.status, 'wait_human')
  assert.equal(measured.runId, runId)
  assert.equal(measured.pending.stepId, 'stage-11-human')

  const secondRestart = engine(store)
  const done = await secondRestart.resume(runId, fixture('instances/formula-validation-sop/fixtures/release-accept.synthetic.json'))
  assert.equal(done.status, 'done')
  assert.equal(done.runId, runId)
  assert.equal(done.output.status, 'accepted_for_scale_up')
  assert.equal(done.output.verified_formula.candidate_version, 'SYN-CAND-ESP-014-v3')
  assert.ok(done.output.verified_formula.evidence_refs.includes('SYN-CUPPING-001'))
  assert.ok(done.events.filter(event => event.type === 'run_resume').length === 3)
})

test('批次或设备身份不一致：不得进入签署，终态 needs_revision', async () => {
  const { store, runId } = await reachTrialInput()
  const actual = fixture('instances/formula-validation-sop/fixtures/trial-pass.synthetic.json')
  actual.equipment_class = '另一台生产烘焙机'
  const result = await engine(store).resume(runId, actual)
  assert.equal(result.status, 'done')
  assert.equal(result.output.status, 'needs_revision')
  assert.equal(result.output.verified_formula, null)
  assert.ok(result.output.trial_report.identity_errors.some(item => item.includes('设备')))
})

test('缺少测量依据：外部输入 Schema 直接拦截', async () => {
  const { store, runId } = await reachTrialInput()
  const actual = fixture('instances/formula-validation-sop/fixtures/trial-pass.synthetic.json')
  delete actual.measurement_record_refs
  const result = await engine(store).resume(runId, actual)
  assert.equal(result.status, 'failed')
  assert.ok(result.events.some(event => event.type === 'step_schema_fail' && event.step === 'stage-9-input'))
})

test('责任人前置拒绝：不伪造试验，直接形成 rejected 终态', async () => {
  const store = new MemoryRunStore()
  const instance = engine(store)
  const started = await instance.execute(PKG, fixture('instances/formula-reference/fixtures/requirement-hard-block.synthetic.json'))
  const done = await instance.resume(started.runId, fixture('instances/formula-reference/fixtures/decision-reject.synthetic.json'))
  assert.equal(done.status, 'done')
  assert.equal(done.output.status, 'rejected')
  assert.equal(done.output.trial_plan, null)
  assert.equal(done.output.trial_report, null)
})

test('已结束 Run 不可重复恢复', async () => {
  const store = new MemoryRunStore()
  const instance = engine(store)
  const started = await instance.execute(PKG, fixture('instances/formula-reference/fixtures/requirement-hard-block.synthetic.json'))
  await instance.resume(started.runId, fixture('instances/formula-reference/fixtures/decision-reject.synthetic.json'))
  await assert.rejects(() => instance.resume(started.runId, {}), /不可恢复/)
})

test('Run 查询返回隔离副本，外部修改不能污染持久状态', async () => {
  const store = new MemoryRunStore()
  const instance = engine(store)
  const started = await instance.execute(PKG, fixture('instances/formula-reference/fixtures/requirement-hard-block.synthetic.json'))
  const snapshot = await instance.getRun(started.runId)
  snapshot.status = 'done'
  const runs = await instance.listRuns()
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'wait_human')
})
