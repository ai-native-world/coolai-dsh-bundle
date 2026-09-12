/**
 * Agent Loop 确定性约束（笼子）。
 *
 * 目标：Agent 的「自由输出」只允许在封闭动作空间内活动，且每个动作
 * 落地前必须通过三道闸：① schema 校验 ② 政策授权 ③ 硬预算。
 * 任何一道不过 → 返回 fail-closed 决策（escalate / stop），绝不静默放行。
 *
 * 这属于「确定性约束机制」，不是业务逻辑：动作空间、政策表、预算都是资产；
 * 本模块只负责把资产变成可执行的判定，口径与引擎 fail-closed 一致。
 *
 * @module @coolai/dsh-uc-workflow/loop-policy
 */

export const ACTIONS = Object.freeze(['enrich_context', 'replan', 'escalate', 'stop'])

export const REASONS = Object.freeze([
  'missing_field',
  'action_not_executable',
  'constraint_conflict',
  'data_unavailable',
  'permission_denied',
  'max_rounds_exceeded',
  'unknown',
])

export const DEFAULT_POLICY = Object.freeze({
  schema: 'orgos.agent.loop.policy.v1',
  max_rounds: 3,
  reason_action_map: {
    missing_field: ['enrich_context', 'escalate'],
    action_not_executable: ['replan', 'escalate'],
    constraint_conflict: ['escalate'],
    data_unavailable: ['escalate'],
    permission_denied: ['escalate'],
    max_rounds_exceeded: ['stop'],
    unknown: ['escalate'],
  },
  permissions: {
    enrich_context: { allowed_sources: [], max_sources_per_action: 5 },
    replan: { max_instruction_chars: 2000 },
    escalate: { allowed_recipients: ['human://owner'] },
    stop: {},
  },
  budget: { per_run_timeout_ms: 60000, backoff_ms: [1000, 5000, 15000] },
})

/**
 * 闸 ①：封闭动作空间校验。Agent 输出必须是四动作之一，且字段类型/必填/上限达标。
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateAction(action) {
  const errors = []
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return { ok: false, errors: ['action 必须是对象'] }
  }
  if (!ACTIONS.includes(action.action)) errors.push(`action 非法: ${String(action.action)}`)
  if (!REASONS.includes(action.reason)) errors.push(`reason 非法: ${String(action.reason)}`)

  if (action.loop_id !== undefined && (typeof action.loop_id !== 'string' || !action.loop_id.trim())) {
    errors.push('loop_id 必须是非空字符串')
  }

  if (action.action === 'enrich_context') {
    if (!Array.isArray(action.targets) || action.targets.length === 0) errors.push('enrich_context 必须带非空 targets')
    else if (action.targets.some(t => typeof t !== 'string' || !t.trim())) errors.push('targets 必须是非空字符串数组')
  }
  if (action.action === 'replan') {
    if (typeof action.instruction !== 'string' || !action.instruction.trim()) errors.push('replan 必须带非空 instruction')
  }
  if (action.action === 'escalate') {
    if (typeof action.detail !== 'string' || !action.detail.trim()) errors.push('escalate 必须带非空 detail')
  }
  if (action.action === 'stop' && action.reason !== 'max_rounds_exceeded') {
    errors.push('stop 只允许 reason=max_rounds_exceeded')
  }

  return { ok: errors.length === 0, errors }
}

/**
 * 闸 ②：政策授权。reason→action 政策表 + 每动作最小权限白名单。
 * @returns {{ok: boolean, error?: string}}
 */
export function authorizeAction(action, policy = DEFAULT_POLICY) {
  const allowed = (policy.reason_action_map && policy.reason_action_map[action.reason]) || []
  if (!allowed.includes(action.action)) {
    return { ok: false, error: `reason=${action.reason} 不允许 action=${action.action}；允许: [${allowed.join(', ')}]` }
  }

  const perm = (policy.permissions && policy.permissions[action.action]) || {}
  if (action.action === 'enrich_context') {
    const allowedSources = perm.allowed_sources || []
    const cap = perm.max_sources_per_action ?? 0
    if (action.targets.length > cap) return { ok: false, error: `targets 数量 ${action.targets.length} 超过上限 ${cap}` }
    for (const t of action.targets) {
      if (!allowedSources.includes(t)) return { ok: false, error: `数据源未授权: ${t}` }
    }
  }
  if (action.action === 'replan' && perm.max_instruction_chars != null) {
    if (action.instruction.length > perm.max_instruction_chars) {
      return { ok: false, error: `instruction 长度 ${action.instruction.length} 超过上限 ${perm.max_instruction_chars}` }
    }
  }
  if (action.action === 'escalate' && perm.allowed_recipients && !perm.allowed_recipients.includes('human://owner')) {
    return { ok: false, error: 'escalate 接收人未授权' }
  }
  return { ok: true }
}

/**
 * 闸 ③：硬预算。轮数达到上限即终止，不允许无限 loop。
 */
export function checkBudget(roundsUsed, policy = DEFAULT_POLICY) {
  if (roundsUsed >= (policy.max_rounds ?? 0)) {
    return { ok: false, error: `已达 max_rounds=${policy.max_rounds}，必须终止`, terminal: 'stop' }
  }
  return { ok: true }
}

/**
 * 总闸：schema → 授权 → 预算。任一失败即 fail-closed 降级（越权/非法→升级人，超轮→停止）。
 * @returns {{ok: boolean, decision: object, errors: string[]}}
 */
export function enforceAction(action, { roundsUsed = 0, policy = DEFAULT_POLICY } = {}) {
  const v = validateAction(action)
  if (!v.ok) {
    return {
      ok: false,
      decision: { action: 'escalate', reason: 'unknown', detail: `动作非法: ${v.errors.join('; ')}` },
      errors: v.errors,
    }
  }

  const a = authorizeAction(action, policy)
  if (!a.ok) {
    return {
      ok: false,
      decision: { action: 'escalate', reason: 'permission_denied', detail: a.error },
      errors: [a.error],
    }
  }

  const b = checkBudget(roundsUsed, policy)
  if (!b.ok) {
    return {
      ok: false,
      decision: { action: 'stop', reason: 'max_rounds_exceeded', detail: b.error },
      errors: [b.error],
    }
  }

  return { ok: true, decision: action, errors: [] }
}
