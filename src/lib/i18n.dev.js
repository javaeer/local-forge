// 新功能（开发者工具等）的补充词条。
//
// 背景：i18n.js 主词条文件已达 23KB，且被外壳 / 首页 / 导航高频引用；新功能接入时若每次都
// 改动它，容易在协作中产生冲突。因此新功能词条先落在独立模块，通过 tDev() 与主 i18n 合并
// 查找（未命中自动回退主包），行为与 t() 完全一致。待规模稳定后再合并回 i18n.js。
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

// 先查补充包，未命中回退主 i18n（fallbackT 即 i18n.js 导出的 t），保证与主词条行为一致
export function tDev(key, loc, fallbackT) {
  if (!key) return ''
  const pack = DEV_MESSAGES[loc] || DEV_MESSAGES['zh-CN']
  const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), pack)
  return v == null ? fallbackT(key) : v
}
