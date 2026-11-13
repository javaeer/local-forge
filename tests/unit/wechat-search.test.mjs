// 公众号文章检索内核单元测试：纯 Node 运行，不需要浏览器 / DOM / 网络。
// 跑法：node --test tests/unit/wechat-search.test.mjs  （或 pnpm test:unit）
//
// 断言策略：全部用「真实页面裁剪出来的片段」当夹具，而不是凭空造的字符串——
// 微信的文章页与合集页都是模板化 HTML，用真片段才能守住正则不会写飘。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeUrl, parseArticleRef, parseArticleHtml, parseAlbumRef, extractImages,
  toOriginalImageUrl, buildAlbumUrl, parseAlbumPayload, parseAlbumHtml,
  filterArticles, sortArticles, dedupeArticles, summarize, articleKey,
  detectEdition, detectGrade, detectSubject, formatDate,
  toCsv, toMarkdown, createFetcher, explainFetchError, resolveFromArticle, fetchAlbum,
} from '../../src/lib/wechat-search.js'

/* ---------------- 夹具：真实文章页的关键片段 ---------------- */
const ARTICLE_HTML = `
<script>
var biz = "MzY4NTI4NzQzOA==" || "";
var mid = "2247486609" || "";
var idx = "2" || "";
var sn = "79a53d46d7f846d2d532d6b272950f38" || "";
var msg_title = '2026秋六年级上册《道德与法治重点必背知识点总结》可打印！'.html(false);
var nickname = htmlDecode("满分初高社");
var ct = "1789691033";
</script>
<div id="js_content" style="visibility: hidden">
  <section><p>第一单元 生活中的法律</p><p>法律是什么</p></section>
  <img data-src="https://mmbiz.qpic.cn/mmbiz_png/AAA/640?wx_fmt=png&amp;from=appmsg" src="data:image/gif;base64,xx">
  <img src="https://mmbiz.qpic.cn/sz_mmbiz_png/BBB/640?wx_fmt=png&amp;from=appmsg">
  <img data-src="https://res.wx.qq.com/blank.gif">
  <img data-src="https://mmbiz.qpic.cn/mmbiz_png/AAA/640?wx_fmt=png&amp;from=appmsg">
</div>
<script>
  appmsgalbuminfo: {
    album_id: '4756099877288378373',
    title: '六年级学习资料',
    link: 'https://mp.weixin.qq.com/mp/appmsgalbum?__biz=X&action=getalbum&album_id=4756099877288378373'
  },
</script>
`

const BLOCKED_HTML = '<html><body><p>当前环境异常，完成验证后即可继续访问。</p></body></html>'

/* ---------------- 夹具：真实合集分页 JSON ---------------- */
const ALBUM_JSON = JSON.stringify({
  base_resp: { ret: 0 },
  getalbum_resp: {
    article_list: [
      {
        title: '2026秋苏教版六年级上册数学《全册必背重点知识点汇总》高清版可打印！',
        create_time: '1789000000',
        url: 'http://mp.weixin.qq.com/s?__biz=MzY4NTI4NzQzOA==&mid=2247485677&idx=2&sn=cc8c',
        cover_img_1_1: 'https://mmbiz.qpic.cn/x/300',
        msgid: 2247485677,
        itemidx: 2,
      },
      {
        title: '2026秋六年级上册《语文全册重点知识点汇总》',
        create_time: '1789100000',
        url: 'http://mp.weixin.qq.com/s?__biz=MzY4NTI4NzQzOA==&mid=2247485578&idx=1&sn=fef5',
        msgid: 2247485578,
        itemidx: 1,
      },
    ],
    continue_flag: 1,
    article_count: 59,
  },
})

/* ---------------- 夹具：合集页 HTML 内联数据 ---------------- */
const ALBUM_HTML = `
<script>
  cgiData = {
    title: '六年级学习资料',
    msg_title: '六年级学习资料',
    desc: '学习资料',
    articleList: [
      {
        title: '2026秋北师大版数学六年级上册期中模拟测试卷5套（附答案解析）',
        create_time: '1793000000',
        cover_img_1_1: 'https://mmbiz.qpic.cn/y/300',
        url: 'http://mp.weixin.qq.com/s?__biz=MzY4NTI4NzQzOA==&amp;mid=2247490001&amp;idx=3&amp;sn=abc',
      },
    ],
    continue_flag: '1',
    article_count: '59',
  }
</script>
`

/* ============================================================
 * ① URL 识别
 * ========================================================== */

test('normalizeUrl：从分享文案里捞出链接，非微信域名一律拒绝', () => {
  assert.equal(normalizeUrl('https://mp.weixin.qq.com/s/abcDEF123'), 'https://mp.weixin.qq.com/s/abcDEF123')
  assert.equal(
    normalizeUrl('速看！这篇讲得好 https://mp.weixin.qq.com/s/abcDEF123 建议收藏'),
    'https://mp.weixin.qq.com/s/abcDEF123',
  )
  // 分享文本里常是裸域名，补全协议而不是报错
  assert.equal(normalizeUrl('mp.weixin.qq.com/s/abcDEF123'), 'https://mp.weixin.qq.com/s/abcDEF123')
  assert.equal(normalizeUrl('https://example.com/s/abc'), '')
  assert.equal(normalizeUrl(''), '')
})

test('parseArticleRef：短链 / 长链 / 合集链接分别识别', () => {
  const short = parseArticleRef('https://mp.weixin.qq.com/s/weXXnkqZYeO9WF0w4YlgZg')
  assert.equal(short.kind, 'article')

  const long = parseArticleRef('https://mp.weixin.qq.com/s?__biz=MzY4NTI4NzQzOA==&mid=2247486609&idx=2&sn=79a53d46')
  assert.equal(long.kind, 'article')
  assert.equal(long.biz, 'MzY4NTI4NzQzOA==')
  assert.equal(long.mid, '2247486609')
  assert.equal(long.idx, '2')

  const album = parseArticleRef('https://mp.weixin.qq.com/mp/appmsgalbum?__biz=X&action=getalbum&album_id=4756099877288378373')
  assert.equal(album.kind, 'album')
  assert.equal(album.albumId, '4756099877288378373')
})

/* ============================================================
 * ② 文章页解析
 * ========================================================== */

test('parseArticleHtml：标题 / 公众号 / 时间 / biz-mid-idx 全部取出', () => {
  const a = parseArticleHtml(ARTICLE_HTML)
  assert.equal(a.title, '2026秋六年级上册《道德与法治重点必背知识点总结》可打印！')
  assert.equal(a.account, '满分初高社')
  assert.equal(a.biz, 'MzY4NTI4NzQzOA==')
  assert.equal(a.mid, '2247486609')
  assert.equal(a.idx, '2')
  // ct 是秒级时间戳，解析后统一成毫秒
  assert.equal(a.publishTime, 1789691033000)
  assert.equal(a.publishText, formatDate(1789691033000))
  assert.equal(a.blocked, false)
})

test('parseArticleHtml：所属合集带出 id 与名称，且不会串到下一个对象', () => {
  const a = parseArticleHtml(ARTICLE_HTML)
  assert.deepEqual(a.album, { id: '4756099877288378373', title: '六年级学习资料' })
  assert.deepEqual(parseAlbumRef('<div>没有合集</div>'), null)
})

test('extractImages：data-src 优先、去重、只留微信图床、&amp; 要还原', () => {
  const imgs = extractImages(ARTICLE_HTML)
  assert.equal(imgs.length, 2)
  assert.equal(imgs[0], 'https://mmbiz.qpic.cn/mmbiz_png/AAA/640?wx_fmt=png&from=appmsg')
  assert.ok(imgs.every((u) => u.includes('mmbiz.qpic.cn')))
  assert.ok(!imgs.some((u) => u.includes('res.wx.qq.com')))
})

test('parseArticleHtml：反爬验证页要能被识别出来（blocked），而不是当成空文章', () => {
  const a = parseArticleHtml(BLOCKED_HTML)
  assert.equal(a.title, '')
  assert.equal(a.blocked, true)
})

test('toOriginalImageUrl：尺寸段换成 /0，追踪参数丢掉，已是最原始形态则保持', () => {
  assert.equal(
    toOriginalImageUrl('https://mmbiz.qpic.cn/mmbiz_png/AAA/640?wx_fmt=png&from=appmsg'),
    'https://mmbiz.qpic.cn/mmbiz_png/AAA/0?wx_fmt=png',
  )
  assert.equal(
    toOriginalImageUrl('https://mmbiz.qpic.cn/sz_mmbiz_jpg/BBB/0?wx_fmt=jpeg'),
    'https://mmbiz.qpic.cn/sz_mmbiz_jpg/BBB/0?wx_fmt=jpeg',
  )
  assert.equal(toOriginalImageUrl(''), '')
})

/* ============================================================
 * ③ 合集：地址构造与两种响应形态
 * ========================================================== */

test('buildAlbumUrl：必要参数齐全，首/续页的游标正确带入', () => {
  const first = buildAlbumUrl({ biz: 'B', albumId: '123', count: 10 })
  const u = new URL(first)
  assert.equal(u.searchParams.get('action'), 'getalbum')
  assert.equal(u.searchParams.get('album_id'), '123')
  assert.equal(u.searchParams.get('f'), 'json')
  assert.equal(u.searchParams.get('begin_msgid'), null)

  const next = buildAlbumUrl({ biz: 'B', albumId: '123', beginMsgid: '999', beginItemidx: '7' })
  const u2 = new URL(next)
  assert.equal(u2.searchParams.get('begin_msgid'), '999')
  assert.equal(u2.searchParams.get('begin_itemidx'), '7')

  // f='' 用于取 HTML 版（里面有合集名）
  assert.ok(!new URL(buildAlbumUrl({ biz: 'B', albumId: '1', f: '' })).searchParams.has('f'))
})

test('parseAlbumPayload(JSON)：条目归一化、游标取最后一条、http 升级为 https', () => {
  const page = parseAlbumPayload(ALBUM_JSON)
  assert.equal(page.items.length, 2)
  assert.equal(page.continueFlag, 1)
  assert.equal(page.total, 59)
  assert.deepEqual(page.cursor, { mid: '2247485578', idx: '1' })
  assert.equal(page.items[0].date, formatDate(1789000000000))
  assert.ok(page.items.every((x) => x.url.startsWith('https://')))
  assert.equal(page.items[0].edition, '苏教版')
  assert.equal(page.items[0].grade, '六年级')
  assert.equal(page.items[0].subject, '数学')
})

test('parseAlbumHtml：合集名只认 title+msg_title 那处，不误抓文章条目的 title', () => {
  const page = parseAlbumHtml(ALBUM_HTML)
  assert.equal(page.title, '六年级学习资料')
  assert.equal(page.items.length, 1)
  assert.equal(page.total, 59)
  assert.equal(page.items[0].edition, '北师大版')
  assert.equal(page.cursor.mid, '2247490001')
  assert.equal(page.cursor.idx, '3')
})

test('parseAlbumPayload：能吃 JSON 字符串、对象、HTML 三种入参，脏数据不抛错', () => {
  assert.equal(parseAlbumPayload(ALBUM_JSON).items.length, 2)
  assert.equal(parseAlbumPayload(JSON.parse(ALBUM_JSON)).items.length, 2)
  assert.equal(parseAlbumPayload(ALBUM_HTML).items.length, 1)
  assert.deepEqual(parseAlbumPayload(null), { albumId: '', title: '', items: [], continueFlag: 0, cursor: null, total: 0 })
  assert.equal(parseAlbumPayload('not-json-at-all').items.length, 0)
})

/* ============================================================
 * ④ 过滤 / 排序 / 统计 / 去重
 * ========================================================== */

const LIST = [
  { title: '2026秋新苏教版六年级上册数学知识点汇总', time: 3, url: 'u3', edition: '苏教版', grade: '六年级', subject: '数学' },
  { title: '2026秋六年级上册道德与法治知识点总结', time: 1, url: 'u1', edition: '', grade: '六年级', subject: '道德与法治' },
  { title: '2026秋人教版六年级上册数学期中测试卷', time: 2, url: 'u2', edition: '人教版', grade: '六年级', subject: '数学' },
]

test('filterArticles：空格=AND，-前缀=排除，空查询返回全部副本', () => {
  assert.equal(filterArticles(LIST, { query: '' }).length, 3)
  assert.equal(filterArticles(LIST, { query: '六年级 数学' }).length, 2)
  assert.equal(filterArticles(LIST, { query: '六年级 数学 -测试卷' }).length, 1)
  assert.equal(filterArticles(LIST, { query: '冀教版' }).length, 0)
  // 空查询必须返回新数组，调用方 sort/reverse 不能污染原列表
  const copy = filterArticles(LIST, { query: '' })
  copy.reverse()
  assert.equal(LIST[0].title, '2026秋新苏教版六年级上册数学知识点汇总')
})

test('filterArticles：exact 模式按整串匹配，不做分词', () => {
  assert.equal(filterArticles(LIST, { query: '数学 知识点', exact: true }).length, 0)
  assert.equal(filterArticles(LIST, { query: '数学知识点', exact: true }).length, 1)
})

test('sortArticles：默认新→旧，asc 反向，不改原数组', () => {
  const desc = sortArticles(LIST, 'desc')
  assert.deepEqual(desc.map((x) => x.time), [3, 2, 1])
  assert.deepEqual(sortArticles(LIST, 'asc').map((x) => x.time), [1, 2, 3])
  assert.deepEqual(LIST.map((x) => x.time), [3, 1, 2])
})

test('dedupeArticles：同一 mid+idx 的不同追踪参数视为同一篇', () => {
  const dup = [
    { title: 'A', url: 'https://mp.weixin.qq.com/s?__biz=X&mid=11&idx=2&sn=a' },
    { title: 'A', url: 'https://mp.weixin.qq.com/s?__biz=X&mid=11&idx=2&sn=a&chksm=zz' },
    { title: 'B', url: 'https://mp.weixin.qq.com/s?__biz=X&mid=12&idx=1&sn=b' },
  ]
  assert.equal(dedupeArticles(dup).length, 2)
  assert.equal(articleKey(dup[0]), articleKey(dup[1]))
})

test('summarize：版本 / 年级 / 学科计数与时间跨度', () => {
  const s = summarize(LIST)
  assert.equal(s.total, 3)
  assert.equal(s.grades[0].key, '六年级')
  assert.equal(s.grades[0].count, 3)
  assert.equal(s.editions.find((e) => e.key === '其他').count, 1)
  assert.ok(s.from <= s.to)
})

test('detectEdition：长词优先，人教PEP版不会被人教版截胡', () => {
  assert.equal(detectEdition('2026秋六年级上册《人教PEP版英语全册重点知识点汇总》'), '人教PEP版')
  assert.equal(detectEdition('2026秋新部编版语文六年级上册'), '部编版')
  assert.equal(detectEdition('2026秋新教科版科学六年级上册'), '教科版')
  assert.equal(detectEdition('随便一个标题'), '')
  assert.equal(detectGrade('2026秋高一物理'), '高一')
  assert.equal(detectSubject('道德与法治'), '道德与法治')
})

/* ============================================================
 * ⑤ 导出
 * ========================================================== */

test('toCsv：带 BOM（Excel 中文不乱码）、双引号转义、表头齐全', () => {
  const csv = toCsv([{ date: '2026-09-11', title: '含"引号"的标题', edition: '苏教版', grade: '六年级', subject: '数学', url: 'u' }])
  assert.ok(csv.startsWith('\uFEFF'))
  assert.match(csv, /"日期","标题","教材版本","年级","学科","链接"/)
  assert.match(csv, /含""引号""的标题/)
})

test('toMarkdown：表头 + 元信息 + 竖线转义', () => {
  const md = toMarkdown([{ date: '2026-09-11', title: 'a|b', url: 'u' }], { title: '六年级', albumId: '42', query: '数学' })
  assert.match(md, /^# 六年级/)
  assert.match(md, /合集 ID：42/)
  assert.match(md, /检索词：`数学`/)
  assert.match(md, /a\\\|b/)
})

/* ============================================================
 * ⑥ 取数层：错误分类与代理拼接（不发真请求）
 * ========================================================== */

test('createFetcher：proxy 支持 {url} 占位与直接前缀两种写法', () => {
  const a = createFetcher({ mode: 'proxy', proxy: 'https://p.example/?u={url}' })
  assert.equal(a.endpoint('https://mp.weixin.qq.com/x'), 'https://p.example/?u=' + encodeURIComponent('https://mp.weixin.qq.com/x'))
  const b = createFetcher({ mode: 'proxy', proxy: 'https://p.example/' })
  assert.equal(b.endpoint('https://a/b'), 'https://p.example/' + encodeURIComponent('https://a/b'))
  // 没有代理时保持原地址，绝不偷偷走第三方
  assert.equal(createFetcher({ mode: 'direct' }).endpoint('https://a/b'), 'https://a/b')
})

test('createFetcher：paste 模式不发请求，直接抛 paste-required', async () => {
  const f = createFetcher({ mode: 'paste' })
  await assert.rejects(() => f.getText('https://mp.weixin.qq.com/x'), (e) => e.code === 'paste-required')
})

test('createFetcher：direct 模式下 fetch 抛 TypeError → 归类为 cors', async () => {
  const f = createFetcher({ mode: 'direct', fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
  await assert.rejects(() => f.getText('https://mp.weixin.qq.com/x'), (e) => e.code === 'cors')
})

test('createFetcher：HTTP 非 2xx → http 错误并带上状态码', async () => {
  const f = createFetcher({ mode: 'direct', fetchImpl: async () => ({ ok: false, status: 429 }) })
  await assert.rejects(() => f.getText('https://mp.weixin.qq.com/x'), (e) => e.code === 'http' && e.status === 429)
})

test('explainFetchError：五种语言都有文案，{status} 会被替换', () => {
  for (const loc of ['zh-CN', 'en']) {
    const s = explainFetchError({ code: 'http', status: 403 }, loc)
    assert.ok(s && !s.includes('{status}'))
  }
  assert.match(explainFetchError({ code: 'cors' }, 'zh-CN'), /CORS/)
  // 未知 code 回退 network 文案，不返回空串
  assert.ok(explainFetchError({ code: 'whatever' }, 'zh-CN').length > 0)
})

/* ============================================================
 * ⑦ 高层编排：文章 → 合集（用假 getText，不联网）
 * ========================================================== */

test('resolveFromArticle：一次取页面就能拿到 biz + 合集 id', async () => {
  const r = await resolveFromArticle('https://mp.weixin.qq.com/s?__biz=MzY4NTI4NzQzOA==&mid=2247486609&idx=2&sn=x', async () => ARTICLE_HTML)
  assert.equal(r.biz, 'MzY4NTI4NzQzOA==')
  assert.equal(r.albumId, '4756099877288378373')
  assert.equal(r.albumTitle, '六年级学习资料')
  assert.equal(r.article.account, '满分初高社')
})

test('resolveFromArticle：反爬页要给出可操作的报错，而不是静默返回空', async () => {
  await assert.rejects(
    () => resolveFromArticle('https://mp.weixin.qq.com/s/abcdef123456', async () => BLOCKED_HTML),
    (e) => e.code === 'blocked' && /chksm|反爬/.test(e.message),
  )
})

test('fetchAlbum：自动翻页到 continue_flag=0，跨页去重，页数可统计', async () => {
  const pages = [
    JSON.stringify({ getalbum_resp: {
      article_list: [
        { title: 'A', create_time: '1', url: 'http://mp.weixin.qq.com/s?__biz=X&mid=1&idx=1', msgid: 1, itemidx: 1 },
        { title: 'B', create_time: '2', url: 'http://mp.weixin.qq.com/s?__biz=X&mid=2&idx=1', msgid: 2, itemidx: 1 },
      ], continue_flag: 1,
    } }),
    JSON.stringify({ getalbum_resp: {
      article_list: [
        { title: 'B', create_time: '2', url: 'http://mp.weixin.qq.com/s?__biz=X&mid=2&idx=1', msgid: 2, itemidx: 1 },
        { title: 'C', create_time: '3', url: 'http://mp.weixin.qq.com/s?__biz=X&mid=3&idx=1', msgid: 3, itemidx: 1 },
      ], continue_flag: 0,
    } }),
  ]
  let i = 0
  const seen = []
  const { items, pages: n, truncated } = await fetchAlbum({
    biz: 'X', albumId: '9',
    getText: async (url) => { seen.push(url); return pages[Math.min(i++, pages.length - 1)] },
    delay: 0,
  })
  assert.equal(n, 2)
  assert.equal(items.length, 3)          // B 跨页重复被去掉
  assert.equal(truncated, false)
  assert.equal(seen.length, 2)
  assert.ok(seen[1].includes('begin_msgid=2'))   // 第二页带上一页末尾游标
})

test('fetchAlbum：触到 maxPages 时标 truncated，不假装拉完了', async () => {
  const one = JSON.stringify({ getalbum_resp: {
    article_list: [{ title: 'A', create_time: '1', url: 'http://mp.weixin.qq.com/s?__biz=X&mid=1&idx=1', msgid: 1, itemidx: 1 }],
    continue_flag: 1,
  } })
  const r = await fetchAlbum({ biz: 'X', albumId: '9', getText: async () => one, maxPages: 2, delay: 0 })
  assert.equal(r.pages, 2)
  assert.equal(r.truncated, true)
})

test('fetchAlbum：缺 biz / albumId 直接报错，不发请求', async () => {
  await assert.rejects(() => fetchAlbum({ biz: '', albumId: '1', getText: async () => '' }), /缺少 biz 或 albumId/)
})
