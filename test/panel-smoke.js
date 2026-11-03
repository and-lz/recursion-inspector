// Roda media/panel*.js com um DOM falso para pegar erros de lógica/ReferenceError.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { findRecursiveFunctions } = require('../src/detect')
const { instrument } = require('../src/instrument')
const { runTrace } = require('../src/run')

const PANEL_SCRIPTS = [
  'panel-state.js',
  'panel-summary.js',
  'panel-syntax.js',
  'panel-tree.js',
  'panel-layout.js',
  'panel-render.js',
  'panel-zoom.js',
  'panel-details.js',
  'panel-board.js',
  'panel-inspector.js',
  'panel-picker.js',
  'panel-tooltip.js',
  'panel.js',
]

function fakeElement() {
  const element = {
    children: [],
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    listeners: {},
    attrs: {},
    append(...items) {
      this.children.push(...items)
    },
    replaceChildren(...items) {
      this.children = items
    },
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    addEventListener(name, fn) {
      this.listeners[name] = fn
    },
    scrollIntoView() {},
    set innerHTML(value) {
      this._html = value
    },
    get innerHTML() {
      return this._html || ''
    },
    value: '0',
    clientWidth: 1000,
    clientHeight: 800,
  }
  return element
}

function loadPanel(payload) {
  const cache = {}
  const svgElements = []
  const messages = []
  let onMessage
  const sandbox = {
    acquireVsCodeApi: () => ({
      postMessage: (message) => messages.push(message),
      getState: () => ({}),
      setState() {},
    }),
    document: {
      getElementById: (id) => (cache[id] ||= fakeElement()),
      createElement: fakeElement,
      createElementNS: () => {
        const element = fakeElement()
        svgElements.push(element)
        return element
      },
      addEventListener() {},
    },
    window: {
      innerWidth: 1000,
      innerHeight: 800,
      addEventListener: (name, fn) => {
        onMessage = fn
      },
    },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    performance: { now: () => 0 },
  }
  const source = PANEL_SCRIPTS.map((name) =>
    fs.readFileSync(path.join(__dirname, '..', 'media', name), 'utf8'),
  ).join('\n')
  vm.runInNewContext(source, sandbox)
  onMessage({ data: { type: 'data', payload } })
  cache.svgElements = svgElements
  cache.sandbox = sandbox
  return cache
}

// Saltos de passo (incremental) têm de dar o mesmo desenho que a varredura completa.
function checkIncrementalRender(sandbox) {
  vm.runInContext(
    `(() => {
      const snapshot = () =>
        JSON.stringify([...state.trace.nodes.values()].map((node) => [node.className, node.edgeClass, node.edgeValueClass]))
      for (const step of [0, 3, 4, 10, 2, 18, 17, 5, 0, 6, 7, 18]) {
        goTo(step, true)
        const incremental = snapshot()
        renderTree(step)
        if (snapshot() !== incremental) throw new Error('render incremental diverge no passo ' + step)
      }
      const elementsBefore = state.trace.rootNode.element
      state.zoom = 0.2
      relayoutTree()
      const compactHeight = state.trace.rootNode.height
      state.zoom = 1
      relayoutTree()
      if (state.trace.rootNode.element !== elementsBefore) throw new Error('relayout recriou o nó')
      if (compactHeight !== DOT_SIZE || state.trace.rootNode.height === DOT_SIZE)
        throw new Error('relayout não trocou o tamanho do nó')
    })()`,
    sandbox,
  )
}

// Árvore larga (muitas folhas) vira lista indentada com texto: cabe na largura, rola na vertical.
async function testOutline() {
  const source =
    'function fib(n) {\n  if (n < 2) return n\n  return fib(n - 1) + fib(n - 2)\n}\nfib(12)'
  const fn = findRecursiveFunctions(source)[0]
  const result = await runTrace(instrument(source, fn.start).code)
  const cache = loadPanel({
    fnName: 'fib',
    fnLine: 1,
    params: fn.params,
    functionParams: { fib: fn.params },
    fileName: 'w.js',
    ...result,
  })
  const report = (zoom) =>
    vm.runInContext(
      `(() => {
        state.zoom = ${zoom}
        relayoutTree()
        return JSON.stringify([state.trace.outline, state.treeSize.width, state.treeSize.height])
      })()`,
      cache.sandbox,
    )
  for (const zoom of [0.2, 1]) {
    const [outline, width, height] = JSON.parse(report(zoom))
    assert.strictEqual(outline, true, `zoom ${zoom}: lista indentada`)
    assert.ok(width <= 1000, `zoom ${zoom}: cabe na largura (${width})`)
    assert.ok(height > width, `zoom ${zoom}: mais alta que larga (${width}x${height})`)
  }
}

async function testLocals() {
  const source = `function total(n) {
  if (n === 0) return 0
  const rest = total(n - 1)
  const sum = rest + n
  return sum
}
total(2)`
  const fn = findRecursiveFunctions(source)[0]
  const result = await runTrace(instrument(source, fn.start).code)
  const cache = loadPanel({
    fnName: 'total',
    fnLine: 1,
    params: fn.params,
    functionParams: { total: fn.params },
    fileName: 'z.js',
    ...result,
  })
  cache.slider.value = cache.slider.max
  cache.slider.listeners.input()
  assert.ok(cache.explainText.innerHTML.includes('rest = 1'), cache.explainText.innerHTML)
  assert.ok(cache.vars.innerHTML.includes('sum'), cache.vars.innerHTML)
}

async function testMutual() {
  const mutualSource = `function same(a, b) { return a === null && b === null ? true : a === null || b === null ? false : same(a.l, b.l) && same(a.r, b.r) }
function contains(root, sub) { return root === null ? false : same(root, sub) || contains(root.l, sub) }
same(null, null)
contains({ l: { l: null, r: null }, r: null }, { l: null, r: null })`
  const mutual = findRecursiveFunctions(mutualSource)
  const contains = mutual.find((candidate) => candidate.name === 'contains')
  const instrumented = instrument(mutualSource, contains.start)
  const mutualResult = await runTrace(instrumented.code)
  const mutualCache = loadPanel({
    fnName: 'contains',
    fnLine: 2,
    params: contains.params,
    fileName: 'y.js',
    functionParams: Object.fromEntries(
      instrumented.functions.map((entry) => [entry.name, entry.params]),
    ),
    ...mutualResult,
  })
  assert.strictEqual(mutualCache.rootSelect.children.length, 1, 'só chamadas de contains são raiz')
  mutualCache.slider.value = mutualCache.slider.max
  mutualCache.slider.listeners.input()
  assert.ok(mutualCache.summary.innerHTML.includes('chamadas'), mutualCache.summary.innerHTML)
  assert.ok(mutualCache.fnLegend.children.length === 2, 'legenda com as duas funções')
}

async function testSummary() {
  const source =
    'function fib(n) {\n  if (n < 2) return n\n  return fib(n - 1) + fib(n - 2)\n}\nfib(10)'
  const fn = findRecursiveFunctions(source)[0]
  const result = await runTrace(instrument(source, fn.start).code)
  const payload = {
    fnName: 'fib',
    fnLine: 1,
    params: fn.params,
    functionParams: { fib: fn.params },
    fileName: 'w.js',
    ...result,
  }
  const summary = loadPanel(payload)
  assert.strictEqual(summary.viewMode.hidden, false, 'toggle aparece em trace grande')
  assert.ok(summary.slider.max < result.events.length, 'resumido corta eventos')
  summary.slider.value = summary.slider.max
  summary.slider.listeners.input()
  assert.ok(summary.summary.innerHTML.includes('177 chamadas'), summary.summary.innerHTML)
  const full = loadPanel({ ...payload, settings: { summarized: false } })
  assert.strictEqual(full.slider.max, result.events.length)
}

async function main() {
  const source =
    'function fib(n) {\n  if (n < 2) return n\n  return fib(n - 1) + fib(n - 2)\n}\nfib(4)\nfib(1)'
  const fn = findRecursiveFunctions(source)[0]
  const result = await runTrace(instrument(source, fn.start).code)
  const payload = {
    fnName: 'fib',
    fnLine: 1,
    params: fn.params,
    functionParams: { fib: fn.params },
    fileName: 'x.js',
    ...result,
  }

  const cache = loadPanel(payload)
  assert.strictEqual(cache.rootSelect.children.length, 2)
  assert.strictEqual(cache.rootPicker.hidden, false, 'mais de uma chamada: oferece escolher')
  assert.strictEqual(cache.app.hidden, true)
  cache.rootPicker.children[1].listeners.click()
  assert.strictEqual(cache.rootPicker.hidden, true)
  assert.strictEqual(cache.slider.max, 18)
  cache.slider.value = '1'
  cache.slider.listeners.input()
  assert.ok(cache.explainText.innerHTML.includes('chamada inicial'), cache.explainText.innerHTML)
  for (let step = 0; step <= 18; step++) {
    cache.slider.value = String(step)
    cache.slider.listeners.input()
  }
  assert.ok(cache.summary.innerHTML.includes('9 chamadas'), cache.summary.innerHTML)
  cache.slider.value = '5'
  cache.slider.listeners.input()
  assert.ok(cache.explainText.innerHTML.includes('Caso base'), cache.explainText.innerHTML)
  assert.ok(cache.explainText.innerHTML.includes('n &lt; 2'), 'cita a condição do caso base')
  assert.ok(cache.explainText.innerHTML.includes('n = 1'), 'cita o valor do parâmetro')
  assert.ok(cache.vars.innerHTML.includes('teste'), cache.vars.innerHTML)
  checkIncrementalRender(cache.sandbox)
  await testLocals()
  await testOutline()
  const hoverable = cache.svgElements.filter((element) => element.listeners.mouseenter)
  assert.ok(hoverable.length > 0, 'nós da árvore têm tooltip')
  hoverable[0].listeners.mouseenter({ currentTarget: hoverable[0], clientX: 10, clientY: 10 })
  assert.ok(cache.tooltip.innerHTML.includes('fib('), cache.tooltip.innerHTML)
  assert.strictEqual(cache.tooltip.hidden, false)
  hoverable[0].listeners.mouseleave()
  assert.strictEqual(cache.tooltip.hidden, true)
  await testMutual()
  await testSummary()
  console.log('panel OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
