// 离线词典内核单测（纯函数，零 DOM 依赖，node --test 直接跑）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toneMark, stripTones, pinyinInitials,
  parseCedict, parseJsonl, parseTsv, parseDict,
  buildIndex, search, editDistance, stats,
} from '../../src/lib/dict.js'

const SAMPLE = [
  '# CC-CEDICT 注释行应被跳过',
  '會 会 [hui4] /can/to be possible/meeting/',
  '綠色 绿色 [lv4 se4] /green/',
  '你好 你好 [ni3 hao3] /hello/hi/',
  '自行車 自行车 [zi4 xing2 che1] /bicycle/bike/',
].join('\n')

test('toneMark 按拼音方案标调', () => {
  assert.equal(toneMark('ni3 hao3'), 'nǐ hǎo')
  assert.equal(toneMark('lv4 se4'), 'lǜ sè')
  assert.equal(toneMark('zhong1 guo2'), 'zhōng guó')
  assert.equal(toneMark('liu2'), 'liú')   // iu 标在 u 上
  assert.equal(toneMark('gui4'), 'guì')   // ui 标在 i 上
  assert.equal(toneMark('ma5'), 'ma')     // 轻声不标
})

test('stripTones 去调、去空格、ü 折叠为 v', () => {
  assert.equal(stripTones('ni3 hao3'), 'nihao')
  assert.equal(stripTones('lv4 se4'), 'lvse')
  assert.equal(stripTones('nu:3'), 'nv')
})

test('pinyinInitials 取每音节首字母', () => {
  assert.equal(pinyinInitials('ni3 hao3'), 'nh')
  assert.equal(pinyinInitials('zi4 xing2 che1'), 'zxc')
})

test('parseCedict 解析简繁、拼音、多释义并跳注释', () => {
  const list = parseCedict(SAMPLE)
  assert.equal(list.length, 4)
  assert.deepEqual(list[0], { t: '會', s: '会', p: 'hui4', d: ['can', 'to be possible', 'meeting'] })
  assert.equal(list[2].d[0], 'hello')
})

test('parseCedict 支持 max 截断', () => {
  assert.equal(parseCedict(SAMPLE, { max: 2 }).length, 2)
})

test('parseTsv / parseJsonl 兼容导入', () => {
  const tsv = parseTsv('龙\tlong2\t龙；dragon|dragon\n# 注释\n')
  assert.equal(tsv.length, 1)
  assert.deepEqual(tsv[0].d, ['龙；dragon', 'dragon'])

  const jsonl = parseJsonl([
    JSON.stringify({ word: '龙', pinyin: 'long2', senses: [{ glosses: ['dragon'] }] }),
    JSON.stringify({ s: '凤', p: 'feng4', d: ['phoenix'] }),
    'not json',
  ].join('\n'))
  assert.equal(jsonl.length, 2)
  assert.equal(jsonl[0].d[0], 'dragon')
  assert.equal(jsonl[1].s, '凤')
})

test('parseDict 按扩展名与内容嗅探格式', () => {
  assert.equal(parseDict(SAMPLE, 'a.txt').length, 4)
  assert.equal(parseDict('龙\tlong2\t龙', 'x.tsv').length, 1)
  assert.equal(parseDict('{"word":"龙","glosses":["dragon"]}', 'x.jsonl').length, 1)
})

test('editDistance 早停结果正确', () => {
  assert.equal(editDistance('绿色', '绿色', 2), 0)
  assert.equal(editDistance('绿仓', '绿色', 2), 1)
  assert.ok(editDistance('你好', '完全不同的词', 1) > 1)
})

test('search 精确命中简体与繁体，并给出带调拼音', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const a = search(idx, '绿色')
  const b = search(idx, '綠色')
  assert.equal(a.total, 1)
  assert.equal(b.total, 1)
  assert.equal(a.items[0].pm, 'lǜ sè')
})

test('search 中文前缀扩展', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const r = search(idx, '自')
  assert.ok(r.items.some((x) => x.s === '自行车'))
})

test('search 拼音四种写法都能命中', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  for (const q of ['lvse', 'lv4 se4', 'lüse', 'ni hao', 'nh']) {
    const r = search(idx, q)
    assert.ok(r.total > 0, `查询「${q}」应有结果`)
  }
  assert.ok(search(idx, 'lvse').items.some((x) => x.s === '绿色'))
  assert.ok(search(idx, 'nh').items.some((x) => x.s === '你好'))
})

test('search 英文释义反查', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const r = search(idx, 'bicycle', { mode: 'gloss' })
  assert.ok(r.items.some((x) => x.s === '自行车'))
})

test('search 模糊纠错', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const r = search(idx, '绿仓', { mode: 'fuzzy', maxDist: 1 })
  assert.ok(r.items.some((x) => x.s === '绿色'))
})

test('search 空查询与 limit 边界安全', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  assert.equal(search(idx, '   ').total, 0)
  const r = search(idx, '', { limit: 0 })
  assert.equal(r.items.length, 0)
  assert.equal(search(idx, 'a', { limit: 9999 }).items.length <= 500, true)
})

test('stats 统计词条数', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const s = stats(idx)
  assert.equal(s.entries, 4)
  assert.ok(s.words >= 4)
})
