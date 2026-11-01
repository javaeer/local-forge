// 统一导航模型单测。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NAV, NAV_GROUPS, navByPath, navTitle, navShort, groupLabel, searchNav } from '../../src/lib/nav.js'

test('NAV 每条都有 path / titleKey / groupKey', () => {
  assert.ok(NAV.length >= 20)
  for (const n of NAV) {
    assert.ok(n.path, '缺 path')
    assert.ok(n.titleKey, `路径 ${n.path} 缺 titleKey`)
    assert.ok(n.groupKey, `路径 ${n.path} 缺 groupKey`)
    assert.ok(n.icon, `路径 ${n.path} 缺 icon`)
  }
})

test('NAV 的 path 唯一且 / 存在', () => {
  const paths = NAV.map((n) => n.path)
  assert.equal(new Set(paths).size, paths.length)
  assert.ok(paths.includes('/'))
})

test('每条 nav 的 group 都在 NAV_GROUPS 中', () => {
  for (const n of NAV) assert.ok(NAV_GROUPS.includes(n.group), `未声明分组：${n.group}`)
})

test('navByPath / navTitle / navShort / groupLabel 不抛且返回非空', () => {
  const home = navByPath('/')
  assert.ok(navTitle(home))
  assert.ok(navShort(home))
  assert.ok(groupLabel('常用'))
})

test('searchNav 按关键字命中（模糊匹配）', () => {
  const r = searchNav('zip')
  assert.ok(r.length > 0)
  assert.ok(r.some((n) => n.path === '/zip-compress'))
  // 空串返回全部
  assert.equal(searchNav('').length, NAV.length)
})
