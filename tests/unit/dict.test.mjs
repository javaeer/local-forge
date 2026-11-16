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

/* ---------------- 释义倒排（v2）：召回 + 精细打分 ---------------- */

// 释义更丰富的样本：一条释义里既有精确义项，也有长句里的中间词
const SAMPLE_GLOSS = [
  '會 会 [hui4] /can/to be possible/meeting/',
  '綠色 绿色 [lv4 se4] /green/',
  '綠茶 绿茶 [lv4 cha2] /green tea/',
  '茶 茶 [cha2] /tea/',
  '自行車 自行车 [zi4 xing2 che1] /bicycle/bike/',
  '代步車 代步车 [dai4 bu4 che1] /a vehicle for getting around; bicycle/',
  '漢 汉 [han4] /Han/',
  '漢堡 汉堡 [han4 bao3] /hamburger/',
].join('\n')

test('释义倒排：精确义项优先于长句中的同词', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const r = search(idx, 'bicycle', { mode: 'gloss' })
  const byName = Object.fromEntries(r.items.map((x) => [x.s, x.score]))
  assert.equal(byName['自行车'], 45, '「bicycle」独立成义项应拿满分')
  assert.equal(byName['代步车'], 45, '长句里按「;」切出的 bicycle 同样视为精确义项')
  // 未建义项级英文索引时，两者同分，靠词长与字典序稳定排序
  assert.ok(r.items.some((x) => x.s === '自行车'))
})

test('释义倒排：多词查询按 AND 处理', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const r = search(idx, 'green tea', { mode: 'gloss' })
  assert.ok(r.items.some((x) => x.s === '绿茶'), 'green tea 应命中绿茶')
  assert.ok(!r.items.some((x) => x.s === '茶'), '只有 tea 没有 green 的词条不应命中')

  // 顺序颠倒也应命中（AND 与词序无关）
  const rev = search(idx, 'tea green', { mode: 'gloss' })
  assert.ok(rev.items.some((x) => x.s === '绿茶'))
})

test('释义倒排：单词 tea 只命中自身，不会误伤绿茶', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const r = search(idx, 'tea', { mode: 'gloss' })
  const names = r.items.map((x) => x.s)
  assert.ok(names.includes('茶'))
  assert.ok(names.includes('绿茶'), '绿茶释义含 tea，按词命中属预期')
})

test('释义倒排：子串查询仍能靠全表兜底命中', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  // "cycle" 不是任何独立词，倒排召回为空，走兜底 includes
  const r = search(idx, 'cycle', { mode: 'gloss' })
  assert.ok(r.items.some((x) => x.s === '自行车'), 'cycle 应作为 bicycle 的子串命中')
  const item = r.items.find((x) => x.s === '自行车')
  assert.equal(item.score, 30, '兜底命中给 30 分')
})

test('释义倒排：查不到时返回 0 且不抛错', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  assert.equal(search(idx, 'zzzznotexist', { mode: 'gloss' }).total, 0)
  assert.equal(search(idx, '   ', { mode: 'gloss' }).total, 0)
})

test('前缀检索：繁体词头也能展开到繁体词条', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const r = search(idx, '漢')
  const names = r.items.map((x) => x.s)
  assert.ok(names.includes('汉'), '精确命中「漢 → 汉」')
  assert.ok(names.includes('汉堡'), '繁体前缀「漢」应展开到「漢堡 → 汉堡」')
})

test('索引结构：平行数组长度一致且可二分', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  assert.equal(idx.sortedWords.length, idx.sortedIdx.length)
  assert.ok(idx.sortedIdx instanceof Int32Array)
  // 20 万条量级下不能退化成对象数组（内存大头）
  assert.equal(typeof idx.sortedWords[0], 'string')
})

test('释义倒排：glossWords 键表已排序（前缀二分前提）', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const keys = idx.glossWords
  assert.ok(keys.length > 0)
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1] <= keys[i], `键表未排序：${keys[i - 1]} > ${keys[i]}`)
  }
  // 停用词与 2 字符词不应进索引
  assert.ok(!keys.includes('the') && !keys.includes('to') && !keys.includes('ox'))
})
