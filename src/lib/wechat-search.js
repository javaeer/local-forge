// 公众号文章检索内核（WeChat Article Index）
//
// 定位：公众号**没有**公开的文章列表 / 搜索接口，唯一稳定可取的入口是「合集（album）」。
// 本内核把这件事拆成可静态测试的纯函数：从一篇已知文章反查出 `__biz + album_id`，
// 再翻页拉整本合集，得到「标题 + 时间 + 链接」列表，最后做本地关键词过滤与导出。
//
// 与 LocalForge 隐私模型的张力（重要，不粉饰）：
//   本模块的**解析层纯本地、零请求**；真正发请求的是 `createFetcher()` 返回的取数器，
//   且默认 `direct` 模式不经过任何第三方。mp.weixin.qq.com 不下发 CORS 头，
//   浏览器直连必然被拦，故提供三条路径（见 docs/wechat-search-local-plan.md）：
//     · direct  —— 直连（自建反代 / 同域部署 / 已放开 CORS 时可用）
//     · proxy   —— 用户自填代理前缀，URL 由用户自己信任的服务转发
//     · paste   —— 完全不联网：用户粘贴页面 HTML 或合集 JSON，本模块只解析
//   Node CLI（scripts/wechat-search.mjs）无 CORS 限制，是能力最完整的一条路。
//
// 设计约束：零依赖、不碰 DOM（不用 DOMParser / document）、正则解析、
// 同一份代码同时跑在浏览器与 Node（单测用 node --test）。

/* ============================================================
 * 词典：教材版本 / 学科 / 年级（用于一键归类与过滤）
 * ========================================================== */

// 顺序有意义：长词优先匹配，避免「人教版」把「人教PEP版」吃掉一半
export const EDITIONS = [
  '人教PEP版', '人教部编版', '部编版', '人教版', '北师大版', '苏教版', '冀教版', '西师大版', '西师版',
  '青岛版', '北京版', '外研版', '译林版', '教科版', '沪教版', '湘教版', '鲁教版', '浙教版', '鄂教版',
  '长春版', 'PEP', '新目标',
]

export const SUBJECTS = [
  '道德与法治', '道法', '语文', '数学', '英语', '物理', '化学', '生物', '科学',
  '历史', '地理', '政治', '信息技术', '美术', '音乐', '体育',
]

export const GRADES = [
  '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '七年级', '八年级', '九年级', '高一', '高二', '高三',
]

const SEMESTERS = ['上册', '下册', '全册', '必修一', '必修二', '选择性必修']

/* ============================================================
 * ① URL 归一化与识别
 * ========================================================== */

const HOST_RE = /(?:^https?:\/\/)?(?:mp\.weixin\.qq\.com|weixin\.qq\.com)\//i

/** 从任意输入里抽出微信文章 / 合集链接（容忍缺 https、带 #rd 锚点、带追踪参数） */
export function normalizeUrl(input) {
  const raw = String(input == null ? '' : input).trim()
  if (!raw) return ''
  // 从一段文本里捞出第一个链接（用户常直接粘整段分享文案）
  const m = raw.match(/https?:\/\/[^\s"'<>]+/i)
  let url = (m ? m[0] : raw).trim()
  if (!HOST_RE.test(url)) return ''
  // 用户常直接粘 "mp.weixin.qq.com/s/xxx"（微信分享文本里就是这样），补全协议再返回
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/\//, '')
  return url
}

/**
 * 解析链接指向的资源类型与关键参数。
 * @returns {{kind:'article'|'album'|'unknown', biz:string, mid:string, idx:string, sn:string, albumId:string, url:string}}
 */
export function parseArticleRef(input) {
  const url = normalizeUrl(input)
  const out = { kind: 'unknown', biz: '', mid: '', idx: '', sn: '', albumId: '', url }
  if (!url) return out

  // 短链形态：https://mp.weixin.qq.com/s/AbCdEf...（biz/mid/idx 需再抓页面才知道）
  if (/\/s\/[A-Za-z0-9_-]{6,}/.test(url)) {
    out.kind = 'article'
  }

  const q = (k) => {
    const m = url.match(new RegExp('[?&]' + k + '=([^&#]+)'))
    return m ? decodeURIComponent(m[1]) : ''
  }
  const biz = q('__biz')
  if (biz) out.biz = biz
  if (q('mid')) { out.mid = q('mid'); out.kind = 'article' }
  if (q('idx')) out.idx = q('idx')
  if (q('sn')) out.sn = q('sn')

  // 合集链接：/mp/appmsgalbum?...album_id=xxx
  if (/appmsgalbum/.test(url)) {
    const aid = q('album_id') || (url.match(/album_id[=/](\d{10,})/) || [])[1] || ''
    if (aid) { out.albumId = aid; out.kind = 'album' }
  }
  return out
}

/** 文章的唯一身份（用于去重 / 生成稳定 key） */
export function articleKey(item) {
  const u = String((item && item.url) || '')
  const biz = (u.match(/__biz=([^&]+)/) || [])[1] || ''
  const mid = (u.match(/[?&]mid=(\d+)/) || [])[1] || (item && item.msgid) || ''
  const idx = (u.match(/[?&]idx=(\d+)/) || [])[1] || (item && item.itemidx) || ''
  if (mid) return `${biz}:${mid}:${idx}`
  return (item && item.title) || u
}

/* ============================================================
 * ② 文章页解析（纯字符串，不依赖 DOM）
 * ========================================================== */

function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

/**
 * 解析公众号文章页 HTML：标题、公众号、发布时间、biz/mid/idx、所属合集、正文图片。
 * 只做正则提取，不执行页面脚本（页面里的 JSON 都是纯文本变量，够用）。
 * @returns {{title,account,biz,mid,idx,publishTime,publishText,album,images,chars}}
 */
export function parseArticleHtml(html) {
  const h = String(html || '')
  const pick = (re) => {
    const m = h.match(re)
    return m ? m[1] : ''
  }

  // 标题：优先 msg_title（正文用），退回 og:title / <title>
  let title = pick(/var msg_title\s*=\s*'([^']*)'/)
    || pick(/var msg_title\s*=\s*"([^"]*)"/)
    || pick(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)
    || pick(/<title>([^<]*)<\/title>/i)
  title = decodeEntities(title).replace(/\.html\(false\)$/, '').trim()

  const account = decodeEntities(
    pick(/var nickname\s*=\s*htmlDecode\("([^"]*)"\)/)
    || pick(/var nickname\s*=\s*"([^"]*)"/)
    || pick(/<meta[^>]+property="og:article:author"[^>]+content="([^"]*)"/i),
  ).trim()

  const ct = pick(/var ct\s*=\s*"(\d+)"/) || pick(/"publish_time"\s*:\s*"?(\d+)/)
  const publishTime = ct ? Number(ct) * 1000 : 0
  const publishText = publishTime ? formatDate(publishTime) : ''

  const biz = decodeEntities(pick(/var biz\s*=\s*"([^"]+)"/) || pick(/__biz=([A-Za-z0-9+/=]+)/))
  const mid = pick(/var mid\s*=\s*"(\d+)"/) || pick(/[?&]mid=(\d+)/)
  const idx = pick(/var idx\s*=\s*"(\d+)"/) || pick(/[?&]idx=(\d+)/)

  return {
    title,
    account,
    biz,
    mid,
    idx,
    publishTime,
    publishText,
    album: parseAlbumRef(h),
    images: extractImages(h),
    chars: countChars(stripTags(bodyOf(h))),
    // 微信的反爬页（缺 chksm 参数、或请求过快时会命中）：正文永远拿不到，必须明确告诉调用方
    blocked: !title && /环境异常|完成验证|请在微信客户端打开|访问过于频繁/.test(h),
  }
}

// 文章属属的合集：album_id 后面紧跟 title（窗口内遇到下一个 album_id 即停）
export function parseAlbumRef(html) {
  const h = String(html || '')
  const m = h.match(/album_id:\s*'(\d+)'/)
  if (!m) return null
  const start = m.index + m[0].length
  const window = h.slice(start, start + 400)
  const next = window.search(/album_id:\s*'/)
  const scoped = next > 0 ? window.slice(0, next) : window
  const t = scoped.match(/title:\s*'([^']*)'/)
  return { id: m[1], title: t ? decodeEntities(t[1]).trim() : '' }
}

// 正文图片：data-src（懒加载真实地址）优先，其次 src；只保留微信图床
export function extractImages(html) {
  const h = String(html || '')
  const out = []
  const seen = new Set()
  for (const tag of h.match(/<img\b[^>]*>/gi) || []) {
    const src = (tag.match(/data-src="([^"]+)"/i) || tag.match(/src="([^"]+)"/i) || [])[1]
    if (!src) continue
    const url = decodeEntities(src)
    if (!/mmbiz\.qpic\.cn/i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

/**
 * 展示图 → 上传原图。
 * 微信的图片服务把路径末段当尺寸参数：`/640` 返回压缩版，`/0` 返回原始文件。
 * 注意：原作者若把水印合成进像素里，`/0` 同样带水印——本函数不、也无法去水印。
 */
export function toOriginalImageUrl(src) {
  const u = String(src || '').trim()
  if (!u) return ''
  const fmt = (u.match(/wx_fmt=(\w+)/) || [])[1] || 'png'
  let base = u.split('?')[0]
  base = base.replace(/\/\d+$/, '')      // 去掉末尾尺寸段
  return `${base}/0?wx_fmt=${fmt}`
}

/* ============================================================
 * ③ 合集：请求地址构造 + 响应解析（JSON / HTML 两种形态）
 * ========================================================== */

/** 合集分页接口地址。beginMsgid/beginItemidx 为空表示第一页。 */
export function buildAlbumUrl({ biz, albumId, count = 10, beginMsgid = '', beginItemidx = '', f = 'json' } = {}) {
  const q = new URLSearchParams()
  q.set('__biz', biz || '')
  q.set('action', 'getalbum')
  q.set('album_id', String(albumId || ''))
  q.set('count', String(count))
  q.set('scene', '126')
  if (beginMsgid) q.set('begin_msgid', String(beginMsgid))
  if (beginItemidx) q.set('begin_itemidx', String(beginItemidx))
  if (f) q.set('f', f)
  return `https://mp.weixin.qq.com/mp/appmsgalbum?${q.toString()}`
}

/**
 * 解析合集响应。同时吃两种输入：
 *   · 分页接口的 JSON（{ getalbum_resp: { article_list, continue_flag } }）
 *   · 合集页 HTML（内含 articleList: [...] 的内联数据）
 * @returns {{albumId,title,items,continueFlag,cursor,total}}
 */
export function parseAlbumPayload(payload) {
  const empty = { albumId: '', title: '', items: [], continueFlag: 0, cursor: null, total: 0 }
  if (payload == null) return empty

  let obj = payload
  if (typeof payload === 'string') {
    const text = payload.trim()
    if (text.startsWith('{') || text.startsWith('[')) {
      try { obj = JSON.parse(text) } catch { return parseAlbumHtml(text) }
    } else {
      return parseAlbumHtml(text)
    }
  }

  const resp = obj && (obj.getalbum_resp || obj)
  if (!resp) return empty
  const list = Array.isArray(resp.article_list) ? resp.article_list : []
  const items = list.map(normalizeAlbumItem).filter((x) => x.title)
  const last = list[list.length - 1] || {}
  return {
    albumId: String(resp.album_id || (obj && obj.album_id) || ''),
    title: decodeEntities(resp.title || ''),
    items,
    continueFlag: Number(resp.continue_flag) || 0,
    cursor: last.msgid ? { mid: String(last.msgid), idx: String(last.itemidx || 1) } : null,
    total: Number(resp.article_count) || items.length,
  }
}

// 合集页 HTML 里 articleList 是 JS 字面量（单引号 + 未转义中文），逐条抓字段比 JSON 化更稳
export function parseAlbumHtml(html) {
  const h = String(html || '')
  const items = []
  const re = /title:\s*'((?:[^'\\]|\\.)*)',\s*create_time:\s*'(\d+)',[\s\S]{0,400}?url:\s*'([^']+)'/g
  let m
  while ((m = re.exec(h))) {
    items.push(normalizeAlbumItem({
      title: unescapeJs(m[1]),
      create_time: m[2],
      url: decodeEntities(m[3]),
    }))
  }
  const albumId = (h.match(/album_id:\s*'(\d+)'/) || [])[1] || ''
  // 合集标题只认「title 紧跟 msg_title 且 desc 随后」这一处，避免误抓文章条目的 title
  const title = unescapeJs((h.match(/title:\s*'([^']*)',\s*msg_title:\s*'/) || [])[1] || '')
  const total = Number((h.match(/article_count:\s*'(\d+)'/) || [])[1]) || items.length
  const cont = Number((h.match(/continue_flag:\s*'?(\d+)'?/) || [])[1]) || 0
  const lastItem = items[items.length - 1]
  const cursor = lastItem
    ? {
        mid: (lastItem.url.match(/[?&]mid=(\d+)/) || [])[1] || '',
        idx: (lastItem.url.match(/[?&]idx=(\d+)/) || [])[1] || '1',
      }
    : null
  return { albumId, title: title || '', items, continueFlag: cont, cursor, total }
}

function unescapeJs(s) {
  return decodeEntities(String(s || '').replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
}

function normalizeAlbumItem(a) {
  const url = decodeEntities(String((a && a.url) || '').replace(/^http:/, 'https:'))
  const t = Number(a && a.create_time) || 0
  const title = decodeEntities(String((a && a.title) || '')).trim()
  return {
    title,
    // create_time 是秒；个别字段可能是毫秒，做一次量级修正
    time: t > 1e12 ? t : t * 1000,
    date: t ? formatDate(t > 1e12 ? t : t * 1000) : '',
    url,
    cover: decodeEntities(String((a && a.cover_img_1_1) || '')),
    msgid: String((a && a.msgid) || (url.match(/[?&]mid=(\d+)/) || [])[1] || ''),
    itemidx: String((a && a.itemidx) || (url.match(/[?&]idx=(\d+)/) || [])[1] || ''),
    edition: detectEdition(title),
    grade: detectGrade(title),
    subject: detectSubject(title),
  }
}

/* ============================================================
 * ④ 本地过滤 / 归类 / 统计
 * ========================================================== */

function detectFrom(list, title) {
  const t = String(title || '')
  const hit = list.find((k) => t.includes(k))
  return hit || ''
}
export const detectEdition = (title) => detectFrom(EDITIONS, title)
export const detectGrade = (title) => detectFrom(GRADES, title)
export const detectSubject = (title) => detectFrom(SUBJECTS, title)

/**
 * 标题检索：空格分隔多词 = AND（都命中才算），`-词` 表示排除。
 * 例：`六年级 冀教版 -测试卷` → 含「六年级」且含「冀教版」且不含「测试卷」。
 * @param {Array} items
 * @param {{query?:string, exact?:boolean}} opts exact=true 时按完整短语匹配（不做分词）
 */
export function filterArticles(items, { query = '', exact = false } = {}) {
  const list = Array.isArray(items) ? items : []
  const q = String(query || '').trim()
  if (!q) return list.slice()

  if (exact) return list.filter((it) => String(it.title).includes(q))

  const tokens = q.split(/\s+/).filter(Boolean)
  const must = tokens.filter((t) => !t.startsWith('-'))
  const deny = tokens.filter((t) => t.startsWith('-')).map((t) => t.slice(1)).filter(Boolean)

  return list.filter((it) => {
    const title = String(it.title || '')
    if (deny.some((d) => title.includes(d))) return false
    return must.every((t) => title.includes(t))
  })
}

/** 按发布时间排序（默认新→旧）；时间相同用标题兜底保证稳定 */
export function sortArticles(items, order = 'desc') {
  const dir = order === 'asc' ? 1 : -1
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
    const d = (Number(a.time) || 0) - (Number(b.time) || 0)
    if (d !== 0) return d * dir
    return String(a.title).localeCompare(String(b.title)) * dir
  })
}

/** 去重（同一文章可能同时出现在多个合集里） */
export function dedupeArticles(items) {
  const seen = new Set()
  const out = []
  for (const it of Array.isArray(items) ? items : []) {
    const k = articleKey(it)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

/** 归类统计：返回按版本 / 年级 / 学科的计数（降序），用于界面上的快捷筛选 */
export function summarize(items) {
  const list = Array.isArray(items) ? items : []
  const tally = (field) => {
    const m = new Map()
    for (const it of list) {
      const k = it[field] || '其他'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }))
  }
  const times = list.map((x) => Number(x.time) || 0).filter(Boolean)
  return {
    total: list.length,
    editions: tally('edition'),
    grades: tally('grade'),
    subjects: tally('subject'),
    from: times.length ? formatDate(Math.min(...times)) : '',
    to: times.length ? formatDate(Math.max(...times)) : '',
  }
}

/* ============================================================
 * ⑤ 导出（CSV 带 BOM 防 Excel 乱码 / Markdown 便于贴进笔记）
 * ========================================================== */

export function toCsv(items) {
  const rows = [['日期', '标题', '教材版本', '年级', '学科', '链接']]
  for (const it of Array.isArray(items) ? items : []) {
    rows.push([it.date || '', it.title || '', it.edition || '', it.grade || '', it.subject || '', it.url || ''])
  }
  return '\uFEFF' + rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
}

export function toMarkdown(items, meta = {}) {
  const list = Array.isArray(items) ? items : []
  const head = []
  if (meta.title) head.push(`# ${meta.title}`, '')
  if (meta.account) head.push(`- 公众号：${meta.account}`)
  if (meta.albumId) head.push(`- 合集 ID：${meta.albumId}`)
  head.push(`- 文章数：${list.length}`)
  if (meta.query) head.push(`- 检索词：\`${meta.query}\``)
  if (meta.generatedAt) head.push(`- 生成时间：${meta.generatedAt}`)
  head.push('', '| 日期 | 标题 | 版本 | 年级 | 学科 | 链接 |', '| --- | --- | --- | --- | --- | --- |')
  for (const it of list) {
    head.push(`| ${it.date || ''} | ${escapeMd(it.title)} | ${it.edition || ''} | ${it.grade || ''} | ${it.subject || ''} | [打开](${it.url || ''}) |`)
  }
  return head.join('\n') + '\n'
}
const escapeMd = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|')

/* ============================================================
 * ⑥ 取数层（唯一会发网络请求的地方）
 * ========================================================== */

/**
 * 造一个取数器。三种模式：
 *   direct —— 直连目标域名（浏览器下通常被 CORS 拦，Node 下正常）
 *   proxy  —— 走用户自填的代理前缀；支持 `{url}` 占位符，否则按 `<proxy><encodeURIComponent(url)>` 拼接
 *   paste  —— 不发请求，调用即抛 paste-required（由调用方改用 parse* 解析用户粘贴的文本）
 * @param {{mode?:'direct'|'proxy'|'paste', proxy?:string, fetchImpl?:Function, timeout?:number}} cfg
 */
export function createFetcher(cfg = {}) {
  const mode = cfg.mode || 'direct'
  const proxy = String(cfg.proxy || '').trim()
  const timeout = Number(cfg.timeout) || 20000
  const fetchImpl = cfg.fetchImpl || (typeof fetch === 'function' ? fetch : null)

  const endpoint = (url) => {
    if (!proxy) return url
    return proxy.includes('{url}')
      ? proxy.replace('{url}', encodeURIComponent(url))
      : proxy + encodeURIComponent(url)
  }

  const getText = async (url) => {
    if (mode === 'paste') {
      const e = new Error('paste mode：不联网，请改用 parseArticleHtml / parseAlbumPayload 解析粘贴内容')
      e.code = 'paste-required'
      throw e
    }
    if (!fetchImpl) {
      const e = new Error('当前环境没有 fetch')
      e.code = 'no-fetch'
      throw e
    }
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null
    try {
      // 浏览器不允许脚本设 User-Agent（会被忽略）；Node 侧由 fetchImpl 调用方自行带
      const res = await fetchImpl(endpoint(url), {
        method: 'GET',
        credentials: 'omit',
        signal: ctrl ? ctrl.signal : undefined,
      })
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`)
        e.code = 'http'
        e.status = res.status
        throw e
      }
      return await res.text()
    } catch (err) {
      if (err && err.code) throw err
      // fetch 的 CORS 失败只抛 TypeError('Failed to fetch')，无法区分网络断/DNS/跨域
      const e = new Error(mode === 'direct' ? '请求被浏览器拦截（多半是 CORS）' : '请求失败：' + (err && err.message))
      e.code = mode === 'direct' ? 'cors' : 'network'
      throw e
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return { mode, proxy, getText, endpoint }
}

/** 把取数错误翻译成可操作的一句话（界面直接展示） */
export function explainFetchError(err, locale = 'zh-CN') {
  const code = (err && err.code) || 'network'
  const table = {
    cors: {
      'zh-CN': '浏览器直连被 CORS 拦截（mp.weixin.qq.com 不下发跨域头）。请改用「代理」模式填自己的转发前缀，或「粘贴」模式把页面源码粘进来；命令行版无此限制。',
      en: 'Blocked by CORS (mp.weixin.qq.com sends no CORS headers). Use proxy mode with your own forwarder, or paste the page source; the CLI has no such limit.',
    },
    http: {
      'zh-CN': '目标返回错误状态 {status}：链接可能已失效，或触发了微信的频率限制（隔一会儿再试）。',
      en: 'Target returned {status}: the link may be dead, or WeChat rate-limited you (retry later).',
    },
    network: {
      'zh-CN': '网络请求失败：检查代理地址是否可达。',
      en: 'Network request failed: check the proxy address.',
    },
    'paste-required': {
      'zh-CN': '当前是「粘贴」模式，不会联网。',
      en: 'Paste mode does not use the network.',
    },
    'no-fetch': { 'zh-CN': '当前环境没有 fetch。', en: 'No fetch in this environment.' },
  }
  const row = table[code] || table.network
  const text = row[locale] || row['zh-CN']
  return String(text).replace(/\{status\}/g, String((err && err.status) || ''))
}

/* ============================================================
 * ⑦ 高层编排：文章 → 合集 → 全量列表（分页 + 去重 + 限流保护）
 * ========================================================== */

/**
 * 从一篇已知文章解析出 { biz, albumId, albumTitle, account, title }。
 * @param {(url:string)=>Promise<string>} getText createFetcher().getText
 */
export async function resolveFromArticle(articleUrl, getText) {
  const ref = parseArticleRef(articleUrl)
  if (!ref.url) throw new Error('不是有效的公众号链接')
  const html = await getText(ref.url)
  const info = parseArticleHtml(html)
  if (!info.title) {
    const e = new Error(info.blocked
      ? '微信返回了反爬验证页（常见原因：链接缺 chksm 参数、或请求过快）。请用完整的分享链接重试，或稍后再试。'
      : '页面里没找到文章标题：链接可能已失效，或需要「在微信客户端打开」。')
    e.code = info.blocked ? 'blocked' : 'parse'
    throw e
  }
  return {
    article: info,
    biz: info.biz || ref.biz,
    albumId: info.album ? info.album.id : '',
    albumTitle: info.album ? info.album.title : '',
    ref,
  }
}

/**
 * 拉整本合集（自动翻页）。仅在拿不到 cursor 或达到 maxPages 时停。
 * @param {{biz,albumId,getText,maxPages?,count?,onPage?,delay?}} cfg  delay=翻页间隔(ms)，默认 1200
 * @returns {Promise<{items, pages, albumTitle, truncated}>}
 */
export async function fetchAlbum({ biz, albumId, getText, maxPages = 20, count = 10, onPage, delay = 1200 } = {}) {
  if (!biz || !albumId) throw new Error('缺少 biz 或 albumId')
  const all = []
  let cursor = null
  let pages = 0
  let title = ''
  let continueFlag = 1

  while (pages < maxPages && continueFlag) {
    const url = buildAlbumUrl({ biz, albumId, count, beginMsgid: cursor ? cursor.mid : '', beginItemidx: cursor ? cursor.idx : '' })
    const text = await getText(url)
    const page = parseAlbumPayload(text)
    pages++
    if (page.title && !title) title = page.title
    all.push(...page.items)
    continueFlag = page.continueFlag
    cursor = page.cursor
    if (onPage) onPage({ page: pages, got: page.items.length, total: all.length, continueFlag })
    if (!page.items.length || !cursor) break
    // 温和限速：微信对高频请求会返回空列表，1.2s 是实测较稳的间隔
    if (continueFlag) await sleep(delay)
  }

  return {
    items: dedupeArticles(all),
    pages,
    albumTitle: title,
    truncated: !!(continueFlag && pages >= maxPages),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ============================================================
 * ⑧ 小工具
 * ========================================================== */

export function formatDate(ts) {
  const n = Number(ts) || 0
  if (!n) return ''
  const d = new Date(n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function bodyOf(html) {
  const m = String(html || '').match(/<div[^>]+id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<script/i)
  return m ? m[1] : String(html || '')
}
function stripTags(s) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
}
function countChars(s) {
  const clean = String(s || '').replace(/&nbsp;/g, ' ').replace(/\s+/g, '')
  const cjk = (clean.match(/[\u3400-\u9fff]/g) || []).length
  const words = (clean.match(/[A-Za-z0-9]+/g) || []).length
  return cjk + words
}

/**
 * 只取合集标题（合集分页 JSON 不带 title，HTML 页里有）。
 * 已知文章链接时无需调用本函数——文章页里就有合集名。
 */
export async function fetchAlbumTitle({ biz, albumId, getText } = {}) {
  if (!biz || !albumId) return ''
  try {
    const html = await getText(buildAlbumUrl({ biz, albumId, f: '' }))
    return parseAlbumHtml(html).title || ''
  } catch {
    return ''
  }
}
