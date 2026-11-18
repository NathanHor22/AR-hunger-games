import { mountMascots } from './menu-art.js'

// Original cut-paper letterforms, drawn on a small pixel grid for the title screen.
const letters = {
  T: [33, 'M1 0H35L33 11H23V38H11V11H0Z'],
  O: [34, 'M8 0H26L34 7V29L26 38H7L0 30V8ZM12 10V28H22V10Z'],
  M: [41, 'M0 38V0H11L21 14L30 0H41V38H29V18L21 29L12 18V38Z'],
  A: [34, 'M0 38L6 6L12 0H28L35 38H23L22 30H13L12 38ZM15 20H21L19 10H17Z'],
  R: [34, 'M0 38V0H26L33 7V19L27 25L35 38H21L14 26H12V38ZM12 9V17H21V9Z'],
  I: [16, 'M1 0H18L16 38H0Z'],
  '!': [14, 'M2 0H17L13 25H4ZM1 29H13V38H0Z']
}

function paintTitle(canvas) {
  const ctx = canvas.getContext('2d')

  if (!ctx) return

  const drawWord = (word, x, y, size, top, mid, edge) => {
    let advance = 0

    const glyphs = Array.from(word, (letter, i) => {
      const [width, outline] = letters[letter]
      const path = new Path2D(outline)
      const offset = advance
      advance += width + 1

      return { path, offset, lift: Math.abs(i - (word.length - 1) / 2) * 1.15 }
    })

    for (const [drop, stroke, fill] of [
      [6, '#17142b', '#17142b'],
      [4, '#6e303c', '#b64436'],
      [0, '#251933', top]
    ]) {
      for (const { path, offset, lift } of glyphs) {
        ctx.save()
        ctx.translate(x, y + drop)
        ctx.transform(size, -0.075 * size, -0.12 * size, size, 0, 0)
        ctx.translate(offset, lift)
        ctx.lineJoin = 'round'
        ctx.lineWidth = 5
        ctx.strokeStyle = stroke
        ctx.stroke(path)
        ctx.fillStyle = fill
        ctx.fill(path, 'evenodd')

        if (!drop) {
          ctx.clip(path, 'evenodd')
          ctx.fillStyle = mid
          ctx.fillRect(-1, 23, 48, 18)
          ctx.fillStyle = edge
          ctx.fillRect(-1, 35, 48, 5)
          ctx.fillStyle = '#fff7ca'
          ctx.fillRect(2, 2, 32, 2)
        }

        ctx.restore()
      }
    }
  }

  drawWord('TOMATO', 20, 22, 1, '#fff3b5', '#ffdf75', '#f8b357')
  drawWord('RIOT!', 33, 62, 1.45, '#ffe34c', '#ffb632', '#f58b2e')
}

function paintCity(canvas) {
  const g = canvas.getContext('2d')

  if (!g) return

  // A market at dusk: distant roof stacks, lit apartment windows and striped stalls.
  const rect = (x, y, w, h, color) => {
    g.fillStyle = color
    g.fillRect(x, y, w, h)
  }

  for (let i = 0, x = -8; x < 480; i++) {
    const width = 10 + ((i * 17) % 21)
    const y = 20 + ((i * 29) % 28)
    rect(x, y, width, 85 - y, '#63507c')
    rect(x + 2, y - 3, width - 4, 3, '#735985')
    x += width + 3
  }

  for (let i = 0, x = -7; x < 480; i++) {
    const width = 15 + ((i * 23) % 27)
    const y = 29 + ((i * 19) % 27)
    rect(x, y, width, 85 - y, '#392e54')
    rect(x - 1, y - 2, width + 2, 3, '#46365d')

    if (i % 3 === 1) {
      rect(x + 5, y - 8, 5, 7, '#443354')
      rect(x + width - 5, y - 14, 1, 14, '#443354')
      rect(x + width - 8, y - 12, 7, 1, '#443354')
    }

    for (let wx = x + 3; wx < x + width - 3; wx += 6) {
      for (let wy = y + 4; wy < 70; wy += 7) {
        if ((wx + wy) % 4) rect(wx, wy, 3, 3, (wx + wy) % 3 ? '#956983' : '#e7a77e')
      }
    }

    x += width + 3
  }

  for (const x of [-22, 70, 208, 323, 430]) {
    rect(x, 71, 52, 14, '#251f39')

    for (let i = 0; i < 11; i++) {
      rect(x + i * 5, 65, 5, 6, i % 2 ? '#774253' : '#b26667')
      rect(x + i * 5 - 1, 69, 6, 4, i % 2 ? '#60364c' : '#98535d')
    }

    rect(x + 4, 74, 2, 11, '#db9978')
    rect(x + 47, 74, 2, 11, '#9d6d72')
  }

  rect(0, 83, 480, 2, '#201b32')
}

export function mountStartMenu(invite) {
  paintTitle(document.getElementById('menuTitle'))
  paintTitle(document.getElementById('roomBrand'))
  paintCity(document.getElementById('menuCity'))
  paintCity(document.querySelector('.lobby-city'))
  mountMascots()
  const drawer = document.getElementById('codeDrawer')
  const code = document.getElementById('joinCode')

  if (/^\d{6}$/.test(invite ?? '')) {
    code.value = invite
    drawer.open = true
    drawer.parentElement.prepend(drawer)
    document.body.dataset.invited = 'true'
  }

  const help = document.getElementById('menuHelp')
  document.getElementById('openHelp').addEventListener('click', () => help.showModal())
}
