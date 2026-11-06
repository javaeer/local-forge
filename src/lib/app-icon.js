// App 图标多尺寸生成器 · 零依赖纯内核（Node 可直接单测，不依赖 DOM / 不联网）。
//
// 设计要点（见 /workspace/App图标生成器_集成可行性分析.md）：
//  1) 一次解码 → N 次缩放：源 ImageData 只解码一次，所有尺寸复用同一份像素，保证裁剪决策一致。
//  2) App Store 1024 图标强制「不含 alpha 通道」（ITMS-90717）。Canvas / 普通 PNG 编码即使
//     所有像素不透明也常输出 colorType=6(RGBA)，会被机器校验拒收。这里统一走
//     UPNG.encode(..., forbidPlte=true)：全不透明数据输出 colorType=2(RGB)，彻底无 alpha 通道。
//  3) 缩放用纯 JS 面积平均（box filter）下采样，避免大比例缩小时的混叠；不依赖 Canvas，
//     因此「尺寸精确 / 无 alpha / 背景合成 / PNG 编码 / ZIP」整条链路都能在 Node 单测里验证。
//  4) 明确边界：不生成 Adaptive Icon 分层、不生成 Xcode Asset Catalog / Android 资源工程，
//     只输出命名清晰的扁平 PNG 包（与 DevCove 同类工具一致）。
import UPNG from 'upng-js'
import { buildStoreZip, zipEntry } from './wechat-extra.js'

// ---------- 尺寸预设表（纯数据，平台规范事实） ----------
// size      精确像素（正方形，机器校验差 1px 即拒）
// name      稳定 ASCII 文件名，避免旧解压工具 mojibake
// opaque    true = 产物必须不含 alpha 通道（App Store / iOS / Android 均建议实色）
// maxBytes  体积上限（Google Play 512 为 1024 KB），0 = 不限制
// required  不可取消勾选（App Store 1024 是上架唯一硬性图标）
const P = (id, group, size, name, platform, extra = {}) => ({
  id, group, size, name, platform,
  opaque: true, maxBytes: 0, defaultOn: true, required: false, ...extra,
})

export const ICON_GROUPS = [
  { id: 'store', labelKey: 'views.appIcon.groupStore', hintKey: 'views.appIcon.groupStoreHint', defaultOn: true },
  { id: 'ios', labelKey: 'views.appIcon.groupIos', hintKey: 'views.appIcon.groupIosHint', defaultOn: false },
  { id: 'android', labelKey: 'views.appIcon.groupAndroid', hintKey: 'views.appIcon.groupAndroidHint', defaultOn: true },
]

export const ICON_PRESETS = [
  // 应用商店：App Store 必须完全不透明；Google Play 允许 alpha（32-bit PNG），但仍给实色背景
  P('store-1024', 'store', 1024, 'Icon-1024.png', 'App Store', { required: true }),
  P('store-512', 'store', 512, 'Icon-512.png', 'Google Play', { opaque: false, maxBytes: 1024 * 1024 }),
  // iOS 传统尺寸：Xcode 14+ 只需 1024 即可派生，以下为兼容旧 deployment target（默认不选）
  ...[180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20]
    .map((s) => P(`ios-${s}`, 'ios', s, `Icon-${s}.png`, 'iOS', { defaultOn: false })),
  // Android 传统 launcher 密度：48dp 在 mdpi→xxxhdpi 的像素等价
  ...[['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]
    .map(([d, s]) => P(`android-${d}`, 'android', s, `ic_launcher-${d}.png`, 'Android')),
]

export const DEFAULT_PRESET_IDS = ICON_PRESETS.filter((p) => p.defaultOn).map((p) => p.id)

export function getPreset(id) {
  return ICON_PRESETS.find((p) => p.id === id) || null
}

/** 规范化勾选：去重、忽略未知 id、按预设表顺序排列，并强制带入 required 项 */
export function resolvePresets(ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : [])
  return ICON_PRESETS.filter((p) => p.required || wanted.has(p.id))
}

// ---------- 背景色（严格白名单，防止任意字符串进入样式 / 颜色计算） ----------
const DEFAULT_BG = { hex: '#ffffff', rgb: [255, 255, 255] }

/** 只接受 #rgb / #rrggbb；非法输入回退白色并给出 code 化告警 */
export function normalizeBackground(input) {
  const s = String(input == null ? '' : input).trim()
  // 空串 = 未指定，走默认白且不告警（UI 清空输入框时的正常状态）
  if (!s) return { ...DEFAULT_BG, rgb: [...DEFAULT_BG.rgb], issues: [] }
  let m = /^#([0-9a-fA-F]{3})$/.exec(s)
  if (m) {
    const rgb = m[1].split('').map((c) => parseInt(c + c, 16))
    return { hex: '#' + m[1].toLowerCase(), rgb, issues: [] }
  }
  m = /^#([0-9a-fA-F]{6})$/.exec(s)
  if (m) {
    const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
    return { hex: '#' + m[1].toLowerCase(), rgb, issues: [] }
  }
  return {
    ...DEFAULT_BG, rgb: [...DEFAULT_BG.rgb],
    issues: [{ code: 'bg-invalid', level: 'warning', params: { value: s } }],
  }
}

/** 生成执行计划（纯函数，视图与单测共用） */
export function planIconSet({ presetIds, fit = 'cover', background = '#ffffff' } = {}) {
  const issues = []
  const presets = resolvePresets(presetIds)
  const bg = normalizeBackground(background)
  issues.push(...bg.issues)
  let mode = fit
  if (fit !== 'cover' && fit !== 'contain') {
    mode = 'cover'
    issues.push({ code: 'fit-invalid', level: 'warning', params: { value: String(fit) } })
  }
  if (!presets.length) issues.push({ code: 'no-preset', level: 'error' })
  return { presets, fit: mode, background: bg, issues }
}

export function iconFileName(preset) {
  return preset && preset.name ? preset.name : 'icon.png'
}

// ---------- RGBA 运算（纯函数，Node 可测） ----------
/** 把带 alpha 的 RGBA 合成到实色背景，并强制 a=255（source-over） */
export function flattenRgba(imageData, bg = DEFAULT_BG.rgb) {
  const { data, width, height } = imageData
  const out = new Uint8ClampedArray(data.length)
  const [br, bgc, bb] = bg
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255
    out[i] = data[i] * a + br * (1 - a)
    out[i + 1] = data[i + 1] * a + bgc * (1 - a)
    out[i + 2] = data[i + 2] * a + bb * (1 - a)
    out[i + 3] = 255
  }
  return { data: out, width, height }
}

/** 读取 PNG IHDR 的 colorType：0 灰 / 2 RGB(无 alpha) / 3 调色板 / 4 灰+alpha / 6 RGBA */
export function pngColorType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return b.length > 25 ? b[25] : -1
}

/** 校验单个产物：尺寸精确 / alpha 通道 / 体积上限。返回 code 化 issues */
export function checkIconOutput(preset, bytes, width, height) {
  const issues = []
  if (width !== preset.size || height !== preset.size) {
    issues.push({ code: 'icon-size-mismatch', level: 'error', params: { w: width, h: height, size: preset.size } })
  }
  const ct = pngColorType(bytes)
  if (preset.opaque && ct !== 2) {
    issues.push({ code: 'icon-alpha-channel', level: 'error', params: { colorType: ct, name: preset.name } })
  }
  if (preset.maxBytes && bytes.length > preset.maxBytes) {
    issues.push({ code: 'icon-too-large', level: 'error', params: { size: bytes.length, max: preset.maxBytes, name: preset.name } })
  }
  return issues
}

/**
 * 面积平均缩放（box filter）+ 两种裁剪语义，输出 size×size 的 RGBA。
 *  cover   等比放大到铺满方形后居中裁切（源图透明区按 alpha 合成到 bg）
 *  contain 等比缩到完整可见，四周由 bg 填充
 * flatten=true 时强制不透明（a=255）；false 时保留源 alpha（仅留白区为不透明 bg）。
 */
export function scaleRgba(src, size, fit = 'cover', bg = DEFAULT_BG.rgb, { flatten = true } = {}) {
  const sw = src.width
  const sh = src.height
  const s = src.data
  const out = new Uint8ClampedArray(size * size * 4)
  const [br, bgc, bb] = bg
  const scale = fit === 'contain' ? Math.min(size / sw, size / sh) : Math.max(size / sw, size / sh)
  // 目标画布上的绘制框（contain 时正值留白；cover 时负值实现裁切）
  const dw = sw * scale
  const dh = sh * scale
  const offX = (size - dw) / 2
  const offY = (size - dh) / 2

  for (let dy = 0; dy < size; dy++) {
    const sy0 = (dy - offY) / scale
    const sy1 = (dy + 1 - offY) / scale
    const y0 = Math.max(0, Math.floor(sy0))
    const y1 = Math.min(sh, Math.ceil(sy1))
    for (let dx = 0; dx < size; dx++) {
      const sx0 = (dx - offX) / scale
      const sx1 = (dx + 1 - offX) / scale
      const x0 = Math.max(0, Math.floor(sx0))
      const x1 = Math.min(sw, Math.ceil(sx1))
      let pr = 0, pg = 0, pb = 0, pa = 0, wsum = 0
      for (let py = y0; py < y1; py++) {
        const oy = Math.min(sy1, py + 1) - Math.max(sy0, py)
        if (oy <= 0) continue
        for (let px = x0; px < x1; px++) {
          const ox = Math.min(sx1, px + 1) - Math.max(sx0, px)
          if (ox <= 0) continue
          const w = ox * oy
          const i = (py * sw + px) * 4
          const a = s[i + 3] / 255
          pr += s[i] * a * w
          pg += s[i + 1] * a * w
          pb += s[i + 2] * a * w
          pa += a * w
          wsum += w
        }
      }
      const o = (dy * size + dx) * 4
      if (wsum <= 0) {
        // contain 的留白区（或浮点边界）：纯背景
        out[o] = br; out[o + 1] = bgc; out[o + 2] = bb; out[o + 3] = 255
        continue
      }
      const cr = pr / wsum, cg = pg / wsum, cb = pb / wsum, ca = pa / wsum
      if (flatten) {
        // 预乘颜色 + 背景按 (1-α) 补上 = source-over，天然不透明
        out[o] = cr + br * (1 - ca)
        out[o + 1] = cg + bgc * (1 - ca)
        out[o + 2] = cb + bb * (1 - ca)
        out[o + 3] = 255
      } else if (ca > 0) {
        out[o] = cr / ca; out[o + 1] = cg / ca; out[o + 2] = cb / ca
        out[o + 3] = Math.round(ca * 255)
      } else {
        out[o] = br; out[o + 1] = bgc; out[o + 2] = bb; out[o + 3] = 255
      }
    }
  }
  return { data: out, width: size, height: size }
}

/** RGBA → PNG 字节。forbidPlte=true 保证全不透明数据输出 colorType=2（无 alpha 通道） */
export function encodeIconPng(rgba) {
  const bytes = new Uint8Array(rgba.data.length)
  bytes.set(rgba.data)
  const png = UPNG.encode([bytes], rgba.width, rgba.height, 0, 0, true)
  return new Uint8Array(png)
}

/** 一次缩放 + 编码 + 校验，批量产出全部尺寸 */
export function renderIconSet(imageData, presets, opts = {}) {
  const { fit = 'cover', background = DEFAULT_BG.rgb } = opts
  const bg = Array.isArray(background) ? background : normalizeBackground(background).rgb
  return presets.map((preset) => {
    const rgba = scaleRgba(imageData, preset.size, fit, bg, { flatten: preset.opaque })
    const bytes = encodeIconPng(rgba)
    const issues = checkIconOutput(preset, bytes, rgba.width, rgba.height)
    return {
      preset, name: iconFileName(preset), bytes,
      width: rgba.width, height: rgba.height,
      colorType: pngColorType(bytes), issues,
    }
  })
}

// ---------- 打包 ----------
const PACK_README = `LocalForge App Icon Pack
========================

Generated fully in your browser. No upload, no network, no AI.

This is a FLAT PNG pack with stable file names. It is intentionally NOT:
  - an Xcode AppIcon.appiconset / Contents.json asset catalog
  - an Android res/mipmap-* resource project
  - an Android Adaptive Icon (108dp foreground/background layers, 66dp safe zone)

Place the files into the matching directories of your project.

Key platform rules:
  * App Store (Icon-1024.png): exactly 1024x1024, fully opaque, NO alpha channel,
    square, no pre-applied rounded corners or shadows (iOS adds the mask).
  * Google Play (Icon-512.png): exactly 512x512, 32-bit PNG, sRGB, max 1024 KB,
    full square (Play adds the corner radius and shadow).
  * Legacy iOS / Android launcher PNGs are for older targets; Xcode 14+ can derive
    all iOS sizes from a single 1024 master.

Use a source image of at least 1024x1024. Upscaling cannot restore lost detail.
`

/** 把产物打包为 store ZIP（复用公众号离线发布包的纯 JS ZIP 写入器） */
export function buildIconZip(entries) {
  const files = (entries || []).map((e) => zipEntry(e.name, e.bytes))
  files.push(zipEntry('README.txt', PACK_README))
  return buildStoreZip(files)
}
