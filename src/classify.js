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
const SNIPPET_MAX = 48
const LISTED_CALLS = 3
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
        statement: ancestors.findLast(isStatement) || fnNode.body,
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
function visitLoopBody(node, state, visit) {
  visit(node.body, state, 'Statement')
}

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
    // O cabeçalho do laço (`const x of xs`) não é trabalho; só o corpo.
    ForStatement: visitLoopBody,
    ForInStatement: visitLoopBody,
    ForOfStatement: visitLoopBody,
    ExpressionStatement: keep,
    VariableDeclaration: keep,
    IfStatement(node, state, visit) {
      visitBranch(node.consequent, state, visit)
      visitBranch(node.alternate, state, visit)
    },
  })
  return work
}

// Trecho do código para citar na explicação: numa linha só e sem passar de SNIPPET_MAX.
function shorten(text) {
  const oneLine = text.replace(/\s+/g, ' ').replace(/;$/, '')
  return oneLine.length > SNIPPET_MAX ? `${oneLine.slice(0, SNIPPET_MAX - 1)}…` : oneLine
}

function snippet(source, node) {
  return shorten(source.slice(node.start, node.end))
}

function cite(source, node) {
  return `\`${snippet(source, node)}\` (linha ${node.loc.start.line})`
}

function citeAll(source, sites) {
  const listed = sites.slice(0, LISTED_CALLS).map((site) => cite(source, site.node))
  return sites.length > LISTED_CALLS ? [...listed, '…'].join(', ') : listed.join(', ')
}

// `f(left) + node.val + f(right)`: algo além de operadores entre duas chamadas da mesma
// instrução. Devolve o par de chamadas e o trecho que fica entre elas.
function findOperandBetween(source, sites) {
  const ordered = [...sites].sort((first, second) => first.node.start - second.node.start)
  for (const [index, site] of ordered.slice(1).entries()) {
    const previous = ordered[index]
    if (previous.statement !== site.statement) continue
    const between = source
      .slice(previous.node.end, site.node.start)
      .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
    if (!OPERANDS_ONLY.test(between)) return { previous, site, between: between.trim() }
  }
  return null
}

function callShape(sites) {
  if (sites.some((site) => site.looped) || sites.length > BINARY_SHAPE_CALLS) return 'multiple'
  return sites.length === BINARY_SHAPE_CALLS ? 'binary' : 'linear'
}

// Cada ordem detectada com o motivo: o trecho do código que a causou.
function visitOrders(source, fnNode, sites) {
  const first = Math.min(...sites.map((site) => site.node.start))
  const last = Math.max(...sites.map((site) => site.node.end))
  const work = collectWork(fnNode, sites)
  const before = work.find((node) => node.end <= first)
  const between = work.find((node) => node.start >= first && node.end <= last)
  const operand = findOperandBetween(source, sites)
  const after = work.find((node) => node.start >= last)
  const used = sites.find((site) => site.used)
  const orders = {}
  if (before) orders['pre-order'] = `${cite(source, before)} roda antes da primeira chamada`
  if (between) orders['in-order'] = `${cite(source, between)} roda entre as chamadas`
  else if (operand)
    orders['in-order'] =
      `\`${shorten(operand.between)}\` fica entre ${cite(source, operand.previous.node)} e ${cite(source, operand.site.node)}`
  if (after) orders['post-order'] = `${cite(source, after)} roda depois da última chamada`
  else if (used)
    orders['post-order'] =
      `o resultado de ${cite(source, used.node)} só é usado depois que ela volta`
  return orders
}

function shapeWhy(source, sites, shape, name) {
  if (shape === 'mutual')
    return `nenhuma chamada a ${name} no próprio corpo: ela só é chamada de volta por outra função recursiva`
  const looped = sites.find((site) => site.looped)
  if (shape === 'multiple' && looped)
    return `${cite(source, looped.node)} está dentro de laço ou callback`
  const count =
    { linear: 'uma chamada', binary: 'duas chamadas' }[shape] || `${sites.length} chamadas`
  return `${count} recursiva${shape === 'linear' ? '' : 's'}: ${citeAll(source, sites)}`
}

function directionWhy(source, sites) {
  const used = sites.find((site) => site.used)
  if (used)
    return `o resultado de ${cite(source, used.node)} é usado em \`${snippet(source, used.statement)}\``
  if (sites.every((site) => site.tail))
    return `o resultado de ${citeAll(source, sites)} é devolvido direto, sem ser combinado`
  return `o resultado de ${citeAll(source, sites)} é descartado: a chamada só passa o estado pelos argumentos`
}

function tailWhy(source, sites) {
  const listed = citeAll(source, sites)
  return sites.length === 1
    ? `${listed} é devolvida direto: nada roda depois dela`
    : `todas as chamadas são devolvidas direto: ${listed}`
}

// Como a recursão se comporta, olhando só o código: formato das chamadas, cauda, sentido
// (top-down passa o estado para baixo; bottom-up junta o que os filhos devolvem) e em que
// momento o trabalho acontece em relação às chamadas (pré-ordem, em ordem e pós-ordem).
// `why` explica cada rótulo com o trecho do código que o causou.
function classifyRecursion(source, fnNode, name) {
  const sites = findCallSites(fnNode, name)
  if (!sites.length)
    return {
      shape: 'mutual',
      tail: false,
      direction: null,
      orders: [],
      why: { mutual: shapeWhy(source, sites, 'mutual', name) },
    }
  const shape = callShape(sites)
  const tail = sites.every((site) => site.tail && !site.looped)
  const direction = sites.some((site) => site.used) ? 'bottom-up' : 'top-down'
  const orders = visitOrders(source, fnNode, sites)
  return {
    shape,
    tail,
    direction,
    orders: Object.keys(orders),
    why: {
      [shape]: shapeWhy(source, sites, shape, name),
      ...(tail && { tail: tailWhy(source, sites) }),
      [direction]: directionWhy(source, sites),
      ...orders,
    },
  }
}

module.exports = { classifyRecursion }
