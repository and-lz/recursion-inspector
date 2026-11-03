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

function tipRow(name, value, line = null) {
  return `<div class="tipRow"><span class="tipKey"${lineAttrs(line)}>${escapeHtml(name)}</span><span class="tipVal">${highlight(prettyValue(value, 30))}</span></div>`
}

// Bloco colapsável; o estado aberto/fechado sobrevive à re-renderização a cada passo.
function tipFold(key, label, count, body) {
  const open = state.inspectorOpen.has(key) ? ' open' : ''
  return `<details class="tipFold" data-fold="${key}"${open}><summary><span>${label}</span><small>${count}</small></summary>${body}</details>`
}

// Teste que decidiu o retorno: o último verdadeiro.
function decisiveCond(conds) {
  return [...conds].reverse().find((cond) => cond.result) || null
}

const COND_GROUPS = [
  { key: 'base', label: 'Caso base' },
  { key: 'after', label: 'Depois dos filhos' },
  { key: 'final', label: 'Retorno final' },
]

// Teste dentro da própria expressão do `return` (ex.: o `left` de `left ? left : right`).
function isFinalCond(node, cond) {
  return node.finalAt === cond.at && Boolean(node.returnSrc) && node.returnSrc.includes(cond.src)
}

// Antes de qualquer chamada filha = caso base; depois que algum filho foi chamado = depois dos filhos.
function condGroup(node, cond) {
  if (isFinalCond(node, cond)) return 'final'
  return node.children.some((child) => child.callIndex < cond.at) ? 'after' : 'base'
}

function tipCondRow(cond, decisive) {
  const operands = (cond.operands || []).map((operand) =>
    tipRow(operand.src, operand.v.f, operand.line),
  )
  const verdict = cond.result ? 'verdadeiro' : 'falso'
  const mark = cond === decisive ? ' decisive' : ''
  return `<div class="tipCond${mark}"><code${lineAttrs(cond.line)}>${highlightTerms(cond)}</code>${mark ? '<span class="srOnly">teste que levou ao retorno</span>' : ''}<span class="tipPill ${cond.result ? 'yes' : 'no'}">${verdict}</span></div>${operands.join('')}`
}

function tipConditions(node, step, returned) {
  const conds = condsAt(node, step)
  const decisive = returned ? decisiveCond(conds) : null
  const showFinal = returned && node.returnSrc
  // O retorno fica no grupo do teste que o decidiu (ou em "Retorno final" se não houve teste).
  const finalRow = `<div class="tipCond tipFinal">${returnCode(node)}<span class="tipPill yes">retornou</span></div>`
  return COND_GROUPS.map(({ key, label }) => {
    const rows = []
    for (const cond of conds.filter((item) => condGroup(node, item) === key)) {
      rows.push(tipCondRow(cond, decisive))
      if (showFinal && cond === decisive) rows.push(finalRow)
    }
    if (showFinal && key === 'final' && !decisive) rows.push(finalRow)
    return rows.length ? `<div class="tipGroup"><h5>${label}</h5>${rows.join('')}</div>` : ''
  }).join('')
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

// Valor devolvido e o papel dele na recursão, em uma linha (o `return` fica no fim de Testes).
function tipReturn(node) {
  const value = `<div class="tipResult">${highlight(prettyValue(node.value.f, 24))}</div>`
  const role = RETURN_ROLES[node.role]
  if (!role) return value
  return `${value}<div class="tipRole"><b>${role.label}</b><p>${role.brief ? role.brief(node) : role.hint(node)}</p></div>`
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
    conditions.length || (returned && node.returnSrc)
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
