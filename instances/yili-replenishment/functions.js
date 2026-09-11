/**
 * 伊利补货 UC · 确定性纯函数（v0.1 通用骨架）。
 * 业务字段保持通用（SKU/渠道/库存/安全库存/日均销量/补货周期/交期），不绑定具体客户系统，
 * 便于复用到其他补货/订货类 UC；真实伊利口径后续替换 inputSchema 与阈值即可。
 * @module instances/yili-replenishment/functions
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.due_date)) {
    return stage(false, r, [], ['交期日期非法（需 YYYY-MM-DD）'])
  }
  if (payload.stock_on_hand < 0) uncertainties.push('库存为负，已按异常值进入建议计算')
  return stage(true, r, [`补货需求已录入：${payload.sku}/${payload.channel}`], uncertainties)
}

export function recommend(payload) {
  const target = payload.safety_stock + payload.daily_demand * payload.replenish_cycle_days
  const gap = target - payload.stock_on_hand
  const recommend_qty = gap > 0 ? Math.ceil(gap) : 0
  const status = recommend_qty > 0 ? 'replenish' : 'no_action'
  const result = {
    sku: payload.sku,
    channel: payload.channel,
    stock_on_hand: payload.stock_on_hand,
    safety_stock: payload.safety_stock,
    target_stock: target,
    gap,
    recommend_qty,
    lead_time_days: payload.lead_time_days,
    due_date: payload.due_date,
    data_ref: payload.data_ref,
    status,
    reason: status === 'replenish'
      ? `当前库存 ${payload.stock_on_hand} 低于目标 ${target}，建议补 ${recommend_qty}`
      : `当前库存 ${payload.stock_on_hand} 已覆盖目标 ${target}，无需补货`,
  }
  return stage(true, result, ['按 安全库存 + 日均销量 × 补货周期 计算'], [])
}

export function finalize(payload) {
  const { sku, recommendation, decision } = payload
  const errors = []
  if (recommendation.status === 'replenish' && decision.status === 'approved' && recommendation.recommend_qty <= 0) {
    errors.push('补货单数量非法：建议补货但数量为 0')
  }
  if (decision.status === 'approved' && pyEmpty(decision.rationale)) {
    errors.push('批准缺少理由')
  }
  const result = {
    decision: {
      ...decision,
      sku,
      replenish_qty: recommendation.recommend_qty,
      replenish_status: recommendation.status,
    },
  }
  if (errors.length > 0) return stage(false, result, [], errors)
  return stage(true, result, ['补货决策已入单并留痕'], [])
}
