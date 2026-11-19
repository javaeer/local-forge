// 全量库检索的纯逻辑（第 4 期）。
//
// 从 poem.worker.js 拆出来：Worker 里不能 import 进测试（Node 没有 self），
// 而检索规则值得直接测——「分片未就绪时只搜标题作者」「多关键词 AND」「书内过滤」
// 这些行为只验证一遍，Worker 和测试共用同一份实现。

// hits: { g, book, shard, off, title, author, snippet }
export function searchEntries({ entries, shardFrom, texts, q, book = -1, limit = 120 }) {
  const query = String(q || '').trim()
  if (!query || !entries) {
    return { hits: [], titleOnly: !texts || texts.size === 0, scanned: 0, missing: 0, truncated: false }
  }
  const terms = query.split(/\s+/).filter(Boolean)
  const whole = terms.length === 1 ? terms[0] : ''
  const hits = []
  const missingShards = []
  let scanned = 0

  // 主扫：已加载分片的正文。分片按 id 升序保证结果按书序稳定。
  const ordered = [...texts.keys()].sort((a, b) => a - b)
  for (const s of ordered) {
    const items = texts.get(s)
    scanned += items.length
    for (let off = 0; off < items.length; off++) {
      const meta = entries[shardFrom[s] + off]
      if (book >= 0 && meta[0] !== book) continue
      const hay = items[off][0] + items[off][1] + items[off][2]
      if (!terms.every((t) => hay.includes(t))) continue
      hits.push({
        g: shardFrom[s] + off,
        book: meta[0],
        shard: s,
        off,
        title: meta[3],
        author: meta[4],
        snippet: snippetOf(items[off][2], whole || terms[0]),
      })
      if (hits.length >= limit) {
        return { hits, titleOnly: !texts || texts.size === 0, scanned, missing: 0, truncated: true }
      }
    }
  }

  // 补扫：未加载分片只能搜标题/作者（entries 无正文），snippet 留空
  let missing = 0
  for (let s = 0; s < shardFrom.length; s++) {
    if (texts.has(s)) continue
    missing++
    const from = shardFrom[s]
    const to = s + 1 < shardFrom.length ? shardFrom[s + 1] : entries.length
    for (let g = from; g < to; g++) {
      const meta = entries[g]
      if (book >= 0 && meta[0] !== book) continue
      const hay = meta[3] + meta[4]
      if (!terms.every((t) => hay.includes(t))) continue
      hits.push({ g, book: meta[0], shard: s, off: meta[2], title: meta[3], author: meta[4], snippet: '' })
      if (hits.length >= limit) break
    }
    if (hits.length >= limit) break
  }

  return { hits, titleOnly: !texts || texts.size === 0, scanned, missing, truncated: false }
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
