/* ---------- detalhe do nó (inspetor): retorno em destaque, o resto colapsado ---------- */

const STATE_LABELS = {
  active: 'executando',
  waiting: 'esperando os filhos',
  returning: 'acabou de retornar',
  done: 'já retornou',
  error: 'lançou erro',
  hidden: 'ainda não chamada',
}

function tipSection(label, body, className = '') {
  return `<section class="tipSection ${className}"><h4>${label}</h4>${body}</section>`
}

function tipRow(name, value) {
  return `<div class="tipRow"><span class="tipKey">${escapeHtml(name)}</span><span class="tipVal">${highlight(prettyValue(value, 30))}</span></div>`
}

// Bloco colapsável; o estado aberto/fechado sobrevive à re-renderização a cada passo.
function tipFold(key, label, count, body) {
  const open = state.inspectorOpen.has(key) ? ' open' : ''
  return `<details class="tipFold" data-fold="${key}"${open}><summary>${label}<small>${count}</small></summary>${body}</details>`
}

// Teste que decidiu o retorno: o último verdadeiro; sem nenhum, o código seguiu até o return final.
function decisiveCond(conds) {
  return [...conds].reverse().find((cond) => cond.result) || null
}

function tipVerdict(conds, decisive) {
  if (!decisive) return 'nenhum teste foi verdadeiro: seguiu direto até o retorno acima'
  return `${code(shorten(decisive.src, 60))} foi verdadeiro: levou ao retorno acima`
}

function tipConditions(node, step, returned) {
  const conds = condsAt(node, step)
  const decisive = returned ? decisiveCond(conds) : null
  const rows = conds.map((cond) => {
    const operands = (cond.operands || []).map((operand) => tipRow(operand.src, operand.v.f))
    const verdict = cond.result ? 'verdadeiro' : 'falso'
    const mark = cond === decisive ? ' decisive' : ''
    return `<div class="tipCond${mark}"><code>${highlightTerms(cond)}</code><span class="tipPill ${cond.result ? 'yes' : 'no'}">${verdict}</span></div>${operands.join('')}`
  })
  if (returned) rows.push(`<div class="tipNote tipWhy">→ ${tipVerdict(conds, decisive)}</div>`)
  return rows.join('')
}

function tipChildren(node, step) {
  const finished = node.children.filter((child) => child.endIndex < step)
  if (!finished.length) return ''
  const results = finished.map((child) => (child.kind === 'return' ? child.value.s : '✖'))
  return tipFold(
    'children',
    'Filhos',
    `${finished.length} retornaram`,
    `<div class="tipNote">${escapeHtml(results.join(', '))}</div>`,
  )
}

// Valores ao sair, só dos que mudaram em relação à entrada; sem mudança, não há bloco.
function tipFinals(node, entryValues) {
  const rows = (node.finals || [])
    .filter((local) => entryValues.has(local.name) && entryValues.get(local.name) !== local.v.f)
    .map((local) => tipRow(local.name, local.v.f))
  if (!rows.length) return ''
  return tipFold('finals', 'Ao sair', `${rows.length} mudaram`, rows.join(''))
}

// "return picked" mostra de qual expressão veio o valor; literais e valores iguais ao texto não repetem.
function tipReturn(node) {
  const value = `<div class="tipResult">${highlight(prettyValue(node.value.f, 24))}</div>`
  if (!node.returnSrc || node.returnSrc === node.value.f) return value
  return `<div class="tipNote">${returnCode(node)}</div>${value}`
}

function tipOutcome(node, stateName) {
  if (stateName === 'error') return tipSection('Erro', escapeHtml(node.message), 'failed hero')
  if (stateName === 'done' || stateName === 'returning')
    return tipSection('Retorno', tipReturn(node), 'hero')
  return '<div class="tipNote">ainda não retornou</div>'
}

function describeNode(node, step) {
  const lastEvent = step > 0 ? state.trace.events[step - 1] : null
  const stateName = nodeState(node, step, lastEvent)
  const returned = stateName === 'done' || stateName === 'returning'
  const meta = [
    node.line ? `chamada na linha ${node.line}` : null,
    `profundidade ${node.depth}`,
    returned && node.isBase ? 'caso base' : null,
  ].filter(Boolean)

  const entry = variablesAt(node, 0).filter((variable) => variable.isParam)
  const entryValues = new Map(entry.map((variable) => [variable.name, variable.value]))
  const variables = variablesAt(node, step)
    .filter((variable) => !variable.isParam || variable.value !== entryValues.get(variable.name))
    .map((variable) => tipRow(variable.name, variable.value))
  const conditions = condsAt(node, step)
  const folds = [
    conditions.length
      ? tipFold('conds', 'Testes', conditions.length, tipConditions(node, step, returned))
      : '',
    entry.length
      ? tipFold(
          'entry',
          'Ao entrar',
          entry.length,
          entry.map((param) => tipRow(param.name, param.value)).join(''),
        )
      : '',
    variables.length ? tipFold('vars', 'Variáveis', variables.length, variables.join('')) : '',
    returned ? tipFinals(node, entryValues) : '',
    tipChildren(node, step),
  ]
  return [
    `<header class="tipHead"><span class="tipFn">${escapeHtml(node.fn)}</span><span class="tipState ${stateName}">${STATE_LABELS[stateName]}</span></header>`,
    `<div class="tipMeta">${meta.join(' · ')}</div>`,
    tipOutcome(node, stateName),
    ...folds,
  ].join('')
}
