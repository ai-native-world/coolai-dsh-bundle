/**
 * 伊利 UC36 保供与需求协同/预测可见性 · 六步环确定性函数（v0.2）。
 * 六步：目标 → 感知 → 决策 → 执行 → 验收 → 学习（执行=人审拍板；验收=Gate；学习=复盘沉淀）。
 * 口径：FDE UC36 + D35/R47（预测准确率门槛 70%；保供KPI 95%）。
 * @module instances/yili-uc36-supply-visibility/functions
 */

const pyEmpty = v => v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)

const stage = (passed, result, evidence, uncertainties = []) =>
  ({ passed, result, evidence, uncertainties })

export function goal() {
  return stage(true, {
    uc_id: 'UC36',
    targets: { forecast_accuracy: 70, supply_kpi: 95 },
    a_levels: { warning: 'A3', commit: 'A2', major_decision: 'A1' },
  }, ['目标与门槛已锁定：预测准确率≥70%、保供KPI>95%'])
}

/** 字段完整性/合法性校验：模型抽取结果与确定性抽取结果共用同一套 fail-closed 判据。 */
export function validateFields(fields) {
  const missing = []
  if (!(fields.forecast_accuracy >= 0 && fields.forecast_accuracy <= 100)) missing.push('预测准确率缺失或非法')
  if (!(fields.supply_kpi >= 0 && fields.supply_kpi <= 100)) missing.push('保供KPI缺失或非法')
  if (fields.forecast_version === 'unknown') missing.push('预测版本缺失')
  return missing
}

export function perceive(payload) {
  const s = String(payload.signal ?? '')
  const num = re => { const m = s.match(re); return m ? Number(m[1]) : undefined }
  const txt = re => { const m = s.match(re); return m ? m[1].trim() : undefined }
  const fields = {
    forecast_version: txt(/预测版本\s*[:：]?\s*([A-Za-z0-9\-._/]+)/) || 'unknown',
    forecast_accuracy: num(/预测准确率\s*[:：]?\s*(\d+(?:\.\d+)?)/) ?? -1,
    supply_gap: num(/供应缺口\s*[:：]?\s*(-?\d+(?:\.\d+)?)/) ?? 0,
    supply_kpi: num(/保供KPI\s*[:：]?\s*(\d+(?:\.\d+)?)/) ?? -1,
    customer_cancel: /取消订单\s*[:：]?\s*(是|有|true|存在)/i.test(s),
    financial_impact: num(/财务影响\s*[:：]?\s*(-?\d+(?:\.\d+)?)/) ?? 0,
    data_ref: txt(/数据来源\s*[:：]?\s*([^\n,，]+)/) || 'S&OP预测/2026-09-11',
  }
  const missing = validateFields(fields)
  if (missing.length > 0) return stage(false, { fields, missing }, [`感知校验未通过：${missing.join('；')}`], missing)
  return stage(true, { fields }, [`已从信号抽取：${fields.forecast_version}`])
}

/** 硬规则阈值判定（fail-closed 唯一来源）：模型可以丰富测算文案，但不能改这些触发结论。 */
export function buildWarning(fields) {
  const reasons = []
  let forecast_review_required = false
  if (fields.forecast_accuracy < 70) {
    forecast_review_required = true
    reasons.push(`预测准确率 ${fields.forecast_accuracy}% 低于 70% 门槛（R47），触发复盘与排产/采购影响测算`)
  }
  if (fields.supply_gap < 0) reasons.push(`供应缺口 ${fields.supply_gap}（需求大于可用供应）`)
  if (fields.supply_kpi < 95) reasons.push(`保供KPI ${fields.supply_kpi}% 低于 95% 目标`)
  if (fields.customer_cancel) reasons.push('存在客户取消订单记录')
  return {
    triggered: reasons.length > 0,
    reasons,
    forecast_review_required,
    forecast_accuracy: fields.forecast_accuracy,
    supply_gap: fields.supply_gap,
    supply_kpi: fields.supply_kpi,
    customer_cancel: fields.customer_cancel,
    financial_impact: fields.financial_impact,
    data_ref: fields.data_ref,
  }
}

export function decide(payload) {
  const { fields } = payload
  const warning = buildWarning(fields)
  return stage(true, { warning, recommendation: { action: warning.triggered ? '预警并测算影响' : '无需干预', escalate: warning.forecast_review_required ? 'A2' : 'A3' } },
    warning.triggered ? ['已生成供应预警与影响测算'] : ['无异常信号'])
}

export function accept(payload) {
  const { fields, targets, warning, decision } = payload
  const ok_accuracy = fields.forecast_accuracy >= targets.forecast_accuracy || warning.forecast_review_required
  const ok_kpi = fields.supply_kpi >= targets.supply_kpi || warning.triggered
  const ok_decision = ['approved', 'deferred', 'rejected'].includes(decision.status)
  const reasons = []
  if (!ok_accuracy) reasons.push('预测准确率未达标且未触发复盘')
  if (!ok_kpi) reasons.push('保供KPI未达标且未预警')
  const passed = ok_accuracy && ok_kpi && ok_decision
  const acceptance = { passed, reasons, forecast_accuracy_ok: ok_accuracy, supply_kpi_ok: ok_kpi }
  return stage(passed, { decision: { ...decision, forecast_version: fields.forecast_version, warning }, acceptance },
    passed ? ['验收通过：目标、门槛与决策合法'] : [`验收未通过：${reasons.join('；')}`], reasons)
}

export function learn(payload) {
  const { warning, decision, acceptance } = payload
  const learning = {
    rules_applied: warning.forecast_review_required ? ['R47'] : [],
    outcome: decision.status,
    accepted: acceptance.passed,
    warning_reasons: warning.reasons,
    next_action: decision.status === 'approved' ? '锁定分配与承诺' : decision.status === 'deferred' ? '商务复核' : '按驳回重新评估',
  }
  return stage(true, { learning }, ['复盘记录已沉淀（学习闭环）'])
}
