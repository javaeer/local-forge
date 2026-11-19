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
import { dataUrl, fetchGzJson } from './gzjson.js'

const FILE = 'classics/rhyme.json.gz'
const CMD = 'npm run classics:fetch'

let index = null
let inflight = null

export function classicsUrl() {
  return dataUrl(FILE)
}

export async function loadClassics() {
  if (index) return index
  if (inflight) return inflight

  inflight = (async () => {
    const { data } = await fetchGzJson(FILE, { cmd: CMD, label: '韵书' })
    if (!data.rhyme || !data.tone) {
      throw new Error(`韵书数据结构异常（缺少 rhyme / tone 字段），请重新运行 ${CMD}`)
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
