/**
 * 框架基线壳：只加载通用 UC 模板（不灌任何具体客户 UC 实例）。
 * 六步环：目标 → 感知 → 决策 → 执行(人审) → 验收 → 学习。
 * 审计回执由引擎事件账本投影生成，不依赖外部旁路。
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/uc-template/workflow.js'
import { gateDefs } from '../instances/uc-template/gates.js'
import { goal, accept, learn } from '../instances/uc-template/functions.js'
import { perceiveModelFn, decideModelFn } from './template-llm.js'
import { createSqliteRunStore } from './store.js'
import { buildReceipt } from './audit.js'
import { notifyMessage } from './connectors.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.COOLAI_DB || join(HERE, 'data', 'framework-runs.db')
const PORT = Number(process.env.PORT || 8787)

const FUNCS = new Map([
  ['template:goal', goal],
  ['template:accept', accept],
  ['template:learn', learn],
])
const store = createSqliteRunStore(DB_PATH)
const dispatchModel = ({ step, input, schema }) => {
  const ref = step.executor?.ref
  if (ref === 'template:perceive-llm') return perceiveModelFn({ input, schema })
  if (ref === 'template:decide-llm') return decideModelFn({ input, schema })
  throw new Error(`未注册的模型执行器: ${ref}`)
}
const engine = new UcWorkflowEngine({
  functions: FUNCS,
  gates: { run: () => true, defs: gateDefs },
  store,
  modelFn: dispatchModel,
})
const PKG = compile(contract, new Set(FUNCS.keys()))
const STEP_NAMES = Object.fromEntries(contract.steps.map(s => [s.id, s.name]))

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(body, null, 2))
}
const readBody = async req => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString() || '{}')
}
const toSignalInput = body => {
  if (body.input && typeof body.input.signal === 'string') return body.input
  if (typeof body.signal === 'string') return { signal: body.signal }
  const text = body.text || body.msg || body.message?.content?.text || body.event?.message?.content?.text || ''
  return { signal: typeof text === 'string' ? text : JSON.stringify(text) }
}
const notifyRun = r => {
  if (r.status === 'wait_human') return notifyMessage('组织OS · 通用 UC 需要人审', `步骤：${r.pending?.stepId ?? '-'}\n请到 http://localhost:${PORT} 提交人工决策。`)
  if (r.status === 'done') return notifyMessage('组织OS · 通用 UC 已完成', `决策：${r.output?.decision?.status ?? '-'}\n学习：${JSON.stringify(r.output?.learning ?? {})}`)
  if (r.status === 'failed') return notifyMessage('组织OS · 通用 UC fail-closed', `code：${r.code}\n原因：${(r.errors || []).join('；')}`)
  return notifyMessage('组织OS · 通用 UC', `状态：${r.status}`)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(readFileSync(join(HERE, 'framework.html'), 'utf8'))
  }
  if (req.method === 'POST' && url.pathname === '/api/run') {
    try {
      const body = await readBody(req)
      const input = toSignalInput(body)
      const r = await engine.execute(PKG, input)
      await store.setMeta(r.runId, { channel: body.channel, actor: body.actor })
      await notifyRun(r)
      const full = await engine.getRun(r.runId)
      const perceived = full.events?.find(e => e.type === 'step_output' && e.step === 'perceive')?.output?.result
      return json(res, 200, {
        runId: r.runId, status: r.status, code: r.code, errors: r.errors,
        output: r.output, events: r.events, steps: STEP_NAMES,
        parsed: perceived?.fields ?? {}, receipt: await buildReceipt(full, await store.getMeta(r.runId), gateDefs),
      })
    } catch (e) { return json(res, 400, { error: e.message }) }
  }
  if (req.method === 'POST' && url.pathname === '/api/resume') {
    try {
      const { runId, response } = await readBody(req)
      const r = await engine.resume(runId, response)
      await notifyRun(r)
      const full = await engine.getRun(r.runId)
      return json(res, 200, { runId: r.runId, status: r.status, code: r.code, errors: r.errors, output: r.output, events: r.events, steps: STEP_NAMES, receipt: await buildReceipt(full, await store.getMeta(r.runId), gateDefs) })
    } catch (e) { return json(res, 400, { error: e.message }) }
  }
  if (req.method === 'GET' && url.pathname === '/api/receipt') {
    const run = await engine.getRun(url.searchParams.get('id'))
    if (!run) return json(res, 404, { error: 'run not found' })
    return json(res, 200, await buildReceipt(run, await store.getMeta(run.runId), gateDefs))
  }
  if (req.method === 'GET' && url.pathname === '/api/runs') {
    const runs = await engine.listRuns()
    return json(res, 200, runs.map(({ runId, workflowId, workflowVersion, status, createdAt, updatedAt, pending, output }) => ({
      runId, workflowId, workflowVersion, status, createdAt, updatedAt, pending, output,
    })))
  }
  if (req.method === 'GET' && url.pathname === '/api/run') {
    const r = await engine.getRun(url.searchParams.get('id'))
    return json(res, r ? 200 : 404, r || { error: 'run not found' })
  }
  json(res, 404, { error: 'not found' })
})

server.listen(PORT, () => console.log(`[framework] http://localhost:${PORT} db=${DB_PATH}`))
