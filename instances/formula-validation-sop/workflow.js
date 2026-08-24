/**
 * UC-RD-001 配方开发与小样验证 SOP v0.3。
 * 候选生成沿用 v0.2；本合同补齐实物试验、验收与终态签署，不包含生产放大。
 */
import { contract as candidateContract } from '../formula-reference/workflow.js'

const STAGE_OUTPUT = {
  type: 'object',
  required: ['passed', 'result', 'evidence', 'uncertainties'],
  properties: {
    passed: { type: 'boolean' },
    result: { type: 'object' },
    evidence: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
}

const TRIAL_PLAN = {
  type: 'object',
  required: ['trial_id', 'candidate_version', 'requirement_version', 'equipment_class', 'trial_quantity_kg', 'material_batches', 'acceptance_checks', 'required_record_refs'],
  properties: {
    trial_id: { type: 'string', minLength: 1 },
    candidate_version: { type: 'string', minLength: 1 },
    requirement_version: { type: 'string', minLength: 1 },
    equipment_class: { type: 'string', minLength: 1 },
    trial_quantity_kg: { type: 'number', exclusiveMinimum: 0 },
    material_batches: {
      type: 'array', minItems: 1, items: {
        type: 'object', required: ['material_id', 'batch_id'],
        properties: { material_id: { type: 'string', minLength: 1 }, batch_id: { type: 'string', minLength: 1 } }, additionalProperties: false,
      },
    },
    acceptance_checks: {
      type: 'array', minItems: 1, items: {
        type: 'object', required: ['metric', 'target'],
        properties: { metric: { type: 'string', minLength: 1 }, target: {} }, additionalProperties: false,
      },
    },
    required_record_refs: { type: 'array', minItems: 2, items: { type: 'string', minLength: 1 } },
  },
  additionalProperties: false,
}

const TRIAL_RESULT = {
  type: 'object',
  required: ['trial_id', 'candidate_version', 'equipment_class', 'material_batches', 'actual_sensory', 'process_record_ref', 'measurement_record_refs', 'recorded_at', 'operator_role'],
  properties: {
    trial_id: { type: 'string', minLength: 1 },
    candidate_version: { type: 'string', minLength: 1 },
    equipment_class: { type: 'string', minLength: 1 },
    material_batches: TRIAL_PLAN.properties.material_batches,
    actual_sensory: { type: 'object', minProperties: 1 },
    process_record_ref: { type: 'string', minLength: 1 },
    measurement_record_refs: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    recorded_at: { type: 'string', minLength: 1 },
    operator_role: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
}

const baseSteps = structuredClone(candidateContract.steps)
baseSteps.at(-1).transitions = { PASS: 'stage-7-route', FAIL: '$fail', NEEDS_INPUT: '$wait_input', HUMAN_REQUIRED: '$wait_human' }

export const contract = {
  id: 'formula-development-validation-sop',
  version: '0.3.0',
  input_gates: candidateContract.input_gates,
  output_gates: ['gate-sop-output'],
  inputSchema: candidateContract.inputSchema,
  outputSchema: {
    type: 'object',
    required: ['status', 'verified_formula', 'candidate_package', 'initial_decision', 'trial_plan', 'trial_report', 'release_decision', 'next_action'],
    properties: {
      status: { enum: ['accepted_for_scale_up', 'needs_revision', 'rejected'] },
      verified_formula: { type: ['object', 'null'] },
      candidate_package: { type: 'object' },
      initial_decision: { type: 'object' },
      trial_plan: { type: ['object', 'null'] },
      trial_report: { type: ['object', 'null'] },
      release_decision: { type: ['object', 'null'] },
      next_action: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  steps: [
    ...baseSteps,
    {
      id: 'stage-7-route', name: '按责任人决定进入试验或终止本 Run',
      executor: { kind: 'function', ref: 'formula-sop:route-decision' },
      input: { decision: '$steps.stage-6-output.result.decision' },
      outputKey: 'stage-7-output',
      outputSchema: {
        type: 'object', required: ['status', 'decision'],
        properties: { status: { enum: ['selected_for_trial', 'needs_revision', 'rejected'] }, decision: { type: 'object' } },
        additionalProperties: false,
      },
      transitionPath: '$output.status',
      transitions: { selected_for_trial: 'stage-8-plan', needs_revision: 'stage-12-finalize', rejected: 'stage-12-finalize', FAIL: '$fail' },
    },
    {
      id: 'stage-8-plan', name: '冻结候选、批次、设备与验收标准',
      executor: { kind: 'function', ref: 'formula-sop:build-trial-plan' },
      input: {
        requirement_contract: '$steps.stage-1-output.result.requirement_contract',
        candidate_package: '$steps.stage-5-output.result',
        decision: '$steps.stage-6-output.result.decision',
      },
      outputKey: 'stage-8-output', outputSchema: STAGE_OUTPUT,
      postGates: ['gate-trial-plan'],
      transitions: { PASS: 'stage-9-input', FAIL: '$fail', NEEDS_INPUT: '$wait_input' },
    },
    {
      id: 'stage-9-input', name: '回填真实小样与测量记录',
      executor: { kind: 'input', ref: 'external://trial-result' },
      input: { trial_plan: '$steps.stage-8-output.result.plan' },
      outputKey: 'stage-9-input-output', outputSchema: TRIAL_RESULT,
      postGates: ['gate-trial-input'],
      transitions: { PASS: 'stage-10-validate', FAIL: '$fail', NEEDS_INPUT: '$wait_input' },
    },
    {
      id: 'stage-10-validate', name: '按冻结标准逐项验收真实结果',
      executor: { kind: 'function', ref: 'formula-sop:validate-trial-result' },
      input: { plan: '$steps.stage-8-output.result.plan', trial_result: '$steps.stage-9-input-output' },
      outputKey: 'stage-10-output',
      outputSchema: {
        ...STAGE_OUTPUT,
        properties: {
          ...STAGE_OUTPUT.properties,
          result: {
            type: 'object', required: ['status', 'identity_errors', 'checks', 'deviations', 'trial_result'],
            properties: {
              status: { enum: ['passed', 'needs_revision'] },
              identity_errors: { type: 'array', items: { type: 'string' } },
              checks: { type: 'array', minItems: 1 },
              deviations: { type: 'array', items: { type: 'string' } },
              trial_result: TRIAL_RESULT,
            }, additionalProperties: false,
          },
        },
      },
      postGates: ['gate-trial-validation'],
      transitionPath: '$output.result.status',
      transitions: { passed: 'stage-11-human', needs_revision: 'stage-12-finalize', FAIL: '$fail' },
    },
    {
      id: 'stage-11-human', name: '配方责任人签署验收终态',
      executor: { kind: 'human', ref: 'human://formula-owner-release' },
      input: {
        trial_plan: '$steps.stage-8-output.result.plan',
        trial_validation: '$steps.stage-10-output.result',
        allowed_statuses: ['accepted_for_scale_up', 'needs_revision', 'rejected'],
      },
      outputKey: 'stage-11-human-output',
      outputSchema: {
        type: 'object', required: ['actor_role', 'status', 'rationale', 'evidence_refs'],
        properties: {
          actor_role: { type: 'string', minLength: 1 },
          status: { enum: ['accepted_for_scale_up', 'needs_revision', 'rejected'] },
          rationale: { type: 'string', minLength: 1 },
          evidence_refs: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        }, additionalProperties: false,
      },
      transitions: { PASS: 'stage-11-validate', FAIL: '$fail' },
    },
    {
      id: 'stage-11-validate', name: '签署权限和越权边界正确',
      executor: { kind: 'function', ref: 'formula-sop:validate-release-decision' },
      input: {
        trial_validation: '$steps.stage-10-output.result',
        decision: '$steps.stage-11-human-output',
        decision_role: '$steps.stage-1-output.result.requirement_contract.decision_role',
      },
      outputKey: 'stage-11-output', outputSchema: STAGE_OUTPUT,
      postGates: ['gate-release-decision'],
      transitions: { PASS: 'stage-12-finalize', FAIL: '$fail' },
    },
    {
      id: 'stage-12-finalize', name: '形成可验收终态包',
      executor: { kind: 'function', ref: 'formula-sop:finalize' },
      input: {
        candidate_package: '$steps.stage-5-output.result',
        initial_decision: '$steps.stage-6-output.result.decision',
        trial_plan: '$steps.stage-8-output.result.plan',
        trial_validation: '$steps.stage-10-output.result',
        release_decision: '$steps.stage-11-output.result.decision',
      },
      outputKey: 'stage-12-output', outputSchema: STAGE_OUTPUT,
      transitions: { PASS: '$success', FAIL: '$fail' },
    },
  ],
  outputMapping: {
    status: '$steps.stage-12-output.result.status',
    verified_formula: '$steps.stage-12-output.result.verified_formula',
    candidate_package: '$steps.stage-12-output.result.candidate_package',
    initial_decision: '$steps.stage-12-output.result.initial_decision',
    trial_plan: '$steps.stage-12-output.result.trial_plan',
    trial_report: '$steps.stage-12-output.result.trial_report',
    release_decision: '$steps.stage-12-output.result.release_decision',
    next_action: '$steps.stage-12-output.result.next_action',
  },
}
