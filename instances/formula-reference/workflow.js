/**
 * UC-RD-001 formula-candidate-reference v0.2 实例合同（JS 化）。
 * 原包：曹天航 v0.2.0-leyin-process release。executor capability_ref → {kind:'function', ref:'formula:xxx'}；
 * 声明式 Gate 在 gates.js；inputSchema 直接搬 JSON Schema 语义。
 * @module instances/formula-reference/workflow
 */

const STAGE_OUTPUT = {
  type: 'object',
  required: ['passed', 'result', 'evidence', 'uncertainties'],
  properties: {
    passed: { type: 'boolean' },
    result: { type: 'object' },
    evidence: { type: 'array', minItems: 1, items: { type: 'string' } },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
}

const T = {
  PASS: (next) => ({ PASS: next, FAIL: '$fail', NEEDS_INPUT: '$wait_input', HUMAN_REQUIRED: '$wait_human' }),
  SUCCESS: { PASS: '$success', FAIL: '$fail', NEEDS_INPUT: '$wait_input', HUMAN_REQUIRED: '$wait_human' },
}

export const contract = {
  id: 'formula-candidate-reference-v2',
  version: '0.2.0',
  input_gates: ['gate-input'],
  output_gates: ['gate-output'],
  inputSchema: {
    type: 'object',
    required: ['requirement_spec', 'historical_formula_evidence', 'approved_materials', 'hard_constraints', 'evaluation_dimensions'],
    properties: {
      requirement_spec: {
        type: 'object',
        required: ['requirement_version', 'source_record_ref', 'product_form', 'use_scenario', 'target_sensory', 'trial_quantity_kg', 'trial_equipment_class', 'decision_role'],
        properties: {
          requirement_version: { type: 'string', minLength: 1 },
          source_record_ref: { type: 'string', minLength: 1 },
          product_form: { type: 'string', minLength: 1 },
          use_scenario: { type: 'string', minLength: 1 },
          target_sensory: { type: 'object', minProperties: 1 },
          cost_ceiling_cny_per_kg_green: { type: 'number', minimum: 0 },
          trial_quantity_kg: { type: 'number', exclusiveMinimum: 0 },
          trial_equipment_class: { type: 'string', minLength: 1 },
          decision_role: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      historical_formula_evidence: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['formula_version', 'applicability', 'components', 'process_assumptions', 'validation', 'provenance'],
          properties: {
            formula_version: { type: 'string', minLength: 1 },
            applicability: {
              type: 'object',
              required: ['product_forms', 'use_scenarios', 'equipment_classes'],
              properties: {
                product_forms: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
                use_scenarios: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
                equipment_classes: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
              },
              additionalProperties: false,
            },
            components: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['material_id', 'specification_version', 'ratio_percent'],
                properties: {
                  material_id: { type: 'string', minLength: 1 },
                  specification_version: { type: 'string', minLength: 1 },
                  ratio_percent: { type: 'number', exclusiveMinimum: 0 },
                },
                additionalProperties: false,
              },
            },
            process_assumptions: { type: 'object', required: ['roast_style', 'equipment_class'] },
            validation: {
              type: 'object',
              required: ['result_ref', 'actual_sensory', 'status', 'recorded_at', 'methods'],
              properties: {
                result_ref: { type: 'string', minLength: 1 },
                actual_sensory: { type: 'object', minProperties: 1 },
                status: { const: 'accepted_for_internal_reference' },
                recorded_at: { type: 'string', minLength: 1 },
                methods: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
              },
            },
            provenance: {
              type: 'object',
              required: ['source_system', 'record_ref'],
              properties: { source_system: { type: 'string', minLength: 1 }, record_ref: { type: 'string', minLength: 1 } },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
      approved_materials: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['material_id', 'specification_version', 'batch_id', 'incoming_inspection_ref', 'inventory_as_of', 'inventory_record_ref', 'cost_record_ref', 'cost_cny_per_kg_green', 'available_kg', 'approved'],
          properties: {
            material_id: { type: 'string', minLength: 1 },
            specification_version: { type: 'string', minLength: 1 },
            batch_id: { type: 'string', minLength: 1 },
            incoming_inspection_ref: { type: 'string', minLength: 1 },
            inventory_as_of: { type: 'string', minLength: 1 },
            inventory_record_ref: { type: 'string', minLength: 1 },
            cost_record_ref: { type: 'string', minLength: 1 },
            cost_cny_per_kg_green: { type: 'number', minimum: 0 },
            available_kg: { type: 'number', minimum: 0 },
            approved: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      hard_constraints: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'rule'],
          properties: {
            id: { type: 'string', minLength: 1 },
            rule: { enum: ['ratio_balance', 'approved_material_only', 'inventory_for_trial', 'target_range', 'cost_ceiling', 'equipment_for_trial', 'incoming_inspection_present'] },
          },
          additionalProperties: false,
        },
      },
      evaluation_dimensions: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { enum: ['target_fit', 'green_cost', 'inventory_risk', 'evidence_strength', 'trial_uncertainty'] },
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['candidate_package', 'decision'],
    properties: {
      candidate_package: {
        type: 'object',
        required: ['candidate_versions', 'candidates', 'eligible_candidate_versions', 'blocked_candidate_versions', 'unknown_candidate_versions', 'comparison_rows', 'recommendation_order', 'ranking_method', 'generation_status', 'design_request', 'excluded_evidence'],
        properties: {
          candidate_versions: { type: 'array', items: { type: 'string' } },
          candidates: { type: 'array' },
          eligible_candidate_versions: { type: 'array', items: { type: 'string' } },
          blocked_candidate_versions: { type: 'array', items: { type: 'string' } },
          unknown_candidate_versions: { type: 'array', items: { type: 'string' } },
          comparison_rows: { type: 'array' },
          recommendation_order: { type: 'array', items: { type: 'string' } },
          ranking_method: { type: 'string', minLength: 1 },
          generation_status: { enum: ['candidates_ready', 'needs_expert_design'] },
          design_request: { type: ['object', 'null'] },
          excluded_evidence: { type: 'array' },
        },
        additionalProperties: false,
      },
      decision: {
        type: 'object',
        required: ['actor_role', 'status', 'selected_candidate_version', 'rationale'],
        properties: {
          actor_role: { type: 'string', minLength: 1 },
          status: { enum: ['selected_for_trial', 'needs_revision', 'rejected'] },
          selected_candidate_version: { type: ['string', 'null'] },
          rationale: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  steps: [
    {
      id: 'stage-1',
      name: '启动合同完整',
      executor: { kind: 'function', ref: 'formula:normalize-requirement' },
      input: {
        requirement_spec: '$input.requirement_spec',
        hard_constraints: '$input.hard_constraints',
        evaluation_dimensions: '$input.evaluation_dimensions',
      },
      outputKey: 'stage-1-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-stage-1'],
      transitions: T.PASS('stage-2'),
    },
    {
      id: 'stage-2',
      name: '适用证据成立',
      executor: { kind: 'function', ref: 'formula:retrieve-evidence' },
      input: {
        historical_formula_evidence: '$input.historical_formula_evidence',
        approved_materials: '$input.approved_materials',
        requirement_contract: '$steps.stage-1-output.result.requirement_contract',
      },
      outputKey: 'stage-2-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-stage-2'],
      transitions: T.PASS('stage-3'),
    },
    {
      id: 'stage-3',
      name: '候选配方可计算',
      executor: { kind: 'function', ref: 'formula:generate-candidates' },
      input: {
        requirement_contract: '$steps.stage-1-output.result.requirement_contract',
        usable_evidence: '$steps.stage-2-output.result.usable_evidence',
        approved_materials: '$input.approved_materials',
      },
      outputKey: 'stage-3-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-stage-3'],
      transitions: T.PASS('stage-4'),
    },
    {
      id: 'stage-4',
      name: '硬约束已逐项检查',
      executor: { kind: 'function', ref: 'formula:evaluate-constraints' },
      input: {
        requirement_contract: '$steps.stage-1-output.result.requirement_contract',
        candidates: '$steps.stage-3-output.result.candidates',
        approved_materials: '$input.approved_materials',
        hard_constraints: '$input.hard_constraints',
      },
      outputKey: 'stage-4-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-stage-4'],
      transitions: T.PASS('stage-5'),
    },
    {
      id: 'stage-5',
      name: '比较包可供决策',
      executor: { kind: 'function', ref: 'formula:compare-candidates' },
      input: {
        candidate_results: '$steps.stage-4-output.result.candidate_results',
        evaluated_candidates: '$steps.stage-4-output.result.evaluated_candidates',
        eligible_candidates: '$steps.stage-4-output.result.eligible_candidates',
        blocked_candidate_versions: '$steps.stage-4-output.result.blocked_candidate_versions',
        unknown_candidate_versions: '$steps.stage-4-output.result.unknown_candidate_versions',
        evaluation_dimensions: '$input.evaluation_dimensions',
        generation_status: '$steps.stage-3-output.result.generation_status',
        design_request: '$steps.stage-3-output.result.design_request',
        excluded_evidence: '$steps.stage-2-output.result.excluded_evidence',
      },
      outputKey: 'stage-5-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-stage-5'],
      transitions: T.PASS('stage-6-human'),
    },
    {
      id: 'stage-6-human',
      name: '配方责任人作出实验决定',
      executor: { kind: 'human', ref: 'human://formula-owner-decision' },
      input: {
        candidate_package: '$steps.stage-5-output.result',
        decision_role: '$steps.stage-1-output.result.requirement_contract.decision_role',
        allowed_statuses: ['selected_for_trial', 'needs_revision', 'rejected'],
      },
      outputKey: 'stage-6-human-output',
      outputSchema: {
        type: 'object',
        required: ['actor_role', 'status', 'selected_candidate_version', 'rationale'],
        properties: {
          actor_role: { type: 'string', minLength: 1 },
          status: { enum: ['selected_for_trial', 'needs_revision', 'rejected'] },
          selected_candidate_version: { type: ['string', 'null'] },
          rationale: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      preGates: [],
      postGates: ['gate-stage-6-human'],
      transitions: T.PASS('stage-6'),
    },
    {
      id: 'stage-6',
      name: '人工决定边界正确',
      executor: { kind: 'function', ref: 'formula:validate-decision' },
      input: {
        decision: '$steps.stage-6-human-output',
        candidate_package: '$steps.stage-5-output.result',
        decision_role: '$steps.stage-1-output.result.requirement_contract.decision_role',
      },
      outputKey: 'stage-6-output',
      outputSchema: STAGE_OUTPUT,
      preGates: [],
      postGates: ['gate-stage-6'],
      transitions: T.SUCCESS,
    },
  ],
  outputMapping: {
    candidate_package: '$steps.stage-5-output.result',
    decision: '$steps.stage-6-output.result.decision',
  },
}
