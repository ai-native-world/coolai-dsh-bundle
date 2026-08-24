import { gateDefs as candidateGates } from '../formula-reference/gates.js'

export const gateDefs = new Map(candidateGates)

gateDefs.set('gate-trial-plan', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.stage-8-output.passed', operator: 'truthy' },
    { path: '$steps.stage-8-output.result.plan.acceptance_checks', operator: 'non_empty' },
    { path: '$steps.stage-8-output.evidence', operator: 'non_empty' },
  ],
})
gateDefs.set('gate-trial-input', {
  on_fail: 'NEEDS_INPUT',
  checks: [
    { path: '$steps.stage-9-input-output.process_record_ref', operator: 'non_empty' },
    { path: '$steps.stage-9-input-output.measurement_record_refs', operator: 'non_empty' },
  ],
})
gateDefs.set('gate-trial-validation', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.stage-10-output.passed', operator: 'truthy' },
    { path: '$steps.stage-10-output.result.status', operator: 'in', value: ['passed', 'needs_revision'] },
    { path: '$steps.stage-10-output.evidence', operator: 'non_empty' },
  ],
})
gateDefs.set('gate-release-decision', {
  on_fail: 'FAIL',
  checks: [
    { path: '$steps.stage-11-output.passed', operator: 'truthy' },
    { path: '$steps.stage-11-output.result.validation_errors', operator: 'eq', value: [] },
  ],
})
gateDefs.set('gate-sop-output', {
  on_fail: 'FAIL',
  checks: [
    { path: '$output.status', operator: 'in', value: ['accepted_for_scale_up', 'needs_revision', 'rejected'] },
    { path: '$output.next_action', operator: 'non_empty' },
  ],
})
