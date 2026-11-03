const assert = require('assert')
const vm = require('vm')
const fs = require('fs')
const { findRecursiveFunctions } = require('../src/detect')
const { instrument } = require('../src/instrument')
const { runTrace } = require('../src/run')
const { describe } = require('../src/shape')

const sameTreePath = '/Users/andre/workspace/LeetCode/tree/100-same-tree/attempt01-11.js'

const fibSource = `
function fib(n) {
  if (n < 2) return n
  return fib(n - 1) + fib(n - 2)
}
const iterative = (n) => { return n + 1 }
const sum = (items, index = 0) => index === items.length ? 0 : items[index] + sum(items, index + 1)
function outer(n) {
  function inner(k) {
    if (k === 0) return 0
    return inner(k - 1) + 1
  }
  return inner(n)
}
console.log(fib(5), sum([1, 2, 3]), outer(3))
`

async function testFib() {
  const found = findRecursiveFunctions(fibSource)
  assert.deepStrictEqual(
    found.map((fn) => fn.name),
    ['fib', 'sum', 'inner'],
  )

  for (const fn of found) {
    const { code } = instrument(fibSource, fn.start)
    assert.strictEqual(code.split('\n').length, fibSource.split('\n').length, 'linhas preservadas')
    const result = await runTrace(code)
    assert.strictEqual(result.error, null, `${fn.name}: ${result.error}`)
    assert.deepStrictEqual(result.stdout, ['5 6 3'], `${fn.name}: saída igual à original`)
    const calls = result.events.filter((event) => event.t === 'c')
    const returns = result.events.filter((event) => event.t === 'r')
    assert.strictEqual(calls.length, returns.length)
  }

  const fib = found[0]
  const fibTrace = await runTrace(instrument(fibSource, fib.start).code)
  assert.strictEqual(
    fibTrace.events.filter((event) => event.t === 'c' && event.fn === 'fib').length,
    15,
  )
  const rootReturn = fibTrace.events.find((event) => event.t === 'r' && event.id === 0)
  assert.strictEqual(rootReturn.v.s, '5')
  assert.strictEqual(fibTrace.events[1].line, 4, 'linha da chamada recursiva')

  await testTruncation(fib)
}

async function testProbes() {
  const source = `function sumTo(n, total = 0) {
  if (n === 0) return total
  const next = n - 1
  total += n
  let count = 0
  count++
  const copy = (total = total + 0)
  return sumTo(next, total) + count * 0
}
function pick(n) { let hit; if (hit = n < 2) return n; return pick(n - 1) + pick(n - 2) }
console.log(sumTo(3), pick(4))`
  const found = findRecursiveFunctions(source)
  const sumTo = found.find((fn) => fn.name === 'sumTo')
  const { code } = instrument(source, sumTo.start)
  assert.strictEqual(code.split('\n').length, source.split('\n').length, 'linhas preservadas')
  const result = await runTrace(code)
  assert.strictEqual(result.error, null)
  assert.deepStrictEqual(result.stdout, ['6 3'], 'sondas não mudam o resultado')

  const first = result.probes.filter((probe) => probe.id === 0)
  assert.deepStrictEqual(
    first.filter((probe) => probe.kind === 'cond').map((probe) => [probe.src, probe.result]),
    [['n === 0', false]],
  )
  const totals = first.filter((probe) => probe.name === 'total').map((probe) => probe.v.s)
  assert.deepStrictEqual(totals, ['3', '3'], 'total += n e atribuição aninhada')
  assert.strictEqual(
    first.find((probe) => probe.name === 'count' && probe.line === 6).v.s,
    '1',
    'count++ registra o valor novo',
  )
  const leaf = result.probes.filter((probe) => probe.kind === 'cond' && probe.result)
  assert.ok(leaf.some((probe) => probe.src === 'n === 0'))
  assert.ok(
    result.probes.every((probe) => probe.at >= 1 && probe.at <= result.events.length),
    'at dentro do intervalo de eventos',
  )

  const pick = found.find((fn) => fn.name === 'pick')
  const pickResult = await runTrace(instrument(source, pick.start).code)
  assert.deepStrictEqual(pickResult.stdout, ['6 3'], 'atribuição dentro de if')
}

async function testTruncation(fib) {
  const bigSource = fibSource.replace('fib(5)', 'fib(25)')
  const bigTrace = await runTrace(instrument(bigSource, fib.start).code)
  assert.ok(bigTrace.truncated, 'trunca no limite de eventos')
  assert.ok(bigTrace.events.length >= 20000 && bigTrace.events.length < 20100)
  assert.deepStrictEqual(bigTrace.stdout, ['75025 6 3'], 'programa segue correto após truncar')

  const overflowSource = 'function loop(n) { return n === 0 ? 0 : loop(n - 1) }\nloop(1e9)'
  const overflowFn = findRecursiveFunctions(overflowSource)[0]
  const overflowTrace = await runTrace(instrument(overflowSource, overflowFn.start).code)
  assert.ok(overflowTrace.error, 'estouro de pilha reportado')
  assert.ok(
    overflowTrace.events.some((event) => event.t === 't'),
    'throw registrado',
  )
}

async function testSameTree() {
  if (!fs.existsSync(sameTreePath)) return
  const sameTree = fs.readFileSync(sameTreePath, 'utf8')
  const sameFns = findRecursiveFunctions(sameTree)
  assert.deepStrictEqual(
    sameFns.map((fn) => fn.name),
    ['isSameTree'],
  )
  assert.strictEqual(sameFns[0].line, 47)
  const traced = await runTrace(instrument(sameTree, sameFns[0].start).code)
  assert.strictEqual(traced.error, null)
  assert.ok(traced.events.length > 0)
}

async function testMutual() {
  const mutualSource = `function isEven(n) { return n === 0 ? true : isOdd(n - 1) }
function isOdd(n) { return n === 0 ? false : isEven(n - 1) }
function same(a, b) { return a === null && b === null ? true : a === null || b === null ? false : same(a.l, b.l) && same(a.r, b.r) }
function contains(root, sub) { return root === null ? false : same(root, sub) || contains(root.l, sub) || contains(root.r, sub) }
console.log(isEven(4), contains({ l: null, r: { l: null, r: null } }, { l: null, r: null }))`
  const mutual = findRecursiveFunctions(mutualSource)
  assert.deepStrictEqual(
    mutual.map((fn) => fn.name),
    ['isEven', 'isOdd', 'same', 'contains'],
  )
  const contains = mutual.find((fn) => fn.name === 'contains')
  const mutualTrace = await runTrace(instrument(mutualSource, contains.start).code)
  assert.strictEqual(mutualTrace.error, null)
  assert.deepStrictEqual(mutualTrace.stdout, ['true true'])
  assert.ok(
    mutualTrace.events.some((event) => event.t === 'c' && event.fn === 'same'),
    'chamadas de same registradas',
  )
}

async function testPick() {
  const source = `function pick(left, right, depth = 0) {
  if (depth === 2) return null
  const inner = pick(left, right, depth + 1)
  return inner ? inner : left || right
}
console.log(pick(0, 5))
`
  const [fn] = findRecursiveFunctions(source)
  const result = await runTrace(instrument(source, fn.start).code)
  assert.strictEqual(result.error, null)
  const finals = result.probes.filter((probe) => probe.kind === 'final' && probe.pick)
  const picked = finals.map((probe) => probe.src.slice(probe.pick.from, probe.pick.to))
  assert.deepStrictEqual(picked, ['right', 'inner'])
}

function boardTextOf(value) {
  const context = {}
  vm.runInNewContext(fs.readFileSync('media/panel-board.js', 'utf8'), context)
  return vm.runInNewContext('boardText(shape)', { ...context, shape: describe(value) })
}

async function testShapes() {
  const tree = { val: 1, left: { val: 2, left: null, right: { val: 4 } }, right: { val: 3 } }
  assert.strictEqual(boardTextOf(tree), ['1', '├─ L 2', '│  └─ R 4', '└─ R 3'].join('\n'))
  assert.strictEqual(boardTextOf({ val: 1, next: { val: 2, next: null } }), '1 → 2 → null')
  assert.strictEqual(
    boardTextOf([
      [1, 0],
      [0, 12],
    ]),
    ['+----+----+', '|  1 |  0 |', '+----+----+', '|  0 | 12 |', '+----+----+'].join('\n'),
  )
  assert.strictEqual(boardTextOf({ a: ['b', 'c'], b: [] }), 'a → "b", "c"\nb → —')
  assert.strictEqual(boardTextOf(new Map([[1, [2]]])), '1 → 2')
  assert.strictEqual(describe([1, 2, 3]), null, 'array simples não é estrutura')
  assert.strictEqual(describe({ x: 1 }), null)
  const cyclic = { val: 1 }
  cyclic.next = cyclic
  assert.strictEqual(boardTextOf(cyclic), '1 → ↺')

  const source = `function walk(node, grid) {
  if (!node) return 0
  return 1 + walk(node.left, grid) + walk(node.right, grid)
}
walk({ val: 1, left: { val: 2, left: null, right: null }, right: null }, [[1, 0], [0, 1]])`
  const [fn] = findRecursiveFunctions(source)
  const result = await runTrace(instrument(source, fn.start).code)
  assert.strictEqual(result.error, null)
  const calls = result.events.filter((event) => event.t === 'c')
  assert.deepStrictEqual(
    calls.map((call) => call.args.map((arg) => arg.d && arg.d.k)),
    [
      ['tree', 'matrix'],
      ['tree', 'matrix'],
      [undefined, 'matrix'],
      [undefined, 'matrix'],
      [undefined, 'matrix'],
    ],
  )
}

function testRecursionKinds() {
  const source = `
function fib(n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2) }
function fact(n, acc = 1) { if (n === 0) return acc; return fact(n - 1, acc * n) }
function preorder(node) { if (!node) return; visit(node.val); preorder(node.left); preorder(node.right) }
function inorder(node) { if (!node) return; inorder(node.left); visit(node.val); inorder(node.right) }
function postorder(node) { if (!node) return; postorder(node.left); postorder(node.right); visit(node.val) }
function inorderList(node) { if (!node) return []; return [...inorderList(node.left), node.val, ...inorderList(node.right)] }
function isEven(n) { return n === 0 ? true : isOdd(n - 1) }
function isOdd(n) { return n === 0 ? false : isEven(n - 1) }
`
  const kinds = Object.fromEntries(
    findRecursiveFunctions(source).map((fn) => {
      const { why, ...recursion } = fn.recursion
      assert.deepStrictEqual(
        Object.keys(why).sort(),
        [
          recursion.shape,
          ...(recursion.tail ? ['tail'] : []),
          ...(recursion.direction ? [recursion.direction] : []),
          ...recursion.orders,
        ].sort(),
      )
      return [fn.name, recursion]
    }),
  )
  assert.deepStrictEqual(kinds.fib, {
    shape: 'binary',
    tail: false,
    direction: 'bottom-up',
    orders: ['post-order'],
  })
  assert.deepStrictEqual(kinds.fact, {
    shape: 'linear',
    tail: true,
    direction: 'top-down',
    orders: [],
  })
  assert.deepStrictEqual(kinds.preorder.orders, ['pre-order'])
  assert.deepStrictEqual(kinds.inorder.orders, ['in-order'])
  assert.deepStrictEqual(kinds.postorder.orders, ['post-order'])
  assert.deepStrictEqual(kinds.inorderList.orders, ['in-order', 'post-order'])
  assert.strictEqual(kinds.isEven.shape, 'mutual')
}

async function main() {
  testRecursionKinds()
  await testFib()
  await testProbes()
  await testSameTree()
  await testMutual()
  await testPick()
  await testShapes()
  console.log('OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
