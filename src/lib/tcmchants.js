// 中医药歌诀库（L1）数据层：八本歌诀 / 韵文经典，共 1143 条。
//
// 数据由 scripts/fetch-tcmchants.mjs 生成到 public/tcm/tcmchants.json.gz（gzip 约 273 KB）。
// 传输格式是「定长数组」以省体积，进内存后展开成带字段名的对象——上层不用关心这个优化。
//
// 与 poems.js 同构，但多了一块本模块的核心差异点：**背诵引擎**。
//   - maskVerse：把韵文按比例挖空（全角空格占位），供「遮盖背诵」；
//   - checkDictation：默写比对，按 LCS 逐字对齐标出对错（歌诀短，百字级 DP 毫无压力）。
// 进度存 localStorage（key 见 PROGRESS_KEY），只记「会了」的条目 id 集合。
import { fetchGzJson } from './gzjson.js'

const FILE = 'tcm/tcmchants.json.gz'
const CMD = 'npm run tcmchants:fetch'
const PROGRESS_KEY = 'lf-chants-recited'

let cache = null
let inflight = null

// 传输数组的字段位序：0=书序 1=分组 2=标题 3=韵文 4=夹注/注
function expand(data) {
  const books = data.books.map((b) => ({ ...b }))
  const items = data.items.map((a, i) => ({
    id: i,
    book: a[0],
    bookId: books[a[0]]?.id || '',
    group: a[1],
    title: a[2],
    verse: a[3],
    note: a[4] || '',
  }))

  // 目录：每本书内部按 group 聚合，保持数据原有顺序
  for (const [bi, b] of books.entries()) {
    const groups = []
    const seen = new Map()
    b.items = []
    for (const it of items) {
      if (it.book !== bi) continue
      b.items.push(it)
      if (!seen.has(it.group)) {
        const g = { name: it.group, items: [] }
        seen.set(it.group, g)
        groups.push(g)
      }
      seen.get(it.group).items.push(it)
    }
    b.groups = groups
  }

  const chars = items.reduce((s, it) => s + it.verse.length, 0)
  return { v: data.v, books, items, stats: { total: items.length, chars } }
}

export async function loadChants() {
  if (cache) return cache
  if (inflight) return inflight

  inflight = (async () => {
    const { data, url } = await fetchGzJson(FILE, { cmd: CMD, label: '歌诀库' })
    if (data.v !== 1 || !Array.isArray(data.books) || !Array.isArray(data.items)) {
      throw new Error(`歌诀库结构异常（版本或字段不符），请重新运行 ${CMD}`)
    }
    cache = expand(data)
    cache.url = url
    return cache
  })()

  try {
    return await inflight
  } catch (e) {
    inflight = null // 失败不缓存，允许重试
    throw e
  }
}

/* ---------------- 检索 ---------------- */

// 与 searchPoems 同思路的线性扫描：1143 条 / 22.7 万字，全库扫一遍 3ms 量级，不需要 Worker。
export function searchChants(lib, query, { book = -1, limit = 200 } = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  const terms = q.split(/\s+/).filter(Boolean)
  const whole = terms.length === 1 ? terms[0] : ''
  const out = []
  for (const it of lib.items) {
    if (book >= 0 && it.book !== book) continue
    const hay = `${it.title}\n${it.group}\n${it.verse}\n${it.note}`
    if (!terms.every((t) => hay.includes(t))) continue
    out.push({ ...it, snippet: snippetOf(it.verse, whole || terms[0]) })
    if (out.length >= limit) break
  }
  return out
}

function snippetOf(text, needle) {
  if (!needle) return text.slice(0, 40)
  const i = text.indexOf(needle)
  if (i < 0) return text.slice(0, 40)
  const start = Math.max(0, i - 12)
  const end = Math.min(text.length, i + needle.length + 18)
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\n/g, ' ') + (end < text.length ? '…' : '')
}

// 检索词包 <mark>；检索词来自用户输入，拼接前必须先转义
export function highlight(text, query) {
  const terms = String(query || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeHtml)
  if (!terms.length) return escapeHtml(text)
  let html = escapeHtml(text)
  for (const t of terms) {
    if (!t) continue
    html = html.split(t).join(`<mark>${t}</mark>`)
  }
  return html
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/* ---------------- 背诵引擎 ---------------- */

// 韵文按句切分（保留标点），遮盖与默写都以句为单位展示。
// 断行规则：句号级标点（。！？；）收一行；逗号在累计 ≥8 字时收一行（药性歌括的四字句
// 两句一行更易读）；完全无句读的超长串按 8 字硬切。
export function splitVerses(verse) {
  const out = []
  for (const line of String(verse).split('\n')) {
    if (!line.trim()) continue
    const parts = line.match(/[^。！？；，]*[。！？；，]?/g) || [line]
    let buf = ''
    for (const p of parts) {
      if (!p) continue
      buf += p
      const n = [...buf].length
      const endHard = /[。！？；]$/.test(buf)
      const endSoft = /[，]$/.test(buf) && n >= 8
      if (endHard || endSoft) {
        out.push(buf)
        buf = ''
      } else if (n >= 8) {
        // 无句读的超长串：按 8 字硬切，余段留作缓冲继续攒
        const chs = [...buf]
        while (chs.length >= 8) {
          out.push(chs.slice(0, 8).join(''))
          chs.splice(0, 8)
        }
        buf = chs.join('')
      }
    }
    if (buf) out.push(buf)
  }
  return out
}

// 遮盖：ratio 为 0~1。mode = 'blank'（随机挖空）| 'first'（只留每句首字，标点不遮）。
// seed 用于「重挖一题」的确定性——同一个 seed 结果一致。
export function maskVerse(lines, ratio, mode, seed = Date.now()) {
  if (mode === 'first') {
    return lines.map((line) => [...line].map((ch, i) => ({ ch, mask: i > 0 && !/[，。！？；、　]/.test(ch) })))
  }
  // 简单可复现的伪随机序列（mulberry32）
  let a = seed >>> 0
  const rand = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return lines.map((line) =>
    [...line].map((ch) => {
      const punct = /[，。！？；、　]/.test(ch)
      return { ch, mask: !punct && rand() < ratio }
    }),
  )
}

// 默写比对：逐字 LCS 对齐，返回 { score: 0~1, marks: [{ ch, ok }] }（以原文为基准）。
// 忽略空白差异；标点参与比对但写错标点只算半错？——不，简单起见一视同仁。
export function checkDictation(input, answer) {
  const a = [...String(answer).replace(/\s+/g, '')]
  const b = [...String(input || '').replace(/\s+/g, '')]
  const n = a.length
  const m = b.length
  // LCS DP：百字级规模，O(n·m) 直接算
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const marks = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      marks.push({ ch: a[i], ok: true })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      marks.push({ ch: a[i], ok: false })
      i++
    } else {
      j++ // 多写的字不占位，静默跳过（分数会体现）
    }
  }
  while (i < n) marks.push({ ch: a[i++], ok: false })
  const hit = dp[0][0] || 0
  return { score: n ? hit / n : 0, marks }
}

/* ---------------- 背诵进度 ---------------- */

function safeGet() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')
  } catch {
    return {}
  }
}

export function getRecited() {
  return safeGet()
}

export function setRecited(id, ok) {
  try {
    const s = safeGet()
    if (ok) s[id] = 1
    else delete s[id]
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(s))
  } catch { /* 隐私模式等场景下静默降级 */ }
}

export function clearRecited() {
  try {
    localStorage.removeItem(PROGRESS_KEY)
  } catch { /* ignore */ }
}
