/**
 * 临时壳 · 模型执行器（DeepSeek，走 OpenAI-completions 兼容端点）。
 * perceiveModelFn：自然语言信号 → 结构化字段；decideModelFn：字段 → 影响测算/预案建议。
 * 硬阈值（70%/95%/触发/A2-A3）由 buildWarning 确定性计算，模型只丰富测算文案，不能改触发结论。
 * Key 优先取 DEEPSEEK_API_KEY，否则从本机 OpenClaw 配置读取 ds provider 的 key。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { validateFields, buildWarning } from '../instances/yili-uc36-supply-visibility/functions.js'

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
    // ignore
  }
  return ''
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
      max_tokens: 1500,
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
  '你是供应链信号抽取器。从用户给的信号里抽取字段，只输出一个 JSON 对象，不要输出任何多余文字。',
  '字段：forecast_version(字符串), forecast_accuracy(数字0-100), supply_gap(数字), supply_kpi(数字0-100), customer_cancel(布尔), financial_impact(数字), data_ref(字符串)。',
  '如果某字段没出现：forecast_version 用 "unknown"，数值字段用 null，布尔用 false。',
].join('\n')

export async function perceiveModelFn({ input }) {
  const signal = String(input?.signal ?? '')
  try {
    const fields = await callDeepSeek(PERCEIVE_SYSTEM, signal)
    const normalized = {
      forecast_version: fields.forecast_version ?? 'unknown',
      forecast_accuracy: typeof fields.forecast_accuracy === 'number' ? fields.forecast_accuracy : -1,
      supply_gap: typeof fields.supply_gap === 'number' ? fields.supply_gap : 0,
      supply_kpi: typeof fields.supply_kpi === 'number' ? fields.supply_kpi : -1,
      customer_cancel: !!fields.customer_cancel,
      financial_impact: typeof fields.financial_impact === 'number' ? fields.financial_impact : 0,
      data_ref: fields.data_ref || 'S&OP预测/2026-09-11',
    }
    const missing = validateFields(normalized)
    if (missing.length > 0) {
      return { passed: false, result: { fields: normalized, missing }, evidence: [`模型抽取后校验未通过：${missing.join('；')}`], uncertainties: missing }
    }
    return { passed: true, result: { fields: normalized }, evidence: [`模型已抽取：${normalized.forecast_version}`], uncertainties: [] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { passed: false, result: { fields: {}, missing: [msg] }, evidence: [`模型抽取失败：${msg}`], uncertainties: [msg] }
  }
}

const DECIDE_SYSTEM = [
  '你是供应链计划员。基于给定的结构化字段，输出影响测算与预案建议，只输出 JSON 对象。',
  '字段：forecast_version, forecast_accuracy(预测准确率), supply_gap(供应缺口，负=缺口), supply_kpi(保供KPI), customer_cancel(是否客户取消订单), financial_impact(财务影响), data_ref。',
  '输出格式：{"analysis":"一段话影响测算","measures":["预案建议1","预案建议2"]}。',
  '只做测算和建议，不要改任何阈值或触发结论。',
].join('\n')

export async function decideModelFn({ input }) {
  const fields = input?.fields || {}
  const warning = buildWarning(fields) // 硬规则先算，fail-closed 不受模型影响
  try {
    const advice = await callDeepSeek(DECIDE_SYSTEM, JSON.stringify(fields))
    const enriched = {
      ...warning,
      analysis: typeof advice.analysis === 'string' ? advice.analysis : '',
      measures: Array.isArray(advice.measures) ? advice.measures : [],
    }
    const recommendation = {
      action: warning.triggered ? '预警并测算影响' : '无需干预',
      escalate: warning.forecast_review_required ? 'A2' : 'A3',
      measures: enriched.measures,
    }
    return { passed: true, result: { warning: enriched, recommendation }, evidence: ['模型已生成影响测算与预案建议'], uncertainties: [] }
  } catch (e) {
    // 模型失败 → 退化为规则测算，但触发结论仍是硬规则，不静默放行
    const msg = e instanceof Error ? e.message : String(e)
    return {
      passed: true,
      result: {
        warning: { ...warning, analysis: '', measures: [] },
        recommendation: { action: warning.triggered ? '预警并测算影响' : '无需干预', escalate: warning.forecast_review_required ? 'A2' : 'A3', measures: [] },
      },
      evidence: [`模型测算失败（已退化为规则测算）：${msg}`],
      uncertainties: [msg],
    }
  }
}
