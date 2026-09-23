// Capture the real embedded inspector. Run from the repository root with the docs preview on 4173.
const { chromium, expect } = require(
  require.resolve('@playwright/test', {
    paths: [require('node:path').resolve(__dirname, '../../packages/hakka-browser')],
  }),
)
const fs = require('node:fs/promises')
const path = require('node:path')
async function main() {
  const out = path.join(__dirname, 'assets')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 540 },
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4173/embed/index.html')
  await expect(page.locator('.hakka-row')).toHaveCount(8)
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(out, 'overview.png') })
  await page
    .locator('.hakka-row')
    .filter({ hasText: '/search?q=hakka' })
    .screenshot({ path: path.join(out, 'failed-request.png') })
  // This presentation cursor follows actual pointer input; product pixels and behavior stay untouched.
  await page.evaluate(() => {
    const cursor = document.createElement('div')
    cursor.style.cssText =
      'position:fixed;width:18px;height:18px;border:2px solid #ee8320;border-radius:50%;pointer-events:none;z-index:2147483647;box-shadow:0 0 0 5px #ee832026;left:-50px;top:-50px'
    document.body.append(cursor)
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX - 9}px`
      cursor.style.top = `${e.clientY - 9}px`
    })
  })
  const framesDir = await fs.mkdtemp(path.join(__dirname, 'tmp', 'capture-'))
  const frames = []
  let recording = true
  const start = Date.now()
  // Screenshots retain device pixels; browser video recording only retains CSS pixels.
  const capture = (async () => {
    while (recording) {
      const time = (Date.now() - start) / 1000
      const name = `frame-${String(frames.length).padStart(4, '0')}.jpg`
      await page.screenshot({ path: path.join(framesDir, name), type: 'jpeg', quality: 95, scale: 'device' })
      frames.push({ time, name })
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
  })()
  const at = async (seconds) => {
    const delay = start + seconds * 1000 - Date.now()
    if (delay > 0) await page.waitForTimeout(delay)
  }
  const click = async (locator) => {
    const box = await locator.boundingBox()
    if (!box) throw Error('Missing target')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 })
    await locator.click()
  }
  await at(0.5)
  await click(page.locator('.hakka-search'))
  await page.locator('.hakka-search').pressSequentially('search', { delay: 95 })
  await expect(page.locator('.hakka-row')).toHaveCount(1)
  await at(2.5)
  await click(page.locator('.hakka-row'))
  await at(4.4)
  await click(page.getByRole('button', { name: 'Response', exact: true }))
  await expect(page.locator('.hakka-detail')).toContainText('internal_error')
  await at(11.1)
  const menu = page.locator('.hakka-detail-status .hakka-menu')
  await click(menu.locator('summary'))
  await at(12.8)
  await click(menu.getByRole('button', { name: 'cURL', exact: true }))
  await expect(menu.locator('summary')).toContainText('Copied')
  const curl = await page.evaluate(() => navigator.clipboard.readText())
  if (!curl.includes('https://api.example.com/search?q=hakka')) throw Error('cURL clipboard missing request')
  await at(14.4)
  await click(menu.locator('summary'))
  await at(15.5)
  await click(page.getByRole('button', { name: 'Copy as agent context', exact: true }))
  await page.waitForTimeout(250)
  const agent = await page.evaluate(() => navigator.clipboard.readText())
  if (!agent.includes('internal_error')) throw Error('Agent clipboard missing response evidence')
  await fs.writeFile(path.join(out, 'clipboard.json'), JSON.stringify({ curl, agent }, null, 2) + '\n')
  await at(20)
  recording = false
  await capture
  await browser.close()
  const concat = frames
    .map((frame, i) => `file '${frame.name}'\nduration ${Math.max(0.001, (frames[i + 1]?.time ?? 20) - frame.time)}`)
    .join('\n')
  await fs.writeFile(path.join(framesDir, 'frames.txt'), concat + `\nfile '${frames.at(-1).name}'\n`)
  const { execFileSync } = require('node:child_process')
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(framesDir, 'frames.txt'),
    '-t',
    '20',
    '-c:v',
    'libx264',
    '-crf',
    '16',
    '-preset',
    'fast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-an',
    path.join(out, 'workflow.mp4'),
  ])
  console.log(
    JSON.stringify({
      verified: ['filter', 'response', 'cURL clipboard', 'agent evidence clipboard'],
      curl,
      capturedFrames: frames.length,
    }),
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
