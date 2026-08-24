/**
 * UC-RD-001 formula-candidate-reference v0.2 声明式 Gate 定义（翻译自 gates.yaml）。
 * @module instances/formula-reference/gates
 */

export const gateDefs = new Map([
  ['gate-input', {
    on_fail: 'NEEDS_INPUT',
    checks: [
      { path: '$input.requirement_spec', operator: 'non_empty' },
      { path: '$input.historical_formula_evidence', operator: 'non_empty' },
      { path: '$input.approved_materials', operator: 'non_empty' },
      { path: '$input.hard_constraints', operator: 'non_empty' },
      { path: '$input.evaluation_dimensions', operator: 'non_empty' },
    ],
  }],
  ['gate-stage-1', {
    on_fail: 'NEEDS_INPUT',
    checks: [
      { path: '$steps.stage-1-output.passed', operator: 'truthy' },
      { path: '$steps.stage-1-output.result.missing_fields', operator: 'eq', value: [] },
      { path: '$steps.stage-1-output.evidence', operator: 'non_empty' },
    ],
  }],
  ['gate-stage-2', {
    on_fail: 'FAIL',
    checks: [
      { path: '$steps.stage-2-output.passed', operator: 'truthy' },
      { path: '$steps.stage-2-output.evidence', operator: 'non_empty' },
    ],
  }],
  ['gate-stage-3', {
    on_fail: 'FAIL',
    checks: [
      { path: '$steps.stage-3-output.passed', operator: 'truthy' },
      { path: '$steps.stage-3-output.result.candidates', operator: 'present' },
      { path: '$steps.stage-3-output.result.generation_status', operator: 'in', value: ['candidates_ready', 'needs_expert_design'] },
      { path: '$steps.stage-3-output.evidence', operator: 'non_empty' },
    ],
  }],
  ['gate-stage-4', {
    on_fail: 'FAIL',
    checks: [
      { path: '$steps.stage-4-output.passed', operator: 'truthy' },
      { path: '$steps.stage-4-output.result.candidate_results', operator: 'present' },
      { path: '$steps.stage-4-output.evidence', operator: 'non_empty' },
    ],
  }],
  ['gate-stage-5', {
    on_fail: 'FAIL',
    checks: [
      { path: '$steps.stage-5-output.passed', operator: 'truthy' },
      { path: '$steps.stage-5-output.result.candidates', operator: 'present' },
      { path: '$steps.stage-5-output.result.generation_status', operator: 'in', value: ['candidates_ready', 'needs_expert_design'] },
      { path: '$steps.stage-5-output.result.ranking_method', operator: 'present' },
      { path: '$steps.stage-5-output.evidence', operator: 'non_empty' },
    ],
  }],
  ['gate-stage-6-human', {
    on_fail: 'HUMAN_REQUIRED',
    checks: [
      { path: '$steps.stage-6-human-output.actor_role', operator: 'present' },
      { path: '$steps.stage-6-human-output.status', operator: 'in', value: ['selected_for_trial', 'needs_revision', 'rejected'] },
      { path: '$steps.stage-6-human-output.rationale', operator: 'present' },
    ],
  }],
  ['gate-stage-6', {
    on_fail: 'FAIL',
    checks: [
      { path: '$steps.stage-6-output.passed', operator: 'truthy' },
      { path: '$steps.stage-6-output.result.validation_errors', operator: 'eq', value: [] },
      { path: '$steps.stage-6-output.evidence', operator: 'non_empty' },
    ],
  }],
  ['gate-output', {
    on_fail: 'FAIL',
    checks: [
      { path: '$output.candidate_package.candidates', operator: 'present' },
      { path: '$output.candidate_package.generation_status', operator: 'in', value: ['candidates_ready', 'needs_expert_design'] },
      { path: '$output.decision.status', operator: 'in', value: ['selected_for_trial', 'needs_revision', 'rejected'] },
      { path: '$output.decision.rationale', operator: 'present' },
    ],
  }],
])
