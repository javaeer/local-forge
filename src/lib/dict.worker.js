// 词典后台线程 —— 装载解析、建索引、检索的重活全在这里，主线程只收发小消息。
// 协议：入参 { id, op, ... }，回执 { id, ok, payload } 或 { id, ok: false, error }。
// 索引常驻本线程内存，不与主线程共享（免掉 50MB 结构化克隆的开销）。
import { parseDict, buildIndex, search, stats, buildIpaIndex, isSingleEnglishWord } from './dict.js'

let index = null
let ipa = null // { us: Map, uk: Map } —— 英语音标，独立于主词库

self.onmessage = (e) => {
  const { id, op } = e.data || {}
  try {
    let payload
    if (op === 'load') {
      const t0 = performance.now()
      const entries = parseDict(e.data.text, e.data.name || '')
      if (!entries.length) throw new Error('解析结果为空，请检查词库格式')
      index = buildIndex(entries)
      if (e.data.ipaTexts) {
        ipa = {}
        for (const v of ['us', 'uk']) {
          if (e.data.ipaTexts[v]) ipa[v] = buildIpaIndex(e.data.ipaTexts[v])
        }
      }
      payload = {
        entries: index.entries.length,
        words: stats(index).words,
        ipaWords: ipa ? (ipa.us ? ipa.us.size : 0) : 0,
        ms: Math.round(performance.now() - t0),
      }
    } else if (op === 'search') {
      if (!index) throw new Error('词库未装载')
      payload = search(index, e.data.q, { mode: e.data.mode || 'auto', limit: e.data.limit || 60 })
      // 单个纯英文词：顺带把音标带上（美式 / 英式），主线程直接渲染
      if (ipa && isSingleEnglishWord(e.data.q)) {
        const lq = e.data.q.trim().toLowerCase()
        const hit = {}
        for (const v of ['us', 'uk']) if (ipa[v] && ipa[v].has(lq)) hit[v] = ipa[v].get(lq)
        if (Object.keys(hit).length) payload.ipa = hit
      }
    } else {
      throw new Error('未知操作：' + op)
    }
    self.postMessage({ id, ok: true, payload })
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) })
  }
}
