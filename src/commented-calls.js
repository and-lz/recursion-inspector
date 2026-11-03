const acorn = require('acorn')
const walk = require('acorn-walk')

function callsFunction(statement, name) {
  let found = false
  walk.simple(statement, {
    CallExpression(call) {
      if (call.callee.type === 'Identifier' && call.callee.name === name) found = true
    },
  })
  return found
}

function parseLine(line) {
  try {
    const ast = acorn.parse(line, { ecmaVersion: 'latest', sourceType: 'script' })
    return ast.body.length === 1 ? ast.body[0] : null
  } catch {
    return null
  }
}

// Linhas de código comentado que chamam `name`: exemplos de input guardados no arquivo.
function commentedCalls(source, name) {
  const comments = []
  try {
    acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      onComment: comments,
    })
  } catch {
    return []
  }
  const calls = []
  for (const comment of comments) {
    for (const rawLine of comment.value.split('\n')) {
      const line = rawLine.replace(/^\s*\*?\s*/, '').trim()
      if (!line.includes(name)) continue
      const statement = parseLine(line)
      if (!statement || statement.type === 'FunctionDeclaration') continue
      if (callsFunction(statement, name)) calls.push(line)
    }
  }
  return calls
}

module.exports = { commentedCalls }
