// 近体诗格律校验 —— 纯计算，不依赖 DOM / 网络，可在 Node 直接测试。
//
// 设计原则：
//   1. 宁可漏报，不可误报。格律工具一旦把好诗判成错的，用户就不再信任它。
//      因此硬位置（第 2/4/6 字）才判 error；第 1/3/5 字宽松放行（「一三五不论」）；
//      多音字一律视为可平可仄放行；查不到的字不判错。
//   2. 所有判定都能给出「为什么」。每个字带 expected / actual / status，便于逐字高亮。
//   3. 数据与算法分离：韵书通过 index 注入，测试可用手搓的小索引。
//
// 术语与依据：
//   - 四种基本句式 A/B/C/D 与「粘对」规则依王力《诗词格律》。
//   - 平水韵 106 韵部（上平 15 / 下平 15 / 上 29 / 去 30 / 入 17）。
//   - 近体诗限押平声韵，且须同一韵部；首句入韵者允许借邻韵（孤雁出群格）。

export const TONE_PING = '平'
export const TONE_ZE = '仄'
export const TONE_MULTI = '多' // 平仄两读，如「看」「过」「思」「重」

/* ---------------- 句式与模板 ---------------- */

// 五言四种基本句式
const LINE5 = {
  A: '仄仄平平仄', // 仄起仄收，出句
  B: '平平仄仄平', // 平起平收，韵句
  C: '平平平仄仄', // 平起仄收，出句
  D: '仄仄仄平平', // 仄起平收，韵句
}

// 七言 = 五言每句前加两字，且与五言首字平仄相反
const LINE7 = {
  A: '平平仄仄平平仄',
  B: '仄仄平平仄仄平',
  C: '仄仄平平平仄仄',
  D: '平平仄仄仄平平',
}

// 以首句句式决定的 8 句周期（律诗取全 8，绝句取前 4）。
// 这是「粘」的必然结果：出句→对句平仄相反（对），对句→下句出句平仄相同（粘）。
const CYCLE = {
  A: 'ABCDABCD',
  D: 'DBCDABCD', // 首句入韵：D 顶替 A，其余不变
  C: 'CDABCDAB',
  B: 'BDABCDAB', // 首句入韵：B 顶替 C
}

const FORM = {
  5: { chars: 5, lineMap: LINE5, names: { 4: '五绝', 8: '五律' } },
  7: { chars: 7, lineMap: LINE7, names: { 4: '七绝', 8: '七律' } },
}

/* ---------------- 索引构建 ---------------- */

// 把 fetch-classics.mjs 产出的紧凑结构转成查询索引。
// data: { rhyme: { 声部: { 韵部: '字串' } }, tone: ['平字串','仄字串','多字串'] }
export function buildIndex(data) {
  const tone = new Map()
  ;[TONE_PING, TONE_ZE, TONE_MULTI].forEach((t, i) => {
    for (const ch of data.tone[i] || '') tone.set(ch, t)
  })

  const rhymeOf = new Map() // 字 → [{ part, name }]
  const groups = new Map() // 韵部名 → { part, chars: [] }
  for (const [part, members] of Object.entries(data.rhyme)) {
    for (const [name, str] of Object.entries(members)) {
      const chars = Array.from(str)
      groups.set(name, { part, chars })
      for (const ch of chars) {
        if (!rhymeOf.has(ch)) rhymeOf.set(ch, [])
        rhymeOf.get(ch).push({ part, name })
      }
    }
  }

  // 平声韵部集合：近体诗只能押这些
  const pingGroups = new Set(
    Object.entries(data.rhyme)
      .filter(([part]) => /^[上下]平/.test(part))
      .flatMap(([, members]) => Object.keys(members)),
  )

  return { tone, rhymeOf, groups, pingGroups, stats: data.stats || {} }
}

export function toneOf(index, ch) {
  return index.tone.get(ch) || null
}

// 平声韵部（供押韵判定）。一字可能同属多个韵部，返回全部。
export function pingRhymesOf(index, ch) {
  const list = index.rhymeOf.get(ch) || []
  return list.filter((r) => index.pingGroups.has(r.name))
}

/* ---------------- 文本解析 ---------------- */

// 从任意粘贴文本里提取诗句。
// 支持三种输入：带标点分行、带标点不分行、完全无标点。
export function parseLines(text) {
  const raw = String(text || '')
  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

  const blocks = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && CJK.test(s))

  const lines = []
  const notes = []
  for (const block of blocks) {
    // 先按中文标点切句；同时剔除标题/作者行（如「春望 杜甫」这类不含标点的短行会被字数过滤掉）
    const parts = block
      .split(/[，。！？；：、,.!?;:（）()「」『』《》\s]+/)
      .map((s) => Array.from(s).filter((ch) => CJK.test(ch)).join(''))
      .filter(Boolean)
    if (!parts.length) continue
    // 单块内多句：说明用户一行写了整首；单句：正常一行一句
    if (parts.length > 1) {
      for (const p of parts) if (p) lines.push(p)
      continue
    }
    const one = parts[0]
    // 无标点的整首：按 5/7 字等分（只在长度恰好整除时切，否则原样保留待判定）
    if (one.length > 8) {
      const by5 = one.length % 5 === 0
      const by7 = one.length % 7 === 0
      const size = by5 && (!by7 || one.length / 5 <= one.length / 7) ? 5 : by7 ? 7 : 0
      if (size && one.length / size >= 4) {
        for (let i = 0; i < one.length; i += size) lines.push(one.slice(i, i + size))
        notes.push(`输入未含标点，已按每 ${size} 字切分为 ${one.length / size} 句`)
        continue
      }
    }
    lines.push(one)
  }
  return { lines, notes }
}

/* ---------------- 单句校验 ---------------- */

// 逐字比对模板。
// hard = 第 2/4/6 字（索引 1/3/5），依「二四六分明」必须合律；末字亦为硬位——
//   「一三五不论」的例外正是韵脚：末字平仄决定该句平收（入韵）还是仄收，
//   若也当软位，A/D（或 B/C）两式在 2/4/6 位完全同构，模板将无从区分。
// soft = 其余奇数位（第 1/3/5 字），依「一三五不论」允许偏差，只记为 loose。
function checkLine(chars, tpl, index) {
  const out = []
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const expected = tpl[i]
    const actual = toneOf(index, ch)
    const isHard = i % 2 === 1 || i === chars.length - 1
    let status
    if (actual === TONE_MULTI) status = 'multi'
    else if (!actual) status = 'unknown'
    else if (actual === expected) status = 'ok'
    else status = isHard ? 'error' : 'loose'
    out.push({ ch, expected, actual, status, hard: isHard })
  }
  return out
}

// 孤平：平收（韵）句中，除韵脚外只剩一个平声字。
// 仅 B 型句式（平平仄仄平 / 仄仄平平仄仄平）可能犯——首字（或第三字）该平而用仄所致。
// 含多音字或未知字时不判，避免误报。
function isGuping(chars, index) {
  const body = chars.slice(0, -1)
  let ping = 0
  let fuzzy = 0
  for (const ch of body) {
    const t = toneOf(index, ch)
    if (t === TONE_PING) ping++
    else if (t === TONE_MULTI || !t) fuzzy++
  }
  return fuzzy === 0 && ping <= 1
}

// 句末三字全平即三平调（近体诗大忌）；全仄为三仄尾（小疵，可接受但要提示）。
function tailTones(chars, index) {
  if (chars.length < 3) return { sanPing: false, sanZe: false }
  const last3 = chars.slice(-3).map((ch) => toneOf(index, ch))
  if (last3.some((t) => !t || t === TONE_MULTI)) return { sanPing: false, sanZe: false }
  return { sanPing: last3.every((t) => t === TONE_PING), sanZe: last3.every((t) => t === TONE_ZE) }
}

/* ---------------- 押韵 ---------------- */

// 韵脚：所有平收句的末字。首句若平收即「首句入韵」。
function checkRhyme(lines, kinds, index) {
  const feet = []
  lines.forEach((chars, i) => {
    const last = chars[chars.length - 1]
    const t = toneOf(index, last)
    const isRhymeLine = kinds[i] === 'B' || kinds[i] === 'D' // 模板平收句
    if (!isRhymeLine) return
    const groups = pingRhymesOf(index, last)
    feet.push({
      line: i + 1,
      ch: last,
      tone: t,
      groups: groups.map((g) => g.name),
      first: i === 0,
    })
  })

  if (!feet.length) return { ok: false, feet, reason: 'no-rhyme' }

  const issues = []
  // 韵脚必须是平声
  for (const f of feet) {
    if (f.tone === TONE_ZE) {
      issues.push({ level: 'error', code: 'rhyme-ze', line: f.line, ch: f.ch, message: `第 ${f.line} 句韵脚「${f.ch}」为仄声，近体诗须押平声韵` })
    } else if (f.tone === null) {
      issues.push({ level: 'warn', code: 'rhyme-unknown', line: f.line, ch: f.ch, message: `第 ${f.line} 句韵脚「${f.ch}」不在韵表中，无法判定` })
    } else if (!f.groups.length && f.tone === TONE_PING) {
      issues.push({ level: 'warn', code: 'rhyme-not-in-pingshui', line: f.line, ch: f.ch, message: `第 ${f.line} 句韵脚「${f.ch}」未收入平水韵平声韵部` })
    }
  }

  // 韵部一致：以除首句外第一个可判定的韵脚为基准
  const judged = feet.filter((f) => f.groups.length)
  const body = judged.filter((f) => !f.first)
  const base = body[0] || judged[0]
  if (base) {
    const baseName = base.groups[0]
    for (const f of body) {
      if (!f.groups.length) continue
      if (!f.groups.includes(baseName)) {
        issues.push({
          level: 'error',
          code: 'rhyme-mixed',
          line: f.line,
          ch: f.ch,
          groups: f.groups,
          base: baseName,
          message: `第 ${f.line} 句韵脚「${f.ch}」属「${f.groups.join('/')}」，与「${baseName}」不同韵部（近体诗不可通押）`,
        })
      }
    }
    // 首句借邻韵（孤雁出群格）：允许，仅提示
    const first = feet.find((f) => f.first)
    if (first && first.groups.length && !first.groups.includes(baseName)) {
      issues.push({
        level: 'info',
        code: 'rhyme-borrow',
        line: 1,
        ch: first.ch,
        groups: first.groups,
        base: baseName,
        message: `首句韵脚「${first.ch}」用「${first.groups[0]}」，与其余韵脚「${baseName}」不同部——首句借邻韵（孤雁出群格）属允许格式`,
      })
    }
  }

  return {
    ok: !issues.some((i) => i.level === 'error'),
    feet,
    group: base ? base.groups[0] : null,
    issues,
  }
}

/* ---------------- 主流程 ---------------- */

// 对一首诗尝试全部四种起式，按「硬位符合率 → 软位符合率」两级排序取最优。
//
// 为什么要软位做决胜：A 与 D（或 B 与 C）在 2/4/6 位完全同构，差别只在第 5 字与末字。
// 末字常是多音字（如「间」jiān/jiàn），判不了；此时第 5 字（软位）就是唯一线索。
// 例：《早发白帝城》「彩云间」——「彩」为仄，正合 D 式「平平仄仄仄平平」而不合 A 式。
// 多音字与未知字一律不参与评分：既不能证真也不能证伪，计入会偏袒错误模板。
function bestPattern(lines, lineMap, index) {
  const candidates = []
  for (const start of ['A', 'D', 'C', 'B']) {
    const cycle = CYCLE[start]
    const kinds = lines.map((_, i) => cycle[i % cycle.length])
    let hardHit = 0
    let hardJudged = 0
    let softHit = 0
    let softJudged = 0
    lines.forEach((chars, i) => {
      const tpl = lineMap[kinds[i]]
      const arr = Array.from(chars)
      arr.forEach((ch, j) => {
        const actual = toneOf(index, ch)
        if (!actual || actual === TONE_MULTI) return
        const isHard = j % 2 === 1 || j === arr.length - 1
        const hit = actual === tpl[j]
        if (isHard) {
          hardJudged++
          if (hit) hardHit++
        } else {
          softJudged++
          if (hit) softHit++
        }
      })
    })
    candidates.push({
      start,
      kinds,
      hard: hardJudged ? hardHit / hardJudged : 0,
      soft: softJudged ? softHit / softJudged : 0,
    })
  }
  // Array.prototype.sort 稳定，hard 相同则按 soft 决胜
  candidates.sort((a, b) => b.hard - a.hard || b.soft - a.soft)
  return candidates[0]
}

function patternName(start, lineMap, charsPerLine) {
  const tpl = lineMap[start]
  // 平起 / 仄起看首句第二字（七言首字与第二字平仄相反，只看首字会判反）
  const isPingStart = tpl[1] === TONE_PING
  const isPingEnd = tpl[charsPerLine - 1] === TONE_PING
  return `${isPingStart ? '平起' : '仄起'}${isPingEnd ? '平收' : '仄收'}（首句${isPingEnd ? '入韵' : '不入韵'}）`
}

export function analyzePoem(text, index) {
  const parsed = parseLines(text)
  const notes = [...parsed.notes]
  const lines = parsed.lines

  if (!lines.length) {
    return {
      ok: false,
      fatal: { code: 'noLines', params: {}, message: '未识别到诗句，请粘贴诗文（每句一行，或带标点）' },
      lines: [],
      issues: [],
      notes,
    }
  }

  const lengths = [...new Set(lines.map((l) => l.length))]
  if (lengths.length > 1) {
    return {
      ok: false,
      fatal: {
        code: 'mixedLength',
        params: { lens: lines.map((l) => l.length).join('/') },
        message: `各句字数不一致（${lines.map((l) => l.length).join('/')}），近体诗句长必须齐整`,
      },
      lines: lines.map((l) => ({ text: l, chars: [] })),
      issues: [],
      notes,
    }
  }

  const charsPerLine = lengths[0]
  const form = FORM[charsPerLine]
  if (!form) {
    return {
      ok: false,
      fatal: {
        code: 'notFiveSeven',
        params: { n: charsPerLine },
        message: `每句 ${charsPerLine} 字，不是五言或七言，非近体诗标准形式`,
      },
      lines: lines.map((l) => ({ text: l, chars: [] })),
      issues: [],
      notes,
    }
  }
  if (!form.names[lines.length]) {
    const hint = lines.length > 8 ? '（句数超过 8 句，可能是排律，暂不支持）' : ''
    return {
      ok: false,
      fatal: {
        code: 'lineCount',
        params: { n: lines.length },
        message: `共 ${lines.length} 句，近体诗应为 4 句（绝句）或 8 句（律诗）${hint}`,
      },
      lines: lines.map((l) => ({ text: l, chars: [] })),
      issues: [],
      notes,
    }
  }

  const best = bestPattern(lines, form.lineMap, index)
  const kinds = best.kinds
  const issues = []

  // 逐句校验
  const outLines = lines.map((lineText, i) => {
    const chars = Array.from(lineText)
    const kind = kinds[i]
    const tpl = form.lineMap[kind]
    const cells = checkLine(chars, tpl, index)
    const isRhymeLine = kind === 'B' || kind === 'D'

    cells.forEach((c, j) => {
      if (c.status === 'error') {
        issues.push({
          level: 'error',
          code: 'tone-hard',
          line: i + 1,
          col: j + 1,
          ch: c.ch,
          expected: c.expected,
          actual: c.actual,
          message: `第 ${i + 1} 句第 ${j + 1} 字「${c.ch}」应为${c.expected}声，实为${c.actual}声（二四六分明）`,
        })
      } else if (c.status === 'loose') {
        // 「一三五不论」的偏差本身完全正常，只作提示；真正的风险（孤平/三平调）另行判定
        issues.push({
          level: 'info',
          code: 'tone-soft',
          line: i + 1,
          col: j + 1,
          ch: c.ch,
          expected: c.expected,
          actual: c.actual,
          message: `第 ${i + 1} 句第 ${j + 1} 字「${c.ch}」宜${c.expected}而用${c.actual}（一三五不论，可通融）`,
        })
      }
    })
    return { text: chars, kind, tpl, chars: cells, rhymeLine: isRhymeLine }
  })

  // 孤平 / 三平调 / 三仄尾
  // 孤平只出现在 B 型（平平仄仄平 / 仄仄平平仄仄平）——首字（七言为第三字）该平而用仄，
  // 致全句除韵脚外只剩一个平声。D 型（仄仄仄平平）本就是三仄开头，不是孤平，不能一并判定。
  outLines.forEach((ln, i) => {
    if (ln.kind === 'B' && isGuping(ln.text, index)) {
      issues.push({ level: 'error', code: 'guping', line: i + 1, message: `第 ${i + 1} 句犯孤平：除韵脚外只剩一个平声字` })
    }
    const t = tailTones(ln.text, index)
    if (t.sanPing) issues.push({ level: 'error', code: 'sanping', line: i + 1, message: `第 ${i + 1} 句犯三平调：句末三字全平` })
    if (t.sanZe && ln.kind !== 'B' && ln.kind !== 'D') {
      issues.push({ level: 'warn', code: 'sanze', line: i + 1, message: `第 ${i + 1} 句为三仄尾（小疵，可接受）` })
    }
  })

  // 押韵
  const rhyme = checkRhyme(lines, kinds, index)
  issues.push(...rhyme.issues)

  // 律诗对仗：机器判不了，只提示人工确认
  if (lines.length === 8) {
    issues.push({ level: 'info', code: 'duizhang', line: 3, message: '律诗颔联（3-4 句）、颈联（5-6 句）宜对仗，请自行核对' })
  }

  const hasError = issues.some((i) => i.level === 'error')
  const tplOfStart = form.lineMap[best.start]
  return {
    ok: !hasError,
    form: {
      // key 供 UI 做本地化：'5-4' = 五言四句，'7-8' = 七言八句
      key: `${charsPerLine}-${lines.length}`,
      type: form.names[lines.length], // 中文兜底（Node 测试 / 日志可读）
      charsPerLine,
      lineCount: lines.length,
    },
    pattern: {
      start: best.start,
      seq: kinds.join(''),
      score: Math.round(best.hard * 100),
      // 本地化用：平起/仄起看首句第二字；平收即首句入韵
      startTone: tplOfStart[1],
      rhymed: tplOfStart[charsPerLine - 1] === TONE_PING,
      name: patternName(best.start, form.lineMap, charsPerLine), // 中文兜底
    },
    lineMap: form.lineMap,
    lines: outLines,
    rhyme,
    issues,
    notes,
  }
}

/* ---------------- 韵部查询 ---------------- */

// 单字：平仄 + 所属韵部
export function lookupChar(index, ch) {
  const t = toneOf(index, ch)
  const rhymes = index.rhymeOf.get(ch) || []
  return {
    ch,
    tone: t,
    rhymes: rhymes.map((r) => ({ part: r.part, name: r.name })),
  }
}

// 韵部字表（按韵部名精确查）
export function groupChars(index, name) {
  const g = index.groups.get(name)
  return g ? { ...g } : null
}

// 韵目一览：按声部给出全部韵部，供下拉选择
export function rhymeCatalog(index) {
  const byPart = new Map()
  for (const [name, g] of index.groups) {
    if (!byPart.has(g.part)) byPart.set(g.part, [])
    byPart.get(g.part).push({ name, count: g.chars.length })
  }
  return [...byPart.entries()].map(([part, items]) => ({ part, items }))
}
