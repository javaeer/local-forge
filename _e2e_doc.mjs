// B-3 文档转换 e2e：验证 Markdown 解析、HTML 输出、以及 PDF 生成的两种通道
// （纯拉丁走矢量 / 含中文走 canvas 位图），产出应为合法 PDF（%PDF 魔数）。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })
  await page.goto(BASE + 'doc-convert', { waitUntil: 'networkidle0' })
  await wait(500)

  const ui = await page.evaluate(() => ({
    title: (document.querySelector('.page-title') || {}).textContent || '',
    hasTextarea: !!document.querySelector('.md-input'),
    hasPdfBtn: !!Array.from(document.querySelectorAll('.btn')).find((b) => /生成 PDF/.test(b.textContent)),
    hasHtmlBtn: !!Array.from(document.querySelectorAll('.btn')).find((b) => /生成 HTML/.test(b.textContent)),
  }))
  check('B3：/doc-convert 路由可达', /文档转换/.test(ui.title), ui.title)
  check('B3：存在 Markdown 编辑器', ui.hasTextarea)
  check('B3：存在「生成 PDF」「生成 HTML」按钮', ui.hasPdfBtn && ui.hasHtmlBtn)

  /* Markdown 解析：注入结构化文本，验证块数 + 中文检测标记 */
  await page.evaluate(() => {
    const ta = document.querySelector('.md-input')
    ta.value = '# 标题一\n\n段落中文测试。\n\n- 项 A\n- 项 B\n\n```js\nconst x=1\n```\n\n> 引用\n'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(300)
  const parsed = await page.evaluate(() => {
    const tags = Array.from(document.querySelectorAll('.tag')).map((t) => t.textContent.replace(/\s+/g, ' ').trim())
    return { tags }
  })
  check('B3：识别含中文（canvas 通道）', parsed.tags.some((t) => /canvas 渲染/.test(t)), parsed.tags.join(' | '))
  check('B3：解析出多个块', parsed.tags.some((t) => /个块/.test(t)))

  /* 纯拉丁 → 矢量通道 */
  await page.evaluate(() => {
    const ta = document.querySelector('.md-input')
    ta.value = '# Hello World\n\nThis is a paragraph.\n\n- one\n- two\n'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(300)
  const latinTag = await page.evaluate(() => Array.from(document.querySelectorAll('.tag')).map((t) => t.textContent).join(' '))
  check('B3：纯拉丁走矢量通道', /矢量渲染/.test(latinTag), latinTag)

  // 生成 PDF（拉丁）→ 抓取下载内容校验 %PDF
  async function genPdf() {
    const client = await page.target().createCDPSession()
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/lf-dl', eventsEnabled: true })
    return client
  }
  // 用页面内直接调用引擎更可靠：evaluate 里 import 打包产物不可行，改为 hook 下载 Blob
  const pdfCheck = await page.evaluate(async () => {
    // 通过 window 上的 URL.createObjectURL 拦截，抓取生成的 PDF Blob 头
    const orig = URL.createObjectURL
    let captured = null
    URL.createObjectURL = function (blob) {
      if (blob && blob.type === 'application/pdf') captured = blob
      return orig.call(URL, blob)
    }
    try {
      const btn = Array.from(document.querySelectorAll('.btn')).find((b) => /生成 PDF/.test(b.textContent))
      btn.click()
      // 等待异步生成
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 200))
        if (captured) break
      }
      if (!captured) return { ok: false, reason: 'no-pdf' }
      const buf = new Uint8Array(await captured.slice(0, 8).arrayBuffer())
      const magic = String.fromCharCode(...buf.slice(0, 5))
      return { ok: magic === '%PDF-', size: captured.size, magic }
    } finally { URL.createObjectURL = orig }
  })
  check('B3：纯拉丁生成合法 PDF（%PDF-）', pdfCheck.ok, pdfCheck.ok ? `${(pdfCheck.size / 1024).toFixed(1)} KB` : pdfCheck.reason)

  /* 含中文 → canvas 通道生成 PDF */
  await page.evaluate(() => {
    const ta = document.querySelector('.md-input')
    ta.value = '# 中文标题\n\n这是一段中文正文，用于验证 canvas 渲染通道。\n\n- 列表项一\n- 列表项二\n'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(300)
  const pdfCn = await page.evaluate(async () => {
    const orig = URL.createObjectURL
    let captured = null
    URL.createObjectURL = function (blob) { if (blob && blob.type === 'application/pdf') captured = blob; return orig.call(URL, blob) }
    try {
      Array.from(document.querySelectorAll('.btn')).find((b) => /生成 PDF/.test(b.textContent)).click()
      for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 200)); if (captured) break }
      if (!captured) return { ok: false, reason: 'no-pdf' }
      const buf = new Uint8Array(await captured.slice(0, 5).arrayBuffer())
      return { ok: String.fromCharCode(...buf) === '%PDF-', size: captured.size }
    } finally { URL.createObjectURL = orig }
  })
  check('B3：含中文生成合法 PDF（canvas 通道）', pdfCn.ok, pdfCn.ok ? `${(pdfCn.size / 1024).toFixed(1)} KB` : pdfCn.reason)

  /* HTML 输出 */
  const htmlOk = await page.evaluate(async () => {
    const orig = URL.createObjectURL
    let captured = null
    URL.createObjectURL = function (blob) { if (blob && blob.type === 'text/html') captured = blob; return orig.call(URL, blob) }
    try {
      Array.from(document.querySelectorAll('.btn')).find((b) => /生成 HTML/.test(b.textContent)).click()
      await new Promise((r) => setTimeout(r, 300))
      if (!captured) return { ok: false }
      const text = await captured.text()
      return { ok: /<h1>中文标题<\/h1>/.test(text) && /<li>列表项一<\/li>/.test(text), hasTable: /<h1>/.test(text) }
    } finally { URL.createObjectURL = orig }
  })
  check('B3：HTML 输出含正确结构与列表', htmlOk.ok, htmlOk.ok ? '结构正确' : '结构不符')

} finally {
  await browser.close()
}

console.log(`\n===== B-3 文档转换 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }