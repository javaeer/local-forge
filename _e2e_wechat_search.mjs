// 公众号文章检索 e2e（core 组）：在真实浏览器里验证「粘贴源码 → 本地解析 → 过滤 → 汇总」链路。
//
// 为什么不测联网：微信域名不下发 CORS 头，浏览器直连必失败；把 e2e 绑到外网既不稳定也不礼貌。
// 因此这里用「粘贴模式」跑完所有解析与交互，并断言**零跨域请求**——这恰好是本页的隐私不变量。
// 运行：pnpm build && node tests/run.mjs e2e --only wechatsearch
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

// 合集 JSON 夹具（真实字段名，两条：一条苏教版数学、一条语文）
const ALBUM_JSON = JSON.stringify({
  getalbum_resp: {
    article_list: [
      {
        title: '2026秋苏教版六年级上册数学《全册必背重点知识点汇总》高清版可打印！',
        create_time: '1789000000',
        url: 'http://mp.weixin.qq.com/s?__biz=X&mid=11&idx=2&sn=aa',
        msgid: 11, itemidx: 2,
      },
      {
        title: '2026秋六年级上册《语文全册重点知识点汇总》',
        create_time: '1789100000',
        url: 'http://mp.weixin.qq.com/s?__biz=X&mid=12&idx=1&sn=bb',
        msgid: 12, itemidx: 1,
      },
    ],
    continue_flag: 0,
    article_count: 2,
  },
})

// 文章页 HTML 夹具：标题 / 公众号 / 时间 / 合集 / 五张图（含重复与非微信域）
const ARTICLE_HTML = `<html><head><title>t</title></head><body>
<script>
var msg_title = '2026秋六年级上册《道德与法治重点必背知识点总结》可打印！'.html(false);
var nickname = htmlDecode("满分初高社");
var ct = "1789691033";
var biz = "MzY4NTI4NzQzOA==";
var mid = "2247486609";
var idx = "2";
</script>
<div id="js_content">
<img data-src="https://mmbiz.qpic.cn/mmbiz_png/AAA/640?wx_fmt=png&amp;from=appmsg">
<img src="https://mmbiz.qpic.cn/sz_mmbiz_png/BBB/640?wx_fmt=png&amp;from=appmsg">
<img data-src="https://res.wx.qq.com/blank.gif">
</div>
<script>
appmsgalbuminfo: { album_id: '4756099877288378373', title: '六年级学习资料' },
</script>
</body></html>`

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

  // 固定中文界面，断言文案才有意义
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch { /* ignore */ } })
  await page.goto(BASE + 'wechat-search', { waitUntil: 'networkidle0' })
  await wait(500)

  const head = await page.evaluate(() => ({
    h1: document.querySelector('h1.page-title')?.textContent.trim() || '',
    docTitle: document.title,
    tabs: document.querySelectorAll('.tabs button').length,
    help: !!document.querySelector('.helptip'),
    hasProxyField: [...document.querySelectorAll('.field label')].some((l) => /代理/.test(l.textContent)),
  }))
  check('页面挂载且标题本地化为「公众号文章检索」', head.h1 === '公众号文章检索', head.h1)
  check('document.title 同步路由标题', head.docTitle.includes('公众号文章检索'), head.docTitle)
  check('三个入口（文章 / 合集 / 粘贴源码）齐全', head.tabs === 3, `${head.tabs} 个`)
  check('使用说明与代理输入框就位（明示 CORS 约束）', head.help && head.hasProxyField)

  // —— 粘贴模式：合集 JSON ——
  await page.evaluate(() => {
    [...document.querySelectorAll('.tabs button')].find((b) => /粘贴/.test(b.innerText)).click()
  })
  await page.waitForSelector('textarea', { timeout: 5000 })
  await page.evaluate((val) => {
    const ta = document.querySelector('textarea')
    ta.value = val
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, ALBUM_JSON)
  await page.evaluate(() => {
    [...document.querySelectorAll('.panel .btn')].find((b) => /开始检索/.test(b.innerText)).click()
  })
  await wait(600)

  const albumView = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('table.kv tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()),
    chips: [...document.querySelectorAll('.chip')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
    msg: [...document.querySelectorAll('.msg')].map((m) => m.innerText.trim()).join(' | '),
  }))
  check('粘贴合集 JSON 后解析出 2 篇', albumView.rows.length === 2, `${albumView.rows.length} 行`)
  check('列表按发布时间倒序（语文 09-11 在数学 09-10 之前）',
    /09-11/.test(albumView.rows[0] || '') && /09-10/.test(albumView.rows[1] || ''),
    albumView.rows.map((r) => r.slice(0, 12)).join(' / '))
  check('版本标签自动识别（苏教版）', albumView.chips.some((c) => c.includes('苏教版')), albumView.chips.join(' '))
  check('完成提示包含篇数', /2 篇/.test(albumView.msg), albumView.msg.slice(0, 60))

  // 关键词过滤（改关键词不应再发请求）
  await page.evaluate(() => {
    const q = document.querySelector('input[placeholder="六年级 冀教版"]')
    q.value = '数学'
    q.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(300)
  const afterFilter = await page.evaluate(() => ({
    rows: document.querySelectorAll('table.kv tbody tr').length,
    hit: [...document.querySelectorAll('.msg.ok')].map((m) => m.innerText.trim()).join(' | '),
  }))
  check('关键词「数学」把 2 篇筛成 1 篇', afterFilter.rows === 1, `${afterFilter.rows} 行`)
  check('命中提示给出 n/m 计数', /1\s*\/\s*2/.test(afterFilter.hit), afterFilter.hit.slice(0, 40))

  // 排除词（-前缀）应把结果清零
  await page.evaluate(() => {
    const q = document.querySelector('input[placeholder="六年级 冀教版"]')
    q.value = '数学 -知识点'
    q.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(250)
  check('排除词「-知识点」使结果为 0', (await page.$$eval('table.kv tbody tr', (e) => e.length)) === 0)

  // —— 粘贴模式：文章页 HTML（离线解析元信息 + 原图链接）——
  await page.evaluate(() => {
    [...document.querySelectorAll('.tabs button')].find((b) => /粘贴/.test(b.innerText)).click()
  })
  await page.evaluate((val) => {
    const ta = document.querySelector('textarea')
    ta.value = val
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, ARTICLE_HTML)
  await page.evaluate(() => {
    [...document.querySelectorAll('.panel .btn')].find((b) => /开始检索/.test(b.innerText)).click()
  })
  await wait(600)

  const artView = await page.evaluate(() => ({
    kv: [...document.querySelectorAll('table.kv tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()),
    imgs: [...document.querySelectorAll('.img-list code')].map((c) => c.textContent.trim()),
    hasAlbum: !!document.body.innerText.match(/六年级学习资料/),
  }))
  check('文章页粘贴解析出标题与公众号',
    artView.kv.some((r) => r.includes('道德与法治重点必背知识点总结')) && artView.kv.some((r) => r.includes('满分初高社')),
    artView.kv.length + ' 行')
  check('所属合集被识别（六年级学习资料）', artView.hasAlbum)
  check('正文图片只保留微信图床（去重后 2 张）', artView.imgs.length === 2, `${artView.imgs.length} 条`)
  check('图片链接被改写为 /0 原图形态',
    artView.imgs.length > 0 && artView.imgs.every((s) => /\/0\?wx_fmt=/.test(s)),
    artView.imgs[0] || '')

  check('隐私不变量：全程零跨域网络请求（解析纯本地）', crossOrigin.length === 0, crossOrigin.slice(0, 3).join(' | '))
  check('页面无控制台 / 运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

console.log(`\n===== 公众号文章检索 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }
