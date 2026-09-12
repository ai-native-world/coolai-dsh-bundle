/**
 * 审计回执（orgos.uc.receipt.v1）。
 * 这是引擎内部事件账本的“只读投影”，不是外部旁路重建：
 * 每个 step_start / step_output / gate / step_end / run_* 都由 UcWorkflowEngine
 * 在真实执行时同步写入 run.events；这里只做投影与规则元数据补充。
 * 规则元数据来自 gateDefs（rule_id/title/constraint），不写死任何 UC 业务字段。
 */
export function buildReceipt(run, meta = {}, gateDefs = new Map()) {
  const events = run.events || []
  const stepOutputs = {}
  for (const e of events) if (e.type === 'step_output') stepOutputs[e.step] = e.output

  const gateMeta = gid => {
    const g = gateDefs.get(gid) || {}
    return {
      rule_id: g.rule_id ?? '?',
      title: g.title ?? '',
      constraint: g.constraint ?? '',
    }
  }

  const gates = events
    .filter(e => e.type === 'gate')
    .map(e => ({ id: e.gate, scope: e.scope ?? '-', step: e.step ?? '-', pass: !!e.pass, signal: e.signal ?? null, ...gateMeta(e.gate) }))

  const perceived = stepOutputs.perceive?.result?.fields ?? stepOutputs.perceive?.result ?? {}

  return {
    schema: 'orgos.uc.receipt.v1',
    engine: { run_id: run.runId, workflow: `${run.workflowId}@${run.workflowVersion}`, status: run.status },
    invocation: {
      run_id: run.runId,
      workflow: `${run.workflowId}@${run.workflowVersion}`,
      status: run.status,
      channel: meta.channel ?? 'unknown',
      actor: meta.actor ?? 'unknown',
      started_at: run.createdAt,
      finished_at: run.updatedAt,
    },
    provenance: {
      read: { signal: run.input?.signal ?? null, fields: perceived },
      write: { output: run.output ?? null },
    },
    gates,
    decision_memory: {
      decision: run.output?.decision ?? null,
      warning: run.output?.warning ?? null,
      learning: run.output?.learning ?? null,
    },
    event_trail: events.map(e => ({ seq: e.seq, ts: e.ts, type: e.type, step: e.step ?? null, gate: e.gate ?? null, pass: e.pass ?? null, signal: e.signal ?? null })),
  }
}
