<script setup>
// 公众号文章检索 · 视图层
//
// 只说真话的三件事（写在界面上，不藏在文档里）：
//   1. 公众号没有公开搜索接口，能稳定列举的只有「合集」；
//   2. mp.weixin.qq.com 不下发 CORS 头，浏览器直连必被拦 → 提供代理 / 粘贴两条退路；
//   3. 本页解析全在本地，只有在「直连 / 代理」模式下才会按你给的地址发一次请求。
import { ref, computed, reactive } from 'vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { T } from '../lib/i18n.dev.js'
import { locale } from '../lib/i18n.js'
import { downloadBlob } from '../utils.js'
import { pushToast } from '../lib/toast.js'
import {
  parseArticleRef, parseArticleHtml, parseAlbumPayload, resolveFromArticle, fetchAlbum, fetchAlbumTitle,
  filterArticles, sortArticles, summarize, toCsv, toMarkdown, toOriginalImageUrl,
  createFetcher, explainFetchError,
} from '../lib/wechat-search.js'

const tab = ref('article')          // article | album | paste
const mode = ref('proxy')           // direct | proxy | paste
const proxy = ref('')
const pagesLimit = ref(20)
const source = ref('')              // 文章链接 / 合集链接 / 粘贴内容
const query = ref('')

const state = ref('idle')           // idle | working | done | error
const message = ref(null)           // { type, text }
const progress = reactive({ page: 0, total: 0 })

const article = ref(null)           // parseArticleHtml 结果
const album = reactive({ id: '', biz: '', title: '', pages: 0, truncated: false })
const items = ref([])

const setMsg = (type, text) => { message.value = { type, text } }
const fetcher = computed(() => createFetcher({ mode: mode.value, proxy: proxy.value }))
const getText = (url) => fetcher.value.getText(url)

// 过滤 + 排序（纯前端，改关键词不再发请求）
const filtered = computed(() => sortArticles(filterArticles(items.value, { query: query.value }), 'desc'))
const stat = computed(() => summarize(items.value))
const shown = computed(() => summarize(filtered.value))

// 版本快捷筛选：点一下把版本名塞进检索词
function useEdition(key) {
  query.value = query.value.includes(key) ? query.value : `${query.value} ${key}`.trim()
}
function resetQuery() { query.value = '' }

async function run() {
  const raw = source.value.trim()
  if (!raw) { setMsg('err', T('views.wechatSearch.errEmpty')); return }

  items.value = []
  article.value = null
  album.id = ''
  album.title = ''
  state.value = 'working'
  progress.page = 0
  progress.total = 0
  setMsg('info', T('views.wechatSearch.msgWorking'))

  try {
    let biz = ''
    let albumId = ''

    if (tab.value === 'paste') {
      // 粘贴模式：判断是文章页 HTML 还是合集页 / 合集 JSON
      if (/article_list|getalbum_resp|articleList/.test(raw)) {
        const page = parseAlbumPayload(raw)
        items.value = page.items
        album.id = page.albumId
        album.title = page.title
        album.pages = 1              // 粘贴的是单份载荷，无翻页概念
        state.value = 'done'
        setMsg('ok', T('views.wechatSearch.msgPastedAlbum', { n: page.items.length }))
        return
      }
      const info = parseArticleHtml(raw)
      if (!info.title) { state.value = 'error'; setMsg('err', T('views.wechatSearch.errPaste')); return }
      article.value = info
      biz = info.biz
      albumId = info.album ? info.album.id : ''
      if (!albumId) {
        state.value = 'done'
        setMsg('ok', T('views.wechatSearch.msgPastedArticleNoAlbum'))
        return
      }
    } else if (tab.value === 'album') {
      const ref0 = parseArticleRef(raw)
      biz = ref0.biz
      albumId = ref0.albumId
      if (!albumId) { state.value = 'error'; setMsg('err', T('views.wechatSearch.errAlbum')); return }
    } else {
      const ref0 = parseArticleRef(raw)
      if (!ref0.url) { state.value = 'error'; setMsg('err', T('views.wechatSearch.errUrl')); return }
      const r = await resolveFromArticle(ref0.url, getText)
      article.value = r.article
      biz = r.biz
      albumId = r.albumId
      album.title = r.albumTitle
      if (!albumId) {
        state.value = 'done'
        setMsg('warn', T('views.wechatSearch.msgNoAlbum'))
        return
      }
    }

    album.id = albumId
    album.biz = biz

    const res = await fetchAlbum({
      biz, albumId, getText, maxPages, count: 10,
      onPage: ({ page, total }) => { progress.page = page; progress.total = total },
    })
    items.value = res.items
    album.pages = res.pages
    album.truncated = res.truncated
    if (!album.title) album.title = res.albumTitle || await fetchAlbumTitle({ biz, albumId, getText })

    if (!res.items.length) {
      state.value = 'error'
      setMsg('err', T('views.wechatSearch.errEmptyAlbum'))
      return
    }
    state.value = 'done'
    setMsg('ok', T('views.wechatSearch.msgDone', { n: res.items.length, p: res.pages }))
  } catch (e) {
    state.value = 'error'
    setMsg('err', explainFetchError(e, locale.value))
  }
}

// 翻页上限：夹在 1~60，避免手滑输入把对方服务器当压测目标
const maxPages = computed(() => Math.min(60, Math.max(1, Number(pagesLimit.value) || 20)))

// 当前文章的图片原图（/0）：只做链接整理，不代下载
const originals = computed(() => (article.value ? article.value.images.map(toOriginalImageUrl) : []))

async function copyList(text, tip) {
  try {
    await navigator.clipboard.writeText(text)
    pushToast('ok', tip)
  } catch {
    setMsg('err', T('views.wechatSearch.errClipboard'))
  }
}
const copyLinks = () => copyList(filtered.value.map((x) => x.url).join('\n'), T('views.wechatSearch.toastLinks'))
const copyImages = () => copyList(originals.value.join('\n'), T('views.wechatSearch.toastImages'))

function exportCsv() {
  downloadBlob(new Blob([toCsv(filtered.value)], { type: 'text/csv;charset=utf-8' }), `wechat-articles-${Date.now()}.csv`)
  pushToast('ok', T('views.wechatSearch.toastCsv'))
}
function exportMd() {
  const md = toMarkdown(filtered.value, {
    title: album.title || T('views.wechatSearch.defaultTitle'),
    account: article.value && article.value.account,
    albumId: album.id || '',
    query: query.value,
    generatedAt: new Date().toISOString().slice(0, 10),
  })
  downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `wechat-articles-${Date.now()}.md`)
  pushToast('ok', T('views.wechatSearch.toastMd'))
}
function exportJson() {
  const data = { album: { ...album }, article: article.value, query: query.value, items: filtered.value }
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `wechat-articles-${Date.now()}.json`)
  pushToast('ok', T('views.wechatSearch.toastJson'))
}

function openUrl(u) { window.open(u, '_blank', 'noopener') }
</script>

<template>
  <h1 class="page-title">{{ T('views.wechatSearch.title') }}</h1>
  <p class="page-sub" v-html="T('views.wechatSearch.sub')"></p>

  <HelpTip :title="T('views.wechatSearch.helpTitle')" icon="bi-info-circle" open>
    <ol class="howto">
      <li v-html="T('views.wechatSearch.help1')"></li>
      <li v-html="T('views.wechatSearch.help2')"></li>
      <li v-html="T('views.wechatSearch.help3')"></li>
    </ol>
    <p style="margin:8px 0 0" v-html="T('views.wechatSearch.helpNote')"></p>
  </HelpTip>

  <div class="panel">
    <div class="tabs">
      <button :class="{ active: tab === 'article' }" @click="tab = 'article'">
        <i class="bi bi-link-45deg"></i> {{ T('views.wechatSearch.tabArticle') }}
      </button>
      <button :class="{ active: tab === 'album' }" @click="tab = 'album'">
        <i class="bi bi-collection"></i> {{ T('views.wechatSearch.tabAlbum') }}
      </button>
      <button :class="{ active: tab === 'paste' }" @click="tab = 'paste'; mode = 'paste'">
        <i class="bi bi-clipboard"></i> {{ T('views.wechatSearch.tabPaste') }}
      </button>
    </div>

    <div class="field" style="margin-top:12px">
      <label>{{ tab === 'paste' ? T('views.wechatSearch.pasteLabel') : T('views.wechatSearch.inputLabel') }}</label>
      <textarea
        v-if="tab === 'paste'" v-model="source" rows="6"
        :placeholder="T('views.wechatSearch.pastePlaceholder')"></textarea>
      <input
        v-else v-model="source" type="text"
        :placeholder="tab === 'album' ? T('views.wechatSearch.albumPlaceholder') : T('views.wechatSearch.urlPlaceholder')"
        @keyup.enter="run" />
    </div>

    <div class="row wrap">
      <label class="check" v-if="tab !== 'paste'">
        <span>{{ T('views.wechatSearch.modeLabel') }}</span>
        <select v-model="mode">
          <option value="proxy">{{ T('views.wechatSearch.modeProxy') }}</option>
          <option value="direct">{{ T('views.wechatSearch.modeDirect') }}</option>
        </select>
      </label>
      <label class="check" v-if="tab !== 'paste'">
        <span>{{ T('views.wechatSearch.pagesLabel') }}</span>
        <input v-model.number="pagesLimit" type="number" min="1" max="60" style="width:84px" />
      </label>
      <button class="btn" :disabled="state === 'working'" @click="run">
        <i class="bi bi-search"></i> {{ state === 'working' ? T('views.wechatSearch.btnRunning') : T('views.wechatSearch.btnRun') }}
      </button>
      <StatusPill
        :state="state"
        :label="state === 'working' ? T('views.wechatSearch.pillWorking', { p: progress.page, n: progress.total }) : state === 'done' ? T('views.wechatSearch.pillDone', { n: items.length }) : state === 'error' ? T('views.wechatSearch.pillError') : T('views.wechatSearch.pillIdle')" />
    </div>

    <div class="field" v-if="mode === 'proxy' && tab !== 'paste'" style="margin-top:10px">
      <label>{{ T('views.wechatSearch.proxyLabel') }}</label>
      <input v-model="proxy" type="text" placeholder="https://your-proxy.example/?url={url}" />
      <small class="hint">{{ T('views.wechatSearch.proxyHint') }}</small>
    </div>

    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
  </div>

  <!-- 文章元信息 -->
  <div v-if="article" class="panel">
    <h3 class="sec-title"><i class="bi bi-file-earmark-text"></i> {{ T('views.wechatSearch.articleTitle') }}</h3>
    <table class="kv">
      <tbody>
        <tr><th style="width:120px">{{ T('views.wechatSearch.fTitle') }}</th><td>{{ article.title }}</td></tr>
        <tr><th>{{ T('views.wechatSearch.fAccount') }}</th><td>{{ article.account || '—' }}</td></tr>
        <tr><th>{{ T('views.wechatSearch.fDate') }}</th><td>{{ article.publishText || '—' }} · {{ T('views.wechatSearch.fChars', { n: article.chars }) }}</td></tr>
        <tr><th>{{ T('views.wechatSearch.fAlbum') }}</th><td>{{ article.album ? `${article.album.title}（${article.album.id}）` : T('views.wechatSearch.fNoAlbum') }}</td></tr>
      </tbody>
    </table>

    <template v-if="originals.length">
      <h3 class="sec-title"><i class="bi bi-images"></i> {{ T('views.wechatSearch.imagesTitle', { n: originals.length }) }}</h3>
      <p class="hint">{{ T('views.wechatSearch.imagesHint') }}</p>
      <div class="row">
        <button class="btn ghost" @click="copyImages"><i class="bi bi-clipboard-check"></i> {{ T('views.wechatSearch.btnCopyImages') }}</button>
        <button class="btn ghost" @click="openUrl(originals[0])"><i class="bi bi-box-arrow-up-right"></i> {{ T('views.wechatSearch.btnOpenFirst') }}</button>
      </div>
      <div class="img-list">
        <code v-for="(u, i) in originals.slice(0, 40)" :key="u" :title="u">{{ String(i + 1).padStart(2, '0') }} · {{ u }}</code>
      </div>
    </template>
  </div>

  <!-- 合集结果 -->
  <div v-if="items.length" class="panel">
    <div class="row wrap" style="justify-content:space-between">
      <h3 class="sec-title" style="margin:0">
        <i class="bi bi-collection"></i>
        {{ album.title || T('views.wechatSearch.defaultTitle') }}
        <small class="hint"> · {{ T('views.wechatSearch.summary', { n: items.length, p: album.pages, from: stat.from, to: stat.to }) }}</small>
      </h3>
      <div class="row" style="margin:0">
        <button class="btn ghost" @click="exportCsv"><i class="bi bi-file-earmark-spreadsheet"></i> CSV</button>
        <button class="btn ghost" @click="exportMd"><i class="bi bi-markdown"></i> Markdown</button>
        <button class="btn ghost" @click="exportJson"><i class="bi bi-filetype-json"></i> JSON</button>
      </div>
    </div>

    <div v-if="album.truncated" class="msg info">{{ T('views.wechatSearch.truncated', { n: album.pages }) }}</div>

    <div class="field" style="margin-top:12px">
      <label>{{ T('views.wechatSearch.queryLabel') }}</label>
      <div class="row" style="margin:0">
        <input v-model="query" type="text" :placeholder="T('views.wechatSearch.queryPlaceholder')" style="flex:1" />
        <button class="btn ghost" @click="resetQuery">{{ T('views.wechatSearch.btnReset') }}</button>
      </div>
      <small class="hint">{{ T('views.wechatSearch.queryHint') }}</small>
    </div>

    <div class="row wrap" v-if="stat.editions.length">
      <span class="hint">{{ T('views.wechatSearch.editions') }}</span>
      <button v-for="e in stat.editions" :key="e.key" class="chip" @click="useEdition(e.key)">
        {{ e.key }} <b>{{ e.count }}</b>
      </button>
    </div>

    <div class="msg" :class="filtered.length ? 'ok' : 'info'">
      {{ T('views.wechatSearch.hit', { n: filtered.length, m: items.length }) }}
      <template v-if="shown.editions.length"> · {{ shown.editions.map((e) => `${e.key}×${e.count}`).join('　') }}</template>
    </div>

    <div class="table-wrap">
      <table class="kv">
        <thead>
          <tr>
            <th style="width:96px">{{ T('views.wechatSearch.thDate') }}</th>
            <th>{{ T('views.wechatSearch.thTitle') }}</th>
            <th style="width:150px">{{ T('views.wechatSearch.thTags') }}</th>
            <th style="width:70px">{{ T('views.wechatSearch.thOpen') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in filtered" :key="it.url">
            <td class="mono">{{ it.date }}</td>
            <td>{{ it.title }}</td>
            <td>
              <span v-if="it.edition" class="chip sm">{{ it.edition }}</span>
              <span v-if="it.grade" class="chip sm">{{ it.grade }}</span>
              <span v-if="it.subject" class="chip sm">{{ it.subject }}</span>
            </td>
            <td><button class="btn ghost sm" @click="openUrl(it.url)"><i class="bi bi-box-arrow-up-right"></i></button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="row">
      <button class="btn ghost" @click="copyLinks"><i class="bi bi-clipboard-check"></i> {{ T('views.wechatSearch.btnCopyLinks') }}</button>
    </div>
  </div>
</template>

<style scoped>
textarea { width: 100%; font-family: var(--mono, monospace); font-size: 12.5px; }
select { background: var(--panel-2, #16203a); color: var(--txt, #e6edf7); border: 1px solid var(--line-strong, rgba(120,150,200,.32)); border-radius: 8px; padding: 6px 8px; font-size: 13px; }
.hint { color: var(--muted, #93a2bd); font-size: 12px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px;
  font-size: 12px; color: var(--muted, #93a2bd); background: var(--panel-2, rgba(28,37,60,.6));
  border: 1px solid var(--line-strong, rgba(120,150,200,.28)); cursor: pointer;
}
.chip:hover { color: var(--accent, #38bdf8); border-color: var(--accent, #38bdf8); }
.chip b { color: var(--accent, #38bdf8); font-weight: 600; }
.chip.sm { padding: 1px 7px; font-size: 11px; cursor: default; margin-right: 3px; }
.img-list { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow: auto; margin-top: 8px; }
.img-list code { font-size: 11px; color: var(--muted, #93a2bd); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.btn.sm { padding: 3px 8px; font-size: 12px; }
</style>
