<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import HelpTip from '../components/HelpTip.vue'
import { T } from '../lib/i18n.dev.js'
import { loadClassics } from '../lib/classics.js'
import { analyzePoem, lookupChar, groupChars, rhymeCatalog, TONE_MULTI } from '../lib/poemmeter.js'

const route = useRoute()
const tab = ref('check')
const loading = ref(true)
const error = ref('')
const index = ref(null)
const catalog = ref([])

/* ---------------- 示例 ---------------- */
const SAMPLES = [
  { key: 'a', text: '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。' },
  { key: 'b', text: '国破山河在，城春草木深。\n感时花溅泪，恨别鸟惊心。\n烽火连三月，家书抵万金。\n白头搔更短，浑欲不胜簪。' },
  { key: 'c', text: '朝辞白帝彩云间，千里江陵一日还。\n两岸猿声啼不住，轻舟已过万重山。' },
  { key: 'd', text: '风急天高猿啸哀，渚清沙白鸟飞回。\n无边落木萧萧下，不尽长江滚滚来。\n万里悲秋常作客，百年多病独登台。\n艰难苦恨繁霜鬓，潦倒新停浊酒杯。' },
]

const text = ref(SAMPLES[3].text)
const result = ref(null)

onMounted(async () => {
  try {
    index.value = await loadClassics()
    catalog.value = rhymeCatalog(index.value)
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
  // 从「诗文精选」点「校验格律」跳过来时带 text：直接填入并出结果，省掉一次复制粘贴
  const q = route.query.text
  if (typeof q === 'string' && q.trim() && index.value) {
    text.value = q
    run()
  }
})

function run() {
  if (!index.value) return
  result.value = analyzePoem(text.value, index.value)
}

function clear() {
  text.value = ''
  result.value = null
}

function useSample(s) {
  text.value = s.text
  run()
}

// 切换语言时重算，让校勘文字跟着变
watch(() => T('views.poemMeter.analyze'), () => {
  if (result.value) run()
})

/* ---------------- 文案辅助 ---------------- */
function toneLabel(t) {
  if (!t) return '?'
  const s = T('views.poemMeter.toneOf.' + t)
  return s || t
}

function formLabel(f) {
  if (!f) return ''
  const len = f.charsPerLine === 5 ? 'five' : 'seven'
  const kind = f.lineCount === 4 ? 'Quatrain' : 'Octave'
  return T(`views.poemMeter.forms.${len}${kind}`) || f.type
}

function patternLabel(p) {
  if (!p) return ''
  const a = T(p.startTone === '平' ? 'views.poemMeter.startPing' : 'views.poemMeter.startZe')
  const b = T(p.rhymed ? 'views.poemMeter.firstRhymed' : 'views.poemMeter.firstNotRhymed')
  return [a, b].filter(Boolean).join(' · ')
}

function fatalText(f) {
  if (!f) return ''
  const map = {
    noLines: 'views.poemMeter.fatal.noLines',
    mixedLength: 'views.poemMeter.fatal.mixedLength',
    notFiveSeven: 'views.poemMeter.fatal.notFiveSeven',
    lineCount: 'views.poemMeter.fatal.lineCount',
  }
  return T(map[f.code] || '', f.params || {}) || f.message
}

function issueText(it) {
  const params = {
    ...it,
    expected: toneLabel(it.expected),
    actual: toneLabel(it.actual),
    groups: (it.groups || []).join('/'),
  }
  const localized = T('views.poemMeter.issues.' + it.code, params)
  return localized || it.message
}

// 分级：error 先，warn 次，info 最后
const grouped = computed(() => {
  if (!result.value || !result.value.issues) return { error: [], warn: [], info: [] }
  const g = { error: [], warn: [], info: [] }
  for (const it of result.value.issues) (g[it.level] || g.info).push(it)
  return g
})

const hasIssues = computed(() => {
  const g = grouped.value
  return g.error.length + g.warn.length + g.info.length > 0
})

/* ---------------- 韵部查询 ---------------- */
const charQuery = ref('东')
const groupQuery = ref('一东')

const charResult = computed(() => {
  const q = (charQuery.value || '').trim()
  if (!q || !index.value) return null
  return lookupChar(index.value, Array.from(q)[0])
})

const groupResult = computed(() => {
  if (!groupQuery.value || !index.value) return null
  return groupChars(index.value, groupQuery.value)
})

// 韵部下拉默认选中第一个平声韵部，方便直接看
onMounted(() => {
  const first = catalog.value.find((c) => /^[上下]平/.test(c.part))
  if (first && first.items.length) groupQuery.value = first.items[0].name
})
</script>

<template>
  <h1 class="page-title">{{ T('views.poemMeter.title') }}</h1>
  <p class="page-sub">{{ T('views.poemMeter.sub') }}</p>

  <HelpTip :title="T('views.poemMeter.legendTitle')" icon="bi-rulers">
    <p class="legend-body" style="margin:0">{{ T('views.poemMeter.legendBody') }}</p>
  </HelpTip>

  <div class="tabs wrap-tabs">
    <button :class="{ active: tab === 'check' }" @click="tab = 'check'">
      <i class="bi bi-rulers"></i> {{ T('views.poemMeter.tabCheck') }}
    </button>
    <button :class="{ active: tab === 'rhyme' }" @click="tab = 'rhyme'">
      <i class="bi bi-book"></i> {{ T('views.poemMeter.tabRhyme') }}
    </button>
  </div>

  <div v-if="loading" class="msg info">{{ T('views.poemMeter.loading') }}</div>
  <div v-else-if="error" class="msg err">
    <span>{{ T('views.poemMeter.loadFail') }}：{{ error }}</span>
  </div>

  <template v-else>
    <!-- 格律校验 -->
    <div v-if="tab === 'check'" class="panel">
      <label class="field" style="width:100%">
        <span>{{ T('views.poemMeter.inputLabel') }}</span>
        <textarea
          v-model="text"
          rows="8"
          spellcheck="false"
          :placeholder="T('views.poemMeter.placeholder')"
          class="poem-input"
          @input="result = null"
        ></textarea>
      </label>

      <div class="row">
        <button class="btn" :disabled="!text.trim()" @click="run">
          <i class="bi bi-check2-circle"></i> {{ T('views.poemMeter.analyze') }}
        </button>
        <button class="btn ghost" @click="clear">
          <i class="bi bi-eraser"></i> {{ T('views.poemMeter.clear') }}
        </button>
        <span class="sample-row">
          <span class="sample-label">{{ T('views.poemMeter.samplesLabel') }}</span>
          <button v-for="s in SAMPLES" :key="s.key" class="chip" @click="useSample(s)">
            {{ T('views.poemMeter.samples.' + s.key) }}
          </button>
        </span>
      </div>

      <template v-if="result">
        <!-- 致命错误：根本不成近体诗 -->
        <div v-if="result.fatal" class="msg err">{{ fatalText(result.fatal) }}</div>

        <template v-else>
          <!-- 结论条 -->
          <div class="verdict" :class="result.ok ? 'pass' : 'fail'">
            <i class="bi" :class="result.ok ? 'bi-patch-check' : 'bi-exclamation-diamond'"></i>
            <b>{{ result.ok ? T('views.poemMeter.pass') : T('views.poemMeter.fail') }}</b>
            <span class="sep">·</span>
            <span>{{ formLabel(result.form) }}</span>
            <span class="sep">·</span>
            <span>{{ patternLabel(result.pattern) }}</span>
            <span class="sep">·</span>
            <span class="mono">{{ result.pattern.seq }}</span>
            <span class="sep">·</span>
            <span class="muted">{{ T('views.poemMeter.matchRate') }} {{ result.pattern.score }}%</span>
          </div>

          <!-- 韵脚摘要 -->
          <div class="rhyme-line">
            <span class="rl-label">{{ T('views.poemMeter.rhymeGroup') }}</span>
            <span class="tag accent">{{ result.rhyme.group || '—' }}</span>
            <span class="rl-label">{{ T('views.poemMeter.rhymeFeet') }}</span>
            <span class="feet">
              <span v-for="f in result.rhyme.feet" :key="f.line" class="foot">{{ f.ch }}</span>
            </span>
          </div>

          <!-- 逐字平仄 -->
          <div class="meter">
            <div class="meter-head">{{ T('views.poemMeter.toneMapTitle') }}</div>
            <div v-for="(ln, i) in result.lines" :key="i" class="mline">
              <span class="ln-no">{{ i + 1 }}</span>
              <span class="cells">
                <span
                  v-for="(c, j) in ln.chars"
                  :key="j"
                  class="cell"
                  :class="[c.status, { foot: ln.rhymeLine && j === ln.chars.length - 1 }]"
                  :title="`${c.ch}：${toneLabel(c.actual)}（应为${toneLabel(c.expected)}）`"
                >
                  <b>{{ c.ch }}</b>
                  <small>{{ toneLabel(c.actual) }}</small>
                </span>
              </span>
              <span class="ln-kind mono">{{ ln.kind }}</span>
            </div>
          </div>

          <!-- 图例 -->
          <div class="legend">
            <span class="lg ok"><i></i>{{ T('views.poemMeter.legendOk') }}</span>
            <span class="lg err"><i></i>{{ T('views.poemMeter.legendErr') }}</span>
            <span class="lg loose"><i></i>{{ T('views.poemMeter.legendLoose') }}</span>
            <span class="lg multi"><i></i>{{ T('views.poemMeter.legendMulti') }}</span>
            <span class="lg unknown"><i></i>{{ T('views.poemMeter.legendUnknown') }}</span>
          </div>

          <!-- 校勘结果 -->
          <div class="issues">
            <div class="issues-head">{{ T('views.poemMeter.issuesTitle') }}</div>
            <div v-if="!hasIssues" class="msg ok">{{ T('views.poemMeter.noIssues') }}</div>
            <ul v-else class="issue-list">
              <li v-for="(it, k) in grouped.error" :key="'e' + k" class="it error">
                <i class="bi bi-x-circle-fill"></i>
                <span>{{ issueText(it) }}</span>
                <em v-if="it.line" class="ln-tag">{{ it.line }}</em>
              </li>
              <li v-for="(it, k) in grouped.warn" :key="'w' + k" class="it warn">
                <i class="bi bi-exclamation-triangle-fill"></i>
                <span>{{ issueText(it) }}</span>
                <em v-if="it.line" class="ln-tag">{{ it.line }}</em>
              </li>
              <li v-for="(it, k) in grouped.info" :key="'i' + k" class="it info">
                <i class="bi bi-info-circle"></i>
                <span>{{ issueText(it) }}</span>
                <em v-if="it.line" class="ln-tag">{{ it.line }}</em>
              </li>
            </ul>
          </div>

          <p class="disclaimer">{{ T('views.poemMeter.disclaimer') }}</p>
        </template>
      </template>
    </div>

    <!-- 韵部查询 -->
    <div v-else class="panel">
      <div class="row">
        <label class="field">
          <span>{{ T('views.poemMeter.rhyme.charLabel') }}</span>
          <input
            v-model="charQuery"
            maxlength="4"
            :placeholder="T('views.poemMeter.rhyme.charPlaceholder')"
            class="char-input"
          />
        </label>
        <label class="field" style="min-width:220px">
          <span>{{ T('views.poemMeter.rhyme.groupLabel') }}</span>
          <select v-model="groupQuery">
            <optgroup v-for="c in catalog" :key="c.part" :label="c.part">
              <option v-for="g in c.items" :key="g.name" :value="g.name">
                {{ g.name }} · {{ T('views.poemMeter.rhyme.count', { n: g.count }) }}
              </option>
            </optgroup>
          </select>
        </label>
      </div>

      <div class="lookup-grid">
        <div class="lookup-card">
          <div class="lc-head">{{ T('views.poemMeter.rhyme.charLabel') }}</div>
          <template v-if="charResult">
            <div v-if="charResult.tone || charResult.rhymes.length" class="char-box">
              <span class="big-char">{{ charResult.ch }}</span>
              <span class="tone-badge" :class="charResult.tone === '平' ? 'p' : charResult.tone === '仄' ? 'z' : 'm'">
                {{ charResult.tone ? toneLabel(charResult.tone) : '?' }}
              </span>
            </div>
            <div v-if="charResult.rhymes.length" class="rhyme-tags">
              <span class="rl-label">{{ T('views.poemMeter.rhyme.belongs') }}</span>
              <span v-for="r in charResult.rhymes" :key="r.part + r.name" class="tag">
                {{ r.name }}
                <em class="part">{{ r.part }}</em>
              </span>
            </div>
            <div v-else-if="charResult.tone" class="msg warn">{{ T('views.poemMeter.rhyme.notFound') }}</div>
            <div v-else class="msg warn">{{ T('views.poemMeter.rhyme.notFound') }}</div>
          </template>
          <div v-else class="empty">{{ T('views.poemMeter.rhyme.empty') }}</div>
        </div>

        <div class="lookup-card">
          <div class="lc-head">
            {{ groupResult ? groupResult.part : T('views.poemMeter.rhyme.groupLabel') }}
            <span v-if="groupResult" class="muted">
              · {{ groupQuery }} · {{ T('views.poemMeter.rhyme.count', { n: groupResult.chars.length }) }}
            </span>
          </div>
          <div v-if="groupResult" class="group-chars">
            <span v-for="(c, i) in groupResult.chars" :key="i" class="gchar">{{ c }}</span>
          </div>
          <div v-else class="empty">{{ T('views.poemMeter.rhyme.empty') }}</div>
        </div>
      </div>

      <p class="source">{{ T('views.poemMeter.source') }}</p>
    </div>
  </template>
</template>

<style scoped>
.poem-input {
  width: 100%;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 15px;
  line-height: 1.9;
  padding: 14px;
  resize: vertical;
}

.sample-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin-left: 4px;
}
.sample-label {
  font-size: 12.5px;
  color: var(--faint, #6b7a96);
}
.chip {
  background: var(--panel-2, rgba(28, 37, 60, 0.6));
  border: 1px solid var(--line, rgba(120, 150, 200, 0.16));
  color: var(--muted, #93a2bd);
  border-radius: 999px;
  padding: 4px 11px;
  font-size: 12.5px;
  cursor: pointer;
  transition: 0.15s;
}
.chip:hover {
  color: var(--accent, #38bdf8);
  border-color: var(--accent, #38bdf8);
}

/* 结论条 */
.verdict {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 12px 15px;
  border-radius: var(--radius-sm, 10px);
  font-size: 14px;
  margin: 16px 0 12px;
  border: 1px solid transparent;
}
.verdict.pass {
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.3);
  color: #aef0d2;
}
.verdict.fail {
  background: rgba(251, 113, 133, 0.1);
  border-color: rgba(251, 113, 133, 0.3);
  color: #ffc4cf;
}
.verdict .sep {
  opacity: 0.4;
}
.verdict .muted {
  color: inherit;
  opacity: 0.75;
}

/* 韵脚摘要 */
.rhyme-line {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  font-size: 13px;
  margin: 0 0 16px;
}
.rl-label {
  color: var(--faint, #6b7a96);
  font-size: 12.5px;
}
.tag.accent {
  background: rgba(56, 189, 248, 0.16);
  color: var(--accent, #38bdf8);
  border-color: rgba(56, 189, 248, 0.3);
}
.feet {
  display: flex;
  gap: 6px;
}
.foot {
  font-size: 15px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.12);
  color: var(--accent, #38bdf8);
}

/* 逐字平仄表 */
.meter {
  border: 1px solid var(--line, rgba(120, 150, 200, 0.16));
  border-radius: var(--radius, 14px);
  padding: 12px 14px 14px;
  background: var(--panel-2, rgba(28, 37, 60, 0.45));
  overflow-x: auto;
}
.meter-head {
  font-size: 12.5px;
  color: var(--faint, #6b7a96);
  margin-bottom: 10px;
}
.mline {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 6px;
}
.ln-no {
  width: 18px;
  flex: 0 0 18px;
  text-align: right;
  font-size: 11px;
  color: var(--faint, #6b7a96);
  padding-bottom: 7px;
}
.cells {
  display: flex;
  gap: 3px;
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 30px;
  padding: 4px 2px 3px;
  border-radius: 6px;
  border: 1px solid transparent;
  transition: 0.15s;
}
.cell b {
  font-size: 19px;
  font-weight: 500;
  line-height: 1.25;
  color: var(--txt, #e8edf7);
}
.cell small {
  font-size: 10px;
  line-height: 1.2;
  color: var(--faint, #6b7a96);
  margin-top: 1px;
}
.cell.foot {
  position: relative;
}
.cell.foot::after {
  content: '';
  position: absolute;
  bottom: -1px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent, #38bdf8);
}
.cell.error {
  background: rgba(251, 113, 133, 0.16);
  border-color: rgba(251, 113, 133, 0.5);
}
.cell.error b,
.cell.error small {
  color: #ff9fb0;
}
.cell.loose {
  background: rgba(251, 191, 36, 0.12);
  border-color: rgba(251, 191, 36, 0.3);
}
.cell.loose b,
.cell.loose small {
  color: #f3d08a;
}
.cell.multi {
  background: rgba(56, 189, 248, 0.1);
}
.cell.multi small {
  color: var(--accent, #38bdf8);
}
.cell.unknown {
  opacity: 0.55;
  border-style: dashed;
  border-color: var(--line-strong, rgba(120, 150, 200, 0.32));
}
.ln-kind {
  font-size: 11px;
  color: var(--faint, #6b7a96);
  padding-bottom: 7px;
}

/* 图例 */
.legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin: 12px 0 4px;
  font-size: 12px;
  color: var(--muted, #93a2bd);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lg i {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  display: inline-block;
}
.lg.ok i {
  background: var(--line-strong, #4a5a78);
}
.lg.err i {
  background: #fb7185;
}
.lg.loose i {
  background: #fbbf24;
}
.lg.multi i {
  background: #38bdf8;
}
.lg.unknown i {
  border: 1px dashed var(--line-strong, #4a5a78);
}

/* 校勘结果 */
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
.it i {
  font-size: 13px;
  line-height: 1.6;
  flex: 0 0 auto;
}
.it span {
  flex: 1;
}
.ln-tag {
  font-style: normal;
  font-size: 11px;
  opacity: 0.6;
  flex: 0 0 auto;
}

.disclaimer,
.source {
  font-size: 12px;
  color: var(--faint, #6b7a96);
  line-height: 1.7;
  margin: 14px 0 0;
}
.legend-body {
  font-size: 13px;
  line-height: 1.75;
  color: var(--muted, #93a2bd);
}

/* 韵部查询 */
.char-input {
  width: 130px;
  font-size: 17px;
  text-align: center;
}
.lookup-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 14px;
  margin-top: 6px;
}
@media (max-width: 720px) {
  .lookup-grid {
    grid-template-columns: 1fr;
  }
}
.lookup-card {
  border: 1px solid var(--line, rgba(120, 150, 200, 0.16));
  border-radius: var(--radius, 14px);
  padding: 14px;
  background: var(--panel-2, rgba(28, 37, 60, 0.45));
  min-height: 150px;
}
.lc-head {
  font-size: 12.5px;
  color: var(--faint, #6b7a96);
  margin-bottom: 12px;
}
.char-box {
  display: flex;
  align-items: center;
  gap: 14px;
}
.big-char {
  font-size: 46px;
  line-height: 1;
  color: var(--txt, #e8edf7);
}
.tone-badge {
  font-size: 13px;
  padding: 3px 11px;
  border-radius: 999px;
  font-weight: 600;
}
.tone-badge.p {
  background: rgba(56, 189, 248, 0.16);
  color: var(--accent, #38bdf8);
}
.tone-badge.z {
  background: rgba(167, 139, 250, 0.16);
  color: #b9a6ff;
}
.tone-badge.m {
  background: rgba(251, 191, 36, 0.16);
  color: #f3d08a;
}
.rhyme-tags {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  padding: 3px 9px;
  border-radius: 7px;
  background: var(--panel-2, rgba(28, 37, 60, 0.7));
  border: 1px solid var(--line, rgba(120, 150, 200, 0.16));
  color: var(--txt, #e8edf7);
}
.tag .part {
  font-style: normal;
  font-size: 10.5px;
  color: var(--faint, #6b7a96);
}
.group-chars {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.gchar {
  font-size: 17px;
  line-height: 1.9;
  padding: 0 5px;
  border-radius: 5px;
  color: var(--txt, #e8edf7);
}
.gchar:hover {
  background: rgba(56, 189, 248, 0.14);
  color: var(--accent, #38bdf8);
}
.empty {
  font-size: 13px;
  color: var(--faint, #6b7a96);
  padding: 18px 0;
}
.mono {
  font-family: var(--mono, ui-monospace, monospace);
  letter-spacing: 0.06em;
}
.msg.warn {
  background: rgba(251, 191, 36, 0.1);
  color: #f3d08a;
  border-left-color: #fbbf24;
  margin-top: 12px;
}
</style>
