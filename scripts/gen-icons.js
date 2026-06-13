// Generate the PWA icons + favicon from public/brand-logo.png, composited onto the
// app's dark background. Uses Playwright (already a dev dep) for canvas rendering.
// Run: node scripts/gen-icons.js
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const logoB64 = readFileSync(join(root, 'public', 'brand-logo.png')).toString('base64')
const outDir = join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

async function render(size, pad, bg) {
  const dataUrl = await page.evaluate(
    async ({ size, pad, bg, logoB64 }) => {
      const c = document.getElementById('c')
      c.width = size
      c.height = size
      const x = c.getContext('2d')
      x.fillStyle = bg
      x.fillRect(0, 0, size, size)
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + logoB64 })
      const inner = size * (1 - pad * 2)
      const scale = Math.min(inner / img.width, inner / img.height)
      const w = img.width * scale
      const h = img.height * scale
      x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      return c.toDataURL('image/png')
    },
    { size, pad, bg, logoB64 }
  )
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

const BG = '#0e0e12'
writeFileSync(join(outDir, 'icon-192.png'), await render(192, 0, BG))
writeFileSync(join(outDir, 'icon-512.png'), await render(512, 0, BG))
writeFileSync(join(outDir, 'favicon-32.png'), await render(32, 0, BG))
console.log('wrote icon-192.png, icon-512.png, favicon-32.png from brand-logo.png')
await browser.close()
