/**
 * 伊利 UC36 保供与需求协同/预测可见性 · 确定性纯函数（v0.1，最小跑通用）。
 * 口径来自 FDE 包 UC36 + D35/R47：预测准确率门槛 ≥70%；保供KPI >95%；Agent 预警与影响测算，人做分配/承诺。
 * 字段名保留业务真实含义（预测版本/准确率/供应缺口/保供KPI/取消记录/财务影响），后续按文婷/伟豪最终版校准阈值。
 * @module instances/yili-uc36-supply-visibility/functions
 */

const pyEmpty = v =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)

const stage = (passed, result, evidence, uncertainties = []) =>
  ({ passed, result, evidence, uncertainties })

export function parse(payload) {
  const r = structuredClone(payload)
  const uncertainties = []
  if (!(payload.forecast_accuracy >= 0 && payload.forecast_accuracy <= 100)) {
    return stage(false, r, [], ['预测准确率须在 0-100 之间'])
  }
  if (!(payload.supply_kpi >= 0 && payload.supply_kpi <= 100)) {
    return stage(false, r, [], ['保供KPI须在 0-100 之间'])
  }
  return stage(true, r, [`已录入需求信号：${payload.forecast_version}`], uncertainties)
}

export function assess(payload) {
  const reasons = []
  let forecast_review_required = false
  if (payload.forecast_accuracy < 70) {
    forecast_review_required = true
    reasons.push(`预测准确率 ${payload.forecast_accuracy}% 低于 70% 门槛（R47），触发预测复盘并评估对排产/采购影响`)
  }
  if (payload.supply_gap < 0) reasons.push(`供应缺口 ${payload.supply_gap}（需求大于可用供应）`)
  if (payload.supply_kpi < 95) reasons.push(`保供KPI ${payload.supply_kpi}% 低于 95% 目标`)
  if (payload.customer_cancel) reasons.push('存在客户取消订单记录')
  const warning = {
    triggered: reasons.length > 0,
    reasons,
    forecast_review_required,
    forecast_accuracy: payload.forecast_accuracy,
    supply_gap: payload.supply_gap,
    supply_kpi: payload.supply_kpi,
    customer_cancel: payload.customer_cancel,
    financial_impact: payload.financial_impact,
    data_ref: payload.data_ref,
  }
  return stage(true, { warning }, reasons.length > 0 ? ['已生成供应预警与影响测算'] : ['无异常信号'], [])
}

export function finalize(payload) {
  const { forecast_version, warning, decision } = payload
  const errors = []
  if (warning.forecast_review_required && decision.status === 'approved') {
    // R47：低于 70% 可以批，但必须带着复盘与影响测算一起承诺，不允许当作“已达标”直接过
    if (pyEmpty(decision.rationale)) errors.push('低于准确率门槛的批准缺少复盘/影响说明')
  }
  if (warning.triggered && !['approved', 'deferred', 'rejected'].includes(decision.status)) {
    errors.push('决策状态非法')
  }
  const result = {
    decision: {
      ...decision,
      forecast_version,
      forecast_review_required: warning.forecast_review_required,
      warning,
    },
  }
  if (errors.length > 0) return stage(false, result, [], errors)
  return stage(true, result, ['保供/需求协同决策已留痕'], [])
}
