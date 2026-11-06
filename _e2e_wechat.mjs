// 公众号排版 e2e（core 组）：在真实浏览器里验证「纯本地编译 → 微信兼容内联 HTML」链路。
// 覆盖：页面挂载、文章产物结构硬约束、规范自检、主题/编辑响应式重编译、隐私不变量（零跨域请求）。
// 运行：pnpm build && pnpm test:e2e:wechat（run.mjs 注入 BASE / CHROME_PATH 并拉起 preview）
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const ORIGIN = new URL(BASE).origin
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok })
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
  await page.setViewport({ width: 1440, height: 900 })
  const errors = []
  const crossOrigin = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (req) => {
    const u = req.url()
    if (/^https?:/.test(u)) {
      try { if (new URL(u).origin !== ORIGIN) crossOrigin.push(u) } catch { /* 忽略畸形 URL */ }
    }
  })

  await page.goto(BASE + 'wechat-article', { waitUntil: 'networkidle0' })
  await wait(600)

  const info = await page.evaluate(() => ({
    title: document.querySelector('h1.page-title') ? document.querySelector('h1.page-title').textContent.trim() : '',
    docTitle: document.title,
    srcdoc: document.querySelector('iframe.preview') ? (document.querySelector('iframe.preview').getAttribute('srcdoc') || '') : '',
    help: !!document.querySelector('.helptip'),
    selfOk: !!document.querySelector('.ok-line'),
    hardErrors: document.querySelectorAll('.issue-list li.error').length,
    buttons: Array.from(document.querySelectorAll('button.btn')).map((b) => b.textContent.trim()),
  }))

  // 沙箱 Chromium 会自动检测系统语言（可能是 en-US），故文档标题会按当前语言本地化，
  // 断言只要求「已本地化 + 无原始 key 泄漏」，不写死某一种语言。
  const titleText = info.title + ' ' + info.docTitle
  check('页面挂载：视图标题与文档标题均已本地化且无 key 泄漏',
    !!info.title && info.docTitle.includes('·') && !/(?:nav|group|home|views)\.[A-Za-z]/.test(titleText),
    `${info.title} / ${info.docTitle}`)
  check('预览 iframe 已注入编译产物', info.srcdoc.length > 500, `${info.srcdoc.length} 字符`)

  // previewHtml 外层有预览容器专用的 <style> / #paper / font-family，属「壳」不属文章产物，
  // 因此只截取 <div id="paper"> 与 </div></body> 之间的文章片段做硬约束断言。
  const m = info.srcdoc.match(/<div id="paper">([\s\S]*)<\/div><\/body>/)
  const article = m ? m[1] : ''
  check('可提取文章片段（编译产物）', article.length > 200, `${article.length} 字符`)
  check('使用内联样式且文本节点包进 span[leaf]',
    /<section style="/.test(article) && /<span leaf=""/.test(article))
  const banned = [
    [/\sclass=/i, 'class'],
    [/\sid=/i, 'id'],
    [/var\(/i, 'var()'],
    [/font-family/i, 'font-family'],
    [/[;"\s]position\s*:/i, 'position'],
    [/<style\b/i, '<style>'],
  ]
  const hit = banned.filter(([re]) => re.test(article)).map(([, n]) => n)
  check('文章片段无 class / id / var() / font-family / position / <style>', hit.length === 0, hit.join(', '))

  check('规范自检 0 错误', info.selfOk && info.hardErrors === 0, `errors=${info.hardErrors}`)
  // 界面文案已接入 5 语言，断言用跨语言关键词而非写死中文
  check('帮助说明与「复制到公众号 / 下载 HTML」入口齐全',
    info.help && info.buttons.length >= 6 &&
    info.buttons.some((b) => /HTML/i.test(b)) &&
    info.buttons.some((b) => /Copy|复制到|コピー|복사|Copiar/i.test(b)),
    info.buttons.join(' | '))

  // 主题切换 → 重新编译
  const themeIds = await page.$$eval('select option', (els) => els.map((e) => e.value))
  const other = themeIds.find((v) => v && v !== 'ink')
  if (other) {
    await page.select('select', other)
    await wait(350)
    const after = await page.$eval('iframe.preview', (el) => el.getAttribute('srcdoc') || '')
    check(`切换主题（${other}）后预览重新编译`, !!after && after !== info.srcdoc)
  } else {
    check('主题下拉含可切换项', false, themeIds.join(','))
  }

  // 编辑 Markdown → 重新编译（Vue v-model 监听 input 事件）
  const beforeEdit = await page.$eval('iframe.preview', (el) => el.getAttribute('srcdoc') || '')
  await page.evaluate(() => {
    const ta = document.querySelector('textarea.md-input')
    ta.value = '# 端到端测试标题\n\n这是一段 **加粗** 文本。'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(350)
  const afterEdit = await page.$eval('iframe.preview', (el) => el.getAttribute('srcdoc') || '')
  check('编辑 Markdown 后预览实时更新', afterEdit.includes('端到端测试标题') && afterEdit !== beforeEdit)

  check('隐私不变量：无任何跨域网络请求', crossOrigin.length === 0, crossOrigin.slice(0, 3).join(' | '))
  check('页面无控制台 / 运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

console.log(`\n===== 公众号排版 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }
