/** 一条命令跑完配方 SOP 的模拟 E2E；真实 runtime 用相同 resume 接口回填实测。 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
const functions = new Map([
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
const engine = new UcWorkflowEngine({ functions, gates: { run: () => true, defs: gateDefs } })
const pkg = compile(contract, new Set(functions.keys()))

let result = await engine.execute(pkg, read('instances/formula-reference/fixtures/requirement-happy.synthetic.json'))
result = await engine.resume(result.runId, read('instances/formula-reference/fixtures/decision-select.synthetic.json'))
result = await engine.resume(result.runId, read('instances/formula-validation-sop/fixtures/trial-pass.synthetic.json'))
result = await engine.resume(result.runId, read('instances/formula-validation-sop/fixtures/release-accept.synthetic.json'))

console.log(JSON.stringify({ runId: result.runId, status: result.status, output: result.output }, null, 2))
