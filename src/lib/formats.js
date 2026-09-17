// 归档格式与压缩选项（驱动创建/转换/合并的格式选择器）
// 网页端可靠创建 = ZIP / TAR / TAR.GZ（自研写入器）；
// 7Z / ISO / XZ / ZST / BZ2 等需原版专有 WASM 模块，仅作解压源，不在此列。
export const CREATE_FORMATS = [
  { ext: 'zip', label: 'ZIP', note: '通用压缩包（支持密码/分卷）' },
  { ext: 'tar', label: 'TAR', note: '未压缩归档（USTAR）' },
  { ext: 'tar.gz', label: 'TAR.GZ', note: 'gzip 压缩' },
]

export const COMPRESSIONS = [
  { id: 'NONE', label: '不压缩' },
  { id: 'GZIP', label: 'GZIP' },
  { id: 'BZIP2', label: 'BZIP2' },
  { id: 'XZ', label: 'XZ' },
  { id: 'ZSTD', label: 'ZSTD' },
  { id: 'LZMA', label: 'LZMA' },
  { id: 'LZ4', label: 'LZ4' },
  { id: 'LRZIP', label: 'LRZIP' },
]

// ezyzip.pro 完整工具目录（按能力归类，全部可纯前端实现）
export const TOOLS = [
  {
    group: 'ZIP 工具箱',
    items: [
      { to: '/zip-compress', icon: 'bi-file-earmark-zip', title: '压缩为 ZIP', desc: '多文件/文件夹打包，支持 AES 密码、压缩级别' },
      { to: '/zip-compress?split=1', icon: 'bi-scissors', title: '拆分 ZIP（分卷）', desc: '按指定大小切分为多卷 ZIP' },
      { to: '/zip-compress?password=1', icon: 'bi-lock', title: '密码保护 ZIP', desc: '用 AES-256 加密保护 ZIP' },
      { to: '/zip-extract', icon: 'bi-door-open', title: '解压 ZIP', desc: '列出条目、单文件/全部下载，支持加密与分卷' },
      { to: '/archive?mode=merge', icon: 'bi-intersect', title: '合并归档', desc: '将多个归档合并为一个' },
      { to: '/archive?mode=convert&to=zip', icon: 'bi-arrow-down-up', title: '转换归档为 ZIP', desc: '7Z/RAR/TAR/APK… 转 ZIP' },
    ],
  },
  {
    group: '创建归档',
    items: [
      { to: '/archive?mode=create&fmt=7z', icon: 'bi-file-earmark-binary', title: '创建 7Z', desc: '7-Zip 高压缩归档' },
      { to: '/archive?mode=create&fmt=tar', icon: 'bi-file-earmark', title: '创建 TAR', desc: '未压缩 tar 归档' },
      { to: '/archive?mode=create&fmt=tar.gz', icon: 'bi-file-earmark', title: '创建 TAR.GZ', desc: 'gzip 压缩归档' },
      { to: '/archive?mode=create&fmt=iso', icon: 'bi-disc', title: '创建 ISO', desc: '光盘镜像文件' },
      { to: '/archive?mode=create&fmt=tar.xz', icon: 'bi-file-earmark', title: '创建 TAR.XZ', desc: 'xz 压缩归档' },
      { to: '/archive?mode=create&fmt=tar.zst', icon: 'bi-file-earmark', title: '创建 TAR.ZST', desc: 'zstd 压缩归档' },
    ],
  },
  {
    group: '解压 / 提取',
    items: [
      { to: '/archive?mode=extract', icon: 'bi-archive', title: '多格式解压', desc: 'RAR/7Z/TAR/ISO/DNG/WIM/APK/IPSW… 200+ 格式' },
      { to: '/archive?mode=extract', icon: 'bi-file-earmark-zip', title: '打开加密 ZIP', desc: '输入密码解密解压' },
      { to: '/archive?mode=extract', icon: 'bi-collection', title: '解压分卷 ZIP', desc: '先合并多卷再解压' },
      { to: '/archive?mode=extract', icon: 'bi-phone', title: '提取 APK/JAR', desc: 'Android / Java 包解包' },
      { to: '/archive?mode=extract', icon: 'bi-apple', title: '提取 DMG/IPSW', desc: 'macOS / iOS 镜像提取' },
    ],
  },
  {
    group: '媒体转换',
    items: [
      { to: '/media-convert', icon: 'bi-arrow-left-right', title: '音视频转换', desc: 'MP4/WebM/MOV/MP3/WAV 互转（ffmpeg 多线程）' },
      { to: '/media-convert?mode=compress', icon: 'bi-speedometer2', title: '压缩媒体', desc: '降低码率缩小体积' },
      { to: '/media-convert?mode=zip', icon: 'bi-music-note', title: 'ZIP → MP3/MP4', desc: '从压缩包内提取媒体' },
    ],
  },
  {
    group: '图片',
    items: [
      { to: '/image-convert', icon: 'bi-image', title: '图片格式转换', desc: 'PNG/JPG/WEBP/AVIF/HEIC 互转' },
      { to: '/image-convert?mode=compress', icon: 'bi-badge-ad', title: '压缩图片', desc: '有损/无损缩小体积' },
      { to: '/image-convert?mode=view', icon: 'bi-eye', title: '查看图片', desc: '本地预览，不出户' },
    ],
  },
  {
    group: '文档 / PDF',
    items: [
      { to: '/pdf-tools?mode=compress', icon: 'bi-file-earmark-pdf', title: '压缩 PDF', desc: '重压缩内嵌图像减小体积' },
      { to: '/pdf-tools?mode=convert', icon: 'bi-file-earmark-text', title: '文档转换', desc: 'PDF 与常见文档互转' },
    ],
  },
  {
    group: '分享 / 安全',
    items: [
      { to: '/share-files', icon: 'bi-share', title: 'P2P 分享文件', desc: 'WebRTC 点对点直传，不经服务器' },
      { to: '/password-recovery', icon: 'bi-key', title: 'ZIP 密码恢复', desc: '本地字典/暴力尝试（AES）' },
      { to: '/repair', icon: 'bi-wrench', title: '修复归档', desc: '尽力修复损坏的 ZIP/7Z/RAR' },
    ],
  },
]
