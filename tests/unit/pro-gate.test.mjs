// 功能门（pro-gate）开源版默认实现单测。
// 守住契约：中性、全开、isPro 恒 false —— 私有版覆盖本模块时不影响这些测试
// （本测试针对 src/lib/pro-gate.js 的开源实现）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRO_FEATURES, isPro, can } from '../../src/lib/pro-gate.js'

test('PRO_FEATURES 列出预期的私有功能标识且不可变', () => {
  assert.deepEqual([...PRO_FEATURES], ['recipe-pipeline', 'custom-presets', 'stream-large'])
  assert.ok(Object.isFrozen(PRO_FEATURES))
})

test('开源版功能门：isPro 恒 false，can 对任意功能恒 true', () => {
  assert.equal(isPro(), false)
  for (const f of PRO_FEATURES) assert.equal(can(f), true)
  assert.equal(can('unknown-feature'), true)
  assert.equal(can(), true)
})
