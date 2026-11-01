// 新功能（开发者工具等）的补充词条聚合入口。
//
// 背景：i18n.js 主词条文件已达 23KB，且被外壳 / 首页 / 导航高频引用；新功能若每次都改动它，
// 容易在协作中产生冲突。因此新功能词条按功能拆包（i18n.dev 通用 / i18n.svg / i18n.css /
// i18n.home.* 首页卡片按语言分文件），由本模块统一查找，未命中自动回退主 i18n，
// 行为与 t() 完全一致。待规模稳定后再合并回 i18n.js。
import { t, locale } from './i18n.js'
import { SVG_MESSAGES } from './i18n.svg.js'
import { CSS_MESSAGES } from './i18n.css.js'
import { HOME_ZH } from './i18n.home.zh.js'
import { HOME_EN } from './i18n.home.en.js'
import { HOME_JA } from './i18n.home.ja.js'
import { HOME_KO } from './i18n.home.ko.js'
import { HOME_ES } from './i18n.home.es.js'

// 通用词条：导航项与分组名
export const DEV_MESSAGES = {
  'zh-CN': {
    nav: { svgTool: 'SVG 工具箱', svgToolShort: 'SVG', cssReference: 'CSS 速查表', cssReferenceShort: 'CSS' },
    group: { dev: '开发者工具' },
  },
  en: {
    nav: { svgTool: 'SVG Toolkit', svgToolShort: 'SVG', cssReference: 'CSS Reference', cssReferenceShort: 'CSS' },
    group: { dev: 'Developer Tools' },
  },
  'ja-JP': {
    nav: { svgTool: 'SVG ツール', svgToolShort: 'SVG', cssReference: 'CSS リファレンス', cssReferenceShort: 'CSS' },
    group: { dev: '開発者ツール' },
  },
  'ko-KR': {
    nav: { svgTool: 'SVG 도구', svgToolShort: 'SVG', cssReference: 'CSS 참조', cssReferenceShort: 'CSS' },
    group: { dev: '개발자 도구' },
  },
  'es-ES': {
    nav: { svgTool: 'Herramientas SVG', svgToolShort: 'SVG', cssReference: 'Referencia CSS', cssReferenceShort: 'CSS' },
    group: { dev: 'Herramientas de desarrollo' },
  },
}

// 查找顺序：通用 → SVG → CSS → 首页卡片（按语言）→ 主 i18n
const PACKS = [DEV_MESSAGES, SVG_MESSAGES, CSS_MESSAGES, HOME_ZH, HOME_EN, HOME_JA, HOME_KO, HOME_ES]

function lookup(packs, loc, key) {
  for (const pack of packs) {
    // 只查「当前语言」：某包没有该语言就跳过，绝不用中文包兜底
    // （否则单语言包会让所有语言都命中中文，首页卡片按语言分文件就是这个场景）
    const p = pack[loc]
    if (!p) continue
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), p)
    if (v != null) return v
  }
  return null
}

// 支持 {name} 占位符：T('svg.parsed', { w: 100, h: 50, n: 3 })
function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

// 先查补充包，未命中回退主 i18n（fallbackT 默认即 i18n.js 导出的 t）
export function tDev(key, loc, fallbackT = t, params) {
  if (!key) return ''
  const v = lookup(PACKS, loc, key)
  return interpolate(v == null ? fallbackT(key) : v, params)
}

// 绑定当前 locale 的便捷函数：T('svg.title')、T('css.matchCount', { n: 12 })
export function T(key, params) {
  return tDev(key, locale.value, t, params)
}
