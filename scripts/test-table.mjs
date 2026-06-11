import { chromium } from 'playwright'

const APP = 'http://localhost:5173'
const log = (...a) => console.log(...a)
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { (ok ? pass++ : fail++); log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`) }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => log('  [pageerror]', e.message))

async function freshDoc() {
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.click('text=Create Document')
  await page.waitForSelector('.ProseMirror', { timeout: 8000 })
  await page.waitForTimeout(200)
}
async function insertTable(r = 3, c = 3) {
  await page.click('button[title="Insert table"]')
  await page.waitForSelector('.table-picker')
  await page.locator('.tp-cell').nth((r - 1) * 10 + (c - 1)).click()
  await page.waitForSelector('.ProseMirror table')
  await page.waitForTimeout(150)
}
async function dragSelectRow(rowIndex = 1) {
  const cells = page.locator('.ProseMirror table tr').nth(rowIndex).locator('td')
  const a = await cells.nth(0).boundingBox()
  const b = await cells.nth(1).boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 6, a.y + a.height / 2, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  return { a, b }
}

try {
  // A: merge via toolbar
  await freshDoc(); await insertTable()
  await dragSelectRow(1)
  check('A: drag creates cell selection', (await page.locator('.selectedCell').count()) === 2)
  await page.click('.table-toolbar button[title="Merge cells"]')
  await page.waitForTimeout(250)
  check('A: toolbar merge → colspan=2', (await page.locator('.ProseMirror td[colspan="2"]').count()) === 1)

  // B: merge via right-click
  await freshDoc(); await insertTable()
  const { b } = await dragSelectRow(1)
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' })
  await page.waitForTimeout(250)
  check('B: right-click opens context menu', (await page.locator('.table-ctx').count()) === 1)
  check('B: cell selection preserved on right-click', (await page.locator('.selectedCell').count()) === 2,
    'selected=' + (await page.locator('.selectedCell').count()))
  const ctxMerge = page.locator('.table-ctx button:has-text("Merge cells")')
  check('B: ctx merge enabled', (await ctxMerge.count()) === 1 && !(await ctxMerge.first().isDisabled()))
  await ctxMerge.first().click()
  await page.waitForTimeout(250)
  check('B: right-click merge → colspan=2', (await page.locator('.ProseMirror td[colspan="2"]').count()) === 1)

  // C: move table up (above a paragraph)
  await freshDoc()
  await page.click('.ProseMirror')
  await page.keyboard.type('PARA1')
  await page.keyboard.press('Enter')
  await insertTable()
  await page.locator('.ProseMirror table td').first().click()
  await page.waitForTimeout(150)
  const tableYBefore = (await page.locator('.ProseMirror table').first().boundingBox()).y
  const paraYBefore = (await page.locator('.ProseMirror p:has-text("PARA1")').first().boundingBox()).y
  check('C: table starts below the paragraph', tableYBefore > paraYBefore)
  await page.click('.table-toolbar button[title="Move table up"]')
  await page.waitForTimeout(250)
  const tableYAfter = (await page.locator('.ProseMirror table').first().boundingBox()).y
  const paraYAfter = (await page.locator('.ProseMirror p:has-text("PARA1")').first().boundingBox()).y
  check('C: after Move Up, table is above the paragraph', tableYAfter < paraYAfter,
    `table=${Math.round(tableYAfter)} para=${Math.round(paraYAfter)}`)

  // D: copy + paste table
  await freshDoc(); await insertTable()
  await page.locator('.ProseMirror table td').first().click()
  await page.waitForTimeout(150)
  await page.click('.table-toolbar button[title="Copy table"]')
  await page.waitForTimeout(150)
  const pasteBtn = page.locator('.table-toolbar button[title="Paste table"]')
  check('D: paste enabled after copy', !(await pasteBtn.first().isDisabled()))
  await pasteBtn.first().click()
  await page.waitForTimeout(250)
  check('D: paste creates a 2nd table', (await page.locator('.ProseMirror table').count()) === 2,
    'tables=' + (await page.locator('.ProseMirror table').count()))

  // E: Tab at last cell adds a row
  await freshDoc(); await insertTable(2, 2)
  await page.locator('.ProseMirror table td').last().click()
  await page.waitForTimeout(100)
  const rowsBefore = await page.locator('.ProseMirror table tr').count()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(200)
  const rowsAfter = await page.locator('.ProseMirror table tr').count()
  check('E: Tab in last cell adds a row', rowsAfter === rowsBefore + 1, `${rowsBefore}→${rowsAfter}`)

  log(`\nRESULT: ${pass} passed, ${fail} failed`)
} catch (e) {
  log('TEST ERROR:', e.message)
  await page.screenshot({ path: 'scripts/table-test-error.png' }).catch(() => {})
} finally {
  await browser.close()
}
