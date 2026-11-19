// 韵书数据加载（L0 格律引擎）。
//
// 数据由 scripts/fetch-classics.mjs 生成到 public/classics/rhyme.json.gz，
// 与 public/dict/*.gz 同为「数据不入库」的快照：clone 后跑 `npm run classics:fetch` 即可。
//
// 加载策略：
//   - 模块级单例，同一会话只解压一次（gzip 32 KB → 索引约 1.1 万字，建索引 ~10ms）
//   - fflate 动态导入，不进首屏包
//   - 并发调用共享同一个 Promise，避免重复下载
import { buildIndex } from './poemmeter.js'

const FILE = 'classics/rhyme.json.gz'

let index = null
let inflight = null

export function classicsUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}${FILE}`.replace(/\/{2,}/g, '/')
}

// 解码：兼容「服务器原样返回 gzip」与「服务器设了 Content-Encoding: gzip 后浏览器已自动解压」两种情况。
// 后者是常见坑——静态服务器对 .gz 往往直接加 Content-Encoding，此时拿到的是明文 JSON，
// 若一口咬定「魔数不是 1f 8b 就是文件损坏」，在本地 preview / 部分 CDN 上会必然失败。
// 处理策略与 views/Dictionary.vue 的 maybeGunzip 保持一致。
async function decodeMaybeGzip(buf) {
  const u8 = new Uint8Array(buf)
  const isGz = u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b
  if (!isGz) return new TextDecoder('utf-8').decode(u8)
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))
      return await new Response(stream).text()
    } catch { /* 老浏览器或文件损坏 → 交给 fflate */ }
  }
  const { gunzipSync } = await import('fflate')
  return new TextDecoder('utf-8').decode(gunzipSync(u8))
}

export async function loadClassics() {
  if (index) return index
  if (inflight) return inflight

  inflight = (async () => {
    const url = classicsUrl()
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? `韵书数据不存在（${url}）。请先运行 npm run classics:fetch 生成快照`
          : `韵书加载失败：HTTP ${res.status} ${res.statusText}`,
      )
    }
    const text = await decodeMaybeGzip(await res.arrayBuffer())
    let data
    try {
      data = JSON.parse(text)
    } catch (e) {
      // 走到这里说明既不是合法 gzip 也不是合法 JSON，基本可判定下载不完整
      throw new Error(`韵书数据损坏（${e.message}）。请重新运行 npm run classics:fetch`)
    }
    if (!data.rhyme || !data.tone) {
      throw new Error('韵书数据结构异常（缺少 rhyme / tone 字段），请重新运行 npm run classics:fetch')
    }
    index = buildIndex(data)
    return index
  })()

  try {
    return await inflight
  } catch (e) {
    inflight = null // 失败不缓存，允许重试
    throw e
  }
}

// 供自检 / 关于页展示数据来源与统计
export async function classicsInfo() {
  const idx = await loadClassics()
  return { stats: idx.stats, url: classicsUrl() }
}
