const acorn = require('acorn')
const walk = require('acorn-walk')

function parse(source) {
  return acorn.parse(source, {
    ecmaVersion: 'latest',
    locations: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    sourceType: 'script',
  })
}

function isFunctionNode(node) {
  return node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'
}

function isPlainFunction(node) {
  return !node.async && !node.generator
}

function calledNames(fnNode, names) {
  const called = new Set()
  walk.simple(fnNode.body, {
    CallExpression(call) {
      if (call.callee.type === 'Identifier' && names.has(call.callee.name)) called.add(call.callee.name)
    },
  })
  return called
}

// Uma função é recursiva se consegue chegar nela mesma seguindo chamadas (direta ou mútua).
function reachesItself(name, graph) {
  const visited = new Set()
  const pending = [...graph.get(name)]
  while (pending.length) {
    const current = pending.pop()
    if (current === name) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...graph.get(current))
  }
  return false
}

function paramLabel(source, param) {
  if (param.type === 'Identifier') return param.name
  if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') return param.left.name
  if (param.type === 'RestElement' && param.argument.type === 'Identifier') return `...${param.argument.name}`
  return source.slice(param.start, param.end)
}

function describe(source, name, fnNode, declNode, idNode, kind) {
  return {
    name,
    kind,
    start: declNode.start,
    end: declNode.end,
    line: declNode.loc.start.line,
    column: declNode.loc.start.column,
    idStart: idNode.start,
    idEnd: idNode.end,
    declKeyword: kind === 'variable' ? source.slice(declNode.start, declNode.start + declNode.kind.length) : null,
    params: fnNode.params.map((param) => paramLabel(source, param)),
  }
}

function findRecursiveFunctions(source) {
  const ast = parse(source)
  const candidates = []

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (!node.id || !isPlainFunction(node)) return
      candidates.push({ fnNode: node, info: describe(source, node.id.name, node, node, node.id, 'declaration') })
    },
    VariableDeclaration(node) {
      if (node.declarations.length !== 1) return
      const [declaration] = node.declarations
      if (declaration.id.type !== 'Identifier') return
      if (!declaration.init || !isFunctionNode(declaration.init)) return
      if (!isPlainFunction(declaration.init)) return
      candidates.push({
        fnNode: declaration.init,
        info: describe(source, declaration.id.name, declaration.init, node, declaration.id, 'variable'),
      })
    },
  })

  const names = new Set(candidates.map((candidate) => candidate.info.name))
  const graph = new Map([...names].map((name) => [name, new Set()]))
  for (const candidate of candidates) {
    for (const callee of calledNames(candidate.fnNode, names)) graph.get(candidate.info.name).add(callee)
  }

  return candidates
    .map((candidate) => candidate.info)
    .filter((info) => reachesItself(info.name, graph))
    .sort((first, second) => first.start - second.start)
}

module.exports = { findRecursiveFunctions }
