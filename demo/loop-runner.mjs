/**
 * Loop 演示（真实引擎 + 真实 loop-policy 笼子，mock Agent 只负责提出动作）。
 *
 * 目的：给「验收 Gate 失败 → 结构化 fail_reason → 政策授权 → 下一轮」一个可感知的
 * 真实运行。Agent 是确定性 mock（不引入 LLM 非确定性），每轮都走真实 engine 并投影
 * receipt；笼子 enforceAction 每轮真实拦截。
 *
 * 用法：node demo/loop-runner.mjs
 */
import { readFileSync } from 'node:fs'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { UcWorkflowEngine, MemoryRunStore } from '../packages/dsh-uc-workflow/lib/engine.js'
import { contract } from '../instances/uc-template/workflow.js'
import { gateDefs } from '../instances/uc-template/gates.js'
import { goal, accept, learn } from '../instances/uc-template/functions.js'
import { buildReceipt } from './audit.js'
import { enforceAction } from '../packages/dsh-uc-workflow/lib/loop-policy.js'

const policy = JSON.parse(readFileSync(new URL('../instances/uc-template/loop.policy.json', import.meta.url), 'utf8'))
// 演示用：给 enrich_context 白名单放一个实例数据源（通用底座默认空 = fail-closed）
policy.permissions.enrich_context.allowed_sources = ['mes.line_params', 'erp.purchase_budget']

// 让模型行为随 signal 变化：模拟「补数据后感知通过、换策略后决策通过」
function makeEngine(signalRef) {
  const funcs = new Map([['template:goal', goal], ['template:accept', accept], ['template:learn', learn]])
  return new UcWorkflowEngine({
    functions: funcs,
    gates: { run: () => true, defs: gateDefs },
    store: new MemoryRunStore(),
    modelFn: ({ step }) => {
      const r = step.executor?.ref
      if (r === 'template:perceive-llm') {
        if (!signalRef.signal.includes('data:complete')) {
          return { passed: false, result: {}, evidence: ['感知失败'], uncertainties: ['缺设备参数/原料批次'] }
        }
        return { passed: true, result: { fields: { summary: '已补齐设备参数与原料批次' } }, evidence: ['感知'], uncertainties: [] }
      }
      if (r === 'template:decide-llm') {
        if (!signalRef.signal.includes('strategy:replan')) {
          return { passed: false, result: {}, evidence: ['决策失败'], uncertainties: ['方案不可执行'] }
        }
        return { passed: true, result: { recommendation: { action: '按补齐的数据给出针对性处置' } }, evidence: ['决策'], uncertainties: [] }
      }
      throw new Error(`未注册模型: ${r}`)
    },
  })
}

// 确定性 mock Agent：只按政策表选第一个允许的动作
function mockAgent(failReason) {
  if (failReason === 'missing_field') return { action: 'enrich_context', reason: 'missing_field', targets: ['mes.line_params'] }
  if (failReason === 'action_not_executable') return { action: 'replan', reason: 'action_not_executable', instruction: '换策略：给出可执行且带数据支撑的方案' }
  return { action: 'escalate', reason: failReason, detail: `mock agent 无法自动修复 ${failReason}` }
}

// 把动作落到下一轮输入（mock「真的补了/真的换了」，生产里这里是调连接器）
function applyAction(signal, action) {
  if (action.action === 'enrich_context') return `${signal} | data:complete`
  if (action.action === 'replan') return `${signal} | strategy:replan`
  return signal
}

const original = '乐饮江苏工厂 3 号线出品率 82.1%，低于 85% 阈值'
console.log('=== Loop 演示：Gate 失败 → 结构化 reason → 政策授权 → 下一轮 ===')
console.log(`原始信号: ${original}\n`)

let signal = original
const signalRef = { signal }
const engine = makeEngine(signalRef)
const pkg = compile(contract, new Set(['template:goal', 'template:accept', 'template:learn']))

for (let round = 0; round <= policy.max_rounds; round++) {
  signalRef.signal = signal
  const r = await engine.execute(pkg, { signal })

  // 到达人审 → 合法拍板 → 完成
  if (r.status === 'wait_human') {
    const done = await engine.resume(r.runId, { actor_role: '厂务负责人', status: 'approved', rationale: '数据与方案到位，同意执行' })
    const receipt = buildReceipt(await engine.getRun(r.runId), { channel: 'feishu', actor: 'cao-tianhang' }, gateDefs)
    console.log(`[第 ${round + 1} 轮] ${r.runId}`)
    console.log(`  状态: ${done.status}`)
    console.log(`  人审: ${done.output?.decision?.status}，学习: ${done.output?.learning?.outcome}`)
    console.log(`  最终 Gate: ${receipt.gates.map(g => `${g.id}=${g.pass}`).join(', ')}`)
    break
  }

  // 失败 → 读结构化 reason → Agent 提动作 → 笼子授权
  if (r.status === 'failed') {
    const failReason = r.failReason ?? 'unknown'
    const proposed = mockAgent(failReason)
    const enforced = enforceAction(proposed, { roundsUsed: round, policy })
    console.log(`[第 ${round + 1} 轮] ${r.runId}`)
    console.log(`  状态: failed | Gate 失败原因: ${failReason}`)
    console.log(`  政策允许: [${(policy.reason_action_map[failReason] ?? []).join(', ')}]`)
    console.log(`  Agent 提出: ${proposed.action}`)
    console.log(`  笼子判定: ${enforced.ok ? '放行' : `拒绝 → ${enforced.decision.action}/${enforced.decision.reason}`}${enforced.errors.length ? '（' + enforced.errors.join('; ') + '）' : ''}`)

    if (enforced.ok && ['enrich_context', 'replan'].includes(enforced.decision.action)) {
      signal = applyAction(signal, enforced.decision)
      console.log(`  新信号: ${signal}\n`)
      continue
    }
    console.log(`\n  loop 终止：${enforced.decision.action} / ${enforced.decision.reason}`)
    break
  }

  console.log(`[第 ${round + 1} 轮] 意外状态: ${r.status}`)
  break
}

console.log(`\n（max_rounds=${policy.max_rounds}；白名单=${JSON.stringify(policy.permissions.enrich_context.allowed_sources)}）`)
