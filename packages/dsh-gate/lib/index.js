/**
 * 酷爱 bundle · Gate 插件（挂载验证版已升级为 gate 注册表服务）。
 * 提供 ctx.ucGates：register(id, checker) / run(id, gateCtx)。
 * 检查器由实例装配注入；未注册 gate 必须 fail-closed。
 * @module @coolai/dsh-gate
 */

export const name = 'coolai-gate'

/** @type {string[]} */
export const inject = []

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const registry = new Map()
  const defs = new Map()

  const ucGates = {
    defs,
    register(id, checker) {
      if (typeof checker !== 'function') throw new TypeError(`ucGates.register: ${id} 需要函数检查器`)
      registry.set(id, checker)
    },
    registerDefinition(id, definition) {
      if (!definition || !Array.isArray(definition.checks)) throw new TypeError(`ucGates.registerDefinition: ${id} 需要 checks`)
      defs.set(id, structuredClone(definition))
    },
    run(id, gateCtx) {
      const checker = registry.get(id)
      if (!checker) throw new Error(`ucGates: 未注册 gate ${id}`)
      return checker(gateCtx) === true
    },
  }

  // cordis 服务注册必须走 ctx.provide（直接赋值会被拒绝）
  ctx.provide('ucGates', ucGates)
  console.log('[coolai-bundle] @coolai/dsh-gate mounted (fail-closed UC Gate registry)')
}
