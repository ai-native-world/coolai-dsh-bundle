/** 配方开发与小样验证 SOP 的确定性函数。 */

function stage(passed, result, evidence, uncertainties = []) {
  return { passed, result, evidence, uncertainties }
}

function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

export function routeTrialDecision({ decision }) {
  return {
    status: decision.status,
    decision: structuredClone(decision),
  }
}

export function buildTrialPlan({ requirement_contract: requirement, candidate_package: pkg, decision }) {
  const candidate = (pkg.candidates ?? []).find(item => item.candidate_version === decision.selected_candidate_version)
  if (!candidate) return stage(false, {}, [], ['已选候选不存在，不能生成试验计划'])
  const materialBatches = (candidate.components ?? []).map(item => ({ material_id: item.material_id, batch_id: item.batch_id }))
  const acceptanceChecks = Object.entries(requirement.target_sensory ?? {}).map(([metric, target]) => ({ metric, target }))
  const plan = {
    trial_id: `TRIAL-${candidate.candidate_version}`,
    candidate_version: candidate.candidate_version,
    requirement_version: requirement.requirement_version,
    equipment_class: requirement.trial_equipment_class,
    trial_quantity_kg: requirement.trial_quantity_kg,
    material_batches: materialBatches,
    acceptance_checks: acceptanceChecks,
    required_record_refs: ['process_record_ref', 'measurement_record_refs'],
  }
  return stage(true, { plan, candidate: structuredClone(candidate) }, [requirement.source_record_ref, ...candidate.current_fact_refs.map(item => item.inventory_record_ref)], ['农产品批次波动只能由本次小样实测关闭'])
}

function compareTarget(actual, target) {
  if (target !== null && typeof target === 'object' && !Array.isArray(target) && 'target' in target) {
    const tolerance = Number(target.tolerance ?? 0)
    return typeof actual === 'number' && Math.abs(actual - Number(target.target)) <= tolerance
  }
  if (Array.isArray(target)) return Array.isArray(actual) && target.every(item => actual.includes(item))
  return sameJson(actual, target)
}

export function validateTrialResult({ plan, trial_result: actual }) {
  const identityErrors = []
  if (actual.trial_id !== plan.trial_id) identityErrors.push('trial_id 与试验计划不一致')
  if (actual.candidate_version !== plan.candidate_version) identityErrors.push('candidate_version 与试验计划不一致')
  if (actual.equipment_class !== plan.equipment_class) identityErrors.push('试验设备类别与计划不一致')
  if (!sameJson(actual.material_batches, plan.material_batches)) identityErrors.push('实际物料批次与试验计划不一致')

  const checks = plan.acceptance_checks.map(({ metric, target }) => {
    const observed = actual.actual_sensory[metric]
    if (observed === undefined) return { metric, status: 'UNKNOWN', target, actual: null, reason: '缺少实测值' }
    const passed = compareTarget(observed, target)
    return { metric, status: passed ? 'PASS' : 'BLOCKED', target, actual: observed, reason: passed ? '满足验收标准' : '实测偏离验收标准' }
  })
  const deviations = [...identityErrors, ...checks.filter(item => item.status !== 'PASS').map(item => `${item.metric}: ${item.reason}`)]
  const status = deviations.length === 0 ? 'passed' : 'needs_revision'
  return stage(true, {
    status,
    identity_errors: identityErrors,
    checks,
    deviations,
    trial_result: structuredClone(actual),
  }, [actual.process_record_ref, ...actual.measurement_record_refs], status === 'passed' ? [] : ['本 Run 不得产出可放大配方；修订后应创建新 Run 并引用本次失败证据'])
}

export function validateReleaseDecision({ trial_validation, decision, decision_role }) {
  const errors = []
  if (decision.actor_role !== decision_role) errors.push(`决定角色必须是 ${decision_role}`)
  if (!['accepted_for_scale_up', 'needs_revision', 'rejected'].includes(decision.status)) errors.push('终态决定越出 UC 边界')
  if (decision.status === 'accepted_for_scale_up' && trial_validation.status !== 'passed') errors.push('实测未通过时禁止签署可放大')
  if (!decision.rationale?.trim()) errors.push('必须记录签署理由')
  if (!Array.isArray(decision.evidence_refs) || decision.evidence_refs.length === 0) errors.push('必须引用签署依据')
  return stage(errors.length === 0, { decision: structuredClone(decision), validation_errors: errors }, decision.evidence_refs ?? [], errors)
}

export function finalizeFormulaRun({ candidate_package, initial_decision, trial_plan, trial_validation, release_decision }) {
  const early = initial_decision.status !== 'selected_for_trial'
  const status = early ? initial_decision.status : (release_decision?.status ?? trial_validation?.status ?? 'needs_revision')
  const accepted = status === 'accepted_for_scale_up'
  const verifiedFormula = accepted ? {
    formula_version: `${trial_plan.candidate_version}-VERIFIED`,
    candidate_version: trial_plan.candidate_version,
    trial_id: trial_plan.trial_id,
    components: structuredClone(candidate_package.candidates.find(item => item.candidate_version === trial_plan.candidate_version)?.components ?? []),
    evidence_refs: [...trial_validation.trial_result.measurement_record_refs, trial_validation.trial_result.process_record_ref, ...release_decision.evidence_refs],
  } : null
  return stage(true, {
    status,
    verified_formula: verifiedFormula,
    candidate_package: structuredClone(candidate_package),
    initial_decision: structuredClone(initial_decision),
    trial_plan: trial_plan ? structuredClone(trial_plan) : null,
    trial_report: trial_validation ? structuredClone(trial_validation) : null,
    release_decision: release_decision ? structuredClone(release_decision) : null,
    next_action: accepted ? '进入生产放大 UC' : (status === 'rejected' ? '结束本配方方向' : '依据偏差创建新候选版本和新 Run'),
  }, accepted ? verifiedFormula.evidence_refs : [initial_decision.rationale], [])
}
