#!/usr/bin/env node
// 拉取 / 更新「古典文学」L1 精选库（第 3 期数据层）。
//
// 与 fetch-classics.mjs / fetch-citunes.mjs 同一套约定：数据是「数据」不是「代码」，
// 仓库不保留快照（public/classics/*.gz 已 gitignore），predev / prebuild 自动补齐。
//
// 管辖 L1 三本选本（共 868 篇，全部为公共领域原文，无注释译文，规避版权风险）：
//   1. 唐诗三百首  366 首   chinese-poetry/全唐诗/唐诗三百首.json      MIT
//   2. 宋词三百首  280 首   chinese-poetry/宋词/宋词三百首.json        MIT
//   3. 古文观止    222 篇   chinese-poetry/蒙学/guwenguanzhi.json      MIT
// 外加繁→简字表（BYVoid/OpenCC，Apache-2.0）。
//
// 为什么必须转简体：三本源数据全是繁体（「風/無/來/雲/長」），而产品 UI 是简体、
// 用户输入是简体。若不转，用户搜「春风」搜不到「春風」，格律校验也会因字不在平水韵表里
// 而大面积报「未知」。OpenCC 的 TSCharacters 是繁→简单向表，一对多歧义只存在于简→繁方向，
// 所以这个方向转换是确定的、可逆性不需要保证。
//
// 体积：三本原始 JSON 共 817 KB（key 重复、段落数组被引号逗号淹没），
// 转为「一本书一份、一篇一个数组」的紧凑结构后 493 KB，gzip 后 168 KB。
//
// 用法：
//   node scripts/fetch-poems.mjs              # 下载并生成
//   node scripts/fetch-poems.mjs --if-missing # dev / build 钩子：快照有效即跳过
//   node scripts/fetch-poems.mjs --check      # 只校验现有快照，不联网（CI 用）
//   node scripts/fetch-poems.mjs --force      # 忽略现有快照，强制重下
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'public/classics'
const OUT = `${DIR}/poems.json.gz`
const CHECK = process.argv.includes('--check')
const FORCE = process.argv.includes('--force')
const IF_MISSING = process.argv.includes('--if-missing')

// 体积上限（gzip 后）。超了说明转码策略退化（比如又把 key 带回来了），必须拦下而不是默默发布。
// 三本共 19.9 万字，古文的生僻字多、重复少，gzip 压缩率只有 1.5:1。留 15% 余量。
const MAX_GZIP = 340 * 1024

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
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) {
        errs.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      // 断点续传 / 代理截断会给出「HTTP 200 + 半个文件」，长度下限是唯一便宜的拦截手段
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

/* ---------------- 繁 → 简 ---------------- */

async function getText(mirrors, minBytes) {
  const errs = []
  for (const url of mirrors) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (!res.ok) {
        errs.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const txt = await res.text()
      if (txt.length < minBytes) {
        errs.push(`${url} → 体积 ${txt.length} < ${minBytes}（疑似截断）`)
        continue
      }
      return txt
    } catch (e) {
      errs.push(`${url} → ${e.message}`)
    }
  }
  throw new Error(`繁简字表全部镜像失败：\n  ${errs.join('\n  ')}`)
}

async function loadTS() {
  const raw = await getText(
    [
      'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt',
      'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/TSCharacters.txt',
    ],
    60_000,
  )
  const map = new Map()
  for (const line of String(raw).split('\n')) {
    if (!line || line[0] === '#') continue
    const [k, v] = line.split('\t')
    if (!k || !v) continue
    // 一对多时取首选项（OpenCC 的约定是首选放第一个）
    map.set(k, v.split(' ')[0])
  }
  if (map.size < 3000) throw new Error(`繁简字表条目过少：${map.size}`)
  return map
}

function makeS2T(map) {
  const s2t = (s) => {
    let out = ''
    for (const ch of s) out += map.get(ch) || ch
    return out
  }
  return s2t
}

/* ---------------- 三本源数据 → 统一结构 ---------------- */

const BOOKS = [
  { id: 'tang', name: '唐诗三百首', note: '清·蘅塘退士编' },
  { id: 'song', name: '宋词三百首', note: '清·朱孝臧编' },
  { id: 'guwen', name: '古文观止', note: '清·吴楚材、吴调侯编' },
]

const GENRES = ['五言绝句', '七言绝句', '五言律诗', '七言律诗', '五言古诗', '七言古诗', '乐府']

// 唐诗三百首：扁平列表，体裁藏在 tags 里；标题形如「在嶽詠蟬」
function readTang(raw) {
  if (!Array.isArray(raw) || raw.length < 300) throw new Error(`唐诗三百首条数异常：${raw?.length}`)
  const out = []
  for (const p of raw) {
    const title = (p.title || '').trim()
    const paras = (p.paragraphs || []).map((s) => s.trim()).filter(Boolean)
    if (!title || !paras.length) continue
    const tags = p.tags || []
    // 17 首的 tags 里没有任何体裁标签（源数据缺），归入「其他」而不是把书名当体裁
    const genre = GENRES.find((g) => tags.includes(g)) || '其他'
    out.push({ g: genre, t: title, a: (p.author || '').trim(), d: '唐', s: '', x: paras.join('\n') })
  }
  return out
}

// 宋词三百首：无 title，以词牌（rhythmic）为名；正文按句分行
function readSong(raw) {
  if (!Array.isArray(raw) || raw.length < 250) throw new Error(`宋词三百首条数异常：${raw?.length}`)
  const out = []
  for (const p of raw) {
    const paras = (p.paragraphs || []).map((s) => s.trim()).filter(Boolean)
    const tune = (p.rhythmic || '').trim()
    if (!tune || !paras.length) continue
    out.push({ g: '宋词', t: tune, a: (p.author || '').trim(), d: '宋', s: '', x: paras.join('\n') })
  }
  return out
}

// 古文观止：12 卷，每卷 content 是文章；author 形如「先秦：左丘明 」
function readGuwen(raw) {
  const vols = raw?.content
  if (!Array.isArray(vols) || vols.length < 10) throw new Error(`古文观止卷数异常：${vols?.length}`)
  const out = []
  for (const vol of vols) {
    const group = (vol.title || '').replace(/・/g, '·').trim()
    for (const art of vol.content || []) {
      const paras = (art.paragraphs || []).map((s) => s.trim()).filter(Boolean)
      const title = (art.chapter || '').trim()
      if (!title || !paras.length) continue
      const rawAuthor = (art.author || '').trim()
      const m = rawAuthor.match(/^([^：:]{1,6})[：:]\s*(.*)$/)
      const dyn = m ? m[1].trim() : ''
      const author = (m ? m[2] : rawAuthor).trim()
      // 源数据里 source 有两种含义：真出处（「左传」「战国策」）与作者备注（「(李斯)」）。
      // 后者与 author 重复，去掉括号形式的一律置空，避免正文上方出现「(李斯) · 李斯」。
      const srcRaw = (art.source || '').replace(/[《》]/g, '').trim()
      const src = /^[(（].*[)）]$/.test(srcRaw) ? '' : srcRaw
      out.push({ g: group, t: title, a: author, d: dyn, s: src, x: paras.join('\n') })
    }
  }
  return out
}

/* ---------------- 紧凑化 ---------------- */

// items 用定长数组而非对象：8.9 万个字段名省下来是几十 KB，且 gzip 后仍然是净收益。
//   0=书序 1=分组 2=标题 3=作者 4=朝代 5=出处 6=正文
function pack(books) {
  const items = []
  books.forEach((b, bi) => {
    for (const it of b.items) items.push([bi, it.g, it.t, it.a, it.d, it.s, it.x])
  })
  return {
    v: 1,
    books: books.map((b) => ({ id: b.id, name: b.name, note: b.note, n: b.items.length })),
    items,
  }
}

function unpack(data) {
  const books = data.books.map((b) => ({ ...b, items: [] }))
  for (const [bi, g, t, a, d, s, x] of data.items) {
    books[bi].items.push({ g, t, a, d, s, x })
  }
  return books
}

// 往返自检：转码写坏（比如字段错位）在这层就炸，不会带着坏数据上线
function roundTrip(books, data) {
  const back = unpack(data)
  if (back.length !== books.length) throw new Error('自检失败：书数不符')
  let n = 0
  books.forEach((b, i) => {
    if (back[i].items.length !== b.items.length) throw new Error(`自检失败：${b.name} 篇数不符`)
    b.items.forEach((it, j) => {
      const o = back[i].items[j]
      for (const k of ['g', 't', 'a', 'd', 's', 'x']) {
        if (o[k] !== it[k]) throw new Error(`自检失败：${b.name} 第 ${j + 1} 篇字段 ${k} 不符`)
      }
      n++
    })
  })
  return n
}

/* ---------------- 校验（--check，不联网） ---------------- */

export function checkSnapshot(buf) {
  const raw = gunzipSync(buf)
  const data = JSON.parse(raw.toString('utf8'))
  if (data.v !== 1) throw new Error(`schema 版本异常：${data.v}`)
  const stats = {}
  for (const b of data.books) stats[b.id] = b.n
  if (stats.tang < 360 || stats.song < 270 || stats.guwen < 215) {
    throw new Error(`分册篇数不足：唐诗 ${stats.tang} / 宋词 ${stats.song} / 古文 ${stats.guwen}`)
  }
  // 逐条基本健全性：标题非空、正文含汉字、无换行残留
  let chars = 0
  const bookNames = data.books.map((b) => b.name)
  for (const [bi, g, t, a, d, s, x] of data.items) {
    if (bi < 0 || bi >= data.books.length) throw new Error(`书序越界：${bi}`)
    if (!t || !x) throw new Error(`${bookNames[bi]} 存在空标题或空正文`)
    if (!/[\u4e00-\u9fff]/.test(x)) throw new Error(`${bookNames[bi]}《${t}》正文无汉字`)
    if (x.includes('\r')) throw new Error(`${bookNames[bi]}《${t}》正文含 CR`)
    chars += x.length
  }
  // 三本实测约 19.9 万字（古文观止占 15 万），下限卡在 18 万，少于此数说明有书没拉到或解析漏段
  if (chars < 180_000) throw new Error(`正文总字数过少：${chars}`)
  return { stats, items: data.items.length, chars, gzip: buf.length }
}

/* ---------------- 主流程 ---------------- */

async function main() {
  mkdirSync(join(ROOT, DIR), { recursive: true })
  const outPath = join(ROOT, OUT)

  if (CHECK) {
    if (!existsSync(outPath)) {
      console.error(`✗ 快照不存在：${OUT}（请先运行 node scripts/fetch-poems.mjs）`)
      process.exit(1)
    }
    try {
      const r = checkSnapshot(readFileSync(outPath))
      console.log(`✓ 精选库快照校验通过：${r.items} 篇 / ${r.chars} 字 / gzip ${(r.gzip / 1024).toFixed(0)} KB`)
      console.log(`  分册：${Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
    } catch (e) {
      console.error(`✗ 快照校验失败：${e.message}`)
      process.exit(1)
    }
    return
  }

  if (!FORCE && existsSync(outPath)) {
    try {
      const r = checkSnapshot(readFileSync(outPath))
      if (IF_MISSING) {
        console.log(`· 精选库快照已存在且有效（${r.items} 篇），跳过`)
        return
      }
      if (!process.argv.includes('--rebuild')) {
        console.log(`· 精选库快照已存在且有效（${r.items} 篇），跳过（--force 可强制重建）`)
        return
      }
    } catch (e) {
      console.log(`· 现有快照无效（${e.message}），重新生成`)
    }
  }

  console.log('· 正在下载三本选本…')
  const [tangRaw, songRaw, guwenRaw] = await Promise.all([
    getJSON(MIRRORS.map((m) => () => m('全唐诗/唐诗三百首.json')), 120_000),
    getJSON(MIRRORS.map((m) => () => m('宋词/宋词三百首.json')), 100_000),
    getJSON(MIRRORS.map((m) => () => m('蒙学/guwenguanzhi.json')), 300_000),
  ])
  console.log('· 正在下载繁简字表…')
  const ts = await loadTS()
  const s2t = makeS2T(ts)

  const books = [
    { ...BOOKS[0], items: readTang(tangRaw) },
    { ...BOOKS[1], items: readSong(songRaw) },
    { ...BOOKS[2], items: readGuwen(guwenRaw) },
  ]

  // 繁 → 简：只动正文与标题/作者（人名地名按通行简体呈现，与 UI 一致）
  let converted = 0
  for (const b of books) {
    for (const it of b.items) {
      const before = it.t + it.a + it.s + it.x
      it.t = s2t(it.t)
      it.a = s2t(it.a)
      it.s = s2t(it.s)
      it.x = s2t(it.x)
      if (it.t + it.a + it.s + it.x !== before) converted++
      // 作者字段里的多余空白（源数据「左丘明 」带尾空格）
      it.a = it.a.replace(/\s+/g, ' ').trim()
    }
  }

  const data = pack(books)
  const n = roundTrip(books, data)
  const gz = gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 })
  if (gz.length > MAX_GZIP) throw new Error(`产物超体积上限：${(gz.length / 1024).toFixed(0)} KB > ${MAX_GZIP / 1024} KB`)
  writeFileSync(outPath, gz)

  const stats = checkSnapshot(gz)
  console.log(`✓ 已生成 ${OUT}`)
  console.log(`  ${n} 篇 / ${stats.chars} 字 / 繁转简 ${converted} 篇 / gzip ${(gz.length / 1024).toFixed(0)} KB`)
  for (const b of data.books) console.log(`  · ${b.name}（${b.note}）${b.n} 篇`)
}

main().catch((e) => {
  console.error('✗ ' + e.message)
  process.exit(1)
})
