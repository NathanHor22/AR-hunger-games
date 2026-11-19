import { mountStartMenu } from './menu.js'
import QRCode from 'qrcode'
import { createConnection } from './connection.js'
import { createArena } from './arena.js'
import { createTracker } from './public/tracking.js'
import { inkColors } from './public/ink.js'

const el = id => document.getElementById(id)
const video = el('video')
let room, myId, cameraReady = false, cameraBusy = false, cameraEpoch = 0, cameraNote = ''
let lastQr = '', noticeTimer, hintUntil = 0, timeOffset = 0, pendingColor, colorSent = false
let screen = 'entry', connecting = false, selectedTrack = null, namedGroup = false, arenaMessage = ''

const me = () => room?.players.find(p => p.id === myId)
const isHost = () => !!myId && room?.hostId === myId
const serverTime = () => Date.now() + timeOffset
const rivals = () => room.players.filter(p => p.id !== myId && p.connected && !p.spectator && p.health > 0)

function showText(id, value) {
  const node = el(id)

  if (node.textContent !== value) node.textContent = value
}

function screenTo(next) {
  const changed = next !== screen
  screen = next
  document.body.dataset.screen = next
  el('leave').hidden = next === 'entry'

  if (changed) {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close()
    const panel = el(next)
    panel.tabIndex = -1
    panel.focus({preventScroll:true})
    window.scrollTo(0,0)
  }
}

function notice(message) {
  clearTimeout(noticeTimer)
  el('notice').textContent = message

  if (message) noticeTimer = setTimeout(() => {el('notice').textContent = ''}, 4500)
}

function sayArena(message) {
  arenaMessage = message
  hintUntil = performance.now() + 1700
  showText('arenaHint',message)
}

const tracker = createTracker(video,{
  onFrame: (...frame) => arena.setPeople(...frame),
  onStatus(message) {
    cameraNote = message

    if (message.startsWith('Tracking stopped')) {
      cameraReady = false
      render()
    }
  }
})

function canIdentify() {
  return room?.phase === 'playing' && !el('identify').open && cameraReady && connection.connected
}

function canSpray() {
  return canIdentify() && room.startsAt <= serverTime() && room.endsAt > serverTime()
    && me()?.health > 0 && !me().spectator
}

function chooseName(trackId) {
  if (selectedTrack != null || !canIdentify()) return
  const options = rivals()

  if (!options.length) return
  selectedTrack = trackId
  el('nameOptions').replaceChildren(...options.map(p => {
    const button = document.createElement('button')
    button.type = 'button'
    button.append(swatch(p.color), document.createTextNode(p.name))
    button.addEventListener('click', () => {
      const assigned = tracker.assign(trackId,p.id)
      el('identify').close()

      if (assigned) namedGroup = true
      sayArena(assigned ? p.name + ' tagged.' : 'That person moved. Tap them again.')
      render()
    })

    return button
  }))
  el('identify').showModal()
}

el('identify').addEventListener('close', () => { selectedTrack = null })

const arena = createArena({
  video, canvas:el('overlay'), canSpray, canIdentify, onIdentify:chooseName,
  send:m => connection.send(m), message:sayArena
})

function releaseCamera() {
  cameraEpoch++
  hintUntil = 0
  cameraReady = cameraBusy = false
  cameraNote = ''
  selectedTrack = null
  namedGroup = false
  tracker.stop()
  arena.stop()
}

async function openCamera() {
  if (screen !== 'arena' || cameraBusy || cameraReady) return
  const epoch = ++cameraEpoch
  cameraBusy = true
  cameraNote = 'Opening rear camera…'
  render()

  try {
    const started = await tracker.start()

    if (epoch !== cameraEpoch || !started) return
    cameraReady = true

    if (!me()?.spectator) sayArena('Tap to throw a tomato. Hold and drag to cover more.')
  } catch (error) {
    if (epoch !== cameraEpoch) return
    tracker.stop()
    cameraNote = error.name === 'NotAllowedError'
      ? (me()?.spectator ? 'Enable your rear camera to watch the paint.' : 'Enable your rear camera to spray. Other players can still paint you.')
      : error.message || 'Could not open the rear camera.'
  } finally {
    if (epoch === cameraEpoch) {
      cameraBusy = false
      render()
    }
  }
}

function reset(message) {
  releaseCamera()
  room = myId = pendingColor = null
  colorSent = false
  lastQr = ''
  hintUntil = 0
  connecting = false
  el('createRoom').disabled = false
  el('joinForm').querySelector('button').disabled = false
  screenTo('entry')
  notice(message || '')
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

function swatch(color) {
  const node = document.createElement('span')
  node.className = 'swatch'
  node.style.backgroundColor = color
  node.setAttribute('aria-hidden','true')

  return node
}

function playerRow(p, rank, detail) {
  const li = document.createElement('li')

  if (rank) {
    li.dataset.rank = String(rank)
    li.append(textNode('b',String(rank).padStart(2,'0')))
  } else li.dataset.state = p.connected ? 'ready' : 'offline'
  li.append(swatch(p.color),textNode('strong',p.name + (p.id === myId ? ' · you' : '')),textNode('small',detail))

  return li
}

for (const {name,hex} of inkColors) {
  const label = document.createElement('label')
  const radio = document.createElement('input')
  label.className = 'ink-pot'
  label.style.setProperty('--ink-color',hex)
  radio.type = 'radio'
  radio.name = 'ink'
  radio.value = hex
  label.append(radio,textNode('span',name))
  el('inkPalette').append(label)
}

el('inkPalette').addEventListener('change', event => {
  pendingColor = event.target.value
  colorSent = connection.send({type:'color',color:pendingColor})
})

function renderLobby() {
  const host = isHost()
  el('lobby').dataset.role = host ? 'host' : 'guest'
  showText('lobbyTitle', host ? 'Host room' : 'Room lobby')
  showText('roomCode',room.code)
  el('inviteReachability').hidden = !host || location.protocol === 'https:' && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)
  el('inviteQr').parentElement.hidden = !host
  showText('inviteHeading', host ? 'Scan to join' : 'Room invite')

  if (host && lastQr !== room.code) {
    lastQr = room.code
    QRCode.toCanvas(el('inviteQr'),inviteUrl(),{width:248,margin:4,color:{dark:'#221a32',light:'#fffdee'}}).catch(() => notice('Share the invite link or room code'))
  }

  el('roster').replaceChildren(...room.players.map(p => playerRow(p,null,
    p.connected ? inkColors.find(c => c.hex === p.color)?.name : 'Reconnecting')))

  const owners = new Map(room.players.map(p => [p.color, p]))

  for (const radio of el('inkPalette').querySelectorAll('input')) {
    const owner = owners.get(radio.value)
    radio.disabled = !!owner && owner.id !== myId
    radio.checked = radio.value === (pendingColor || me()?.color)
    radio.parentElement.title = radio.disabled ? 'Taken by ' + owner.name : ''
  }

  el('inkLocker').disabled = !connection.connected
  const online = room.players.filter(p => p.connected).length
  showText('rosterCount', online + ' / ' + inkColors.length)
  showText('lobbyStatus', !connection.connected ? 'Reconnecting to the room…' : online < 2
    ? 'Invite a second player to start.' : host ? 'Your crew is in. Start when you’re ready.' : 'Waiting for the host to start.')
  el('startRound').hidden = !host
  el('startRound').disabled = !connection.connected || online < 2
}

function renderResults() {
  const first = room.leaderboard.filter(p => p.rank === 1)
  showText('winner', !first[0]?.score ? 'No points scored' : first.length === 1 ? first[0].name + ' wins!' : 'Shared first place')
  el('standings').replaceChildren(...room.leaderboard.map(row => playerRow(
    room.players.find(p => p.id === row.id) || row, row.rank, row.score + ' pts · ' + row.coverage + '% inked')))
  el('rematch').hidden = !isHost()
  el('rematch').disabled = !connection.connected
}

function updateClock() {
  if (screen !== 'arena' || !room) return
  const now = serverTime()
  const before = Math.max(0, Math.ceil((room.startsAt - now) / 1000))
  const left = Math.max(0, Math.ceil((room.endsAt - Math.max(now,room.startsAt)) / 1000))
  showText('clock', Math.floor(left / 60) + ':' + String(left % 60).padStart(2,'0'))
  const countdown = el('roundCountdown')
  countdown.hidden = !connection.connected || before === 0

  if (!countdown.hidden) showText('roundCountdown',String(before))

  const p = me()

  const hint = !connection.connected ? 'Reconnecting…' : before ? 'Starting in ' + before
    : performance.now() < hintUntil ? arenaMessage
    : !cameraReady && cameraNote ? cameraNote : p?.spectator || !p?.health ? 'Spectating this round'
    : !cameraReady ? 'Open your rear camera to spray.' : ''

  showText('arenaHint',hint)
}

function render() {
  if (!room) return
  const next = room.phase === 'lobby' ? 'lobby' : room.phase === 'finished' ? 'results' : 'arena'

  if (screen !== next) {
    if (screen === 'arena') releaseCamera()
    screenTo(next)

    if (next === 'arena') {
      arena.start()

      if (!me()?.spectator && me()?.health > 0) void openCamera()
    }
  }

  if (next === 'lobby') renderLobby()
  else if (next === 'results') renderResults()
  else {
    const self = me()
    showText('score',String(self?.score ?? 0))
    showText('coverage',(self?.coverage ?? 0) + '%')
    el('arena').style.setProperty('--player-ink',self?.color || '#fff2d2')
    el('cameraRetryLive').hidden = cameraReady || cameraBusy
    showText('cameraRetryLive',self?.spectator ? 'Watch with camera' : 'Open rear camera')
    el('resetNames').hidden = !namedGroup || !cameraReady || rivals().length < 2
    updateClock()
  }
}

const connection = createConnection({
  onPaint: event => arena.receivePaint(event),
  onWelcome(welcome) {
    myId = welcome.playerId
    tracker.clearAssignments()

    if (el('identify').open) el('identify').close()
    namedGroup = colorSent = connecting = false
    notice('')
  },
  onState(next) {
    room = next
    timeOffset = next.serverNow - Date.now()

    if (room.phase !== 'lobby' || room.players.some(p => p.color === pendingColor)) pendingColor = null

    if (pendingColor && !colorSent) colorSent = connection.send({type:'color',color:pendingColor})
    tracker.setRoster(room.players,myId)
    arena.setState(room,myId)
    render()
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

el('cameraRetryLive').addEventListener('click', () => void openCamera())

el('resetNames').addEventListener('click', () => {
  tracker.clearAssignments()
  namedGroup = false
  sayArena('Tap a person to tag their name again.')
  render()
})

el('leave').addEventListener('click', () => {connection.leave(); reset('You left the room')})

el('copyInvite').addEventListener('click',async () => {
  try {await navigator.clipboard.writeText(inviteUrl()); notice('Room link copied')}
  catch {notice(inviteUrl())}
})

const invite = new URLSearchParams(location.search).get('room')

mountStartMenu(invite)

screenTo('entry')

connection.restore(invite)

setInterval(updateClock,150)
