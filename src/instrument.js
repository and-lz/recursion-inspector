const { findRecursiveFunctions } = require('./detect')
const { commentedCalls } = require('./commented-calls')

function wrapperFor(fn) {
  const originalName = `__orig_${fn.name}`
  const meta = JSON.stringify({ name: fn.name, line: fn.line, params: fn.params })
  const wrapperBody = `(...__args) { return __call(${meta}, __args, this, ${originalName}) }`
  return fn.kind === 'declaration'
    ? `;function ${fn.name}${wrapperBody};`
    : `;${fn.declKeyword} ${fn.name} = function${wrapperBody};`
}

const WRAPPER_RANK = 0
const PREFIX_RANK = 1e6
const SUFFIX_RANK = 2e6

function finalEntries(probe) {
  return `[${probe.names.map((name) => `[${JSON.stringify(name)}, () => ${name}]`).join(', ')}]`
}

function probeEdits(fn) {
  return fn.probes.flatMap((probe) => {
    if (probe.type === 'finalEnd')
      return [
        { from: probe.start, to: probe.end, text: `;__final(${finalEntries(probe)});`, rank: -1 },
      ]
    if (probe.type === 'finalBare')
      return [
        {
          from: probe.start,
          to: probe.end,
          text: `return __final(${finalEntries(probe)})`,
          rank: PREFIX_RANK - probe.seq,
        },
      ]
    if (probe.type === 'final')
      return [
        { from: probe.start, to: probe.start, text: '__final(', rank: PREFIX_RANK - probe.seq },
        {
          from: probe.end,
          to: probe.end,
          text: `, ${finalEntries(probe)}, ${JSON.stringify(probe.src)})`,
          rank: SUFFIX_RANK + probe.seq,
        },
      ]
    if (probe.type === 'term' || probe.type === 'pick')
      return [
        {
          from: probe.start,
          to: probe.start,
          text: `__${probe.type}(${probe.from}, ${probe.to}, ${probe.line}, (`,
          rank: PREFIX_RANK - probe.seq,
        },
        { from: probe.end, to: probe.end, text: '))', rank: SUFFIX_RANK + probe.seq },
      ]
    const name = JSON.stringify(probe.name)
    const wrapsInParens = probe.type === 'cond' || probe.type === 'operand'
    const hook = probe.type === 'operand' ? '__operand' : '__cond'
    const prefix = wrapsInParens
      ? `${hook}(${JSON.stringify(probe.src)}, ${probe.line}, (`
      : `__var(${name}, ${probe.line}, `
    let suffix = ')'
    if (wrapsInParens) suffix = '))'
    if (probe.type === 'update') suffix = `, ${probe.name})`
    return [
      { from: probe.start, to: probe.start, text: prefix, rank: PREFIX_RANK - probe.seq },
      { from: probe.end, to: probe.end, text: suffix, rank: SUFFIX_RANK + probe.seq },
    ]
  })
}

// Troca cada função recursiva do arquivo (a clicada e as que ela chama em ciclo)
// por um wrapper que registra entrada/saída. Só insere texto na mesma linha,
// então os números de linha não mudam.
function instrument(source, start) {
  const functions = findRecursiveFunctions(source)
  const target = functions.find((fn) => fn.start === start)
  if (!target) throw new Error('Função recursiva não encontrada (o arquivo mudou?).')

  const edits = functions.flatMap((fn) => [
    { from: fn.idStart, to: fn.idEnd, text: `__orig_${fn.name}`, rank: WRAPPER_RANK },
    { from: fn.end, to: fn.end, text: wrapperFor(fn), rank: WRAPPER_RANK },
    ...probeEdits(fn),
  ])
  // Aplica de trás para frente. Inserções na mesma posição: o wrapper entra primeiro (fica
  // mais à direita); depois os prefixos de dentro para fora e os sufixos de fora para dentro.
  edits.sort(
    (first, second) => second.from - first.from || second.to - first.to || first.rank - second.rank,
  )

  let code = source
  for (const edit of edits) code = code.slice(0, edit.from) + edit.text + code.slice(edit.to)

  // Chamadas comentadas também são exemplos válidos: rodam no fim, isoladas por try/catch.
  const extra = commentedCalls(source, target.name).map((line) => `try { ${line}\n} catch {}`)
  if (extra.length) code += `\n;${extra.join('\n;')}\n`

  return { code, target, functions }
}

module.exports = { instrument }
