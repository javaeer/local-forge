<script setup>
import { ref } from 'vue'
import DropZone from '../components/DropZone.vue'
import { testZipPassword } from '../lib/archive.js'
import { formatSize } from '../utils.js'

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
  message.value = { type: 'info', text: `正在尝试 ${list.length} 个候选密码（本地字典攻击）…` }
  for (const pw of list) {
    tried.value++
    if (await tryPassword(pw)) {
      found.value = pw
      message.value = { type: 'ok', text: `找到密码：${pw === '' ? '（空密码）' : pw}（尝试 ${tried.value} 次）` }
      busy.value = false
      return
    }
  }
  message.value = { type: 'err', text: `字典中未命中（已试 ${list.length} 个）。可粘贴更大字典，或用数学暴力（极慢）。` }
  busy.value = false
}
const custom = ref('')
</script>

<template>
  <h1 class="page-title">ZIP 密码恢复</h1>
  <p class="page-sub">在浏览器本地对加密 ZIP 做字典攻击（AES）。文件不出户；纯前端算力有限，适合弱密码/已知候选。</p>

  <DropZone :multiple="false" accept=".zip" hint="拖放加密 ZIP 文件" @files="onFiles" />

  <div v-if="file" class="panel">
    <div class="status">目标：<b style="color:var(--txt)">{{ file.name }}</b> · {{ formatSize(file.size) }} · 已尝试 <b style="color:var(--txt)">{{ tried }}</b></div>
    <div class="row wrap">
      <button class="btn" :disabled="busy" @click="recover('')"><i class="bi bi-key"></i> 用内置字典尝试</button>
    </div>
    <div class="field">
      <label>自定义字典（空格分隔，覆盖内置）</label>
      <textarea v-model="custom" rows="2" style="width:100%"></textarea>
      <button class="btn ghost" :disabled="busy || !custom.trim()" @click="recover(custom)"><i class="bi bi-search"></i> 用自定义字典尝试</button>
    </div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
  </div>
</template>
