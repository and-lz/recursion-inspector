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

// Blocos da explicação: título, frase, linhas rotuladas (Teste, Fase...) e exemplo em código.
function exTitle(text, tone) {
  return `<h3 class="exTitle ${tone}">${text}</h3>`
}

function exRow(label, body) {
  return `<div class="exRow"><span class="exLabel">${label}</span><div>${body}</div></div>`
}

function conditionRow(node, step) {
  const conds = condsAt(node, step)
  if (!conds.length) return ''
  const last = conds[conds.length - 1]
  const text = conditionText(node, last)
  if (last.result && node.isBase)
    return exRow('Teste', `${text}<br>→ caso base, não chama ninguém.`)
  if (!last.result && !node.isBase)
    return exRow('Teste', `${text}<br>→ segue para o caso recursivo.`)
  return exRow('Teste', text)
}

// A explicação só conclui o que o inspetor já mostra (teste, papel do retorno), sem repetir os dados.
function narrateCall(node, call, parentCall, step) {
  const test = conditionRow(node, step)
  if (!node.parent) return `${exTitle('Início', 'call')}<p>${call} é a chamada inicial.</p>${test}`
  const position = ordinal(node.parent.children.indexOf(node))
  if (node.parent.fn !== node.fn)
    return `${exTitle('Outra função recursiva', 'call')}<p>${call} (${node.fn}) foi chamada por ${parentCall} (${node.parent.fn}).</p>${test}`
  return `${exTitle('Nova chamada', 'call')}<p>${call} é a <b>${position} chamada recursiva</b> de ${parentCall}.</p>${test}`
}

function narrate(step) {
  const trace = state.trace
  if (step === 0) {
    return `${exTitle('Pronto', 'call')}<p>Aperte <b>▶ Play</b> ou arraste o slider.</p><p>A primeira chamada é ${code(callText(trace.rootNode, 'f'))}.</p>`
  }

  const event = trace.events[step - 1]
  const node = trace.nodes.get(event.id)
  const parentCall = node.parent ? code(callText(node.parent, 's')) : null
  const call = code(callText(node, 'f'))

  if (event.t === 'c')
    return `${narrateCall(node, call, parentCall, step)}${phaseNote('pre', 'entrou, ainda sem filhos.')}`

  if (event.t === 't')
    return `${exTitle('Erro', 'error')}<p>${RETURN_ROLES.error.hint(node)}</p><p>O erro sobe para quem chamou.</p>`

  return narrateReturn(node, event, step)
}

function narrateReturn(node, event, step) {
  const trace = state.trace
  const parentCall = node.parent ? code(callText(node.parent, 's')) : null
  const role = RETURN_ROLES[node.role]
  const destination = parentCall
    ? `Devolve ${code(event.v.f)} para ${parentCall}.`
    : `Resultado final: ${code(event.v.f)}.`
  const next = trace.events[step]
  const hasNext = next && next.t === 'c' && node.parent && next.parent === node.parent.id
  const followUp = hasNext
    ? phaseNote('in', `${parentCall} vai fazer a ${ordinal(node.parent.children.length)} chamada.`)
    : ''
  const reason = node.isBase ? [...condsAt(node, step)].reverse().find((cond) => cond.result) : null
  const test = reason ? exRow('Teste', conditionText(node, reason)) : ''
  const tone = node.isBase ? 'base' : 'done'
  const title = role.label[0].toUpperCase() + role.label.slice(1)
  const post = node.children.length ? phaseNote('post', 'todos os filhos voltaram.') : ''
  return `${exTitle(title, tone)}${test}<p>${role.hint(node)}</p><p>${destination}</p>${post}${followUp}`
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

function buildLog(trace) {
  const rows = trace.events.map((event, index) => {
    const node = trace.nodes.get(event.id)
    const row = document.createElement('div')
    row.className = 'row'
    row.step = index + 1
    row.style.paddingLeft = `${4 + Math.min(node.depth, 20) * 10}px`
    if (event.t === 'c') row.textContent = `▶ ${callText(node, 's')}`
    if (event.t === 'r') row.textContent = `◀ ${callText(node, 's')} → ${event.v.s}`
    if (event.t === 't') row.textContent = `✖ ${event.msg}`
    return row
  })
  elements.log.replaceChildren(...rows)
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
