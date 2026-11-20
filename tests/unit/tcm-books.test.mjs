// 方书与医经库（第 7 期）单元测试：解析 + 分片映射 + 检索规则。
// 数据快照不入仓库，涉及快照的断言用 hasSnapshot 跳过；本地跑过 npm run tcmbooks:fetch 后生效。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fx = await import(join(ROOT, 'scripts/fetch-tcmbooks.mjs'))
const search = await import(join(ROOT, 'src/lib/tcmbooksearch.js'))

const hasSnapshot = existsSync(join(ROOT, 'public/tcm/full-index.json.gz'))

test('parseBook：两类块格式（属性：/内容：）与目录层级', () => {
  const src = [
    '<篇名>备急千金要方',
    '书名：备急千金要方',
    '作者：孙思邈',
    '<目录>卷一诸论\\论用药第六',
    '<篇名>论用药第六',
    '属性：夫用药之法。',
    '第二行正文。',
    '<目录>',
    '<篇名>序',
    '内容：序文正文。',
  ].join('\n')
  const a = fx.parseBook(src)
  assert.equal(a.length, 2)
  assert.equal(a[0].dir, '卷一诸论\\论用药第六')
  assert.equal(a[0].name, '论用药第六')
  assert.ok(a[0].body.includes('第二行正文。'), '多行正文完整')
  assert.equal(a[1].name, '序')
  assert.equal(a[1].dir, '')
})

test('cleanBody：缺字 1:1 不猜字、CR 清洗（与第 6 期策略一致）', () => {
  assert.equal(fx.cleanBody('人参\\x 味甘'), '人参　味甘')
  assert.equal(fx.cleanBody('夫清浊剖判，五行 落。\r'), '夫清浊剖判，五行 落。')
  assert.equal(fx.cleanBody('身体强KT KT 然'), '身体强　　然')
  assert.ok(!/\\x|KT|\r/.test(fx.cleanBody('\\xKT 混排')))
  assert.equal(fx.cleanBody('多  余 空格'), '多 余 空格')
})

test('splitDir：序跋与卷/子类拆分', () => {
  assert.deepEqual(fx.splitDir('卷二妇人方上\\求子第一'), { juan: '卷二妇人方上', sub: '求子第一' })
  assert.deepEqual(fx.splitDir('卷第一'), { juan: '卷第一', sub: '' })
  assert.deepEqual(fx.splitDir(''), { juan: '序跋', sub: '' })
})

test('build：分片号/位移回填正确（曾经把书序当全局 id 的回归）', () => {
  const mk = (name, n) => ({
    id: name, name, author: '', era: '',
    entries: Array.from({ length: n }, (_, i) => ({ dir: `卷${i}`, name: `${name}篇${i}`, body: `正文${name}${i}` })),
  })
  const { books, entries, shardFrom, shards } = fx.build([mk('甲', fx.CHUNK + 3), mk('乙', 5)])
  assert.equal(entries.length, fx.CHUNK + 8)
  assert.equal(shards.length, 3) // 甲：满 500 一片 + 余 3 一片；乙：5 一篇
  assert.equal(shardFrom[1], fx.CHUNK)
  assert.equal(shardFrom[2], fx.CHUNK + 3)
  for (let g = 0; g < entries.length; g++) {
    const [, s, off, title] = entries[g]
    assert.equal(shards[s][off][0], title, `第 ${g} 条分片错位`)
  }
  assert.equal(entries[fx.CHUNK + 3][1], 2, '乙书第一篇应在分片 2')
  assert.equal(entries[fx.CHUNK + 3][0], 1, '乙书书序为 1')
})

test('searchEntries：多词 AND / 书内过滤 / 命中摘要', () => {
  const entries = [
    [0, 0, 0, '太阳病篇', '卷一', ''],
    [0, 0, 1, '阳明病篇', '卷二', ''],
    [1, 1, 0, ' herbs', '卷三', ''],
  ]
  const texts = new Map([
    [0, [['太阳病篇', '太阳之为病，脉浮，头项强痛而恶寒。'], ['阳明病篇', '阳明之为病，胃家实是也。']]],
    [1, [[' herbs', '书名与卷次无关，正文含人参与甘草。']]],
  ])
  const shardFrom = [0, 2]
  const r = search.searchEntries({ entries, shardFrom, texts, q: '太阳 脉浮' })
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].title, '太阳病篇')
  assert.ok(/太阳之为病/.test(r.hits[0].snippet))
  const r2 = search.searchEntries({ entries, shardFrom, texts, q: '病', book: 1 })
  assert.equal(r2.hits.length, 0, '书内过滤生效')
  const r3 = search.searchEntries({ entries, shardFrom, texts, q: '太阳' })
  assert.equal(r3.hits.length, 1)
})

test('searchEntries：分片未就绪时只搜标题、并标记 titleOnly', () => {
  const entries = [[0, 0, 0, '论大医精诚', '卷一', ''], [0, 0, 1, '求子第一', '卷二', '妇人方上']]
  const r = search.searchEntries({ entries, shardFrom: [0], texts: new Map(), q: '大医' })
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].title, '论大医精诚')
  assert.equal(r.titleOnly, true)
  assert.equal(r.missing, 1)
  // 正文词在标题里没有 → 未装库搜不到（预期）
  assert.equal(search.searchEntries({ entries, shardFrom: [0], texts: new Map(), q: '精诚'.repeat(0) + '地黄' }).hits.length, 0)
})

test('searchIndex：未装库的纯标题检索', () => {
  const entries = [[0, 0, 0, '辨太阳病脉证并治上', '卷一', ''], [1, 0, 0, '人参', '卷二', '草部']]
  assert.equal(search.searchIndex(entries, '太阳').length, 1)
  assert.equal(search.searchIndex(entries, '人参').length, 1)
  assert.equal(search.searchIndex(entries, '人参', 0).length, 0, '书内过滤')
  assert.deepEqual(search.searchIndex(entries, ''), [])
})

test('snippetOf：命中位置的上下文截取', () => {
  const s = search.snippetOf('甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥子丑寅卯辰巳午未', '辰')
  assert.ok(s.includes('戊'))
  assert.ok(s.includes('…'))
  assert.equal(search.snippetOf('无命中文本', '不存在').length, 5)
})

/* ---------------- 快照相关 ---------------- */

function loadSnapshot() {
  const ix = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/tcm/full-index.json.gz'))).toString('utf8'))
  const files = readdirSync(join(ROOT, 'public/tcm/full')).filter((f) => f.endsWith('.gz')).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
  const shards = files.map((f) => JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/tcm/full', f))).toString('utf8')))
  return { ix, shards }
}

test('快照：9 书 / 篇数 / 分片映射一致', { skip: !hasSnapshot }, () => {
  const { ix, shards } = loadSnapshot()
  assert.equal(ix.books.length, 9)
  assert.ok(ix.entries.length >= 5800)
  assert.equal(ix.shardFrom.length, shards.length)
  for (let g = 0; g < ix.entries.length; g++) {
    const [bi, s, off, title] = ix.entries[g]
    assert.equal(shards[s][off][0], title, `第 ${g} 条错位`)
  }
  for (const shard of shards) {
    for (const [, text] of shard) {
      assert.ok(!/\\x|KT|\r/.test(text))
    }
  }
})

test('快照：关键锚点可检索到正文', { skip: !hasSnapshot }, () => {
  const { ix, shards } = loadSnapshot()
  const find = (title) => {
    const e = ix.entries.find((x) => x[3] === title)
    assert.ok(e, `${title} 条目存在`)
    return shards[e[1]][e[2]][1]
  }
  assert.ok(/脉浮、头项强痛而恶寒/.test(find('辨太阳病脉证并治上')))
  assert.ok(/补五脏/.test(find('人参')))
  const texts = new Map(shards.map((items, s) => [s, items]))
  const r = search.searchEntries({ entries: ix.entries, shardFrom: ix.shardFrom, texts, q: '脉浮 头项强痛' })
  assert.ok(r.hits.some((h) => h.title === '辨太阳病脉证并治上'), 'Worker 规则能命中伤寒论首篇')
})
