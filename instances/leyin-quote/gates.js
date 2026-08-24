/**
 * 乐饮报价 UC · Gate 检查器（实例级，注入 coolai-gate）。
 * @module instances/leyin-quote/gates
 */

export const gates = {
  /** 毛利率底线闸：decision.marginOk 必须为 true。 */
  'gate-margin-floor': ({ output }) => output?.marginOk === true,
}
