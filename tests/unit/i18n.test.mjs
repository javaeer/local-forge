// 多语言内核单测：5 语言词条齐全、插值、缺失 key 回退且不抛（暴露 import.meta.env 在非 Vite 环境下的崩溃）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { t, locale, LOCALE_ORDER, LOCALE_NAMES } from '../../src/lib/i18n.js'
import { T } from '../../src/lib/i18n.dev.js'

const LANGS = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']

test('LOCALE_ORDER 为 5 语种且 LOCALE_NAMES 一一对应', () => {
  assert.deepEqual(LOCALE_ORDER, LANGS)
  for (const l of LANGS) assert.ok(LOCALE_NAMES[l], `缺显示名：${l}`)
})

test('核心 nav key 在 5 语言下均能取到（非 key 泄漏）', () => {
  const keys = ['nav.home', 'nav.zipCompress', 'nav.mediaConvert', 'nav.imageConvert', 'nav.qrCode', 'nav.hash', 'nav.text', 'nav.about']
  for (const loc of LANGS) {
    locale.value = loc
    const missing = keys.filter((k) => t(k) === k)
    assert.deepEqual(missing, [], `语言 ${loc} 缺 nav 词条：${missing.join(', ')}`)
  }
})

test('补充包 key（svg/css/home）在 5 语言下均能取到', () => {
  const keys = ['nav.svgTool', 'nav.cssReference', 'home.t.zipCompress', 'home.d.zipExtract']
  for (const loc of LANGS) {
    locale.value = loc
    const missing = keys.filter((k) => T(k) === k)
    assert.deepEqual(missing, [], `语言 ${loc} 缺补充包词条：${missing.join(', ')}`)
  }
})

test('t 支持 {name} 插值', () => {
  locale.value = 'zh-CN'
  const s = t('home.minAgo', { n: 5 })
  assert.match(s, /5/)
})

test('缺失 key 回退为 key 自身且不抛异常', () => {
  locale.value = 'zh-CN'
  // 修复前：import.meta.env.DEV 在非 Vite（如 node 单测 / SSR）环境会抛 TypeError；
  // 修复后（import.meta.env?.DEV）应安全返回 key。
  assert.doesNotThrow(() => t('zzz.definitely.missing'))
  assert.equal(t('zzz.definitely.missing'), 'zzz.definitely.missing')
})
