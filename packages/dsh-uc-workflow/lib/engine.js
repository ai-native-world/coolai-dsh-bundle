/**
 * 确定性 UC 工作流引擎：严格合同、Gate、可持久暂停恢复与完整事件轨迹。
 * @module @coolai/dsh-uc-workflow/engine
 */

import { randomUUID } from 'node:crypto'
import { compile } from './compile.js'

class SchemaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SchemaError'
  }
}

function isPyFalsy(v) {
  if (v === undefined || v === null || v === '' || v === false) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v).length === 0
  return false
}

function pyRound(x, n) {
  const m = 10 ** n
  const scaled = x * m
  const r = Math.round(scaled)
  const diff = Math.abs(scaled - r)
  if (diff <= 1e-9 && r % 2 !== 0) return (r - Math.sign(scaled - r)) / m
  return r / m
}

/** JSON Schema 子集校验（UC 合同使用的 draft 2020-12 关键字）。 */
export function validateSchema(value, schema, path = '$') {
  const errors = []
  if (!schema || typeof schema !== 'object') return errors
  const t = schema.type
  const typeCheck = (tt, v) => {
    if (tt === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v)
    if (tt === 'array') return Array.isArray(v)
    if (tt === 'integer') return Number.isInteger(v)
    if (tt === 'number') return typeof v === 'number' && Number.isFinite(v)
    if (tt === 'string') return typeof v === 'string'
    if (tt === 'boolean') return typeof v === 'boolean'
    if (tt === 'null') return v === null
    return true
  }
  const okType = v => t === undefined || (Array.isArray(t) ? t.some(tt => typeCheck(tt, v)) : typeCheck(t, v))
  if (value === undefined) return [`${path}: 缺少值`]
  if (!okType(value)) return [`${path}: 类型不符（期望 ${JSON.stringify(t)}，实际 ${Array.isArray(value) ? 'array' : typeof value}）`]
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: 与 const 不符`)
  if (Array.isArray(schema.enum) && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) errors.push(`${path}: 不在枚举中（${schema.enum.join('/')}）`)
  if (Array.isArray(schema.oneOf)) {
    const passed = schema.oneOf.filter(s => validateSchema(value, s, path).length === 0)
    if (passed.length !== 1) errors.push(`${path}: oneOf 匹配 ${passed.length} 个分支`)
  }
  if (t === 'string' && schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: 长度小于 ${schema.minLength}`)
  if ((t === 'number' || t === 'integer') && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: 小于 ${schema.minimum}`)
  if ((t === 'number' || t === 'integer') && schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: 未大于 ${schema.exclusiveMinimum}`)
  if (t === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 元素数小于 ${schema.minItems}`)
    if (schema.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) errors.push(`${path}: 元素不唯一`)
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, `${path}[${i}]`)))
  }
  if (t === 'object') {
    for (const req of schema.required ?? []) if (!(req in value)) errors.push(`${path}: 缺少必填字段 ${req}`)
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errors.push(`${path}: 属性数小于 ${schema.minProperties}`)
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errors.push(...validateSchema(v, schema.properties[k], `${path}.${k}`))
      else if (schema.additionalProperties === false) errors.push(`${path}: 未知字段 ${k}`)
    }
  }
  return errors
}

function resolvePath(pathStr, ctx) {
  const segs = pathStr.split('.')
  let root
  if (segs[0] === '$input') { root = ctx.input; segs.shift() }
  else if (segs[0] === '$steps') { root = ctx.steps; segs.shift() }
  else if (segs[0] === '$output') { root = ctx.output; segs.shift() }
  else throw new Error(`path 非法: ${pathStr}`)
  let v = root
  for (const s of segs) v = v?.[s]
  return v
}

function nonEmpty(v) {
  if (v === undefined || v === null || v === '' || v === false) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

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

function runDeclarativeGate(gate, ctx) {
  return { pass: (gate.checks ?? []).every(c => runCheck(c, ctx)), onFail: gate.on_fail ?? gate.onFail ?? 'FAIL' }
}

function resolveStepRef(refStr, input, steps) {
  if (typeof refStr !== 'string') return structuredClone(refStr)
  if (refStr.startsWith('$input.')) return input[refStr.slice('$input.'.length)]
  if (refStr.startsWith('$steps.')) {
    const rest = refStr.slice('$steps.'.length).split('.')
    let v = steps[rest[0]]
    for (const k of rest.slice(1)) v = v?.[k]
    return v
  }
  return refStr
}

/** 单元测试和无持久层场景使用；DSH 插件默认注入 storage-domain 适配器。 */
export class MemoryRunStore {
  constructor(seed = []) { this.records = new Map(seed.map(r => [r.runId, structuredClone(r)])) }
  async create(record) {
    if (this.records.has(record.runId)) throw new Error(`run ${record.runId} 已存在`)
    this.records.set(record.runId, structuredClone(record))
  }
  async save(record) {
    if (!this.records.has(record.runId)) throw new Error(`run ${record.runId} 不存在`)
    this.records.set(record.runId, structuredClone(record))
  }
  async load(runId) { return structuredClone(this.records.get(runId)) }
  async list() { return [...this.records.values()].map(record => structuredClone(record)) }
}

export class UcWorkflowEngine {
  constructor(deps = {}) {
    this.functions = deps.functions ?? new Map()
    this.gates = deps.gates ?? { run: id => { throw new Error(`gate 未注册: ${id}`) } }
    this.gateDefs = deps.gates?.defs ?? new Map()
    this.modelFn = deps.modelFn ?? null
    this.record = deps.record ?? (() => {})
    this.store = deps.store ?? new MemoryRunStore()
    this.idFactory = deps.idFactory ?? (() => `run-${randomUUID()}`)
    this.workflows = new Map()
    this.activeRuns = new Set()
  }

  registerFunction(ref, fn) { this.functions.set(ref, fn) }
  setModelFn(fn) { this.modelFn = fn }

  defineWorkflow(contract) {
    const pkg = compile(contract, new Set(this.functions.keys()))
    this.registerWorkflow(pkg)
    return pkg
  }

  registerWorkflow(pkg) {
    this.workflows.set(`${pkg.id}@${pkg.version}`, pkg)
    return pkg
  }

  runGate(gid, ctx, transitions) {
    if (this.gateDefs.has(gid)) {
      const result = runDeclarativeGate(this.gateDefs.get(gid), ctx)
      if (result.pass) return 'PASS'
      return transitions?.[result.onFail] !== undefined ? result.onFail : 'FAIL'
    }
    const pass = this.gates.run(gid, ctx)
    if (pass) return 'PASS'
    return transitions?.FAIL_GATE !== undefined ? 'FAIL_GATE' : 'FAIL'
  }

  async getRun(runId) { return this.store.load(runId) }
  async listRuns() { return this.store.list() }

  async execute(pkg, input) {
    this.registerWorkflow(pkg)
    const now = Date.now()
    const state = {
      runId: this.idFactory(), workflowId: pkg.id, workflowVersion: pkg.version,
      input: structuredClone(input), cursor: pkg.steps[0].id, steps: {}, events: [],
      status: 'running', pending: null, createdAt: now, updatedAt: now,
    }
    await this.store.create(state)
    return this._execute(pkg, state, null)
  }

  async resume(runId, response) {
    if (this.activeRuns.has(runId)) throw new Error(`run ${runId} 正在执行，拒绝重复恢复`)
    const state = await this.store.load(runId)
    if (!state) throw new Error(`run ${runId} 不存在`)
    if (!['wait_human', 'wait_input'].includes(state.status)) throw new Error(`run ${runId} 当前状态 ${state.status} 不可恢复`)
    const pkg = this.workflows.get(`${state.workflowId}@${state.workflowVersion}`)
    if (!pkg) throw new Error(`workflow ${state.workflowId}@${state.workflowVersion} 未注册，无法恢复`)
    return this._execute(pkg, state, { stepId: state.pending.stepId, response: structuredClone(response) })
  }

  async _execute(pkg, state, resume) {
    const { runId, input, steps, events } = state
    if (this.activeRuns.has(runId)) throw new Error(`run ${runId} 正在执行`)
    this.activeRuns.add(runId)
    const rec = (type, payload) => {
      const event = { ts: Date.now(), seq: events.length + 1, type, ...payload }
      events.push(event)
      this.record(event)
    }
    const checkpoint = async (status, pending = null) => {
      state.status = status
      state.pending = pending
      state.updatedAt = Date.now()
      await this.store.save(state)
    }
    try {
      if (!resume) {
        rec('run_start', { runId, workflow: pkg.id, version: pkg.version, input })
        const inputErrors = pkg.inputSchema ? validateSchema(input, pkg.inputSchema, '$input') : []
        if (inputErrors.length > 0) {
          rec('run_input_schema_fail', { errors: inputErrors })
          await checkpoint('failed')
          return { status: 'failed', code: 'INPUT_SCHEMA_INVALID', stepsStarted: 0, errors: inputErrors, events, runId }
        }
        for (const gid of pkg.inputGates ?? []) {
          const signal = this.runGate(gid, { input, steps }, {})
          rec('gate', { gate: gid, scope: 'input', pass: signal === 'PASS', signal })
          if (signal !== 'PASS') {
            rec('run_failed', { step: null, signal, gate: gid })
            await checkpoint('failed')
            return { status: 'failed', code: 'GATE_FAILED', stepsStarted: 0, errors: [`gate ${gid} 拦截`], events, runId }
          }
        }
      } else {
        rec('run_resume', { runId, step: resume.stepId, kind: state.pending.kind })
        state.status = 'running'
        state.pending = null
        await this.store.save(state)
      }

      let stepsStarted = events.filter(e => e.type === 'step_start').length
      let cursor = state.cursor
      while (cursor) {
        const step = pkg.steps.find(s => s.id === cursor)
        if (!step) throw new Error(`run 内部错误：步骤 ${cursor} 不存在`)
        const isResumeStep = resume?.stepId === step.id
        const stepInput = {}
        for (const [k, ref] of Object.entries(step.input ?? {})) stepInput[k] = resolveStepRef(ref, input, steps)
        let signal = 'PASS'
        let gateFailed = false

        if (!isResumeStep) {
          rec('step_start', { step: step.id, input: stepInput })
          stepsStarted++
          for (const gid of step.preGates ?? []) {
            const nextSignal = this.runGate(gid, { input, stepInput, step, steps }, step.transitions)
            rec('gate', { gate: gid, scope: 'pre', step: step.id, pass: nextSignal === 'PASS', signal: nextSignal })
            if (nextSignal !== 'PASS') { signal = nextSignal; gateFailed = true; break }
          }
        } else rec('step_resume', { step: step.id })

        let output
        if (signal === 'PASS') {
          if (step.executor.kind === 'human' || step.executor.kind === 'input') {
            if (isResumeStep) output = resume.response
            else {
              const kind = step.executor.kind
              const pending = { stepId: step.id, kind, payload: stepInput }
              rec('run_pending', { kind, step: step.id })
              state.cursor = step.id
              await checkpoint(kind === 'human' ? 'wait_human' : 'wait_input', pending)
              return { status: kind === 'human' ? 'wait_human' : 'wait_input', runId, pending, events }
            }
          } else if (step.executor.kind === 'function') {
            const ref = step.executor.ref ?? step.executor.capability_ref
            const fn = this.functions.get(ref)
            if (!fn) throw new Error(`函数未注册: ${ref}`)
            output = await fn(stepInput)
          } else if (step.executor.kind === 'model') {
            if (!this.modelFn) throw new Error('model executor 需要注入 modelFn')
            output = await this.modelFn({ step, input: stepInput, schema: step.outputSchema })
          } else throw new Error(`executor 未知: ${JSON.stringify(step.executor)}`)

          rec('step_output', { step: step.id, output })
          const errors = validateSchema(output, step.outputSchema, `$steps.${step.outputKey}`)
          if (errors.length > 0) {
            rec('step_schema_fail', { step: step.id, errors })
            signal = 'FAIL'
          } else {
            steps[step.outputKey] = structuredClone(output)
            for (const gid of step.postGates ?? []) {
              const nextSignal = this.runGate(gid, { input, stepInput, step, steps, output, stepOutput: output }, step.transitions)
              rec('gate', { gate: gid, scope: 'post', step: step.id, pass: nextSignal === 'PASS', signal: nextSignal })
              if (nextSignal !== 'PASS') { signal = nextSignal; gateFailed = true; break }
            }
            if (!gateFailed && step.transitionPath) {
              const routed = resolvePath(step.transitionPath, { input, steps, output })
              if (typeof routed !== 'string' || step.transitions?.[routed] === undefined) {
                rec('step_route_fail', { step: step.id, transitionPath: step.transitionPath, value: routed })
                signal = 'FAIL'
              } else signal = routed
            }
          }
        }

        const target = step.transitions?.[signal]
        rec('step_end', { step: step.id, signal, next: target ?? null })
        state.cursor = target
        if (target === '$success') {
          const result = {}
          for (const [field, ref] of Object.entries(pkg.outputMapping ?? {})) result[field] = resolveStepRef(ref, input, steps)
          rec('run_output', { output: result })
          const outputErrors = validateSchema(result, pkg.outputSchema, '$output')
          if (outputErrors.length > 0) {
            rec('run_output_schema_fail', { errors: outputErrors })
            await checkpoint('failed')
            return { status: 'failed', code: 'OUTPUT_SCHEMA_INVALID', stepsStarted, errors: outputErrors, events, runId }
          }
          for (const gid of pkg.outputGates ?? []) {
            const nextSignal = this.runGate(gid, { input, steps, output: result }, {})
            rec('gate', { gate: gid, scope: 'output', pass: nextSignal === 'PASS', signal: nextSignal })
            if (nextSignal !== 'PASS') {
              rec('run_failed', { step: step.id, signal: nextSignal, gate: gid })
              await checkpoint('failed')
              return { status: 'failed', code: 'GATE_FAILED', stepsStarted, errors: [`gate ${gid} 拦截`], events, runId }
            }
          }
          rec('run_done', { output: result })
          state.output = structuredClone(result)
          await checkpoint('done')
          return { status: 'done', output: result, events, runId }
        }
        if (target === '$fail' || target === undefined) {
          rec('run_failed', { step: step.id, signal, gateFailed })
          await checkpoint('failed')
          return { status: 'failed', code: gateFailed ? 'GATE_FAILED' : 'FAILED', stepsStarted, errors: [`步骤 ${step.id} 以 ${signal} 结束${gateFailed ? '（Gate 拦截）' : ''}`], events, runId }
        }
        if (target === '$wait_input' || target === '$wait_human') {
          const kind = target === '$wait_human' ? 'human' : 'input'
          const pending = { stepId: step.id, kind, payload: stepInput, reason: signal }
          rec('run_pending', { kind, step: step.id, reason: signal })
          state.cursor = step.id
          await checkpoint(kind === 'human' ? 'wait_human' : 'wait_input', pending)
          return { status: kind === 'human' ? 'wait_human' : 'wait_input', runId, pending, events }
        }
        cursor = target
        state.cursor = cursor
        await checkpoint('running')
        resume = null
      }
      throw new Error('run 内部错误：步骤链未终止')
    } catch (error) {
      rec('run_error', { error: error instanceof Error ? error.message : String(error) })
      await checkpoint('failed')
      throw error
    } finally {
      this.activeRuns.delete(runId)
    }
  }
}

export { SchemaError, isPyFalsy, pyRound, resolveStepRef }
