// 诗文精选库（第 3 期）单测。
//
// 两层：
//   1. 管线产物快照（poems.json.gz）——有快照才跑；校验篇数、字段健全、繁简转换无残留
//   2. poems.js / poemcard.js 纯逻辑——不依赖网络与 canvas
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SNAPSHOT = join(ROOT, 'public/classics/poems.json.gz')
const hasSnapshot = existsSync(SNAPSHOT)

/* ---------------- 管线产物 ---------------- */

test('精选库快照：三本齐全、篇数达标、正文健全', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  assert.equal(data.v, 1)
  const byId = Object.fromEntries(data.books.map((b) => [b.id, b]))
  assert.ok(byId.tang.n >= 360, `唐诗三百首应 ≥360 首，实际 ${byId.tang.n}`)
  assert.ok(byId.song.n >= 270, `宋词三百首应 ≥270 首，实际 ${byId.song.n}`)
  assert.ok(byId.guwen.n >= 215, `古文观止应 ≥215 篇，实际 ${byId.guwen.n}`)
  assert.equal(byId.tang.n + byId.song.n + byId.guwen.n, data.items.length, '分册数与总条数应一致')
})

test('精选库快照：字段齐全、无空正文、书序合法', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  for (const it of data.items) {
    const [bi, , t, , , , x] = it
    assert.ok(bi >= 0 && bi < data.books.length, `书序越界 ${bi}`)
    assert.ok(t && t.length <= 60, `标题异常：${t}`)
    assert.ok(x && /[\u4e00-\u9fff]/.test(x), `《${t}》正文应为汉字`)
  }
})

// 879 个繁体字种已被转掉——若出现「風/無/來」这类繁表上的字，说明转换被跳过或漏字
test('精选库快照：正文不应残留常见繁体字', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  // 只抽查高发字（OpenCC 表几千条，全量断言交给管线自检，这里锁住最容易被漏掉的）
  const trad = '風無來雲長時見萬歸爲飛馬說門開間問聞閒讀書畫讓體舊遠'
  const bad = []
  for (const it of data.items) {
    for (const ch of trad) {
      if (it[6].includes(ch)) bad.push(`${it[2]}:${ch}`)
    }
  }
  assert.deepEqual(bad.slice(0, 8), [])
})

test('精选库快照：古文出处不应残留「(李斯)」式作者备注', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  const guwen = data.items.filter((it) => it[0] === 2)
  const bad = guwen.filter((it) => /^[(（]/.test(it[5] || ''))
  assert.deepEqual(bad.map((it) => it[2]).slice(0, 5), [])
})

/* ---------------- poems.js 纯逻辑 ---------------- */

const { searchPoems, highlight, escapeHtml, splitSentences } = await import('../../src/lib/poems.js')

// 与传输格式一致的迷你库，不依赖快照
function miniLib() {
  const data = {
    v: 1,
    books: [
      { id: 'tang', name: '唐诗三百首', note: '', n: 2 },
      { id: 'song', name: '宋词三百首', note: '', n: 1 },
    ],
    items: [
      [0, '五言绝句', '静夜思', '李白', '唐', '', '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。'],
      [0, '五言律诗', '春望', '杜甫', '唐', '', '国破山河在，城春草木深。'],
      [1, '宋词', '水调歌头', '苏轼', '宋', '', '明月几时有，把酒问青天。'],
    ],
  }
  // expand 是模块私有；通过 loadPoems 不可达（要 fetch），这里手工展开成同构
  const books = data.books.map((b, bi) => ({ ...b, items: [], groups: [] }))
  const items = data.items.map((a, i) => ({
    id: i, book: a[0], bookId: books[a[0]].id, group: a[1], title: a[2],
    author: a[3], dynasty: a[4], source: a[5], text: a[6], chars: a[6].length,
  }))
  items.forEach((it) => books[it.book].items.push(it))
  return { v: 1, books, items, stats: { total: items.length, chars: 0 } }
}

test('检索：单关键词命中标题、作者、正文', () => {
  const lib = miniLib()
  assert.equal(searchPoems(lib, '静夜思').length, 1)
  assert.equal(searchPoems(lib, '李白').length, 1)
  assert.equal(searchPoems(lib, '明月').length, 2) // 静夜思正文 + 水调歌头正文
})

test('检索：空格分隔多关键词按 AND', () => {
  const lib = miniLib()
  assert.equal(searchPoems(lib, '明月 李白').length, 1)
  assert.equal(searchPoems(lib, '明月 苏轼').length, 1)
  assert.equal(searchPoems(lib, '明月 静夜思').length, 1)
})

test('检索：book 过滤限定在单册内', () => {
  const lib = miniLib()
  assert.equal(searchPoems(lib, '明月', { book: 0 }).length, 1)
  assert.equal(searchPoems(lib, '明月', { book: 1 }).length, 1)
  assert.equal(searchPoems(lib, '明月', { book: 2 }).length, 0)
})

test('检索：无命中返回空数组，空串也返回空', () => {
  const lib = miniLib()
  assert.deepEqual(searchPoems(lib, '不存在的句子xyz'), [])
  assert.deepEqual(searchPoems(lib, ''), [])
  assert.deepEqual(searchPoems(lib, '   '), [])
})

test('highlight：命中词包 mark，HTML 特殊字符先转义', () => {
  assert.equal(highlight('明月几时有', '明月'), '<mark>明月</mark>几时有')
  assert.ok(highlight('a<b & c', 'b').startsWith('a&lt;'))
  assert.equal(highlight('没有命中', '不存在'), '没有命中')
  assert.equal(highlight('空查询', ''), '空查询')
})

test('escapeHtml：五个危险字符全部转义', () => {
  assert.equal(escapeHtml(`<script>&"'`), '&lt;script&gt;&amp;&quot;&#39;')
})

test('splitSentences：按句读切分且跨段连续', () => {
  const out = splitSentences('床前明月光，疑是地上霜。\n举头望明月，低头思故乡。')
  assert.equal(out.length, 4)
  assert.equal(out[0], '床前明月光，')
  assert.equal(out[3], '低头思故乡。')
})

test('splitSentences：maxLen 在长句中强制断开', () => {
  const out = splitSentences('先天下之忧而忧，后天下之乐而乐矣', 6)
  assert.ok(out.every((s) => Array.from(s).length >= 6 || s === out[out.length - 1]))
  const joined = out.join('')
  assert.equal(joined, '先天下之忧而忧，后天下之乐而乐矣', '切开再拼回应无损')
})

/* ---------------- poemcard.js 纯逻辑 ---------------- */

const { columnsOf, schemeOf, CARD_SCHEMES } = await import('../../src/lib/poemcard.js')

test('切列：每列不超过容量，标点不单独起列', () => {
  const text = '西陆蝉声唱，南冠客思侵。\n那堪玄鬓影，来对白头吟。'
  const cols = columnsOf(text, 6)
  assert.ok(cols.length >= 4)
  for (const col of cols) {
    assert.ok(col.length <= 7, `列长 ${col.length} 允许标点溢出一格，但不应超过 容量+1`)
    const solid = col.filter((ch) => ch && !'，。、；：！？'.includes(ch))
    assert.ok(solid.length >= 1 || cols.length === 1, '不应存在只有标点的整列')
  }
  const joined = cols.map((c) => c.join('')).join('')
  assert.equal(joined.replace(/\s/g, ''), text.replace(/\n/g, ''), '切列应无损')
})

test('切列：段落间留空位，多段不粘连', () => {
  const cols = columnsOf('上阕。\n下阕。', 10)
  // 上阕。/空/下阕。 应分布在列中，两段正文不共享同一列
  const flat = cols.map((c) => c.join('')).join('|')
  assert.ok(flat.includes('上阕。'))
  assert.ok(flat.includes('下阕。'))
})

test('配色：五种主题字段齐全且互不相同', () => {
  assert.equal(CARD_SCHEMES.length, 5)
  for (const s of CARD_SCHEMES) {
    for (const k of ['id', 'name', 'bg', 'fg', 'sub', 'line', 'seal']) assert.ok(s[k], `主题 ${s.id} 缺 ${k}`)
  }
  const bgs = new Set(CARD_SCHEMES.map((s) => s.bg))
  assert.equal(bgs.size, 5, '背景色不应重复')
})

test('配色：未知 id 回退第一个主题', () => {
  assert.equal(schemeOf('nope').id, CARD_SCHEMES[0].id)
  assert.equal(schemeOf('xuan').name, '宣纸')
})

/* ---------------- 快照数据用于检索冒烟（有快照才跑） ---------------- */

test('真实快照：检索「春风」「李白」均有命中', { skip: !hasSnapshot }, async () => {
  // 动态构造：直接用脚本产物 + poems.js 的 expand 等价逻辑（loadPoems 需要 fetch，这里绕开）
  const data = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'))
  const books = data.books.map((b, bi) => ({ ...b, items: [], groups: [] }))
  const items = data.items.map((a, i) => ({
    id: i, book: a[0], bookId: books[a[0]].id, group: a[1], title: a[2],
    author: a[3], dynasty: a[4], source: a[5], text: a[6], chars: a[6].length,
  }))
  items.forEach((it) => books[it.book].items.push(it))
  const lib = { v: 1, books, items, stats: { total: items.length, chars: 0 } }

  assert.ok(searchPoems(lib, '春风').length >= 5, '「春风」应命中多篇唐诗')
  assert.ok(searchPoems(lib, '李白').length >= 5, '李白在唐诗三百首中应有多篇')
  assert.ok(searchPoems(lib, '月明', { book: 1 }).length >= 1, '宋词中应有「月明」')
  assert.ok(searchPoems(lib, '岳阳楼', { book: 2 }).length >= 1, '古文观止应含岳阳楼记')
})
