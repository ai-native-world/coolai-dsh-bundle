/**
 * 编译期 fail-closed 反例测试（判据 A1/A3）：坏合同必须全部拒绝。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../packages/dsh-uc-workflow/lib/compile.js'
import { contract as good } from '../instances/leyin-quote/workflow.js'

const FUNCS = new Set(['leyin:cost', 'leyin:capacity', 'leyin:decision', 'leyin:quote'])

test('合法合同编译通过', () => {
  const pkg = compile(good, FUNCS)
  assert.equal(pkg.id, 'leyin-dual-quote')
  assert.equal(pkg.steps.length, 5)
})

test('A1-1 重复步骤 id → 拒绝', () => {
  const c = structuredClone(good)
  c.steps[1] = { ...c.steps[1], id: 'parse' }
  assert.throws(() => compile(c, FUNCS), /重复步骤 id/)
})

test('A1-2 未知 executor → 拒绝', () => {
  const c = structuredClone(good)
  c.steps[1].executor = { kind: 'magic' }
  assert.throws(() => compile(c, FUNCS), /executor 未知/)
})

test('A1-3 未注册函数 ref → 拒绝', () => {
  const c = structuredClone(good)
  c.steps[1].executor = { kind: 'function', ref: 'leyin:not-exist' }
  assert.throws(() => compile(c, FUNCS), /函数未注册/)
})

test('A1-4 悬空 transition 目标 → 拒绝', () => {
  const c = structuredClone(good)
  c.steps[0].transitions = { PASS: 'nowhere' }
  assert.throws(() => compile(c, FUNCS), /悬空/)
})

test('A1-5 未消费输入字段 → 拒绝', () => {
  const c = structuredClone(good)
  c.inputSchema = structuredClone(good.inputSchema)
  c.inputSchema.properties.extra = { type: 'string' }
  c.inputSchema.required.push('extra')
  assert.throws(() => compile(c, FUNCS), /未被消费/)
})

test('A1-6 无来源输出（引用不存在步骤）→ 拒绝', () => {
  const c = structuredClone(good)
  c.steps[1].input = { quantity: '$steps.ghost.qty' }
  assert.throws(() => compile(c, FUNCS), /不存在的来源/)
})

test('A1-7 输出映射悬空 → 拒绝', () => {
  const c = structuredClone(good)
  c.outputMapping = { quote: '$steps.missing.doc' }
  assert.throws(() => compile(c, FUNCS), /引用悬空/)
})

test('A1-8 输出映射不在 outputSchema → 拒绝', () => {
  const c = structuredClone(good)
  c.outputMapping = { quote: '$steps.quote.doc', stray: '$steps.quote.doc' }
  assert.throws(() => compile(c, FUNCS), /不在 outputSchema/)
})

test('A1-9 schema 类型非法 → 拒绝', () => {
  const c = structuredClone(good)
  c.steps[0].outputSchema = { type: 'wibble' }
  assert.throws(() => compile(c, FUNCS), /类型非法/)
})

test('A1-10 输入引用格式非法 → 拒绝', () => {
  const c = structuredClone(good)
  c.steps[1].input = { quantity: 'parse.quantity' }
  assert.throws(() => compile(c, FUNCS), /格式非法/)
})

test('A1-11 输出字段未映射 → 拒绝', () => {
  const c = structuredClone(good)
  c.outputMapping = {}
  assert.throws(() => compile(c, FUNCS), /输出字段未映射/)
})

test('A1-12 transitionPath 非枚举或缺分支 → 拒绝', () => {
  const c = structuredClone(good)
  c.steps[0].transitionPath = '$output.product'
  assert.throws(() => compile(c, FUNCS), /必须声明 enum/)
})
