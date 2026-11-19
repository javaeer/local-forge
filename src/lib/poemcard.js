// 竖排诗词卡片渲染（第 3 期）。
//
// 不引入任何绘图库：竖排本就是「每个字一行」的排版，用 Canvas 逐字定位比引 SVG 库更短、
// 且导出 PNG 一步到位。字号、列距、边距都按「字格」为单位算，换尺寸不会走形。
//
// 竖排的三条规矩（都不是可选项，做错了就是外行）：
//   1. **列从右往左**。第一列贴右边缘，标题在最右。
//   2. **标点不占满格**。逗号句号要缩在字格右上角，否则整列看起来像被标点撑开的梯子。
//   3. **引号书名号转向**。竖排时「」要立在格子上方，「（）」同理，不能当普通字处理。

const FONT_STACK =
  '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", "Songti TC", serif'

export const CARD_SCHEMES = [
  { id: 'xuan', name: '宣纸', bg: '#f7f1e3', fg: '#2a2622', sub: '#7a6a52', line: '#d9c9a6', seal: '#a83232' },
  { id: 'mo', name: '墨夜', bg: '#1b1b1f', fg: '#ece6d8', sub: '#9a9488', line: '#3a3a42', seal: '#c0392b' },
  { id: 'qing', name: '青瓷', bg: '#eaf1ef', fg: '#223f3a', sub: '#5c7d77', line: '#b9cfc9', seal: '#a33b3b' },
  { id: 'dai', name: '黛蓝', bg: '#1e2a3a', fg: '#e6ecf5', sub: '#8fa3bd', line: '#33465c', seal: '#c0554d' },
  { id: 'zhu', name: '朱砂', bg: '#8c2f28', fg: '#f7ecdc', sub: '#e0bfae', line: '#a95248', seal: '#f2d9c4' },
]

// 竖排时要「贴右上角」的标点：这类字符占一格但字形很小，居中会显得悬空
const PUNCT_RIGHT = new Set(['，', '。', '、', '；', '：', '！', '？', ',', '.', ';', ':', '!', '?'])
// 竖排时字形的视觉重心要上移的标点（括号、引号在竖排里立在格子上半部）
const PUNCT_UP = new Set(['（', '）', '《', '》', '「', '」', '『', '』', '“', '”', '‘', '’', '(', ')'])
// 竖排时不占独立格子的标点（紧跟上一字，避免出现只有标点的一列）
const NO_BREAK = new Set(['，', '。', '、', '；', '：', '！', '？'])

export function schemeOf(id) {
  return CARD_SCHEMES.find((s) => s.id === id) || CARD_SCHEMES[0]
}

// 把正文拆成「列」：每列最多 cap 字，标点粘在前一字后面不单独起列
function toColumns(text, cap) {
  const cols = []
  let cur = []
  const push = () => {
    if (cur.length) cols.push(cur)
    cur = []
  }
  const paras = String(text).split('\n')
  paras.forEach((para, pi) => {
    const chars = Array.from(para)
    let i = 0
    while (i < chars.length) {
      const ch = chars[i]
      // 段落首字若落在标点上，与上一列合并（防止整列只有标点）
      if (cur.length >= cap) {
        // 下一字是标点：把它塞进本列末尾（超一格也比孤零零好）
        if (NO_BREAK.has(chars[i + 1]) && cur.length === cap) {
          cur.push(ch)
          i++
          continue
        }
        push()
      }
      cur.push(ch)
      i++
    }
    // 段落间留一格空白，视觉上分开「上阕/下阕」「段与段」
    if (pi < paras.length - 1) {
      if (cur.length >= cap) push()
      else cur.push('')
    }
  })
  push()
  return cols
}

/**
 * 在 canvas 上绘制竖排卡片。
 * opts: { title, author, text, scheme, width, height, sealText, scale }
 */
export function drawCard(canvas, opts) {
  const {
    title = '',
    author = '',
    text = '',
    scheme = 'xuan',
    width = 1080,
    height = 1440,
    sealText = '读诗',
  } = opts
  const sc = schemeOf(scheme)
  const dpr = Math.min(3, Math.max(1, opts.scale || 2))

  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'

  // 背景 + 双线外框
  ctx.fillStyle = sc.bg
  ctx.fillRect(0, 0, width, height)
  const pad = Math.round(width * 0.055)
  ctx.strokeStyle = sc.line
  ctx.lineWidth = 1.5
  ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2)
  ctx.lineWidth = 0.8
  ctx.strokeRect(pad + 8, pad + 8, width - pad * 2 - 16, height - pad * 2 - 16)

  const innerTop = pad + 8 + Math.round(width * 0.045)
  const innerBottom = height - pad - 8 - Math.round(width * 0.05)
  const innerRight = width - pad - 8 - Math.round(width * 0.045)
  const innerLeft = pad + 8 + Math.round(width * 0.03)
  const contentH = innerBottom - innerTop

  // 字号以宽度为基准，换尺寸不走形
  const fsBody = Math.round(width * 0.042)
  const fsTitle = Math.round(width * 0.055)
  const fsSub = Math.round(width * 0.026)
  const gap = 1.14 // 字距 = 字号 × 1.14，竖排比横排需要更松

  const colsBody = Math.max(1, Math.floor(contentH / (fsBody * gap)))

  // 标题列：标题过长时按内容高度自动折成多列
  const titleChars = Array.from(title)
  const colsTitle = Math.max(1, Math.ceil(titleChars.length / Math.max(1, Math.floor(contentH / (fsTitle * 1.1)))))
  const titleGap = fsTitle * 1.5 // 标题列之间的间距

  // 列宽：正文列宽略小于字距，标题列更宽
  const colW = fsBody * 1.36
  const titleColW = fsTitle * 1.5

  let x = innerRight
  const bodyRight = x - colsTitle * titleColW - titleGap - (titleChars.length ? titleGap : 0)

  // ---- 标题（最右，可多列）----
  if (titleChars.length) {
    ctx.fillStyle = sc.fg
    ctx.font = `600 ${fsTitle}px ${FONT_STACK}`
    const per = Math.max(1, Math.floor(contentH / (fsTitle * 1.1)))
    const slices = []
    for (let i = 0; i < titleChars.length; i += per) slices.push(titleChars.slice(i, i + per))
    // 标题从最右列往左排
    slices.forEach((slice, si) => {
      const tx = innerRight - si * titleColW - titleColW / 2
      slice.forEach((ch, ci) => {
        if (ch === '') return
        const ty = innerTop + ci * fsTitle * 1.1 + fsTitle
        ctx.fillText(ch, tx + (PUNCT_RIGHT.has(ch) ? fsTitle * 0.22 : 0), ty - (PUNCT_UP.has(ch) ? fsTitle * 0.12 : 0))
      })
    })

    // 作者：标题列之后、正文列之前，从标题下方起，字号小
    if (author) {
      ctx.fillStyle = sc.sub
      ctx.font = `${fsSub}px ${FONT_STACK}`
      const ax = bodyRight + fsBody * 0.3
      Array.from(author).forEach((ch, i) => {
        const ty = innerTop + fsTitle * 0.4 + (i + 1) * fsSub * 1.35
        if (ty + fsSub > innerBottom) return
        ctx.fillText(ch, ax, ty)
      })
    }
  }

  // ---- 正文（从 bodyRight 往左逐列）----
  const cols = toColumns(text, colsBody)
  ctx.fillStyle = sc.fg
  ctx.font = `${fsBody}px ${FONT_STACK}`
  const needW = innerRight - bodyRight + cols.length * colW
  const availW = innerRight - innerLeft
  const startX = needW > availW
    ? // 放不下：整体缩一点列距（宁可密一点，也不截断）
      bodyRight - (needW - availW)
    : bodyRight
  cols.forEach((col, ci) => {
    const cx = startX - ci * colW - colW / 2
    if (cx < innerLeft) return
    col.forEach((ch, li) => {
      if (ch === '') return
      const ty = innerTop + li * fsBody * gap + fsBody
      let dx = cx
      let dy = ty
      if (PUNCT_RIGHT.has(ch)) {
        dx += fsBody * 0.34
        dy -= fsBody * 0.04
      } else if (PUNCT_UP.has(ch)) {
        dy -= fsBody * 0.08
      }
      ctx.fillText(ch, dx, dy)
    })
  })

  // ---- 印章（左下）----
  if (sealText) {
    const size = fsBody * 1.1
    const sx = innerLeft + size * 0.3
    const sy = innerBottom - size * 1.3
    ctx.save()
    ctx.fillStyle = sc.seal
    ctx.globalAlpha = 0.94
    roundRect(ctx, sx, sy, size, size, size * 0.1)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = sc.bg
    ctx.font = `600 ${Math.round(size * 0.44)}px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const chars = Array.from(sealText).slice(0, 4)
    // 印内竖排：1 字居中，2 字上下各半，3–4 字两列右起
    const positions =
      chars.length === 1
        ? [[0.5, 0.5]]
        : chars.length === 2
          ? [[0.5, 0.3], [0.5, 0.7]]
          : chars.map((_, i) => [0.72 - (i % 2) * 0.44, 0.28 + Math.floor(i / 2) * 0.44])
    chars.forEach((ch, i) => {
      const [px, py] = positions[i]
      ctx.fillText(ch, sx + size * px, sy + size * py)
    })
    ctx.restore()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
  }

  return { width, height, dpr }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 导出 PNG。返回 Blob，交给通用下载 / 分享流程。
export function cardToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('卡片导出失败：浏览器未返回图像数据'))), 'image/png')
  })
}

// 供测试：把正文按给定列容量切分的结果（不含绘制）
export function columnsOf(text, cap) {
  return toColumns(text, cap)
}
