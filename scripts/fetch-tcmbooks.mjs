#!/usr/bin/env node
// 拉取 / 生成「方书与医经库」（中医药经典模块第 7 期数据层）。
//
// 收录 9 本（源：balayuxf/TCM-Ancient-Books，GB18030，原文属公共领域）：
//   备急千金要方 532 / 千金翼方 051 / 外台秘要 053 / 肘后备急方 075
//   黄帝内经素问 437 / 伤寒论 457 / 金匮要略方论 499 / 神农本草经 000 / 本草备要 018
//
// 结构探测结论（2026-11 实测）：
//   - 两类块格式：5 本用 `属性：`（532/437/457/499/075），4 本用 `内容：`（000/018/051/053）；
//   - 目录形态 `卷X\子类`（二级），空目录为序跋等；合计 5963 篇 / 279 万字；
//   - 缺字占位符 `\x`（988 处）与 KT（405 处），沿用第 6 期原则 1:1 转全角空格、不猜字。
//
// 产物（与第 4 期全量库同构，L2 永不预加载）：
//   public/tcm/full-index.json.gz   索引（<150KB）：书目 + 篇章元数据 + 分片映射
//   public/tcm/full/sN.json.gz      分片（每 500 篇一片，共约 12 片）：[[title, text], ...]
//
// 用法：
//   node scripts/fetch-tcmbooks.mjs              # 下载并生成
//   node scripts/fetch-tcmbooks.mjs --if-missing # dev / build 钩子
//   node scripts/fetch-tcmbooks.mjs --check      # 只校验现有快照，不联网
//   node scripts/fetch-tcmbooks.mjs --force      # 强制重建（会清空旧分片）
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'public/tcm/full'
const OUT_INDEX = 'public/tcm/full-index.json.gz'
const CHECK = process.argv.includes('--check')
const FORCE = process.argv.includes('--force')
const IF_MISSING = process.argv.includes('--if-missing')

const CHUNK = 500
const MIN_INDEX_GZIP = 30 * 1024
const MAX_INDEX_GZIP = 200 * 1024
const MIN_TOTAL_CHARS = 2_100_000
const MIN_TOTAL_ITEMS = 5800

const MIRRORS = [
  (repo, p) => `https://fastly.jsdelivr.net/gh/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://cdn.jsdelivr.net/gh/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://ghproxy.net/https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://gh-proxy.com/https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
]
const REPO = 'balayuxf/TCM-Ancient-Books'

// id / 源文件 / 书名 / 作者 / 朝代年份 / 探测篇数下限（留 ~10% 余量）
const BOOKS = [
  ['532', '532-备急千金要方.txt', '备急千金要方', '孙思邈', '唐·652年', 1700],
  ['051', '051-千金翼方.txt', '千金翼方', '孙思邈', '唐·682年', 1900],
  ['053', '053-外台秘要.txt', '外台秘要', '王焘', '唐·752年', 1000],
  ['075', '075-肘后备急方.txt', '肘后备急方', '葛洪', '东晋·约340年', 65],
  ['437', '437-黄帝内经素问.txt', '黄帝内经素问', '王冰次注', '唐·762年', 75],
  ['457', '457-伤寒论.txt', '伤寒论', '张仲景', '东汉·约200-220年', 9],
  ['499', '499-金匮要略方论.txt', '金匮要略方论', '张仲景', '东汉·约200-220年', 22],
  ['000', '000-神农本草经.txt', '神农本草经', '佚名（托名神农）', '秦汉', 350],
  ['018', '018-本草备要.txt', '本草备要', '汪昂', '清·1694年', 440],
]

async function getSource(path, minBytes) {
  const errs = []
  for (const mk of MIRRORS) {
    const url = mk(REPO, path)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(240_000) })
      if (!res.ok) {
        errs.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < minBytes) {
        errs.push(`${url} → 体积 ${buf.length} < ${minBytes}（疑似截断或限额页）`)
        continue
      }
      return buf
    } catch (e) {
      errs.push(`${url} → ${e.message}`)
    }
  }
  throw new Error(`《${path}》全部镜像失败：\n  ${errs.join('\n  ')}`)
}

// 两类块格式：`属性：` 或 `内容：`，都是「标签行 + 后续多行正文直到下一个标签」。
// 书名元数据块（书名：/作者：/朝代：/年份：）无正文，跳过。
function parseBook(text) {
  const lines = text.split('\n')
  const entries = []
  let dir = ''
  let name = ''
  let body = null
  const flush = () => {
    if (body !== null) {
      const t = body.join('\n').trim()
      if (t) entries.push({ dir, name, body: t })
      body = null
    }
  }
  for (const l of lines) {
    if (l.startsWith('<目录>') || l.startsWith('<篇名>')) {
      flush()
      if (l.startsWith('<目录>')) dir = l.slice(4).trim()
      else name = l.slice(4).trim()
    } else if (l.startsWith('属性：') || l.startsWith('内容：')) {
      body = [l.slice(l.indexOf('：') + 1)]
    } else if (body !== null) {
      body.push(l)
    }
  }
  flush()
  return entries
}

// 缺字占位 1:1 → 全角空格（与第 6 期同策略）；吸收邻接半角空格；行内空白规整。
function cleanBody(s) {
  return s
    .replace(/\r/g, '')
    .replace(/\\x/g, '　')
    .replace(/KT/g, '　')
    .replace(/ +　/g, '　')
    .replace(/　 +/g, '　')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function splitDir(dir) {
  if (!dir) return { juan: '序跋', sub: '' }
  const parts = dir.split('\\')
  return { juan: parts[0] || '序跋', sub: parts[1] || '' }
}

function build(allBooks) {
  const books = []
  const entries = [] // [book, shard, off, title, juan, sub]
  const shards = []
  let shard = []
  const shardFrom = []

  const pushShard = () => {
    if (!shard.length) return
    shardFrom.push(entries.length - shard.length)
    shards.push(shard)
    shard = []
  }

  for (const b of allBooks) {
    const from = entries.length
    let chars = 0
    for (const e of b.entries) {
      const body = cleanBody(e.body)
      if (!body || !/[\u4e00-\u9fff]/.test(body)) throw new Error(`《${b.name}》${e.name} 正文无汉字`)
      if (/\\x|KT/.test(body)) throw new Error(`《${b.name}》${e.name} 残留占位符`)
      if (body.includes('\r')) throw new Error(`《${b.name}》${e.name} 含 CR`)
      const { juan, sub } = splitDir(e.dir)
      shard.push([e.name, body])
      entries.push([books.length, 0, shard.length - 1, e.name, juan, sub])
      chars += body.length
      if (shard.length === CHUNK) pushShard()
    }
    pushShard() // 每书结束按书切分片，保证书内 off 连续、检索过滤简单
    books.push({ id: b.id, name: b.name, author: b.author, era: b.era, n: b.entries.length, chars, from, to: entries.length })
  }
  // 回填真实分片号（pushShard 时还不知道编号）。注意用全局下标 g，不是 e[0]（那是书序）！
  for (let g = 0; g < entries.length; g++) {
    const e = entries[g]
    let s = 0
    while (s + 1 < shardFrom.length && shardFrom[s + 1] <= g) s++
    e[1] = s
  }
  return { books, entries, shardFrom, shards }
}

function assertData(index, shards) {
  if (index.books.length !== BOOKS.length) throw new Error(`书数异常：${index.books.length}`)
  if (index.entries.length < MIN_TOTAL_ITEMS) throw new Error(`总篇数不足：${index.entries.length}`)
  const chars = index.books.reduce((s, b) => s + b.chars, 0)
  if (chars < MIN_TOTAL_CHARS) throw new Error(`正文总字数不足：${chars}`)
  for (let bi = 0; bi < BOOKS.length; bi++) {
    const b = index.books[bi]
    if (b.n < BOOKS[bi][5]) throw new Error(`《${b.name}》篇数不足：${b.n} < ${BOOKS[bi][5]}`)
    if (b.name !== BOOKS[bi][2]) throw new Error(`第 ${bi} 本书名不符：${b.name}`)
  }
  if (index.shardFrom.length !== shards.length) throw new Error('分片映射与分片数不符')
  for (let s = 0; s < shards.length; s++) {
    if (!shards[s].length) throw new Error(`分片 ${s} 为空`)
    if (shards[s].length > CHUNK) throw new Error(`分片 ${s} 超长`)
    for (const [title, text] of shards[s]) {
      if (!title || !text) throw new Error(`分片 ${s} 有空条目`)
    }
  }
  // 逐条对照索引与分片标题：分片号/位移回填错位时这里是唯一便宜的拦截
  for (let g = 0; g < index.entries.length; g++) {
    const [bi, s, off, title] = index.entries[g]
    if (bi < 0 || bi >= index.books.length) throw new Error(`第 ${g} 条书序越界：${bi}`)
    if (!shards[s] || shards[s][off]?.[0] !== title) {
      throw new Error(`第 ${g} 条《${title}》分片错位：s${s}#${off}`)
    }
  }
  // 锚点：伤寒论首篇、千金要方大部头、本草备要末本
  if (!index.entries.some((e) => e[3] === '辨太阳病脉证并治上')) throw new Error('伤寒论首篇缺失')
  if (!index.entries.some((e) => e[3] === '人参')) throw new Error('本草备要人参条缺失')
  const qian = index.books[0]
  if (qian.n < 1700 || qian.chars < 400_000) throw new Error('备急千金要方异常')
  return { chars }
}

function writeIfChanged(file, buf) {
  const out = join(ROOT, file)
  if (existsSync(out) && Buffer.compare(readFileSync(out), buf) === 0) {
    console.log(`  = ${file} 未变化`)
    return false
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)
  console.log(`  ✓ ${file} ${(buf.length / 1024).toFixed(0)} KB`)
  return true
}

function verifySnapshot() {
  const idxBuf = readFileSync(join(ROOT, OUT_INDEX))
  const index = JSON.parse(gunzipSync(idxBuf).toString('utf8'))
  if (idxBuf.length < MIN_INDEX_GZIP || idxBuf.length > MAX_INDEX_GZIP) {
    throw new Error(`索引体积异常：${(idxBuf.length / 1024).toFixed(0)}KB`)
  }
  const files = readdirSync(join(ROOT, DIR)).filter((f) => f.endsWith('.gz')).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
  const shards = files.map((f) => JSON.parse(gunzipSync(readFileSync(join(ROOT, DIR, f))).toString('utf8')))
  const stats = assertData(index, shards)
  return { idxBuf, index, shards, stats }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!FORCE && !CHECK && existsSync(join(ROOT, OUT_INDEX))) {
    try {
      verifySnapshot()
      console.log('快照已存在且通过校验，跳过（--force 可强制重建）')
      process.exit(0)
    } catch (e) {
      console.log(`快照校验失败，将重新生成：${e.message}`)
    }
  }

  if (CHECK) {
    const { idxBuf, stats, shards } = verifySnapshot()
    console.log(`✓ 快照校验通过：${shards.length} 分片 / ${(stats.chars / 10000).toFixed(0)} 万字，索引 ${(idxBuf.length / 1024).toFixed(0)}KB`)
    process.exit(0)
  }

  const allBooks = []
  for (const [id, path, name, author, era, floor] of BOOKS) {
    console.log(`下载《${name}》…`)
    const minBytes = Math.floor(path.length > 0 ? 8000 : 8000)
    const buf = await getSource(path, minBytes)
    const text = new TextDecoder('gb18030').decode(buf)
    const entries = parseBook(text)
    if (entries.length < floor) throw new Error(`《${name}》解析 ${entries.length} 篇 < ${floor}`)
    console.log(`  ✓ ${(text.length / 1000).toFixed(0)}K 字 / ${entries.length} 篇`)
    allBooks.push({ id, name, author, era, entries })
  }

  console.log('构建索引与分片…')
  const { books, entries, shardFrom, shards } = build(allBooks)
  const stats = assertData({ books, entries, shardFrom }, shards)
  console.log(`  ✓ 共 ${entries.length} 篇 / ${(stats.chars / 10000).toFixed(0)} 万字 / ${shards.length} 分片`)

  const built = new Date().toISOString().slice(0, 10)
  const index = { v: 1, built, source: REPO, note: '缺字以上游占位符转全角空格呈现，原文如此，不作推测', books, entries, shardFrom }
  const idxBuf = gzipSync(Buffer.from(JSON.stringify(index)))
  if (idxBuf.length < MIN_INDEX_GZIP || idxBuf.length > MAX_INDEX_GZIP) {
    throw new Error(`索引产物体积异常：${(idxBuf.length / 1024).toFixed(0)}KB`)
  }

  // 往返自检
  const backIdx = JSON.parse(gunzipSync(idxBuf).toString('utf8'))
  assertData(backIdx, shards)

  console.log('写入快照…')
  writeIfChanged(OUT_INDEX, idxBuf)
  if (FORCE && existsSync(join(ROOT, DIR))) {
    for (const f of readdirSync(join(ROOT, DIR))) if (f.endsWith('.gz')) rmSync(join(ROOT, DIR, f))
  }
  for (const [s, items] of shards.entries()) {
    writeIfChanged(`${DIR}/s${s}.json.gz`, gzipSync(Buffer.from(JSON.stringify(items))))
  }
  console.log(`完成：9 书 ${entries.length} 篇 / ${(stats.chars / 10000).toFixed(0)} 万字 / ${shards.length} 分片 / 索引 ${(idxBuf.length / 1024).toFixed(0)}KB`)
}

export { parseBook, cleanBody, splitDir, build, assertData, BOOKS, CHUNK }
