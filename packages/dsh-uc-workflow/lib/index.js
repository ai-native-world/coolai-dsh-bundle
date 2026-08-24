/**
 * 酷爱 bundle · 确定性 UC 工作流引擎（cordis 插件入口）。
 * 注册 ctx.ucWorkflow 服务：合同注册、执行、同 Run 恢复与持久运行查询。
 * 依赖注入：ucGates（coolai-gate 注册表）；modelFn 由实例装配时通过
 * registerModelFn 注入（D4 接 dsh llm），事件流在 engine 内收集（session 集成 D6）。
 * @module @coolai/dsh-uc-workflow
 */

import { UcWorkflowEngine } from './engine.js'
import { createDshRunStore } from './dsh-store.js'

export const name = 'coolai-uc-workflow'

/** @type {string[]} */
export const inject = ['ucGates', 'storageDomain']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export async function apply(ctx) {
  const durable = await createDshRunStore(ctx.storageDomain)
  ctx.effect(() => durable.close)
  const engine = new UcWorkflowEngine({
    gates: ctx.ucGates,
    store: durable.store,
    modelFn: null, // 实例装配时 registerModelFn 注入（D4）
    record: () => {}, // engine 内部 events 已收集；session 事件流 D6 接入
  })

  ctx.provide('ucWorkflow', {
    registerFunction: (ref, fn) => engine.registerFunction(ref, fn),
    registerModelFn: fn => engine.setModelFn(fn),
    defineWorkflow: contract => engine.defineWorkflow(contract),
    registerWorkflow: pkg => engine.registerWorkflow(pkg),
    execute: (pkg, input) => engine.execute(pkg, input),
    resume: (runId, response) => engine.resume(runId, response),
    getRun: runId => engine.getRun(runId),
    listRuns: () => engine.listRuns(),
  })

  console.log('[coolai-bundle] @coolai/dsh-uc-workflow mounted (durable deterministic UC engine)')
}
