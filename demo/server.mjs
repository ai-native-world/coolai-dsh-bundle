/**
 * 临时演示壳：把 UC36 暴露成 HTTP 接口 + 一个产品化页面。
 * 六步环：目标 → 感知 → 决策 → 执行(人审) → 验收(Gate) → 学习。
 * 已接：SQLite 真持久化 RunStore（node:sqlite）+ 可插拔通知连接器（飞书/钉钉/企微 webhook、lark-cli）。
 * 感知层用“信号解析表”做确定性抽取（会议口径：感知=一张表/一个文件，不建模块）。
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/yili-uc36-supply-visibility/workflow.js'
import { gateDefs } from '../instances/yili-uc36-supply-visibility/gates.js'
import { goal, perceive, decide, accept, learn } from '../instances/yili-uc36-supply-visibility/functions.js'
import { createSqliteRunStore } from './store.js'
import { notifyRun } from './connectors.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.COOLAI_DB || join(HERE, 'data', 'uc-runs.db')
const FUNCS = new Map([
  ['uc36:goal', goal],
  ['uc36:perceive', perceive],
  ['uc36:decide', decide],
  ['uc36:accept', accept],
  ['uc36:learn', learn],
])
const store = createSqliteRunStore(DB_PATH)
const engine = new UcWorkflowEngine({ functions: FUNCS, gates: { run: () => true, defs: gateDefs }, store })
const PKG = compile(contract, new Set(FUNCS.keys()))
const STEP_NAMES = Object.fromEntries(contract.steps.map(s => [s.id, s.name]))
const PORT = Number(process.env.PORT || 8787)

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
  // 兼容飞书/通用事件入口：从文本里取自然语言信号
  const text = body.text || body.msg || body.message?.content?.text || body.event?.message?.content?.text || ''
  return { signal: typeof text === 'string' ? text : JSON.stringify(text) }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(readFileSync(join(HERE, 'index.html'), 'utf8'))
  }
  if (req.method === 'POST' && url.pathname === '/api/run') {
    try {
      const body = await readBody(req)
      const input = toSignalInput(body)
      const r = await engine.execute(PKG, input)
      const parsed = perceive(input)
      await notifyRun(r)
      return json(res, 200, {
        runId: r.runId, status: r.status, code: r.code, errors: r.errors,
        output: r.output, events: r.events, steps: STEP_NAMES,
        parsed: parsed.result.fields, missing: parsed.result.missing ?? [],
      })
    } catch (e) { return json(res, 400, { error: e.message }) }
  }
  if (req.method === 'POST' && url.pathname === '/api/ingest') {
    try {
      const body = await readBody(req)
      const input = toSignalInput(body)
      const r = await engine.execute(PKG, input)
      const parsed = perceive(input)
      await notifyRun(r)
      return json(res, 200, { runId: r.runId, status: r.status, code: r.code, steps: STEP_NAMES, missing: parsed.result.missing ?? [] })
    } catch (e) { return json(res, 400, { error: e.message }) }
  }
  if (req.method === 'POST' && url.pathname === '/api/resume') {
    try {
      const { runId, response } = await readBody(req)
      const r = await engine.resume(runId, response)
      await notifyRun(r)
      return json(res, 200, { runId: r.runId, status: r.status, code: r.code, errors: r.errors, output: r.output, events: r.events, steps: STEP_NAMES })
    } catch (e) { return json(res, 400, { error: e.message }) }
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

server.listen(PORT, () => console.log(`[demo] http://localhost:${PORT} db=${DB_PATH}`))
