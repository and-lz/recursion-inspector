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

function callsItself(fnNode, name) {
  let found = false
  walk.simple(fnNode.body, {
    CallExpression(call) {
      if (call.callee.type === 'Identifier' && call.callee.name === name) found = true
    },
  })
  return found
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
  const found = []

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (!node.id || !isPlainFunction(node)) return
      if (!callsItself(node, node.id.name)) return
      found.push(describe(source, node.id.name, node, node, node.id, 'declaration'))
    },
    VariableDeclaration(node) {
      if (node.declarations.length !== 1) return
      const [declaration] = node.declarations
      if (declaration.id.type !== 'Identifier') return
      if (!declaration.init || !isFunctionNode(declaration.init)) return
      if (!isPlainFunction(declaration.init)) return
      if (!callsItself(declaration.init, declaration.id.name)) return
      found.push(describe(source, declaration.id.name, declaration.init, node, declaration.id, 'variable'))
    },
  })

  return found.sort((first, second) => first.start - second.start)
}

module.exports = { findRecursiveFunctions }
