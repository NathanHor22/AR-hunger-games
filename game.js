import QRCode from 'qrcode'
import { createConnection } from './connection.js'
import { createArena } from './arena.js'
import { createTracker } from './public/tracking.js'

const el = id => document.getElementById(id)
const video = el('video')
let room, myId, cameraReady = false, cameraBusy = false, cameraEpoch = 0
let pendingDescriptor, descriptorSent = false, lastQr = '', noticeTimer, hintUntil = 0, timeOffset = 0, cameraMode
let screen = 'entry', lastCountdown = '', connecting = false

function screenTo(next) {
  screen = next
  document.body.dataset.screen = next
  el('leave').hidden = next === 'entry'
}

function notice(message) {
  clearTimeout(noticeTimer)
  el('notice').textContent = message

  if (message) noticeTimer = setTimeout(() => {el('notice').textContent = ''}, 4500)
}

function cameraStatus(message) {
  el('cameraStatus').textContent = message

  if (message.startsWith('Tracking stopped')) {
    cameraReady = false

    if (room?.phase === 'lobby') connection.send({type:'ready',ready:false})
    render()
  }

  if (screen === 'arena') sayArena(message)
}

function sayArena(message) {
  hintUntil = performance.now() + 1500
  el('arenaHint').textContent = message
}

const tracker = createTracker(video,{
  onFrame: (...frame) => arena.setPeople(...frame),
  onStatus:cameraStatus
})

const me = () => room?.players.find(p => p.id === myId)
const isHost = () => !!myId && room?.hostId === myId
const serverTime = () => Date.now() + timeOffset

function canThrow() {
  return room?.phase === 'playing' && room.startsAt <= serverTime() && room.endsAt > serverTime()
    && cameraReady && connection.connected && me()?.health > 0 && !me().spectator
}

const arena = createArena({
  video, canvas:el('overlay'), launch:el('launch'), canThrow,
  send:m => connection.send(m), message:sayArena
})

function releaseCamera() {
  cameraEpoch++
  document.body.dataset.sampling = 'false'
  cameraReady = cameraBusy = false
  cameraMode = null
  tracker.stop()
  arena.stop()
}

function reset(message) {
  releaseCamera()
  room = myId = pendingDescriptor = null
  descriptorSent = false
  lastQr = ''
  hintUntil = 0
  connecting = false
  el('createRoom').disabled = false
  el('joinForm').querySelector('button').disabled = false
  screenTo('entry')
  notice(message || '')
}

function publishDescriptor(signature) {
  pendingDescriptor = signature
  descriptorSent = connection.send({type:'descriptor', descriptor:signature})
}

async function syncCameraMode() {
  if (!cameraReady || !room || cameraBusy || room.phase === 'finished') return
  const mode = room.phase === 'playing' ? 'game' : isHost() ? 'host' : 'guest'

  if (mode === cameraMode) return
  cameraMode = mode
  const epoch = cameraEpoch

  try {
    if (mode === 'game') await tracker.play()
    else await tracker.lobby(isHost())
  } catch (error) {
    if (epoch === cameraEpoch) cameraStatus('Tracking stopped. ' + error.message)
  }
}

async function openCamera(resample = false) {
  if (cameraBusy || !room || room.phase === 'finished') return
  const epoch = ++cameraEpoch
  cameraBusy = true
  el('retryCamera').disabled = true
  el('cameraRetryLive').disabled = true
  document.body.dataset.sampling = String(resample)
  cameraStatus(resample ? 'Face the front camera and include your upper chest.' : 'Opening camera and checking shirt color…')

  try {
    const wasReady = cameraReady
    const host = isHost()

    const sampled = resample && wasReady ? await tracker.retrySelf()
      : await tracker.start({host,registered:!resample && !!me()?.descriptor,onSelfSignature:publishDescriptor})

    if (epoch !== cameraEpoch) return
    cameraReady = true

    if (!wasReady) cameraMode = host ? 'host' : 'guest'
    cameraStatus(sampled || me()?.descriptor ? 'Camera ready' : 'Camera ready. To register your color, frame your shirt and tap Refresh color.')

    if (room?.phase === 'lobby') connection.send({type:'ready',ready:true})
  } catch (error) {
    if (epoch !== cameraEpoch) return
    cameraReady = false
    cameraMode = null
    tracker.stop()
    cameraStatus(error.name === 'NotAllowedError' ? 'Allow camera access in your browser, then tap Retry camera.' : error.message)

    if (room?.phase === 'lobby') connection.send({type:'ready',ready:false})
  } finally {
    if (epoch === cameraEpoch) {
      cameraBusy = false
      document.body.dataset.sampling = 'false'
      render()
      void syncCameraMode()
    }
  }
}

function inviteUrl() {
  const link = new URL(location.pathname,location.origin)
  link.searchParams.set('room',room.code)

  return link.href
}

function textNode(tag, value) {
  const node = document.createElement(tag)
  node.textContent = value

  return node
}

function playerRow(p, rank, detail) {
  const li = document.createElement('li')

  if (rank) li.append(textNode('b',String(rank).padStart(2,'0')))
  const swatch = document.createElement('span')
  swatch.className = 'swatch'
  swatch.style.backgroundColor = p.color
  li.append(swatch,textNode('strong',p.name + (p.id === myId ? ' · you' : '')),textNode('small',detail))

  return li
}

function renderLobby() {
  el('roomCode').textContent = room.code
  el('inviteReachability').hidden = location.protocol === 'https:' && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)
  el('inviteQr').parentElement.hidden = !isHost()
  el('inviteQr').closest('.invite-print').querySelector('h2').textContent = isHost() ? 'Scan to join' : 'Room invite'

  if (isHost() && lastQr !== room.code) {
    lastQr = room.code
    QRCode.toCanvas(el('inviteQr'),inviteUrl(),{width:248,margin:4,color:{dark:'#142719',light:'#fffdee'}}).catch(() => notice('Share the invite link or room code'))
  }

  el('roster').replaceChildren(...room.players.map(p => playerRow(p,null,
    !p.connected ? 'Reconnecting' : !p.ready ? 'Opening camera' : p.descriptor ? 'Ready' : 'Color pending')))
  const online = room.players.filter(p => p.connected)
  el('startRound').hidden = !isHost()
  el('startRound').disabled = !connection.connected || online.length < 2 || online.some(p => !p.ready || !p.descriptor)
  el('retryCamera').disabled = cameraBusy
  el('retryCamera').textContent = cameraReady ? 'Refresh color' : 'Retry camera'
}

function renderResults() {
  const first = room.leaderboard.filter(p => p.rank === 1)
  el('winner').textContent = first.length === 1 ? first[0].name + ' wins!' : 'Shared first place'
  el('standings').replaceChildren(...room.leaderboard.map(row => playerRow(
    room.players.find(p => p.id === row.id) || row,row.rank,row.hits+' hits · '+row.eliminations+' KOs')))
  el('rematch').hidden = !isHost()
  el('rematch').disabled = !connection.connected
}

function updateClock() {
  if (screen !== 'arena' || !room) return
  const before = Math.max(0,Math.ceil((room.startsAt-serverTime())/1000))
  const left = Math.max(0,Math.ceil((room.endsAt-Math.max(serverTime(),room.startsAt))/1000))
  el('clock').textContent = Math.floor(left/60)+':'+String(left%60).padStart(2,'0')
  el('launch').disabled = !canThrow()

  if (performance.now() < hintUntil && !before) return
  const p = me()

  const hint = !connection.connected ? 'Reconnecting…' : before ? 'Starting in '+before
    : !cameraReady ? 'Open camera to track players' : p?.spectator ? 'Spectating this round'
    : !p?.health ? 'You’re out · spectating' : 'Flick up to throw'

  if (hint !== lastCountdown || el('arenaHint').textContent !== hint) el('arenaHint').textContent = hint
  lastCountdown = hint
}

function render() {
  if (!room) return
  const next = room.phase === 'lobby' ? 'lobby' : room.phase === 'finished' ? 'results' : 'arena'

  if (screen !== next) {
    screenTo(next)

    if (next === 'arena') arena.start()

    if (next === 'results') releaseCamera()
  }

  if (next === 'lobby') renderLobby()
  else if (next === 'results') renderResults()
  else {
    el('health').textContent = String(me()?.health ?? 0) + ' / 10'
    el('alive').textContent = String(room.players.filter(p => p.id !== myId && !p.spectator && p.health > 0).length)
    el('cameraRetryLive').hidden = cameraReady && !!me()?.descriptor
    el('cameraRetryLive').disabled = cameraBusy
    el('cameraRetryLive').textContent = cameraReady ? 'Refresh color' : 'Open camera'
    updateClock()
  }
}

const connection = createConnection({
  onWelcome(welcome) {
    myId = welcome.playerId
    descriptorSent = false
    connecting = false
    notice('')
  },
  onState(next) {
    const prev = room
    const needsCamera = !prev || prev.phase === 'finished' && next.phase === 'lobby'
    room = next
    timeOffset = next.serverNow-Date.now()
    tracker.setRoster(room.players,myId)
    arena.setState(room,myId)
    render()

    if (needsCamera && room.phase !== 'finished') void openCamera()
    else void syncCameraMode()

    if (prev && room.phase === 'lobby' && isHost()) {
      for (const p of room.players) {
        if (!p.descriptor && p.id !== myId && !prev.players.some(old => old.id === p.id)) {
          tracker.observeJoin(p.id, signature => connection.send({type:'descriptor',targetId:p.id,descriptor:signature}))
        }
      }
    }

    // A room snapshot after reconnect may lag a local camera change made offline.
    if (!cameraBusy && room.phase === 'lobby' && me()?.ready !== cameraReady) connection.send({type:'ready',ready:cameraReady})

    if (pendingDescriptor) {
      const stored = me()?.descriptor

      if (stored?.length === pendingDescriptor.length && stored.every((value,i) => value === pendingDescriptor[i])) {
        pendingDescriptor = null
        descriptorSent = false
      } else if (!descriptorSent && room.phase !== 'finished') {
        descriptorSent = connection.send({type:'descriptor',descriptor:pendingDescriptor})
      }
    }
  },
  onStatus(message) {notice(message); render()},
  onReset:reset
})

function enter(type,code) {
  if (connecting) return
  connecting = true
  el('createRoom').disabled = true
  el('joinForm').querySelector('button').disabled = true
  notice('Connecting to room…')
  connection.enter({type,code,name:el('nickname').value.trim()})
}

el('createRoom').addEventListener('click', () => enter('create'))

el('joinForm').addEventListener('submit', e => {
  e.preventDefault()
  const code = el('joinCode').value.trim()

  if (/^\d{6}$/.test(code)) enter('join',code)
  else notice('Enter the six-digit room code')
})

el('startRound').addEventListener('click', () => connection.send({type:'start'}))

el('rematch').addEventListener('click', () => connection.send({type:'rematch'}))

el('retryCamera').addEventListener('click', () => openCamera(true))

el('cameraRetryLive').addEventListener('click', () => openCamera(true))

el('leave').addEventListener('click', () => {connection.leave(); reset('You left the room')})

el('copyInvite').addEventListener('click',async () => {
  try {await navigator.clipboard.writeText(inviteUrl()); notice('Room link copied')}
  catch {notice(inviteUrl())}
})

const invite = new URLSearchParams(location.search).get('room')

if (invite && /^\d{6}$/.test(invite)) {
  el('joinCode').value = invite
  document.body.dataset.invited = 'true'
}

screenTo('entry')

connection.restore(invite)

setInterval(updateClock,150)
