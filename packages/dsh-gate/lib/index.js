/**
 * 酷爱 bundle · Gate 插件（挂载验证版已升级为 gate 注册表服务）。
 * 提供 ctx.ucGates：register(id, checker) / run(id, gateCtx)。
 * 检查器由实例装配注入（乐饮：gate-margin-floor）；未注册 gate 默认放行并告警。
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

  const ucGates = {
    register(id, checker) {
      if (typeof checker !== 'function') throw new TypeError(`ucGates.register: ${id} 需要函数检查器`)
      registry.set(id, checker)
    },
    run(id, gateCtx) {
      const checker = registry.get(id)
      if (!checker) {
        console.warn(`[coolai-bundle] ucGates: 未注册 gate ${id}，默认放行`)
        return true
      }
      return checker(gateCtx) === true
    },
  }

  // cordis 服务注册必须走 ctx.provide（直接赋值会被拒绝）
  ctx.provide('ucGates', ucGates)
  console.log('[coolai-bundle] @coolai/dsh-gate mounted (ucGates registry, Gate 三件套待 D5)')
}
