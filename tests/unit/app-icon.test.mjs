// App 图标生成器内核单测：纯 Node（node:test），零 DOM、零网络。
// 重点守护「App Store 1024 必须不含 alpha 通道」这一上架硬约束。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ICON_GROUPS, ICON_PRESETS, DEFAULT_PRESET_IDS, getPreset, resolvePresets,
  normalizeBackground, planIconSet, iconFileName, flattenRgba, scaleRgba,
  encodeIconPng, pngColorType, checkIconOutput, renderIconSet, buildIconZip,
} from '../../src/lib/app-icon.js'

// 造一张带半透明像素的源图
function makeSource(w = 64, h = 64, { alpha = true } = {}) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 220
    data[i * 4 + 1] = 40
    data[i * 4 + 2] = 60
    data[i * 4 + 3] = alpha && i % 7 === 0 ? 128 : 255
  }
  return { data, width: w, height: h }
}

// 极简 ZIP 结构解析（不依赖第三方，用于断言文件名与条目数）
function zipNames(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let p = 0
  const names = []
  while (p + 4 <= b.length && dv.getUint32(p, true) === 0x04034b50) {
    const nameLen = dv.getUint16(p + 26, true)
    const extraLen = dv.getUint16(p + 28, true)
    const size = dv.getUint32(p + 18, true)
    names.push(new TextDecoder().decode(b.slice(p + 30, p + 30 + nameLen)))
    p += 30 + nameLen + extraLen + size
  }
  assert.equal(dv.getUint32(p, true), 0x02014b50, '本地头之后应是 central directory')
  let q = p
  let central = 0
  while (q + 4 <= b.length && dv.getUint32(q, true) === 0x02014b50) {
    const nameLen = dv.getUint16(q + 28, true)
    const extraLen = dv.getUint16(q + 30, true)
    const commentLen = dv.getUint16(q + 32, true)
    q += 46 + nameLen + extraLen + commentLen
    central++
  }
  assert.equal(dv.getUint32(q, true), 0x06054b50, 'central directory 之后应是 EOCD')
  assert.equal(central, names.length, 'central directory 条目数应与本地头一致')
  return names
}

test('尺寸预设表：19 项、id/name 唯一、尺寸为正整数、文件名纯 ASCII', () => {
  assert.equal(ICON_PRESETS.length, 19)
  assert.equal(new Set(ICON_PRESETS.map((p) => p.id)).size, ICON_PRESETS.length)
  assert.equal(new Set(ICON_PRESETS.map((p) => p.name)).size, ICON_PRESETS.length)
  for (const p of ICON_PRESETS) {
    assert.ok(Number.isInteger(p.size) && p.size > 0, `${p.id} 尺寸非法`)
    assert.match(p.name, /^[\x20-\x7e]+\.png$/, `${p.name} 文件名必须是稳定 ASCII`)
    assert.ok(ICON_GROUPS.some((g) => g.id === p.group), `${p.id} 分组未注册`)
  }
})

test('平台规范：App Store 1024 强制必选且不透明，Google Play 512 限 1024KB 且允许 alpha', () => {
  const a = getPreset('store-1024')
  assert.equal(a.size, 1024)
  assert.equal(a.required, true)
  assert.equal(a.opaque, true)
  const g = getPreset('store-512')
  assert.equal(g.size, 512)
  assert.equal(g.opaque, false)
  assert.equal(g.maxBytes, 1024 * 1024)
})

test('iOS 传统 12 档与 Android 5 档密度齐全', () => {
  const ios = ICON_PRESETS.filter((p) => p.group === 'ios').map((p) => p.size)
  assert.deepEqual(ios, [180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20])
  const and = ICON_PRESETS.filter((p) => p.group === 'android').map((p) => p.size)
  assert.deepEqual(and, [48, 72, 96, 144, 192])
  assert.ok(ICON_PRESETS.filter((p) => p.group === 'ios').every((p) => !p.defaultOn))
})

test('resolvePresets：去重、忽略未知、按表顺序、强制带入 required', () => {
  const r = resolvePresets(['android-xxxhdpi', 'android-mdpi', 'nope', 'android-mdpi'])
  assert.deepEqual(r.map((p) => p.id), ['store-1024', 'android-mdpi', 'android-xxxhdpi'])
  assert.deepEqual(resolvePresets([]).map((p) => p.id), ['store-1024'])
  assert.deepEqual(resolvePresets(null).map((p) => p.id), ['store-1024'])
})

test('DEFAULT_PRESET_IDS 与 defaultOn 一致且不含 iOS 传统尺寸', () => {
  assert.deepEqual(DEFAULT_PRESET_IDS, ICON_PRESETS.filter((p) => p.defaultOn).map((p) => p.id))
  assert.ok(DEFAULT_PRESET_IDS.every((id) => !id.startsWith('ios-')))
})

test('normalizeBackground：#rgb / #rrggbb 正常，注入串回退白色并告警', () => {
  assert.deepEqual(normalizeBackground('#0af').rgb, [0, 170, 255])
  assert.deepEqual(normalizeBackground('#0F172A').rgb, [15, 23, 42])
  assert.equal(normalizeBackground('  #fff  ').hex, '#fff')
  const bad = normalizeBackground('red;position:fixed;background:url(javascript:alert(1))')
  assert.deepEqual(bad.rgb, [255, 255, 255])
  assert.equal(bad.issues[0].code, 'bg-invalid')
  assert.equal(normalizeBackground('').issues.length, 0) // 空串按默认白，不报错
})

test('planIconSet：非法 fit 回退 cover，无预设报 error，非法背景透传 warning', () => {
  const ok = planIconSet({ presetIds: DEFAULT_PRESET_IDS })
  assert.equal(ok.fit, 'cover')
  assert.equal(ok.issues.length, 0)
  const bad = planIconSet({ presetIds: [], fit: 'stretch', background: 'evil' })
  assert.equal(bad.fit, 'cover')
  const codes = bad.issues.map((i) => i.code)
  assert.ok(codes.includes('fit-invalid'))
  assert.ok(codes.includes('bg-invalid'))
  // required（App Store 1024）保证计划永不为空，即便用户取消全部勾选
  assert.ok(!codes.includes('no-preset'))
  assert.deepEqual(bad.presets.map((p) => p.id), ['store-1024'])
})

test('iconFileName 返回稳定文件名', () => {
  assert.equal(iconFileName(getPreset('store-1024')), 'Icon-1024.png')
  assert.equal(iconFileName(null), 'icon.png')
})

test('flattenRgba：半透明按 alpha 合成到背景且 a 全为 255', () => {
  const d = new Uint8ClampedArray([200, 0, 0, 128, 0, 0, 0, 0])
  const out = flattenRgba({ data: d, width: 2, height: 1 }, [255, 255, 255])
  assert.equal(out.data[3], 255)
  assert.equal(out.data[7], 255)
  // 50% 红 + 白 = (228,128,128) 附近
  assert.ok(Math.abs(out.data[0] - 228) <= 2, `R=${out.data[0]}`)
  assert.ok(Math.abs(out.data[1] - 128) <= 2, `G=${out.data[1]}`)
  assert.deepEqual(Array.from(out.data.slice(4, 8)), [255, 255, 255, 255], '全透明像素应变成纯背景')
})

test('scaleRgba(cover)：尺寸精确、铺满、不透明、背景色生效', () => {
  const src = makeSource(120, 60) // 非正方形，验证裁切
  const rgba = scaleRgba(src, 48, 'cover', [10, 20, 30])
  assert.equal(rgba.width, 48); assert.equal(rgba.height, 48)
  assert.equal(rgba.data.length, 48 * 48 * 4)
  for (let i = 3; i < rgba.data.length; i += 4) assert.equal(rgba.data[i], 255)
})

test('scaleRgba(contain)：留白区为背景色', () => {
  const src = makeSource(120, 60, { alpha: false })
  const rgba = scaleRgba(src, 60, 'contain', [7, 8, 9])
  const at = (x, y) => Array.from(rgba.data.slice((y * 60 + x) * 4, (y * 60 + x) * 4 + 4))
  // 上下各 15px 留白（60 高 → 30 高），取 (30, 2) 必在留白区
  assert.deepEqual(at(30, 2), [7, 8, 9, 255])
  assert.deepEqual(at(30, 57), [7, 8, 9, 255])
  // 中心是图案
  assert.ok(at(30, 30)[0] > 100)
})

test('scaleRgba(flatten=false)：保留源 alpha（Google Play 允许 32-bit PNG）', () => {
  const src = makeSource(32, 32)
  const rgba = scaleRgba(src, 32, 'cover', [255, 255, 255], { flatten: false })
  let hasAlpha = false
  for (let i = 3; i < rgba.data.length; i += 4) if (rgba.data[i] < 255) { hasAlpha = true; break }
  assert.ok(hasAlpha, '应保留半透明像素')
})

test('encodeIconPng：全不透明输出 colorType=2（无 alpha 通道），含透明输出 6', () => {
  const mk = (a) => ({ data: new Uint8ClampedArray([10, 20, 30, a]), width: 1, height: 1 })
  const opaque = encodeIconPng(mk(255))
  assert.equal(pngColorType(opaque), 2, 'ITMS-90717：App Store 产物不得含 alpha 通道')
  const alpha = encodeIconPng(mk(128))
  assert.equal(pngColorType(alpha), 6)
  assert.equal(new TextDecoder().decode(opaque.slice(1, 4)), 'PNG')
})

test('checkIconOutput：尺寸不符 / alpha 通道 / 体积超限 均为 code 化 error', () => {
  const p = getPreset('store-1024')
  const bytes = encodeIconPng({ data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 })
  const codes = checkIconOutput(p, bytes, 1, 1).map((i) => i.code)
  assert.ok(codes.includes('icon-size-mismatch'))
  const fixed = encodeIconPng(scaleRgba(makeSource(8, 8), 8, 'cover'))
  assert.ok(checkIconOutput(p, fixed, 8, 8).some((i) => i.code === 'icon-size-mismatch'))
  // alpha 通道：用带透明像素的 PNG 冒充 opaque 产物
  const rgbaPng = encodeIconPng({ data: new Uint8ClampedArray([0, 0, 0, 128]), width: 1, height: 1 })
  assert.ok(checkIconOutput(p, rgbaPng, 1, 1).some((i) => i.code === 'icon-alpha-channel'))
  // 体积：Google Play 512
  const g = getPreset('store-512')
  const big = new Uint8Array(1024 * 1024 + 1)
  assert.ok(checkIconOutput(g, big, 512, 512).some((i) => i.code === 'icon-too-large'))
})

test('renderIconSet：全部产物尺寸精确、默认预设零 issues、App Store 无 alpha 通道', () => {
  const src = makeSource(256, 256)
  const plan = planIconSet({ presetIds: DEFAULT_PRESET_IDS, fit: 'cover', background: '#0f172a' })
  const outs = renderIconSet(src, plan.presets, { fit: plan.fit, background: plan.background.rgb })
  assert.equal(outs.length, plan.presets.length)
  for (const o of outs) {
    assert.equal(o.width, o.preset.size)
    assert.equal(o.height, o.preset.size)
    assert.deepEqual(o.issues, [], `${o.name} 不应有问题`)
  }
  const a = outs.find((o) => o.preset.id === 'store-1024')
  assert.equal(a.colorType, 2, 'App Store 产物必须无 alpha 通道')
  const g = outs.find((o) => o.preset.id === 'store-512')
  assert.ok(g.bytes.length <= 1024 * 1024, 'Google Play 产物不得超过 1024KB')
})

test('renderIconSet：iOS 传统 12 档全部可生成且尺寸精确（一次解码语义）', () => {
  const src = makeSource(1024, 512)
  const ids = ICON_PRESETS.map((p) => p.id)
  const outs = renderIconSet(src, resolvePresets(ids), { fit: 'contain', background: '#123456' })
  assert.equal(outs.length, 19)
  for (const o of outs) {
    assert.equal(o.width, o.preset.size)
    assert.equal(o.height, o.preset.size)
    assert.ok(o.bytes.length > 0)
    assert.deepEqual(o.issues, [])
  }
})

test('renderIconSet：1×1 极小源图放大到 1024 不崩且尺寸精确', () => {
  const src = { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 }
  const o = renderIconSet(src, [getPreset('store-1024')])[0]
  assert.equal(o.width, 1024)
  assert.equal(o.height, 1024)
  assert.equal(o.colorType, 2)
  assert.deepEqual(o.issues, [])
})

test('buildIconZip：文件名稳定、含 README、ZIP 结构合法（central/EOCD 对齐）', () => {
  const outs = renderIconSet(makeSource(32, 32), resolvePresets(['store-1024', 'android-mdpi']))
  const zip = buildIconZip(outs)
  assert.ok(zip instanceof Uint8Array)
  const names = zipNames(zip)
  assert.deepEqual(names, ['Icon-1024.png', 'ic_launcher-mdpi.png', 'README.txt'])
  // README 明确声明不生成 Asset Catalog / Adaptive Icon，避免用户误用
  const readme = new TextDecoder().decode(zip.subarray(zip.length - 2000))
  assert.match(readme, /NOT:/)
})

test('背景色确实进入产物像素（contain 留白区取自定义色）', () => {
  const src = makeSource(80, 40, { alpha: false })
  const rgba = scaleRgba(src, 40, 'contain', [17, 34, 51])
  const i = (0 * 40 + 20) * 4 // 顶部留白
  assert.deepEqual(Array.from(rgba.data.slice(i, i + 4)), [17, 34, 51, 255])
})
