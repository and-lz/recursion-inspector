// Folhas de um `return` com ?: ou operadores lógicos: uma delas é o valor devolvido de fato.
function returnLeaves(argument) {
  if (argument.type === 'ConditionalExpression')
    return [...returnLeaves(argument.consequent), ...returnLeaves(argument.alternate)]
  if (argument.type === 'LogicalExpression')
    return [...returnLeaves(argument.left), ...returnLeaves(argument.right)]
  return [argument]
}

// Cada folha com o trecho (`from`..`to`) dentro do argumento; sem condicional não há o que apontar.
function returnPicks(argument) {
  if (!argument) return []
  const leaves = returnLeaves(argument)
  if (leaves.length < 2) return []
  return leaves.map((leaf) => ({
    start: leaf.start,
    end: leaf.end,
    loc: leaf.loc,
    from: leaf.start - argument.start,
    to: leaf.end - argument.start,
  }))
}

module.exports = { returnPicks }
