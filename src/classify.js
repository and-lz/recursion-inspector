const walk = require('acorn-walk')
const { returnPicks } = require('./return-picks')

const LOOP_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
])
const BINARY_SHAPE_CALLS = 2
const OPERANDS_ONLY = /^[\s()[\]{},.+\-*/%&|^!~<>=?:]*$/

function isFunctionType(node) {
  return (
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'ArrowFunctionExpression'
  )
}

function skipNestedFunction() {}

function isStatement(node) {
  return node.type.endsWith('Statement') || node.type.endsWith('Declaration')
}

// O valor da chamada é devolvido como está (`return f(x)`, `return a ? f(x) : 0`)?
function isReturnedAsIs(site, ancestors, fnNode) {
  const returned = ancestors.findLast((node) => node.type === 'ReturnStatement')
  const argument = returned ? returned.argument : fnNode.body
  if (!argument || argument.type === 'BlockStatement') return false
  const leaves = returnPicks(argument)
  if (!leaves.length) return argument === site
  return leaves.some((leaf) => leaf.start === site.start && leaf.end === site.end)
}

function findCallSites(fnNode, name) {
  const sites = []
  walk.ancestor(fnNode.body, {
    CallExpression(call, state, ancestors) {
      if (call.callee.type !== 'Identifier' || call.callee.name !== name) return
      const parent = ancestors[ancestors.length - 2]
      const nested = ancestors.some(isFunctionType)
      const looped = ancestors.some((node) => LOOP_TYPES.has(node.type))
      const discarded = Boolean(parent) && parent.type === 'ExpressionStatement'
      const tail = !nested && isReturnedAsIs(call, ancestors, fnNode)
      sites.push({
        node: call,
        looped: looped || nested,
        tail,
        used: !nested && !tail && !discarded,
        statement: ancestors.findLast(isStatement),
      })
    },
  })
  return sites
}

const doesNotReturn = (branch) => {
  const last = branch.type === 'BlockStatement' ? branch.body[branch.body.length - 1] : branch
  return Boolean(last) && (last.type === 'ReturnStatement' || last.type === 'ThrowStatement')
}

function containsSite(node, sites) {
  return sites.some((site) => site.node.start >= node.start && site.node.end <= node.end)
}

// Trabalho = instrução que mexe em algo e não é a chamada recursiva. Ramos que só encerram
// (caso base) não contam: o que importa é o que roda ao redor das chamadas.
function collectWork(fnNode, sites) {
  const work = []
  if (fnNode.body.type !== 'BlockStatement') return work
  const keep = (node) => {
    if (!containsSite(node, sites)) work.push(node)
  }
  const visitBranch = (branch, state, visit) => {
    if (!branch) return
    if (!containsSite(branch, sites) && doesNotReturn(branch)) return
    visit(branch, state, 'Statement')
  }
  walk.recursive(fnNode.body, null, {
    Function: skipNestedFunction,
    ExpressionStatement: keep,
    VariableDeclaration: keep,
    IfStatement(node, state, visit) {
      visitBranch(node.consequent, state, visit)
      visitBranch(node.alternate, state, visit)
    },
  })
  return work
}

// `f(left) + node.val + f(right)`: algo além de operadores entre duas chamadas da mesma instrução.
function hasOperandBetween(source, sites) {
  const ordered = [...sites].sort((first, second) => first.node.start - second.node.start)
  return ordered.slice(1).some((site, index) => {
    const previous = ordered[index]
    if (previous.statement !== site.statement) return false
    const between = source
      .slice(previous.node.end, site.node.start)
      .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
    return !OPERANDS_ONLY.test(between)
  })
}

function callShape(sites) {
  if (sites.some((site) => site.looped) || sites.length > BINARY_SHAPE_CALLS) return 'multiple'
  return sites.length === BINARY_SHAPE_CALLS ? 'binary' : 'linear'
}

function visitOrders(source, fnNode, sites) {
  const first = Math.min(...sites.map((site) => site.node.start))
  const last = Math.max(...sites.map((site) => site.node.end))
  const work = collectWork(fnNode, sites)
  const orders = []
  if (work.some((node) => node.end <= first)) orders.push('pre-order')
  if (
    work.some((node) => node.start >= first && node.end <= last) ||
    hasOperandBetween(source, sites)
  )
    orders.push('in-order')
  if (work.some((node) => node.start >= last) || sites.some((site) => site.used))
    orders.push('post-order')
  return orders
}

// Como a recursão se comporta, olhando só o código: formato das chamadas, cauda, sentido
// (top-down passa o estado para baixo; bottom-up junta o que os filhos devolvem) e em que
// momento o trabalho acontece em relação às chamadas (pré-ordem, em ordem e pós-ordem).
function classifyRecursion(source, fnNode, name) {
  const sites = findCallSites(fnNode, name)
  if (!sites.length) return { shape: 'mutual', tail: false, direction: null, orders: [] }
  return {
    shape: callShape(sites),
    tail: sites.every((site) => site.tail && !site.looped),
    direction: sites.some((site) => site.used) ? 'bottom-up' : 'top-down',
    orders: visitOrders(source, fnNode, sites),
  }
}

module.exports = { classifyRecursion }
