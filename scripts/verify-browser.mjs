import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '')
if (process.env.STOCKFLOW_BROWSER_VERIFY !== '1') throw new Error('Set STOCKFLOW_BROWSER_VERIFY=1 only for a dedicated verification database. This script writes audit fixtures.')
await mkdir(`${root}/.tools`, { recursive: true })
const origin = process.env.STOCKFLOW_BROWSER_ORIGIN || 'http://127.0.0.1:5175'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9223', `--user-data-dir=${root}/.tools/browser-profile`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
let ws
let seq = 0
const pending = new Map()
const results = []
const browserErrors = []
try {
  let tabs
  for (let i = 0; i < 60; i++) {
    try { tabs = await (await fetch('http://127.0.0.1:9223/json')).json(); break } catch { await delay(200) }
  }
  if (!tabs) throw new Error('Chrome remote debugging did not start')
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails)
    if (!message.id) return
    const entry = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const wait = async (expression, name) => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100) }
    throw new Error(`Timeout: ${name}\n${await evaluate('document.body.innerText')}`)
  }
  const text = async value => wait(`document.body.innerText.includes(${JSON.stringify(value)})`, value)
  const click = async (label, selector = 'button') => evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(label)} && e.getClientRects().length); if (!e || e.disabled) throw Error('Missing/disabled button: '+${JSON.stringify(label)}); e.click() })()`)
  const fill = async (selector, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing input'); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true})) })()`)
  const record = name => { results.push(name); console.log(`PASS ${name}`) }
  const screenshot = async name => {
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await writeFile(`${root}/.tools/${name}.png`, Buffer.from(image.data, 'base64'))
  }
  await send('Page.enable')
  await send('Runtime.enable')
  // Auto-accept actual native confirmation dialogs.
  ws.addEventListener('message', event => {
    if (JSON.parse(event.data).method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true })
  })
  await send('Page.navigate', { url: origin })
  await text('KOP-AR250')
  const sku = `UI-${Date.now()}`
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(origin + '/api' + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const data = response.status === 204 ? null : await response.json()
    return { status: response.status, data }
  }
  const rowStock = () => `document.querySelector('section[aria-label="Product list"] tbody tr td:nth-child(4)')?.textContent.trim()`
  await click('+ Add product')
  await fill('#sku', sku)
  await fill('#name', 'Browser verification')
  await fill('#price', '1000')
  await click('Save', 'dialog button')
  await text('Product saved successfully.')
  await fill('input[type=search]', sku)
  await text(sku)
  await wait(`document.querySelector('tbody td')?.textContent === ${JSON.stringify(sku)}`, 'created product loaded')
  record('Product create and list refresh through real API')
  await click('Edit')
  await fill('#name', 'Browser verification edited')
  await click('Save', 'dialog button')
  await text('Browser verification edited')
  record('Product edit reflected in table')
  await click('History')
  await text('No movements for this product yet.')
  record('Movement empty state')
  await click('Adjustment')
  await fill('#stock-qty', '0')
  await click('Save adjustment')
  await text('Quantity must be a positive integer')
  await fill('#stock-qty', '5')
  await fill('#stock-note', 'Browser stock in')
  await click('Save adjustment')
  await text('Browser stock in')
  await wait(`${rowStock()} === '5'`, 'stock in table')
  record('Stock in updates list, last movement and history')
  await click('Adjustment')
  await fill('#stock-type', 'out')
  await fill('#stock-qty', '2')
  await fill('#stock-note', 'Browser stock out')
  await click('Save adjustment')
  await text('Browser stock out')
  await wait(`${rowStock()} === '3'`, 'stock out table')
  await click('Adjustment')
  await fill('#stock-type', 'out')
  await fill('#stock-qty', '4')
  await click('Save adjustment')
  await text('Available quantity: 3')
  await wait(`document.querySelector('#stock-qty').value === '4' && !document.querySelector('#stock-qty').disabled`, 'failed input preserved')
  await screenshot('final-stock-conflict')
  record('Real 409 visible inside stock modal with available=3 and retained input')
  await click('Cancel', 'dialog button')
  await click('+ Create order')
  await text('Create sales order')
  await click('Create order')
  await text('Customer name is required')
  await fill('#order-customer', 'Browser buyer')
  await fill('#sku-search', sku)
  await wait(`!!document.querySelector('select option[value="${sku}"]')`, 'SKU from API')
  await fill('#order-sku-1', sku)
  await fill('#order-qty-1', '4')
  await click('Create order')
  await text('Available quantity: 3')
  await wait(`!!document.querySelector('.order-item.conflict-row')`, 'conflicting SKU highlighted')
  await screenshot('final-order-conflict')
  record('Real order 409 highlights exact SKU and available quantity')
  // Real backend 400: a legal int32 price times legal qty exceeds order INTEGER total.
  const product = (await api(`/products?search=${sku}&page=1&limit=10&filter=all`)).data.data[0]
  await api(`/products/${product.id}`, 'PUT', { sku, name: product.name, price: 2147483647, is_active: true })
  await fill('#order-qty-1', '2')
  await click('Create order')
  await text('Order total must not exceed 2147483647 IDR')
  record('Real backend 400 validation message visible in order UI')
  await api(`/products/${product.id}`, 'PUT', { sku, name: product.name, price: 1000, is_active: true })
  await click('Create order')
  await text('Server total:')
  await text('IDR')
  await text('CREATED')
  await click('Cancel order')
  await text('CANCELLED')
  await screenshot('final-order-cancelled')
  await click('Back to products')
  await wait(`${rowStock()} === '3'`, 'cancel restored stock visible')
  record('Server order detail, confirmed cancel, restored product stock')
  await fill('input[type=search]', 'NO-MATCH-9999999')
  await text('No products found')
  await fill('input[type=search]', '')
  await text('KOP-AR250')
  record('Product empty state and recovery')
  // Use real offline network conditions (no response stubs) to exercise error and retry.
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await click('Refresh')
  await text('Unable to connect to the server')
  await screenshot('final-offline-error')
  record('Real network failure produces visible list/summary error and retry')
  await send('Network.emulateNetworkConditions', { offline: false, latency: 500, downloadThroughput: 50000, uploadThroughput: 50000 })
  await click('Try again')
  await text('Loading products…')
  await text('KOP-AR250')
  record('Loading state under network latency and retry recovery')
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await fill('input[type=search]', sku)
  await wait(`document.querySelector('tbody td')?.textContent === ${JSON.stringify(sku)}`, 'test product')
  await click('Adjustment')
  await fill('#stock-qty', '1')
  await fill('#stock-note', 'Offline note retained')
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await click('Save adjustment')
  await text('Check your connection and the server')
  await wait(`document.querySelector('#stock-note').value === 'Offline note retained'`, 'offline note retained')
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await click('Cancel', 'dialog button')
  record('Offline modal error is understandable and preserves input')
  // Clear test stock using the real API; retained audit trail is intentional.
  await api(`/products/${product.id}/stock`, 'POST', { type: 'out', qty: 3, note: 'Browser verification restore zero balance' })
  // Delete an unrelated new product without history to verify actual delete flow.
  const disposable = (await api('/products', 'POST', { sku: `${sku}-DELETE`, name: 'Disposable UI verification', price: 0, is_active: true })).data
  await fill('input[type=search]', disposable.sku)
  await wait(`document.querySelector('tbody td')?.textContent === ${JSON.stringify(disposable.sku)}`, 'deletable product')
  await click('Delete')
  await text('Product deleted successfully.')
  await text('No products found')
  record('Confirmed product delete and empty-page refresh')
  if (browserErrors.length) throw new Error(`Browser exceptions: ${JSON.stringify(browserErrors)}`)
  await writeFile(`${root}/.tools/final-browser-results.json`, JSON.stringify({ results, sku, productID: product.id, browserErrors }, null, 2))
  console.log(`BROWSER_AUDIT_OK checks=${results.length} sku=${sku}`)
} catch (error) {
  console.error(error)
  console.error('Browser exceptions:', JSON.stringify(browserErrors))
  process.exitCode = 1
} finally {
  ws?.close()
  chrome.kill()
}