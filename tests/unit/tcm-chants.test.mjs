// 中医药歌诀库（第 5 期）单测。
//
// 两层：
//   1. 管线产物快照（tcmchants.json.gz）——有快照才跑；校验条数、占位清洗、勘误拆分生效
//   2. tcmchants.js 纯逻辑（检索 / 遮盖 / 默写比对）——不依赖网络与 DOM
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SNAPSHOT = join(ROOT, 'public/tcm/tcmchants.json.gz')
const hasSnapshot = existsSync(SNAPSHOT)

const { searchChants, splitVerses, maskVerse, checkDictation } = await import('../../src/lib/tcmchants.js')

/* ---------------- 管线产物 ---------------- */

test('歌诀库快照：八书齐全、条数达标、分册一致', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  assert.equal(data.v, 1)
  const byId = Object.fromEntries(data.books.map((b) => [b.id, b]))
  const floors = { tang: 170, mai: 24, sibaiwei: 340, yaoxingfu: 100, sanzijing: 55, changsha: 85, jinkui: 140, shifang: 65 }
  for (const [id, n] of Object.entries(floors)) {
    assert.ok(byId[id]?.n >= n, `${id} 应 ≥${n}，实际 ${byId[id]?.n}`)
  }
  assert.equal(
    data.books.reduce((s, b) => s + b.n, 0),
    data.items.length,
    '分册数与总条数应一致',
  )
})

test('歌诀库快照：无上游占位符残留、韵文含汉字', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  for (const [bi, , title, verse, note] of data.items) {
    assert.ok(bi >= 0 && bi < data.books.length, `书序越界 ${bi}`)
    assert.ok(title && verse, `《${title}》空标题或空韵文`)
    assert.ok(/[\u4e00-\u9fff]/.test(verse), `《${title}》韵文应为汉字`)
    assert.doesNotMatch(verse + note, /\\x|KT/, `《${title}》残留占位符`)
    assert.ok(!verse.includes('\r'), `《${title}》含 CR`)
  }
})

test('药性歌括四百味：勘误拆分生效（白朮/茯苓不再粘连、黄芪缺字有标注）', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  const items = data.items.filter((it) => it[0] === data.books.findIndex((b) => b.id === 'sibaiwei'))
  const titles = items.map((it) => it[2])
  for (const t of ['人参', '黄芪', '白朮', '茯苓', '当归', '桂枝', '葶苈', '生姜']) {
    assert.ok(titles.includes(t), `勘误拆分后应存在条目「${t}」`)
  }
  const huangqi = items.find((it) => it[2] === '黄芪')
  assert.match(huangqi[4], /缺字/, '黄芪条目应标注原文缺字')
  assert.match(huangqi[3], /　/, '黄芪韵文应保留空格占位（不猜字）')
})

test('汤头歌诀：韵文不应混入按语（X曰。）与属性前缀', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  const tang = data.items.filter((it) => it[0] === 0)
  const bad = tang.filter((it) => /^属性：/.test(it[3]) || /[\u4e00-\u9fff]曰。/.test(it[3]))
  assert.deepEqual(bad.map((it) => it[2]).slice(0, 5), [], `混入按语的条目：${bad.map((it) => it[2])}`)
})

test('医学三字经：韵文为三字句序列（占位符配对提取成功）', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  const szj = data.items.filter((it) => it[0] === data.books.findIndex((b) => b.id === 'sanzijing'))
  assert.ok(szj.length >= 55, `三字经应 ≥55 条，实际 ${szj.length}`)
  const first = szj[0]
  const line1 = first[3].split('\n')[0]
  const hanzi = line1.replace(/[　\s]/g, '')
  assert.equal(hanzi.length % 3, 0, `三字经句应为三字倍数：「${line1}」`)
})

/* ---------------- tcmchants.js 纯逻辑 ---------------- */

// 构造一个最小 lib（结构与 expand 展开后的形态一致）
function miniLib() {
  return {
    books: [
      { id: 'tang', name: '汤头歌诀', author: '清·汪昂', items: [] },
      { id: 'mai', name: '濒湖脉学', author: '明·李时珍', items: [] },
    ],
    items: [
      { id: 0, book: 0, group: '补益之剂', title: '四君子汤', verse: '参术茯苓甘草比', note: '人参、白术、茯苓' },
      { id: 1, book: 0, group: '发表之剂', title: '麻黄汤', verse: '麻黄汤中用桂枝', note: '' },
      { id: 2, book: 1, group: '脉学', title: '浮（阳）', verse: '浮脉惟从肉上行', note: '举之有余' },
    ],
  }
}

test('searchChants：多词 AND 命中 + 书内过滤 + 高亮转义', () => {
  const lib = miniLib()
  assert.equal(searchChants(lib, '桂枝').length, 1)
  assert.equal(searchChants(lib, '麻黄 桂枝').length, 1)
  assert.equal(searchChants(lib, '不存在词').length, 0)
  assert.equal(searchChants(lib, '浮脉', { book: 1 }).length, 1)
  assert.equal(searchChants(lib, '浮脉', { book: 0 }).length, 0)
  // 检索词含 HTML 时应被转义（防注入）
  const r = searchChants(lib, '<b>桂枝</b>')
  assert.deepEqual(r, [])
})

test('splitVerses：按句读断行，无标点的四字句按 8 字分组', () => {
  assert.deepEqual(splitVerses('医之始 本岐黄\n灵枢作 素问详'), ['医之始 本岐黄', '灵枢作 素问详'])
  assert.deepEqual(splitVerses('人参味甘，大补元气，止渴生津，调荣养卫。'), [
    '人参味甘，大补元气，',
    '止渴生津，调荣养卫。',
  ])
  // 长句在 8 字处强制断开
  const long = splitVerses('一二三四五六七八九十一二三四五六七八')
  assert.ok(long.every((l) => [...l].length <= 10))
})

test('maskVerse：标点不遮、首字模式留头字、同 seed 可复现', () => {
  const lines = ['人参味甘，大补元气。']
  // blank 模式：标点永不遮
  const m1 = maskVerse(lines, 1, 'blank', 42)
  assert.ok(m1[0].every((c) => (/[，。]/.test(c.ch) ? !c.mask : true)))
  // 100% 遮盖时非标点全部为 ●
  assert.ok(m1[0].filter((c) => c.mask).length >= 7)
  // first 模式：首字可见，其余汉字遮
  const m2 = maskVerse(lines, 1, 'first')
  assert.equal(m2[0][0].mask, false)
  assert.equal(m2[0][2].mask, true) // 「味」
  // 同 seed 结果一致
  assert.deepEqual(maskVerse(lines, 0.5, 'blank', 7), maskVerse(lines, 0.5, 'blank', 7))
  // 不同 seed 大概率不同（挖空位不同）
  assert.notDeepEqual(maskVerse(lines, 0.5, 'blank', 1), maskVerse(lines, 0.5, 'blank', 2))
})

test('checkDictation：LCS 逐字对齐、全对满分、漏字错字扣分', () => {
  const r1 = checkDictation('人参味甘，大补元气。', '人参味甘，大补元气。')
  assert.equal(r1.score, 1)
  assert.ok(r1.marks.every((m) => m.ok))

  const r2 = checkDictation('人参味甘大补元气', '人参味甘，大补元气。') // 漏标点（空白忽略后仍差标点）
  assert.ok(r2.score < 1)

  const r3 = checkDictation('人参味辛，大补元气。', '人参味甘，大补元气。') // 一个错字
  assert.equal(r3.score, 9 / 10)
  const bad = r3.marks.filter((m) => !m.ok)
  assert.equal(bad.length, 1)
  assert.equal(bad[0].ch, '甘')

  const r4 = checkDictation('', '人参味甘。')
  assert.equal(r4.score, 0)
})
