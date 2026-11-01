// B-4 多语言 e2e（扩展版）：在真实浏览器中验证中日英韩西五种语言的
// ①切换与 <html lang> 同步 ②localStorage 持久化 ③侧栏分组/条目本地化
// ④开发者工具页面（SVG 工具箱 / CSS 速查）本地化 ⑤文档标题本地化
// ⑥不出现未翻译的原始 key（nav.xxx / svg.xxx / group.xxx …）
// 运行：pnpm build && pnpm preview & BASE=http://127.0.0.1:4173/ node _e2e_i18n.mjs
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

// ——— 本地化「不变量」检测器（用 \u 转义书写，避免源文件编码问题） ———
// 汉字（含扩展 A / 兼容表意文字）
const RE_CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/
// 日文假名
const RE_KANA = /[\u3040-\u30FF]/
// 韩文谚文
const RE_HANGUL = /[\uAC00-\uD7AF]/
// 未翻译的 i18n key：形如 nav.svgTool / group.dev / svg.title
const RE_KEY_LEAK = /(?:^|[\s(（"'>/])((?:nav|group|app|home|footer|svg|css|tools)\.[A-Za-z][A-Za-z0-9_]*)/

function leakOf(texts) {
  const bad = []
  for (const s of texts) {
    const m = String(s).match(RE_KEY_LEAK)
    if (m) bad.push(m[1])
  }
  return bad
}
function sample(texts, n = 3) {
  return texts.slice(0, n).map((s) => (s.length > 40 ? s.slice(0, 40) + '…' : s)).join(' | ')
}
// 依语言断言「文案确实被翻译」：拉美语言不含 CJK；日文含假名；韩文含谚文；中文含汉字
function assertScript(where, loc, texts) {
  const joined = texts.join(' ')
  if (loc === 'en' || loc === 'es-ES') {
    const hit = RE_CJK.test(joined) || RE_KANA.test(joined) || RE_HANGUL.test(joined)
    check(`${where}：${loc} 下无中日韩残留`, !hit, hit ? (joined.match(/.{0,20}[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF].{0,20}/) || [''])[0] : '')
  } else if (loc === 'ja-JP') {
    check(`${where}：ja-JP 含日文假名`, RE_KANA.test(joined), sample(texts, 2))
  } else if (loc === 'ko-KR') {
    check(`${where}：ko-KR 含韩文谚文`, RE_HANGUL.test(joined), sample(texts, 2))
  } else if (loc === 'zh-CN') {
    check(`${where}：zh-CN 含中文`, RE_CJK.test(joined), sample(texts, 2))
  }
}
function assertLocalized(where, loc, texts) {
  const bad = leakOf(texts)
  check(`${where}：无未翻译 key 泄漏`, bad.length === 0, bad.slice(0, 5).join(', '))
  assertScript(where, loc, texts)
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(700)

  // 语言菜单应列出 5 种语言
  await page.evaluate(() => document.querySelector('.topbar [data-testid=locale-toggle]').click())
  await wait(250)
  const menu = await page.evaluate(() => Array.from(document.querySelectorAll('.lang-menu .lang-item')).map((x) => x.textContent.trim()))
  check('B4：语言菜单列出 5 种语言', menu.length === 5, menu.join(' | '))
  check('B4：含中文/English/日本語/한국어/Español',
    ['中文', 'English', '日本語', '한국어', 'Español'].every((n) => menu.some((m) => m.includes(n))), menu.join(' | '))
  // 关闭菜单，保证后续循环从「关闭态」开始
  await page.evaluate(() => document.querySelector('.topbar [data-testid=locale-toggle]').click())
  await wait(200)

  // 切到侧栏布局，便于读取分组标题与全部导航条目
  await page.evaluate(() => document.querySelector('[data-testid=layout-toggle]').click())
  await wait(500)
  const hasSidebar = await page.evaluate(() => !!document.querySelector('.sidebar'))
  check('B4：可切换到侧栏布局', hasSidebar)

  const cases = [
    { name: 'English', lang: 'en', expect: /search/i, where: 'ts-text' },
    { name: '日本語', lang: 'ja-JP', expect: /ツール/, where: 'ts-text' },
    { name: '한국어', lang: 'ko-KR', expect: /도구/, where: 'ts-text' },
    { name: 'Español', lang: 'es-ES', expect: /Buscar/, where: 'ts-text' },
    { name: '中文', lang: 'zh-CN', expect: /搜索/, where: 'ts-text' },
  ]

  for (const c of cases) {
    // 打开菜单并点击目标语言
    await page.evaluate(() => document.querySelector('.topbar [data-testid=locale-toggle]').click())
    await wait(220)
    await page.evaluate((nm) => {
      const item = Array.from(document.querySelectorAll('.lang-menu .lang-item')).find((x) => x.textContent.includes(nm))
      if (item) item.click()
    }, c.name)
    await wait(400)
    const got = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute('lang'),
      stored: localStorage.getItem('lf-locale'),
      text: (document.querySelector('.top-search .ts-text') || {}).textContent || '',
      title: document.title,
    }))
    check(`B4：切到 ${c.name} → <html lang>`, got.lang === c.lang, got.lang)
    check(`B4：切到 ${c.name} → 持久化`, got.stored === c.lang, got.stored)
    check(`B4：切到 ${c.name} → 搜索文案本地化`, c.expect.test(got.text), got.text)
    // 切语言不触发导航：标题必须由 watch(locale) 同步（否则会残留上一个语言的标题）
    const titleNow = await page.evaluate(() => document.title)
    check(`B4：切到 ${c.name} → 文档标题即时同步`, !!titleNow && !RE_KEY_LEAK.test(titleNow), titleNow)
    if (c.lang === 'en' || c.lang === 'es-ES') {
      check(`B4：切到 ${c.name} → 文档标题无中文`, !RE_CJK.test(titleNow), titleNow)
    }

    // —— 侧栏分组 + 导航条目 ——
    const navTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.sidebar .sb-group, .sidebar .sb-link .sb-text'))
        .map((e) => e.textContent.trim())
        .filter(Boolean))
    check(`B4：${c.name} 侧栏读到导航文本`, navTexts.length >= 10, String(navTexts.length))
    assertLocalized(`B4：${c.name} 侧栏导航`, c.lang, navTexts)

    // —— 开发者工具页面 ——
    for (const p of ['svg-tool', 'css-reference']) {
      await page.goto(BASE + p, { waitUntil: 'networkidle0' })
      await wait(600)
      const info = await page.evaluate(() => ({
        title: document.title,
        text: (document.querySelector('main.content') || document.body).innerText || '',
      }))
      const lines = info.text.split('\n').map((s) => s.trim()).filter(Boolean)
      assertLocalized(`B4：${c.name} /${p} 页面`, c.lang, lines)
      check(`B4：${c.name} /${p} 文档标题已本地化`, !RE_KEY_LEAK.test(info.title) && info.title.includes('·'), info.title)
      if (c.lang === 'en' || c.lang === 'es-ES') {
        check(`B4：${c.name} /${p} 文档标题无中文`, !RE_CJK.test(info.title), info.title)
      }
      await page.goto(BASE, { waitUntil: 'networkidle0' })
      await wait(300)
    }
    // 回到首页后重新展开侧栏（布局偏好持久化，无需再点）
  }

  // 刷新后保持上次语言（中文）
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(500)
  const afterReload = await page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang'),
    search: (document.querySelector('.top-search .ts-text') || {}).textContent || '',
  }))
  check('B4：刷新后保持语言偏好', afterReload.lang === 'zh-CN' && /搜索/.test(afterReload.search), `${afterReload.lang} / ${afterReload.search}`)

} finally {
  await browser.close()
}

console.log(`\n===== B-4 多语言 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }
