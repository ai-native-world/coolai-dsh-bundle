/**
 * UC-RD-001 formula-candidate-reference v0.2 · 9 个测试用例移植（对齐 test-cases.yaml expect）。
 * 用 @coolai/dsh-uc-workflow 引擎跑通曹天航 v0.2 包全部用例，逐项比对。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/formula-reference/workflow.js'
import { gateDefs } from '../instances/formula-reference/gates.js'
import {
  normalizeRequirement, retrieveEvidence, generateCandidates,
  evaluateConstraints, compareCandidates, validateDecision,
} from '../instances/formula-reference/functions.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = p => JSON.parse(readFileSync(join(HERE, '../instances/formula-reference/fixtures', p), 'utf8'))

const FUNCS = new Map([
  ['formula:normalize-requirement', normalizeRequirement],
  ['formula:retrieve-evidence', retrieveEvidence],
  ['formula:generate-candidates', generateCandidates],
  ['formula:evaluate-constraints', evaluateConstraints],
  ['formula:compare-candidates', compareCandidates],
  ['formula:validate-decision', validateDecision],
])

function makeEngine() {
  return new UcWorkflowEngine({ functions: FUNCS, gates: { run: () => true, defs: gateDefs } })
}

const PKG = compile(contract, new Set(FUNCS.keys()))

/** 跑一个 fixture（含 mutation 与人工决定），返回最终 run 结果。 */
async function runCase(fixtureName, { mutation, humanInput } = {}) {
  const input = structuredClone(FIX(fixtureName))
  if (mutation) mutation(input)
  const engine = makeEngine()
  let r = await engine.execute(PKG, input)
  if (r.status === 'wait_human') {
    assert.ok(humanInput, `run 挂起等待人工决定，但未提供 humanInput`)
    r = await engine.resume(r.runId, structuredClone(FIX(humanInput)))
  }
  return r
}

test('test-requirement-happy → SUCCEEDED selected_for_trial SYN-CAND-ESP-014-v3', async () => {
  const r = await runCase('requirement-happy.synthetic.json', { humanInput: 'decision-select.synthetic.json' })
  assert.equal(r.status, 'done')
  assert.equal(r.output.decision.status, 'selected_for_trial')
  assert.equal(r.output.decision.selected_candidate_version, 'SYN-CAND-ESP-014-v3')
})

test('test-hard-block-rejected → SUCCEEDED rejected eligible=[]', async () => {
  const r = await runCase('requirement-hard-block.synthetic.json', { humanInput: 'decision-reject.synthetic.json' })
  assert.equal(r.status, 'done')
  assert.equal(r.output.decision.status, 'rejected')
  assert.deepEqual(r.output.candidate_package.eligible_candidate_versions, [])
})

test('test-missing-top-level-input → FAILED INPUT_SCHEMA_INVALID 0 步', async () => {
  const r = await runCase('requirement-happy.synthetic.json', { mutation: i => { delete i.requirement_spec } })
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'INPUT_SCHEMA_INVALID')
  assert.equal(r.stepsStarted, 0)
})

test('test-incomplete-requirement → FAILED INPUT_SCHEMA_INVALID 0 步', async () => {
  const r = await runCase('requirement-happy.synthetic.json', { mutation: i => { delete i.requirement_spec.use_scenario } })
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'INPUT_SCHEMA_INVALID')
  assert.equal(r.stepsStarted, 0)
})

test('test-unknown-constraint → FAILED INPUT_SCHEMA_INVALID 0 步（v0.2 口径：Schema 拒绝未知规则）', async () => {
  const r = await runCase('requirement-happy.synthetic.json', {
    mutation: i => { i.hard_constraints.push({ id: 'SYN-CST-UNKNOWN', rule: 'unimplemented_customer_rule' }) },
  })
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'INPUT_SCHEMA_INVALID')
  assert.equal(r.stepsStarted, 0)
})

test('test-invalid-human-selection → FAILED GATE_FAILED', async () => {
  const r = await runCase('requirement-hard-block.synthetic.json', { humanInput: 'decision-invalid-select.synthetic.json' })
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'GATE_FAILED')
})

test('test-context-mismatch-needs-design → SUCCEEDED needs_revision needs_expert_design', async () => {
  const r = await runCase('requirement-happy.synthetic.json', {
    mutation: i => { for (const e of i.historical_formula_evidence) e.applicability.use_scenarios = ['完全无关的医药注射剂场景'] },
    humanInput: 'decision-needs-revision.synthetic.json',
  })
  assert.equal(r.status, 'done')
  assert.equal(r.output.decision.status, 'needs_revision')
  assert.equal(r.output.candidate_package.generation_status, 'needs_expert_design')
  assert.deepEqual(r.output.candidate_package.candidate_versions, [])
})

test('test-spec-mismatch-needs-design → SUCCEEDED needs_revision needs_expert_design', async () => {
  const r = await runCase('requirement-happy.synthetic.json', {
    mutation: i => { i.approved_materials[0].specification_version = 'SYN-SPEC-UNMATCHED-v9' },
    humanInput: 'decision-needs-revision.synthetic.json',
  })
  assert.equal(r.status, 'done')
  assert.equal(r.output.decision.status, 'needs_revision')
  assert.equal(r.output.candidate_package.generation_status, 'needs_expert_design')
})

test('test-decision-package-is-complete → SUCCEEDED 候选详情字段齐全', async () => {
  const r = await runCase('requirement-hard-block.synthetic.json', { humanInput: 'decision-reject.synthetic.json' })
  assert.equal(r.status, 'done')
  const candidate = r.output.candidate_package.candidates[0]
  assert.ok(candidate, '决策包应有候选')
  for (const field of ['components', 'source_record_ref', 'constraint_result', 'uncertainties', 'trial_validation_requirements']) {
    assert.ok(field in candidate, `候选缺少字段 ${field}`)
  }
})
