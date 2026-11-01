const { findRecursiveFunctions } = require('./detect')

function wrapperFor(fn) {
  const originalName = `__orig_${fn.name}`
  const meta = JSON.stringify({ name: fn.name, line: fn.line, params: fn.params })
  const wrapperBody = `(...__args) { return __call(${meta}, __args, this, ${originalName}) }`
  return fn.kind === 'declaration'
    ? `;function ${fn.name}${wrapperBody};`
    : `;${fn.declKeyword} ${fn.name} = function${wrapperBody};`
}

// Troca cada função recursiva do arquivo (a clicada e as que ela chama em ciclo)
// por um wrapper que registra entrada/saída. Só insere texto na mesma linha,
// então os números de linha não mudam.
function instrument(source, start) {
  const functions = findRecursiveFunctions(source)
  const target = functions.find((fn) => fn.start === start)
  if (!target) throw new Error('Função recursiva não encontrada (o arquivo mudou?).')

  const edits = functions.flatMap((fn) => [
    { from: fn.idStart, to: fn.idEnd, text: `__orig_${fn.name}` },
    { from: fn.end, to: fn.end, text: wrapperFor(fn) },
  ])
  edits.sort((first, second) => second.from - first.from || second.to - first.to)

  let code = source
  for (const edit of edits) code = code.slice(0, edit.from) + edit.text + code.slice(edit.to)

  return { code, target, functions }
}

module.exports = { instrument }
