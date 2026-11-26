#!/usr/bin/env node
// 拉取 / 更新「古典文学」L2 全量库（第 4 期数据层）。
//
// 与 L1（fetch-poems.mjs）的区别：L1 是随包秒开的精选（868 篇 / 290 KB）；
// L2 是「用户主动决定下载」的全量库，永不预缓存、不进 predev/prebuild、仓库不留快照。
// 前端由 Classics.vue 的全量库面板拉取并缓存到 IndexedDB，本脚本只负责生成静态快照。
//
// 管辖三库（均 chinese-poetry，MIT，公共领域原文）：
//   全唐诗  poet.tang.*.json   ~5.7 万首，58 片，逐片探测到 404 为止
//   全宋词  ci.song.*.json     ~2.1 万首，22 片
//   全元曲  yuanqu.json        1.1 万首，单文件
// 外加繁简字表（OpenCC，Apache-2.0）。
//
// 为什么全量库不做「全宋诗 / 全宋文」：全宋诗 25 万首 ≈ 100 MB 原始，下载与索引的
// 投入产出比最差（方案第三节已论证），且宋诗检索需求远小于唐宋词曲。
//
// 产物：
//   public/classics/full-index.json.gz        全量索引（书 / 片 / 序 / 标题 / 作者）
//   public/classics/full/s{n}.json.gz         分片全文，[[标题, 作者, 正文], ...]
//
// 用法：
//   node scripts/fetch-poems-full.mjs            # 下载并生成（全量数据，约 40 MB 上游）
//   node scripts/fetch-poems-full.mjs --check    # 只校验现有快照（CI）
//   node scripts/fetch-poems-full.mjs --force    # 强制重建
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTS, makeS2T } from './lib/tsconv.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'public/classics'
const FULL_DIR = `${DIR}/full`
const INDEX_OUT = `${DIR}/full-index.json.gz`
const CHECK = process.argv.includes('--check')
const FORCE = process.argv.includes('--force')

const SHARD_SIZE = 2000 // 每片首数；片太大单次下载重试成本高，太小文件数爆炸
const MAX_INDEX_GZIP = 1600 * 1024
const MAX_TOTAL_GZIP = 17 * 1024 * 1024

const MIRRORS = [
  (p) => `https://fastly.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/${encodeURI(p)}`,
  (p) => `https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/${encodeURI(p)}`,
  (p) => `https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/${encodeURI(p)}`,
]

async function getJSON(mirrors, minBytes) {
  const errs = []
  for (const make of mirrors) {
    const url = typeof make === 'string' ? make : make()
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
      if (!res.ok) {
        errs.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < minBytes) {
        errs.push(`${url} → 体积 ${buf.length} < ${minBytes}（疑似截断）`)
        continue
      }
      return JSON.parse(buf.toString('utf8'))
    } catch (e) {
      errs.push(`${url} → ${e.message}`)
    }
  }
  throw new Error(`全部镜像失败：\n  ${errs.join('\n  ')}`)
}

/* ---------------- 上游 → 统一结构 ---------------- */

// 三库字段不同，但都能归一为 { t, a, x }（标题 / 作者 / 正文，正文 \n 连接）
function normTang(list) {
  return list
    .filter((p) => p?.title && p?.paragraphs?.length)
    .map((p) => ({ t: p.title.trim(), a: (p.author || '').trim(), x: p.paragraphs.map((s) => s.trim()).filter(Boolean).join('\n') }))
    .filter((p) => p.x && p.a)
}

function normSong(list) {
  // 全宋词没有 title，以词牌（rhythmic）为目；同词牌多首靠作者区分，与 L1 的做法一致
  return list
    .filter((p) => p?.rhythmic && p?.paragraphs?.length)
    .map((p) => ({ t: p.rhythmic.trim(), a: (p.author || '').trim(), x: p.paragraphs.map((s) => s.trim()).filter(Boolean).join('\n') }))
    .filter((p) => p.x && p.a)
}

function normYuan(list) {
  return list
    .filter((p) => p?.title && p?.paragraphs?.length)
    .map((p) => ({ t: p.title.trim(), a: (p.author || '').trim(), x: p.paragraphs.map((s) => s.trim()).filter(Boolean).join('\n') }))
    .filter((p) => p.x && p.a)
}

function dedup(list) {
  const seen = new Set()
  const out = []
  let n = 0
  for (const it of list) {
    const k = it.t + '\u0001' + it.a + '\u0001' + it.x
    if (seen.has(k)) {
      n++
      continue
    }
    seen.add(k)
    out.push(it)
  }
  return { list: out, dropped: n }
}

/* ---------------- 分片 ---------------- */

function buildShards(books, s2t) {
  // 全书逐首转简体并分片；entries 记录 [全局书序, 全局片序, 片内序, 标题, 作者]。
  // entries 与分片内容按同一顺序生成，因此「全局序号 g」在两端一一对应，
  // shardFrom[s] 记录第 s 片第一条的全局序号，供前端把 (shard, off) 映射回 g。
  const shards = [] // Buffer
  const entries = []
  const shardFrom = []
  let shardNo = 0
  books.forEach((b, bi) => {
    for (let i = 0; i < b.list.length; i += SHARD_SIZE) {
      shardFrom.push(entries.length)
      const slice = b.list.slice(i, i + SHARD_SIZE).map((it) => {
        const t = s2t(it.t)
        const a = s2t(it.a)
        const x = s2t(it.x)
        entries.push([bi, shardNo, 0, t, a])
        return [t, a, x]
      })
      slice.forEach((_, off) => {
        entries[entries.length - slice.length + off][2] = off
      })
      shards.push(gzipSync(Buffer.from(JSON.stringify(slice)), { level: 9 }))
      shardNo++
    }
  })
  return { shards, entries, shardFrom }
}

/* ---------------- 校验 ---------------- */

export function checkIndex(buf) {
  const data = JSON.parse(gunzipSync(buf).toString('utf8'))
  if (data.v !== 1) throw new Error(`索引版本异常：${data.v}`)
  const need = { tang: 55_000, song: 20_000, yuan: 10_500 }
  for (const b of data.books) {
    if (b.n < need[b.id]) throw new Error(`${b.name} 条目过少：${b.n} < ${need[b.id]}`)
    if (b.shards < 1) throw new Error(`${b.name} 无分片`)
  }
  // entries 与分片数一致
  const totalShards = data.books.reduce((s, b) => s + b.shards, 0)
  if (totalShards !== data.shards) throw new Error(`索引分片数 ${data.shards} 与各书合计 ${totalShards} 不符`)
  for (const e of data.entries) {
    if (e[1] < 0 || e[1] >= data.shards) throw new Error(`分片序越界：${e[1]}`)
    if (!e[3] || !e[4]) throw new Error(`索引条目缺标题或作者`)
  }
  if (data.entries.length !== data.books.reduce((s, b) => s + b.n, 0)) throw new Error('索引条目数与各书条数不符')
  return data
}

export function checkShard(buf) {
  const arr = JSON.parse(gunzipSync(buf).toString('utf8'))
  if (!Array.isArray(arr) || !arr.length) throw new Error('分片为空')
  for (const it of arr) {
    if (!Array.isArray(it) || it.length !== 3 || typeof it[2] !== 'string') throw new Error('分片条目结构异常')
    if (!/[\u4e00-\u9fff]/.test(it[2])) throw new Error('分片条目正文无汉字')
  }
  return arr
}

/* ---------------- 主流程 ---------------- */

async function main() {
  mkdirSync(join(ROOT, FULL_DIR), { recursive: true })
  const indexPath = join(ROOT, INDEX_OUT)

  if (CHECK) {
    if (!existsSync(indexPath)) {
      console.error(`✗ 全量库索引不存在：${INDEX_OUT}（请先运行 node scripts/fetch-poems-full.mjs）`)
      process.exit(1)
    }
    try {
      const data = checkIndex(readFileSync(indexPath))
      let bytes = 0, files = 0
      for (const f of readdirSync(join(ROOT, FULL_DIR))) {
        bytes += statSync(join(ROOT, FULL_DIR, f)).size
        files++
      }
      if (files !== data.shards) throw new Error(`分片文件 ${files} 个 ≠ 索引声明的 ${data.shards}`)
      if (bytes > MAX_TOTAL_GZIP) throw new Error(`分片总体积 ${(bytes / 1048576).toFixed(1)} MB 超上限`)
      console.log(`✓ 全量库快照校验通过：${data.books.map((b) => `${b.name} ${b.n}`).join(' · ')} / ${data.shards} 片 / 分片 ${(bytes / 1048576).toFixed(1)} MB / 索引 ${(indexPath && statSync(indexPath).size / 1024).toFixed(0)} KB`)
    } catch (e) {
      console.error(`✗ 全量库快照校验失败：${e.message}`)
      process.exit(1)
    }
    return
  }

  if (!FORCE && existsSync(indexPath)) {
    try {
      checkIndex(readFileSync(indexPath))
      console.log('· 全量库快照已存在且有效，跳过（--force 强制重建）')
      return
    } catch (e) {
      console.log(`· 现有快照无效（${e.message}），重新生成`)
    }
  }

  console.log('· 正在探测全唐诗 / 全宋词分片…')
  async function probeAll(prefix, step = 1000, max = 400) {
    const out = []
    for (let n = 0; n <= max; n++) {
      const file = `${prefix}.${n * step}.json`
      try {
        const list = await getJSON(MIRRORS.map((m) => () => m(file)), 20_000)
        out.push(...list)
        if (n % 10 === 0) console.log(`  · ${file}（累计 ${out.length} 首）`)
      } catch {
        if (n === 0) throw new Error(`${file} 不存在，路径约定已变化`)
        break // 第一片缺失才是致命错误；后续缺失即到末尾
      }
    }
    return out
  }

  const [tang, song, yuan, ts] = await Promise.all([
    probeAll('全唐诗/poet.tang'),
    probeAll('宋词/ci.song'),
    getJSON(MIRRORS.map((m) => () => m('元曲/yuanqu.json')), 1_000_000),
    loadTS(),
  ])
  const s2t = makeS2T(ts)

  const d1 = dedup(normTang(tang))
  const d2 = dedup(normSong(song))
  const d3 = dedup(normYuan(yuan))
  console.log(`· 去重：唐诗 ${tang.length}→${d1.list.length}（去 ${d1.dropped}）宋词 ${song.length}→${d2.list.length}（去 ${d2.dropped}）元曲 ${yuan.length}→${d3.list.length}（去 ${d3.dropped}）`)

  const books = [
    { id: 'tang', name: '全唐诗', list: d1.list },
    { id: 'song', name: '全宋词', list: d2.list },
    { id: 'yuan', name: '全元曲', list: d3.list },
  ]

  console.log('· 正在转简体并分片（全量约两千万字，需要一会）…')
  const { shards, entries, shardFrom } = buildShards(books, s2t)

  const index = {
    v: 1,
    built: new Date().toISOString().slice(0, 10),
    shards: shards.length,
    shardFrom,
    books: books.map((b) => ({ id: b.id, name: b.name, n: b.list.length, shards: Math.ceil(b.list.length / SHARD_SIZE) })),
    entries,
  }
  const indexGz = gzipSync(Buffer.from(JSON.stringify(index)), { level: 9 })
  if (indexGz.length > MAX_INDEX_GZIP) throw new Error(`索引超体积上限：${(indexGz.length / 1024).toFixed(0)} KB`)

  let total = indexGz.length
  writeFileSync(join(ROOT, INDEX_OUT), indexGz)
  for (let i = 0; i < shards.length; i++) {
    writeFileSync(join(ROOT, FULL_DIR, `s${i}.json.gz`), shards[i])
    total += shards[i].length
  }
  if (total > MAX_TOTAL_GZIP) throw new Error(`全量库总体积 ${(total / 1048576).toFixed(1)} MB 超上限 ${MAX_TOTAL_GZIP / 1048576} MB`)

  checkIndex(indexGz)
  console.log(`✓ 已生成 ${INDEX_OUT}（索引 ${(indexGz.length / 1024).toFixed(0)} KB）+ ${shards.length} 个分片`)
  console.log(`  总体积 ${(total / 1048576).toFixed(1)} MB（gzip）`)
  for (const b of books) console.log(`  · ${b.name}：${b.list.length} 首 / ${Math.ceil(b.list.length / SHARD_SIZE)} 片`)
}

// 只在直接运行本脚本时执行 main：`node --test` 里 import 本文件拿到 checkIndex/checkShard
// 时不应触发网络下载。判断依据：命令行入口脚本路径与本模块一致。
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => {
    console.error('✗ ' + e.message)
    process.exit(1)
  })
}
