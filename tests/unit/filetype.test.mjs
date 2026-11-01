// 文件类型识别单测（纯按扩展名归类）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extOf, typeOfName, TYPE_META, FILTER_ORDER, FILTER_LABEL_KEY } from '../../src/lib/filetype.js'

test('extOf 取末段扩展名并小写（忽略 query/fragment，隐藏文件视为无扩展名）', () => {
  assert.equal(extOf('a/b/C.zip?x=1'), 'zip')
  assert.equal(extOf('noext'), '')
  assert.equal(extOf('.gitignore'), '')
})

test('typeOfName 映射常见扩展名', () => {
  assert.equal(typeOfName('x.png'), 'image')
  assert.equal(typeOfName('x.MP4'), 'video')
  assert.equal(typeOfName('x.tar.gz'), 'archive')
  assert.equal(typeOfName('x.md'), 'text')
  assert.equal(typeOfName('x.unknown'), 'other')
})

test('svg 同时出现在 image 与 text，最终归 text', () => {
  assert.equal(typeOfName('icon.svg'), 'text')
})

test('TYPE_META 覆盖全部 FILTER_ORDER（除 all）', () => {
  for (const t of FILTER_ORDER) {
    if (t === 'all') continue
    assert.ok(TYPE_META[t], `FILTER_ORDER 含未定义元数据的类型：${t}`)
  }
})

test('FILTER_LABEL_KEY 每个筛选项都有 i18n key', () => {
  for (const [k, v] of Object.entries(FILTER_LABEL_KEY)) {
    assert.match(v, /^home\.filter/)
  }
})
