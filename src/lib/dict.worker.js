// 词典后台线程 —— 装载解析、建索引、检索的重活全在这里，主线程只收发小消息。
// 协议：入参 { id, op, ... }，回执 { id, ok, payload } 或 { id, ok: false, error }。
// 索引常驻本线程内存，不与主线程共享（免掉 50MB 结构化克隆的开销）。
import { parseDict, buildIndex, search, stats } from './dict.js'

let index = null

self.onmessage = (e) => {
  const { id, op } = e.data || {}
  try {
    let payload
    if (op === 'load') {
      const t0 = performance.now()
      const entries = parseDict(e.data.text, e.data.name || '')
      if (!entries.length) throw new Error('解析结果为空，请检查词库格式')
      index = buildIndex(entries)
      payload = {
        entries: index.entries.length,
        words: stats(index).words,
        ms: Math.round(performance.now() - t0),
      }
    } else if (op === 'search') {
      if (!index) throw new Error('词库未装载')
      payload = search(index, e.data.q, { mode: e.data.mode || 'auto', limit: e.data.limit || 60 })
    } else {
      throw new Error('未知操作：' + op)
    }
    self.postMessage({ id, ok: true, payload })
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) })
  }
}
