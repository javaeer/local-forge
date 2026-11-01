import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { NAV } from '../lib/nav.js'
import { T } from '../lib/i18n.dev.js'
import { locale } from '../lib/i18n.js'

// 路由级懒加载：各视图改为动态 import，首屏只加载 Home，
// ffmpeg / OCR 等重量视图在用户真正进入时才按需拉取，显著降低首屏 JS 体积。
const views = {
  Home: () => import('../views/Home.vue'),
  ZipCompress: () => import('../views/ZipCompress.vue'),
  ZipExtract: () => import('../views/ZipExtract.vue'),
  ArchiveTool: () => import('../views/ArchiveTool.vue'),
  MediaConvert: () => import('../views/MediaConvert.vue'),
  MediaPro: () => import('../views/MediaPro.vue'),
  ImageConvert: () => import('../views/ImageConvert.vue'),
  BatchQueue: () => import('../views/BatchQueue.vue'),
  DocConvert: () => import('../views/DocConvert.vue'),
  PdfTools: () => import('../views/PdfTools.vue'),
  PdfPro: () => import('../views/PdfPro.vue'),
  ShareFiles: () => import('../views/ShareFiles.vue'),
  PasswordRecovery: () => import('../views/PasswordRecovery.vue'),
  Repair: () => import('../views/Repair.vue'),
  QrCode: () => import('../views/QrCode.vue'),
  HashTool: () => import('../views/HashTool.vue'),
  ExifTool: () => import('../views/ExifTool.vue'),
  TextTool: () => import('../views/TextTool.vue'),
  OcrTool: () => import('../views/OcrTool.vue'),
  SvgTool: () => import('../views/SvgTool.vue'),
  CssReference: () => import('../views/CssReference.vue'),
  About: () => import('../views/About.vue'),
  Privacy: () => import('../views/Privacy.vue'),
}

// 视图文件名 -> 路由 path（与 NAV + SelfTestPanel 的 VIEW_ROUTES 保持一致）
const fileToPath = {
  'Home.vue': '/',
  'ZipCompress.vue': '/zip-compress',
  'ZipExtract.vue': '/zip-extract',
  'ArchiveTool.vue': '/archive',
  'MediaConvert.vue': '/media-convert',
  'MediaPro.vue': '/media-pro',
  'ImageConvert.vue': '/image-convert',
  'BatchQueue.vue': '/batch',
  'DocConvert.vue': '/doc-convert',
  'PdfTools.vue': '/pdf-tools',
  'PdfPro.vue': '/pdf-pro',
  'ShareFiles.vue': '/share-files',
  'PasswordRecovery.vue': '/password-recovery',
  'Repair.vue': '/repair',
  'QrCode.vue': '/qr-code',
  'HashTool.vue': '/hash',
  'ExifTool.vue': '/exif',
  'TextTool.vue': '/text',
  'OcrTool.vue': '/ocr',
  'SvgTool.vue': '/svg-tool',
  'CssReference.vue': '/css-reference',
  'About.vue': '/about',
  'Privacy.vue': '/privacy',
}

const navOf = (path) => NAV.find((n) => n.path === path) || {}

const routes = Object.entries(fileToPath).map(([file, path]) => ({
  path,
  name: path === '/' ? 'home' : path.slice(1),
  component: views[file.replace('.vue', '')],
  // 只存 key，真正的文案在渲染时按当前语言取（见 pageTitle）
  meta: { titleKey: navOf(path).titleKey || '', icon: navOf(path).icon || '' },
}))

// 页面标题按「当前语言」实时生成：LocalForge · <本地化标题>
export function pageTitle(routeLike) {
  const n = navOf((routeLike && routeLike.path) || '/')
  const label = n.titleKey ? T(n.titleKey) : (n.title || '')
  return label ? `LocalForge · ${label}` : 'LocalForge'
}

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

// 同步页面标题（导航时按当前语言渲染）
router.afterEach((to) => {
  document.title = pageTitle(to)
})

// SPA 内切换语言不会触发导航，这里补一次标题同步（afterEach 只在路由变化时跑）
watch(locale, () => {
  document.title = pageTitle(router.currentRoute.value)
})

export default router
