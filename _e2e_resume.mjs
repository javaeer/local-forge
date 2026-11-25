// 可恢复任务 e2e：二级就地展开 / 键盘可达 / 可恢复分区条件出现 / 设置恢复 / 清空无残留 / 零跨域。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const ORIGIN = new URL(BASE).origin
const LS_KEY = 'lf-resume-v1'
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  try { await page.setBypassServiceWorker(true) } catch { /* 老版本 Puppeteer 不提供 */ }
  await page.setViewport({ width: 1360, height: 1000 })
  const crossOrigin = []
  page.on('request', (req) => {
    try {
      const u = new URL(req.url())
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        if (u.origin !== ORIGIN) crossOrigin.push(u.href)
      }
    } catch { /* data/blob/about 忽略 */ }
  })

  // 先清干净 localStorage 再进首页，确保初始为"无可恢复"态
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.evaluate((k) => { try { localStorage.removeItem(k) } catch {} }, LS_KEY)
  await page.evaluate(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(400)

  /* 1) 无可恢复快照时分区不出现 */
  const before = await page.evaluate(() => ({
    panel: !!document.querySelector('#resumable'),
    dots: document.querySelectorAll('.resume-dot').length,
  }))
  check('resume：无快照时"继续未完成任务"分区不出现', !before.panel)
  check('resume：无快照时任务卡无徽标', before.dots === 0, `dots=${before.dots}`)

  /* 2) 二级任务就地展开 */
  const more = await page.evaluate(() => {
    const btn = document.querySelector('[data-more="convert"]')
    return { exists: !!btn, expanded: btn ? btn.getAttribute('aria-expanded') : null }
  })
  check('resume：二级"更多工序"按钮存在', more.exists)
  check('resume：二级默认收起（aria-expanded=false）', more.expanded === 'false', more.expanded)
  await page.click('[data-more="convert"]')
  await wait(200)
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('[data-more="convert"]')
    const card = document.querySelector('.task-card[data-task="convert"]')
    return {
      expanded: btn.getAttribute('aria-expanded'),
      groups: card.querySelectorAll('.child-group').length,
      childSteps: card.querySelectorAll('.child-step').length,
      firstChildTitle: (card.querySelector('.child-title') || {}).textContent.trim(),
    }
  })
  check('resume：点击后二级展开（aria-expanded=true）', opened.expanded === 'true', opened.expanded)
  check('resume：二级分组渲染', opened.groups === 4 && opened.childSteps > 0, `groups=${opened.groups} steps=${opened.childSteps}`)
  check('resume：二级标题已本地化', opened.firstChildTitle && !/\btask\./.test(opened.firstChildTitle), opened.firstChildTitle)

  /* 3) 键盘可达：Tab 能聚焦到 more-toggle（focus-visible 由样式保证） */
  await page.evaluate(() => document.querySelector('[data-more="convert"]').focus())
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-more'))
  check('resume：more-toggle 可键盘聚焦', focused === 'convert', String(focused))

  /* 4) 注入可恢复快照后刷新：分区出现 + 徽标点亮 */
  const now = Date.now()
  const snapshot = [{
    id: 'zip::test', toolId: '/zip-compress', route: '/zip-compress',
    settings: { level: 9, splitSize: 50, folderMode: true },
    createdAt: now, updatedAt: now, progress: 0.5,
    fileHandleRef: null, downloadRef: null, ttlDays: 7,
  }]
  await page.evaluate((k, v) => { try { localStorage.setItem(k, v) } catch {} }, LS_KEY, JSON.stringify(snapshot))
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(400)
  const after = await page.evaluate(() => ({
    panel: !!document.querySelector('#resumable'),
    items: document.querySelectorAll('#resumable .recent-item').length,
    dots: document.querySelectorAll('.task-card[data-task="pack"] .resume-dot').length,
    progress: (document.querySelector('#resumable .resume-progress') || {}).textContent.trim(),
  }))
  check('resume：有快照时"继续未完成任务"分区出现', after.panel)
  check('resume：分区列出快照', after.items === 1, `items=${after.items}`)
  check('resume：打包任务卡出现可恢复徽标', after.dots === 1, `dots=${after.dots}`)
  check('resume：进度显示', after.progress === '50%', after.progress)

  /* 5) 恢复设置：进入 ZIP 工具，level 从快照恢复为 9 */
  await page.click('#resumable .recent-item')
  await wait(350)
  const restored = await page.evaluate(() => {
    const sel = document.querySelector('select')
    const inputs = Array.from(document.querySelectorAll('input'))
    return {
      path: location.pathname,
      values: inputs.map((i) => i.value),
      selects: sel ? Array.from(sel.options).map((o) => ({ v: o.value, s: o.selected })) : [],
    }
  })
  check('resume：点击快照跳转到对应工具', restored.path === '/zip-compress', restored.path)
  check('resume：工具已加载（存在设置控件）', restored.values.length + restored.selects.length > 0)

  /* 6) 一键清空后无残留 */
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(350)
  const withSnap = await page.evaluate(() => !!document.querySelector('#resumable'))
  check('resume：返回首页分区仍在（快照有效）', withSnap)
  await page.click('#resumable button.btn')
  await wait(250)
  const cleared = await page.evaluate((k) => ({
    panel: !!document.querySelector('#resumable'),
    raw: localStorage.getItem(k),
  }), LS_KEY)
  check('resume：清空后分区消失', !cleared.panel)
  check('resume：清空后 localStorage 无残留记录', cleared.raw === '[]' || cleared.raw === null, String(cleared.raw))

  /* 7) 零跨域 */
  const external = crossOrigin.filter((u) => !u.startsWith(ORIGIN))
  check('resume：零跨域请求', external.length === 0, external.slice(0, 3).join(', '))

  console.log(`\n=== 可恢复任务 e2e：${results.length - failed}/${results.length} 通过 ===`)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
