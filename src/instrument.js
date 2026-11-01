const { findRecursiveFunctions } = require('./detect')

// Troca a função original por um wrapper que registra entrada/saída.
// Só insere texto na mesma linha, então os números de linha não mudam.
function instrument(source, start) {
  const target = findRecursiveFunctions(source).find((fn) => fn.start === start)
  if (!target) throw new Error('Função recursiva não encontrada (o arquivo mudou?).')

  const originalName = `__orig_${target.name}`
  const meta = JSON.stringify({ name: target.name, line: target.line, params: target.params })
  const wrapperBody = `(...__args) { return __call(${meta}, __args, this, ${originalName}) }`
  const wrapper =
    target.kind === 'declaration'
      ? `;function ${target.name}${wrapperBody};`
      : `;${target.declKeyword} ${target.name} = function${wrapperBody};`

  const code =
    source.slice(0, target.idStart) +
    originalName +
    source.slice(target.idEnd, target.end) +
    wrapper +
    source.slice(target.end)

  return { code, target }
}

module.exports = { instrument }
