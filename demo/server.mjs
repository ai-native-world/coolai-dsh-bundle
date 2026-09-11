/**
 * 临时演示壳：把 UC36 暴露成 HTTP 接口 + 一个产品化页面。
 * 感知层用一张“信号解析表”做确定性抽取（会议口径：感知=一张表/一个文件，不建模块）。
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

/** 感知=一张表：从自然语言信号里确定性抽取字段，抽不到就给默认值并进入后续 fail-closed。 */
function parseSignal(signal) {
  const num = re => { const m = String(signal).match(re); return m ? Number(m[1]) : undefined }
  const txt = re => { const m = String(signal).match(re); return m ? m[1].trim() : undefined }
  return {
    forecast_version: txt(/预测版本\s*[:：]?\s*([A-Za-z0-9\-._/]+)/) || 'unknown',
    forecast_accuracy: num(/预测准确率\s*[:：]?\s*(\d+(?:\.\d+)?)/) ?? -1,
    supply_gap: num(/供应缺口\s*[:：]?\s*(-?\d+(?:\.\d+)?)/) ?? 0,
    supply_kpi: num(/保供KPI\s*[:：]?\s*(\d+(?:\.\d+)?)/) ?? -1,
    customer_cancel: /取消订单\s*[:：]?\s*(是|有|true|存在)/i.test(String(signal)),
    financial_impact: num(/财务影响\s*[:：]?\s*(-?\d+(?:\.\d+)?)/) ?? 0,
    data_ref: txt(/数据来源\s*[:：]?\s*([^\n,，]+)/) || 'S&OP预测/2026-09-11',
  }
}

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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(readFileSync(join(HERE, 'index.html'), 'utf8'))
  }
  if (req.method === 'POST' && url.pathname === '/api/run') {
    try {
      const body = await readBody(req)
      const input = body.input ?? parseSignal(body.signal ?? '')
      const r = await engine.execute(PKG, input)
      return json(res, 200, { runId: r.runId, status: r.status, output: r.output, events: r.events, steps: STEP_NAMES, parsed: input })
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
    const r = await engine.getRun(url.searchParams.get('id'))
    return json(res, r ? 200 : 404, r || { error: 'run not found' })
  }
  json(res, 404, { error: 'not found' })
})

server.listen(PORT, () => console.log(`[demo] http://localhost:${PORT}`))
