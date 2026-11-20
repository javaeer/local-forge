// 方书库检索的纯逻辑（第 7 期）。从 tcmbook.worker.js 拆出来：
// Worker 里不能 import 进 Node 单测（没有 self），而规则值得直接测——
// 「分片未就绪时只搜标题」「多关键词 AND」「书内过滤」这些行为只验证一遍。
//
// 与第 4 期 poemsearch.js 同构，差异：entries = [book, shard, off, title, juan, sub]，
// 无 author，命中结果带书内卷次 juan，供视图直接展示。
//
// hits: { g, book, shard, off, title, juan, snippet }

export function searchEntries({ entries, shardFrom, texts, q, book = -1, limit = 120 }) {
  const query = String(q || '').trim()
  if (!query || !entries) {
    return { hits: [], titleOnly: !texts || texts.size === 0, scanned: 0, missing: 0, truncated: false }
  }
  const terms = query.split(/\s+/).filter(Boolean)
  const whole = terms.length === 1 ? terms[0] : ''
  const hits = []
  let scanned = 0

  // 主扫：已加载分片的正文。分片号升序保证结果按书序稳定。
  const ordered = [...texts.keys()].sort((a, b) => a - b)
  for (const s of ordered) {
    const items = texts.get(s)
    scanned += items.length
    for (let off = 0; off < items.length; off++) {
      const g = shardFrom[s] + off
      const meta = entries[g]
      if (!meta || (book >= 0 && meta[0] !== book)) continue
      const hay = meta[3] + ' ' + items[off][0] + ' ' + items[off][1]
      if (!terms.every((t) => hay.includes(t))) continue
      hits.push({
        g,
        book: meta[0],
        shard: s,
        off,
        title: meta[3],
        juan: meta[4],
        snippet: snippetOf(items[off][1], whole || terms[0]),
      })
      if (hits.length >= limit) {
        return { hits, titleOnly: false, scanned, missing: 0, truncated: true }
      }
    }
  }

  // 补扫：未加载分片只能搜标题（entries 无正文），snippet 留空
  let missing = 0
  for (let s = 0; s < shardFrom.length; s++) {
    if (texts.has(s)) continue
    missing++
    const from = shardFrom[s]
    const to = s + 1 < shardFrom.length ? shardFrom[s + 1] : entries.length
    for (let g = from; g < to; g++) {
      const meta = entries[g]
      if (book >= 0 && meta[0] !== book) continue
      const hay = meta[3] + meta[4] + meta[5]
      if (!terms.every((t) => hay.includes(t))) continue
      hits.push({ g, book: meta[0], shard: s, off: meta[2], title: meta[3], juan: meta[4], snippet: '' })
      if (hits.length >= limit) break
    }
    if (hits.length >= limit) break
  }

  return { hits, titleOnly: !texts || texts.size === 0, scanned, missing, truncated: false }
}

// 未装库时的标题检索（纯索引，无正文版）：只搜书名/卷次/篇名。
export function searchIndex(entries, q, book = -1, limit = 120) {
  const query = String(q || '').trim()
  if (!query || !entries) return []
  const terms = query.split(/\s+/).filter(Boolean)
  const hits = []
  for (let g = 0; g < entries.length; g++) {
    const e = entries[g]
    if (book >= 0 && e[0] !== book) continue
    if (!terms.every((t) => `${e[3]} ${e[4]} ${e[5]}`.includes(t))) continue
    hits.push({ g, book: e[0], shard: e[1], off: e[2], title: e[3], juan: e[4], snippet: '' })
    if (hits.length >= limit) break
  }
  return hits
}

export function snippetOf(text, needle) {
  if (!needle) return Array.from(String(text)).slice(0, 32).join('')
  const i = text.indexOf(needle)
  if (i < 0) return Array.from(text).slice(0, 32).join('')
  const chars = Array.from(text)
  const start = Math.max(0, i - 12)
  const end = Math.min(chars.length, i + Array.from(needle).length + 18)
  return (start > 0 ? '…' : '') + chars.slice(start, end).join('') + (end < chars.length ? '…' : '')
}
