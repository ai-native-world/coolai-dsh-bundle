/**
 * UC-RD-001 formula-candidate-reference 能力函数移植（与 formula_capabilities.py 逐函数对齐）。
 * 确定性纯函数：无副作用、无随机数；数值与证据字符串与 Python 版逐字段对齐。
 * @module instances/formula-reference/functions
 */

/** Python 语义的空值判定（None/''/[]/{}）。 */
const pyEmpty = v =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)

/** Python round（银行家舍入）。 */
function pyRound(x, n) {
  const m = 10 ** n
  const scaled = x * m
  const r = Math.round(scaled)
  if (Math.abs(scaled - r) <= 1e-9 && r % 2 !== 0) return (r - Math.sign(scaled - r)) / m
  return r / m
}

function stage(passed, result, evidence, uncertainties = []) {
  return { passed, result, evidence, uncertainties }
}

/** normalize_requirement：锁定有版本的需求合同，缺失时停止。 */
export function normalizeRequirement(payload) {
  const requirement = structuredClone(payload.requirement_spec ?? {})
  const required = ['requirement_version', 'product_form', 'use_scenario', 'target_sensory', 'trial_quantity_kg', 'decision_role']
  const missing = required.filter(f => pyEmpty(requirement[f]))
  const constraints = payload.hard_constraints ?? []
  const dimensions = payload.evaluation_dimensions ?? []
  if (pyEmpty(constraints)) missing.push('hard_constraints')
  if (pyEmpty(dimensions)) missing.push('evaluation_dimensions')
  const result = {
    requirement_contract: requirement,
    hard_constraints: structuredClone(constraints),
    evaluation_dimensions: structuredClone(dimensions),
    missing_fields: missing,
  }
  if (missing.length > 0) {
    return stage(false, result, [`需求版本 ${requirement.requirement_version ?? 'unknown'} 的完整性检查`], missing)
  }
  return stage(true, result, [`已锁定需求版本 ${requirement.requirement_version}`])
}

/** retrieve_evidence：筛选有版本、有实际结果且物料规格已批准的历史配方证据。 */
export function retrieveEvidence(payload) {
  const materialIds = (payload.approved_materials ?? []).map(m => m.material_id)
  const dupMaterials = [...new Set(materialIds.filter((id, i) => materialIds.indexOf(id) !== i))].sort()
  const formulaVersions = (payload.historical_formula_evidence ?? []).map(e => e.formula_version)
  const dupFormulas = [...new Set(formulaVersions.filter((v, i) => formulaVersions.indexOf(v) !== i))].sort()
  if (dupMaterials.length > 0 || dupFormulas.length > 0) {
    const conflicts = []
    if (dupMaterials.length > 0) conflicts.push(`物料 ID 重复=${dupMaterials}`)
    if (dupFormulas.length > 0) conflicts.push(`历史配方版本重复=${dupFormulas}`)
    return stage(false, { usable_evidence: [], excluded_evidence: [] }, ['实例标识唯一性检查失败'], conflicts)
  }
  const materials = Object.fromEntries((payload.approved_materials ?? []).map(m => [m.material_id, m]))
  const requirement = payload.requirement_contract ?? {}
  const usable = []
  const excluded = []
  for (const item of payload.historical_formula_evidence ?? []) {
    const version = item.formula_version ?? 'unknown'
    const validation = item.validation ?? {}
    const provenance = item.provenance ?? {}
    const applicability = item.applicability ?? {}
    const components = item.components ?? []
    const reasons = []
    if (typeof version !== 'string' || !version.includes('-v')) reasons.push('配方版本缺失或不可识别')
    if (!validation.result_ref || validation.status !== 'accepted_for_internal_reference') reasons.push('缺少可用的实际验证结果')
    if (pyEmpty(validation.recorded_at) || pyEmpty(validation.methods)) reasons.push('实际验证缺少时间或方法')
    if (pyEmpty(provenance.record_ref) || pyEmpty(provenance.source_system)) reasons.push('历史配方缺少来源记录')
    if (!(applicability.product_forms ?? []).includes(requirement.product_form)) reasons.push('产品形态不适用')
    if (!(applicability.use_scenarios ?? []).includes(requirement.use_scenario)) reasons.push('使用场景不适用')
    if (!(applicability.equipment_classes ?? []).includes(requirement.trial_equipment_class)) reasons.push('试验设备类别未经适用性验证')
    if (pyEmpty(components)) reasons.push('配方组成缺失')
    for (const component of components) {
      const material = materials[component.material_id]
      if (material === undefined) reasons.push(`物料 ${component.material_id} 不在实例物料表`)
      else if (pyEmpty(material.specification_version) || !material.approved) reasons.push(`物料 ${component.material_id} 未批准或规格版本缺失`)
      else if (material.specification_version !== component.specification_version) reasons.push(`物料 ${component.material_id} 规格版本与历史证据不一致`)
      else if (!['batch_id', 'incoming_inspection_ref', 'inventory_as_of', 'inventory_record_ref', 'cost_record_ref'].every(f => !pyEmpty(material[f]))) reasons.push(`物料 ${component.material_id} 缺少当前批次、来料检验、库存时点或成本来源`)
    }
    if (reasons.length > 0) {
      excluded.push({ formula_version: String(version), reason: [...new Set(reasons)].sort().join('；') })
    } else {
      usable.push(structuredClone(item))
    }
  }
  const result = { usable_evidence: usable, excluded_evidence: excluded }
  if (usable.length === 0) {
    return stage(true, result, ['历史证据筛选完成，没有证据同时满足产品、场景、设备和物料规格适用性'], ['需要从零设计或补充适用的历史验证证据'])
  }
  const evidence = usable.map(item => `${item.formula_version} → ${item.validation.result_ref}`)
  return stage(true, result, evidence, ['历史结果只能作为候选依据，仍需本实例打样验证'])
}

/** generate_candidates：从适用历史证据形成可计算候选，不凭空发明配方比例。 */
export function generateCandidates(payload) {
  const requirement = payload.requirement_contract ?? {}
  const materials = Object.fromEntries((payload.approved_materials ?? []).map(m => [m.material_id, m]))
  const candidates = []
  for (const item of payload.usable_evidence ?? []) {
    const formulaVersion = item.formula_version
    const suffix = formulaVersion.startsWith('SYN-FML-') ? formulaVersion.slice('SYN-FML-'.length) : formulaVersion
    const candidateVersion = `SYN-CAND-${suffix}`
    const validation = item.validation ?? {}
    const components = structuredClone(item.components ?? [])
    for (const component of components) {
      const current = materials[component.material_id]
      if (current) {
        component.batch_id = current.batch_id
        component.incoming_inspection_ref = current.incoming_inspection_ref
      }
    }
    candidates.push({
      candidate_version: candidateVersion,
      candidate_kind: 'historical_reuse',
      source_formula_version: formulaVersion,
      source_result_ref: validation.result_ref,
      source_record_ref: (item.provenance ?? {}).record_ref,
      components,
      process_assumptions: structuredClone(item.process_assumptions ?? {}),
      predicted_properties: {
        evidence_type: 'historical_actual',
        sensory: structuredClone(validation.actual_sensory ?? {}),
      },
      target_context: {
        product_form: requirement.product_form,
        use_scenario: requirement.use_scenario,
        trial_equipment_class: requirement.trial_equipment_class,
      },
      applicability_assertion: {
        product_form: 'exact_match',
        use_scenario: 'exact_match',
        equipment_class: 'exact_match',
        material_specifications: 'exact_match',
      },
      uncertainties: ['当前生豆批次与历史验证批次仍可能存在农产品波动，必须通过本实例打样和杯测验证'],
      trial_validation_requirements: ['按声明设备完成小样烘焙', '记录理化结果与多人杯测结果', '把结果关联回候选和当前生豆批次'],
      current_fact_refs: components.map(c => ({
        material_id: c.material_id,
        inventory_as_of: materials[c.material_id].inventory_as_of,
        inventory_record_ref: materials[c.material_id].inventory_record_ref,
        cost_record_ref: materials[c.material_id].cost_record_ref,
      })),
    })
  }
  const result = {
    candidates,
    generation_status: candidates.length > 0 ? 'candidates_ready' : 'needs_expert_design',
    design_request: candidates.length > 0 ? null : {
      reason: '没有同时满足产品形态、使用场景、设备类别和物料规格的历史证据',
      required_action: '由配方责任人从零设计，或补充经验证的迁移规则后重新运行',
    },
  }
  return stage(true, result, [`由 ${candidates.length} 条适用历史配方形成可追溯复用候选；未执行无依据的比例改写`])
}

/** _target_check：目标感官逐项判定（UNKNOWN 优先）。 */
function targetCheck(candidate, requirement) {
  const actual = candidate.predicted_properties?.sensory ?? {}
  const targets = requirement.target_sensory ?? {}
  const details = []
  let unknown = false
  let blocked = false
  for (const [name, target] of Object.entries(targets)) {
    const observed = actual[name]
    if (observed === undefined || observed === null) {
      unknown = true
      details.push(`${name}=UNKNOWN`)
      continue
    }
    let passed
    if (target !== null && typeof target === 'object' && !Array.isArray(target) && 'target' in target) {
      const tolerance = target.tolerance ?? 0
      passed = Math.abs(Number(observed) - Number(target.target)) <= Number(tolerance)
    } else if (Array.isArray(target)) {
      passed = Array.isArray(observed) ? target.every(item => observed.includes(item)) : false
    } else {
      passed = observed === target
    }
    blocked = blocked || !passed
    details.push(`${name}=${passed ? 'PASS' : 'BLOCKED'}`)
  }
  if (unknown) return ['UNKNOWN', details]
  return [blocked ? 'BLOCKED' : 'PASS', details]
}

/** evaluate_constraints：逐项计算比例、物料批准、库存、目标范围与成本硬约束。 */
export function evaluateConstraints(payload) {
  const requirement = payload.requirement_contract ?? {}
  const materialMap = Object.fromEntries((payload.approved_materials ?? []).map(m => [m.material_id, m]))
  const declaredRules = (payload.hard_constraints ?? []).map(c => c.rule)
  const supported = new Set(['ratio_balance', 'approved_material_only', 'inventory_for_trial', 'target_range', 'cost_ceiling', 'equipment_for_trial', 'incoming_inspection_present'])
  const candidateResults = []
  const evaluatedCandidates = []
  const eligible = []
  for (const candidate of payload.candidates ?? []) {
    const checks = []
    const components = candidate.components ?? []
    const totalRatio = components.reduce((s, c) => s + Number(c.ratio_percent ?? 0), 0)
    const trialQuantity = Number(requirement.trial_quantity_kg)
    for (const rule of declaredRules) {
      if (!supported.has(rule)) {
        checks.push({ rule, status: 'UNKNOWN', evidence: '当前实现不识别该规则，按未知阻断' })
        continue
      }
      if (rule === 'ratio_balance') {
        const passed = components.length > 0 && components.every(c => Number(c.ratio_percent ?? 0) > 0) && Math.abs(totalRatio - 100) < 1e-9
        checks.push({ rule, status: passed ? 'PASS' : 'BLOCKED', evidence: `比例合计=${String(Number(totalRatio))}%` })
      } else if (rule === 'approved_material_only') {
        const bad = components.filter(c => !materialMap[c.material_id] || !materialMap[c.material_id].approved || pyEmpty(materialMap[c.material_id].specification_version)).map(c => c.material_id)
        checks.push({ rule, status: bad.length > 0 ? 'BLOCKED' : 'PASS', evidence: bad.length > 0 ? `未批准或缺版本物料=${bad}` : '全部物料已批准且规格有版本' })
      } else if (rule === 'inventory_for_trial') {
        const shortages = []
        for (const component of components) {
          const material = materialMap[component.material_id]
          const requiredKg = pyRound(trialQuantity * Number(component.ratio_percent) / 100, 6)
          const availableKg = material === undefined ? null : material.available_kg
          if (availableKg === null || Number(availableKg) < requiredKg) {
            shortages.push({ material_id: component.material_id, required_kg: requiredKg, available_kg: availableKg })
          }
        }
        const status = shortages.length === 0 ? 'PASS' : (shortages.some(s => s.available_kg === null) ? 'UNKNOWN' : 'BLOCKED')
        checks.push({ rule, status, evidence: shortages.length === 0 ? '库存足以覆盖本次试验量' : `库存缺口=${shortages}` })
      } else if (rule === 'target_range') {
        const [status, details] = targetCheck(candidate, requirement)
        checks.push({ rule, status, evidence: details.join('；') })
      } else if (rule === 'cost_ceiling') {
        const ceiling = requirement.cost_ceiling_cny_per_kg_green
        if (ceiling === undefined || ceiling === null) {
          checks.push({ rule, status: 'UNKNOWN', evidence: '实例未声明成本上限' })
          continue
        }
        const missingPrice = components.filter(c => !materialMap[c.material_id] || materialMap[c.material_id].cost_cny_per_kg_green === undefined || materialMap[c.material_id].cost_cny_per_kg_green === null).map(c => c.material_id)
        if (missingPrice.length > 0) {
          checks.push({ rule, status: 'UNKNOWN', evidence: `物料价格缺失=${missingPrice}` })
        } else {
          const cost = pyRound(components.reduce((s, c) => s + Number(materialMap[c.material_id].cost_cny_per_kg_green) * Number(c.ratio_percent) / 100, 0), 4)
          checks.push({ rule, status: cost <= Number(ceiling) ? 'PASS' : 'BLOCKED', evidence: `估算生豆成本=${cost} CNY/kg，上限=${ceiling}`, calculated_cost: cost })
        }
      } else if (rule === 'equipment_for_trial') {
        const expected = requirement.trial_equipment_class
        const actual = candidate.process_assumptions?.equipment_class
        const passed = actual === expected
        checks.push({ rule, status: passed ? 'PASS' : 'UNKNOWN', evidence: `历史验证设备=${actual}；本次试验设备=${expected}` })
      } else if (rule === 'incoming_inspection_present') {
        const missing = components.filter(c => !materialMap[c.material_id]?.incoming_inspection_ref).map(c => c.material_id)
        checks.push({ rule, status: missing.length > 0 ? 'UNKNOWN' : 'PASS', evidence: missing.length > 0 ? `缺少来料检验依据=${missing}` : '全部当前物料批次具备来料检验依据' })
      }
    }
    let hardStatus = 'PASS'
    if (checks.some(c => c.status === 'BLOCKED')) hardStatus = 'BLOCKED'
    else if (checks.some(c => c.status === 'UNKNOWN')) hardStatus = 'UNKNOWN'
    const record = { candidate_version: candidate.candidate_version, hard_status: hardStatus, checks }
    candidateResults.push(record)
    const enriched = structuredClone(candidate)
    enriched.constraint_result = record
    evaluatedCandidates.push(enriched)
    if (hardStatus === 'PASS') eligible.push(enriched)
  }
  const result = {
    candidate_results: candidateResults,
    evaluated_candidates: evaluatedCandidates,
    eligible_candidates: eligible,
    blocked_candidate_versions: candidateResults.filter(r => r.hard_status === 'BLOCKED').map(r => r.candidate_version),
    unknown_candidate_versions: candidateResults.filter(r => r.hard_status === 'UNKNOWN').map(r => r.candidate_version),
  }
  return stage(true, result, [`${candidateResults.length} 个候选均完成 ${declaredRules.length} 项硬约束逐项判定`])
}

/** compare_candidates：只在通过硬约束的候选之间保留逐维差异并给出确定性顺序。 */
export function compareCandidates(payload) {
  const dimensions = payload.evaluation_dimensions ?? []
  const rows = []
  for (const candidate of payload.eligible_candidates ?? []) {
    const checkMap = Object.fromEntries(candidate.constraint_result.checks.map(c => [c.rule, c]))
    const cost = checkMap.cost_ceiling?.calculated_cost
    const targetEvidence = checkMap.target_range?.evidence ?? '未声明目标范围'
    const observations = []
    for (const dimension of dimensions) {
      let value
      if (dimension === 'green_cost') value = cost !== undefined && cost !== null ? `${cost} CNY/kg` : '未声明或无法计算'
      else if (dimension === 'target_fit') value = targetEvidence
      else if (dimension === 'inventory_risk') value = checkMap.inventory_for_trial?.evidence ?? '未声明库存约束'
      else if (dimension === 'evidence_strength') value = `来源记录 ${candidate.source_record_ref}；配方 ${candidate.source_formula_version}；结果 ${candidate.source_result_ref}`
      else if (dimension === 'trial_uncertainty') value = (candidate.uncertainties ?? []).join('；')
      else value = '未声明'
      observations.push({ dimension, observation: value })
    }
    const targetPenalty = (targetEvidence.match(/BLOCKED/g) ?? []).length + (targetEvidence.match(/UNKNOWN/g) ?? []).length * 10
    rows.push({ candidate_version: candidate.candidate_version, observations, ordering_key: { target_penalty: targetPenalty, cost_cny_per_kg_green: cost } })
  }
  const ordered = [...rows].sort((a, b) => {
    const pa = a.ordering_key.target_penalty
    const pb = b.ordering_key.target_penalty
    if (pa !== pb) return pa - pb
    const ca = a.ordering_key.cost_cny_per_kg_green
    const cb = b.ordering_key.cost_cny_per_kg_green
    const na = ca === undefined || ca === null
    const nb = cb === undefined || cb === null
    if (na !== nb) return na ? 1 : -1
    const va = ca ?? 0
    const vb = cb ?? 0
    if (va !== vb) return va - vb
    return a.candidate_version < b.candidate_version ? -1 : a.candidate_version > b.candidate_version ? 1 : 0
  })
  const result = {
    candidate_versions: (payload.candidate_results ?? []).map(r => r.candidate_version),
    candidates: structuredClone(payload.evaluated_candidates ?? []),
    eligible_candidate_versions: (payload.eligible_candidates ?? []).map(c => c.candidate_version),
    blocked_candidate_versions: structuredClone(payload.blocked_candidate_versions ?? []),
    unknown_candidate_versions: structuredClone(payload.unknown_candidate_versions ?? []),
    comparison_rows: rows,
    recommendation_order: ordered.map(r => r.candidate_version),
    ranking_method: '按实例评价维度保留逐项观察；仅用目标偏差、成本和稳定 ID 做确定性排序，不生成掩盖硬约束的总分',
    generation_status: payload.generation_status,
    design_request: structuredClone(payload.design_request),
    excluded_evidence: structuredClone(payload.excluded_evidence ?? []),
  }
  return stage(true, result, ['候选只从 hard_status=PASS 集合进入比较'], ordered.length > 0 ? [] : ['没有通过硬约束的候选，应由配方责任人拒绝或退回修订'])
}

/** validate_decision：人工决定边界复核。 */
export function validateDecision(payload) {
  const decision = structuredClone(payload.decision ?? {})
  const eligible = new Set((payload.candidate_package?.eligible_candidate_versions ?? []))
  const expectedRole = payload.decision_role
  const errors = []
  const status = decision.status
  const selected = decision.selected_candidate_version
  if (decision.actor_role !== expectedRole) errors.push(`决定角色必须是 ${expectedRole}`)
  if (!['selected_for_trial', 'needs_revision', 'rejected'].includes(status)) errors.push('决定状态越出 UC 边界')
  if (status === 'selected_for_trial' && !eligible.has(selected)) errors.push('selected_for_trial 只能选择已通过全部硬约束的候选')
  if (['needs_revision', 'rejected'].includes(status) && selected !== null && selected !== undefined) errors.push('退回或拒绝时不得伪造已选候选')
  if (pyEmpty(decision.rationale)) errors.push('必须记录决定理由')
  const result = { decision, validation_errors: errors }
  return stage(errors.length === 0, result, ['人工决定已按角色、候选资格和状态边界执行确定性复核'], errors)
}
