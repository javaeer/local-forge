// 新功能（开发者工具等）的补充词条聚合入口。
//
// 背景：i18n.js 主词条文件已达 23KB，且被外壳 / 首页 / 导航高频引用；新功能若每次都改动它，
// 容易在协作中产生冲突。因此新功能词条按功能拆包（i18n.dev 通用 / i18n.svg / i18n.css /
// i18n.home.* 首页卡片按语言分文件 / i18n.views 业务视图），由本模块统一查找，未命中自动回退主 i18n，
// 行为与 t() 完全一致。待规模稳定后再合并回 i18n.js。
import { t, locale } from './i18n.js'
import { SVG_MESSAGES } from './i18n.svg.js'
import { CSS_MESSAGES } from './i18n.css.js'
import { HOME_ZH } from './i18n.home.zh.js'
import { HOME_EN } from './i18n.home.en.js'
import { HOME_JA } from './i18n.home.ja.js'
import { HOME_KO } from './i18n.home.ko.js'
import { HOME_ES } from './i18n.home.es.js'
import { VIEW_MESSAGES } from './i18n.views.js'
import { CLASSICS_MESSAGES } from './i18n.classics.js'
import { TCM_MESSAGES } from './i18n.tcm.js'
import { BENCAO_MESSAGES } from './i18n.bencao.js'
import { TCMBOOKS_MESSAGES } from './i18n.tcmbooks.js'
import { TASKS_MESSAGES } from './i18n.tasks.js'
import { UI_QR_MESSAGES } from './i18n.ui.qr.js'
import { UI_B_MESSAGES } from './i18n.ui.b.js'
import { UI_C_MESSAGES } from './i18n.ui.c.js'
import { UI_D_MESSAGES } from './i18n.ui.d.js'
import { UI_DOC_MESSAGES } from './i18n.ui.doc.js'

// 通用词条：导航项与分组名
export const DEV_MESSAGES = {
  'zh-CN': {
    nav: { svgTool: 'SVG 工具箱', svgToolShort: 'SVG', wechatSearch: '公众号文章检索', wechatSearchShort: '检索', cssReference: 'CSS 速查表', cssReferenceShort: 'CSS', dict: '离线词典', dictShort: '词典', mediaFetch: '媒体获取', mediaFetchShort: '获取' },
    group: { dev: '开发者工序', lookup: '知识矿藏' },
  },
  en: {
    nav: { svgTool: 'SVG Toolkit', svgToolShort: 'SVG', wechatSearch: 'WeChat Article Search', wechatSearchShort: 'Search', cssReference: 'CSS Reference', cssReferenceShort: 'CSS', dict: 'Offline Dictionary', dictShort: 'Dictionary', mediaFetch: 'Media Fetch', mediaFetchShort: 'Fetch' },
    group: { dev: 'Developer Workshop', lookup: 'Knowledge Vault' },
  },
  'ja-JP': {
    nav: { svgTool: 'SVG ツール', svgToolShort: 'SVG', wechatSearch: '微信公衆号の記事検索', wechatSearchShort: '検索', cssReference: 'CSS リファレンス', cssReferenceShort: 'CSS', dict: 'オフライン辞書', dictShort: '辞書', mediaFetch: 'メディア取得', mediaFetchShort: '取得' },
    group: { dev: '開発者工程', lookup: '知識の鉱脈' },
  },
  'ko-KR': {
    nav: { svgTool: 'SVG 도구', svgToolShort: 'SVG', wechatSearch: '위챗 공중호 글 검색', wechatSearchShort: '검색', cssReference: 'CSS 참조', cssReferenceShort: 'CSS', dict: '오프라인 사전', dictShort: '사전', mediaFetch: '미디어 가져오기', mediaFetchShort: '가져오기' },
    group: { dev: '개발자 공정', lookup: '지식 광맥' },
  },
  'es-ES': {
    nav: { svgTool: 'Herramientas SVG', svgToolShort: 'SVG', wechatSearch: 'Búsqueda de artículos de WeChat', wechatSearchShort: 'Buscar', cssReference: 'Referencia CSS', cssReferenceShort: 'CSS', dict: 'Diccionario sin conexión', dictShort: 'Diccionario', mediaFetch: 'Obtener medios', mediaFetchShort: 'Obtener' },
    group: { dev: 'Taller de desarrollo', lookup: 'Veta de conocimiento' },
  },
}

// 查找顺序：通用 → SVG → CSS → 古典文学 → 中医 → 任务入口 → 首页卡片（按语言）→ 视图（按语言）→ 主 i18n
const PACKS = [DEV_MESSAGES, SVG_MESSAGES, CSS_MESSAGES, CLASSICS_MESSAGES, TCM_MESSAGES, BENCAO_MESSAGES, TCMBOOKS_MESSAGES, TASKS_MESSAGES, HOME_ZH, HOME_EN, HOME_JA, HOME_KO, HOME_ES, VIEW_MESSAGES, UI_QR_MESSAGES, UI_B_MESSAGES, UI_C_MESSAGES, UI_D_MESSAGES, UI_DOC_MESSAGES]

function lookup(packs, loc, key) {
  for (const pack of packs) {
    const p = pack[loc]
    if (!p) continue
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), p)
    if (v != null) return v
  }
  return null
}

function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

export function tDev(key, loc, fallbackT = t, params) {
  if (!key) return ''
  const v = lookup(PACKS, loc, key)
  return interpolate(v == null ? fallbackT(key) : v, params)
}

export function T(key, params) {
  return tDev(key, locale.value, t, params)
}
