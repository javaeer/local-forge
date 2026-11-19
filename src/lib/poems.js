// 精选库（L1）数据层：唐诗三百首 / 宋词三百首 / 古文观止，共 868 篇。
//
// 数据由 scripts/fetch-poems.mjs 生成到 public/classics/poems.json.gz（gzip 约 290 KB）。
// 传输格式是「定长数组」以省体积，进内存后展开成带字段名的对象——上层不用关心这个优化。
//
// 为什么 L1 只有三本、没有元曲：元曲没有公认的开源「三百首」选本，chinese-poetry 只提供
// 全元曲（11057 首）。硬凑一份"元曲三百首"等于自己编选本、冒充权威版本，不做。
// 元曲放在第 4 期的全量库里按需下载，那里是「全」而不是「选」，不存在此问题。
import { fetchGzJson } from './gzjson.js'

const FILE = 'classics/poems.json.gz'
const CMD = 'npm run poems:fetch'

let cache = null
let inflight = null

// 传输数组的字段位序：0=书序 1=分组 2=标题 3=作者 4=朝代 5=出处 6=正文
function expand(data) {
  const books = data.books.map((b) => ({ ...b }))
  const items = data.items.map((a, i) => ({
    id: i,
    book: a[0],
    bookId: books[a[0]]?.id || '',
    group: a[1],
    title: a[2],
    author: a[3],
    dynasty: a[4],
    source: a[5],
    text: a[6],
    chars: a[6].length,
  }))

  // 目录：每本书内部按 group 聚合，保持数据原有顺序（唐诗是「五言绝句→…→乐府」的选本体例，
  // 古文观止是「卷一→卷十二」的卷次），不排序——选本的顺序本身就是信息。
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

  const chars = items.reduce((s, it) => s + it.chars, 0)
  return { v: data.v, books, items, stats: { total: items.length, chars } }
}

export async function loadPoems() {
  if (cache) return cache
  if (inflight) return inflight

  inflight = (async () => {
    const { data, url } = await fetchGzJson(FILE, { cmd: CMD, label: '精选库' })
    if (data.v !== 1 || !Array.isArray(data.books) || !Array.isArray(data.items)) {
      throw new Error(`精选库结构异常（版本或字段不符），请重新运行 ${CMD}`)
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

// 检索是纯线性扫描：868 篇 / 19.9 万字，单次全库 `indexOf` 在 3ms 量级，
// 不 Worker 化也不卡手。第 4 期的全量库（8.9 万首）才需要 Worker，这里先把接口定成异步，
// 到时候只换实现、不改调用方。
export function searchPoems(lib, query, { book = -1, limit = 200 } = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  // 空格分隔多关键词 → AND 匹配；整串命中时正文片段以整串为中心，更好看
  const terms = q.split(/\s+/).filter(Boolean)
  const whole = terms.length === 1 ? terms[0] : ''
  const out = []
  for (const it of lib.items) {
    if (book >= 0 && it.book !== book) continue
    const hay = `${it.title}\n${it.author}\n${it.text}`
    if (!terms.every((t) => hay.includes(t))) continue
    out.push({ ...it, snippet: snippetOf(it.text, whole || terms[0]) })
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

// 把命中词包成 <mark> 片段，供 v-html 之前必须先转义（检索词来自用户输入，不能直接拼 HTML）
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

/* ---------------- 阅读辅助 ---------------- */

// 诗词正文按句切分（保留标点）：竖排卡片与逐句对照都要按句走。
// 古文段落长，按句号切会让每列过长，所以调用方可以传 maxLen 强制在逗号处再断。
export function splitSentences(text, maxLen = 0) {
  const out = []
  for (const para of String(text).split('\n')) {
    if (!para) continue
    const parts = para.match(/[^。！？；：，、]*[。！？；：，、」』”）]?/g) || [para]
    let buf = ''
    for (const p of parts) {
      if (!p) continue
      buf += p
      if (!maxLen || Array.from(buf).length >= maxLen) {
        out.push(buf)
        buf = ''
      }
    }
    if (buf) out.push(buf)
  }
  return out
}
