const walk = require('acorn-walk')

function skipNestedFunction() {}

// Nomes que um alvo de escrita altera: `total`, `root` em `root.left = ...`, `[a, b] = ...`.
function targetNames(target, names = new Set()) {
  if (!target) return names
  if (target.type === 'Identifier') names.add(target.name)
  if (target.type === 'MemberExpression') targetNames(target.object, names)
  if (target.type === 'AssignmentPattern') targetNames(target.left, names)
  if (target.type === 'RestElement') targetNames(target.argument, names)
  if (target.type === 'ArrayPattern') for (const item of target.elements) targetNames(item, names)
  if (target.type === 'ObjectPattern')
    for (const property of target.properties)
      targetNames(property.type === 'Property' ? property.value : property, names)
  return names
}

// A expressão chama uma função recursiva ou lê um nome já alimentado por uma chamada dessas?
function usesRecursion(node, recursive, fed) {
  let found = false
  walk.recursive(node, null, {
    Function: skipNestedFunction,
    CallExpression(call, state, visit) {
      if (call.callee.type === 'Identifier' && recursive.has(call.callee.name)) found = true
      visit(call.callee, state, 'Expression')
      for (const argument of call.arguments) visit(argument, state, 'Expression')
    },
    MemberExpression(member, state, visit) {
      visit(member.object, state, 'Expression')
      if (member.computed) visit(member.property, state, 'Expression')
    },
    Identifier(identifier) {
      if (fed.has(identifier.name)) found = true
    },
  })
  return found
}

// Nomes alimentados, direta ou indiretamente, pelo resultado de chamadas recursivas:
// `x = f()`, `root.left = f()`, `list.push(f())`, `y = x + 1`.
function fedNames(fnNode, recursive) {
  const fed = new Set()
  const feed = (target, source) => {
    if (!usesRecursion(source, recursive, fed)) return
    for (const name of targetNames(target)) fed.add(name)
  }
  let size = -1
  while (size !== fed.size) {
    size = fed.size
    walk.simple(fnNode.body, {
      VariableDeclarator: (node) => node.init && feed(node.id, node.init),
      AssignmentExpression: (node) => feed(node.left, node.right),
      CallExpression(call) {
        if (call.callee.type !== 'MemberExpression') return
        for (const argument of call.arguments) feed(call.callee.object, argument)
      },
    })
  }
  return fed
}

// Marca em cada sonda `final` se o `return` usa o resultado de alguma chamada recursiva.
function markReturnUses(fnNode, probes, recursive) {
  const fed = fedNames(fnNode, recursive)
  walk.recursive(fnNode.body, null, {
    Function: skipNestedFunction,
    ReturnStatement(node) {
      if (!node.argument) return
      const probe = probes.find(
        (item) => item.type === 'final' && item.start === node.argument.start,
      )
      if (probe) probe.usesCalls = usesRecursion(node.argument, recursive, fed)
    },
  })
}

module.exports = { markReturnUses }
