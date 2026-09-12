/**
 * 通用 UC 模板 · 模型执行器（DeepSeek）。
 * perceive：自然语言信号 → 任意结构化 facts；decide：facts → recommendation。
 * 这里不写任何客户业务字段，只保证 fail-closed：模型失败返回 passed=false。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'

function resolveApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8'))
    const providers = cfg?.models?.providers || cfg?.providers || {}
    const ds = providers.ds || providers['deepseek'] || {}
    return ds.apiKey || ds.api_key || ''
  } catch { return '' }
}

const API_KEY = resolveApiKey()

async function callDeepSeek(system, user) {
  if (!API_KEY) throw new Error('未找到 DeepSeek API Key（DEEPSEEK_API_KEY 或 OpenClaw ds provider）')
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek 返回空 content')
  return JSON.parse(content)
}

const PERCEIVE_SYSTEM = [
  '你是通用 UC 的感知节点。从用户信号中抽取结构化事实，只输出 JSON 对象。',
  '输出格式：{"fields":{"summary":"一句话概括","entities":[],"facts":{}}}，可依据信号任意扩展 fields，但必须是 JSON 对象。',
].join('\n')

export async function perceiveModelFn({ input }) {
  const signal = String(input?.signal ?? '')
  try {
    const data = await callDeepSeek(PERCEIVE_SYSTEM, signal)
    const fields = data?.fields && typeof data.fields === 'object' && !Array.isArray(data.fields) ? data.fields : { raw: data }
    return { passed: true, result: { fields }, evidence: ['模型已抽取结构化事实'], uncertainties: [] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { passed: false, result: { fields: {} }, evidence: [`感知模型失败：${msg}`], uncertainties: [msg] }
  }
}

const DECIDE_SYSTEM = [
  '你是通用 UC 的决策节点。基于感知到的结构化事实，给出行动建议与理由，只输出 JSON 对象。',
  '输出格式：{"action":"建议动作","rationale":"理由","risks":[]}。不要编造事实。',
].join('\n')

export async function decideModelFn({ input }) {
  const fields = input?.fields || {}
  try {
    const data = await callDeepSeek(DECIDE_SYSTEM, JSON.stringify(fields))
    const recommendation = {
      action: typeof data?.action === 'string' ? data.action : '责任人判断',
      rationale: typeof data?.rationale === 'string' ? data.rationale : '',
      risks: Array.isArray(data?.risks) ? data.risks : [],
    }
    return { passed: true, result: { recommendation }, evidence: ['模型已生成行动建议'], uncertainties: [] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { passed: false, result: { recommendation: { action: '', rationale: '', risks: [] } }, evidence: [`决策模型失败：${msg}`], uncertainties: [msg] }
  }
}
