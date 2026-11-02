// Roda media/panel*.js com um DOM falso para pegar erros de lógica/ReferenceError.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { findRecursiveFunctions } = require('../src/detect')
const { instrument } = require('../src/instrument')
const { runTrace } = require('../src/run')

const PANEL_SCRIPTS = ['panel-state.js', 'panel-tree.js', 'panel-details.js', 'panel.js']

function fakeElement() {
  const element = {
    children: [],
    style: {},
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
  }
  return element
}

function loadPanel(payload) {
  const cache = {}
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
      createElementNS: fakeElement,
      addEventListener() {},
    },
    window: {
      addEventListener: (name, fn) => {
        onMessage = fn
      },
    },
    setTimeout,
    clearTimeout,
  }
  const source = PANEL_SCRIPTS.map((name) =>
    fs.readFileSync(path.join(__dirname, '..', 'media', name), 'utf8'),
  ).join('\n')
  vm.runInNewContext(source, sandbox)
  onMessage({ data: { type: 'data', payload } })
  return cache
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
  console.log('panel OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
