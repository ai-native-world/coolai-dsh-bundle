/**
 * 通用 UC 模板 · 确定性函数（骨架版）。
 * 具体业务阈值/字段由实例替换，但 stage 结构与 fail-closed 口径保持一致。
 * @module instances/uc-template/functions
 */

const stage = (passed, result, evidence, uncertainties = []) => ({ passed, result, evidence, uncertainties })

export function goal() {
  return stage(true, {
    objectives: ['把自然语言信号转化为结构化事实', '执行节点必须由责任人拍板', '验收 Gate 不过则打回', '学习节点沉淀复盘'],
    constraints: ['所有 Gate fail-closed，缺失即失败', '人审节点不自动完成'],
  }, ['目标与约束已锁定（模板默认口径）'])
}

export function accept(payload) {
  const { decision, recommendation } = payload
  const ok_status = ['approved', 'deferred', 'rejected'].includes(decision.status)
  const passed = ok_status && !!decision.actor_role && !!decision.rationale
  const acceptance = { passed, decision_status_ok: ok_status }
  return stage(passed, { decision: { ...decision, recommendation }, acceptance },
    passed ? ['验收通过：决策合法'] : ['验收未通过：决策状态非法'],
    passed ? [] : ['decision.status 非法或字段缺失'])
}

export function learn(payload) {
  const { decision, acceptance } = payload
  const learning = {
    outcome: decision.status,
    accepted: !!acceptance?.passed,
    rules_applied: ['T-A1', 'T-G2'],
    next_action: decision.status === 'approved' ? '继续执行' : decision.status === 'deferred' ? '责任人复核' : '按驳回重新评估',
  }
  return stage(true, { learning }, ['复盘记录已沉淀（模板默认口径）'])
}
