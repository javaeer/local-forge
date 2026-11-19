// 词谱数据加载（古典文学模块第 2 期）。
//
// 数据由 scripts/fetch-citunes.mjs 生成到 public/classics/citunes.json.gz（gzip 约 210 KB，
// 未压缩约 790 KB：818 词牌 / 2475 体 / 19.5 万字词谱 + 词林正韵 19 部）。
//
// 加载策略与 classics.js 完全一致（共用 gzjson.js），两条硬要求：
//   1. 只在用户真的打开词牌页时才拉取（动态 import，不进首屏）
//   2. 兼容「服务器原样返回 gzip」与「服务器设了 Content-Encoding 后浏览器自动解压」两种情况
import { buildCiIndex } from './cimeter.js'
import { dataUrl, fetchGzJson } from './gzjson.js'

const FILE = 'classics/citunes.json.gz'
const CMD = 'npm run citunes:fetch'

let index = null
let inflight = null

export function citunesUrl() {
  return dataUrl(FILE)
}

export async function loadCiTunes() {
  if (index) return index
  if (inflight) return inflight

  inflight = (async () => {
    const { data } = await fetchGzJson(FILE, { cmd: CMD, label: '词谱' })
    if (!data.ci || data.v !== 1) {
      throw new Error(`词谱数据结构异常（版本或 ci 字段不符），请重新运行 ${CMD}`)
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
