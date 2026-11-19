// 词牌格律校验 —— 纯计算，不依赖 DOM / 网络，可在 Node 直接测试。
//
// 与 poemmeter.js 的设计原则一致（宁可漏报不可误报），但词与近体诗的规则差异决定了三处不同：
//
//   1. 词谱是「逐字谱」，每个字都标了平/仄/中，不像近体诗只有四种句式。
//      因此不能再套「一三五不论」：谱标『中』的位放行，标平/仄的位如实比对。
//      但除韵脚外的不符只记 warn（记作「出谱」），不判 error——
//      钦定词谱的标注以例词为准，同一词牌各体之间本就有出入，把非韵脚一律判错会大面积误报。
//   2. 词的用韵是《词林正韵》19 部，比诗韵宽（邻韵通押），且允许换韵、叶韵。
//      韵位信息直接来自词谱的句读标记，不靠推断。
//   3. 词有体（同一词牌多种字数/句读），必须按总字数选体，同字数再比平仄吻合度。
//
// 数据依赖：
//   - 词谱 + 词韵：classics/citunes.json.gz（scripts/fetch-citunes.mjs 生成）
//   - 平仄：classics/rhyme.json.gz（poemmeter 的 index，词与诗共用一套平仄字表）

import { toneOf, TONE_PING, TONE_ZE, TONE_MULTI } from './poemmeter.js'

/* ---------------- 谱串编解码 ---------------- */

// 与 scripts/fetch-citunes.mjs 保持一致：值 = 35 + 平仄码 * 7 + 标记码
const TONES = ['中', '平', '仄']
const MARKS = ['', '读', '句', '韵', '叶', '叠', '换']

export const MARK_NONE = 0
export const MARK_READ = 1
export const MARK_SENT = 2
export const MARK_RHYME = 3
export const MARK_YE = 4
export const MARK_DIE = 5
export const MARK_HUAN = 6

export function decodeCell(ch) {
  const v = ch.charCodeAt(0) - 35
  if (v < 0 || v > 20) throw new Error(`词谱编码异常：${JSON.stringify(ch)}`)
  return { tone: TONES[(v / 7) | 0], mark: v % 7, markName: MARKS[v % 7] }
}

/* ---------------- 索引 ---------------- */

// 同一词牌的常用别名。词牌异名极多（水调歌头又名元会曲、凯歌、花犯念奴、江南好…），
// 用户按别名搜不到谱，功能等于废掉一半。只收高频别名，宁可查不到也不乱指。
const ALIASES = {
  忆江南: ['望江南', '江南好', '梦江南', '望江梅', '谢秋娘', '春去也'],
  蝶恋花: ['鹊踏枝', '凤栖梧', '黄金缕', '卷珠帘', '鱼水同欢'],
  念奴娇: ['百字令', '大江东去', '酹江月', '赤壁词', '大江西上曲', '壶中天'],
  水调歌头: ['元会曲', '凯歌', '台城游', '花犯念奴', '水调'],
  如梦令: ['忆仙姿', '宴桃源', '比梅', '如意令'],
  临江仙: ['谢新恩', '雁后归', '画屏春', '庭院深深'],
  浣溪沙: ['浣纱溪', '小庭花', '满院春', '广寒枝', '试香罗', '清和风'],
  菩萨蛮: ['子夜歌', '重叠金', '花间意', '梅花句', '花溪碧', '晚云烘日'],
  鹧鸪天: ['思佳客', '思越人', '剪朝霞', '骊歌一叠', '醉梅花'],
  清平乐: ['清平乐令', '忆萝月', '醉东风'],
  一剪梅: ['腊梅香', '玉簟秋'],
  满江红: ['上江虹', '念良游', '伤春曲'],
  贺新郎: ['金缕曲', '乳燕飞', '貂裘换酒', '金缕衣', '贺新凉'],
  踏莎行: ['喜朝天', '柳长春', '踏雪行', '芳心苦'],
  生查子: ['楚云深', '梅和柳', '晴色入青山'],
  点绛唇: ['点樱桃', '十八香', '南浦月', '沙头雨', '寻瑶草'],
  木兰花: ['玉楼春', '惜春容', '西湖曲', '春晓曲'],
  玉楼春: ['木兰花', '惜春容', '归朝欢令'],
  相见欢: ['乌夜啼', '秋夜月', '上西楼', '西楼子', '忆真妃'],
  浪淘沙: ['浪淘沙令', '卖花声', '过龙门'],
  卜算子: ['缺月挂疏桐', '百尺楼', '眉峰碧', '楚天遥'],
  虞美人: ['一江春水', '玉壶冰', '虞美人令', '忆柳曲'],
  渔家傲: ['吴门柳', '忍辱仙人', '荆溪咏', '游仙咏'],
  苏幕遮: ['鬓云松令', '古调歌'],
  青玉案: ['横塘路', '西湖路', '青莲池上客'],
  江城子: ['江神子', '村意远', '水晶帘'],
  定风波: ['卷春空', '定风波令', '醉琼枝'],
  雨霖铃: ['雨淋铃', '雨霖铃慢'],
  扬州慢: ['郎州慢'],
  桂枝香: ['疏帘淡月'],
  六丑: ['个侬'],
  兰陵王: ['高冠军'],
  瑞鹤仙: ['一捻红'],
  沁园春: ['寿星明', '洞庭春色', '东仙'],
  风流子: ['内家娇'],
  八声甘州: ['甘州', '潇潇雨', '宴瑶池'],
  石州慢: ['柳色黄', '石州引'],
  望海潮: ['早梅芳'],
  洞仙歌: ['羽仙歌', '洞中仙', '洞仙词'],
  千秋岁: ['千秋节'],
  解语花: ['解语花慢'],
  谒金门: ['空相忆', '花自落', '垂杨碧', '出塞'],
  忆秦娥: ['秦楼月', '双荷叶', '蓬莱阁', '碧云深'],
  南歌子: ['南柯子', '春宵曲', '风蝶令', '望秦川'],
  天仙子: ['万斯年'],
  长相思: ['双红豆', '山渐青', '吴山青', '长相思令'],
  醉花阴: ['九日'],
  凤凰台上忆吹箫: ['忆吹箫'],
}

// 词牌名里的繁体字。818 个词牌名用到的繁体字有限，手工收一张表即可覆盖绝大多数输入。
const T2S = {
  調: '调', 頭: '头', 樓: '楼', 聲: '声', 雲: '云', 風: '风', 間: '间', 憶: '忆', 夢: '梦',
  歸: '归', 來: '来', 時: '时', 長: '长', 門: '门', 東: '东', 見: '见', 處: '处', 點: '点',
  煙: '烟', 塵: '尘', 陽: '阳', 關: '关', 遠: '远', 雙: '双', 鸞: '鸾', 鳳: '凤', 鏡: '镜',
  縷: '缕', 釵: '钗', 鈿: '钿', 簫: '箫', 箏: '筝', 絃: '弦', 絲: '丝', 線: '线', 羅: '罗', 帳: '帐',
  燈: '灯', 燭: '烛', 銀: '银', 紅: '红', 綠: '绿', 藍: '蓝', 黃: '黄', 濃: '浓', 淡: '淡',
  閒: '闲', 靜: '静', 愁: '愁', 淚: '泪', 殘: '残', 斷: '断', 遲: '迟', 曉: '晓', 夜: '夜',
  影: '影', 瘦: '瘦', 嬌: '娇', 豔: '艳', 麗: '丽', 錦: '锦', 繡: '绣', 翠: '翠', 玉: '玉',
  珠: '珠', 瑤: '瑶', 瓊: '琼', 仙: '仙', 宮: '宫', 殿: '殿', 閣: '阁', 臺: '台', 亭: '亭',
  園: '园', 池: '池', 塘: '塘', 橋: '桥', 舟: '舟', 帆: '帆', 江: '江', 湖: '湖', 海: '海',
  溪: '溪', 泉: '泉', 雪: '雪', 霜: '霜', 露: '露', 霞: '霞', 霧: '雾', 花: '花', 草: '草',
  葉: '叶', 枝: '枝', 柳: '柳', 梅: '梅', 桃: '桃', 杏: '杏', 荷: '荷', 菊: '菊', 蘭: '兰',
  竹: '竹', 松: '松', 桂: '桂', 蓮: '莲', 蓉: '蓉', 薇: '薇', 藥: '药', 蟬: '蝉', 鶯: '莺',
  燕: '燕', 雁: '雁', 鴛: '鸳', 鴦: '鸯', 鵲: '鹊', 鶴: '鹤', 鷗: '鸥', 鵬: '鹏', 鱗: '鳞',
  魚: '鱼', 鴉: '鸦', 鴣: '鸪', 鵑: '鹃', 鄉: '乡', 國: '国', 歲: '岁', 華: '华', 髮: '发',
  鬢: '鬓', 顏: '颜', 妝: '妆', 奩: '奁', 幃: '帏', 屏: '屏', 枕: '枕', 衾: '衾', 席: '席',
  盞: '盏', 樽: '樽', 觴: '觞', 醉: '醉', 醒: '醒', 夢: '梦', 魂: '魂', 銷: '销', 凝: '凝',
  佇: '伫', 憑: '凭', 欄: '栏', 桿: '杆', 階: '阶', 砌: '砌', 牆: '墙', 簷: '檐', 窗: '窗',
  戶: '户', 簾: '帘', 幕: '幕', 筵: '筵', 宴: '宴', 歌: '歌', 舞: '舞', 絃: '弦', 管: '管',
  笛: '笛', 鼓: '鼓', 鐘: '钟', 漏: '漏', 更: '更', 籌: '筹', 節: '节', 序: '序', 候: '候',
  暖: '暖', 寒: '寒', 涼: '凉', 熱: '热', 晴: '晴', 陰: '阴', 雨: '雨', 霽: '霁', 霄: '霄',
  漢: '汉', 闕: '阙', 樓: '楼', 觀: '观', 寺: '寺', 廟: '庙', 墳: '坟', 隴: '陇', 隄: '堤',
  岸: '岸', 洲: '洲', 渚: '渚', 汀: '汀', 浦: '浦', 渡: '渡', 津: '津', 潮: '潮', 汐: '汐',
  波: '波', 浪: '浪', 濤: '涛', 瀾: '澜', 漪: '漪', 漣: '涟', 凝: '凝', 滴: '滴', 潺: '潺',
  濺: '溅', 灑: '洒', 潑: '泼', 濕: '湿', 潤: '润', 澤: '泽', 溝: '沟', 渠: '渠', 壑: '壑',
  峰: '峰', 嶺: '岭', 崖: '崖', 岫: '岫', 巖: '岩', 谷: '谷', 洞: '洞', 穴: '穴', 徑: '径',
  蹊: '蹊', 陌: '陌', 阡: '阡', 郊: '郊', 野: '野', 原: '原', 甸: '甸', 疇: '畴', 畝: '亩',
  籬: '篱', 圃: '圃', 苑: '苑', 囿: '囿', 榭: '榭', 軒: '轩', 齋: '斋', 菴: '庵', 廬: '庐',
  舍: '舍', 宅: '宅', 邸: '邸', 驛: '驿', 店: '店', 村: '村', 郭: '郭', 城: '城', 邑: '邑',
  郡: '郡', 州: '州', 府: '府', 縣: '县', 京: '京', 都: '都', 闤: '阛', 闠: '阓', 巷: '巷',
  街: '街', 市: '市', 井: '井', 竈: '灶', 廚: '厨', 倉: '仓', 庫: '库', 鞍: '鞍', 馬: '马',
  車: '车', 轎: '轿', 船: '船', 槳: '桨', 櫓: '橹', 篙: '篙', 帆: '帆', 纜: '缆', 錨: '锚',
}

// 繁简归一。逐字查表，表外原样保留。
export function normalizeTuneName(name) {
  return Array.from(String(name || '').trim()).map((ch) => T2S[ch] || ch).join('')
}

function buildAliasIndex(names) {
  const set = new Set(names)
  const map = new Map() // 别名 → 规范名（仅当别名本身不是正式词牌、且规范名存在时生效）
  for (const [canon, list] of Object.entries(ALIASES)) {
    if (!set.has(canon)) continue
    for (const a of list) if (!set.has(a) && !map.has(a)) map.set(a, canon)
  }
  return map
}

// 词韵索引：字 → [{ part, tone }]
function buildRhyme(data) {
  const idx = new Map()
  let total = 0
  for (const [part, groups] of Object.entries(data.rhyme || {})) {
    for (const [tone, str] of Object.entries(groups)) {
      for (const ch of str) {
        if (!idx.has(ch)) idx.set(ch, [])
        const list = idx.get(ch)
        if (!list.some((x) => x.part === part && x.tone === tone)) list.push({ part, tone })
        total++
      }
    }
  }
  return { idx, multi: new Set(Array.from(data.rhymeMulti || '')), half: new Set(Array.from(data.rhymeHalf || '')), total }
}

// 把 fetch-citunes.mjs 的产物转成查询索引。
// 谱串不预解码：818 词牌 / 2475 体 / 19.5 万字，全部展开成对象会占十几 MB 内存且拖慢首屏；
// 只在用户选体时才解码那一体（最多一两百字）。
export function buildCiIndex(data) {
  if (!data || !data.ci) throw new Error('词谱数据结构异常（缺少 ci 字段）')
  const names = Object.keys(data.ci)
  const sketchPool = data.sketch || []
  const byName = new Map()
  const byLen = new Map() // 字数 → [{ name, fi }]
  let formats = 0
  for (const name of names) {
    const entry = data.ci[name]
    const fs = (entry.f || []).map((f, fi) => ({
      // 格律描述（「双调九十五字，前段九句四平韵…」）在传输时做了池化：同一描述只存一份，
      // 每体存索引。2475 体里只有 1805 种不同描述，池化省下约 40 KB。
      sketch: sketchPool[f.s] ?? '',
      author: f.a,
      desc: f.d,
      p: f.p,
      split: f.b || 0,
      len: f.p.length,
      fi,
    }))
    formats += fs.length
    byName.set(name, { desc: entry.d || '', formats: fs })
    for (const f of fs) {
      if (!byLen.has(f.len)) byLen.set(f.len, [])
      byLen.get(f.len).push({ name, fi: f.fi })
    }
  }
  const rhyme = buildRhyme(data)
  return {
    names: names.sort((a, b) => a.localeCompare(b, 'zh')),
    byName,
    byLen,
    alias: buildAliasIndex(names),
    rhyme,
    stats: data.stats || {},
  }
}

/* ---------------- 检索 ---------------- */

// 词牌名归一：去空白、繁→简、别名→规范名
export function resolveTune(index, input) {
  const raw = normalizeTuneName(input).replace(/[\s·・]/g, '')
  if (!raw) return null
  if (index.byName.has(raw)) return raw
  const canon = index.alias.get(raw)
  if (canon && index.byName.has(canon)) return canon
  // 去掉书名号/引号后再试
  const stripped = raw.replace(/[《》〈〉「」『』"']/g, '')
  if (index.byName.has(stripped)) return stripped
  const c2 = index.alias.get(stripped)
  if (c2 && index.byName.has(c2)) return c2
  return null
}

// 按字数找候选词牌（用于未指定词牌时的自动识别）
export function suggestTunes(index, len, limit = 8) {
  const hits = index.byLen.get(len) || []
  const seen = new Map()
  for (const h of hits) seen.set(h.name, (seen.get(h.name) || 0) + 1)
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}

/* ---------------- 文本解析 ---------------- */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

// 词的分句：顿号「、」是句内顿（读），不切；其余中文标点都是句界。
export function parseCiLines(text) {
  const raw = String(text || '')
  const lines = []
  for (const block of raw.split(/\r?\n/)) {
    const t = block.trim()
    if (!t || !CJK.test(t)) continue
    for (const seg of t.split(/[，。！？；：,.!?;:…—「」『』“”‘’（）()]+/)) {
      const chars = Array.from(seg).filter((ch) => CJK.test(ch))
      if (chars.length) lines.push(chars.join(''))
    }
  }
  return lines
}

// 只取汉字（含数字？词中「一二三」是汉字，保留；阿拉伯数字与拉丁字母剔除）
export function extractChars(text) {
  return Array.from(String(text || '')).filter((ch) => CJK.test(ch))
}

/* ---------------- 选体 ---------------- */

// 按字数分成三段：完全吻合 / 差 1-2 字（可能有添字减字） / 其余
function decodeFormat(f) {
  const cells = []
  for (const ch of f.p) cells.push(decodeCell(ch))
  return cells
}

// 一行一格：以 mark >= 句 为行界（读不断行，符合词谱排版习惯）
function splitIntoLines(cells) {
  const lines = []
  let cur = []
  cells.forEach((c, i) => {
    cur.push({ ...c, pos: i })
    if (c.mark >= MARK_SENT) {
      lines.push(cur)
      cur = []
    }
  })
  if (cur.length) lines.push(cur)
  return lines
}

// 对一体的谱逐字比对。chars 已按字数对齐（不足补 undefined）。
function compareFormat(chars, cells, toneIndex) {
  let hit = 0
  let judged = 0
  let off = 0
  cells.forEach((cell, i) => {
    const ch = chars[i]
    if (!ch) return
    const actual = toneOf(toneIndex, ch)
    if (cell.tone === '中' || !actual || actual === TONE_MULTI) return
    judged++
    if (actual === cell.tone) hit++
    else if (cell.mark === MARK_RHYME || cell.mark === MARK_YE) off += 2 // 韵位出谱，权重加倍
    else off += 1
  })
  return { hit, judged, off, rate: judged ? hit / judged : 0 }
}

/* ---------------- 押韵 ---------------- */

// 词韵：查词林正韵。返回该字所属部（可能多个）+ 是否跨部/待定（放行）。
function ciRhymeOf(ciIndex, ch) {
  if (ciIndex.rhyme.multi.has(ch)) return { parts: [], free: true, reason: 'multi' }
  const list = ciIndex.rhyme.idx.get(ch) || []
  if (!list.length) {
    if (ciIndex.rhyme.half.has(ch)) return { parts: [], free: true, reason: 'half' }
    return { parts: [], free: false, reason: 'unknown' }
  }
  return { parts: [...new Set(list.map((x) => x.part))], free: false, reason: null }
}

// 韵位分组：连续同类型的韵脚算一组；类型切换（平韵→仄韵）即换韵，重新起组。
// 「叶」韵不另起组，按同部仄声处理。
function checkCiRhyme(chars, cells, ciIndex, userEnds = null, toneIndex = null) {
  const feet = []
  cells.forEach((cell, i) => {
    if (cell.mark !== MARK_RHYME && cell.mark !== MARK_YE) return
    const ch = chars[i]
    if (!ch) return
    const info = ciRhymeOf(ciIndex, ch)
    feet.push({
      pos: i,
      ch,
      type: cell.mark === MARK_YE ? 'ye' : cell.tone === '仄' ? 'ze' : cell.tone === '平' ? 'ping' : 'any',
      expected: cell.tone,
      parts: info.parts,
      free: info.free,
      reason: info.reason,
    })
  })
  if (!feet.length) return { ok: true, feet, groups: [], issues: [] }

  const issues = []
  // 平仄：平韵位须平声，仄韵位须仄声（谱标「中」的不判）
  for (const f of feet) {
    if (f.expected === '中') continue
    const actual = f.actualTone
    if (!actual || actual === TONE_MULTI) continue
    if (actual !== f.expected) {
      issues.push({
        level: 'error',
        code: 'ci-rhyme-tone',
        pos: f.pos,
        ch: f.ch,
        expected: f.expected,
        actual,
      })
    }
  }

  // 分组：连续的同类韵位算一组，类型切换（平韵↔仄韵）即换韵，另起一组。
  // 「叶」韵跟随当前组，不单独起组。
  const groups = []
  let cur = null
  for (const f of feet) {
    if (!cur || (f.type !== 'ye' && f.type !== 'any' && cur.type !== 'any' && f.type !== cur.type)) {
      cur = { type: f.type === 'ye' ? 'any' : f.type, feet: [] }
      groups.push(cur)
    }
    cur.feet.push(f)
    if (cur.type === 'any' && f.type !== 'ye' && f.type !== 'any') cur.type = f.type
  }

  // 组内定部。
  //
  // 入声邻部通押必须放行：词林正韵按韵尾把入声分成五部（-k / -t / -p），
  // 但宋人实际常把 -k 与 -t 混押——苏轼《念奴娇》「物、壁、雪、杰、发、灭、发、月」，
  // 「壁」属第十七部（陌），其余属第十八部（月屑），历来公认合律。
  // 若按部分死判，这首千古名篇会被标成「出韵」，工具立刻失去可信度。
  for (const g of groups) {
    const judged = g.feet.filter((f) => !f.free && f.parts.length)
    if (judged.length < 2) continue
    const baseParts = judged[0].parts
    const basePart = baseParts[0]
    const baseCh = judged[0].ch
    for (const f of judged.slice(1)) {
      if (f.parts.some((p) => baseParts.includes(p))) continue
      // 词林正韵把平水韵的十灰、九佳、十三元等「半韵」拆到两部（如十灰的「杯/回」入第三部、
      // 「台/来」入第五部），但宋人写词仍在本韵内部通押——晏殊「一杯/旧亭台/几时回/燕归来」
      // 就是标准例证。同属一个平水韵部者按通押放行，只作提示。
      const tongyong = toneIndex ? samePingshuiGroup(toneIndex, baseCh, f.ch) : false
      const ruSheng =
        isRuSheng(basePart) && f.parts.every((p) => isRuSheng(p))
      // 断句差异：同一词牌常有多个同字数但断句不同的体（《青玉案》贺铸体与辛弃疾体都是 67 字）。
      // 用户写的是词谱未收的另一种断句时，谱上的韵位会整体错位，把句中的字当成韵脚。
      // 若该位置在用户的断句里并不是句末，就只能判「断句与词谱不同」，不能判混韵。
      const shifted = !ruSheng && userEnds && !userEnds.has(f.pos)
      const soft = ruSheng || tongyong || shifted
      issues.push({
        level: soft ? 'info' : 'error',
        code: ruSheng ? 'ci-rhyme-ru' : tongyong ? 'ci-rhyme-tong' : shifted ? 'ci-rhyme-shift' : 'ci-rhyme-mixed',
        pos: f.pos,
        ch: f.ch,
        parts: f.parts,
        base: basePart,
      })
    }
  }

  return { ok: !issues.some((i) => i.level === 'error'), feet, groups: groups.map((g) => ({ type: g.type, feet: g.feet })), issues }
}

// 词林正韵第十五～十九部为入声（屋沃 / 觉药 / 质陌锡职缉 / 物月曷黠屑叶 / 合洽）
const RU_SHENG = new Set(['第十五部', '第十六部', '第十七部', '第十八部', '第十九部'])

function isRuSheng(part) {
  return RU_SHENG.has(part)
}

// 两个字是否同属一个平水韵部（用于词韵「半韵」通押的放行判定）
function samePingshuiGroup(toneIndex, a, b) {
  const ga = toneIndex?.rhymeOf?.get(a)
  const gb = toneIndex?.rhymeOf?.get(b)
  if (!ga || !gb) return false
  return ga.some((x) => gb.some((y) => y.name === x.name))
}

// 句读对齐代价：同一词牌常有多个同字数的体（如《青玉案》贺铸体与辛弃疾体都是 67 字，
// 但「玉壶光转」在贺铸体里不是韵位、在辛体里也不是——断句错位会让韵位整体漂移，
// 把好词判成「出韵」）。这里用动态规划比较用户句长序列与谱句长序列，
// 允许用户少打标点（谱两句并作一句）或多打标点（谱一句拆成两句），按代价择低。
function lineCost(userLens, fmtLens) {
  if (userLens.length < 2) return 0 // 用户没分句（或只有一句），无从比较，不参与评分
  const n = fmtLens.length
  const m = userLens.length
  const INF = 1e9
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF))
  dp[0][0] = 0
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const v = dp[i][j]
      if (v >= INF) continue
      if (i < n && j < m) {
        const add = fmtLens[i] === userLens[j] ? 0 : 2
        if (v + add < dp[i + 1][j + 1]) dp[i + 1][j + 1] = v + add
      }
      if (i + 1 < n && j < m && fmtLens[i] + fmtLens[i + 1] === userLens[j]) {
        if (v + 1 < dp[i + 2][j + 1]) dp[i + 2][j + 1] = v + 1
      }
      if (i < n && j + 1 < m && fmtLens[i] === userLens[j] + userLens[j + 1]) {
        if (v + 1 < dp[i + 1][j + 2]) dp[i + 1][j + 2] = v + 1
      }
    }
  }
  return dp[n][m] >= INF ? 99 : dp[n][m]
}

// 用户的押韵画像：从句末字反推「这首词押了几个韵脚、押哪一部」。
//
// 为什么需要它：同一词牌同字数但韵数不同的体很多（《青玉案》贺铸体五仄韵、苏轼体四仄韵，都是 67 字）。
// 只按平仄吻合率选体，会选中韵数不符的那个，于是把用户没押韵的句子当成韵脚，报出「出韵」。
// 先数用户实际押了几处，再挑韵数对得上的体，这类误报从根上消失。
function userRhymeProfile(lines, ciIndex) {
  if (lines.length < 3) return null
  const ends = []
  for (const l of lines) {
    const arr = Array.from(l)
    if (arr.length) ends.push(arr[arr.length - 1])
  }
  const counts = new Map()
  for (const ch of ends) {
    for (const p of ciRhymeOf(ciIndex, ch).parts) counts.set(p, (counts.get(p) || 0) + 1)
  }
  if (!counts.size) return null
  const max = Math.max(...counts.values())
  if (max < 3) return null // 押韵迹象不明显，不参与选体
  const mainParts = new Set([...counts.entries()].filter(([, v]) => v === max).map(([k]) => k))
  const count = ends.filter((ch) => ciRhymeOf(ciIndex, ch).parts.some((p) => mainParts.has(p))).length
  return { count, parts: [...mainParts] }
}

/* ---------------- 主流程 ---------------- */

// options:
//   tuneName  指定词牌（可空，空则按字数自动识别）
//   formatIndex 指定第几体（可空，空则选吻合度最高）
export function analyzeCi(text, { ciIndex, toneIndex, tuneName = '', formatIndex = null } = {}) {
  if (!ciIndex) throw new Error('缺少词谱索引')
  const lines = parseCiLines(text)
  const chars = extractChars(text)

  if (!chars.length) {
    return {
      ok: false,
      fatal: { code: 'noLines', params: {}, message: '未识别到字词，请粘贴词作（可带标点，也可只写正文）' },
      lines: [],
      issues: [],
      chars,
      score: 0,
    }
  }

  // 候选体
  let candidates = []
  const resolved = tuneName ? resolveTune(ciIndex, tuneName) : null
  if (tuneName && !resolved) {
    return {
      ok: false,
      fatal: { code: 'tuneNotFound', params: { name: tuneName }, message: `词谱中找不到《${tuneName}》，请检查词牌名（可尝试常用别名）` },
      lines: [],
      issues: [],
      chars,
      score: 0,
    }
  }
  if (resolved) {
    const entry = ciIndex.byName.get(resolved)
    candidates = entry.formats.map((f) => ({ name: resolved, f }))
  } else {
    // 自动识别：先取字数完全一致的体；没有则取 ±2 字以内的体
    for (const d of [0, 1, -1, 2, -2]) {
      const hits = ciIndex.byLen.get(chars.length + d) || []
      for (const h of hits) candidates.push({ name: h.name, f: ciIndex.byName.get(h.name).formats[h.fi], delta: d })
      if (candidates.length >= 12) break
    }
  }

  if (!candidates.length) {
    return {
      ok: false,
      fatal: {
        code: 'noFormat',
        params: { n: chars.length },
        message: `没有字数吻合的词牌（共 ${chars.length} 字），请手动指定词牌名`,
      },
      lines: [],
      issues: [],
      chars,
      score: 0,
    }
  }

  // 排位：字数差 → 句读代价 → 平仄吻合率，三项合成一个代价分（越小越好）。
  // 权重是调出来的：字数最硬（差 1 字基本就不是同一体），句读次之，
  // 平仄率最软（谱标「中」的位多，不同体之间常有 10% 上下的自然差异）。
  const userLens = lines.map((l) => Array.from(l).length)
  const profile = userRhymeProfile(lines, ciIndex)
  const scored = candidates.map((c) => {
    const cells = decodeFormat(c.f)
    const cmp = compareFormat(chars, cells, toneIndex)
    const delta = Math.abs(cells.length - chars.length)
    const fmtLens = splitIntoLines(cells).map((l) => l.length)
    const lc = lineCost(userLens, fmtLens)
    const nRhyme = cells.filter((x) => x.mark === MARK_RHYME || x.mark === MARK_YE).length
    const fit = profile ? Math.abs(nRhyme - profile.count) : 0
    return {
      ...c,
      cells,
      cmp,
      delta,
      lc,
      fmtLens,
      nRhyme,
      rank: delta * 8 + lc * 0.6 + (1 - cmp.rate) * 24 + fit * 2,
    }
  })
  scored.sort((a, b) => a.rank - b.rank)
  const best = formatIndex != null && resolved
    ? scored.find((s) => s.f.fi === formatIndex) || scored[0]
    : scored[0]

  const issues = []
  const cells = best.cells
  const fmtLines = splitIntoLines(cells)

  // 字数不符
  if (chars.length !== cells.length) {
    issues.push({
      level: 'error',
      code: 'ci-length',
      params: { got: chars.length, want: cells.length },
    })
  }

  // 逐字比对（按谱的行分组，便于逐行高亮）
  const outLines = []
  let pos = 0
  for (const line of fmtLines) {
    const outCells = []
    for (const cell of line) {
      const ch = chars[cell.pos]
      const actual = ch ? toneOf(toneIndex, ch) : null
      let status
      if (!ch) status = 'missing'
      else if (cell.tone === '中') status = 'free'
      else if (!actual) status = 'unknown'
      else if (actual === TONE_MULTI) status = 'multi'
      else if (actual === cell.tone) status = 'ok'
      else status = cell.mark === MARK_RHYME || cell.mark === MARK_YE ? 'error' : 'off'
      outCells.push({
        ch: ch || '',
        expected: cell.tone,
        mark: cell.mark,
        markName: cell.markName,
        actual,
        status,
        pos: cell.pos,
      })
      if (status === 'error') {
        issues.push({ level: 'error', code: 'ci-tone-rhyme', pos: cell.pos, ch, expected: cell.tone, actual })
      } else if (status === 'off' && chars.length === cells.length) {
        // 字数不符时不逐字报「出谱」：整体错位后几乎每字都会对不上，刷屏且无信息量，
        // 真正的结论由上面那条 ci-length 给出。
        issues.push({ level: 'warn', code: 'ci-tone-off', pos: cell.pos, ch, expected: cell.tone, actual })
      }
    }
    outLines.push({ cells: outCells, start: pos })
    pos += line.length
  }

  // 押韵：先补 tone。
  // 断句明显对不上词谱（句读代价 >= 2）时，把「用户的句末位置」交给押韵判定，
  // 让它能区分「真出韵」与「断句与词谱不同导致韵位错位」。
  const userEnds = new Set()
  let acc = 0
  for (const l of userLens) {
    acc += l
    userEnds.add(acc - 1)
  }
  const rhyme = checkCiRhyme(
    chars,
    cells.map((c, i) => ({ ...c, actualTone: chars[i] ? toneOf(toneIndex, chars[i]) : null })),
    ciIndex,
    best.lc >= 2 && lines.length >= 3 ? userEnds : null,
    toneIndex,
  )
  issues.push(...rhyme.issues)

  // 合谱率
  const judged = outLines.flatMap((l) => l.cells).filter((c) => c.status === 'ok' || c.status === 'off' || c.status === 'error')
  const hit = judged.filter((c) => c.status === 'ok').length
  const rate = judged.length ? Math.round((hit / judged.length) * 100) : 0

  const offCount = issues.filter((i) => i.code === 'ci-tone-off').length
  if (judged.length >= 20 && rate < 70) {
    issues.push({ level: 'warn', code: 'ci-low-rate', params: { rate } })
  }

  return {
    ok: !issues.some((i) => i.level === 'error'),
    tune: {
      name: best.name,
      sketch: best.f.sketch,
      author: best.f.author,
      desc: best.f.desc,
      len: cells.length,
      split: best.f.split,
      formatIndex: best.f.fi,
      auto: !resolved,
      // 同词牌其他体，供 UI 切换
      alternatives: resolved
        ? ciIndex.byName.get(resolved).formats.map((f, i) => ({ i, sketch: f.sketch, author: f.author, len: f.len }))
        : [],
    },
    lines: outLines,
    cells,
    chars,
    rhyme,
    issues,
    score: rate,
    offCount,
    notes: lines.length && lines.length !== fmtLines.length
      ? [{ code: 'ci-line-count', params: { got: lines.length, want: fmtLines.length } }]
      : [],
  }
}

/* ---------------- 填词助手 ---------------- */

// 给出某词牌某体的「格子」：按句分行，每格标平仄与句读，供 UI 逐字对照填写。
export function tuneGrid(ciIndex, name, formatIndex = 0) {
  const resolved = resolveTune(ciIndex, name)
  if (!resolved) return null
  const entry = ciIndex.byName.get(resolved)
  const f = entry.formats[formatIndex] || entry.formats[0]
  if (!f) return null
  const cells = decodeFormat(f)
  const lines = splitIntoLines(cells)
  return {
    name: resolved,
    sketch: f.sketch,
    author: f.author,
    len: f.len,
    split: f.split,
    formats: entry.formats.map((x, i) => ({ i, sketch: x.sketch, author: x.author, len: x.len })),
    lines: lines.map((ln, i) => ({
      index: i,
      cells: ln.map((c) => ({ tone: c.tone, mark: c.mark, markName: c.markName, pos: c.pos })),
      rhyme: ln.some((c) => c.mark === MARK_RHYME || c.mark === MARK_YE),
    })),
  }
}
