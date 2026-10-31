// 归档格式与压缩选项（驱动创建/转换/合并的格式选择器）
// 网页端可靠创建 = ZIP / TAR / TAR.GZ（自研写入器）；
// 7Z / ISO / XZ / ZST / BZ2 等创建需原版专有 WASM 模块，仅作解压源，不在此列。
export const CREATE_FORMATS = [
  { ext: 'zip', label: 'ZIP', note: '通用压缩包（支持密码/分卷）' },
  { ext: 'tar', label: 'TAR', note: '未压缩归档（USTAR）' },
  { ext: 'tar.gz', label: 'TAR.GZ', note: 'gzip 压缩' },
]

// TAR 仅支持 gzip 压缩；ZIP 内部恒用 DEFLATE。其余算法需专有 WASM，故仅列真实可用项。
export const COMPRESSIONS = [
  { id: 'NONE', label: '不压缩' },
  { id: 'GZIP', label: 'GZIP' },
]

// 工具目录（按能力归类，全部为本地已实现且可正常使用的功能，无死链）
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
      { to: '/archive?mode=create&fmt=tar', icon: 'bi-file-earmark', title: '创建 TAR', desc: '未压缩 tar 归档' },
      { to: '/archive?mode=create&fmt=tar.gz', icon: 'bi-file-earmark', title: '创建 TAR.GZ', desc: 'gzip 压缩归档' },
    ],
  },
  {
    group: '解压 / 提取',
    items: [
      { to: '/archive?mode=extract', icon: 'bi-archive', title: '多格式解压', desc: 'RAR/7Z/TAR/ISO/DNG/WIM/APK/IPSW… 200+ 格式' },
      { to: '/archive?mode=extract', icon: 'bi-file-earmark-zip', title: '打开加密 ZIP', desc: '输入密码解密解压' },
      { to: '/zip-extract', icon: 'bi-collection', title: '解压分卷 ZIP', desc: '一次拖入全部分卷自动合并解压' },
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
      { to: '/media-pro?tab=gif', icon: 'bi-film', title: '视频转 GIF', desc: '录屏/视频转表情包，可调帧率与宽度' },
      { to: '/media-pro?tab=audio', icon: 'bi-music-note-beamed', title: '提取音频', desc: '从视频扒出音轨，默认流拷贝无损' },
      { to: '/media-pro?tab=frames', icon: 'bi-images', title: '视频抽帧', desc: '按间隔导出图片并打包 ZIP' },
      { to: '/media-pro?tab=clip', icon: 'bi-scissors', title: '裁剪片段', desc: '只保留指定时间段，默认不重编码' },
    ],
  },
  {
    group: '图片',
    items: [
      { to: '/image-convert', icon: 'bi-image', title: '图片格式转换', desc: 'PNG/JPG/WEBP/AVIF 互转（浏览器原生解码）' },
      { to: '/image-convert?mode=compress', icon: 'bi-badge-ad', title: '压缩图片', desc: 'PNG 走 upng 有损量化保透明（类 TinyPNG），JPG/WEBP/AVIF 走原生编码' },
      { to: '/image-convert?mode=view', icon: 'bi-eye', title: '查看图片', desc: '本地预览，不出户' },
    ],
  },
  {
    group: '二维码 / 条码',
    items: [
      { to: '/qr-code', icon: 'bi-qr-code', title: '生成二维码', desc: '网址/WiFi/名片/邮件/短信/定位，支持 Logo、SVG、自定义配色' },
      { to: '/qr-code?tab=decode', icon: 'bi-upc-scan', title: '识别二维码', desc: '图片识别 · 摄像头扫码（ZXing-C++ WASM 本地内核）' },
      { to: '/qr-code?tab=batch', icon: 'bi-collection', title: '批量生成二维码', desc: '多行内容一次生成，自动打包为 ZIP' },
    ],
  },
  {
    group: '校验 / 隐私 / 文本',
    items: [
      { to: '/hash', icon: 'bi-shield-check', title: '文件哈希校验', desc: 'MD5/SHA-256/CRC32/BLAKE3… 核对下载文件是否被篡改' },
      { to: '/hash?tab=dup', icon: 'bi-copy', title: '重复文件查找', desc: '按内容（SHA-256）找出完全相同的冗余文件' },
      { to: '/exif', icon: 'bi-eraser', title: '照片隐私清理', desc: '查看并清除 GPS 定位、设备序列号与拍摄时间（画质无损）' },
      { to: '/text', icon: 'bi-code-slash', title: '文本 / 编码工具箱', desc: 'JSON · Base64 · JWT · 正则 · 时间戳 · UUID · 密码 · 摘要' },
      { to: '/ocr', icon: 'bi-card-text', title: 'OCR 图片转文字', desc: '截图 / 照片 / 扫描件提取文字（本地 Tesseract 内核）' },
      { to: '/ocr?tab=pdf', icon: 'bi-file-earmark-text', title: '扫描版 PDF 识别', desc: '逐页 OCR，支持页码范围与逐页打包 ZIP' },
    ],
  },
  {
    group: '文档 / PDF',
    items: [
      { to: '/pdf-tools?mode=compress', icon: 'bi-file-earmark-pdf', title: '压缩 PDF', desc: '重压缩内嵌图像减小体积' },
      { to: '/pdf-tools?mode=preview', icon: 'bi-eye', title: '预览 PDF', desc: '逐页渲染，本地查看' },
      { to: '/pdf-tools?mode=merge', icon: 'bi-intersect', title: '合并 PDF', desc: '将多个 PDF 合并为一个' },
      { to: '/pdf-tools?mode=split', icon: 'bi-scissors', title: '拆分 PDF', desc: '每页输出为独立 PDF' },
      { to: '/pdf-pro?tab=img2pdf', icon: 'bi-images', title: '图片转 PDF', desc: '多张截图/照片合成一份 PDF（可选 A4）' },
      { to: '/pdf-pro?tab=pdf2img', icon: 'bi-file-earmark-image', title: 'PDF 转图片', desc: '逐页渲染 PNG/JPG 并打包 ZIP' },
      { to: '/pdf-pro?tab=stamp', icon: 'bi-droplet', title: 'PDF 加中文水印', desc: '居中/平铺水印与页码，原文件不变' },
      { to: '/pdf-pro?tab=organize', icon: 'bi-fonts', title: 'PDF 提取文本', desc: '整册旋转、删页、提取文字与编辑元数据' },
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
  {
    group: '开发者工具',
    items: [
      { to: '/svg-tool', icon: 'bi-bounding-box', title: 'SVG 工具箱', desc: '压缩 / 格式化 / 缩放 / 重着色 / Base64 / 优化，纯本地' },
      { to: '/css-reference', icon: 'bi-palette', title: 'CSS 属性速查', desc: '选择器 / 布局 / 盒模型 / 视觉 / 文字 / 变换 / 动画' },
    ],
  },
]
