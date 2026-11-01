// 阶段化进度模型单测（权重加权总进度 + 活动阶段推导）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProgress } from '../../src/lib/progress.js'

test('加权总进度按 weight 计算', () => {
  const p = createProgress([{ id: 'core', label: '加载内核', weight: 3 }, { id: 'run', label: '转码', weight: 7 }])
  p.set('core', 1) // 30%
  assert.equal(p.overall.value, 30)
  p.set('run', 0.5) // 30% + 35% = 65%
  assert.equal(p.overall.value, 65)
})

test('finish 置满、reset 归零', () => {
  const p = createProgress([{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }])
  p.finish()
  assert.equal(p.overall.value, 100)
  p.reset()
  assert.equal(p.overall.value, 0)
})

test('activeId 取「最靠前且未完成」的阶段', () => {
  const p = createProgress([{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }])
  p.set('a', 1)
  assert.equal(p.activeId.value, 'b') // a 完成 → 活动转到 b
  p.set('b', 1)
  assert.equal(p.activeId.value, null) // 全部完成
})

test('ratio 被钳制在 [0,1]', () => {
  const p = createProgress([{ id: 'a', weight: 1 }])
  p.set('a', 5) // 越界
  assert.equal(p.ratios.value.a, 1)
  p.set('a', -2)
  assert.equal(p.ratios.value.a, 0)
})
