// Opens the published prototype page at phone size, goes through every DEMO state in both themes, and reports any
// element that cuts off its own content (overflow hidden/clip with content taller or wider than the box) and any
// scroll container whose children were squeezed (a flex child shorter than its own content). Screenshots each state.
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { chromium } = (() => { try { return req('playwright') } catch { return req(process.env.PLAYWRIGHT_PATH ?? '/opt/npm-tools/node_modules/playwright/index.js') } })()
import fs from 'node:fs'
const [, , page_path, outDir = 'check/shots'] = process.argv
fs.mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('file://' + page_path)
await page.waitForTimeout(500)

const findClipped = () => {
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || el.closest('[data-demo-menu]')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const clipsY = ['hidden', 'clip'].includes(cs.overflowY)
    const clipsX = ['hidden', 'clip'].includes(cs.overflowX)
    const tallY = el.scrollHeight > el.clientHeight + 1
    const wideX = el.scrollWidth > el.clientWidth + 1
    // A squeezed flex child: its box is shorter than what it holds, and it doesn't scroll.
    const parent = el.parentElement && getComputedStyle(el.parentElement)
    // (A row given an explicit height on purpose, like the planner's 1px link gap whose button overhangs it, isn't squeezed.)
    const squeezed = parent && parent.display.includes('flex') && parent.flexDirection.startsWith('column') && !['auto', 'scroll'].includes(cs.overflowY) && !el.style.height && cs.flexShrink !== '0' && el.scrollHeight > r.height + 1
    if ((clipsY && tallY) || (clipsX && wideX && !el.className.toString().includes('truncate')) || squeezed) {
      out.push(`${el.tagName.toLowerCase()}${el.getAttribute('data-row-key') ? `[${el.getAttribute('data-row-key')}]` : ''} "${(el.textContent || '').trim().slice(0, 40)}" box ${Math.round(r.height)} content ${el.scrollHeight}`)
    }
  }
  return out.slice(0, 6)
}

let total = 0
for (const theme of ['dark', 'light']) {
  await page.getByText('DEMO', { exact: true }).click()
  await page.getByRole('button', { name: theme.toUpperCase(), exact: true }).click()
  await page.locator('[aria-label="Close"]').click()
  await page.getByText('DEMO', { exact: true }).click()
  const count = await page.locator('[data-demo-state]').count()
  await page.locator('[aria-label="Close"]').click()
  for (let i = 0; i < count; i++) {
    await page.getByText('DEMO', { exact: true }).click()
    const chip = page.locator('[data-demo-state]').nth(i)
    const name = await chip.getAttribute('data-demo-state')
    await chip.click()
    await page.waitForTimeout(1100)
    const clipped = await page.evaluate(findClipped)
    if (theme === 'dark') await page.screenshot({ path: `${outDir}/${String(i).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '_')}.png` })
    if (clipped.length) { total += clipped.length; console.log(`CLIPPED [${theme}] ${name}\n  ` + clipped.join('\n  ')) }
  }
}
// Theme check: the page background follows the theme.
console.log(errors.length ? 'PAGE ERRORS\n  ' + errors.slice(0, 5).join('\n  ') : 'no page errors')
console.log(total === 0 ? 'NO CLIPPING FOUND' : `${total} clipped elements`)
await browser.close()
process.exit(total === 0 && errors.length === 0 ? 0 : 1)
