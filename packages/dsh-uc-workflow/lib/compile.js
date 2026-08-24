/**
 * 确定性 UC 工作流引擎 · 编译期 fail-closed 检查。
 * 8 类坏合同必须全部编译拒绝：重复 ID / 未知 executor / 悬空 transition /
 * 未消费输入 / 无来源输出 / 输出映射悬空 / schema 类型错误 / 函数未注册。
 * @module @coolai/dsh-uc-workflow/compile
 */

const TERMINALS = new Set(['$success', '$fail', '$wait_input', '$wait_human'])

const VALID_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array', 'integer', 'null'])

class CompileError extends Error {
  constructor(message) {
    super(`uc-workflow compile rejected: ${message}`)
    this.name = 'CompileError'
  }
}

function checkType(schema, path) {
  const t = typeof schema === 'string' ? schema : schema?.type
  if (t === undefined) throw new CompileError(`${path} 缺少 type`)
  if (typeof t === 'string' && !VALID_TYPES.has(t)) throw new CompileError(`${path} 类型非法: ${t}`)
  if (t === 'object' && schema.properties === undefined) throw new CompileError(`${path} object 缺少 properties`)
  return true
}

function schemaAtOutputPath(schema, path) {
  const segments = path.slice('$output.'.length).split('.')
  let current = schema
  for (const segment of segments) current = current?.properties?.[segment]
  return current
}

/**
 * @param {object} contract - { id, steps, inputSchema, outputSchema, outputMapping, functionRefs }
 * @param {Set<string>} availableFunctions - 已注册的纯函数 ref 集合
 * @returns {object} 编译产物（冻结的步骤表）
 */
export function compile(contract, availableFunctions = new Set()) {
  if (!contract?.id) throw new CompileError('合同缺少 id')
  if (!Array.isArray(contract.steps) || contract.steps.length === 0) throw new CompileError('steps 为空')

  checkType(contract.inputSchema ?? { type: 'object', properties: {} }, 'inputSchema')
  checkType(contract.outputSchema ?? { type: 'object', properties: {} }, 'outputSchema')

  const ids = new Set()
  const inputFields = Object.keys(contract.inputSchema?.properties ?? {})
  const outputFields = Object.keys(contract.outputSchema?.properties ?? {})
  const consumed = new Set()
  // 引用目标集合：步骤 id + outputKey（v0.2 合同用 output_key 作引用，乐饮用 step id）
  const stepIds = new Set(contract.steps.flatMap(s => [s.id, s.outputKey ?? s.id]))

  // 前置检查：重复 id 是全局结构错误，必须在逐步骤校验之前触发
  for (const step of contract.steps) {
    if (!step?.id) throw new CompileError('步骤缺少 id')
    if (ids.has(step.id)) throw new CompileError(`重复步骤 id: ${step.id}`)
    ids.add(step.id)
  }

  for (const step of contract.steps) {

    const kind = step.executor?.kind ?? (step.executor?.capability_ref ? 'function' : undefined)
    if (!['function', 'model', 'human', 'input'].includes(kind)) throw new CompileError(`步骤 ${step.id} executor 未知: ${kind}`)
    if (kind === 'function') {
      const ref = step.executor.ref ?? step.executor.capability_ref
      if (typeof ref !== 'string') throw new CompileError(`步骤 ${step.id} function 缺少 ref`)
      if (!availableFunctions.has(ref)) throw new CompileError(`步骤 ${step.id} 函数未注册: ${ref}`)
    }

    if (!step.outputKey) throw new CompileError(`步骤 ${step.id} 缺少 outputKey`)
    checkType(step.outputSchema ?? { type: 'object', properties: {} }, `步骤 ${step.id} outputSchema`)

    if (step.transitionPath !== undefined) {
      if (typeof step.transitionPath !== 'string' || !step.transitionPath.startsWith('$output.')) {
        throw new CompileError(`步骤 ${step.id} transitionPath 必须引用 $output`)
      }
      const routeSchema = schemaAtOutputPath(step.outputSchema, step.transitionPath)
      if (!Array.isArray(routeSchema?.enum) || routeSchema.enum.length === 0) {
        throw new CompileError(`步骤 ${step.id} transitionPath 字段必须声明 enum`)
      }
      for (const signal of routeSchema.enum) {
        if (step.transitions?.[signal] === undefined) throw new CompileError(`步骤 ${step.id} 缺少路由 ${signal}`)
      }
    }

    // 输入引用：字符串引用必须指向输入字段或前序步骤输出；字面量（数组/对象/标量）原样透传
    for (const [key, ref] of Object.entries(step.input ?? {})) {
      if (typeof ref !== 'string') continue // 字面量（如 allowed_statuses）
      const refStr = ref
      if (refStr.startsWith('$input.')) {
        consumed.add(refStr.slice('$input.'.length))
      } else if (refStr.startsWith('$steps.')) {
        const src = refStr.slice('$steps.'.length).split('.')[0]
        if (!stepIds.has(src)) throw new CompileError(`步骤 ${step.id} 输入引用了不存在的来源: ${refStr}`)
      } else {
        throw new CompileError(`步骤 ${step.id} 输入 ${key} 引用格式非法: ${refStr}`)
      }
    }

    // transitions：目标必须存在
    for (const [signal, target] of Object.entries(step.transitions ?? {})) {
      if (!TERMINALS.has(target) && !stepIds.has(target)) {
        throw new CompileError(`步骤 ${step.id} transition ${signal} 悬空: ${target}`)
      }
    }
  }

  // 未消费输入
  for (const f of inputFields) {
    if (!consumed.has(f)) throw new CompileError(`输入字段未被消费: ${f}`)
  }
  // 输出映射必须落在输出 schema 字段且引用存在
  for (const [field, ref] of Object.entries(contract.outputMapping ?? {})) {
    if (!outputFields.includes(field)) throw new CompileError(`输出映射 ${field} 不在 outputSchema 中`)
    const refStr = String(ref)
    if (!refStr.startsWith('$steps.')) throw new CompileError(`输出映射 ${field} 引用非法: ${refStr}`)
    const src = refStr.slice('$steps.'.length).split('.')[0]
    if (!stepIds.has(src)) throw new CompileError(`输出映射 ${field} 引用悬空: ${refStr}`)
  }
  for (const field of outputFields) {
    if (contract.outputMapping?.[field] === undefined) throw new CompileError(`输出字段未映射: ${field}`)
  }

  return Object.freeze({
    id: contract.id,
    version: contract.version ?? '0.0.0',
    steps: Object.freeze(contract.steps.map(s => Object.freeze({ ...s }))),
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    outputMapping: Object.freeze({ ...contract.outputMapping }),
    inputGates: Object.freeze([...(contract.input_gates ?? [])]),
    outputGates: Object.freeze([...(contract.output_gates ?? [])]),
  })
}

export { CompileError }
