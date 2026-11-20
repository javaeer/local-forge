// 首页「离线内核」与 Service Worker 分组的契约测试。
// 新增离线资源时最容易漏两处之一：面板清单没加 id，或 SW 没把它列入 CORE_GROUPS；
// 更早还踩过「预缓存进 CORE_CACHE、离线读取却只查 ASSET_CACHE」的假离线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CORE_GROUPS_META, CORE_GROUP_IDS } from '../../src/lib/offline.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')

test('离线内核：面板清单 id 唯一且与 SW 分组一一对应', () => {
  assert.equal(new Set(CORE_GROUP_IDS).size, CORE_GROUPS_META.length)
  assert.equal(CORE_GROUP_IDS.length, 11)
  for (const id of CORE_GROUP_IDS) {
    const key = id.replace(/[-/]/g, '\\$&')
    assert.match(sw, new RegExp(`['"]?${key}['"]?\\s*:`), `sw.js 缺少分组 ${id}`)
  }
})

test('离线内核：三组离线数据包元信息完整', () => {
  const data = CORE_GROUPS_META.filter((g) => ['classics', 'classics-full', 'tcm'].includes(g.id))
  assert.equal(data.length, 3)
  for (const g of data) {
    assert.ok(g.label && g.size, `${g.id} 缺少展示文案`)
  }
})

test('离线内核：诗文 / 中医快照的索引与分片都已登记', () => {
  for (const url of [
    '/classics/rhyme.json.gz',
    '/classics/citunes.json.gz',
    '/classics/poems.json.gz',
    '/classics/full-index.json.gz',
    '/tcm/tcmchants.json.gz',
    '/tcm/bencao-index.json.gz',
    '/tcm/bencao.json.gz',
    '/tcm/full-index.json.gz',
  ]) {
    assert.ok(sw.includes(url), `sw.js 缺少 ${url}`)
  }
  // 分片数量与抓取脚本产物一致：诗文 46 片、方书 17 片
  assert.match(sw, /CLASSICS_SHARDS[\s\S]{0,120}length: 46/)
  assert.match(sw, /TCM_SHARDS[\s\S]{0,120}length: 17/)
})

test('离线内核：非 WASM 资源离线读取先查 CORE_CACHE 再查 ASSET_CACHE', () => {
  const coreIdx = sw.indexOf('const coreHit = await coreCache.match(req)')
  const assetIdx = sw.indexOf('const cache = await caches.open(ASSET_CACHE)', coreIdx)
  assert.ok(coreIdx > 0, '静态资源分支未查询 CORE_CACHE')
  assert.ok(assetIdx > coreIdx, 'CORE_CACHE 必须优先于 ASSET_CACHE')
})
