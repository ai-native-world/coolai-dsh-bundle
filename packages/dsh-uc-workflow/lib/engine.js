/**
 * 确定性 UC 工作流引擎 v3：执行循环 + schema 校验 + Gate（函数式/声明式）+ transitions + 事件流 + human 挂起恢复。
 * @module @coolai/dsh-uc-workflow/engine
 */

import { compile } from './compile.js'

/** 结构化校验错误类型。 */
class SchemaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SchemaError'
  }
}

/** Python 风格 falsy（None/''/[]/{}/false）。 */
function isPyFalsy(v) {
  if (v === undefined || v === null || v === '' || v === false) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v).length === 0
  return false
}

/** Python round（银行家舍入）近似，用于与 Python 版数值逐字段对齐。 */
function pyRound(x, n) {
  const m = 10 ** n
  const scaled = x * m
  const r = Math.round(scaled)
  const diff = Math.abs(scaled - r)
  if (diff <= 1e-9 && r % 2 !== 0) {
    return (r - Math.sign(scaled - r)) / m
  }
  return r / m
}

/** JSON Schema 子集校验（draft 2020-12 常用关键字）。返回错误列表，空 = 通过。 */
export function validateSchema(value, schema, path = '$') {
  const errors = []
  if (!schema || typeof schema !== 'object') return errors
  const t = schema.type
  const typeCheck = (tt, v) => {
    if (tt === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v)
    if (tt === 'array') return Array.isArray(v)
    if (tt === 'integer') return Number.isInteger(v)
    if (tt === 'number') return typeof v === 'number'
    if (tt === 'string') return typeof v === 'string'
    if (tt === 'boolean') return typeof v === 'boolean'
    if (tt === 'null') return v === null
    return true
  }
  const okType = (v) => {
    if (t === undefined) return true
    if (Array.isArray(t)) return t.some(tt => typeCheck(tt, v))
    return typeCheck(t, v)
  }
  if (value === undefined) {
    errors.push(`${path}: 缺少值`)
    return errors
  }
  if (!okType(value)) {
    errors.push(`${path}: 类型不符（期望 ${JSON.stringify(t)}，实际 ${Array.isArray(value) ? 'array' : typeof value}）`)
    return errors
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: 与 const 不符`)
  if (Array.isArray(schema.enum) && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: 不在枚举中（${schema.enum.join('/')}）`)
  }
  if (Array.isArray(schema.oneOf)) {
    const passed = schema.oneOf.filter(s => validateSchema(value, s, path).length === 0)
    if (passed.length !== 1) errors.push(`${path}: oneOf 匹配 ${passed.length} 个分支`)
  }
  if (t === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${path}: 长度小于 ${schema.minLength}`)
  }
  if ((t === 'number' || t === 'integer') && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: 小于 ${schema.minimum}`)
  }
  if ((t === 'number' || t === 'integer') && schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    errors.push(`${path}: 未大于 ${schema.exclusiveMinimum}`)
  }
  if (t === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 元素数小于 ${schema.minItems}`)
    if (schema.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) errors.push(`${path}: 元素不唯一`)
    if (schema.items) value.forEach((item, i) => { errors.push(...validateSchema(item, schema.items, `${path}[${i}]`)) })
  }
  if (t === 'object') {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${path}: 缺少必填字段 ${req}`)
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errors.push(`${path}: 属性数小于 ${schema.minProperties}`)
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errors.push(...validateSchema(v, schema.properties[k], `${path}.${k}`))
      else if (schema.additionalProperties === false) errors.push(`${path}: 未知字段 ${k}`)
    }
  }
  return errors
}

/** 声明式 gate 的 path 解析。 */
function resolvePath(pathStr, ctx) {
  const segs = pathStr.split('.')
  let root
  if (segs[0] === '$input') { root = ctx.input; segs.shift() }
  else if (segs[0] === '$steps') { root = ctx.steps; segs.shift() }
  else if (segs[0] === '$output') { root = ctx.output; segs.shift() }
  else throw new Error(`声明式 gate path 非法: ${pathStr}`)
  let v = root
  for (const s of segs) {
    if (v === undefined || v === null) return undefined
    v = v[s]
  }
  return v
}

function nonEmpty(v) {
  if (v === undefined || v === null || v === '' || v === false) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

/** 声明式 check 执行。 */
function runCheck(check, ctx) {
  const actual = resolvePath(check.path, ctx)
  switch (check.operator) {
    case 'non_empty': return nonEmpty(actual)
    case 'truthy': return !!actual
    case 'present': return actual !== undefined && actual !== null
    case 'eq': return JSON.stringify(actual) === JSON.stringify(check.value)
    case 'in': return Array.isArray(check.value) && check.value.some(v => JSON.stringify(v) === JSON.stringify(actual))
    default: throw new Error(`未知 gate operator: ${check.operator}`)
  }
}

/** 声明式 gate：返回 {pass, onFail}。 */
function runDeclarativeGate(gate, ctx) {
  const pass = (gate.checks ?? []).every(c => runCheck(c, ctx))
  return { pass, onFail: gate.on_fail ?? gate.onFail ?? 'FAIL' }
}

/** 步骤输入引用解析：$input.x / $steps.<outputKey>.x.y；字面量原样返回。 */
function resolveStepRef(refStr, input, steps) {
  if (typeof refStr !== 'string') return refStr
  if (refStr.startsWith('$input.')) return input[refStr.slice('$input.'.length)]
  if (refStr.startsWith('$steps.')) {
    const rest = refStr.slice('$steps.'.length).split('.')
    let v = steps[rest[0]]
    for (const k of rest.slice(1)) v = v?.[k]
    return v
  }
  return refStr
}

let RUN_SEQ = 0

export class UcWorkflowEngine {
  constructor(deps = {}) {
    this.functions = deps.functions ?? new Map()
    this.gates = deps.gates ?? { run: () => true }
    this.gateDefs = deps.gates?.defs ?? new Map()
    this.modelFn = deps.modelFn ?? null
    this.record = deps.record ?? (() => {})
    this.runs = new Map()
  }

  registerFunction(ref, fn) { this.functions.set(ref, fn) }
  setModelFn(fn) { this.modelFn = fn }

  /** 编译并冻结合同（fail-closed，见 compile.js）。 */
  defineWorkflow(contract) {
    return compile(contract, new Set(this.functions.keys()))
  }

  /** 执行一次 gate：函数式返回布尔；声明式返回 {pass,onFail}。返回信号。 */
  runGate(gid, ctx, transitions) {
    if (this.gateDefs.has(gid)) {
      const r = runDeclarativeGate(this.gateDefs.get(gid), ctx)
      if (r.pass) return 'PASS'
      return transitions?.[r.onFail] !== undefined ? r.onFail : 'FAIL'
    }
    const pass = this.gates.run(gid, ctx)
    if (pass) return 'PASS'
    return transitions?.FAIL_GATE !== undefined ? 'FAIL_GATE' : 'FAIL'
  }

  resume(runId, humanOutput) {
    const state = this.runs.get(runId)
    if (!state) throw new Error(`run ${runId} 不存在或已结束`)
    this.runs.delete(runId)
    return this._execute(state.pkg, state.input, { cursor: state.cursor, steps: state.steps, events: state.events, humanForStep: state.cursor, humanOutput })
  }

  async execute(pkg, input) {
    return this._execute(pkg, input, null)
  }

  async _execute(pkg, input, resume) {
    const runId = `run-${Date.now()}-${++RUN_SEQ}`
    const steps = resume?.steps ?? {}
    const events = resume?.events ?? []
    const rec = (type, payload) => {
      const e = { ts: Date.now(), type, ...payload }
      events.push(e)
      this.record(e)
    }

    if (!resume) {
      rec('run_start', { workflow: pkg.id, input })
      const inputErrors = pkg.inputSchema ? validateSchema(input, pkg.inputSchema, '$input') : []
      if (inputErrors.length > 0) {
        rec('run_input_schema_fail', { errors: inputErrors })
        return { status: 'failed', code: 'INPUT_SCHEMA_INVALID', stepsStarted: 0, errors: inputErrors, events, runId }
      }
      for (const gid of pkg.inputGates ?? []) {
        const s = this.runGate(gid, { input, steps }, {})
        rec('gate', { gate: gid, scope: 'input', pass: s === 'PASS', signal: s })
        if (s !== 'PASS') {
          rec('run_failed', { step: null, signal: s, gate: gid })
          return { status: 'failed', code: 'GATE_FAILED', stepsStarted: 0, errors: [`gate ${gid} 拦截`], events, runId }
        }
      }
    }

    let stepsStarted = events.filter(e => e.type === 'step_start').length
    let cursor = resume?.cursor ?? pkg.steps[0].id

    while (cursor) {
      const step = pkg.steps.find(s => s.id === cursor)
      if (!step) throw new Error(`run 内部错误：步骤 ${cursor} 不存在`)
      const isResumeStep = resume !== null && resume.humanForStep === step.id
      let signal = 'PASS'
      let gateFailed = false
      let stepInput = {}

      if (!isResumeStep) {
        for (const [k, ref] of Object.entries(step.input ?? {})) stepInput[k] = resolveStepRef(ref, input, steps)
        rec('step_start', { step: step.id, input: stepInput })
        stepsStarted++
        for (const gid of step.preGates ?? []) {
          const s = this.runGate(gid, { input, stepInput, step, steps }, step.transitions)
          rec('gate', { gate: gid, scope: 'pre', step: step.id, pass: s === 'PASS', signal: s })
          if (s !== 'PASS') { signal = s; gateFailed = true; break }
        }
      } else {
        for (const [k, ref] of Object.entries(step.input ?? {})) stepInput[k] = resolveStepRef(ref, input, steps)
        rec('step_resume', { step: step.id })
      }

      let output
      if (signal === 'PASS') {
        if (step.executor.kind === 'human') {
          if (isResumeStep) {
            output = resume.humanOutput
          } else {
            rec('run_pending', { kind: 'human', step: step.id, allowed: resolveStepRef(step.input?.allowed_statuses, input, steps) ?? null })
            this.runs.set(runId, { pkg, input, cursor: step.id, steps, events })
            return { status: 'wait_human', runId, pending: { stepId: step.id, kind: 'human', payload: stepInput }, events }
          }
        } else if (step.executor.kind === 'function') {
          const ref = step.executor.ref ?? step.executor.capability_ref
          const fn = this.functions.get(ref)
          if (!fn) throw new Error(`函数未注册: ${ref}`)
          output = await fn(stepInput)
        } else if (step.executor.kind === 'model') {
          if (!this.modelFn) throw new Error('model executor 需要注入 modelFn')
          output = await this.modelFn({ step, input: stepInput, schema: step.outputSchema })
        } else {
          throw new Error(`executor 未知: ${JSON.stringify(step.executor)}`)
        }

        rec('step_output', { step: step.id, output })
        const errs = validateSchema(output, step.outputSchema, `$steps.${step.outputKey}`)
        if (errs.length > 0) {
          rec('step_schema_fail', { step: step.id, errors: errs })
          signal = 'FAIL'
        } else {
          steps[step.outputKey] = output
          for (const gid of step.postGates ?? []) {
            const s = this.runGate(gid, { input, stepInput, step, steps, output, stepOutput: output }, step.transitions)
            rec('gate', { gate: gid, scope: 'post', step: step.id, pass: s === 'PASS', signal: s })
            if (s !== 'PASS') { signal = s; gateFailed = true; break }
          }
        }
      }

      const target = step.transitions?.[signal]
      rec('step_end', { step: step.id, signal, next: target ?? null })

      if (target === '$success') {
        const result = {}
        for (const [f, ref] of Object.entries(pkg.outputMapping ?? {})) result[f] = resolveStepRef(ref, input, steps)
        rec('run_output', { output: result })
        for (const gid of pkg.outputGates ?? []) {
          const s = this.runGate(gid, { input, steps, output: result }, {})
          rec('gate', { gate: gid, scope: 'output', pass: s === 'PASS', signal: s })
          if (s !== 'PASS') {
            rec('run_failed', { step: step.id, signal: s, gate: gid })
            return { status: 'failed', code: 'GATE_FAILED', stepsStarted, errors: [`gate ${gid} 拦截`], events, runId }
          }
        }
        rec('run_done', { output: result })
        return { status: 'done', output: result, events, runId }
      }
      if (target === '$fail') {
        rec('run_failed', { step: step.id, signal, gateFailed })
        return { status: 'failed', code: gateFailed ? 'GATE_FAILED' : 'FAILED', stepsStarted, errors: [`步骤 ${step.id} 以 ${signal} 结束${gateFailed ? '（Gate 拦截）' : ''}`], events, runId }
      }
      if (target === '$wait_input' || target === '$wait_human') {
        rec('run_pending', { kind: target === '$wait_human' ? 'human' : 'input', step: step.id })
        this.runs.set(runId, { pkg, input, cursor: step.id, steps, events })
        return { status: target === '$wait_human' ? 'wait_human' : 'wait_input', runId, pending: { stepId: step.id, kind: target === '$wait_human' ? 'human' : 'input' }, events }
      }
      cursor = target
    }
    throw new Error('run 内部错误：步骤链未终止')
  }
}

export { SchemaError, isPyFalsy, pyRound, resolveStepRef }
