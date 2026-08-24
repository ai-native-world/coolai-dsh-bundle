import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../packages/dsh-gate/lib/index.js'

function service() {
  let provided
  apply({ provide: (_name, value) => { provided = value } })
  return provided
}

test('未知 Gate fail-closed，不允许默认放行', () => {
  const gates = service()
  assert.throws(() => gates.run('gate-not-registered', {}), /未注册/)
})

test('已注册 Gate 只接受严格 true', () => {
  const gates = service()
  gates.register('strict', () => 'truthy')
  assert.equal(gates.run('strict', {}), false)
  gates.register('strict', () => true)
  assert.equal(gates.run('strict', {}), true)
})

test('声明式 Gate 定义可由 UC 包注册且隔离副本', () => {
  const gates = service()
  const definition = { checks: [{ path: '$input.x', operator: 'present' }] }
  gates.registerDefinition('input-x', definition)
  definition.checks.length = 0
  assert.equal(gates.defs.get('input-x').checks.length, 1)
})
