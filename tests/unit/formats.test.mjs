// 首页工具目录（TOOLS）结构 + i18n key 运行时存在性。
// 与静态护栏 scripts/check-consistency.mjs 互补：护栏扫源码「是否声明」，此处运行时「是否真能取到」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS, CREATE_FORMATS, COMPRESSIONS } from '../../src/lib/formats.js'
import { T } from '../../src/lib/i18n.dev.js'
import { locale } from '../../src/lib/i18n.js'

const LANGS = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']

test('TOOLS 每组都有 group 与 groupKey', () => {
  assert.ok(TOOLS.length >= 5)
  for (const g of TOOLS) {
    assert.ok(g.group, '分组缺 group')
    assert.ok(g.groupKey, '分组缺 groupKey')
    assert.ok(Array.isArray(g.items) && g.items.length, '分组无 items')
  }
})

test('每条卡片都有 to / icon / 三套 key / 中文原值', () => {
  let n = 0
  for (const g of TOOLS) {
    for (const it of g.items) {
      n++
      assert.ok(it.to, '卡片缺 to')
      assert.ok(it.icon, '卡片缺 icon')
      for (const k of ['titleKey', 'descKey']) assert.ok(it[k], `卡片 ${it.to} 缺 ${k}`)
      // 中文原值保留（向后兼容其它读原值的引用）
      assert.ok(it.title && it.desc, `卡片 ${it.to} 缺中文原值`)
    }
  }
  assert.equal(n, 45) // 与阶段 E 的 45 张卡片约定一致
})

test('CREATE_FORMATS / COMPRESSIONS 结构', () => {
  assert.ok(CREATE_FORMATS.every((f) => f.ext && f.label))
  assert.ok(COMPRESSIONS.every((c) => c.id && c.label))
})

test('所有首页 key 在 5 语言下均能取到（非 key 泄漏）', () => {
  const keys = []
  for (const g of TOOLS) {
    keys.push(g.groupKey)
    for (const it of g.items) keys.push(it.titleKey, it.descKey)
  }
  for (const loc of LANGS) {
    locale.value = loc
    const missing = keys.filter((k) => T(k) === k)
    assert.deepEqual(missing, [], `语言 ${loc} 缺首页词条：${missing.join(', ')}`)
  }
})
