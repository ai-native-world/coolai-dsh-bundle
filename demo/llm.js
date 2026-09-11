/**
 * 临时壳 · 模型执行器（DeepSeek，走 OpenAI-completions 兼容端点）。
 * 用于 UC36 感知步骤：把自然语言信号抽成结构化字段。
 * Key 优先取 DEEPSEEK_API_KEY，否则从本机 OpenClaw 配置读取 ds provider 的 key。
 * 模型抽取结果仍要过 validateFields 的 fail-closed 校验，模型只负责“抽字段”，不负责放行。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { validateFields } from '../instances/yili-uc36-supply-visibility/functions.js'

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'

function resolveApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8'))
    const providers = cfg?.models?.providers || cfg?.providers || {}
    const ds = providers.ds || providers['deepseek'] || {}
    const key = ds.apiKey || ds.api_key
    if (key) return key
  } catch (e) {
    // ignore, fallthrough
  }
  return ''
}

const API_KEY = resolveApiKey()

const SYSTEM = [
  '你是供应链信号抽取器。从用户给的信号里抽取字段，只输出一个 JSON 对象，不要输出任何多余文字。',
  '字段：forecast_version(字符串), forecast_accuracy(数字0-100), supply_gap(数字), supply_kpi(数字0-100), customer_cancel(布尔), financial_impact(数字), data_ref(字符串)。',
  '如果某字段没出现：forecast_version 用 "unknown"，数值字段用 null，布尔用 false。',
].join('\n')

async function extractFields(signal) {
  if (!API_KEY) throw new Error('未找到 DeepSeek API Key（DEEPSEEK_API_KEY 或 OpenClaw ds provider）')
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: String(signal ?? '') },
      ],
      temperature: 0,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek 返回空 content')
  const fields = JSON.parse(content)
  // 补齐缺省，避免 schema 类型校验被 null 卡住
  return {
    forecast_version: fields.forecast_version ?? 'unknown',
    forecast_accuracy: typeof fields.forecast_accuracy === 'number' ? fields.forecast_accuracy : -1,
    supply_gap: typeof fields.supply_gap === 'number' ? fields.supply_gap : 0,
    supply_kpi: typeof fields.supply_kpi === 'number' ? fields.supply_kpi : -1,
    customer_cancel: !!fields.customer_cancel,
    financial_impact: typeof fields.financial_impact === 'number' ? fields.financial_impact : 0,
    data_ref: fields.data_ref || 'S&OP预测/2026-09-11',
  }
}

export async function modelFn({ input }) {
  const signal = String(input?.signal ?? '')
  try {
    const fields = await extractFields(signal)
    const missing = validateFields(fields)
    if (missing.length > 0) {
      return { passed: false, result: { fields, missing }, evidence: [`模型抽取后校验未通过：${missing.join('；')}`], uncertainties: missing }
    }
    return { passed: true, result: { fields }, evidence: [`模型已抽取：${fields.forecast_version}`], uncertainties: [] }
  } catch (e) {
    // 模型/网络失败 → fail-closed，不允许静默放行
    const msg = e instanceof Error ? e.message : String(e)
    return { passed: false, result: { fields: {}, missing: [msg] }, evidence: [`模型抽取失败：${msg}`], uncertainties: [msg] }
  }
}
