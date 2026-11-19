// 繁 → 简 转换（fetch-poems.mjs 与 fetch-poems-full.mjs 共用）。
//
// 字表：BYVoid/OpenCC 的 TSCharacters.txt（Apache-2.0）。这是繁→简的单向表，
// 一对多的歧义只存在于简→繁方向，所以本方向的转换是确定的。
// 一对多时取首选项（OpenCC 约定首选排第一）。
const TS_URLS = [
  'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt',
  'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/TSCharacters.txt',
]

export async function loadTS() {
  const errs = []
  for (const url of TS_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (!res.ok) {
        errs.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const txt = await res.text()
      if (txt.length < 60_000) {
        errs.push(`${url} → 体积 ${txt.length} < 60000（疑似截断）`)
        continue
      }
      const map = new Map()
      for (const line of txt.split('\n')) {
        if (!line || line[0] === '#') continue
        const [k, v] = line.split('\t')
        if (!k || !v) continue
        map.set(k, v.split(' ')[0])
      }
      if (map.size < 3000) throw new Error(`繁简字表条目过少：${map.size}`)
      return map
    } catch (e) {
      errs.push(`${url} → ${e.message}`)
    }
  }
  throw new Error(`繁简字表全部镜像失败：\n  ${errs.join('\n  ')}`)
}

// 返回 (s) => string。全量库一次要转两千万字，逐码点 for-of 太慢，
// 用「整串先按表替换」没有意义，保持 for-of 但调用方应分片调用以免阻塞事件循环。
export function makeS2T(map) {
  return (s) => {
    let out = ''
    for (const ch of s) out += map.get(ch) || ch
    return out
  }
}
