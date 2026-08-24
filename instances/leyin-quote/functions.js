/**
 * 乐饮报价 UC · 纯函数集（确定性来源：同输入必同输出，可单测）。
 * 全部无副作用、无随机数、无时钟依赖（dueDate 比较只基于传入日期）。
 * @module instances/leyin-quote/functions
 */

const round2 = x => Math.round(x * 100) / 100

/** 成本归集：物料成本 + 加工费（金额统一二分位舍入，输出干净且确定）。 */
export function aggregateCost({ quantity, materialUnitPrice, machiningRate }) {
  const materialCost = round2(materialUnitPrice * quantity)
  const machiningCost = round2(machiningRate * quantity)
  const totalCost = round2(materialCost + machiningCost)
  return { materialCost, machiningCost, totalCost }
}

const DAY = 24 * 60 * 60 * 1000

/** 产能推演：按日产能折算天数，判定交期可行性。today 为基准日锚点（无时钟依赖，同输入同输出）。 */
export function simulateCapacity({ quantity, dueDate, today, lineCapacityDaily, scheduledLoad }) {
  const estDays = Math.ceil(quantity / lineCapacityDaily)
  const loadAfter = scheduledLoad + quantity
  const dueMs = Date.parse(dueDate)
  const todayMs = Date.parse(today)
  if (Number.isNaN(dueMs) || Number.isNaN(todayMs)) {
    return { estDays, dueDays: -1, loadAfter, feasible: false }
  }
  const dueDays = Math.ceil((dueMs - todayMs) / DAY)
  const feasible = dueDays >= estDays && dueDays >= 0
  return { estDays, dueDays, loadAfter, feasible }
}

/** 报价决策：目标毛利定价，判定是否突破毛利底线（Gate 依据）。 */
export function decideQuote({ totalCost, quantity, marginTarget, marginFloor }) {
  const unitPrice = (totalCost * (1 + marginTarget)) / quantity
  const margin = marginTarget
  const marginOk = margin >= marginFloor
  return { unitPrice, margin, marginOk }
}

/** FNV-1a：确定性 quoteId（同输入同 ID，不依赖时钟）。 */
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

/** 产出报价单：结构化 JSON，带经验引用（knowhow ID 可见，可答"为什么这么报"）。 */
export function buildQuote({ product, quantity, dueDate, unitPrice }) {
  const key = [product, quantity, dueDate].join('|')
  const quoteId = `Q-${fnv1a(key)}`
  const totalPrice = Math.round(unitPrice * quantity * 100) / 100
  return {
    doc: {
      quoteId,
      product,
      quantity,
      unitPrice: Math.round(unitPrice * 100) / 100,
      totalPrice,
      dueDate,
      terms: '报价有效期 7 天，价格基于当前物料单价与机台费率',
      knowhowRef: 'knowhow-报价单-001',
    },
  }
}
