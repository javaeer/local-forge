// Tool Registry 单测：schema 完整性、唯一性、与 5 源一致、派生 API。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TOOL_FIELDS, TOOLS_REGISTRY, NAV_VIEW, WORKSPACE_ORDER, GROUP_ZH,
  allTools, getTool, getByRoute, toolsByWorkspace, navGroups,
  searchTools, validateRegistry,
} from '../../src/lib/tool-registry.js'
import { NAV, NAV_GROUPS, searchNav } from '../../src/lib/nav.js'
import { CORE_GROUP_IDS } from '../../src/lib/offline.js'
import { TOOLS } from '../../src/lib/formats.js'
import { locale } from '../../src/lib/i18n.js'
import { T } from '../../src/lib/i18n.dev.js'

test('每条 ToolRecord 都有 14 个字段且类型正确', () => {
  assert.equal(TOOL_FIELDS.length, 14)
  assert.deepEqual(validateRegistry(CORE_GROUP_IDS), [])
  for (const t of allTools()) {
    for (const f of TOOL_FIELDS) assert.ok(f in t, `${t.id} 缺字段 ${f}`)
    assert.ok(Array.isArray(t.resourceIds), `${t.id} resourceIds 非数组`)
    assert.ok(Array.isArray(t.supportedBrowsers) && t.supportedBrowsers.length > 0)
  }
})

test('Registry 中 id / route 全局唯一', () => {
  const ids = allTools().map((t) => t.id)
  const routes = allTools().map((t) => t.route)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(new Set(routes).size, routes.length)
})

test('resourceIds 全部能在离线内核组（OFFLINE_GROUPS）找到', () => {
  for (const t of allTools()) {
    for (const rid of t.resourceIds) {
      assert.ok(CORE_GROUP_IDS.includes(rid), `${t.id} 引用未知内核 ${rid}`)
    }
  }
})

test('NAV / NAV_GROUPS 由 Registry 派生且一致', () => {
  assert.equal(NAV.length, TOOLS_REGISTRY.length)
  assert.equal(NAV_VIEW.length, NAV.length)
  assert.deepEqual(NAV_GROUPS, navGroups())
  for (const n of NAV) {
    assert.equal(getByRoute(n.path)?.titleKey, n.titleKey, `${n.path} 标题 key 漂移`)
    assert.equal(n.groupKey, 'group.' + getByRoute(n.path).workspace)
    assert.ok(WORKSPACE_ORDER.includes(getByRoute(n.path).workspace))
    assert.equal(GROUP_ZH[getByRoute(n.path).workspace], n.group)
  }
})

test('首页 55 张卡的 base path 都能在 Registry 反查（无游离）', () => {
  let checked = 0
  for (const g of TOOLS) {
    for (const item of g.items) {
      const reg = getByRoute(item.to.split('?')[0])
      assert.ok(reg, `卡片游离于 Registry：${item.to}`)
      assert.equal(item.toolId, reg.id, `${item.to} 反查 id 不一致`)
      assert.equal(item.engine, reg.engine, `${item.to} 能力字段未派生`)
      checked++
    }
  }
  assert.equal(checked, TOOLS.reduce((n, g) => n + g.items.length, 0))
})

test('getTool / getByRoute / toolsByWorkspace 查询正确', () => {
  assert.equal(getTool('zip-compress')?.route, '/zip-compress')
  assert.equal(getTool('/zip-compress')?.id, 'zip-compress')
  assert.equal(getByRoute('/no-such-route'), null)
  assert.ok(toolsByWorkspace('lookup').length >= 5)
})

test('searchTools 检索命中且按相关性排序，空串返回全部', () => {
  assert.equal(searchTools('').length, TOOLS_REGISTRY.length)
  const r = searchTools('zip')
  assert.ok(r.length > 0)
  assert.ok(r.some((x) => x.route === '/zip-compress'))
  // 命令面板兼容层同样命中
  assert.ok(searchNav('ocr').some((n) => n.path === '/ocr'))
})

test('local-only 工具不含 optional-bridge（网络策略边界清晰）', () => {
  for (const t of allTools()) {
    assert.ok(['local-only', 'optional-bridge'].includes(t.networkPolicy), `${t.id} 网络策略非法`)
  }
  // 明确声明需要桥接的工具才允许网络回退
  const bridged = allTools().filter((t) => t.networkPolicy === 'optional-bridge').map((t) => t.id)
  assert.ok(bridged.includes('media-fetch'))
})

test('每条工具的 titleKey 五语齐全，不泄漏原始 key', () => {
  const keys = allTools().map((t) => t.titleKey)
  try {
    for (const loc of ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']) {
      locale.value = loc
      for (const k of keys) assert.ok(T(k) && T(k) !== k, `${loc} 缺词条：${k}`)
    }
  } finally {
    locale.value = 'zh-CN'
  }
})
