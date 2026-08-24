/**
 * 酷爱 bundle · 确定性 UC 工作流引擎（cordis 插件入口）。
 * 注册 ctx.ucWorkflow 服务：registerFunction + defineWorkflow + execute。
 * 依赖注入：ucGates（coolai-gate 注册表）；modelFn 由实例装配时通过
 * registerModelFn 注入（D4 接 dsh llm），事件流在 engine 内收集（session 集成 D6）。
 * @module @coolai/dsh-uc-workflow
 */

import { UcWorkflowEngine } from './engine.js'

export const name = 'coolai-uc-workflow'

/** @type {string[]} */
export const inject = ['ucGates']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const engine = new UcWorkflowEngine({
    gates: ctx.ucGates,
    modelFn: null, // 实例装配时 registerModelFn 注入（D4）
    record: () => {}, // engine 内部 events 已收集；session 事件流 D6 接入
  })

  ctx.provide('ucWorkflow', {
    registerFunction: (ref, fn) => engine.registerFunction(ref, fn),
    registerModelFn: fn => engine.setModelFn(fn),
    defineWorkflow: contract => engine.defineWorkflow(contract),
    execute: (pkg, input) => engine.execute(pkg, input),
  })

  console.log('[coolai-bundle] @coolai/dsh-uc-workflow mounted (deterministic UC engine)')
}
