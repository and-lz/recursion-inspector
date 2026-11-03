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

function isFunctionType(node) {
  return (
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'ArrowFunctionExpression'
  )
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
      const nested = ancestors.some(isFunctionType)
      const looped = ancestors.some((node) => LOOP_TYPES.has(node.type))
      sites.push({
        node: call,
        looped: looped || nested,
        tail: !nested && isReturnedAsIs(call, ancestors, fnNode),
      })
    },
  })
  return sites
}

// Trecho do código para citar na explicação: numa linha só e sem passar de SNIPPET_MAX.
function shorten(text) {
  const oneLine = text.replace(/\s+/g, ' ').replace(/;$/, '')
  return oneLine.length > SNIPPET_MAX ? `${oneLine.slice(0, SNIPPET_MAX - 1)}…` : oneLine
}

function cite(source, node) {
  return `\`${shorten(source.slice(node.start, node.end))}\` (linha ${node.loc.start.line})`
}

function citeAll(source, sites) {
  const listed = sites.slice(0, LISTED_CALLS).map((site) => cite(source, site.node))
  return sites.length > LISTED_CALLS ? [...listed, '…'].join(', ') : listed.join(', ')
}

function callShape(sites) {
  if (sites.some((site) => site.looped) || sites.length > BINARY_SHAPE_CALLS) return 'multiple'
  return sites.length === BINARY_SHAPE_CALLS ? 'binary' : 'linear'
}

function shapeWhy(source, sites, shape, name) {
  if (shape === 'mutual')
    return `nenhuma chamada a ${name} no próprio corpo: ela só é chamada de volta por outra função recursiva`
  const looped = sites.find((site) => site.looped)
  if (shape === 'multiple' && looped)
    return `${cite(source, looped.node)} está dentro de laço ou callback`
  if (shape === 'linear') return `uma chamada recursiva: ${citeAll(source, sites)}`
  const count = shape === 'binary' ? 'duas' : sites.length
  return `${count} chamadas recursivas: ${citeAll(source, sites)}`
}

function tailWhy(source, sites) {
  const listed = citeAll(source, sites)
  return sites.length === 1
    ? `${listed} é devolvida direto: nada roda depois dela`
    : `todas as chamadas são devolvidas direto: ${listed}`
}

// O que dá para saber só lendo o código: o formato das chamadas e se são de cauda. O que
// depende da execução (sentido top-down/bottom-up, pré/em/pós-ordem) o painel mostra por
// nó e por passo. `why` explica cada rótulo com o trecho do código que o causou.
function classifyRecursion(source, fnNode, name) {
  const sites = findCallSites(fnNode, name)
  if (!sites.length)
    return {
      shape: 'mutual',
      tail: false,
      why: { mutual: shapeWhy(source, sites, 'mutual', name) },
    }
  const shape = callShape(sites)
  const tail = sites.every((site) => site.tail && !site.looped)
  return {
    shape,
    tail,
    why: {
      [shape]: shapeWhy(source, sites, shape, name),
      ...(tail && { tail: tailWhy(source, sites) }),
    },
  }
}

module.exports = { classifyRecursion }
