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
      if (call.callee.type === 'Identifier' && names.has(call.callee.name))
        called.add(call.callee.name)
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
  if (param.type === 'RestElement' && param.argument.type === 'Identifier')
    return `...${param.argument.name}`
  return source.slice(param.start, param.end)
}

function skipNestedFunction() {}

function declaredNames(fnNode) {
  const names = new Set()
  for (const param of fnNode.params) {
    if (param.type === 'Identifier') names.add(param.name)
    if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier')
      names.add(param.left.name)
  }
  walk.recursive(fnNode.body, null, {
    Function: skipNestedFunction,
    VariableDeclarator(node, state, visit) {
      if (node.id.type === 'Identifier') names.add(node.id.name)
      if (node.init) visit(node.init, state, 'Expression')
    },
  })
  return names
}

// Acessos a propriedade (`state[course]`, `states.inProgress`) dentro de um teste: o valor
// deles não aparece em nenhuma variável local. Ignora alvos de escrita e funções aninhadas.
function conditionOperands(test) {
  const operands = []
  walk.recursive(test, null, {
    Function: skipNestedFunction,
    MemberExpression(node) {
      operands.push(node)
    },
    CallExpression(node, state, visit) {
      if (node.callee.type === 'MemberExpression') visit(node.callee.object, state, 'Expression')
      else visit(node.callee, state, 'Expression')
      for (const argument of node.arguments) visit(argument, state, 'Expression')
    },
    AssignmentExpression(node, state, visit) {
      visit(node.right, state, 'Expression')
    },
    UpdateExpression: () => {},
    UnaryExpression(node, state, visit) {
      if (node.operator !== 'delete') visit(node.argument, state, 'Expression')
    },
  })
  return operands
}

// Pontos do corpo da função (sem entrar em funções aninhadas) que o instrumentador
// embrulha para registrar variáveis locais e condições. `seq` segue a ordem de visita
// (de fora para dentro), usada para desempatar inserções na mesma posição.
function collectProbes(source, fnNode) {
  const locals = declaredNames(fnNode)
  const probes = []
  const add = (type, node, extra) =>
    probes.push({
      type,
      seq: probes.length,
      start: node.start,
      end: node.end,
      line: node.loc.start.line,
      ...extra,
    })
  const addCondition = (test) => {
    add('cond', test, { src: source.slice(test.start, test.end) })
    for (const operand of conditionOperands(test))
      add('operand', operand, { src: source.slice(operand.start, operand.end) })
  }

  walk.recursive(fnNode.body, null, {
    Function: skipNestedFunction,
    VariableDeclarator(node, state, visit) {
      if (node.id.type === 'Identifier' && node.init && !isFunctionNode(node.init))
        add('var', node.init, { name: node.id.name })
      if (node.init) visit(node.init, state, 'Expression')
    },
    AssignmentExpression(node, state, visit) {
      if (node.left.type === 'Identifier' && locals.has(node.left.name))
        add('var', node, { name: node.left.name })
      visit(node.left, state, 'Pattern')
      visit(node.right, state, 'Expression')
    },
    UpdateExpression(node, state, visit) {
      if (node.argument.type === 'Identifier' && locals.has(node.argument.name))
        add('update', node, { name: node.argument.name })
      visit(node.argument, state, 'Expression')
    },
    IfStatement(node, state, visit) {
      addCondition(node.test)
      visit(node.test, state, 'Expression')
      visit(node.consequent, state, 'Statement')
      if (node.alternate) visit(node.alternate, state, 'Statement')
    },
    ConditionalExpression(node, state, visit) {
      addCondition(node.test)
      visit(node.test, state, 'Expression')
      visit(node.consequent, state, 'Expression')
      visit(node.alternate, state, 'Expression')
    },
  })
  return probes
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
    declKeyword:
      kind === 'variable'
        ? source.slice(declNode.start, declNode.start + declNode.kind.length)
        : null,
    params: fnNode.params.map((param) => paramLabel(source, param)),
    probes: collectProbes(source, fnNode),
  }
}

function findRecursiveFunctions(source) {
  const ast = parse(source)
  const candidates = []

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (!node.id || !isPlainFunction(node)) return
      candidates.push({
        fnNode: node,
        info: describe(source, node.id.name, node, node, node.id, 'declaration'),
      })
    },
    VariableDeclaration(node) {
      if (node.declarations.length !== 1) return
      const [declaration] = node.declarations
      if (declaration.id.type !== 'Identifier') return
      if (!declaration.init || !isFunctionNode(declaration.init)) return
      if (!isPlainFunction(declaration.init)) return
      candidates.push({
        fnNode: declaration.init,
        info: describe(
          source,
          declaration.id.name,
          declaration.init,
          node,
          declaration.id,
          'variable',
        ),
      })
    },
  })

  const names = new Set(candidates.map((candidate) => candidate.info.name))
  const graph = new Map([...names].map((name) => [name, new Set()]))
  for (const candidate of candidates) {
    for (const callee of calledNames(candidate.fnNode, names))
      graph.get(candidate.info.name).add(callee)
  }

  return candidates
    .map((candidate) => candidate.info)
    .filter((info) => reachesItself(info.name, graph))
    .sort((first, second) => first.start - second.start)
}

module.exports = { findRecursiveFunctions }
