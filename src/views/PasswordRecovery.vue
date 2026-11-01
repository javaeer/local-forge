<script setup>
import { ref } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { testZipPassword } from '../lib/archive.js'
import { formatSize } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

const file = ref(null)
const found = ref('')
const tried = ref(0)
const busy = ref(false)
const message = ref(null)
const DEFAULT_WORDLIST = [
  '123456','password','12345678','qwerty','123456789','12345','1234','111111','1234567','dragon',
  '123123','abc123','admin','letmein','welcome','monkey','test','password1','123qwe','1q2w3e4r',
  'test123','test1234','password123','qwerty123','', 'zip','secret','passw0rd','p@ssw0rd','iloveyou',
]

function onFiles(list) {
  file.value = list[0] || null
  found.value = ''
  tried.value = 0
  message.value = null
}
async function tryPassword(pw) {
  return testZipPassword(file.value, pw)
}
async function recover(customList) {
  if (!file.value) return
  busy.value = true
  found.value = ''
  tried.value = 0
  const list = (customList && customList.trim()) ? customList.split(/\s+/) : DEFAULT_WORDLIST
  message.value = { type: 'info', text: T('views.passwordRecovery.msgTrying', { n: list.length }) }
  for (const pw of list) {
    tried.value++
    if (await tryPassword(pw)) {
      found.value = pw
      const pwText = pw === '' ? T('views.passwordRecovery.emptyPw') : pw
      message.value = { type: 'ok', text: T('views.passwordRecovery.msgFound', { pw: pwText, n: tried.value }) }
      busy.value = false
      return
    }
  }
  message.value = { type: 'err', text: T('views.passwordRecovery.msgFail', { n: list.length }) }
  busy.value = false
}
const custom = ref('')
</script>

<template>
  <h1 class="page-title">{{ T('views.passwordRecovery.title') }}</h1>
  <p class="page-sub">{{ T('views.passwordRecovery.sub') }}</p>

  <HelpTip :title="T('views.passwordRecovery.helpTitle')" icon="bi-key" open tone="warn">
    <div v-html="T('views.passwordRecovery.help')"></div>
  </HelpTip>

  <DropZone :multiple="false" accept=".zip" :single="T('views.passwordRecovery.dropSingle')" :hint="T('views.passwordRecovery.dropHint')" :formats="T('views.passwordRecovery.dropFormats')" @files="onFiles" />

  <div v-if="file" class="panel">
    <div class="row wrap" style="margin-top:0">
      <StatusPill v-if="busy" state="working" :label="T('views.passwordRecovery.statusWorking', { n: tried })" />
      <StatusPill v-else-if="found" state="done" :label="T('views.passwordRecovery.foundLabel') + (found === '' ? T('views.passwordRecovery.emptyPw') : found)" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>
    <div class="status">{{ T('views.passwordRecovery.target') }}：<b style="color:var(--txt)">{{ file.name }}</b> · {{ formatSize(file.size) }} · {{ T('views.passwordRecovery.tried') }} <b style="color:var(--txt)">{{ tried }}</b></div>
    <div class="row wrap">
      <button class="btn" :disabled="busy" @click="recover('')"><i class="bi bi-key"></i> {{ T('views.passwordRecovery.btnBuiltin') }}</button>
    </div>
    <div class="field">
      <label>{{ T('views.passwordRecovery.dictLabel') }}</label>
      <textarea v-model="custom" rows="2" style="width:100%"></textarea>
      <button class="btn ghost" :disabled="busy || !custom.trim()" @click="recover(custom)"><i class="bi bi-search"></i> {{ T('views.passwordRecovery.btnCustom') }}</button>
    </div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
  </div>
</template>
