// Roda media/panel.js com um DOM falso para pegar erros de lógica/ReferenceError.
const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const { findRecursiveFunctions } = require('../src/detect')
const { instrument } = require('../src/instrument')
const { runTrace } = require('../src/run')

function fakeElement() {
  const element = {
    children: [], style: {}, classList: { toggle() {}, add() {}, remove() {} }, listeners: {}, attrs: {},
    append(...items) { this.children.push(...items) },
    replaceChildren(...items) { this.children = items },
    setAttribute(name, value) { this.attrs[name] = value },
    addEventListener(name, fn) { this.listeners[name] = fn },
    scrollIntoView() {},
    set innerHTML(value) { this._html = value },
    get innerHTML() { return this._html || '' },
    value: '0',
  }
  return element
}

async function main() {
  const source = 'function fib(n) {\n  if (n < 2) return n\n  return fib(n - 1) + fib(n - 2)\n}\nfib(4)\nfib(1)'
  const fn = findRecursiveFunctions(source)[0]
  const result = await runTrace(instrument(source, fn.start).code)
  const payload = { fnName: 'fib', fnLine: 1, params: fn.params, fileName: 'x.js', ...result }

  const cache = {}
  const messages = []
  let onMessage
  const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: (message) => messages.push(message), getState: () => ({}), setState() {} }),
    document: {
      getElementById: (id) => (cache[id] ||= fakeElement()),
      createElement: fakeElement,
      createElementNS: fakeElement,
      addEventListener() {},
    },
    window: { addEventListener: (name, fn) => { onMessage = fn } },
    setTimeout, clearTimeout,
  }
  vm.runInNewContext(fs.readFileSync(__dirname + '/../media/panel.js', 'utf8'), sandbox)
  onMessage({ data: { type: 'data', payload } })

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
  console.log('panel OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
