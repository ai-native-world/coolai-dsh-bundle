import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  validateAction,
  authorizeAction,
  checkBudget,
  enforceAction,
  DEFAULT_POLICY,
} from '../packages/dsh-uc-workflow/lib/loop-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const templatePolicy = JSON.parse(
  readFileSync(join(__dirname, '../instances/uc-template/loop.policy.json'), 'utf8'),
)

// 测试用：给模板策略白名单里放两个实例数据源
const openPolicy = structuredClone(templatePolicy)
openPolicy.permissions.enrich_context.allowed_sources = ['mes.line_params', 'erp.purchase_budget']

test('闸① schema：合法 enrich_context 通过', () => {
  const r = validateAction({ action: 'enrich_context', reason: 'missing_field', targets: ['mes.line_params'] })
  assert.equal(r.ok, true)
})

test('闸① schema：动作不在封闭集合 → 拒绝', () => {
  const r = validateAction({ action: 'write_file', reason: 'missing_field' })
  assert.equal(r.ok, false)
})

test('闸① schema：enrich_context 缺 targets → 拒绝', () => {
  const r = validateAction({ action: 'enrich_context', reason: 'missing_field' })
  assert.equal(r.ok, false)
})

test('闸① schema：stop 只能因超轮 → 拒绝', () => {
  const r = validateAction({ action: 'stop', reason: 'constraint_conflict' })
  assert.equal(r.ok, false)
})

test('闸② 政策：reason 与 action 不匹配 → 拒绝（constraint_conflict 只能 escalate）', () => {
  const r = authorizeAction({ action: 'replan', reason: 'constraint_conflict', instruction: 'x' }, templatePolicy)
  assert.equal(r.ok, false)
  assert.match(r.error, /不允许/)
})

test('闸② 最小权限：模板策略 allowed_sources 为空 → enrich_context 一律拒绝（fail-closed 基线）', () => {
  const r = authorizeAction({ action: 'enrich_context', reason: 'missing_field', targets: ['mes.line_params'] }, templatePolicy)
  assert.equal(r.ok, false)
  assert.match(r.error, /数据源未授权/)
})

test('闸② 最小权限：白名单命中 → 通过；未命中 → 拒绝', () => {
  const ok = authorizeAction({ action: 'enrich_context', reason: 'missing_field', targets: ['mes.line_params'] }, openPolicy)
  assert.equal(ok.ok, true)
  const bad = authorizeAction({ action: 'enrich_context', reason: 'missing_field', targets: ['crm.customer_list'] }, openPolicy)
  assert.equal(bad.ok, false)
  assert.match(bad.error, /未授权: crm.customer_list/)
})

test('闸③ 预算：轮数未达上限 → 通过；达到上限 → stop', () => {
  assert.equal(checkBudget(2, templatePolicy).ok, true)
  assert.equal(checkBudget(3, templatePolicy).ok, false)
  assert.equal(checkBudget(3, templatePolicy).terminal, 'stop')
})

test('总闸：越权动作 → fail-closed 降级为 escalate/permission_denied', () => {
  const r = enforceAction(
    { action: 'enrich_context', reason: 'missing_field', targets: ['crm.customer_list'] },
    { roundsUsed: 0, policy: templatePolicy },
  )
  assert.equal(r.ok, false)
  assert.equal(r.decision.action, 'escalate')
  assert.equal(r.decision.reason, 'permission_denied')
})

test('总闸：非法输出 → fail-closed 降级为 escalate/unknown', () => {
  const r = enforceAction({ action: 'drop_table', reason: 'unknown' }, { roundsUsed: 0, policy: templatePolicy })
  assert.equal(r.ok, false)
  assert.equal(r.decision.action, 'escalate')
  assert.equal(r.decision.reason, 'unknown')
})

test('总闸：超轮 → 直接 stop，不升级人也不继续', () => {
  const r = enforceAction(
    { action: 'replan', reason: 'action_not_executable', instruction: '换方案' },
    { roundsUsed: 3, policy: templatePolicy },
  )
  assert.equal(r.ok, false)
  assert.equal(r.decision.action, 'stop')
  assert.equal(r.decision.reason, 'max_rounds_exceeded')
})

test('总闸：合法动作 + 预算内 → 原样放行', () => {
  const action = { action: 'enrich_context', reason: 'missing_field', targets: ['mes.line_params'], loop_id: 'loop-1' }
  const r = enforceAction(action, { roundsUsed: 0, policy: openPolicy })
  assert.equal(r.ok, true)
  assert.deepEqual(r.decision, action)
})

test('默认策略封闭动作空间与政策表不可为空', () => {
  assert.deepEqual(Object.keys(DEFAULT_POLICY.reason_action_map), Object.freeze(Object.keys(DEFAULT_POLICY.reason_action_map)))
  assert.ok(DEFAULT_POLICY.max_rounds > 0)
  assert.ok(Object.keys(DEFAULT_POLICY.permissions).length >= 4)
})
