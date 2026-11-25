// 统一导航模型：侧边栏、命令面板(Ctrl/Cmd+K)、路由 meta 共用 Tool Registry 这一份数据源。
// 本文件是「兼容层」：NAV / NAV_GROUPS / searchNav 全部由 tool-registry.js 派生，
// 保留 navByPath / navTitle / navShort / groupLabel / TAB_ITEMS 等导出，消费方零改动。
import { t, locale } from './i18n.js'
import { tDev } from './i18n.dev.js'
import {
  NAV_VIEW, navGroups, searchTools, getByRoute,
} from './tool-registry.js'

// 新功能词条（开发者工序等）放在独立补充包，未命中时回退主 i18n
export const T = (key) => (key ? tDev(key, locale.value, t) : '')

// NAV：从 Tool Registry 派生的只读视图（结构与原硬编码版本逐字段一致）
export const NAV = NAV_VIEW
export const NAV_GROUPS = navGroups()

export function navByPath(path) {
  return NAV.find((n) => n.path === path) || null
}

// i18n 辅助：优先用 i18n key，未接入时回退中文
export function navTitle(n) {
  if (!n) return ''
  return n.titleKey ? T(n.titleKey) : n.title
}
export function navShort(n) {
  if (!n) return ''
  if (n.shortKey) return T(n.shortKey)
  if (n.short) return n.short
  return navTitle(n).split(' ')[0]
}
export function groupLabel(g) {
  const item = NAV.find((n) => n.group === g)
  return item && item.groupKey ? T(item.groupKey) : g
}

// 移动端底部标签栏：5 个主入口（+ App.vue 里的「全部」按钮共 6 个），其余走命令面板
export const TAB_ITEMS = ['/', '/zip-compress', '/image-convert', '/qr-code', '/ocr'].map(
  (p) => navByPath(p),
).filter(Boolean)

// 命令面板检索：委托给 Tool Registry 的 searchTools，注入当前语言的标题/分组名作为匹配文本。
export function searchNav(query) {
  return searchTools(query, (r) => {
    const n = getByRoute(r.route)
    return `${navTitle(n)} ${navShort(n)} ${groupLabel(r.group)}`
  })
}
