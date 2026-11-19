// 词谱数据加载（古典文学模块第 2 期）。
//
// 数据由 scripts/fetch-citunes.mjs 生成到 public/classics/citunes.json.gz（gzip 约 210 KB，
// 未压缩约 790 KB：818 词牌 / 2475 体 / 19.5 万字词谱 + 词林正韵 19 部）。
//
// 加载策略与 classics.js 完全一致，两条硬要求：
//   1. 只在用户真的打开词牌页时才拉取（动态 import，不进首屏）
//   2. 兼容「服务器原样返回 gzip」与「服务器设了 Content-Encoding 后浏览器自动解压」两种情况
import { buildCiIndex } from './cimeter.js'

const FILE = 'classics/citunes.json.gz'

let index = null
let inflight = null

export function citunesUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}${FILE}`.replace(/\/{2,}/g, '/')
}

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

export async function loadCiTunes() {
  if (index) return index
  if (inflight) return inflight

  inflight = (async () => {
    const url = citunesUrl()
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? `词谱数据不存在（${url}）。请先运行 npm run citunes:fetch 生成快照`
          : `词谱加载失败：HTTP ${res.status} ${res.statusText}`,
      )
    }
    const text = await decodeMaybeGzip(await res.arrayBuffer())
    let data
    try {
      data = JSON.parse(text)
    } catch (e) {
      // 既不是合法 gzip 也不是合法 JSON，基本可判定下载不完整
      throw new Error(`词谱数据损坏（${e.message}）。请重新运行 npm run citunes:fetch`)
    }
    if (!data.ci || data.v !== 1) {
      throw new Error('词谱数据结构异常（版本或 ci 字段不符），请重新运行 npm run citunes:fetch')
    }
    index = buildCiIndex(data)
    return index
  })()

  try {
    return await inflight
  } catch (e) {
    inflight = null // 失败不缓存，允许重试
    throw e
  }
}

export async function citunesInfo() {
  const idx = await loadCiTunes()
  return { stats: idx.stats, url: citunesUrl() }
}
