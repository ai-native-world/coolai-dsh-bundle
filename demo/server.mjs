/**
 * 临时演示壳：把 UC36 暴露成 3 个 HTTP 接口 + 一个静态页面。
 * 纯 Node 内置 http，不引入额外依赖；临时验证用，跑通后按需换正式壳。
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/yili-uc36-supply-visibility/workflow.js'
import { gateDefs } from '../instances/yili-uc36-supply-visibility/gates.js'
import { parse, assess, finalize } from '../instances/yili-uc36-supply-visibility/functions.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FUNCS = new Map([
  ['uc36:parse', parse],
  ['uc36:assess', assess],
  ['uc36:finalize', finalize],
])
const engine = new UcWorkflowEngine({ functions: FUNCS, gates: { run: () => true, defs: gateDefs } })
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = readFileSync(join(HERE, 'index.html'), 'utf8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(html)
  }
  if (req.method === 'POST' && url.pathname === '/api/run') {
    try {
      const { input } = await readBody(req)
      const r = await engine.execute(PKG, input)
      return json(res, 200, { runId: r.runId, status: r.status, output: r.output, events: r.events, steps: STEP_NAMES })
    } catch (e) { return json(res, 400, { error: e.message }) }
  }
  if (req.method === 'POST' && url.pathname === '/api/resume') {
    try {
      const { runId, response } = await readBody(req)
      const r = await engine.resume(runId, response)
      return json(res, 200, { runId: r.runId, status: r.status, output: r.output, events: r.events, steps: STEP_NAMES })
    } catch (e) { return json(res, 400, { error: e.message }) }
  }
  if (req.method === 'GET' && url.pathname === '/api/run') {
    const runId = url.searchParams.get('id')
    const r = await engine.getRun(runId)
    return json(res, r ? 200 : 404, r || { error: 'run not found' })
  }
  json(res, 404, { error: 'not found' })
})

server.listen(PORT, () => console.log(`[demo] http://localhost:${PORT}`))
