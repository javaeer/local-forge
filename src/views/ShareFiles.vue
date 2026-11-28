<script setup>
import { ref, computed } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StepBar from '../components/StepBar.vue'
import StatusPill from '../components/StatusPill.vue'
import { formatSize } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

const role = ref('send') // send | receive
const file = ref(null)
const localSDP = ref('') // 本端需发给对方的
const remoteSDP = ref('') // 对方粘贴过来的
const status = ref('')
const flowDone = ref(false)
const progress = ref(0)
const busy = ref(false)
const pc = ref(null)
const recvName = ref('')
const recvBlob = ref(null)

function onFiles(list) {
  file.value = list[0] || null
}
function makePC() {
  const c = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
  return c
}
async function startSend() {
  if (!file.value) return
  busy.value = true
  flowDone.value = false
  status.value = T('ui.share.stOffer')
  const c = makePC()
  pc.value = c
  const ch = c.createDataChannel('file')
  ch.binaryType = 'arraybuffer'
  ch.onopen = () => {
    status.value = T('ui.share.stConnected')
    sendFile(ch)
  }
  const offer = await c.createOffer()
  await c.setLocalDescription(offer)
  await waitIce(c)
  localSDP.value = btoa(JSON.stringify(c.localDescription))
  status.value = T('ui.share.stSendPrompt')
  busy.value = false
}
async function acceptSendAnswer() {
  const desc = JSON.parse(atob(remoteSDP.value))
  await pc.value.setRemoteDescription(desc)
  status.value = T('ui.share.stWaitingChannel')
}
function sendFile(ch) {
  const chunk = 16 * 1024
  const buf = new Uint8Array(file.value.size)
  let off = 0
  const reader = new FileReader()
  reader.onload = () => {
    buf.set(new Uint8Array(reader.result), 0)
    ch.send(JSON.stringify({ name: file.value.name, size: file.value.size }))
    let i = 0
    const tick = () => {
      const end = Math.min(i + chunk, buf.length)
      ch.send(buf.slice(i, end))
      i = end
      progress.value = Math.round((i / buf.length) * 100)
      if (i < buf.length) setTimeout(tick, 0)
      else { flowDone.value = true; status.value = T('ui.share.stSent') + ' ✅'; setTimeout(() => ch.send('__END__'), 50) }
    }
    tick()
  }
  reader.readAsArrayBuffer(file.value)
}
async function startReceive() {
  if (!remoteSDP.value) return
  busy.value = true
  flowDone.value = false
  status.value = T('ui.share.stPreparing')
  const c = makePC()
  pc.value = c
  const chunks = []
  let meta = null
  c.ondatachannel = (e) => {
    const ch = e.channel
    ch.binaryType = 'arraybuffer'
    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        if (ev.data === '__END__') {
          const blob = new Blob(chunks)
          recvBlob.value = blob
          recvName.value = meta?.name || 'received'
          flowDone.value = true
          status.value = T('ui.share.stReceived') + ' ✅ ' + formatSize(blob.size)
          return
        }
        meta = JSON.parse(ev.data)
        status.value = T('ui.share.stReceiving', { name: meta.name })
        return
      }
      chunks.push(ev.data)
      if (meta) progress.value = Math.round((chunks.reduce((s, b) => s + b.byteLength, 0) / meta.size) * 100)
    }
  }
  const offer = JSON.parse(atob(remoteSDP.value))
  await c.setRemoteDescription(offer)
  const answer = await c.createAnswer()
  await c.setLocalDescription(answer)
  await waitIce(c)
  localSDP.value = btoa(JSON.stringify(c.localDescription))
  status.value = T('ui.share.stAnswerPrompt')
  busy.value = false
}
function waitIce(c) {
  return new Promise((res) => {
    if (c.iceGatheringState === 'complete') return res()
    c.onicegatheringstatechange = () => { if (c.iceGatheringState === 'complete') res() }
    setTimeout(res, 1500)
  })
}
function downloadRecv() {
  if (recvBlob.value) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(recvBlob.value)
    a.download = recvName.value
    a.click()
  }
}

// 当前流程的步骤指引（发送方 / 接收方）
const flowSteps = computed(() => {
  const done = flowDone.value
  if (role.value === 'send') {
    return [
      { label: T('ui.share.stepInvite'), state: localSDP.value ? 'done' : 'active' },
      { label: T('ui.share.stepPasteAnswer'), state: localSDP.value && remoteSDP.value ? 'done' : (localSDP.value ? 'active' : 'todo') },
      { label: T('ui.share.stepSend'), state: done ? 'done' : (localSDP.value ? 'active' : 'todo') },
    ]
  }
  return [
    { label: T('ui.share.stepPasteInvite'), state: remoteSDP.value ? 'done' : 'active' },
    { label: T('ui.share.stepAnswer'), state: localSDP.value ? 'done' : (remoteSDP.value ? 'active' : 'todo') },
    { label: T('ui.share.stepReceive'), state: recvBlob.value ? 'done' : (localSDP.value ? 'active' : 'todo') },
  ]
})
const flowState = computed(() => {
  if (flowDone.value) return 'done'
  if (busy.value) return 'working'
  return 'idle'
})
</script>

<template>
  <h1 class="page-title">{{ T('ui.share.pageTitle') }}</h1>
  <p class="page-sub">{{ T('ui.share.sub') }}</p>

  <HelpTip :title="T('ui.share.helpTitle')" icon="bi-share" open tone="tip">
    <ol class="howto">
      <li v-html="T('ui.share.help1')"></li>
      <li v-html="T('ui.share.help2')"></li>
      <li v-html="T('ui.share.help3')"></li>
    </ol>
    <p style="margin:8px 0 0">{{ T('ui.share.helpNote') }}</p>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: role === 'send' }" @click="role = 'send'">{{ T('ui.share.roleSend') }}</button>
    <button :class="{ active: role === 'receive' }" @click="role = 'receive'">{{ T('ui.share.roleReceive') }}</button>
  </div>

  <StepBar :steps="flowSteps" />

  <div class="panel">
    <StatusPill :state="flowState" :label="status || (busy ? T('ui.share.stWorking') : T('ui.share.stIdle'))" />
    <template v-if="role === 'send'">
      <DropZone :multiple="false" :single="T('ui.share.single')" :hint="T('ui.share.dropHint')" @files="onFiles" />
      <div v-if="file" class="status">{{ T('ui.share.toSend') }}<b style="color:var(--txt)">{{ file.name }}</b> · {{ formatSize(file.size) }}</div>
      <div class="row wrap">
        <button class="btn" :disabled="busy || !file" @click="startSend"><i class="bi bi-send"></i> {{ T('ui.share.btnInvite') }}</button>
        <button class="btn ghost" :disabled="!pc" @click="acceptSendAnswer"><i class="bi bi-check2"></i> {{ T('ui.share.btnConnect') }}</button>
      </div>
    </template>
    <template v-else>
      <div class="field"><label>{{ T('ui.share.pasteInviteLabel') }}</label>
        <textarea v-model="remoteSDP" rows="3" style="width:100%"></textarea></div>
      <button class="btn" :disabled="busy || !remoteSDP" @click="startReceive"><i class="bi bi-reply"></i> {{ T('ui.share.btnAnswer') }}</button>
      <div v-if="recvBlob" class="row wrap"><button class="btn green" @click="downloadRecv"><i class="bi bi-download"></i> {{ T('ui.share.btnDownload', { name: recvName, size: formatSize(recvBlob.size) }) }}</button></div>
    </template>

    <div class="field" v-if="localSDP"><label>{{ T('ui.share.localCred') }}</label>
      <textarea :value="localSDP" rows="3" readonly style="width:100%;font-family:monospace;font-size:11px"></textarea>
      <button class="btn ghost" @click="navigator.clipboard.writeText(localSDP)"><i class="bi bi-clipboard"></i> {{ T('ui.share.btnCopy') }}</button>
    </div>
    <div v-if="role === 'receive' && !localSDP && remoteSDP" class="field"><label>{{ T('ui.share.localAnswer') }}</label></div>

    <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <div v-if="status" class="msg info">{{ status }}</div>
  </div>
</template>
