/**
 * 临时壳 · 可插拔连接器（通知通道）：钩子不怕多，有现成轮子就用现成轮子。
 * 飞书/钉钉/企微群机器人走 webhook；飞书 bot 直发走 lark-cli（飞书官方 CLI 轮子）。
 * 目标通过环境变量配置；未配置或 DRY_RUN=1 时只落 stdout，不产生外部副作用。
 */
import { spawnSync } from 'node:child_process'

const DRY_RUN = process.env.NOTIFY_DRY_RUN === '1'

async function postWebhook(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`)
}

function feishuWebhook(url, title, text) {
  return postWebhook(url, { msg_type: 'text', content: { text: `${title}\n${text}` } })
}
function dingtalkWebhook(url, title, text) {
  return postWebhook(url, { msgtype: 'text', text: { content: `${title}\n${text}` } })
}
function wecomWebhook(url, title, text) {
  return postWebhook(url, { msgtype: 'text', text: { content: `${title}\n${text}` } })
}
function larkBot(chatId, title, text) {
  const r = spawnSync('lark-cli', ['im', '+messages-send', '--as', 'bot', '--chat-id', chatId, '--text', `${title}\n${text}`], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`lark-cli send 失败: ${r.stderr || r.stdout}`)
}

const CHANNELS = {
  feishu_webhook: {
    enabled: () => !!process.env.FEISHU_WEBHOOK,
    send: (t, x) => feishuWebhook(process.env.FEISHU_WEBHOOK, t, x),
  },
  dingtalk_webhook: {
    enabled: () => !!process.env.DINGTALK_WEBHOOK,
    send: (t, x) => dingtalkWebhook(process.env.DINGTALK_WEBHOOK, t, x),
  },
  wecom_webhook: {
    enabled: () => !!process.env.WECOM_WEBHOOK,
    send: (t, x) => wecomWebhook(process.env.WECOM_WEBHOOK, t, x),
  },
  lark_bot: {
    enabled: () => !!process.env.LARK_CHAT_ID,
    send: (t, x) => larkBot(process.env.LARK_CHAT_ID, t, x),
  },
}

export function summarizeRun(r) {
  const o = r.output || {}
  if (r.status === 'wait_human') {
    const pendingStep = r.pending?.step ?? r.events?.find(e => e.type === 'run_pending')?.step
    return { title: '组织OS · UC36 需要人审', text: `步骤：${pendingStep}\n请到 http://localhost:8787 提交人工决策。` }
  }
  if (r.status === 'done') {
    return {
      title: '组织OS · UC36 已完成',
      text: `决策：${o.decision?.status}\n预警：${o.warning?.triggered ? '触发' : '无'}\n规则：${(o.learning?.rules_applied || []).join(',') || '无'}`,
    }
  }
  if (r.status === 'failed') {
    return {
      title: '组织OS · UC36 fail-closed',
      text: `code：${r.code}\n原因：${(r.errors || []).join('；')}`,
    }
  }
  return { title: '组织OS · UC36', text: `状态：${r.status}` }
}

export async function notifyMessage(title, text) {
  const active = Object.entries(CHANNELS).filter(([, c]) => c.enabled())
  if (DRY_RUN) {
    console.log(`[notify:dry-run] ${title} | 通道=${active.map(([k]) => k).join(',') || 'none'} | ${text.replace(/\n/g, ' | ')}`)
    return
  }
  if (active.length === 0) {
    console.log(`[notify:stdout] ${title}\n${text}`)
    return
  }
  for (const [name, ch] of active) {
    try { await ch.send(title, text) }
    catch (e) { console.error(`[notify:error] ${name}: ${e.message}`) }
  }
}

export async function notifyRun(r) {
  const { title, text } = summarizeRun(r)
  return notifyMessage(title, text)
}
