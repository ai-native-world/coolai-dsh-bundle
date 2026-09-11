/**
 * 临时壳 · 四问审计回执（工作流无关）。
 * 1) 调用凭据 invocation：谁、从哪个入口、何时发起/结束
 * 2) 数据溯源 provenance：读了什么、写了什么
 * 3) Gate 映射 gates：过了哪个 Gate、对应决策规则库哪条
 * 4) 决策记忆 decision_memory：这次决策沉淀/回写了什么
 */
const GATE_RULE_MAP = {
  'gate-goal': { rule_id: 'R-UC36-G1', title: '目标与门槛锁定', constraint: '预测准确率≥70% / 保供KPI>95%' },
  'gate-perceive': { rule_id: 'R-UC36-D35', title: '感知字段完整性', constraint: '关键字段缺失即 fail-closed 拦截' },
  'gate-decide': { rule_id: 'R-UC36-R47', title: '决策阈值判定', constraint: '低于70%触发复盘，触发/升级结论由硬规则决定' },
  'gate-execute': { rule_id: 'R-UC36-A2', title: '执行人审权限', constraint: '供应链/商务 A2 人审拍板，不自动完成' },
  'gate-accept': { rule_id: 'R-UC36-G2', title: '验收校验', constraint: '目标、门槛、决策合法性' },
  'gate-learn': { rule_id: 'R-UC36-L1', title: '学习沉淀', constraint: '复盘规则引用回写' },
  'gate-output': { rule_id: 'R-UC36-G3', title: '输出契约校验', constraint: '输出字段必须满足 outputSchema' },
}

export function buildReceipt(run, meta = {}) {
  const events = run.events || []
  const stepOutputs = {}
  for (const e of events) if (e.type === 'step_output') stepOutputs[e.step] = e.output

  const perceived = stepOutputs.perceive?.result?.fields ?? {}
  const gates = events
    .filter(e => e.type === 'gate')
    .map(e => {
      const m = GATE_RULE_MAP[e.gate] || { rule_id: '?', title: '', constraint: '' }
      return { id: e.gate, scope: e.scope ?? '-', step: e.step ?? '-', pass: !!e.pass, ...m }
    })

  return {
    schema: 'orgos.uc.receipt.v1',
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
  }
}
