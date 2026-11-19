// 文档转换（B-3）：Markdown → PDF（以及 Markdown → HTML）。
//
// 设计取舍：
//   - 零新增依赖：自带极简 Markdown 解析器（标题/段落/列表/引用/代码块/表格/粗斜体/链接/分隔线）
//   - PDF 渲染双通道：
//       · 纯拉丁文 → pdf-lib StandardFonts 矢量文字（清晰、体积小）
//       · 含中日韩等非拉丁字符 → canvas 逐页渲染为 PNG 再嵌入 PDF
//         （浏览器系统字体天然支持 CJK，无需内嵌数 MB 字体文件，保持首装体积不变）
//
// 全程本地，不上传；符合 LocalForge 的隐私模型。
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/* ---------------- 极简 Markdown 解析 ---------------- */
// 返回块级 token 数组： {type, ...}
//   heading{level,text} paragraph{text} list{ordered,items[]} code{lang,text}
//   quote{text} hr table{head[],rows[][]}
export function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  const isHr = (s) => /^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(s)
  const isHeading = (s) => /^(#{1,6})\s+(.*)$/.exec(s)
  const isUl = (s) => /^\s{0,3}[-*+]\s+/.test(s)
  const isOl = (s) => /^\s{0,3}\d+[.)]\s+/.test(s)
  const isQuote = (s) => /^\s{0,3}>\s?/.test(s)
  const isFence = (s) => /^\s{0,3}```/.test(s)

  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) { i++; continue }

    // 代码块
    if (isFence(line)) {
      const lang = line.replace(/^\s{0,3}```/, '').trim()
      i++
      const buf = []
      while (i < lines.length && !isFence(lines[i])) { buf.push(lines[i]); i++ }
      i++ // 跳过结束围栏
      blocks.push({ type: 'code', lang, text: buf.join('\n') })
      continue
    }
    // 标题
    const h = isHeading(line)
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue }
    // 分隔线
    if (isHr(line)) { blocks.push({ type: 'hr' }); i++; continue }
    // 引用
    if (isQuote(line)) {
      const buf = []
      while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++ }
      blocks.push({ type: 'quote', text: buf.join(' ') })
      continue
    }
    // 表格（| a | b | 以及分隔行）
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++ }
      blocks.push({ type: 'table', head, rows })
      continue
    }
    // 列表
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
    // 段落（连续非空行合并）
    const buf = [line]
    i++
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isHeading(lines[i]) && !isUl(lines[i]) && !isOl(lines[i]) && !isQuote(lines[i]) && !isFence(lines[i]) && !isHr(lines[i])) {
      buf.push(lines[i]); i++
    }
    blocks.push({ type: 'paragraph', text: buf.join(' ') })
  }
  return blocks
}

// 行内标记 → 纯文本（去 **bold** / *em* / `code` / [text](url)）
export function inlineToText(s) {
  return String(s || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
}

// 是否含非拉丁（CJK 等）字符
export function hasWideChars(s) {
  return /[^\u0000-\u024f\u2000-\u206f\u20a0-\u20cf\u2190-\u22ff]/.test(String(s || ''))
}

/* ---------------- Markdown → HTML（可直接下载 / 预览） ---------------- */
// 链接协议白名单：仅放行 http/https/mailto/tel、锚点、站内绝对/相对路径。
// 其余（javascript:、data:、vbscript: 等）一律降级为 "#"，防止导出 HTML 中残留可执行链接。
export function safeHref(url) {
  const u = String(url ?? '').trim()
  if (!u) return ''
  const lower = u.toLowerCase()
  if (/^(https?:|mailto:|tel:)/.test(lower)) return u
  if (u.startsWith('#') || u.startsWith('/') || u.startsWith('./') || u.startsWith('../')) return u
  // 不含冒号的视为相对路径（如 a/b.html、?q=1）
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return u
  return '#'
}

export function markdownToHtml(md, { title = 'Document' } = {}) {
  const blocks = parseMarkdown(md)
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  // 属性值转义：在正文转义基础上额外转义引号，防止 href 截断
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;')
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => `<a href="${escAttr(safeHref(url.replace(/&amp;/g, '&')))}">${text}</a>`)
  const body = blocks.map((b) => {
    switch (b.type) {
      case 'heading': return `<h${b.level}>${inline(b.text)}</h${b.level}>`
      case 'paragraph': return `<p>${inline(b.text)}</p>`
      case 'quote': return `<blockquote>${inline(b.text)}</blockquote>`
      case 'hr': return '<hr>'
      case 'code': return `<pre><code>${esc(b.text)}</code></pre>`
      case 'list': return `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((it) => `<li>${inline(it)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`
      case 'table': return `<table><thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      default: return ''
    }
  }).join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.8 system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#1f2328}
h1,h2,h3{border-bottom:1px solid #eaecef;padding-bottom:.3em}
code{background:#f6f8fa;padding:.15em .4em;border-radius:5px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
pre{background:#f6f8fa;padding:14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{border-left:4px solid #d0d7de;margin:0;padding:0 1em;color:#57606a}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d7de;padding:6px 12px;text-align:left}th{background:#f6f8fa}
hr{border:none;border-top:1px solid #d0d7de;margin:24px 0}a{color:#0969da}</style></head>
<body>${body}</body></html>`
}

/* ---------------- Markdown → PDF ---------------- */
// 双通道：拉丁文走矢量；含 CJK 走 canvas 位图（系统字体渲染，无需内嵌字体）。
export async function markdownToPdf(md, {
  title = 'Document',
  pageSize = 'a4',      // 'a4' | 'letter'
  margin = 56,
  baseFontSize = 12,
  onProgress,
} = {}) {
  const blocks = parseMarkdown(md)
  const allText = blocks.map((b) => (b.items ? b.items.join(' ') : b.text || (b.head || []).join(' '))).join(' ')
  const useCanvas = hasWideChars(allText)

  const sizes = { a4: [595.28, 841.89], letter: [612, 792] }
  const [PW, PH] = sizes[pageSize] || sizes.a4

  if (useCanvas) {
    return renderViaCanvas(blocks, { title, PW, PH, margin, baseFontSize, onProgress })
  }
  return renderViaVector(blocks, { title, PW, PH, margin, baseFontSize, onProgress })
}

// ---- 通道 1：矢量（纯拉丁） ----
async function renderViaVector(blocks, { title, PW, PH, margin, baseFontSize, onProgress }) {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)

  let page = doc.addPage([PW, PH])
  let y = PH - margin
  const maxW = PW - margin * 2

  const newPage = () => { page = doc.addPage([PW, PH]); y = PH - margin }
  const ensure = (need) => { if (y - need < margin) newPage() }

  const wrap = (text, size, f) => {
    const words = String(text).split(/\s+/)
    const out = []
    let cur = ''
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w
      if (f.widthOfTextAtSize(test, size) > maxW && cur) { out.push(cur); cur = w }
      else cur = test
    }
    if (cur) out.push(cur)
    return out
  }
  const drawLines = (text, size, f = font, color = rgb(0.1, 0.1, 0.12), gap = 4) => {
    for (const ln of wrap(inlineToText(text), size, f)) {
      ensure(size + gap)
      page.drawText(ln, { x: margin, y: y - size, size, font: f, color })
      y -= size + gap
    }
  }

  let n = 0
  for (const b of blocks) {
    onProgress && onProgress(++n / blocks.length)
    if (b.type === 'heading') {
      const size = b.level === 1 ? baseFontSize + 8 : b.level === 2 ? baseFontSize + 4 : baseFontSize + 2
      y -= size * 0.4
      drawLines(b.text, size, bold, rgb(0.05, 0.07, 0.12), 6)
      y -= 2
    } else if (b.type === 'paragraph') {
      drawLines(b.text, baseFontSize)
      y -= 6
    } else if (b.type === 'quote') {
      drawLines('> ' + b.text, baseFontSize, font, rgb(0.36, 0.4, 0.46))
      y -= 4
    } else if (b.type === 'list') {
      b.items.forEach((it, k) => drawLines((b.ordered ? `${k + 1}. ` : '• ') + it, baseFontSize))
      y -= 4
    } else if (b.type === 'code') {
      const size = baseFontSize - 1
      for (const ln of String(b.text).split('\n')) {
        ensure(size + 3)
        page.drawRectangle({ x: margin - 6, y: y - size - 2, width: maxW + 12, height: size + 5, color: rgb(0.96, 0.97, 0.98) })
        page.drawText(ln.slice(0, 110), { x: margin, y: y - size, size, font: mono, color: rgb(0.15, 0.16, 0.2) })
        y -= size + 3
      }
      y -= 6
    } else if (b.type === 'table') {
      const rows = [b.head, ...b.rows]
      const colW = maxW / (b.head.length || 1)
      const size = baseFontSize - 1
      for (const r of rows) {
        ensure(size + 6)
        r.forEach((c, ci) => page.drawText(inlineToText(c).slice(0, 26), { x: margin + ci * colW, y: y - size, size, font, color: rgb(0.1, 0.1, 0.12) }))
        y -= size + 6
      }
      y -= 6
    } else if (b.type === 'hr') {
      ensure(10); page.drawLine({ start: { x: margin, y }, end: { x: PW - margin, y }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) }); y -= 12
    }
  }
  return doc.save()
}

// ---- 通道 2：canvas 位图（含 CJK） ----
async function renderViaCanvas(blocks, { title, PW, PH, margin, baseFontSize, onProgress }) {
  // 以 2x 分辨率渲染以保证清晰度
  const SCALE = 2
  const W = Math.round(PW * SCALE)
  const H = Math.round(PH * SCALE)
  const M = margin * SCALE
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  const baseFS = baseFontSize * SCALE
  const lineGap = 4 * SCALE
  const maxW = W - M * 2

  const pages = []          // 每页 PNG bytes
  let y = M

  function newPage() {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    y = M
  }
  const flush = () => { pages.push(canvasToPng(canvas)) }
  function ensure(need) { if (y + need > H - M) { flush(); newPage() } }

  const wrapText = (text, size, bold) => {
    ctx.font = `${bold ? '700' : '400'} ${size}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
    const chars = Array.from(String(text))
    const out = []
    let cur = ''
    for (const ch of chars) {
      if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch }
      else cur += ch
    }
    if (cur) out.push(cur)
    return out
  }
  const drawText = (text, size, bold, color = '#1a1a1e', gap = lineGap) => {
    ctx.fillStyle = color
    ctx.textBaseline = 'top'
    for (const ln of wrapText(inlineToText(text), size, bold)) {
      ensure(size + gap)
      ctx.font = `${bold ? '700' : '400'} ${size}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.fillText(ln, M, y)
      y += size + gap
    }
  }

  newPage()
  let n = 0
  for (const b of blocks) {
    onProgress && onProgress(++n / blocks.length)
    if (b.type === 'heading') {
      const size = b.level === 1 ? baseFS + 16 : b.level === 2 ? baseFS + 8 : baseFS + 4
      y += size * 0.3
      drawText(b.text, size, true, '#0d1220', 8 * SCALE)
      y += 2 * SCALE
    } else if (b.type === 'paragraph') {
      drawText(b.text, baseFS, false); y += 8 * SCALE
    } else if (b.type === 'quote') {
      ctx.fillStyle = '#d0d7de'; ensure(20)
      drawText('│ ' + b.text, baseFS, false, '#5c6673'); y += 6 * SCALE
    } else if (b.type === 'list') {
      b.items.forEach((it, k) => drawText((b.ordered ? `${k + 1}. ` : '• ') + it, baseFS, false))
      y += 6 * SCALE
    } else if (b.type === 'code') {
      const size = baseFS - 2 * SCALE
      for (const ln of String(b.text).split('\n')) {
        ensure(size + 6 * SCALE)
        ctx.fillStyle = '#f6f8fa'; ctx.fillRect(M - 8, y - 2, maxW + 16, size + 6 * SCALE)
        ctx.fillStyle = '#24292f'; ctx.font = `400 ${size}px ui-monospace, Menlo, Consolas, monospace`; ctx.textBaseline = 'top'
        ctx.fillText(ln, M, y); y += size + 6 * SCALE
      }
      y += 8 * SCALE
    } else if (b.type === 'table') {
      const rows = [b.head, ...b.rows]
      const colW = maxW / (b.head.length || 1)
      const size = baseFS - 2 * SCALE
      for (const r of rows) {
        ensure(size + 10 * SCALE)
        r.forEach((c, ci) => {
          ctx.fillStyle = '#1a1a1e'; ctx.font = `400 ${size}px system-ui, "PingFang SC", sans-serif`; ctx.textBaseline = 'top'
          ctx.fillText(inlineToText(c).slice(0, 30), M + ci * colW, y)
        })
        y += size + 10 * SCALE
      }
      y += 8 * SCALE
    } else if (b.type === 'hr') {
      ensure(16 * SCALE); ctx.fillStyle = '#d0d7de'; ctx.fillRect(M, y, maxW, SCALE); y += 16 * SCALE
    }
  }
  flush()

  // 组装 PDF
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  for (const png of pages) {
    const img = await doc.embedPng(png)
    const p = doc.addPage([PW, PH])
    p.drawImage(img, { x: 0, y: 0, width: PW, height: PH })
  }
  if (pages.length === 0) doc.addPage([PW, PH])
  return doc.save()
}

function canvasToPng(canvas) {
  const dataUrl = canvas.toDataURL('image/png')
  const b64 = dataUrl.split(',')[1]
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
