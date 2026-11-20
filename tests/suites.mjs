// e2e 套件清单：唯一事实来源（tests/run.mjs 据此拉起服务、注入环境变量、串行执行）。
//
// 字段：
//   id      标识（--only / --skip 用）
//   file    脚本路径（相对仓库根），保持历史命名 _e2e_*.mjs，不搬家以免破坏贡献者习惯
//   server  'preview'（vite preview 4173，需先 build）| 'dev'（vite dev 5173，脚本内会 import('/src/...')）
//   group   'core'（CI 默认跑）| 'heavy'（慢 / 需特殊内核，本地或夜跑）
//   timeout 单套件超时（ms），超时强杀并记失败
//   desc    CI 输出里展示的说明
export const SUITES = [
  // —— core：快、稳，CI 默认跑 ——
  { id: 'i18n', file: '_e2e_i18n.mjs', server: 'preview', group: 'core', timeout: 300000, desc: '多语言 5 语种切换 + 本地化不变量（含首页 47 卡片 / 命令面板 / 本地化搜索）' },
  { id: 'layout', file: '_e2e_layout.mjs', server: 'preview', group: 'core', timeout: 180000, desc: '侧栏/顶栏/移动端布局切换 + 汉堡按钮三态 + 命令面板键盘导航' },
  { id: 'features', file: '_e2e_features.mjs', server: 'preview', group: 'core', timeout: 300000, desc: '核心功能端到端冒烟' },
  { id: 'qrcode', file: '_e2e_qrcode.mjs', server: 'preview', group: 'core', timeout: 240000, desc: '二维码生成 / 识别' },
  { id: 'progress', file: '_e2e_progress.mjs', server: 'preview', group: 'core', timeout: 180000, desc: '阶段化进度条' },
  { id: 'doc', file: '_e2e_doc.mjs', server: 'preview', group: 'core', timeout: 240000, desc: '文档转换（Markdown → PDF/HTML）' },
  { id: 'wechat', file: '_e2e_wechat.mjs', server: 'preview', group: 'core', timeout: 180000, desc: '公众号排版（产物结构 · 规范自检 · 多端输出 · 模板/草稿 · 零跨域请求）' },
  { id: 'wechatsearch', file: '_e2e_wechat_search.mjs', server: 'preview', group: 'core', timeout: 180000, desc: '公众号文章检索（合集解析 · 关键词过滤 · 原图改写 · 零跨域请求）' },
  { id: 'appicon', file: '_e2e_app_icon.mjs', server: 'preview', group: 'core', timeout: 180000, desc: 'App 图标生成器（尺寸预设 · 无 alpha 通道 · 裁剪/背景 · ZIP 下载 · 零跨域请求）' },
  { id: 'dictionary', file: '_e2e_dictionary.mjs', server: 'preview', group: 'core', timeout: 180000, desc: '离线词典（词库装载 · 五种检索 · 展开复制 · 首页卡片 · 零跨域请求）' },
  { id: 'tcmchants', file: '_e2e_tcm_chants.mjs', server: 'preview', group: 'core', timeout: 240000, desc: '中医药歌诀（八书浏览 · 检索高亮 · 挖空/首字/默写背诵 · 已会进度 · 五语言免责声明）' },
  { id: 'bencao', file: '_e2e_bencao.mjs', server: 'preview', group: 'core', timeout: 240000, desc: '本草纲目（17 组目录树 · 索引摘要 · 全量库下载/删除 · 分节导航 · 全文检索 · 双语免责声明）' },
  { id: 'tcmbooks', file: '_e2e_tcm_books.mjs', server: 'preview', group: 'core', timeout: 300000, desc: '方书与医经（九书 tab · 卷篇目录 · 全量库下载/删除 · Worker 全文检索 · 命中打开 · 双语免责声明）' },
  { id: 'classicsfull', file: '_e2e_classics_full.mjs', server: 'preview', group: 'core', timeout: 300000, desc: '诗文全量库（HTML 回退诊断 · 46 分片下载/删除 · Worker 全文检索 · 篇目阅读）' },
  { id: 'mediafetch', file: '_e2e_media_fetch.mjs', server: 'preview', group: 'core', timeout: 180000, desc: '媒体获取（直链解析 · 桥接拼接 · 空输入拦截 · 合并门槛 · 首页卡片 · 零外发请求）' },
  { id: 'batch', file: '_e2e_batch.mjs', server: 'preview', group: 'core', timeout: 240000, desc: '批处理队列' },
  { id: 'imagepro', file: '_e2e_imagepro.mjs', server: 'preview', group: 'core', timeout: 240000, desc: '音视频进阶（GIF/抽帧/裁剪）' },
  { id: 'offline', file: '_e2e_offline.mjs', server: 'preview', group: 'core', timeout: 300000, desc: '离线内核预缓存' },

  // —— heavy：慢 / 需特殊内核（ffmpeg 多线程、Tesseract OCR、大文件），本地或夜跑 ——
  { id: 'archive', file: '_e2e.mjs', server: 'dev', group: 'heavy', timeout: 900000, desc: '全引擎自检聚合（zip/tar/7z/ffmpeg/ocr…）' },
  { id: 'selftest', file: '_e2e_selftest.mjs', server: 'dev', group: 'heavy', timeout: 900000, desc: '页面自检面板全模块' },
  { id: 'ocr', file: '_e2e_ocr.mjs', server: 'preview', group: 'heavy', timeout: 600000, desc: 'OCR 图片转文字（Tesseract WASM）' },
  { id: 'largefile', file: '_e2e_largefile.mjs', server: 'preview', group: 'heavy', timeout: 600000, desc: '大文件分块 IO / 内存门禁' },
  { id: 'media', file: '_e2e_media.mjs', server: 'dev', group: 'heavy', timeout: 300000, desc: 'ffmpeg 媒体内核（单线程）+ 已补全断言' },
  { id: 'media2', file: '_e2e_media2.mjs', server: 'dev', group: 'heavy', timeout: 300000, desc: 'ffmpeg 媒体内核（多线程）' },
  { id: 'image', file: '_e2e_image.mjs', server: 'dev', group: 'heavy', timeout: 300000, desc: '图片压缩/格式转换内核' },
  { id: 'image_component', file: '_e2e_image_component.mjs', server: 'dev', group: 'heavy', timeout: 240000, desc: '图片组件 UI 交互' },
]
