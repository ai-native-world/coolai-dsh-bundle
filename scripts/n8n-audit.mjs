#!/usr/bin/env node
/**
 * n8n 真实执行 → orgos.uc.receipt.v1 投影（只读投影，不做旁路重建）。
 * 用法：
 *   N8N_URL=http://localhost:5678 N8N_API_KEY=... node scripts/n8n-audit.mjs --execution-id <id>
 *   （未设 N8N_API_KEY 时走 N8N_BASIC_AUTH_USER / N8N_BASIC_AUTH_PASSWORD）
 *
 * 依据：GET /api/v1/executions/{id}?includeData=true 返回每个节点的真实 input/output/error。
 * 四问证据链：
 *   1) 谁调用的（invocation.channel/actor，来自 Webhook 输入）
 *   2) 数据从哪来（provenance.read，Webhook 输入 signal）
 *   3) 过了哪些门（gates，AcceptGate 节点真实 gate 结果）
 *   4) 决策记忆（decision_memory，Learn 节点真实输出）
 */
const N8N_URL = (process.env.N8N_URL || 'http://localhost:5678').replace(/\/$/, '')
const N8N_API_KEY = process.env.N8N_API_KEY || ''
const USER = process.env.N8N_BASIC_AUTH_USER || 'admin'
const PASS = process.env.N8N_BASIC_AUTH_PASSWORD || ''

const arg = (flag, envName) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : process.env[envName] || ''
}
const EXECUTION_ID = arg('--execution-id', 'N8N_EXECUTION_ID')

function headers() {
  const h = { 'Content-Type': 'application/json' }
  if (N8N_API_KEY) h['X-N8N-API-KEY'] = N8N_API_KEY
  else if (USER && PASS) h.Authorization = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')
  return h
}

const statusMap = s => ({ success: 'done', waiting: 'wait_human', error: 'failed', running: 'running', canceled: 'canceled' }[s] ?? s)

function nodeJson(nodeRuns, idx = 0) {
  const r = Array.isArray(nodeRuns) ? nodeRuns[idx] : null
  return r?.data?.main?.[0]?.[0]?.json ?? null
}

function nodeError(nodeRuns, idx = 0) {
  const r = Array.isArray(nodeRuns) ? nodeRuns[idx] : null
  if (r?.error) return r.error.message || JSON.stringify(r.error)
  if (r?.executionStatus === 'error') return '节点执行失败'
  return null
}

async function main() {
  if (!EXECUTION_ID) {
    console.error('缺少 --execution-id')
    process.exit(2)
  }
  const url = `${N8N_URL}/api/v1/executions/${EXECUTION_ID}?includeData=true`
  const res = await fetch(url, { headers: headers() })
  if (!res.ok) {
    console.error(`n8n API ${res.status}: ${(await res.text()).slice(0, 300)}`)
    process.exit(3)
  }
  const exec = await res.json()
  const rd = exec.data?.resultData?.runData || {}
  const wf = exec.workflowData || {}

  const webhookInput = nodeJson(rd.Webhook)
  const webhookBody = webhookInput?.body ?? {}
  const learnOut = nodeJson(rd.Learn)
  const acceptOut = nodeJson(rd.AcceptGate)

  // 从 AcceptGate 节点真实输出读取 gate；若该节点抛错，则从 error 还原 fail-closed
  let gates = []
  const gateObj = acceptOut?.gate
  if (gateObj) {
    gates.push({ id: 'execute', scope: 'step', step: 'execute', pass: !!gateObj.pass, signal: gateObj.signal ?? null, fail_reason: gateObj.fail_reason ?? null, rule_id: gateObj.rule_id ?? '?', title: gateObj.title ?? '', constraint: gateObj.constraint ?? '' })
  } else {
    const err = nodeError(rd.AcceptGate)
    if (err) gates.push({ id: 'execute', scope: 'step', step: 'execute', pass: false, signal: err, fail_reason: 'unknown', rule_id: 'T-A1', title: '人审决策合法', constraint: 'status 合法且角色与理由非空' })
  }

  const eventTrail = Object.entries(rd).map(([node, runs]) => {
    const r = Array.isArray(runs) ? runs[runs.length - 1] : null
    const err = nodeError(runs)
    return {
      seq: r?.startTime ?? null,
      ts: r?.startTime ? new Date(r.startTime).toISOString() : null,
      type: r?.executionStatus === 'error' ? 'node_error' : 'node_run',
      node,
      step: node,
      signal: err ?? null,
      pass: r?.executionStatus === 'error' ? false : null,
    }
  })

  const receipt = {
    schema: 'orgos.uc.receipt.v1',
    engine: {
      run_id: exec.id,
      workflow: `${wf.name ?? 'unknown'}@${wf.versionId ?? exec.workflowId ?? '?'}`,
      status: statusMap(exec.status),
      mode: exec.mode ?? null,
    },
    invocation: {
      run_id: exec.id,
      workflow: `${wf.name ?? 'unknown'}@${wf.versionId ?? exec.workflowId ?? '?'}`,
      status: statusMap(exec.status),
      channel: webhookBody?.channel ?? 'unknown',
      actor: webhookBody?.actor ?? 'unknown',
      started_at: exec.startedAt ?? null,
      finished_at: exec.stoppedAt ?? null,
    },
    provenance: {
      read: { signal: webhookBody?.signal ?? webhookInput ?? null },
      write: { output: learnOut?.learning ?? null },
    },
    gates,
    decision_memory: {
      decision: acceptOut?.decision ?? null,
      warning: null,
      learning: learnOut?.learning ?? null,
    },
    event_trail: eventTrail,
  }
  console.log(JSON.stringify(receipt, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
