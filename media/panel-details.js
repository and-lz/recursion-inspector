/* ---------- narração didática ---------- */

function mentions(source, name) {
  return new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}($|[^\\w$])`).test(source)
}

// "`n <= 1` (com n = 1) é verdadeiro": só cita os parâmetros que aparecem na condição.
function conditionText(node, cond) {
  const used = variablesAt(node, 0).filter(
    (variable) =>
      variable.isParam && /^[\w$]+$/.test(variable.name) && mentions(cond.src, variable.name),
  )
  const values = used.length
    ? ` (com ${used.map((variable) => `${variable.name} = ${shorten(variable.value, 40)}`).join(', ')})`
    : ''
  return `${code(cond.src)}${values} é <b>${cond.result ? 'verdadeiro' : 'falso'}</b>`
}

function conditionNote(node, step) {
  const conds = condsAt(node, step)
  if (!conds.length) return ''
  const last = conds[conds.length - 1]
  const text = conditionText(node, last)
  if (last.result && node.isBase) return ` Teste: ${text} → é o caso base, não vai chamar ninguém.`
  if (!last.result && !node.isBase) return ` Teste: ${text} → segue para o caso recursivo.`
  return ` Teste: ${text}.`
}

function narrateCall(node, call, parentCall, step) {
  const note = conditionNote(node, step)
  if (!node.parent)
    return `<b>Início.</b> ${call} é a chamada inicial (profundidade 0). Ela vai ficar <i>esperando</i> até todas as chamadas que ela fizer terminarem.${note}`
  const position = node.parent.children.indexOf(node)
  if (node.parent.fn !== node.fn) {
    return `<b>Outra função recursiva.</b> ${parentCall} (${node.parent.fn}) chamou ${call} (${node.fn}). Uma nova recursão começa aqui dentro; as chamadas dela aparecem como filhas.${note}`
  }
  return `<b>Nova chamada.</b> ${parentCall} chamou ${call} — é a <b>${ordinal(position)} chamada recursiva</b> dela${
    node.line ? ` (linha ${node.line})` : ''
  }. Profundidade ${node.depth}: agora há ${node.depth + 1} chamadas empilhadas.${note}`
}

function narrate(step) {
  const trace = state.trace
  if (step === 0) {
    return `Aperte <b>▶ Play</b> ou arraste o slider. A primeira chamada é ${code(callText(trace.rootNode, 'f'))}: ninguém a chamou, é o ponto de partida.`
  }

  const event = trace.events[step - 1]
  const node = trace.nodes.get(event.id)
  const parentCall = node.parent ? code(callText(node.parent, 's')) : null
  const call = code(callText(node, 'f'))

  if (event.t === 'c') return narrateCall(node, call, parentCall, step)

  if (event.t === 't')
    return `<b>Erro.</b> ${call} lançou: ${code(event.msg)}. O erro sobe para quem chamou.`

  return narrateReturn(node, event, step)
}

function narrateReturn(node, event, step) {
  const trace = state.trace
  const parentCall = node.parent ? code(callText(node.parent, 's')) : null
  const call = code(callText(node, 'f'))
  const value = code(event.v.f)
  const destination = parentCall
    ? `devolve ${value} para ${parentCall}`
    : `devolve ${value} como resultado final`
  const next = trace.events[step]
  const hasNext = next && next.t === 'c' && node.parent && next.parent === node.parent.id
  const followUp = hasNext
    ? ` Em seguida ${parentCall} faz a ${ordinal(node.parent.children.length)} chamada recursiva.`
    : ''

  if (node.children.length === 0) {
    const reason = [...condsAt(node, step)].reverse().find((cond) => cond.result)
    const opening = reason
      ? `${conditionText(node, reason)}, então ${call} não precisou chamar ninguém`
      : `${call} não precisou chamar ninguém`
    return `<b>Caso base.</b> ${opening} e ${destination}.${followUp}`
  }
  const parts = node.children
    .map((child) => (child.value && child.kind === 'return' ? child.value.s : '✖'))
    .join(', ')
  const locals = localsAt(node, step)
    .map((local) => code(`${local.name} = ${shorten(local.v.f, 30)}`))
    .join(', ')
  const kept = locals ? ` Variáveis guardadas: ${locals}.` : ''
  return `<b>Voltando.</b> Todas as ${node.children.length} chamadas filhas de ${call} terminaram (resultados: ${code(parts)}).${kept} Combinando, ela ${destination}.${followUp}`
}

function renderSummary(step) {
  const trace = state.trace
  if (step !== trace.events.length) {
    elements.summary.innerHTML = ''
    return
  }
  const root = trace.rootNode
  const result = root.kind === 'return' ? code(root.value.f) : `erro ${code(root.message)}`
  const truncated = state.data.truncated
    ? ' ⚠ trace truncado (muitas chamadas): a árvore mostra só o início.'
    : ''
  elements.summary.innerHTML = `✓ <b>Fim.</b> ${trace.total} chamadas · profundidade máxima ${trace.maxDepth} · resultado ${result}.${truncated}`
}

/* ---------- painéis laterais ---------- */

const MAX_RETURN_CHIPS = 60

function renderReturns(step) {
  const chips = []
  for (let index = step - 1; index >= 0 && chips.length < MAX_RETURN_CHIPS; index--) {
    const event = state.trace.events[index]
    if (event.t === 'c') continue
    const node = state.trace.nodes.get(event.id)
    const chip = document.createElement('span')
    const failed = event.t === 't'
    chip.className = `retChip${failed ? ' error' : ''}${node.isBase ? ' base' : ''}${chips.length === 0 ? ' latest' : ''}`
    const outcome = failed ? `✖ ${shorten(event.msg, 30)}` : event.v.s
    chip.innerHTML = `${escapeHtml(shorten(callText(node, 's'), 36))} → <b>${escapeHtml(outcome)}</b>`
    attachTooltip(chip, node)
    chip.addEventListener('click', () => goTo(index + 1, true))
    chips.push(chip)
  }
  if (!chips.length) {
    const empty = document.createElement('i')
    empty.textContent = 'nenhuma chamada retornou ainda'
    chips.push(empty)
  }
  elements.returnChips.replaceChildren(...chips)
  elements.returnChips.scrollLeft = 0
}

function renderStack(focus, lastEvent) {
  elements.stack.replaceChildren()
  if (!focus) return
  const start = lastEvent.t === 'c' ? focus : focus.parent
  const frames = []
  for (let node = start; node; node = node.parent) frames.push(node)

  const visible = frames.slice(0, 30)
  visible.forEach((node, index) => {
    const frame = document.createElement('div')
    frame.className = `frame${index === 0 ? ' top' : ''}`
    frame.innerHTML = `<code>${escapeHtml(shorten(callText(node, 's'), 36))}</code><small>${index === 0 ? 'executando' : 'esperando'}</small>`
    attachTooltip(frame, node)
    elements.stack.append(frame)
  })
  if (frames.length > visible.length) {
    const rest = document.createElement('div')
    rest.className = 'frame'
    rest.textContent = `… e mais ${frames.length - visible.length} abaixo`
    elements.stack.append(rest)
  }
  if (!frames.length) elements.stack.innerHTML = '<i>vazia — tudo terminou</i>'
}

function variableLines(node, step) {
  return variablesAt(node, step).map(
    (variable) =>
      `<div class="var"><b>${escapeHtml(variable.name)}</b> = ${code(variable.value)}</div>`,
  )
}

function conditionLines(node, step) {
  return condsAt(node, step).flatMap((cond) => {
    const operands = (cond.operands || []).map(
      (operand) =>
        `<div class="var operand"><b>${escapeHtml(operand.src)}</b> = ${code(operand.v.f)}</div>`,
    )
    return [
      ...operands,
      `<div class="var cond"><b>teste</b> ${code(cond.src)} → ${cond.result ? 'verdadeiro' : 'falso'}</div>`,
    ]
  })
}

function renderVars(focus, lastEvent, step) {
  const lines = []
  if (focus) {
    lines.push(...variableLines(focus, step))
    if (lastEvent.t === 'r')
      lines.push(`<div class="var"><b>retorno</b> = ${code(focus.value.f)}</div>`)
    lines.push(...conditionLines(focus, step))
  }
  elements.vars.innerHTML = lines.join('') || '<i>—</i>'
}

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
  return `<div class="tipRow"><span class="tipKey">${escapeHtml(name)}</span><span class="tipVal">${highlight(value)}</span></div>`
}

function tipConditions(node, step) {
  return condsAt(node, step)
    .map((cond) => {
      const operands = (cond.operands || []).map((operand) => tipRow(operand.src, operand.v.f))
      const verdict = cond.result ? 'verdadeiro' : 'falso'
      return `<div class="tipCond"><code>${highlightTerms(cond)}</code><span class="tipPill ${cond.result ? 'yes' : 'no'}">${verdict}</span></div>${operands.join('')}`
    })
    .join('')
}

function tipChildren(node, step) {
  const finished = node.children.filter((child) => child.endIndex < step)
  if (!finished.length) return ''
  const results = finished.map((child) => (child.kind === 'return' ? child.value.s : '✖'))
  return `<div class="tipNote">filhos que já retornaram: ${escapeHtml(results.join(', '))}</div>`
}

// Valores ao sair, só dos que mudaram em relação à entrada.
function tipFinals(node, entryValues) {
  const rows = (node.finals || [])
    .filter((local) => entryValues.has(local.name) && entryValues.get(local.name) !== local.v.f)
    .map((local) => tipRow(local.name, local.v.f))
  if (!rows.length) return ''
  return tipSection('Ao sair', rows.join(''))
}

// "return picked" mostra de qual expressão veio o valor; literais e valores iguais ao texto não repetem.
function tipReturn(node) {
  const value = `<div class="tipResult">${highlight(node.value.f)}</div>`
  if (!node.returnSrc || node.returnSrc === node.value.f) return value
  return `<div class="tipNote">${code(`return ${node.returnSrc}`)}</div>${value}`
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
  const conditions = tipConditions(node, step)
  const sections = [
    entry.length
      ? tipSection('Ao entrar', entry.map((param) => tipRow(param.name, param.value)).join(''))
      : '',
    variables.length ? tipSection('Variáveis', variables.join('')) : '',
    conditions ? tipSection('Testes', conditions) : '',
    returned ? tipFinals(node, entryValues) : '',
    returned ? tipSection('Retorno', tipReturn(node)) : '',
    stateName === 'error' ? tipSection('Erro', escapeHtml(node.message), 'failed') : '',
  ]
  return [
    `<header class="tipHead"><span class="tipFn">${escapeHtml(node.fn)}</span><span class="tipState ${stateName}">${STATE_LABELS[stateName]}</span></header>`,
    `<div class="tipMeta">${meta.join(' · ')}</div>`,
    ...sections,
    tipChildren(node, step),
  ].join('')
}

function buildLog(trace) {
  elements.log.replaceChildren()
  trace.events.forEach((event, index) => {
    const node = trace.nodes.get(event.id)
    const row = document.createElement('div')
    row.className = 'row'
    row.style.paddingLeft = `${4 + Math.min(node.depth, 20) * 10}px`
    if (event.t === 'c') row.textContent = `▶ ${callText(node, 's')}`
    if (event.t === 'r') row.textContent = `◀ ${callText(node, 's')} → ${event.v.s}`
    if (event.t === 't') row.textContent = `✖ ${event.msg}`
    row.addEventListener('click', () => goTo(index + 1, true))
    elements.log.append(row)
  })
}

function renderLog(previousStep, step) {
  const rows = elements.log.children
  const from = Math.max(0, Math.min(previousStep, step) - 2)
  const to = Math.min(rows.length - 1, Math.max(previousStep, step) + 1)
  for (let index = from; index <= to; index++) {
    rows[index].classList.toggle('past', index < step)
    rows[index].classList.toggle('current', index === step - 1)
  }
  if (step > 0 && rows[step - 1]) rows[step - 1].scrollIntoView({ block: 'nearest' })
}
