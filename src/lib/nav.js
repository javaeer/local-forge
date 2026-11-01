// 统一导航模型：侧边栏、命令面板(Ctrl/Cmd+K)、路由 meta 共用同一份数据源。
// 只收录"真实可达的路由"，不堆砌 query 变体，保证客户端可达性。
// title/short 保留中文默认值（回退与命令面板匹配用），i18n 通过 titleKey/shortKey 覆盖显示。
import { t } from './i18n.js'

export const NAV = [
  { path: '/', title: '首页', titleKey: 'nav.home', icon: 'bi-house', group: '常用', groupKey: 'group.common', keywords: 'home 首页 开始' },
  { path: '/zip-compress', title: '压缩为 ZIP', short: '压缩', titleKey: 'nav.zipCompress', shortKey: 'nav.zipCompressShort', icon: 'bi-file-earmark-zip', group: '压缩 / 归档', groupKey: 'group.archive', keywords: 'zip 压缩 打包 加密 aes 分卷' },
  { path: '/zip-extract', title: '解压 ZIP', short: '解压', titleKey: 'nav.zipExtract', shortKey: 'nav.zipExtractShort', icon: 'bi-door-open', group: '压缩 / 归档', groupKey: 'group.archive', keywords: 'zip 解压 解包 密码' },
  { path: '/archive', title: '归档工具箱', titleKey: 'nav.archive', icon: 'bi-archive', group: '压缩 / 归档', groupKey: 'group.archive', keywords: '7z rar tar iso 归档 合并 转换 解压' },
  { path: '/password-recovery', title: 'ZIP 密码恢复', titleKey: 'nav.passwordRecovery', icon: 'bi-key', group: '压缩 / 归档', groupKey: 'group.archive', keywords: 'zip 密码 恢复 字典 暴力' },
  { path: '/repair', title: '修复归档', titleKey: 'nav.repair', icon: 'bi-wrench', group: '压缩 / 归档', groupKey: 'group.archive', keywords: '修复 损坏 zip 7z rar' },
  { path: '/media-convert', title: '媒体转换', short: '媒体', titleKey: 'nav.mediaConvert', shortKey: 'nav.mediaConvertShort', icon: 'bi-arrow-left-right', group: '媒体', groupKey: 'group.media', keywords: '视频 音频 转换 mp4 webm mp3 wav ffmpeg' },
  { path: '/media-pro', title: '音视频进阶', titleKey: 'nav.mediaPro', icon: 'bi-film', group: '媒体', groupKey: 'group.media', keywords: 'gif 抽帧 裁剪 提取音频 音视频' },
  { path: '/image-convert', title: '图片工具', short: '图片', titleKey: 'nav.imageConvert', shortKey: 'nav.imageConvertShort', icon: 'bi-image', group: '图片', groupKey: 'group.image', keywords: '图片 格式 转换 png jpg webp avif 压缩 量化' },
  { path: '/batch', title: '批处理队列', short: '批量', titleKey: 'nav.batch', shortKey: 'nav.batchShort', icon: 'bi-list-task', group: '图片', groupKey: 'group.image', keywords: '批量 队列 多文件 批处理 压缩 转换 预设' },
  { path: '/pdf-tools', title: 'PDF 工具', short: 'PDF', titleKey: 'nav.pdfTools', shortKey: 'nav.pdfToolsShort', icon: 'bi-file-earmark-pdf', group: 'PDF', groupKey: 'group.pdf', keywords: 'pdf 压缩 合并 拆分 预览' },
  { path: '/pdf-pro', title: 'PDF 进阶', titleKey: 'nav.pdfPro', icon: 'bi-file-earmark-text', group: 'PDF', groupKey: 'group.pdf', keywords: 'pdf 图片转 水印 页码 提取 文本 元数据' },
  { path: '/qr-code', title: '二维码工具箱', short: '二维码', titleKey: 'nav.qrCode', shortKey: 'nav.qrCodeShort', icon: 'bi-qr-code', group: '二维码 / 识别', groupKey: 'group.qr', keywords: '二维码 条码 生成 识别 扫码 wifi 名片' },
  { path: '/ocr', title: 'OCR 文字识别', short: 'OCR', titleKey: 'nav.ocr', shortKey: 'nav.ocrShort', icon: 'bi-card-text', group: '二维码 / 识别', groupKey: 'group.qr', keywords: 'ocr 识别 文字 扫描件 图片转文字 tesseract' },
  { path: '/hash', title: '文件哈希校验', short: '哈希', titleKey: 'nav.hash', shortKey: 'nav.hashShort', icon: 'bi-shield-check', group: '校验 / 隐私', groupKey: 'group.verify', keywords: '哈希 hash md5 sha256 crc32 blake3 校验 重复 查重' },
  { path: '/exif', title: '照片隐私清理', titleKey: 'nav.exif', icon: 'bi-eraser', group: '校验 / 隐私', groupKey: 'group.verify', keywords: 'exif 隐私 gps 定位 清理 元数据 照片' },
  // 文本 / 编码工具箱：JSON · Base64 · JWT · 正则 · 时间戳 · UUID 均为开发者向能力，归入「开发者工具」
  { path: '/text', title: '文本 / 编码工具箱', titleKey: 'nav.text', icon: 'bi-code-slash', group: '开发者工具', groupKey: 'group.dev', keywords: '文本 json base64 jwt 正则 时间戳 uuid 密码 编码' },
  { path: '/doc-convert', title: '文档转换', short: '文档', titleKey: 'nav.docConvert', shortKey: 'nav.docConvertShort', icon: 'bi-file-earmark-arrow-down', group: '校验 / 隐私', groupKey: 'group.verify', keywords: 'markdown pdf html 文档 转换 导出 md' },
  { path: '/svg-tool', title: 'SVG 工具箱', short: 'SVG', titleKey: 'nav.svgTool', shortKey: 'nav.svgToolShort', icon: 'bi-bounding-box', group: '开发者工具', groupKey: 'group.dev', keywords: 'svg 压缩 格式化 缩放 重着色 base64 优化 图标 矢量' },
  { path: '/css-reference', title: 'CSS 速查表', short: 'CSS', titleKey: 'nav.cssReference', shortKey: 'nav.cssReferenceShort', icon: 'bi-palette', group: '开发者工具', groupKey: 'group.dev', keywords: 'css 速查 属性 选择器 布局 盒模型 动画 参考' },
  { path: '/share-files', title: 'P2P 分享文件', titleKey: 'nav.shareFiles', icon: 'bi-share', group: '分享 / 安全', groupKey: 'group.share', keywords: '分享 p2p webrtc 直传 点对点' },
  { path: '/about', title: '关于', titleKey: 'nav.about', icon: 'bi-info-circle', group: '关于', groupKey: 'group.about', keywords: 'about 关于 开源 技术栈' },
  { path: '/privacy', title: '隐私协议', titleKey: 'nav.privacy', icon: 'bi-shield-lock', group: '关于', groupKey: 'group.about', keywords: '隐私 privacy 协议 零上传' },
]

export const NAV_GROUPS = [
  '常用', '压缩 / 归档', '媒体', '图片', 'PDF', '二维码 / 识别', '校验 / 隐私', '分享 / 安全', '开发者工具', '关于',
]

export function navByPath(path) {
  return NAV.find((n) => n.path === path)
}

// i18n 辅助：优先用 i18n key，未接入时回退中文
export function navTitle(n) {
  if (!n) return ''
  return n.titleKey ? t(n.titleKey) : n.title
}
export function navShort(n) {
  if (!n) return ''
  if (n.shortKey) return t(n.shortKey)
  if (n.short) return n.short
  return navTitle(n).split(' ')[0]
}
export function groupLabel(g) {
  const item = NAV.find((n) => n.group === g)
  return item && item.groupKey ? t(item.groupKey) : g
}

// 移动端底部标签栏：只放最常用的 4 个主入口（其余走顶部搜索/命令面板）
export const TAB_ITEMS = ['/', '/zip-compress', '/image-convert', '/qr-code', '/ocr'].map(
  (p) => NAV.find((n) => n.path === p),
).filter(Boolean)

// 简单的"关键字 + 标题"模糊匹配，给命令面板用
export function searchNav(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return NAV
  const terms = q.split(/\s+/)
  return NAV
    .map((n) => {
      const hay = (n.title + ' ' + (n.keywords || '') + ' ' + n.group).toLowerCase()
      let score = 0
      for (const t of terms) {
        if (!hay.includes(t)) return null
        if (n.title.toLowerCase().includes(t)) score += 3
        if ((n.keywords || '').toLowerCase().includes(t)) score += 1
      }
      return { ...n, score }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
}
