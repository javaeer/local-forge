// 公众号排版内核 · 扩展层（wechat-extra.js）
//
// 承接 wechat.js 的三层解耦，落地下列能力，全部为「纯函数 / 零依赖 / 不联网」：
//   ① 多端输出   RENDER_TARGETS + renderDocument(ast,{target,styleMapping,options})
//                 wechat 委托 compileWechatAst（产物仍 100% 抗清洗）；
//                 zhihu / juejin / feishu / email 走通用语义渲染器（可用 class、保留外链）。
//   ② 文章模板   WECHAT_TEMPLATES（4 套 Markdown 骨架，含 5 语言名称）
//   ③ 自定义主题 THEME_SCHEMA_VERSION + exportTheme()/importTheme()（带净化与 code 化诊断）
//   ④ 元数据校对 checkMetadata()：标题/摘要长度、字数、阅读时长、图片/外链数
//   ⑤ 离线打包   buildStoreZip() / zipEntry()：纯 JS ZIP（store，无压缩、零依赖、Node 可测）
//
// 与 wechat.js 的边界：本文件不重复实现微信专用渲染，只做「调度 + 通用渲染 + 数据能力」。
// 所有诊断仍复用 wechat.js 的 ISSUE_MESSAGES / describeIssue，保证 5 语言单一真相源。

import {
  parseDocument, compileWechatAst, describeIssue, deriveIssues,
  ISSUE_MESSAGES, sanitizeTheme, escapeHtml, cssText,
} from './wechat.js'

export { describeIssue, deriveIssues, ISSUE_MESSAGES }

const esc = escapeHtml
const interpol = (str, params) => {
  if (!params || typeof str !== 'string') return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

/* ============================================================
 * ① 多端输出
 * ========================================================== */

// label 内置 5 语言（与 workflow.js 的 WF_LABELS 同一约定，避免 i18n 循环依赖）。
// inline=true 表示产物把基础样式内联（邮件客户端必须）；其余平台输出语义 HTML + class。
export const RENDER_TARGETS = [
  {
    id: 'wechat', inline: true, keepLinks: false,
    label: { 'zh-CN': '微信公众号', en: 'WeChat', 'ja-JP': '微信公衆号', 'ko-KR': '위챗 공중호', 'es-ES': 'WeChat' },
    hint: { 'zh-CN': '抗清洗的纯内联 HTML，可直接粘贴', en: 'Wash-proof inline HTML, paste-ready', 'ja-JP': '洗浄に強いインライン HTML', 'ko-KR': '세정에 강한 인라인 HTML', 'es-ES': 'HTML en línea resistente al limpiado' },
  },
  {
    id: 'zhihu', inline: false, keepLinks: true,
    label: { 'zh-CN': '知乎', en: 'Zhihu', 'ja-JP': '知乎', 'ko-KR': '즈후', 'es-ES': 'Zhihu' },
    hint: { 'zh-CN': '语义 HTML，代码块带 language-* class', en: 'Semantic HTML, code with language-* class', 'ja-JP': 'セマンティック HTML', 'ko-KR': '시맨틱 HTML', 'es-ES': 'HTML semántico' },
  },
  {
    id: 'juejin', inline: false, keepLinks: true,
    label: { 'zh-CN': '掘金', en: 'Juejin', 'ja-JP': '掘金', 'ko-KR': '줘진', 'es-ES': 'Juejin' },
    hint: { 'zh-CN': '语义 HTML，标题与代码块保留结构', en: 'Semantic HTML preserving headings & code', 'ja-JP': '見出しとコードを保持', 'ko-KR': '제목·코드 구조 유지', 'es-ES': 'HTML semántico con títulos y código' },
  },
  {
    id: 'feishu', inline: false, keepLinks: true,
    label: { 'zh-CN': '飞书文档', en: 'Feishu Docs', 'ja-JP': '飛書ドキュメント', 'ko-KR': '페이수 문서', 'es-ES': 'Feishu Docs' },
    hint: { 'zh-CN': '语义 HTML，适合粘贴进文档', en: 'Semantic HTML for docs', 'ja-JP': 'ドキュメント貼り付け向け', 'ko-KR': '문서 붙여넣기용', 'es-ES': 'HTML semántico para documentos' },
  },
  {
    id: 'email', inline: true, keepLinks: true,
    label: { 'zh-CN': '邮件 / EDM', en: 'Email / EDM', 'ja-JP': 'メール / EDM', 'ko-KR': '이메일 / EDM', 'es-ES': 'Email / EDM' },
    hint: { 'zh-CN': '保守内联样式，不含 flex/grid/position', en: 'Conservative inline styles, no flex/grid/position', 'ja-JP': '保守的なインラインスタイル', 'ko-KR': '보수적 인라인 스타일', 'es-ES': 'Estilos en línea conservadores' },
  },
]
export function getTarget(id) {
  return RENDER_TARGETS.find((t) => t.id === id) || RENDER_TARGETS[0]
}
export function targetLabel(id, locale) {
  const t = getTarget(id)
  return (t.label && (t.label[locale] || t.label['zh-CN'])) || t.id
}
export function targetHint(id, locale) {
  const t = getTarget(id)
  return (t.hint && (t.hint[locale] || t.hint['zh-CN'])) || ''
}

// 通用（非微信）渲染用的保守内联样式表；属性全部落在 ALLOWED_CSS 白名单内，
// 经 cssText 过滤后再写入 style=""，确保 email 产物同样不含危险属性。
const GENERIC_STYLES = {
  root: { 'max-width': '677px', margin: '0 auto', color: '#2f3542', 'font-size': '16px', 'line-height': '1.75' },
  h1: { color: '#1d4ed8', 'font-size': '26px', 'font-weight': '700', margin: '28px 0 14px' },
  h2: { color: '#2f3542', 'font-size': '21px', 'font-weight': '700', margin: '26px 0 12px', 'border-left': '4px solid #1d4ed8', padding: '0 0 0 10px' },
  h3: { color: '#1d4ed8', 'font-size': '18px', 'font-weight': '600', margin: '20px 0 10px' },
  p: { margin: '0 0 16px', 'line-height': '1.75' },
  quote: { 'background-color': '#f5f7fb', 'border-left': '4px solid #1d4ed8', padding: '10px 14px', margin: '0 0 16px' },
  list: { margin: '0 0 16px', padding: '0 0 0 22px', 'line-height': '1.75' },
  pre: { 'background-color': '#0f172a', color: '#e2e8f0', padding: '14px', 'border-radius': '8px', 'overflow-x': 'auto', 'white-space': 'pre-wrap' },
  code: { color: '#c2410c', 'background-color': '#f5f7fb', padding: '1px 4px', 'border-radius': '4px' },
  table: { 'border-collapse': 'collapse', width: '100%', margin: '0 0 16px' },
  th: { border: '1px solid #e3e8f2', padding: '8px 10px', 'background-color': '#f5f7fb', 'text-align': 'left' },
  td: { border: '1px solid #e3e8f2', padding: '8px 10px' },
  img: { 'max-width': '100%', height: 'auto' },
  hr: { border: '0', 'border-top': '1px solid #e3e8f2', margin: '26px 0' },
  card: { 'background-color': '#f5f7fb', padding: '10px 14px', 'border-radius': '8px', margin: '0 0 10px' },
}
const styleAttr = (style) => {
  const s = cssText(style)
  return s ? ` style="${s}"` : ''
}

function smartSpace(s, on) {
  if (!on) return s
  return String(s)
    .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2')
}

// 通用行内渲染：不包 span[leaf]，链接/图片保留原语义（这些平台允许外链）
function gInline(src, cfg) {
  const rules = [
    { re: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/, fn: (m) => gImage(m[1], m[2], m[3], cfg) },
    { re: /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/, fn: (m) => `<a href="${esc(m[2])}"${m[3] ? ` title="${esc(m[3])}"` : ''}>${gInline(m[1], cfg)}</a>` },
    { re: /^\[\^([^\]]+)\]/, fn: (m) => `<sup>[${esc(m[1])}]</sup>` },
    { re: /^`([^`]+)`/, fn: (m) => `<code>${esc(m[1])}</code>` },
    { re: /^\*\*([^*]+)\*\*/, fn: (m) => `<strong>${gInline(m[1], cfg)}</strong>` },
    { re: /^__([^_]+)__/, fn: (m) => `<strong>${gInline(m[1], cfg)}</strong>` },
    { re: /^\*([^*\n]+)\*/, fn: (m) => `<em>${gInline(m[1], cfg)}</em>` },
    { re: /^~~([^~]+)~~/, fn: (m) => `<del>${gInline(m[1], cfg)}</del>` },
    { re: /^==([^=]+)==/, fn: (m) => `<mark>${gInline(m[1], cfg)}</mark>` },
  ]
  let out = '', i = 0
  const text = String(src || '')
  while (i < text.length) {
    let hit = false
    for (const r of rules) {
      const m = r.re.exec(text.slice(i))
      if (m) { out += r.fn(m); i += m[0].length; hit = true; break }
    }
    if (hit) continue
    let j = i + 1
    while (j < text.length && !/[!\[`*~=_]/.test(text[j])) j++
    out += esc(smartSpace(text.slice(i, j), cfg.smartSpace))
    i = j
  }
  return out
}

function gImage(alt, src, title, cfg) {
  cfg.stats.images++
  const images = cfg.images || {}
  const key = src.split('/').pop().split('?')[0]
  const hit = images[src] || images[key] || images['./' + key]
  const real = hit ? (typeof hit === 'string' ? hit : (hit.src || hit.dataUrl)) : src
  const cap = (title || alt) ? `<figcaption>${esc(title || alt)}</figcaption>` : ''
  return `<figure${cfg.inline ? styleAttr({ margin: '0 0 16px', 'text-align': 'center' }) : ''}><img src="${esc(real)}" alt="${esc(alt || '')}"${cfg.inline ? styleAttr(GENERIC_STYLES.img) : ''} />${cap}</figure>`
}

function gModuleBody(body) {
  const fields = {}, rows = []
  for (const raw of body || []) {
    const line = String(raw).trim()
    if (!line || /^#/.test(line)) continue
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) { fields[kv[1].toLowerCase()] = kv[2]; continue }
    rows.push(line.includes('|') ? line.split('|').map((c) => c.trim()) : [line])
  }
  return { fields, rows }
}
function gModule(b, cfg) {
  cfg.stats.modules++
  const { fields, rows } = gModuleBody(b.body)
  const title = fields.title || b.title || ''
  const head = title ? `<h2${cfg.inline ? styleAttr(GENERIC_STYLES.h2) : ''}>${gInline(title, cfg)}</h2>` : ''
  const st = (k) => cfg.inline ? styleAttr(GENERIC_STYLES[k]) : ''
  const cls = (c) => (!cfg.inline && c) ? ` class="${c}"` : ''
  if (b.name === 'hero' || b.name === 'masthead') {
    const parts = [`<header${cls('article-hero')}>`]
    if (fields.eyebrow) parts.push(`<p${st('p')}>${esc(fields.eyebrow)}</p>`)
    if (title) parts.push(`<h1${st('h1')}>${gInline(title, cfg)}</h1>`)
    if (fields.subtitle || fields.body || fields.desc) parts.push(`<p${st('p')}>${gInline(fields.subtitle || fields.body || fields.desc, cfg)}</p>`)
    if (fields.meta || fields.brand) parts.push(`<p${st('p')}>${esc([fields.meta, fields.brand].filter(Boolean).join(' · '))}</p>`)
    parts.push('</header>')
    return parts.join('')
  }
  if (b.name === 'compare') {
    // 支持任意列：首行作表头，其余为数据行
    const lines = rows.map((r, ri) => {
      const cells = r.map((c) => ri === 0
        ? `<th${st('th')}>${gInline(c, cfg)}</th>`
        : `<td${st('td')}>${gInline(c, cfg)}</td>`).join('')
      return `<tr>${cells}</tr>`
    }).join('')
    return head + `<table${st('table')}><tbody>${lines}</tbody></table>`
  }
  if (b.name === 'code-title') {
    const lang = fields.lang || fields.language || ''
    const code = rows.map((r) => r.join(' ')).join('\n')
    return head + `<pre${st('pre')}><code${cls(lang ? 'language-' + lang : '')}>${esc(code)}</code></pre>`
  }
  const ordered = /^(timeline|steps|toc|checklist)$/.test(b.name)
  const tag = ordered ? 'ol' : 'ul'
  const items = rows.map((r) => {
    const cells = r.filter((c) => !/^(accent|default)$/i.test(c))
    const main = cells[0] || ''
    const rest = cells.slice(1).join(' · ')
    return `<li${st('p')}>${rest ? `<strong>${gInline(main, cfg)}</strong> — ${gInline(rest, cfg)}` : gInline(main, cfg)}</li>`
  }).join('')
  if (!items && (fields.subtitle || fields.body || fields.desc)) {
    return head + `<div${cls('card')}${st('card')}>${gInline(fields.subtitle || fields.body || fields.desc, cfg)}</div>`
  }
  return head + `<${tag}${st('list')}${cls('module-' + b.name)}>${items}</${tag}>`
}

function gBlock(b, cfg) {
  const st = (k) => cfg.inline ? styleAttr(GENERIC_STYLES[k]) : ''
  const cls = (c) => (!cfg.inline && c) ? ` class="${c}"` : ''
  switch (b.type) {
    case 'heading': {
      const lv = Math.min(6, b.level || 1)
      const tag = 'h' + lv
      return `<${tag}${st(lv <= 3 ? tag : 'h3')}>${gInline(b.text, cfg)}</${tag}>`
    }
    case 'paragraph': return `<p${st('p')}>${gInline(b.text, cfg)}</p>`
    case 'quote': return `<blockquote${st('quote')}>${gInline(b.text, cfg)}</blockquote>`
    case 'alert': {
      const label = ({ note: 'NOTE', tip: 'TIP', important: 'IMPORTANT', warning: 'WARNING', caution: 'CAUTION' })[b.kind] || 'NOTE'
      return `<blockquote${cls('alert alert-' + (b.kind || 'note'))}${st('quote')}><p${st('p')}><strong>${label}</strong> — ${gInline(b.text, cfg)}</p></blockquote>`
    }
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      const items = b.items.map((it) => {
        const task = /^\[([ xX])\]\s*/.exec(it)
        const mark = task ? (task[1].toLowerCase() === 'x' ? '☑ ' : '☐ ') : ''
        const text = task ? it.slice(task[0].length) : it
        return `<li${st('p')}>${mark ? esc(mark) : ''}${gInline(text, cfg)}</li>`
      }).join('')
      return `<${tag}${st('list')}>${items}</${tag}>`
    }
    case 'code': {
      cfg.stats.code++
      const lang = (b.lang || '').replace(/[^\w+-]/g, '')
      return `<pre${st('pre')}><code${cls(lang ? 'language-' + lang : '')}>${esc(b.text)}</code></pre>`
    }
    case 'table': {
      const head = `<tr>${b.head.map((h) => `<th${st('th')}>${gInline(h, cfg)}</th>`).join('')}</tr>`
      const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td${st('td')}>${gInline(c, cfg)}</td>`).join('')}</tr>`).join('')
      return `<table${st('table')}><thead>${head}</thead><tbody>${rows}</tbody></table>`
    }
    case 'hr': return `<hr${st('hr')} />`
    case 'image': return gImage(b.alt, b.src, b.title, cfg)
    case 'module': return gModule(b, cfg)
    default: return ''
  }
}

function gFootnotes(footnotes, cfg) {
  if (!footnotes || !footnotes.length) return ''
  const items = footnotes.map((f, i) => `<li id="fn-${i + 1}">${gInline(f.text, cfg)}</li>`).join('')
  return `<section${cfg.inline ? '' : ' class="footnotes"'}><h2${cfg.inline ? styleAttr(GENERIC_STYLES.h2) : ''}>参考资料 / References</h2><ol${cfg.inline ? styleAttr(GENERIC_STYLES.list) : ''}>${items}</ol></section>`
}

function toPlain(body) {
  return String(body || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '[$1]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^:::[^\n]*$/gm, '').replace(/[#>*`~_|]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim()
}

function renderGeneric(ast, t, options = {}, styleMapping) {
  const cfg = {
    inline: !!t.inline,
    styles: { ...(t.inline ? GENERIC_STYLES : {}), ...(styleMapping || {}) },
    images: options.images || {},
    smartSpace: options.smartSpace !== false,
    stats: { blocks: (ast.blocks || []).length, images: 0, links: 0, code: 0, modules: 0 },
  }
  const content = (ast.blocks || []).map((b) => gBlock(b, cfg)).join('\n')
  const tail = gFootnotes(ast.footnotes, cfg)
  const inner = `${content}\n${tail}`
  const html = cfg.inline
    ? `<div${styleAttr(cfg.styles.root)}>\n${inner}\n</div>`
    : inner
  const meta = ast.meta || {}
  const title = meta.title || (ast.blocks || []).find((b) => b.type === 'heading')?.text || 'LocalForge Article'
  const previewHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}#paper{max-width:760px;margin:24px auto;padding:32px 28px;background:#fff;box-shadow:0 4px 24px rgba(20,40,90,.08)}pre code{font-family:ui-monospace,Menlo,Consolas,monospace}img{max-width:100%}table{border-collapse:collapse}th,td{border:1px solid #e3e8f2;padding:8px 10px}</style></head><body><div id="paper">${html}</div></body></html>`
  const report = {
    ok: true, issues: [], errors: [], warnings: [],
    stats: { chars: html.length, inlineStyles: (html.match(/style="/g) || []).length, leafNodes: 0, maxDepth: 0, blocks: cfg.stats.blocks },
    target: t.id,
  }
  return { html, previewHtml, plain: toPlain(ast.body), report, stats: cfg.stats, meta, title, target: t.id, label: t.label }
}

/**
 * 统一的多端渲染入口（三层解耦的「渲染层」）。
 * @param {object} ast  parseDocument() 的结果（或等价 { meta, body, blocks, footnotes }）
 * @param {object} cfg  { target='wechat', styleMapping, options }
 *   target: 'wechat' | 'zhihu' | 'juejin' | 'feishu' | 'email'
 *   styleMapping: 覆盖样式映射（wechat 覆盖块样式；通用目标覆盖 GENERIC_STYLES）
 *   options: 同 renderWechatArticle 的 opts（theme / fontSize / images / ...）
 * @returns {{html, previewHtml, plain, report, stats, meta, title, target, label}}
 */
export function renderDocument(ast, { target = 'wechat', styleMapping, options = {} } = {}) {
  const t = getTarget(target)
  if (t.id === 'wechat') {
    const r = compileWechatAst(ast, { ...options, styleMapping })
    return { ...r, target: 'wechat', label: t.label }
  }
  return renderGeneric(ast, t, options, styleMapping)
}

/** 便捷入口：直接对 Markdown 字符串做多端渲染（内部完成 parseDocument） */
export function renderMarkdownTo(md, cfg = {}) {
  return renderDocument(parseDocument(md), cfg)
}

/* ============================================================
 * ② 文章模板
 * ========================================================== */
// 每套模板是一段带 Frontmatter 的 Markdown 骨架，name 内置 5 语言。
export const WECHAT_TEMPLATES = [
  {
    id: 'blank',
    name: { 'zh-CN': '空白', en: 'Blank', 'ja-JP': '空白', 'ko-KR': '빈 문서', 'es-ES': 'En blanco' },
    md: [
      '---', 'title: 在这里写标题', 'description: 一句话摘要（建议 120 字内）', 'author: LocalForge', 'theme: ink', '---', '',
      '## 小标题', '', '从这里开始写作。支持 **粗体**、*斜体*、`行内代码`、列表、引用、表格与代码块。', '',
    ].join('\n'),
  },
  {
    id: 'tutorial',
    name: { 'zh-CN': '技术教程', en: 'Tutorial', 'ja-JP': '技術チュートリアル', 'ko-KR': '기술 튜토리얼', 'es-ES': 'Tutorial' },
    md: [
      '---', 'title: 从零上手 XXX', 'description: 一篇带步骤、代码块与参考资料的技术教程', 'author: LocalForge', 'theme: ink', '---', '',
      ':::hero', 'eyebrow: TUTORIAL', 'title: 从零上手 XXX', 'subtitle: 一步步把概念讲清楚，代码可直接复制', 'meta: 约 8 分钟 · 入门', 'tags: 教程 | 实战 | 零基础', ':::', '',
      '## 背景', '', '先说明要解决什么问题，以及读者需要的前置知识。', '',
      ':::steps', 'title: 操作步骤', '1 | 准备环境 | 安装依赖并确认版本', '2 | 编写核心逻辑 | 参考下方代码', '3 | 验证结果 | 跑一遍自检', ':::', '',
      ':::code-title', 'title: 最小可运行示例', 'lang: js', 'const result = doSomething(input)', 'console.log(result)', ':::', '',
      '```js', '// 一个完整示例', 'function doSomething(x) { return x * 2 }', '```', '',
      '更多资料见 [官方文档](https://example.com/docs)。', '',
      ':::cta', 'title: 动手试试', 'body: 把代码复制到本地跑一遍，再改成自己的需求。', ':::', '',
    ].join('\n'),
  },
  {
    id: 'weekly',
    name: { 'zh-CN': '工作周报', en: 'Weekly report', 'ja-JP': '週次レポート', 'ko-KR': '주간 보고', 'es-ES': 'Informe semanal' },
    md: [
      '---', 'title: 第 NN 周工作周报', 'description: 本周进展、关键数据与下周计划', 'author: LocalForge', 'theme: green', '---', '',
      ':::hero', 'eyebrow: WEEKLY', 'title: 第 NN 周工作周报', 'subtitle: 进展 · 数据 · 计划', 'meta: 2026.WNN', ':::', '',
      '## 关键数据', '', ':::metrics', '完成事项 | 12 项', '代码提交 | 48 次', '线上问题 | 0 个', ':::', '',
      '## 本周时间线', '', ':::timeline', 'title: 重要节点', '周一 | 需求评审 | 确认范围与排期', '周三 | 联调完成 | 打通主链路', '周五 | 灰度发布 | 覆盖 10% 流量', ':::', '',
      '## 下周计划', '', ':::checklist', '补齐监控告警', '完成回归测试', '输出复盘文档', ':::', '',
    ].join('\n'),
  },
  {
    id: 'review',
    name: { 'zh-CN': '产品评测', en: 'Product review', 'ja-JP': '製品レビュー', 'ko-KR': '제품 리뷰', 'es-ES': 'Reseña de producto' },
    md: [
      '---', 'title: XXX 深度评测', 'description: 两个方案的横向对比与最终结论', 'author: LocalForge', 'theme: orange', '---', '',
      ':::hero', 'eyebrow: REVIEW', 'title: XXX 深度评测', 'subtitle: 不谈参数堆砌，只看真实体验', 'meta: 约 6 分钟', ':::', '',
      '## 横向对比', '', ':::compare', 'title: 方案 A vs 方案 B', '维度 | 方案 A | 方案 B', '上手难度 | 低 | 中', '扩展能力 | 一般 | 强', ':::', '',
      ':::quote-card', 'title: 一句话感受', 'body: 如果你只想要开箱即用，A 更省心；要长期可定制，B 更值得投入。', ':::', '',
      '## 结论', '', ':::verdict', '推荐人群 | 追求效率的个人开发者', '慎选人群 | 需要深度定制的团队', ':::', '',
      '> [!NOTE]', '> 评测基于本地环境，结论仅供参考。', '',
    ].join('\n'),
  },
]
export function getTemplate(id) {
  return WECHAT_TEMPLATES.find((t) => t.id === id) || WECHAT_TEMPLATES[0]
}
export function templateLabel(id, locale) {
  const t = getTemplate(id)
  return (t.name && (t.name[locale] || t.name['zh-CN'])) || t.id
}

/* ============================================================
 * ③ 自定义主题：schema + 导入 / 导出
 * ========================================================== */
export const THEME_SCHEMA_VERSION = 1
const COLOR_FIELDS = ['primary', 'accent', 'text', 'sub', 'bg', 'soft', 'quoteBg', 'codeBg', 'codeText', 'border']

/** 导出主题为 JSON 字符串（先净化颜色，杜绝注入 style=""） */
export function exportTheme(theme) {
  return JSON.stringify({ schemaVersion: THEME_SCHEMA_VERSION, ...sanitizeTheme(theme) }, null, 2)
}
/** 导出多套主题为一个 bundle */
export function exportThemeBundle(themes) {
  return JSON.stringify({ schemaVersion: THEME_SCHEMA_VERSION, themes: (themes || []).map(sanitizeTheme) }, null, 2)
}
/**
 * 导入主题（单套或 bundle）。返回 { ok, theme | themes, issues }。
 * issues 为 code 化诊断，可由 describeIssue(issue, locale) 本地化。
 */
export function importTheme(json) {
  let raw
  try { raw = typeof json === 'string' ? JSON.parse(json) : json } catch {
    return { ok: false, issues: [{ code: 'theme-invalid-json', params: {}, level: 'error' }] }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, issues: [{ code: 'theme-invalid-json', params: {}, level: 'error' }] }
  }
  if (Number(raw.schemaVersion) !== THEME_SCHEMA_VERSION) {
    return { ok: false, issues: [{ code: 'theme-schema-mismatch', params: { v: raw.schemaVersion }, level: 'error' }] }
  }
  const list = Array.isArray(raw.themes) ? raw.themes : [raw]
  const issues = []
  const themes = list.map((item) => {
    const theme = sanitizeTheme(item)
    for (const f of COLOR_FIELDS) {
      if (item[f] != null && theme[f] !== String(item[f]).trim()) {
        issues.push({ code: 'theme-bad-color', params: { field: f }, level: 'warning' })
      }
    }
    return theme
  })
  return { ok: true, theme: themes[0], themes, issues }
}

/* ============================================================
 * ④ 发布前元数据校对
 * ========================================================== */
function countText(body) {
  const clean = String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*`~_|\[\]()!:-]/g, ' ')
  const cjk = (clean.match(/[\u3400-\u9fff]/g) || []).length
  const words = (clean.match(/[A-Za-z0-9]+/g) || []).length
  return { chars: cjk + words, words }
}
/**
 * 发布前校对：标题/摘要长度、正文字数、阅读时长、图片/外链数。
 * @param {string|object} input Markdown 原文或 parseDocument() 的 AST
 * @returns {{title,digest,chars,words,readMinutes,images,links,issues,errors,warnings,ok}}
 */
export function checkMetadata(input) {
  const ast = typeof input === 'string' ? parseDocument(input) : input
  const meta = ast.meta || {}
  const body = ast.body || ''
  const title = meta.title || (ast.blocks || []).find((b) => b.type === 'heading')?.text || ''
  const digest = meta.description || meta.digest || meta.summary || meta.abstract || ''
  const { chars, words } = countText(body)
  const readMinutes = Math.max(1, Math.ceil(chars / 300))
  const images = (body.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length
  const links = (body.match(/(?<!!)\[[^\]]+\]\((https?:\/\/[^)]+)\)/g) || []).length
  const issues = []
  const warn = (code, params) => issues.push({ code, params: params || {}, level: 'warning' })
  if (!title) warn('meta-title-missing')
  if (title.length > 64) warn('meta-title-too-long', { n: title.length })
  if (digest.length > 120) warn('meta-digest-too-long', { n: digest.length })
  if (!digest) warn('meta-no-digest')
  if (chars < 200) warn('meta-too-short', { n: chars })
  if (links > 5) warn('meta-too-many-links', { n: links })
  const derived = deriveIssues(issues, 'zh-CN')
  return {
    title, digest, chars, words, readMinutes, images, links,
    issues, errors: derived.errors, warnings: derived.warnings,
    ok: !issues.some((i) => i.level === 'error'),
  }
}

/* ============================================================
 * ⑤ 纯 JS ZIP（store，无压缩）—— 离线发布包 / 批量排版
 * ========================================================== */
// 不引入 @zip.js / libarchive / WASM：本页保持「零外部内核、零跨域请求」。
// 产物为标准 ZIP（method=0），系统 unzip / Python zipfile 均可直接读取。
let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      CRC_TABLE[i] = c >>> 0
    }
  }
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
class ByteWriter {
  constructor() { this.b = [] }
  u8(v) { this.b.push(v & 0xff) }
  u16(v) { this.u8(v); this.u8(v >>> 8) }
  u32(v) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff) }
  raw(arr) { for (let i = 0; i < arr.length; i++) this.b.push(arr[i] & 0xff) }
  out() { return Uint8Array.from(this.b) }
}
function dataUrlBytes(u) {
  const s = String(u || '')
  const b64 = s.slice(s.indexOf(',') + 1)
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary')
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
  return out
}
/** 把 name + 内容规范成一个 ZIP 条目；内容可为 string / Uint8Array / dataURL */
export function zipEntry(name, data) {
  if (typeof data === 'string' && /^data:/i.test(data)) return { name, data: dataUrlBytes(data) }
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data == null ? '' : data))
  return { name, data: bytes }
}
/** 生成标准 ZIP（store）字节；files: [{ name, data:Uint8Array }] */
export function buildStoreZip(files) {
  const w = new ByteWriter()
  const central = []
  let offset = 0
  const enc = new TextEncoder()
  for (const f of files || []) {
    const safeName = String(f.name || 'file.txt').replace(/^\/+/, '').replace(/\.\.\//g, '')
    const name = enc.encode(safeName)
    const data = f.data instanceof Uint8Array ? f.data : enc.encode(String(f.data == null ? '' : f.data))
    const crc = crc32(data)
    // local file header（flags 0x0800 = UTF-8 文件名；DOS date 1980-01-01）
    w.u32(0x04034b50); w.u16(20); w.u16(0x0800); w.u16(0); w.u16(0); w.u16(0x0021)
    w.u32(crc); w.u32(data.length); w.u32(data.length)
    w.u16(name.length); w.u16(0); w.raw(name); w.raw(data)
    central.push({ name, crc, size: data.length, offset })
    offset = w.b.length
  }
  const cdStart = w.b.length
  for (const c of central) {
    w.u32(0x02014b50); w.u16(20); w.u16(20); w.u16(0x0800); w.u16(0); w.u16(0); w.u16(0x0021)
    w.u32(c.crc); w.u32(c.size); w.u32(c.size)
    w.u16(c.name.length); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u32(0); w.u32(c.offset)
    w.raw(c.name)
  }
  const cdSize = w.b.length - cdStart
  w.u32(0x06054b50); w.u16(0); w.u16(0); w.u16(central.length); w.u16(central.length)
  w.u32(cdSize); w.u32(cdStart); w.u16(0)
  return w.out()
}

/**
 * 生成「离线发布包」条目清单（供视图 buildStoreZip 打包）。
 * 包含：Markdown 源文、渲染 HTML、图片、自检报告、元数据 JSON、说明。
 */
export function publishPackageFiles({ md, html, images = {}, report, meta, title, target = 'wechat' }) {
  const files = [
    zipEntry('article.md', md),
    zipEntry('article.html', `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title || 'article')}</title></head><body style="max-width:677px;margin:24px auto;padding:0 16px">${html}</body></html>`),
    zipEntry('report.txt', [
      `LocalForge 公众号排版 · 自检报告`,
      `目标平台: ${target}`,
      `标题: ${title || '(无)'}`,
      `状态: ${report && report.ok ? '通过' : '存在错误'}`,
      ``,
      `[errors]`,
      ...((report && report.errors) || []).map((e) => '- ' + e),
      ``,
      `[warnings]`,
      ...((report && report.warnings) || []).map((e) => '- ' + e),
      ``,
      `说明: 本包由 LocalForge 纯本地生成，未联网、未上传；请自行粘贴到公众号后台并做手机预览。`,
    ].join('\n')),
    zipEntry('meta.json', JSON.stringify({ schemaVersion: THEME_SCHEMA_VERSION, target, title, meta: meta || {}, generatedBy: 'LocalForge (offline)' }, null, 2)),
  ]
  let n = 0
  for (const [name, v] of Object.entries(images || {})) {
    const src = typeof v === 'string' ? v : (v.src || v.dataUrl)
    if (src && /^data:image\//i.test(src)) {
      const ext = (/^data:image\/([a-z]+)/i.exec(src) || [])[1] || 'png'
      // 发布包内用纯序号命名，避免中文/特殊字符文件名在部分解压工具里的编码歧义
      files.push(zipEntry(`images/${++n}.${ext === 'jpeg' ? 'jpg' : ext}`, src))
    }
  }
  files.push(zipEntry('README.txt', [
    'LocalForge 离线发布包',
    '',
    'article.md   —— Markdown 原文',
    'article.html —— 可直接用浏览器打开、全选复制的排版产物',
    'images/      —— 已本地化的图片（DataURL 还原）',
    'report.txt   —— 规范自检 / 元数据校对结果',
    'meta.json    —— 标题与 Frontmatter 元数据',
    '',
    '所有内容仅在本机浏览器生成，从未上传。发布动作请自行在公众号后台完成。',
  ].join('\n')))
  return files
}
