<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import HelpTip from '../components/HelpTip.vue'
import { T } from '../lib/i18n.dev.js'
import { loadClassics } from '../lib/classics.js'
import { loadCiTunes } from '../lib/citunes.js'
import { analyzeCi, tuneGrid, resolveTune, MARK_RHYME, MARK_YE, MARK_READ } from '../lib/cimeter.js'

const route = useRoute()
const tab = ref('check')
const loading = ref(true)
const error = ref('')
const ciIndex = ref(null)
const toneIndex = ref(null)

/* ---------------- 示例 ---------------- */
const SAMPLES = [
  { key: 'a', tune: '水调歌头', text: '明月几时有，把酒问青天。不知天上宫阙，今夕是何年。我欲乘风归去，又恐琼楼玉宇，高处不胜寒。起舞弄清影，何似在人间。\n转朱阁，低绮户，照无眠。不应有恨，何事长向别时圆。人有悲欢离合，月有阴晴圆缺，此事古难全。但愿人长久，千里共婵娟。' },
  { key: 'b', tune: '如梦令', text: '昨夜雨疏风骤，浓睡不消残酒。试问卷帘人，却道海棠依旧。知否，知否，应是绿肥红瘦。' },
  { key: 'c', tune: '念奴娇', text: '大江东去，浪淘尽，千古风流人物。故垒西边，人道是、三国周郎赤壁。乱石穿空，惊涛拍岸，卷起千堆雪。江山如画，一时多少豪杰。\n遥想公瑾当年，小乔初嫁了，雄姿英发。羽扇纶巾，谈笑间、樯橹灰飞烟灭。故国神游，多情应笑我，早生华发。人生如梦，一尊还酹江月。' },
  { key: 'd', tune: '雨霖铃', text: '寒蝉凄切，对长亭晚，骤雨初歇。都门帐饮无绪，方留恋处，兰舟催发。执手相看泪眼，竟无语凝噎。念去去、千里烟波，暮霭沉沉楚天阔。\n多情自古伤离别，更那堪、冷落清秋节。今宵酒醒何处，杨柳岸、晓风残月。此去经年，应是良辰好景虚设。便纵有、千种风情，更与何人说。' },
]

/* ---------------- 校验 ---------------- */
const tuneName = ref(SAMPLES[0].tune)
const text = ref(SAMPLES[0].text)
const result = ref(null)
const pickedFormat = ref(null) // null = 自动选体

onMounted(async () => {
  try {
    const [rhyme, ci] = await Promise.all([loadClassics(), loadCiTunes()])
    toneIndex.value = rhyme
    ciIndex.value = ci
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
  // 从「诗文精选」跳过来：词牌与正文都带过来，直接出校验结果
  const qt = route.query.text
  const qn = route.query.tune
  if (typeof qt === 'string' && qt.trim() && toneIndex.value && ciIndex.value) {
    if (typeof qn === 'string' && qn.trim()) tuneName.value = qn
    text.value = qt
    run()
  }
})

function run() {
  if (!ciIndex.value || !toneIndex.value) return
  result.value = analyzeCi(text.value, {
    ciIndex: ciIndex.value,
    toneIndex: toneIndex.value,
    tuneName: tuneName.value.trim(),
    formatIndex: pickedFormat.value,
  })
}

function clear() {
  text.value = ''
  result.value = null
}

function useSample(s) {
  tab.value = 'check'
  tuneName.value = s.tune
  pickedFormat.value = null
  text.value = s.text
  run()
}

// 切语言时重算，让校勘文字跟着变
watch(() => T('views.ciMeter.analyze'), () => {
  if (result.value) run()
})

// 换词牌/换体后重算，避免结果与输入脱节
watch([tuneName, pickedFormat], () => {
  if (result.value) run()
})

// 词牌名建议（datalist）：只给前 200 个，够用且不拖慢输入
const tuneOptions = computed(() => (ciIndex.value ? ciIndex.value.names.slice(0, 300) : []))

const grouped = computed(() => {
  const g = { error: [], warn: [], info: [] }
  for (const it of result.value?.issues || []) (g[it.level] || g.info).push(it)
  return g
})

const hasIssues = computed(() => {
  const g = grouped.value
  return g.error.length + g.warn.length + g.info.length > 0
})

// 韵脚摘要：按韵组展示
const rhymeSummary = computed(() => {
  const r = result.value?.rhyme
  if (!r || !r.feet?.length) return []
  return r.groups.map((g) => ({
    type: g.type,
    chars: g.feet.map((f) => f.ch),
    parts: [...new Set(g.feet.flatMap((f) => f.parts))],
  }))
})

function toneSym(t) {
  // 诗词界通用符号：平 ○ / 仄 ● / 可平可仄 ⊙
  if (t === '平') return '○'
  if (t === '仄') return '●'
  return '⊙'
}

function markSym(m) {
  if (m === MARK_RHYME) return '韵'
  if (m === MARK_YE) return '叶'
  if (m === MARK_READ) return '读'
  return ''
}

function fatalText(f) {
  if (!f) return ''
  const map = {
    noLines: 'views.ciMeter.fatal.noLines',
    tuneNotFound: 'views.ciMeter.fatal.tuneNotFound',
    noFormat: 'views.ciMeter.fatal.noFormat',
  }
  return T(map[f.code] || '', f.params || {}) || f.message
}

function issueText(it) {
  return T('views.ciMeter.issues.' + it.code, { ...it }) || it.code
}

// 体选择器：切换词牌后列出该词牌全部体
const formatsOfTune = computed(() => {
  if (!ciIndex.value) return []
  const name = resolveTune(ciIndex.value, tuneName.value)
  return name ? ciIndex.value.byName.get(name).formats : []
})

/* ---------------- 填词助手 ---------------- */
const wTune = ref('如梦令')
const wFormat = ref(0)
const wText = ref('')

const wGrid = computed(() => {
  if (!ciIndex.value) return null
  return tuneGrid(ciIndex.value, wTune.value, wFormat.value)
})

const wFormats = computed(() => wGrid.value?.formats || [])

watch(wTune, () => { wFormat.value = 0 })

// 填词页的实时校验：输入为空时只显示谱，有字则逐格判定
const wResult = computed(() => {
  if (!ciIndex.value || !toneIndex.value || !wText.value.trim()) return null
  return analyzeCi(wText.value, {
    ciIndex: ciIndex.value,
    toneIndex: toneIndex.value,
    tuneName: wTune.value,
    formatIndex: wFormat.value,
  })
})

// 统一渲染结构：有校验结果用结果的格子（带 user 字与状态），否则用纯谱
const writeLines = computed(() => {
  const r = wResult.value
  if (r && !r.fatal) {
    return r.lines.map((l) => ({
      cells: l.cells.map((c) => ({ tone: c.expected, mark: c.mark, ch: c.ch, status: c.status, actual: c.actual })),
    }))
  }
  const g = wGrid.value
  if (!g) return []
  return g.lines.map((l) => ({
    cells: l.cells.map((c) => ({ tone: c.tone, mark: c.mark, ch: '', status: 'missing', actual: null })),
  }))
})

const writeRate = computed(() => (wResult.value && !wResult.value.fatal ? wResult.value.score : null))
const writeFatal = computed(() => (wResult.value?.fatal ? fatalText(wResult.value.fatal) : ''))
</script>

<template>
  <div class="view-ci-meter">
    <header class="head">
      <h1>
        <i class="bi bi-music-note-list"></i>
        {{ T('views.ciMeter.title') }}
      </h1>
      <p class="sub">{{ T('views.ciMeter.sub') }}</p>
    </header>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'check' }" @click="tab = 'check'">
        <i class="bi bi-check2-square"></i> {{ T('views.ciMeter.tabCheck') }}
      </button>
      <button class="tab" :class="{ active: tab === 'write' }" @click="tab = 'write'">
        <i class="bi bi-pencil-square"></i> {{ T('views.ciMeter.tabWrite') }}
      </button>
    </div>

    <div v-if="loading" class="msg info">{{ T('views.ciMeter.loading') }}</div>
    <div v-else-if="error" class="msg err">{{ T('views.ciMeter.loadFail') }}：{{ error }}</div>

    <template v-else>
      <!-- 校验 -->
      <div v-if="tab === 'check'" class="panel">
        <div class="row">
          <label class="field tune-field">
            <span>{{ T('views.ciMeter.tuneLabel') }}</span>
            <input
              v-model="tuneName"
              list="ci-tune-list"
              :placeholder="T('views.ciMeter.tunePlaceholder')"
              @change="pickedFormat = null"
            />
            <datalist id="ci-tune-list">
              <option v-for="n in tuneOptions" :key="n" :value="n" />
            </datalist>
          </label>
          <label v-if="formatsOfTune.length > 1" class="field">
            <span>{{ T('views.ciMeter.formatLabel') }}</span>
            <select :value="pickedFormat ?? ''" @change="pickedFormat = $event.target.value === '' ? null : Number($event.target.value)">
              <option value="">{{ T('views.ciMeter.formatAuto') }}</option>
              <option v-for="(f, i) in formatsOfTune" :key="i" :value="i">
                {{ f.len }}{{ T('views.ciMeter.charsUnit') }} · {{ f.author }} · {{ f.sketch }}
              </option>
            </select>
          </label>
        </div>

        <label class="field" style="width:100%">
          <span>{{ T('views.ciMeter.inputLabel') }}</span>
          <textarea
            v-model="text"
            rows="8"
            spellcheck="false"
            :placeholder="T('views.ciMeter.placeholder')"
            class="ci-input"
            @input="result = null"
          ></textarea>
        </label>

        <div class="row">
          <button class="btn" :disabled="!text.trim()" @click="run">
            <i class="bi bi-check2-circle"></i> {{ T('views.ciMeter.analyze') }}
          </button>
          <button class="btn ghost" @click="clear">
            <i class="bi bi-eraser"></i> {{ T('views.ciMeter.clear') }}
          </button>
          <span class="sample-row">
            <span class="sample-label">{{ T('views.ciMeter.samplesLabel') }}</span>
            <button v-for="s in SAMPLES" :key="s.key" class="chip" @click="useSample(s)">
              {{ T('views.ciMeter.samples.' + s.key) }}
            </button>
          </span>
        </div>

        <template v-if="result">
          <div v-if="result.fatal" class="msg err">{{ fatalText(result.fatal) }}</div>

          <template v-else>
            <div class="verdict" :class="result.ok ? 'pass' : 'fail'">
              <i class="bi" :class="result.ok ? 'bi-patch-check' : 'bi-exclamation-diamond'"></i>
              <b>{{ result.ok ? T('views.ciMeter.pass') : T('views.ciMeter.fail') }}</b>
              <span class="sep">·</span>
              <span>《{{ result.tune.name }}》</span>
              <span class="sep">·</span>
              <span>{{ result.tune.len }}{{ T('views.ciMeter.charsUnit') }} · {{ result.tune.author }}</span>
              <span class="sep">·</span>
              <span class="muted">{{ T('views.ciMeter.matchRate') }} {{ result.score }}%</span>
            </div>

            <div class="sketch-line">
              <i class="bi bi-info-circle"></i>
              <span>{{ result.tune.sketch }}</span>
              <em v-if="result.tune.auto" class="auto-tag">{{ T('views.ciMeter.autoTag') }}</em>
            </div>
            <p v-if="result.tune.desc" class="fmt-desc">{{ result.tune.desc }}</p>

            <div v-if="rhymeSummary.length" class="rhyme-line">
              <span class="rl-label">{{ T('views.ciMeter.rhymeGroups') }}</span>
              <span v-for="(g, i) in rhymeSummary" :key="i" class="tag accent">
                <span class="feet">{{ g.chars.join(' ') }}</span>
                <em v-if="g.parts.length" class="part">{{ g.parts.join('/') }}</em>
              </span>
            </div>

            <div class="meter">
              <div class="meter-head">{{ T('views.ciMeter.gridTitle') }}</div>
              <div v-for="(ln, i) in result.lines" :key="i" class="mline">
                <span class="ln-no">{{ i + 1 }}</span>
                <span class="cells">
                  <span
                    v-for="(c, j) in ln.cells"
                    :key="j"
                    class="cell"
                    :class="[c.status, { foot: c.mark === MARK_RHYME || c.mark === MARK_YE }]"
                    :title="`${c.ch}：${c.actual || '?'}（谱 ${c.expected}）`"
                  >
                    <small class="spec">{{ toneSym(c.expected) }}</small>
                    <b>{{ c.ch }}</b>
                    <small class="mk">{{ markSym(c.mark) }}</small>
                  </span>
                </span>
              </div>
              <div class="legend">
                <span class="lg ok"><i></i>{{ T('views.ciMeter.legendOk') }}</span>
                <span class="lg off"><i></i>{{ T('views.ciMeter.legendOff') }}</span>
                <span class="lg err"><i></i>{{ T('views.ciMeter.legendErr') }}</span>
                <span class="lg multi"><i></i>{{ T('views.ciMeter.legendMulti') }}</span>
                <span class="lg unknown"><i></i>{{ T('views.ciMeter.legendUnknown') }}</span>
                <span class="lg spec">{{ T('views.ciMeter.legendSpec') }}</span>
              </div>
            </div>

            <div class="issues">
              <div class="issues-head">{{ T('views.ciMeter.issuesTitle') }}</div>
              <div v-if="!hasIssues" class="msg ok">{{ T('views.ciMeter.noIssues') }}</div>
              <ul v-else class="issue-list">
                <li v-for="(it, k) in grouped.error" :key="'e' + k" class="it error">
                  <i class="bi bi-x-circle-fill"></i>
                  <span>{{ issueText(it) }}</span>
                  <em v-if="it.pos != null" class="ln-tag">{{ it.pos + 1 }}</em>
                </li>
                <li v-for="(it, k) in grouped.warn" :key="'w' + k" class="it warn">
                  <i class="bi bi-exclamation-triangle-fill"></i>
                  <span>{{ issueText(it) }}</span>
                  <em v-if="it.pos != null" class="ln-tag">{{ it.pos + 1 }}</em>
                </li>
                <li v-for="(it, k) in grouped.info" :key="'i' + k" class="it info">
                  <i class="bi bi-info-circle"></i>
                  <span>{{ issueText(it) }}</span>
                  <em v-if="it.pos != null" class="ln-tag">{{ it.pos + 1 }}</em>
                </li>
              </ul>
            </div>

            <div v-if="result.tune.alternatives.length > 1" class="alt">
              <div class="alt-head">{{ T('views.ciMeter.altTitle') }}</div>
              <div class="alt-list">
                <button
                  v-for="a in result.tune.alternatives"
                  :key="a.i"
                  class="chip"
                  :class="{ on: a.i === result.tune.formatIndex }"
                  @click="pickedFormat = a.i"
                >
                  {{ a.len }}{{ T('views.ciMeter.charsUnit') }} · {{ a.author }}
                </button>
              </div>
            </div>

            <p class="disclaimer">{{ T('views.ciMeter.disclaimer') }}</p>
          </template>
        </template>
      </div>

      <!-- 填词助手 -->
      <div v-else class="panel">
        <div class="row">
          <label class="field tune-field">
            <span>{{ T('views.ciMeter.tuneLabel') }}</span>
            <input v-model="wTune" list="ci-tune-list" :placeholder="T('views.ciMeter.tunePlaceholder')" />
          </label>
          <label v-if="wFormats.length > 1" class="field">
            <span>{{ T('views.ciMeter.formatLabel') }}</span>
            <select v-model.number="wFormat">
              <option v-for="f in wFormats" :key="f.i" :value="f.i">
                {{ f.len }}{{ T('views.ciMeter.charsUnit') }} · {{ f.author }} · {{ f.sketch }}
              </option>
            </select>
          </label>
          <span class="rate" v-if="writeRate !== null">
            {{ T('views.ciMeter.matchRate') }} <b>{{ writeRate }}%</b>
          </span>
        </div>

        <div v-if="!wGrid" class="msg warn">{{ T('views.ciMeter.writeNoTune') }}</div>

        <template v-else>
          <div class="sketch-line">
            <i class="bi bi-info-circle"></i>
            <span>{{ wGrid.sketch }}</span>
            <em class="auto-tag">{{ wGrid.len }}{{ T('views.ciMeter.charsUnit') }}</em>
          </div>

          <div class="meter write">
            <div v-for="(ln, i) in writeLines" :key="i" class="mline">
              <span class="ln-no">{{ i + 1 }}</span>
              <span class="cells">
                <span
                  v-for="(c, j) in ln.cells"
                  :key="j"
                  class="cell"
                  :class="[c.status, { foot: c.mark === MARK_RHYME || c.mark === MARK_YE }]"
                >
                  <small class="spec">{{ toneSym(c.tone) }}</small>
                  <b>{{ c.ch || '　' }}</b>
                  <small class="mk">{{ markSym(c.mark) }}</small>
                </span>
              </span>
            </div>
            <div class="legend">
              <span class="lg spec">{{ T('views.ciMeter.legendSpec') }}</span>
              <span class="lg ok"><i></i>{{ T('views.ciMeter.legendOk') }}</span>
              <span class="lg off"><i></i>{{ T('views.ciMeter.legendOff') }}</span>
              <span class="lg err"><i></i>{{ T('views.ciMeter.legendErr') }}</span>
            </div>
          </div>

          <label class="field" style="width:100%;margin-top:14px">
            <span>{{ T('views.ciMeter.writeLabel') }}</span>
            <textarea
              v-model="wText"
              rows="6"
              spellcheck="false"
              :placeholder="T('views.ciMeter.writePlaceholder')"
              class="ci-input"
            ></textarea>
          </label>

          <div v-if="writeFatal" class="msg warn">{{ writeFatal }}</div>
          <p class="disclaimer">{{ T('views.ciMeter.writeHint') }}</p>
        </template>
      </div>

      <HelpTip :title="T('views.ciMeter.legendTitle')" :body="T('views.ciMeter.legendBody')" />
    </template>
  </div>
</template>

<style scoped>
.head h1 {
  font-size: 22px;
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--txt, #e8edf7);
}
.head h1 i {
  color: var(--accent, #38bdf8);
}
.sub {
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--muted, #93a2bd);
  margin: 0 0 18px;
  max-width: 78ch;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13.5px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--line, rgba(120, 150, 200, 0.18));
  background: transparent;
  color: var(--muted, #93a2bd);
  cursor: pointer;
}
.tab.active {
  background: rgba(232, 149, 74, 0.14);
  border-color: rgba(232, 149, 74, 0.4);
  color: var(--accent, #38bdf8);
  font-weight: 600;
}
.tune-field {
  min-width: 220px;
}
.ci-input {
  font-size: 15px;
  line-height: 1.9;
  font-family: var(--serif, 'Noto Serif SC', serif);
}
.verdict {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  font-size: 13.5px;
  padding: 11px 14px;
  border-radius: 11px;
  margin: 16px 0 12px;
}
.verdict.pass {
  background: rgba(52, 211, 153, 0.11);
  color: #7ee7bd;
}
.verdict.fail {
  background: rgba(251, 113, 133, 0.11);
  color: #ffc4cf;
}
.verdict .sep {
  opacity: 0.4;
}
.verdict .muted,
.muted {
  color: var(--muted, #93a2bd);
}
.sketch-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  color: var(--muted, #93a2bd);
  line-height: 1.7;
}
.auto-tag {
  font-style: normal;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(232, 149, 74, 0.12);
  color: var(--accent, #38bdf8);
}
.fmt-desc {
  font-size: 12px;
  color: var(--faint, #6b7a96);
  line-height: 1.7;
  margin: 6px 0 0;
}
.rhyme-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0 0;
  font-size: 12.5px;
}
.rl-label {
  color: var(--faint, #6b7a96);
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 8px;
  background: var(--panel-2, rgba(28, 37, 60, 0.7));
  border: 1px solid var(--line, rgba(120, 150, 200, 0.16));
  color: var(--txt, #e8edf7);
}
.tag.accent {
  border-color: rgba(232, 149, 74, 0.35);
}
.tag .feet {
  letter-spacing: 0.16em;
}
.tag .part {
  font-style: normal;
  font-size: 10.5px;
  color: var(--faint, #6b7a96);
}
.meter {
  margin-top: 14px;
}
.meter-head {
  font-size: 12.5px;
  color: var(--faint, #6b7a96);
  margin-bottom: 8px;
}
.mline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.ln-no {
  flex: 0 0 22px;
  font-size: 11px;
  color: var(--faint, #6b7a96);
  text-align: right;
}
.cells {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 30px;
  padding: 2px 0 3px;
  border-radius: 6px;
  background: var(--panel-2, rgba(28, 37, 60, 0.5));
  border: 1px solid transparent;
  line-height: 1.1;
}
.cell b {
  font-size: 15px;
  font-weight: 500;
  color: var(--txt, #e8edf7);
  font-family: var(--serif, 'Noto Serif SC', serif);
}
.cell .spec {
  font-size: 9.5px;
  color: var(--faint, #7c8aa6);
  line-height: 1;
}
.cell .mk {
  font-size: 9px;
  color: var(--accent, #38bdf8);
  line-height: 1.2;
  height: 11px;
}
.cell.foot {
  border-color: rgba(232, 149, 74, 0.4);
}
.cell.ok {
  background: rgba(52, 211, 153, 0.1);
}
.cell.off {
  background: rgba(251, 191, 36, 0.12);
}
.cell.off b {
  color: #f3d08a;
}
.cell.error {
  background: rgba(251, 113, 133, 0.16);
  border-color: rgba(251, 113, 133, 0.5);
}
.cell.error b {
  color: #ffc4cf;
}
.cell.multi {
  background: rgba(232, 149, 74, 0.1);
}
.cell.unknown b {
  opacity: 0.55;
}
.cell.free b,
.cell.missing b {
  opacity: 0.8;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--faint, #6b7a96);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lg i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
.lg.ok i {
  background: rgba(52, 211, 153, 0.7);
}
.lg.off i {
  background: #fbbf24;
}
.lg.err i {
  background: #fb7185;
}
.lg.multi i {
  background: #e8954a;
}
.lg.unknown i {
  border: 1px dashed var(--line-strong, #4a5a78);
}
.issues {
  margin-top: 18px;
}
.issues-head {
  font-size: 13px;
  font-weight: 600;
  color: var(--txt, #e8edf7);
  margin-bottom: 9px;
}
.issue-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.it {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 13px;
  line-height: 1.65;
  padding: 9px 12px;
  border-radius: 9px;
  border-left: 3px solid transparent;
}
.it.error {
  background: rgba(251, 113, 133, 0.09);
  border-left-color: #fb7185;
  color: #ffc4cf;
}
.it.warn {
  background: rgba(251, 191, 36, 0.09);
  border-left-color: #fbbf24;
  color: #f3d08a;
}
.it.info {
  background: rgba(120, 150, 200, 0.08);
  border-left-color: var(--line-strong, #4a5a78);
  color: var(--muted, #93a2bd);
}
.it span {
  flex: 1;
}
.ln-tag {
  font-style: normal;
  font-size: 11px;
  opacity: 0.6;
}
.alt {
  margin-top: 16px;
}
.alt-head {
  font-size: 12.5px;
  color: var(--faint, #6b7a96);
  margin-bottom: 8px;
}
.alt-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip.on {
  background: rgba(232, 149, 74, 0.16);
  border-color: rgba(232, 149, 74, 0.45);
  color: var(--accent, #38bdf8);
}
.rate {
  font-size: 13px;
  color: var(--muted, #93a2bd);
  margin-left: auto;
}
.rate b {
  color: var(--accent, #38bdf8);
}
.disclaimer {
  font-size: 12px;
  color: var(--faint, #6b7a96);
  line-height: 1.7;
  margin: 14px 0 0;
}
@media (max-width: 640px) {
  .cell {
    width: 26px;
  }
  .cell b {
    font-size: 14px;
  }
}
</style>
