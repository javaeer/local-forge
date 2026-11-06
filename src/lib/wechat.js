// 公众号排版内核（WeChat Article Compiler）
//
// 定位：把 Markdown 编译成「微信后台怎么洗都洗不坏」的纯内联样式 HTML 片段。
// 与 LocalForge 的隐私模型一致：零依赖、纯函数、不联网、不调用任何微信接口；
// 产物只用于「复制到剪贴板 → 用户自己粘贴进公众号后台」，发布动作永远留给用户。
//
// 设计取舍（站在 doocs/md / mdnice / 文颜 / md2wechat 的肩膀上，按纯本地场景收敛）：
//   · 不用 CSS 主题 + juice：juice 需要 DOM/CSS 解析运行时，且微信不支持 var()/class。
//     这里直接用 JS styleMapping 在编译期生成内联样式 —— 零依赖、产物最干净、Node 可直接单测。
//   · 块级解析思路复用 src/lib/docconvert.js 的 parseMarkdown()，但自带一份增强实现：
//     docconvert.js 顶层依赖 pdf-lib，若直接 import 会让本内核无法脱离浏览器依赖独立测试。
//   · 官方规则来自《微信公众平台编辑器插件开发规范》与 wechatjs/verify-article-structure-spec，
//     本模块实现其中「可静态检测」的子集（无需 puppeteer / 无需真实浏览器测量）。
//   · 不伪造能力：纯本地零依赖做不了 KaTeX / Mermaid 的真实渲染，因此明确降级为
//     「提示用户把公式/图表截图为本地图片插入」，而不是输出半成品 SVG。
//
// 输出结构：<section> 容器 + <span leaf=""> 包裹文字节点 + 全属性 style=""，
// 无 class / id / var() / font-family / position / float / grid / 动画 / 外链资源。
//
// 三层解耦（供 wechat-extra.js 的多端渲染器复用）：
//   ① AST 层        parseDocument() / parseBlocks() —— 与平台无关的中间表示
//   ② 样式映射层    buildStyleMapping()（= buildStyles）—— 主题/选项 → 白名单内联样式表
//   ③ 渲染层        compileWechatAst()（微信专用）/ renderDocument()（多端，见 wechat-extra.js）
//   诊断横切        validateWechatHtml() 产出 { code, params, level }，由 describeIssue() 本地化
//
// 兼容性承诺：renderWechatArticle() 的返回结构 { html, previewHtml, plain, report, stats,
// meta, title } 与 report.{ok,errors,warnings,stats} 保持不变；report 额外新增 code 化的 issues。

/* ---------------- 官方白名单（静态可校验子集） ---------------- */

// 允许出现在 style="" 里的 CSS 属性（对齐官方规范）
export const ALLOWED_CSS = new Set([
  'color', 'font-size', 'font-weight', 'font-style', 'text-align', 'letter-spacing',
  'line-height', 'text-decoration', 'text-indent',
  'background-color', 'background-image', 'background-repeat', 'background-size', 'background-position',
  'border', 'border-width', 'border-color', 'border-style', 'border-radius',
  'border-left', 'border-right', 'border-top', 'border-bottom',
  'padding', 'margin', 'width', 'height', 'max-width', 'min-width', 'max-height',
  'overflow', 'overflow-x', 'overflow-y', 'display', 'vertical-align',
  'box-shadow', 'opacity', 'transform', 'transform-origin', 'user-select', 'white-space',
])
export const DENIED_TAGS = [
  'script', 'iframe', 'noscript', 'form', 'input', 'button', 'canvas', 'object',
  'embed', 'style', 'link', 'meta', 'head', 'body', 'html', 'video', 'audio',
]
// 明确禁止的 CSS 属性 / 值（官方规范 + 社区实测）
const DENIED_CSS = ['position', 'float', 'z-index', 'font-family', 'clip-path', 'filter', 'animation', 'transition', 'caret-color']
const DENIED_VALUES = [
  /\bvar\s*\(/i, /!important/i, /@media/i, /@keyframes/i,
  /display\s*:\s*grid/i, /text-align\s*:\s*(start|end)\b/i,
  /javascript\s*:/i, /expression\s*\(/i,
]

/* ---------------- 诊断：结构化 code + 5 语言文案 ---------------- */
// 内核只产出 { code, params, level }；可读文本由 describeIssue() 生成。
// 文案内置 5 语言（与 workflow.js 的 WF_LABELS 同一约定：避免 i18n 循环依赖、Node 可直接测），
// 单测断言每个 code 五语言齐全。errors / warnings 仍派生为 zh-CN 字符串，兼容既有调用与单测。
const ISSUE_LOCALES = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']
// code → [zh-CN, en, ja-JP, ko-KR, es-ES]，占位符 {xxx} 由 interpolate 替换
export const ISSUE_MESSAGES = {
  'denied-tag': ['包含被禁止的标签 <{tag}>', 'Forbidden tag <{tag}> found', '禁止タグ <{tag}> が含まれています', '금지 태그 <{tag}> 포함', 'Etiqueta prohibida <{tag}>'],
  'residual-class-id': ['产物中残留 class / id 属性（微信会清除，样式会丢失）', 'Residual class / id attributes (WeChat strips them)', 'class / id 属性が残っています（微信が削除します）', 'class / id 속성이 남음(위챗이 제거)', 'Atributos class / id residuales (WeChat los elimina)'],
  'residual-on-handler': ['产物中残留事件属性（on*）', 'Residual event attributes (on*)', 'イベント属性(on*)が残っています', '이벤트 속성(on*)이 남음', 'Atributos de evento (on*) residuales'],
  'style-denied-value': ['style 含禁用写法：{sample}', 'style contains a forbidden value: {sample}', 'style に禁止された記述: {sample}', 'style 에 금지 구문: {sample}', 'style contiene un valor prohibido: {sample}'],
  'style-denied-prop': ['style 含禁用属性 {prop}', 'style contains forbidden property {prop}', 'style に禁止プロパティ {prop}', 'style 에 금지 속성 {prop}', 'style contiene la propiedad prohibida {prop}'],
  'style-non-whitelist': ['style 含不在官方白名单的属性 {prop}（可能被微信过滤）', 'style has non-whitelisted property {prop} (may be filtered)', 'style に非ホワイトリスト属性 {prop}（过滤の可能性）', 'style 에 화이트리스트 외 속성 {prop}(필터 가능)', 'style tiene la propiedad {prop} fuera de la lista (puede filtrarse)'],
  'leaf-block-child': ['span[leaf] 内包裹了块级元素（官方规范禁止）', 'span[leaf] wraps a block element (forbidden)', 'span[leaf] がブロック要素を内包（規範違反）', 'span[leaf] 가 블록 요소를 포함(규범 위반)', 'span[leaf] envuelve un elemento de bloque (prohibido)'],
  'img-remote-src': ['图片不是本地 DataURL 或微信域名：{sample}', 'Image is not a local DataURL or WeChat domain: {sample}', '画像がローカル DataURL / 微信ドメインではありません: {sample}', '이미지가 로컬 DataURL/위챗 도메인이 아님: {sample}', 'La imagen no es DataURL local ni dominio WeChat: {sample}'],
  'img-missing-data-w': ['图片建议补 data-w（官方校验器用原始宽度做溢出兜底）', 'Image should carry data-w (validator uses it for overflow)', '画像に data-w を推奨（検証器が溢流判定に使用）', '이미지에 data-w 권장(검증기가 오버플로 판정)', 'La imagen debería llevar data-w (el validador lo usa para desbordes)'],
  'img-missing-max-width': ['图片缺少 max-width:100%（移动端可能溢出）', 'Image lacks max-width:100% (may overflow on mobile)', '画像に max-width:100% がありません（モバイルで溢流）', '이미지에 max-width:100% 없음(모바일 오버플로)', 'Falta max-width:100% en la imagen (puede desbordar en móvil)'],
  'link-non-wechat': ['正文出现非微信域名链接：{sample}', 'Non-WeChat link in body: {sample}', '本文に微信ドメイン外リンク: {sample}', '본문에 위챗 외 링크: {sample}', 'Enlace fuera del dominio WeChat en el cuerpo: {sample}'],
  'pre-no-overflow': ['pre 缺少 overflow-x:auto（长代码在移动端会被截断）', 'pre lacks overflow-x:auto (long code clipped on mobile)', 'pre に overflow-x:auto がありません（長コードが切れます）', 'pre 에 overflow-x:auto 없음(긴 코드 잘림)', 'Falta overflow-x:auto en pre (código largo se corta en móvil)'],
  'fixed-px-width': ['存在固定 px 宽度，官方规范建议用百分比 / max-width 自适应', 'Fixed px width found; spec recommends % / max-width', '固定 px 幅があります（%/max-width を推奨）', '고정 px 너비 있음(%/max-width 권장)', 'Ancho fijo en px; la especificación recomienda % / max-width'],
  'height-zero': ['存在 height:0，若容器内含文字会在移动端不可见', 'height:0 found; text inside may be invisible on mobile', 'height:0 があります（内部文字が非表示の恐れ）', 'height:0 있음(내부 글자 비표시 가능)', 'height:0 presente; el texto interno puede ser invisible en móvil'],
  'dom-too-deep': ['DOM 嵌套最深 {depth} 层，超过 10 层可能被编辑器自动精简', 'DOM nesting reaches {depth} levels; >10 may be simplified', 'DOM ネストが最大 {depth} 階層（10 超で簡略化の恐れ）', 'DOM 중첩 최대 {depth}층(10 초과 시 정리 가능)', 'Anidamiento DOM de {depth} niveles; >10 puede simplificarse'],
  'img-not-localized': ['图片未本地化：{src}（请拖入对应图片，或改用微信素材库链接）', 'Image not localized: {src} (drop the image, or use a WeChat asset URL)', '画像が未ローカル化: {src}（画像をドロップするか微信素材 URL を）', '이미지 미로컬화: {src}(이미지 추가 또는 위챗 소재 URL)', 'Imagen no localizada: {src} (añádela o usa una URL de material WeChat)'],
  'unknown-module': ['未知排版模块 :::{name}，已按普通段落输出', 'Unknown module :::{name}; rendered as a plain paragraph', '未知モジュール :::{name} を通常段落として出力', '알 수 없는 모듈 :::{name}, 일반 단락으로 출력', 'Módulo desconocido :::{name}; renderizado como párrafo'],
  'module-empty': ['模块 :::{name} 缺少有效字段，已跳过', 'Module :::{name} has no valid fields; skipped', 'モジュール :::{name} に有効な項目がなくスキップ', '모듈 :::{name} 에 유효 필드 없음, 건너뜀', 'El módulo :::{name} no tiene campos válidos; omitido'],
  // 元数据校对（checkMetadata，见 wechat-extra.js）
  'meta-title-missing': ['缺少标题（建议补 Frontmatter title 或一级标题）', 'Missing title (add frontmatter title or an H1)', 'タイトルがありません（frontmatter title か H1 を）', '제목 없음(frontmatter title 또는 H1 추가)', 'Falta el título (añade title en frontmatter o un H1)'],
  'meta-title-too-long': ['标题 {n} 字，超过公众号建议的 64 字', 'Title is {n} chars, over the 64-char recommendation', 'タイトル {n} 字（推奨 64 字超）', '제목 {n}자(권장 64자 초과)', 'Título de {n} caracteres, supera los 64 recomendados'],
  'meta-digest-too-long': ['摘要 {n} 字，超过公众号建议的 120 字', 'Digest is {n} chars, over the 120-char recommendation', '要約 {n} 字（推奨 120 字超）', '요약 {n}자(권장 120자 초과)', 'Resumen de {n} caracteres, supera los 120 recomendados'],
  'meta-no-digest': ['未填写摘要（description / digest），后台将自动截取', 'No digest (description / digest); the editor will auto-extract one', '要約未設定（description / digest）—自動抽出されます', '요약 미설정(자동 추출됨)', 'Sin resumen; el editor lo extraerá automáticamente'],
  'meta-too-short': ['正文仅 {n} 字，内容偏短', 'Body is only {n} chars — quite short', '本文が {n} 字のみ（短め）', '본문이 {n}자뿐(짧음)', 'El cuerpo tiene solo {n} caracteres — algo corto'],
  'meta-too-many-links': ['含 {n} 个外链，微信正文外链政策较严格', '{n} external links; WeChat body link policy is strict', '外部リンク {n} 件（本文リンク規制が厳格）', '외부 링크 {n}개(본문 링크 규제 엄격)', '{n} enlaces externos; la política de enlaces de WeChat es estricta'],
  // 自定义主题校验（importTheme，见 wechat-extra.js）
  'theme-invalid-json': ['主题文件不是合法 JSON', 'Theme file is not valid JSON', 'テーマファイルが不正な JSON', '테마 파일이 올바른 JSON 이 아님', 'El archivo de tema no es JSON válido'],
  'theme-schema-mismatch': ['主题 schemaVersion={v} 与当前版本不兼容', 'Theme schemaVersion={v} is incompatible', 'テーマ schemaVersion={v} に非対応', '테마 schemaVersion={v} 비호환', 'schemaVersion={v} del tema incompatible'],
  'theme-bad-color': ['主题字段 {field} 的颜色值不合法，已回退默认色', 'Theme field {field} has an invalid color; fell back to default', 'テーマ項目 {field} の色が不正（既定色にフォールバック）', '테마 필드 {field} 색상 무효(기본값 적용)', 'Color inválido en {field}; se usó el valor por defecto'],
}

function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}
// 生成单条诊断的可读文本（默认 zh-CN，保证 Node 单测与既有调用稳定）
export function describeIssue(issue, locale = 'zh-CN') {
  const row = ISSUE_MESSAGES[issue && issue.code]
  const i = Math.max(0, ISSUE_LOCALES.indexOf(locale))
  const tpl = row ? (row[i] || row[0]) : (issue && issue.code) || ''
  return interpolate(tpl, issue && issue.params)
}
// 由 code 化 issues 派生兼容的 errors / warnings 字符串数组
export function deriveIssues(issues, locale = 'zh-CN') {
  const errors = [], warnings = []
  for (const it of issues || []) {
    const text = describeIssue(it, locale)
    ;(it.level === 'error' ? errors : warnings).push(text)
  }
  return { errors, warnings }
}
// 去重收集（同一 code + 参数只报一次，避免长文档刷屏）
function pushIssue(list, seen, code, params, level) {
  const key = level + ':' + code + ':' + JSON.stringify(params || {})
  if (seen.has(key)) return
  seen.add(key)
  list.push({ code, params: params || {}, level })
}

/* ---------------- 主题 ---------------- */
// 主题即「一组可序列化的 JS 变量」，编译期展开成真实值（等价于 doocs/md 的 cssProcessor，
// 但因为不写 CSS，天然没有 var()/calc() 展开问题）。
export const WECHAT_THEMES = [
  { id: 'ink', name: '墨蓝', primary: '#1d4ed8', accent: '#0f766e', text: '#2f3542', sub: '#6b7280', bg: '#ffffff', soft: '#f5f7fb', quoteBg: '#f3f6fd', codeBg: '#0f172a', codeText: '#e2e8f0', border: '#e3e8f2' },
  { id: 'orange', name: '橙心', primary: '#ea580c', accent: '#c2410c', text: '#3f3a36', sub: '#7c7169', bg: '#ffffff', soft: '#fdf6f0', quoteBg: '#fdf1e7', codeBg: '#2b2118', codeText: '#f5e9dc', border: '#f0e2d5' },
  { id: 'green', name: '竹青', primary: '#0f766e', accent: '#115e59', text: '#2f3b38', sub: '#6b7c77', bg: '#ffffff', soft: '#f2f8f6', quoteBg: '#eaf5f1', codeBg: '#122620', codeText: '#dcefe8', border: '#dcebe5' },
  { id: 'mono', name: '极简灰', primary: '#334155', accent: '#475569', text: '#333333', sub: '#777777', bg: '#ffffff', soft: '#f7f7f7', quoteBg: '#f4f4f4', codeBg: '#1f2430', codeText: '#e6e8ee', border: '#e5e5e5' },
]
export const DEFAULT_THEME = 'ink'

const THEME_COLOR_FIELDS = ['primary', 'accent', 'text', 'sub', 'bg', 'soft', 'quoteBg', 'codeBg', 'codeText', 'border']
// 颜色净化：只放行合法 hex / rgb()/rgba()，杜绝把 `;position:fixed` 之类注入 style="".
function safeColor(v, fallback) {
  const s = String(v == null ? '' : v).trim()
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s
  if (/^rgba?\(\s*[\d.,%\s]+\s*\)$/i.test(s)) return s
  return fallback
}
// 把任意输入（含用户导入的自定义主题对象）规范成可信主题；非法颜色一律回退内置主题对应值
export function sanitizeTheme(raw) {
  const base = WECHAT_THEMES[0]
  const o = raw && typeof raw === 'object' ? raw : {}
  const out = {
    id: String(o.id || 'custom').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'custom',
    name: String(o.name || '自定义主题').slice(0, 24),
  }
  for (const f of THEME_COLOR_FIELDS) out[f] = safeColor(o[f], base[f])
  return out
}
export function getTheme(id) {
  // 支持传主题对象（自定义主题），内部先净化再使用
  if (id && typeof id === 'object') return sanitizeTheme(id)
  return WECHAT_THEMES.find((t) => t.id === id) || WECHAT_THEMES[0]
}

/* ---------------- 工具 ---------------- */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
export const escapeHtml = esc
const escAttr = esc

// 中英文自动加空格（pangu），只在纯文本片段上执行，避免破坏 URL / HTML 属性
function smartSpace(s, on) {
  if (!on) return s
  return String(s)
    .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2')
}

// 把样式对象序列化为 style="" 内容，并强制走白名单过滤（防御性：主题/自定义样式写错也不会产出违规属性）
export function cssText(style) {
  return Object.entries(style || {})
    .filter(([k, v]) => v != null && v !== '' && ALLOWED_CSS.has(k))
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}
const st = (style, extra) => ` style="${escAttr(cssText(style) + (extra ? ';' + extra : ''))}"`

/* ---------------- 样式映射层（编译期生成，全部内联） ---------------- */
function buildStyles(theme, opts) {
  const t = getTheme(theme)
  const fs = Number(opts.fontSize) || 16
  const lh = Number(opts.lineHeight) || 1.75
  const radius = opts.radius === false ? '0px' : '8px'
  return {
    root: { 'background-color': t.bg, color: t.text, 'font-size': `${fs}px`, 'line-height': String(lh), 'letter-spacing': '0.3px' },
    eyebrow: { color: t.primary, 'font-size': `${fs - 4}px`, 'letter-spacing': '2px', 'font-weight': '600' },
    h1: { color: t.text, 'font-size': `${fs + 8}px`, 'font-weight': '700', 'line-height': '1.4', margin: '28px 0 14px', 'text-align': 'center' },
    h2: { color: t.text, 'font-size': `${fs + 4}px`, 'font-weight': '700', 'line-height': '1.45', margin: '30px 0 14px', 'border-left': `4px solid ${t.primary}`, padding: '0 0 0 12px' },
    h3: { color: t.primary, 'font-size': `${fs + 1}px`, 'font-weight': '600', margin: '24px 0 10px' },
    h4: { color: t.text, 'font-size': `${fs}px`, 'font-weight': '600', margin: '20px 0 8px' },
    p: { color: t.text, 'font-size': `${fs}px`, 'line-height': String(lh), margin: '0 0 18px', 'text-align': 'justify' },
    leaf: { color: t.text },
    strong: { color: t.primary, 'font-weight': '700' },
    em: { 'font-style': 'italic', color: t.text },
    del: { 'text-decoration': 'line-through', color: t.sub },
    mark: { 'background-color': t.quoteBg, color: t.text, padding: '0 3px' },
    codeInline: { 'background-color': t.soft, color: t.accent, 'font-size': `${fs - 2}px`, padding: '2px 5px', 'border-radius': '4px' },
    a: { color: t.primary, 'text-decoration': 'underline' },
    fnRef: { color: t.primary, 'font-size': `${fs - 4}px`, 'vertical-align': 'super' },
    quote: { 'background-color': t.quoteBg, 'border-left': `4px solid ${t.primary}`, padding: '12px 16px', margin: '0 0 18px', 'border-radius': `0 ${radius} ${radius} 0`, color: t.sub, 'font-size': `${fs - 1}px` },
    alert: { 'background-color': t.soft, 'border-left': `4px solid ${t.accent}`, padding: '12px 16px', margin: '0 0 18px', 'border-radius': radius },
    alertLabel: { color: t.accent, 'font-weight': '700', 'font-size': `${fs - 2}px`, 'letter-spacing': '1px' },
    list: { margin: '0 0 18px', padding: '0 0 0 22px', color: t.text, 'font-size': `${fs}px`, 'line-height': String(lh) },
    li: { margin: '6px 0', color: t.text },
    hr: { border: '0', 'border-top': `1px solid ${t.border}`, margin: '28px 0' },
    table: { 'border-collapse': 'collapse', width: '100%', margin: '0 0 18px', 'font-size': `${fs - 2}px` },
    th: { 'background-color': t.soft, color: t.text, border: `1px solid ${t.border}`, padding: '8px 10px', 'text-align': 'left', 'font-weight': '700' },
    td: { border: `1px solid ${t.border}`, padding: '8px 10px', color: t.text },
    codeWrap: { 'background-color': t.codeBg, 'border-radius': radius, padding: '14px 16px', margin: '0 0 18px', 'overflow-x': 'auto' },
    codeBar: { 'line-height': '1', 'font-size': '0', margin: '0 0 10px' },
    pre: { margin: '0', 'white-space': 'pre-wrap', 'overflow-x': 'auto', 'font-size': `${fs - 3}px`, 'line-height': '1.65', color: t.codeText },
    codeText: { color: t.codeText },
    figure: { margin: '0 0 18px', 'text-align': 'center' },
    img: { 'max-width': '100%', height: 'auto', display: 'block', margin: '0 auto', 'border-radius': radius },
    figcaption: { color: t.sub, 'font-size': `${fs - 3}px`, 'text-align': 'center', margin: '8px 0 0' },
    placeholder: { 'background-color': t.soft, color: t.sub, 'font-size': `${fs - 2}px`, padding: '14px', 'border-radius': radius, 'text-align': 'center', margin: '0 0 18px' },
    hero: { 'background-color': t.soft, padding: '26px 22px', 'border-radius': radius, margin: '0 0 26px', 'text-align': 'center', 'border-top': `4px solid ${t.primary}` },
    heroTitle: { color: t.text, 'font-size': `${fs + 9}px`, 'font-weight': '700', 'line-height': '1.4', margin: '10px 0' },
    heroSub: { color: t.sub, 'font-size': `${fs - 1}px`, margin: '8px 0' },
    heroMeta: { color: t.sub, 'font-size': `${fs - 4}px`, 'letter-spacing': '1px' },
    tag: { color: t.primary, 'background-color': t.bg, 'font-size': `${fs - 4}px`, padding: '2px 8px', 'border-radius': '20px', margin: '0 3px', display: 'inline-block' },
    card: { 'background-color': t.soft, 'border-left': `3px solid ${t.primary}`, padding: '12px 16px', 'border-radius': radius, margin: '0 0 12px' },
    cardAccent: { 'background-color': t.quoteBg, 'border-left': `3px solid ${t.accent}`, padding: '12px 16px', 'border-radius': radius, margin: '0 0 12px' },
    cardTitle: { color: t.primary, 'font-weight': '700', 'font-size': `${fs}px` },
    cardBody: { color: t.sub, 'font-size': `${fs - 2}px`, 'line-height': '1.65' },
    footTitle: { color: t.text, 'font-size': `${fs}px`, 'font-weight': '700', 'border-top': `1px solid ${t.border}`, padding: '16px 0 8px', margin: '28px 0 10px' },
    footItem: { color: t.sub, 'font-size': `${fs - 3}px`, 'line-height': '1.7', margin: '4px 0' },
  }
}
// ② 样式映射层公开入口（供多端渲染器注入 / 覆盖）
export const buildStyleMapping = buildStyles

/* ---------------- ① AST 层：Frontmatter 与块级解析 ---------------- */
export function parseFrontmatter(md) {
  const text = String(md || '').replace(/\r\n?/g, '\n')
  const meta = {}
  if (!/^---\s*\n/.test(text)) return { meta, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { meta, body: text }
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(line)
    if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return { meta, body: text.slice(end + 4).replace(/^\s*\n/, '') }
}

// 增强块级解析：借鉴 docconvert.js 的 parseMarkdown，补齐公众号所需结构。
// 块类型：heading / paragraph / list / code / quote / alert / table / hr / image / module
export function parseBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  const footnotes = []
  let i = 0
  const isFence = (s) => /^\s{0,3}(```|~~~)/.test(s)
  const isHr = (s) => /^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(s)
  const isQuote = (s) => /^\s{0,3}>\s?/.test(s)
  const isUl = (s) => /^\s{0,3}[-*+]\s+/.test(s)
  const isOl = (s) => /^\s{0,3}\d+[.)]\s+/.test(s)
  const isTableSep = (s) => /^\s*\|?[\s:|-]+\|?\s*$/.test(s) && /-/.test(s)
  const isModule = (s) => /^\s{0,3}:::[A-Za-z][\w-]*(?:\[[^\]]*\])?\s*$/.test(s)

  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) { i++; continue }

    // 脚注定义 → 收进尾注区，不进入正文块
    const fn = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line)
    if (fn) { footnotes.push({ label: fn[1], text: fn[2] }); i++; continue }

    // 容器模块 :::hero / :::cards[标题] / :::metrics ...
    if (isModule(line)) {
      const head = /^\s{0,3}:::([A-Za-z][\w-]*)(?:\[([^\]]*)\])?\s*$/.exec(line)
      const body = []
      i++
      while (i < lines.length && !/^\s{0,3}:::\s*$/.test(lines[i])) { body.push(lines[i]); i++ }
      i++ // 跳过结束 :::
      blocks.push({ type: 'module', name: head[1].toLowerCase(), title: head[2] || '', body })
      continue
    }

    // 围栏代码块
    if (isFence(line)) {
      const lang = line.replace(/^\s{0,3}(```|~~~)/, '').trim().toLowerCase()
      i++
      const buf = []
      while (i < lines.length && !isFence(lines[i])) { buf.push(lines[i]); i++ }
      i++
      blocks.push({ type: 'code', lang, text: buf.join('\n') })
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue }
    if (isHr(line)) { blocks.push({ type: 'hr' }); i++; continue }

    // 独立图片行
    const img = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line)
    if (img) { blocks.push({ type: 'image', alt: img[1], src: img[2], title: img[3] || '' }); i++; continue }

    // GFM 警告块
    const alert = /^\s{0,3}>\s*\[!(\w+)\]\s*(.*)$/.exec(line)
    if (alert) {
      const buf = []
      while (i < lines.length && isQuote(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, '').replace(/^\[!\w+\]\s*/, '')); i++
      }
      blocks.push({ type: 'alert', kind: alert[1].toLowerCase(), text: buf.join(' ').trim() })
      continue
    }
    if (isQuote(line)) {
      const buf = []
      while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++ }
      blocks.push({ type: 'quote', text: buf.join(' ').trim() })
      continue
    }

    // 表格
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++ }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    // 列表（保留任务列表标记）
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line)
      const items = []
      while (i < lines.length && (isUl(lines[i]) || isOl(lines[i]))) {
        items.push(lines[i].replace(/^\s{0,3}([-*+]|\d+[.)])\s+/, ''))
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // 段落
    const buf = [line]
    i++
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i])
      && !isUl(lines[i]) && !isOl(lines[i]) && !isQuote(lines[i]) && !isFence(lines[i])
      && !isHr(lines[i]) && !isModule(lines[i]) && !/^\[\^([^\]]+)\]:/.test(lines[i])) {
      buf.push(lines[i]); i++
    }
    blocks.push({ type: 'paragraph', text: buf.join(' ') })
  }
  return { blocks, footnotes }
}

// 完整文档 AST：多端渲染器与元数据校对的统一输入
export function parseDocument(md) {
  const { meta, body } = parseFrontmatter(md)
  const { blocks, footnotes } = parseBlocks(body)
  return { meta, body, blocks, footnotes }
}

/* ---------------- 行内渲染 ---------------- */
// 逐段扫描：文本片段一律包 <span leaf="">（公众号编辑器识别「原样保留」的约定标记）
function inline(src, ctx, S) {
  const rules = [
    { re: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/, fn: (m) => renderImage(m[1], m[2], m[3], ctx, S) },
    { re: /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/, fn: (m) => renderLink(m[1], m[2], m[3], ctx, S) },
    { re: /^\[\^([^\]]+)\]/, fn: (m) => renderFootnoteRef(m[1], ctx, S) },
    { re: /^\[([^\]]+)\]\{([^}]+)\}/, fn: (m) => `<ruby style="${escAttr(cssText(S.leaf))}">${frag(m[1], ctx, S)}<rt style="font-size:${ctx.fs - 5}px;color:${ctx.t.sub}">${frag(m[2], ctx, S)}</rt></ruby>` },
    { re: /^`([^`]+)`/, fn: (m) => `<code${st(S.codeInline)}><span leaf="">${esc(m[1])}</span></code>` },
    { re: /^\*\*([^*]+)\*\*/, fn: (m) => `<strong${st(S.strong)}>${inline(m[1], ctx, S)}</strong>` },
    { re: /^__([^_]+)__/, fn: (m) => `<strong${st(S.strong)}>${inline(m[1], ctx, S)}</strong>` },
    { re: /^\*([^*\n]+)\*/, fn: (m) => `<em${st(S.em)}>${inline(m[1], ctx, S)}</em>` },
    { re: /^~~([^~]+)~~/, fn: (m) => `<span${st(S.del)}>${inline(m[1], ctx, S)}</span>` },
    { re: /^==([^=]+)==/, fn: (m) => `<span${st(S.mark)}>${inline(m[1], ctx, S)}</span>` },
  ]
  let out = ''
  let i = 0
  const srcText = String(src || '')
  while (i < srcText.length) {
    let hit = false
    for (const r of rules) {
      const m = r.re.exec(srcText.slice(i))
      if (m) { out += r.fn(m); i += m[0].length; hit = true; break }
    }
    if (hit) continue
    let j = i + 1
    while (j < srcText.length && !/[!\[`*~=_]/.test(srcText[j])) j++
    out += frag(srcText.slice(i, j), ctx, S)
    i = j
  }
  return out
}

function frag(text, ctx, S) {
  const s = esc(smartSpace(text, ctx.opts.smartSpace))
  if (!s) return ''
  return `<span leaf=""${st(S.leaf)}>${s}</span>`
}

// 图片：纯本地模型只放行 data: 与微信自有域名；其余必须先在界面里转成 DataURL
function resolveImage(src, ctx) {
  if (/^data:image\//i.test(src)) return { ok: true, src }
  if (/mmbiz\.qpic\.cn/i.test(src)) return { ok: true, src }
  const images = ctx.opts.images || {}
  const key = src.split('/').pop().split('?')[0]
  const hit = images[src] || images[key] || images['./' + key]
  if (hit) {
    const v = typeof hit === 'string' ? { src: hit } : hit
    return { ok: true, src: v.src || v.dataUrl, w: v.w, h: v.h }
  }
  return { ok: false }
}
function renderImage(alt, src, title, ctx, S) {
  const r = resolveImage(src, ctx)
  if (!r.ok) {
    ctx.issues.push({ level: 'error', code: 'img-not-localized', params: { src } })
    return `<section${st(S.placeholder)}><span leaf="">［图片待本地化］${esc(alt || src)}</span></section>`
  }
  ctx.stats.images++
  const wAttr = r.w ? ` data-w="${Number(r.w) || 0}"` : ''
  const caption = (title || alt)
    ? `<p${st(S.figcaption)}><span leaf="">${esc(title || alt)}</span></p>` : ''
  return `<section${st(S.figure)}><img src="${escAttr(r.src)}" alt="${escAttr(alt || '')}"${wAttr}${st(S.img)} />${caption}</section>`
}

// 链接：微信正文只放行 mp.weixin.qq.com；其余转文末参考资料（对齐 doocs/md 的 MP_WEIXIN_LINK_REGEX）
function renderLink(text, href, _title, ctx, S) {
  const inner = inline(text, ctx, S)
  if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)) {
    return `<a href="${escAttr(href)}"${st(S.a)}>${inner}</a>`
  }
  if (ctx.opts.footnoteLinks === false) return inner
  const n = ctx.footnotes.length + 1
  ctx.footnotes.push({ label: String(n), text: `${text} — ${href}`, href })
  ctx.stats.links++
  return `${inner}<span leaf=""${st(S.fnRef)}>[${n}]</span>`
}
function renderFootnoteRef(label, ctx, S) {
  const n = ctx.footnotes.findIndex((f) => f.label === label) + 1
  return `<span leaf=""${st(S.fnRef)}>[${n || label}]</span>`
}

/* ---------------- 代码高亮（零依赖轻量 tokenizer） ---------------- */
const KEYWORDS = new Set(('const let var function return if else for while do break continue class extends import export from default async await new try catch finally throw typeof instanceof in of this super switch case delete void yield static public private protected void int float double bool string null undefined true false None True False and or not def lambda elif with as pass raise global nonlocal echo cd sudo npm pnpm git curl SELECT FROM WHERE INSERT UPDATE DELETE JOIN ON GROUP ORDER BY LIMIT func type struct interface package range map chan go defer').split(' '))
function highlightCode(code, lang, S, t) {
  const color = { kw: '#c792ea', str: '#a5d6a7', num: '#f78c6c', cmt: '#7f8c98' }
  const hashComment = /^(py|python|bash|sh|shell|zsh|yaml|yml|toml|rb|ruby|r|conf|ini|dockerfile)$/i.test(lang)
  // 用正则字面量避免字符串拼接的转义地狱；# 注释按语言开关在匹配后判定
  const RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("[^"]*"|'[^']*'|`[^`]*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g
  const paint = (v, c) => `<span style="color:${c}">${esc(v)}</span>`
  const renderLine = (ln) => {
    let out = '', last = 0, m
    RE.lastIndex = 0
    while ((m = RE.exec(ln))) {
      out += esc(ln.slice(last, m.index))
      const hashHit = m[1] && m[1].startsWith('#')
      if (m[1] && (!hashHit || hashComment)) out += paint(m[1], color.cmt)
      else if (hashHit) out += esc(m[1])
      else if (m[2]) out += paint(m[2], color.str)
      else if (m[3]) out += paint(m[3], color.num)
      else if (m[4] && KEYWORDS.has(m[4])) out += paint(m[4], color.kw)
      else out += esc(m[0])
      last = m.index + m[0].length
    }
    out += esc(ln.slice(last))
    // 行首缩进用不换行空格，避免微信合并连续空格
    return out.replace(/^( +)/, (sp) => '\u00A0'.repeat(sp.length))
  }
  return code.split('\n').map(renderLine).join('<br>')
}

// Mac 风格三圆点：手写内联 SVG，无 defs / marker / id，显式宽高
const MAC_DOTS = '<svg width="52" height="12" viewBox="0 0 52 12" style="display:inline-block;vertical-align:top"><circle cx="6" cy="6" r="5" fill="#ff5f56"/><circle cx="26" cy="6" r="5" fill="#ffbd2e"/><circle cx="46" cy="6" r="5" fill="#27c93f"/></svg>'

/* ---------------- ③ 渲染层：块渲染（微信专用） ---------------- */
function renderBlock(b, ctx, S) {
  const leaf = (s, style) => `<span leaf=""${st(style || S.leaf)}>${esc(s)}</span>`
  switch (b.type) {
    case 'heading': {
      const k = b.level <= 1 ? 'h1' : b.level === 2 ? 'h2' : b.level === 3 ? 'h3' : 'h4'
      return `<section${st(S[k])}>${inline(b.text, ctx, S)}</section>`
    }
    case 'paragraph': return `<p${st(S.p)}>${inline(b.text, ctx, S)}</p>`
    case 'quote': return `<section${st(S.quote)}>${inline(b.text, ctx, S)}</section>`
    case 'alert': {
      const label = { note: 'NOTE', tip: 'TIP', important: 'IMPORTANT', warning: 'WARNING', caution: 'CAUTION' }[b.kind] || (b.kind || 'NOTE').toUpperCase()
      return `<section${st(S.alert)}><p${st({ ...S.alertLabel, margin: '0 0 6px' })}>${leaf(label, S.alertLabel)}</p><p${st({ ...S.p, margin: '0' })}>${inline(b.text, ctx, S)}</p></section>`
    }
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      const items = b.items.map((it) => {
        // 任务列表：checkbox 会被微信过滤，用 Unicode 替代
        const task = /^\[([ xX])\]\s*/.exec(it)
        const mark = task ? (task[1].toLowerCase() === 'x' ? '☑ ' : '☐ ') : ''
        const text = task ? it.slice(task[0].length) : it
        return `<li${st(S.li)}>${mark ? leaf(mark, S.li) : ''}${inline(text, ctx, S)}</li>`
      }).join('')
      return `<${tag}${st(S.list)}>${items}</${tag}>`
    }
    case 'code': {
      ctx.stats.code++
      const bar = ctx.opts.macStyle === false ? '' : `<section${st(S.codeBar)}>${MAC_DOTS}</section>`
      const body = `<pre${st(S.pre)}><code${st(S.codeText)}>${highlightCode(b.text, b.lang, S, ctx.t)}</code></pre>`
      const label = b.lang ? `<span leaf="" style="color:${ctx.t.sub};font-size:${ctx.fs - 5}px">${esc(b.lang)}</span>` : ''
      return `<section${st(S.codeWrap)}>${bar}${label}${body}</section>`
    }
    case 'table': {
      const head = `<tr>${b.head.map((h) => `<th${st(S.th)}>${inline(h, ctx, S)}</th>`).join('')}</tr>`
      const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td${st(S.td)}>${inline(c, ctx, S)}</td>`).join('')}</tr>`).join('')
      return `<table${st(S.table)}><thead>${head}</thead><tbody>${rows}</tbody></table>`
    }
    case 'hr': return `<section${st(S.hr)}><span leaf="">&nbsp;</span></section>`
    case 'image': return renderImage(b.alt, b.src, b.title, ctx, S)
    case 'module': return renderModule(b, ctx, S)
    default: return ''
  }
}

// 结构化排版模块（刊头 / 卡片 / 目录 / 数据 / CTA / 时间轴 / 对比 / 步骤 / 带标题代码块）
// —— 带最小 schema，字段写错整块降级并告警
const MODULE_NAMES = new Set([
  'hero', 'masthead', 'cards', 'metrics', 'toc', 'cta', 'verdict', 'quote-card', 'notice', 'checklist',
  'timeline', 'compare', 'steps', 'code-title',
])
const SPECIAL_MODULES = new Set(['timeline', 'compare', 'steps', 'code-title'])
function parseModuleBody(body) {
  const fields = {}, rows = []
  for (const raw of body) {
    const line = raw.trim()
    if (!line || /^#/.test(line)) continue
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) { fields[kv[1].toLowerCase()] = kv[2]; continue }
    if (line.includes('|')) { rows.push(line.split('|').map((c) => c.trim())); continue }
    rows.push([line])
  }
  return { fields, rows }
}
// 扩容模块：时间轴 / 对比表 / 步骤 / 带标题代码块（均复用白名单内联样式，不引入新 CSS 属性）
function renderSpecialModule(b, fields, rows, ctx, S) {
  const title = fields.title || b.title || ''
  const head = title ? `<p${st({ ...S.cardTitle, margin: '0 0 10px' })}>${inline(title, ctx, S)}</p>` : ''
  const body = []
  const nums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
  if (b.name === 'timeline' || b.name === 'steps') {
    rows.forEach((r, i) => {
      const badge = b.name === 'timeline' ? (nums[i] || '•') : `STEP ${r[0] || i + 1}`
      const main = b.name === 'timeline' ? `${r[0] || ''} ${r[1] || ''}`.trim() : (r.slice(1).join(' · ') || r[0] || '')
      const desc = b.name === 'timeline' ? r.slice(2).join(' · ') : ''
      body.push(`<section${st(S.card)}>`)
      body.push(`<p${st({ ...S.cardTitle, margin: '0 0 4px' })}><span leaf=""${st(S.cardTitle)}>${esc(badge)}</span> ${inline(main, ctx, S)}</p>`)
      if (desc) body.push(`<p${st({ ...S.cardBody, margin: '0' })}>${inline(desc, ctx, S)}</p>`)
      body.push('</section>')
    })
  } else if (b.name === 'compare') {
    // 支持任意列：首行作表头，其余为数据行（不丢弃第 3 列及以后）
    const lines = rows.map((r, ri) => {
      const cells = r.map((c) => ri === 0
        ? `<th${st(S.th)}>${inline(c, ctx, S)}</th>`
        : `<td${st(S.td)}>${inline(c, ctx, S)}</td>`).join('')
      return `<tr>${cells}</tr>`
    })
    body.push(`<table${st(S.table)}><tbody>${lines.join('')}</tbody></table>`)
  } else if (b.name === 'code-title') {
    const lang = fields.lang || fields.language || ''
    const code = rows.map((r) => r.join(' ')).join('\n')
    const label = lang ? `<p${st({ ...S.cardBody, margin: '0 0 8px' })}><span leaf="">${esc(lang)}</span></p>` : ''
    body.push(`<section${st(S.codeWrap)}>${label}<pre${st(S.pre)}><code${st(S.codeText)}>${esc(code)}</code></pre></section>`)
  }
  if (!body.length) {
    ctx.issues.push({ level: 'warning', code: 'module-empty', params: { name: b.name } })
    return ''
  }
  return head + body.join('')
}
function renderModule(b, ctx, S) {
  if (!MODULE_NAMES.has(b.name)) {
    ctx.issues.push({ level: 'warning', code: 'unknown-module', params: { name: b.name } })
    return `<p${st(S.p)}>${frag(b.body.join(' '), ctx, S)}</p>`
  }
  const { fields, rows } = parseModuleBody(b.body)
  if (SPECIAL_MODULES.has(b.name)) {
    ctx.stats.modules++
    return renderSpecialModule(b, fields, rows, ctx, S)
  }
  const isOpening = b.name === 'hero' || b.name === 'masthead'
  const parts = []
  const eyebrow = fields.eyebrow || fields.kicker || ''
  const title = fields.title || b.title || ''
  const subtitle = fields.subtitle || fields.body || fields.desc || ''
  const meta = fields.meta || ''
  const brand = fields.brand || ''
  const tags = (fields.tags || '').split('|').map((s) => s.trim()).filter(Boolean)

  if (isOpening) {
    parts.push(`<section${st(S.hero)}>`)
    if (eyebrow) parts.push(`<p${st({ ...S.eyebrow, margin: '0' })}>${frag(eyebrow, ctx, S)}</p>`)
    if (title) parts.push(`<p${st(S.heroTitle)}>${inline(title, ctx, S)}</p>`)
    if (subtitle) parts.push(`<p${st(S.heroSub)}>${inline(subtitle, ctx, S)}</p>`)
    if (meta || brand) parts.push(`<p${st(S.heroMeta)}>${frag([meta, brand].filter(Boolean).join(' · '), ctx, S)}</p>`)
    if (tags.length) parts.push(`<p style="margin:12px 0 0">${tags.map((x) => `<span leaf=""${st(S.tag)}>${esc(x)}</span>`).join('')}</p>`)
    parts.push('</section>')
    ctx.stats.modules++
    return parts.join('')
  }

  if (b.title) parts.push(`<p${st(S.cardTitle)}>${inline(b.title, ctx, S)}</p>`)
  for (const r of rows) {
    if (!r.length || !r[0]) continue
    const accent = /accent/i.test(r[r.length - 1] || '')
    const cells = r.filter((c) => !/^(accent|default)$/i.test(c))
    const style = accent ? S.cardAccent : S.card
    parts.push(`<section${st(style)}>`)
    parts.push(`<p${st({ ...S.cardTitle, margin: '0 0 4px' })}>${inline(cells[0] || '', ctx, S)}</p>`)
    if (cells.length > 1) parts.push(`<p${st({ ...S.cardBody, margin: '0' })}>${inline(cells.slice(1).join(' · '), ctx, S)}</p>`)
    parts.push('</section>')
  }
  if (!rows.length && subtitle) parts.push(`<section${st(S.card)}><p${st({ ...S.cardBody, margin: '0' })}>${inline(subtitle, ctx, S)}</p></section>`)
  if (!parts.length) ctx.issues.push({ level: 'warning', code: 'module-empty', params: { name: b.name } })
  ctx.stats.modules++
  return parts.join('')
}

function renderFootnotes(ctx, S) {
  if (!ctx.footnotes.length) return ''
  const items = ctx.footnotes.map((f, i) =>
    `<p${st(S.footItem)}><span leaf="">[${i + 1}] ${esc(f.text)}</span></p>`).join('')
  return `<section${st({ margin: '28px 0 0' })}><p${st(S.footTitle)}><span leaf="">参考资料</span></p>${items}</section>`
}

/* ---------------- ③ 渲染层：微信编译入口（AST → HTML） ---------------- */
/**
 * 把文档 AST 编译为公众号可用 HTML（渲染层，可被 renderDocument 复用）。
 * @param {object} ast parseDocument() 的结果 { meta, body, blocks, footnotes }
 * @param {object} opts 同 renderWechatArticle
 * @returns {{html, previewHtml, plain, report, stats, meta, title}}
 */
export function compileWechatAst(ast, opts = {}) {
  const meta = ast.meta || {}
  const body = ast.body || ''
  const options = {
    // 显式 opts 优先：视图里的主题选择器必须能覆盖 frontmatter 的文档默认主题，
    // 否则带 `theme:` 的文档在 UI 上切换主题会「点了没反应」。未传 opts.theme 时才回退 frontmatter。
    theme: opts.theme || meta.theme || DEFAULT_THEME,
    fontSize: Number(opts.fontSize) || 16,
    lineHeight: Number(opts.lineHeight) || 1.75,
    radius: opts.radius !== false,
    smartSpace: opts.smartSpace !== false,
    footnoteLinks: opts.footnoteLinks !== false,
    macStyle: opts.macStyle !== false,
    images: opts.images || {},
  }
  // styleMapping 可外部注入（部分覆盖），实现「样式映射层」与渲染层解耦
  const base = buildStyles(options.theme, options)
  const S = opts.styleMapping ? { ...base, ...opts.styleMapping } : base
  const t = getTheme(options.theme)
  const blocks = ast.blocks || []
  const ctx = {
    opts: options, t, S, fs: options.fontSize,
    footnotes: (ast.footnotes || []).map((f) => ({ label: f.label, text: f.text })),
    issues: [], stats: { blocks: blocks.length, images: 0, links: 0, code: 0, modules: 0 },
  }
  const content = blocks.map((b) => renderBlock(b, ctx, S)).join('\n')
  const tail = renderFootnotes(ctx, S)
  const html = `<section${st(S.root)}>\n${content}\n${tail}\n</section>`
  const title = meta.title || firstHeading(blocks) || 'LocalForge 公众号排版'
  const previewHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}#paper{max-width:677px;margin:24px auto;padding:28px 24px;background:#fff;box-shadow:0 4px 24px rgba(20,40,90,.08)}</style></head><body><div id="paper">${html}</div></body></html>`
  const plain = toPlainText(body)

  const report = validateWechatHtml(html)
  // 汇总渲染期 code 化问题（图片未本地化 / 未知模块等）与静态校验结果
  const allIssues = [...ctx.issues, ...report.issues]
  const derived = deriveIssues(allIssues, 'zh-CN')
  report.issues = allIssues
  report.errors = derived.errors
  report.warnings = derived.warnings
  report.ok = derived.errors.length === 0
  return { html, previewHtml, plain, report, stats: ctx.stats, meta, title }
}

/** 主入口：Markdown → 公众号 HTML（保持既有返回结构不变） */
export function renderWechatArticle(md, opts = {}) {
  return compileWechatAst(parseDocument(md), opts)
}

function firstHeading(blocks) {
  const h = blocks.find((b) => b.type === 'heading')
  return h ? h.text : ''
}
function toPlainText(md) {
  return String(md || '')
    .replace(/^---[\s\S]*?\n---\s*\n/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '[$1]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^:::[^\n]*$/gm, '').replace(/[#>*`~_|]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim()
}

/* ---------------- 合规校验（官方规范 · 静态可检测子集，诊断 code 化） ---------------- */
/**
 * 不做真实浏览器布局测量（那是官方 verify-article-structure-spec + puppeteer 的职责），
 * 但覆盖所有可静态判定的红线：标签/属性白名单、危险 CSS、span[leaf] 嵌套、
 * 嵌套层级、外链图片、固定宽度等。产出 code 化 issues + 兼容的 errors/warnings。
 */
export function validateWechatHtml(html, opts = {}) {
  const locale = opts.locale || 'zh-CN'
  const issues = []
  const seen = new Set()
  const push = (code, params, level) => pushIssue(issues, seen, code, params, level)
  const src = String(html || '')

  for (const tag of DENIED_TAGS) {
    if (new RegExp(`<\\s*${tag}\\b`, 'i').test(src)) push('denied-tag', { tag }, 'error')
  }
  if (/<[^>]+\s(class|id)\s*=/i.test(src)) push('residual-class-id', {}, 'error')
  if (/\son[a-z]+\s*=/i.test(src)) push('residual-on-handler', {}, 'error')

  // 逐条 style 检查
  for (const m of src.matchAll(/style="([^"]*)"/gi)) {
    const decl = m[1]
    for (const bad of DENIED_VALUES) if (bad.test(decl)) push('style-denied-value', { sample: decl.slice(0, 60) }, 'error')
    for (const prop of DENIED_CSS) {
      if (new RegExp(`(?:^|;)\\s*${prop}\\s*:`, 'i').test(decl)) push('style-denied-prop', { prop }, 'error')
    }
    for (const seg of decl.split(';')) {
      const k = seg.split(':')[0].trim().replace(/!important/i, '').trim()
      if (k && !ALLOWED_CSS.has(k)) push('style-non-whitelist', { prop: k }, 'warning')
    }
  }

  // span[leaf] 只能包行内元素 / 文本
  for (const m of src.matchAll(/<span\b[^>]*\bleaf\b[^>]*>([\s\S]*?)<\/span>/gi)) {
    if (/<(section|div|p|table|ul|ol|h[1-6])\b/i.test(m[1])) push('leaf-block-child', {}, 'error')
  }
  // 外链图片
  for (const m of src.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    const u = m[1]
    if (!/^data:image\//i.test(u) && !/mmbiz\.qpic\.cn/i.test(u)) push('img-remote-src', { sample: u.slice(0, 60) }, 'error')
    if (!/\bdata-w="\d+"/.test(m[0])) push('img-missing-data-w', {}, 'warning')
    if (!/max-width\s*:\s*100%/.test(m[0])) push('img-missing-max-width', {}, 'warning')
  }
  // 外链（正文只允许 mp.weixin.qq.com）
  for (const m of src.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
    if (!/^https?:\/\/mp\.weixin\.qq\.com\//i.test(m[1])) push('link-non-wechat', { sample: m[1].slice(0, 60) }, 'error')
  }
  // pre 需要横向滚动
  for (const m of src.matchAll(/<pre\b[^>]*>/gi)) {
    if (!/overflow-x\s*:\s*(auto|scroll)/i.test(m[0])) push('pre-no-overflow', {}, 'warning')
  }
  // 固定 px 宽度 / 危险尺寸
  if (/(?:^|[;\s])width\s*:\s*\d{3,}px/i.test(src)) push('fixed-px-width', {}, 'warning')
  if (/height\s*:\s*0(?:px)?\s*[;"]/i.test(src)) push('height-zero', {}, 'warning')
  // 嵌套深度（同标签、仅单子节点的冗余链路）
  const stack = []
  let maxDepth = 0
  for (const m of src.matchAll(/<(\/?)(section|div|p|span)\b[^>]*>/gi)) {
    if (m[1]) stack.pop()
    else { stack.push(m[2].toLowerCase()); maxDepth = Math.max(maxDepth, stack.length) }
  }
  if (maxDepth > 10) push('dom-too-deep', { depth: maxDepth }, 'warning')

  const derived = deriveIssues(issues, locale)
  return {
    ok: !issues.some((i) => i.level === 'error'),
    errors: derived.errors,
    warnings: derived.warnings,
    issues,
    stats: {
      chars: src.length,
      inlineStyles: (src.match(/style="/g) || []).length,
      leafNodes: (src.match(/<span\b[^>]*\bleaf\b/gi) || []).length,
      maxDepth,
    },
  }
}

/* ---------------- 示例文档 ---------------- */
export const WECHAT_SAMPLE = `---
title: 用 LocalForge 排版一篇公众号文章
author: LocalForge
theme: ink
---

:::hero
eyebrow: LOCAL TOOLS
title: 纯本地，也能排出稳定的公众号版式
subtitle: 不上传、不联网、不调接口；编译期就把样式焊死在 HTML 里
meta: 2026.11 · 约 3 分钟
brand: LocalForge
tags: 本地优先 | 零依赖 | 公众号
:::

## 为什么样式会丢

公众号后台会按白名单清洗粘贴内容：**class、style 标签、外链 CSS、position、外链图片**都会被处理掉。
所以正确做法不是「写得更漂亮」，而是让产物**天生抗清洗**。

> 内容重于排版，排版重于设计。整齐、舒服、简单是硬道理。

### 三条硬规则

- 所有样式写进标签的 \`style=""\`，不留 class / id
- 文字节点用 \`<span leaf>\` 包住，容器优先用 \`<section>\`
- 图片必须是本地 DataURL 或微信自有域名，外链一律转文末参考资料

:::cards[本文结构]
PART 01 | 问题 | 公众号编辑器到底过滤了什么
PART 02 | 方案 | 编译期内联 + 结构化模块
PART 03 | 校验 | 内置静态规范自检
:::

\`\`\`js
// 一次编译，两处输出
const article = renderWechatArticle(markdown, { theme: 'ink' })
await copyRichText(article.html, article.plain) // 只写剪贴板，不联网
\`\`\`

| 能力 | 纯本地实现 |
| --- | --- |
| 主题 | JS 变量 → 内联样式 |
| 校验 | 静态规则自检 |
| 发布 | 用户手动粘贴 |

> [!NOTE]
> 公式与 Mermaid 图表请先用本地工具截图为 PNG，再拖进左侧图片区插入——本项目不伪造渲染能力。

外链会自动收进参考资料，例如 [微信开放文档](https://developers.weixin.qq.com/) 与 [doocs/md](https://github.com/doocs/md)。

:::cta
title: 现在就试试
body: 改左边的 Markdown，点「复制到公众号」，去后台粘贴预览。
:::
`
