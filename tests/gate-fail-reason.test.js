import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine, MemoryRunStore } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/uc-template/workflow.js'
import { gateDefs } from '../instances/uc-template/gates.js'
import { goal, accept, learn } from '../instances/uc-template/functions.js'
import { buildReceipt } from '../demo/audit.js'
import { enforceAction } from '../packages/dsh-uc-workflow/lib/loop-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const policy = JSON.parse(readFileSync(join(__dirname, '../instances/uc-template/loop.policy.json'), 'utf8'))

function makeEngine(modelFn) {
  const funcs = new Map([
    ['template:goal', goal],
    ['template:accept', accept],
    ['template:learn', learn],
  ])
  return new UcWorkflowEngine({
    functions: funcs,
    gates: { run: () => true, defs: gateDefs },
    store: new MemoryRunStore(),
    modelFn,
  })
}

const failPerceive = () => ({ passed: false, result: {}, evidence: ['感知失败'], uncertainties: ['字段缺失'] })
const failDecide = () => ({ passed: false, result: {}, evidence: ['决策失败'], uncertainties: ['方案不可执行'] })

function modelFn(fail) {
  return ({ step }) => {
    const r = step.executor?.ref
    if (r === 'template:perceive-llm') return fail === 'perceive' ? failPerceive() : { passed: true, result: { fields: { summary: '测试' } }, evidence: ['感知'], uncertainties: [] }
    if (r === 'template:decide-llm') return fail === 'decide' ? failDecide() : { passed: true, result: { recommendation: { action: '继续' } }, evidence: ['决策'], uncertainties: [] }
    throw new Error(`未注册模型: ${r}`)
  }
}

test('感知 Gate 失败 → 结构化 fail_reason=missing_field，且政策表允许 enrich_context', async () => {
  const engine = makeEngine(modelFn('perceive'))
  const pkg = compile(contract, new Set(['template:goal', 'template:accept', 'template:learn']))
  const r = await engine.execute(pkg, { signal: '任意信号' })
  assert.equal(r.status, 'failed')
  assert.equal(r.code, 'GATE_FAILED')
  assert.equal(r.failReason, 'missing_field')

  const gateEvent = r.events.find(e => e.type === 'gate' && e.gate === 'gate-perceive')
  assert.equal(gateEvent.fail_reason, 'missing_field')

  const receipt = buildReceipt(await engine.getRun(r.runId), {}, gateDefs)
  assert.equal(receipt.gates.find(g => g.id === 'gate-perceive').fail_reason, 'missing_field')

  // 政策闭环：missing_field → 允许 enrich_context（补数据再跑），而不是卡死
  const allow = policy.reason_action_map.missing_field
  assert.ok(allow.includes('enrich_context'))
})

test('决策 Gate 失败 → 结构化 fail_reason=action_not_executable，政策表允许 replan', async () => {
  const engine = makeEngine(modelFn('decide'))
  const pkg = compile(contract, new Set(['template:goal', 'template:accept', 'template:learn']))
  const r = await engine.execute(pkg, { signal: '任意信号' })
  assert.equal(r.status, 'failed')
  assert.equal(r.failReason, 'action_not_executable')

  const gateEvent = r.events.find(e => e.type === 'gate' && e.gate === 'gate-decide')
  assert.equal(gateEvent.fail_reason, 'action_not_executable')

  const allow = policy.reason_action_map.action_not_executable
  assert.ok(allow.includes('replan'))
})

test('人审输入非法 → fail_reason=unknown，政策表只能 escalate（不可自动 loop）', async () => {
  const engine = makeEngine(modelFn('none'))
  const pkg = compile(contract, new Set(['template:goal', 'template:accept', 'template:learn']))
  const r = await engine.execute(pkg, { signal: '任意信号' })
  assert.equal(r.status, 'wait_human')

  // 人审提交非法 status
  const done = await engine.resume(r.runId, { actor_role: '负责人', status: 'whatever', rationale: '乱填' })
  assert.equal(done.status, 'failed')
  assert.equal(done.failReason, 'unknown')

  // 非法 status 被 outputSchema（enum）在 Gate 之前拦下，故无 gate-execute 事件；
  // run_failed 仍必须带结构化原因，默认 unknown。
  const failEvent = done.events.find(e => e.type === 'run_failed')
  assert.equal(failEvent.fail_reason, 'unknown')

  // unknown → 只允许 escalate；Agent 不能选 enrich/replan 去自动修复人审输入
  const allowed = policy.reason_action_map.unknown
  assert.deepEqual(allowed, ['escalate'])
})

test('fail_reason 驱动的动作会被 enforceAction 正确授权或拒绝', () => {
  // missing_field + enrich_context 合法（白名单需放行源）
  const openPolicy = structuredClone(policy)
  openPolicy.permissions.enrich_context.allowed_sources = ['mes.line_params']
  const ok = enforceAction({ action: 'enrich_context', reason: 'missing_field', targets: ['mes.line_params'] }, { roundsUsed: 0, policy: openPolicy })
  assert.equal(ok.ok, true)

  // unknown + replan 非法 → 降级 escalate/permission_denied
  const bad = enforceAction({ action: 'replan', reason: 'unknown', instruction: '换方案' }, { roundsUsed: 0, policy })
  assert.equal(bad.ok, false)
  assert.equal(bad.decision.action, 'escalate')
  assert.equal(bad.decision.reason, 'permission_denied')
})
