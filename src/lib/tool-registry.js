// LocalForge Tool Registry —— 工具事实来源（权威层）。
//
// 设计原则（对应《施工图-Tool Registry渐进迁移》R1/R2）：
//   1. 不新建第二套独立对象：以「真实路由」为工具实体（34 条），nav.js / router /
//      CommandPalette / offline 面板逐步由本模块派生或校验，而不是各存一份。
//   2. 首页 55 张卡是这些路由的 query 变体呈现（见 formats.js），卡数 > 路由数属正常；
//      一致性由护栏断言 J 校验（每张卡的 base path 必须能在 Registry 反查到）。
//   3. 零依赖：本模块不 import i18n / nav / formats，避免循环依赖；翻译由消费方按 key 完成。
//
// 字段（14 项，TOOL_FIELDS）：id, route, title, titleKey, descKey, icon, workspace,
// keywords, status, engine, networkPolicy, offlineLevel, resourceIds, supportedBrowsers。
// 额外兼容字段：path（= route，供命令面板/导航直接消费）、short / shortKey（导航短名）。
//
// status 取值：'stable' | 'beta' | 'pro'。
//   - 'stable' / 'beta'：开源版工具（当前 34 条均为 stable/beta）。
//   - 'pro'：为私有 Pro 版预留的标记。私有版可按同样 14 字段结构注册 Pro 工具，
//     标记 status:'pro' 后用 isProTool() 识别；开源版不注册任何 pro 工具，
//     功能门默认实现见 src/lib/pro-gate.js（替换该文件即可接入授权）。

export const TOOL_FIELDS = [
  'id', 'route', 'title', 'titleKey', 'descKey', 'icon', 'workspace',
  'keywords', 'status', 'engine', 'networkPolicy', 'offlineLevel',
  'resourceIds', 'supportedBrowsers',
]

// 分组顺序与中文名：由 workspace 派生 groupKey('group.'+workspace) 与 group 中文值。
// 顺序保持与原 nav.js 的 NAV_GROUPS 完全一致，避免侧栏顺序漂移。
export const WORKSPACE_ORDER = [
  'common', 'archive', 'media', 'image', 'pdf',
  'qr', 'verify', 'share', 'lookup', 'dev', 'about',
]
export const GROUP_ZH = {
  common: '常用', archive: '压缩 / 归档', media: '媒体', image: '图片', pdf: 'PDF',
  qr: '二维码 / 识别', verify: '校验 / 隐私', share: '分享 / 安全',
  lookup: '知识矿藏', dev: '开发者工序', about: '关于',
}

const ALL_BROWSERS = ['chromium', 'firefox', 'safari', 'edge']

// 34 条真实路由，每行一条（护栏 J 按行静态解析，务必保持单行且 14 字段齐全）。
// title/keywords/short 保留原 nav.js 中文值（回退与命令面板匹配用）；i18n 显示走 titleKey。
export const RAW_TOOLS = [
  { id: 'home', route: '/', path: '/', workspace: 'common', title: '首页', titleKey: 'nav.home', descKey: '', short: '', shortKey: '', icon: 'bi-house', keywords: 'home 首页 开始', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'zip-compress', route: '/zip-compress', path: '/zip-compress', workspace: 'archive', title: '压缩为 ZIP', titleKey: 'nav.zipCompress', descKey: 'home.d.zipCompress', short: '压缩', shortKey: 'nav.zipCompressShort', icon: 'bi-file-earmark-zip', keywords: 'zip 压缩 打包 加密 aes 分卷', status: 'stable', engine: 'zipjs', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: ['archive'], supportedBrowsers: ALL_BROWSERS },
  { id: 'zip-extract', route: '/zip-extract', path: '/zip-extract', workspace: 'archive', title: '解压 ZIP', titleKey: 'nav.zipExtract', descKey: 'home.d.zipExtract', short: '解压', shortKey: 'nav.zipExtractShort', icon: 'bi-door-open', keywords: 'zip 解压 解包 密码', status: 'stable', engine: 'zipjs', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: ['archive'], supportedBrowsers: ALL_BROWSERS },
  { id: 'archive', route: '/archive', path: '/archive', workspace: 'archive', title: '归档工具箱', titleKey: 'nav.archive', descKey: 'home.d.archiveMerge', short: '', shortKey: '', icon: 'bi-archive', keywords: '7z rar tar iso 归档 合并 转换 解压', status: 'stable', engine: 'libarchive', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: ['archive'], supportedBrowsers: ALL_BROWSERS },
  { id: 'password-recovery', route: '/password-recovery', path: '/password-recovery', workspace: 'archive', title: 'ZIP 密码恢复', titleKey: 'nav.passwordRecovery', descKey: 'home.d.zipRecover', short: '', shortKey: '', icon: 'bi-key', keywords: 'zip 密码 恢复 字典 暴力', status: 'stable', engine: 'zipjs', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: ['archive'], supportedBrowsers: ALL_BROWSERS },
  { id: 'repair', route: '/repair', path: '/repair', workspace: 'archive', title: '修复归档', titleKey: 'nav.repair', descKey: 'home.d.archiveRepair', short: '', shortKey: '', icon: 'bi-wrench', keywords: '修复 损坏 zip 7z rar', status: 'stable', engine: 'libarchive', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: ['archive'], supportedBrowsers: ALL_BROWSERS },
  { id: 'media-convert', route: '/media-convert', path: '/media-convert', workspace: 'media', title: '媒体转换', titleKey: 'nav.mediaConvert', descKey: 'home.d.mediaConvert', short: '媒体', shortKey: 'nav.mediaConvertShort', icon: 'bi-arrow-left-right', keywords: '视频 音频 转换 mp4 webm mp3 wav ffmpeg', status: 'stable', engine: 'ffmpeg', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['media', 'media-st'], supportedBrowsers: ALL_BROWSERS },
  { id: 'media-pro', route: '/media-pro', path: '/media-pro', workspace: 'media', title: '音视频进阶', titleKey: 'nav.mediaPro', descKey: 'home.d.videoGif', short: '', shortKey: '', icon: 'bi-film', keywords: 'gif 抽帧 裁剪 提取音频 音视频', status: 'stable', engine: 'ffmpeg', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['media', 'media-st'], supportedBrowsers: ALL_BROWSERS },
  { id: 'media-fetch', route: '/media-fetch', path: '/media-fetch', workspace: 'media', title: '媒体获取', titleKey: 'nav.mediaFetch', descKey: 'home.d.mediaFetch', short: '获取', shortKey: 'nav.mediaFetchShort', icon: 'bi-cloud-download', keywords: '媒体 获取 拉取 直链 m3u8 分片 合并 桥接 跨域 音视频 下载', status: 'beta', engine: 'pure-js', networkPolicy: 'optional-bridge', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'image-convert', route: '/image-convert', path: '/image-convert', workspace: 'image', title: '图片工具', titleKey: 'nav.imageConvert', descKey: 'home.d.imgConvert', short: '图片', shortKey: 'nav.imageConvertShort', icon: 'bi-image', keywords: '图片 格式 转换 png jpg webp avif 压缩 量化', status: 'stable', engine: 'browser', networkPolicy: 'local-only', offlineLevel: 'cached', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'app-icon', route: '/app-icon', path: '/app-icon', workspace: 'image', title: 'App 图标生成器', titleKey: 'nav.appIcon', descKey: 'home.d.appIcon', short: 'App 图标', shortKey: 'nav.appIconShort', icon: 'bi-app-indicator', keywords: 'app 图标 icon logo 尺寸 appstore googleplay ios android 1024 512 上架 素材', status: 'stable', engine: 'browser', networkPolicy: 'local-only', offlineLevel: 'cached', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'batch', route: '/batch', path: '/batch', workspace: 'image', title: '批处理队列', titleKey: 'nav.batch', descKey: '', short: '批量', shortKey: 'nav.batchShort', icon: 'bi-list-task', keywords: '批量 队列 多文件 批处理 压缩 转换 预设', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'pdf-tools', route: '/pdf-tools', path: '/pdf-tools', workspace: 'pdf', title: 'PDF 工具', titleKey: 'nav.pdfTools', descKey: 'home.d.pdfCompress', short: 'PDF', shortKey: 'nav.pdfToolsShort', icon: 'bi-file-earmark-pdf', keywords: 'pdf 压缩 合并 拆分 预览', status: 'stable', engine: 'pdfjs', networkPolicy: 'local-only', offlineLevel: 'cached', resourceIds: ['pdf'], supportedBrowsers: ALL_BROWSERS },
  { id: 'pdf-pro', route: '/pdf-pro', path: '/pdf-pro', workspace: 'pdf', title: 'PDF 进阶', titleKey: 'nav.pdfPro', descKey: 'home.d.img2pdf', short: '', shortKey: '', icon: 'bi-file-earmark-text', keywords: 'pdf 图片转 水印 页码 提取 文本 元数据', status: 'stable', engine: 'pdfjs', networkPolicy: 'local-only', offlineLevel: 'cached', resourceIds: ['pdf'], supportedBrowsers: ALL_BROWSERS },
  { id: 'qr-code', route: '/qr-code', path: '/qr-code', workspace: 'qr', title: '二维码工具箱', titleKey: 'nav.qrCode', descKey: 'home.d.qrGen', short: '二维码', shortKey: 'nav.qrCodeShort', icon: 'bi-qr-code', keywords: '二维码 条码 生成 识别 扫码 wifi 名片', status: 'stable', engine: 'zxing', networkPolicy: 'local-only', offlineLevel: 'cached', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'ocr', route: '/ocr', path: '/ocr', workspace: 'qr', title: 'OCR 文字识别', titleKey: 'nav.ocr', descKey: 'home.d.ocrImage', short: 'OCR', shortKey: 'nav.ocrShort', icon: 'bi-card-text', keywords: 'ocr 识别 文字 扫描件 图片转文字 tesseract', status: 'stable', engine: 'tesseract', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['ocr', 'ocr-lang'], supportedBrowsers: ALL_BROWSERS },
  { id: 'hash', route: '/hash', path: '/hash', workspace: 'verify', title: '文件哈希校验', titleKey: 'nav.hash', descKey: 'home.d.hashCheck', short: '哈希', shortKey: 'nav.hashShort', icon: 'bi-shield-check', keywords: '哈希 hash md5 sha256 crc32 blake3 校验 重复 查重', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'exif', route: '/exif', path: '/exif', workspace: 'verify', title: '照片隐私清理', titleKey: 'nav.exif', descKey: 'home.d.exifClean', short: '', shortKey: '', icon: 'bi-eraser', keywords: 'exif 隐私 gps 定位 清理 元数据 照片', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'text', route: '/text', path: '/text', workspace: 'dev', title: '文本 / 编码工具箱', titleKey: 'nav.text', descKey: 'home.d.textTool', short: '', shortKey: '', icon: 'bi-code-slash', keywords: '文本 json base64 jwt 正则 时间戳 uuid 密码 编码', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'doc-convert', route: '/doc-convert', path: '/doc-convert', workspace: 'dev', title: '文档转换', titleKey: 'nav.docConvert', descKey: '', short: '文档', shortKey: 'nav.docConvertShort', icon: 'bi-file-earmark-arrow-down', keywords: 'markdown pdf html 文档 转换 导出 md', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'wechat-article', route: '/wechat-article', path: '/wechat-article', workspace: 'dev', title: '公众号排版', titleKey: 'nav.wechatArticle', descKey: 'home.d.wechatArticle', short: '公众号', shortKey: 'nav.wechatArticleShort', icon: 'bi-wechat', keywords: 'markdown 微信 公众号 排版 内联样式 剪贴板 刊头 wechat mp 图文', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'wechat-search', route: '/wechat-search', path: '/wechat-search', workspace: 'dev', title: '公众号检索', titleKey: 'nav.wechatSearch', descKey: '', short: '检索', shortKey: 'nav.wechatSearchShort', icon: 'bi-search', keywords: '公众号 检索 搜索 合集 album 文章列表 导出 冀教版 版本 wechat search', status: 'beta', engine: 'pure-js', networkPolicy: 'optional-bridge', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'svg-tool', route: '/svg-tool', path: '/svg-tool', workspace: 'dev', title: 'SVG 工具箱', titleKey: 'nav.svgTool', descKey: 'home.d.svgTool', short: 'SVG', shortKey: 'nav.svgToolShort', icon: 'bi-bounding-box', keywords: 'svg 压缩 格式化 缩放 重着色 base64 优化 图标 矢量', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'css-reference', route: '/css-reference', path: '/css-reference', workspace: 'dev', title: 'CSS 速查表', titleKey: 'nav.cssReference', descKey: 'home.d.cssRef', short: 'CSS', shortKey: 'nav.cssReferenceShort', icon: 'bi-palette', keywords: 'css 速查 属性 选择器 布局 盒模型 动画 参考', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'dictionary', route: '/dictionary', path: '/dictionary', workspace: 'lookup', title: '离线词典', titleKey: 'nav.dict', descKey: 'home.d.dict', short: '词典', shortKey: 'nav.dictShort', icon: 'bi-book', keywords: '词典 字典 查词 汉字 拼音 部首 释义 dictionary cedict 离线 cc-cedict 新华 英汉', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['dict', 'dict-en'], supportedBrowsers: ALL_BROWSERS },
  { id: 'poem-meter', route: '/poem-meter', path: '/poem-meter', workspace: 'lookup', title: '近体诗格律', titleKey: 'nav.poemMeter', descKey: 'home.d.poemMeter', short: '格律', shortKey: 'nav.poemMeterShort', icon: 'bi-rulers', keywords: '诗 词 格律 平仄 押韵 平水韵 韵部 绝句 律诗 唐诗 宋词 近体诗 孤平 三平调 拗救 校勘', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['classics', 'classics-full'], supportedBrowsers: ALL_BROWSERS },
  { id: 'ci-meter', route: '/ci-meter', path: '/ci-meter', workspace: 'lookup', title: '词牌格律', titleKey: 'nav.ciMeter', descKey: 'home.d.ciMeter', short: '词律', shortKey: 'nav.ciMeterShort', icon: 'bi-music-note-list', keywords: '词 词牌 词谱 填词 平仄 押韵 词林正韵 宋词 水调歌头 念奴娇 如梦令 钦定词谱 格律 校勘', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['classics', 'classics-full'], supportedBrowsers: ALL_BROWSERS },
  { id: 'classics', route: '/classics', path: '/classics', workspace: 'lookup', title: '诗文精选', titleKey: 'nav.classics', descKey: 'home.d.classics', short: '诗文', shortKey: 'nav.classicsShort', icon: 'bi-journal-bookmark', keywords: '唐诗 宋词 古文观止 唐诗三百首 宋词三百首 古诗 古文 选集 竖排 卡片 阅读 检索 名篇 静夜思 春望 岳阳楼记', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['classics', 'classics-full'], supportedBrowsers: ALL_BROWSERS },
  { id: 'chants', route: '/chants', path: '/chants', workspace: 'lookup', title: '中医药歌诀', titleKey: 'nav.tcmChants', descKey: 'home.d.tcmChants', short: '歌诀', shortKey: 'nav.tcmChantsShort', icon: 'bi-capsule', keywords: '中医 中医药 歌诀 汤头歌诀 濒湖脉学 药性歌括四百味 药性赋 医学三字经 长沙方歌括 金匮方歌括 时方歌括 背诵 默写 挖空 方歌 脉诀 tcm medicine mnemonic', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['tcm'], supportedBrowsers: ALL_BROWSERS },
  { id: 'bencao', route: '/bencao', path: '/bencao', workspace: 'lookup', title: '本草纲目', titleKey: 'nav.bencao', descKey: 'home.d.bencao', short: '本草', shortKey: 'nav.bencaoShort', icon: 'bi-flower1', keywords: '本草纲目 李时珍 中药 本草 药物 主治 气味 释名 集解 附方 发明 明代 bencao materia medica li shizhen', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['tcm'], supportedBrowsers: ALL_BROWSERS },
  { id: 'tcmbooks', route: '/tcmbooks', path: '/tcmbooks', workspace: 'lookup', title: '中医医典', titleKey: 'nav.tcmBooks', descKey: 'home.d.tcmBooks', short: '医典', shortKey: 'nav.tcmBooksShort', icon: 'bi-journal-medical', keywords: '中医 医典 方书 医经 千金要方 千金翼方 外台秘要 肘后备急方 黄帝内经 素问 伤寒论 金匮要略 神农本草经 本草备要 孙思邈 张仲景 葛洪 王焘 汪昂 篇章 全文检索 tcm classics', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'full-library-required', resourceIds: ['tcm'], supportedBrowsers: ALL_BROWSERS },
  { id: 'share-files', route: '/share-files', path: '/share-files', workspace: 'share', title: 'P2P 分享文件', titleKey: 'nav.shareFiles', descKey: 'home.d.p2pShare', short: '', shortKey: '', icon: 'bi-share', keywords: '分享 p2p webrtc 直传 点对点', status: 'stable', engine: 'webrtc', networkPolicy: 'optional-bridge', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'about', route: '/about', path: '/about', workspace: 'about', title: '关于', titleKey: 'nav.about', descKey: '', short: '', shortKey: '', icon: 'bi-info-circle', keywords: 'about 关于 开源 技术栈', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
  { id: 'privacy', route: '/privacy', path: '/privacy', workspace: 'about', title: '隐私协议', titleKey: 'nav.privacy', descKey: '', short: '', shortKey: '', icon: 'bi-shield-lock', keywords: '隐私 privacy 协议 零上传', status: 'stable', engine: 'pure-js', networkPolicy: 'local-only', offlineLevel: 'core', resourceIds: [], supportedBrowsers: ALL_BROWSERS },
]

// 派生兼容字段：group / groupKey 由 workspace 推导，避免第二份中文映射。
function decorate(r) {
  return { ...r, group: GROUP_ZH[r.workspace] || r.workspace, groupKey: 'group.' + r.workspace }
}

export const TOOLS_REGISTRY = RAW_TOOLS.map(decorate)

const BY_ID = new Map(TOOLS_REGISTRY.map((t) => [t.id, t]))
const BY_ROUTE = new Map(TOOLS_REGISTRY.map((t) => [t.route, t]))

export function allTools() { return TOOLS_REGISTRY }

// 私有化接缝：识别 Pro 工具（status === 'pro'）。
// 开源版当前无 pro 工具，恒返回空数组；私有版注册 Pro 工具后可据此分组/门控。
export function isProTool(t) { return !!(t && t.status === 'pro') }
export function proTools() { return TOOLS_REGISTRY.filter(isProTool) }
export function freeTools() { return TOOLS_REGISTRY.filter((t) => !isProTool(t)) }

export function getTool(idOrRoute) {
  return BY_ID.get(idOrRoute) || BY_ROUTE.get(idOrRoute) || null
}
export function getByRoute(route) { return BY_ROUTE.get(route) || null }
export function toolsByWorkspace(workspace) {
  return TOOLS_REGISTRY.filter((t) => t.workspace === workspace)
}
export function navGroups() {
  // 返回中文分组名（与 NAV[].group 一致），顺序按 WORKSPACE_ORDER。
  return WORKSPACE_ORDER
    .filter((w) => TOOLS_REGISTRY.some((t) => t.workspace === w))
    .map((w) => GROUP_ZH[w])
}

// NAV 兼容视图（供 nav.js 直接再导出）：字段与原 nav.js 逐一对齐。
export const NAV_VIEW = TOOLS_REGISTRY.map((t) => ({
  path: t.route, title: t.title, short: t.short || '', titleKey: t.titleKey,
  shortKey: t.shortKey || '', icon: t.icon, group: t.group, groupKey: t.groupKey,
  keywords: t.keywords,
}))

// 命令面板检索：从 Registry 派生，不再单独维护 NAV 检索索引。
// labelOf(record) 由调用方注入当前语言的标题/分组名，保证非中文界面也能按屏幕文字搜到。
export function searchTools(query, labelOf = () => '') {
  const q = (query || '').trim().toLowerCase()
  if (!q) return TOOLS_REGISTRY
  const terms = q.split(/\s+/)
  return TOOLS_REGISTRY
    .map((r) => {
      const extra = labelOf(r) || ''
      const hay = [r.title, r.short || '', r.titleKey, r.keywords || '', r.group, r.route, extra]
        .join(' ').toLowerCase()
      for (const term of terms) if (!hay.includes(term)) return null
      let score = 0
      for (const term of terms) {
        if ((r.title || '').toLowerCase().includes(term)) score += 3
        if (extra.toLowerCase().includes(term)) score += 3
        if ((r.keywords || '').toLowerCase().includes(term)) score += 1
      }
      return { ...r, score }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
}

// 运行时校验（供测试/控制台自检）：14 字段齐全、id/route 唯一、resourceIds 合法。
export function validateRegistry(validResourceIds = null) {
  const errors = []
  const ids = new Set(), routes = new Set()
  for (const t of TOOLS_REGISTRY) {
    for (const f of TOOL_FIELDS) {
      if (!(f in t)) { errors.push(`${t.id}: 缺字段 ${f}`); continue }
      if (f !== 'resourceIds' && f !== 'supportedBrowsers' && typeof t[f] !== 'string') {
        errors.push(`${t.id}: 字段 ${f} 非字符串`)
      }
    }
    if (ids.has(t.id)) errors.push(`重复 id：${t.id}`)
    ids.add(t.id)
    if (routes.has(t.route)) errors.push(`重复 route：${t.route}`)
    routes.add(t.route)
    if (validResourceIds) {
      for (const rid of t.resourceIds) {
        if (!validResourceIds.includes(rid)) errors.push(`${t.id}: 未知资源 ${rid}`)
      }
    }
  }
  return errors
}
