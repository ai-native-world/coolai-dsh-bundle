import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine, MemoryRunStore } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/uc-template/workflow.js'
import { gateDefs } from '../instances/uc-template/gates.js'
import { goal, accept, learn } from '../instances/uc-template/functions.js'
import { buildReceipt } from '../demo/audit.js'

function makeEngine() {
  const funcs = new Map([
    ['template:goal', goal],
    ['template:accept', accept],
    ['template:learn', learn],
  ])
  const engine = new UcWorkflowEngine({
    functions: funcs,
    gates: { run: () => true, defs: gateDefs },
    store: new MemoryRunStore(),
    modelFn: ({ step }) => {
      const ref = step.executor?.ref
      if (ref === 'template:perceive-llm') {
        return { passed: true, result: { fields: { summary: '测试信号' } }, evidence: ['感知'], uncertainties: [] }
      }
      if (ref === 'template:decide-llm') {
        return { passed: true, result: { recommendation: { action: '继续', rationale: '理由' } }, evidence: ['决策'], uncertainties: [] }
      }
      throw new Error(`未注册模型: ${ref}`)
    },
  })
  return { engine, pkg: compile(contract, new Set(funcs.keys())) }
}

test('通用 UC 模板：六步环可编译并暂停在人审节点', async () => {
  const { engine, pkg } = makeEngine()
  const r = await engine.execute(pkg, { signal: '任意信号' })
  assert.equal(r.status, 'wait_human')
  assert.equal(r.pending.stepId, 'execute')
})

test('通用 UC 模板：人审拍板后走完验收与学习，审计回执由引擎账本投影', async () => {
  const { engine, pkg } = makeEngine()
  const r = await engine.execute(pkg, { signal: '任意信号' })
  const done = await engine.resume(r.runId, { actor_role: '负责人', status: 'approved', rationale: '跑通框架' })
  assert.equal(done.status, 'done')
  assert.equal(done.output.decision.status, 'approved')
  assert.equal(done.output.learning.outcome, 'approved')

  const full = await engine.getRun(r.runId)
  const receipt = buildReceipt(full, { channel: 'test', actor: '负责人' }, gateDefs)
  assert.equal(receipt.engine.workflow, 'uc-template@0.1.0')
  assert.equal(receipt.gates.filter(g => g.id === 'gate-output')[0].rule_id, 'T-G3')
  assert.ok(receipt.event_trail.some(e => e.type === 'run_start'))
  assert.ok(receipt.event_trail.some(e => e.type === 'run_done'))
})
