// 全量库（L2）单测：检索纯逻辑 + 快照结构（有快照才跑）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const INDEX_FILE = join(ROOT, 'public/classics/full-index.json.gz')
const SHARD_DIR = join(ROOT, 'public/classics/full')
const hasIndex = existsSync(INDEX_FILE)

const { searchEntries, snippetOf } = await import('../../src/lib/poemsearch.js')
const { checkIndex, checkShard } = await import('../../scripts/fetch-poems-full.mjs')

/* ---------------- 检索纯逻辑 ---------------- */

function miniIndex() {
  // 2 本书 / 3 片：book0 有片 0、1（各 2 首），book1 有片 2（2 首，模拟未加载）
  const entries = [
    [0, 0, 0, '静夜思', '李白'],
    [0, 0, 1, '春望', '杜甫'],
    [0, 1, 0, '月下独酌', '李白'],
    [0, 1, 1, '望岳', '杜甫'],
    [1, 2, 0, '水调歌头', '苏轼'],
    [1, 2, 1, '念奴娇', '苏轼'],
  ]
  const shardFrom = [0, 2, 4] // 片 0 起 g0、片 1 起 g2、片 2 起 g4
  const texts = new Map([
    [0, [['静夜思', '李白', '床前明月光，疑是地上霜。'], ['春望', '杜甫', '国破山河在，城春草木深。']]],
    // 片 1、片 2 未加载
  ])
  return { entries, shardFrom, texts }
}

test('检索：命中已加载分片的正文', () => {
  const idx = miniIndex()
  const r = searchEntries({ ...idx, q: '明月' })
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].title, '静夜思')
  assert.ok(r.hits[0].snippet.includes('明月'))
})

test('检索：多关键词 AND', () => {
  const idx = miniIndex()
  assert.equal(searchEntries({ ...idx, q: '明月 李白' }).hits.length, 1)
  assert.equal(searchEntries({ ...idx, q: '明月 苏轼' }).hits.length, 0)
  // 标题作者补扫：未加载片里「水调歌头」标题含「水调」
  const r = searchEntries({ ...idx, q: '水调' })
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].title, '水调歌头')
  assert.equal(r.hits[0].snippet, '') // 未加载分片没有正文片段
  assert.equal(r.missing, 2, '有 2 片未加载，只能标题作者补扫')
})

test('检索：book 过滤', () => {
  const idx = miniIndex()
  const r = searchEntries({ ...idx, q: '李白', book: 0 })
  assert.equal(r.hits.length, 2)
  const r2 = searchEntries({ ...idx, q: '李白', book: 1 })
  assert.deepEqual(r2.hits, [])
})

test('检索：limit 截断', () => {
  const idx = miniIndex()
  const r = searchEntries({ ...idx, q: '李白', limit: 1 })
  assert.equal(r.hits.length, 1)
  assert.equal(r.truncated, true)
})

test('检索：空查询返回空', () => {
  const idx = miniIndex()
  for (const q of ['', '   ', null]) {
    assert.deepEqual(searchEntries({ ...idx, q }).hits, [])
  }
})

test('snippet：截取带省略号、无损重组', () => {
  const text = '床前明月光，疑是地上霜。举头望明月，低头思故乡。'
  const s = snippetOf(text, '地上霜')
  assert.ok(s.includes('地上霜'))
  const s2 = snippetOf('短文', '短')
  assert.equal(s2, '短文')
})

/* ---------------- 快照结构（有快照才跑） ---------------- */

test('全量库索引：三库齐全、校验器通过', { skip: !hasIndex }, () => {
  const data = checkIndex(readFileSync(INDEX_FILE))
  const byId = Object.fromEntries(data.books.map((b) => [b.id, b]))
  assert.ok(byId.tang.n >= 55_000, `全唐诗应 ≥5.5 万，实际 ${byId.tang.n}`)
  assert.ok(byId.song.n >= 20_000, `全宋词应 ≥2 万，实际 ${byId.song.n}`)
  assert.ok(byId.yuan.n >= 10_500, `全元曲应 ≥1.05 万，实际 ${byId.yuan.n}`)
  assert.equal(data.shardFrom.length, data.shards)
})

test('全量库索引：entries 与分片一一对应（抽 3 片逐条核）', { skip: !hasIndex }, () => {
  const data = checkIndex(readFileSync(INDEX_FILE))
  const files = readdirSync(SHARD_DIR).filter((f) => f.endsWith('.gz'))
  assert.equal(files.length, data.shards, '分片文件数应与索引一致')
  // 抽首、中、尾三片对拍
  const picks = [0, Math.floor(data.shards / 2), data.shards - 1]
  for (const s of picks) {
    const buf = readFileSync(join(SHARD_DIR, `s${s}.json.gz`))
    const items = checkShard(buf)
    const from = data.shardFrom[s]
    items.forEach((it, off) => {
      const meta = data.entries[from + off]
      assert.equal(meta[1], s, `第 ${s} 片第 ${off} 条的分片序应一致`)
      assert.equal(meta[2], off, `片内序应一致`)
      assert.equal(meta[3], it[0], `标题应一致`)
      assert.equal(meta[4], it[1], `作者应一致`)
      assert.equal(it[2], data.entries[from + off] ? it[2] : '', '正文存在')
    })
  }
})

test('全量库快照：总体积在预算内', { skip: !hasIndex }, () => {
  let bytes = statSync(INDEX_FILE).size
  for (const f of readdirSync(SHARD_DIR)) bytes += statSync(join(SHARD_DIR, f)).size
  assert.ok(bytes <= 17 * 1024 * 1024, `全量库应 ≤17 MB，实际 ${(bytes / 1048576).toFixed(1)} MB`)
})
