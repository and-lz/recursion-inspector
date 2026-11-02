/* ---------- narração didática ---------- */

function narrateCall(node, call, parentCall) {
  if (!node.parent)
    return `<b>Início.</b> ${call} é a chamada inicial (profundidade 0). Ela vai ficar <i>esperando</i> até todas as chamadas que ela fizer terminarem.`
  const position = node.parent.children.indexOf(node)
  if (node.parent.fn !== node.fn) {
    return `<b>Outra função recursiva.</b> ${parentCall} (${node.parent.fn}) chamou ${call} (${node.fn}). Uma nova recursão começa aqui dentro; as chamadas dela aparecem como filhas.`
  }
  return `<b>Nova chamada.</b> ${parentCall} chamou ${call} — é a <b>${ordinal(position)} chamada recursiva</b> dela${
    node.line ? ` (linha ${node.line})` : ''
  }. Profundidade ${node.depth}: agora há ${node.depth + 1} chamadas empilhadas.`
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

  if (event.t === 'c') return narrateCall(node, call, parentCall)

  if (event.t === 't')
    return `<b>Erro.</b> ${call} lançou: ${code(event.msg)}. O erro sobe para quem chamou.`

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
    return `<b>Caso base.</b> ${call} não precisou chamar ninguém e ${destination}.${followUp}`
  }
  const parts = node.children
    .map((child) => (child.value && child.kind === 'return' ? child.value.s : '✖'))
    .join(', ')
  return `<b>Voltando.</b> Todas as ${node.children.length} chamadas filhas de ${call} terminaram (resultados: ${code(parts)}). Combinando, ela ${destination}.${followUp}`
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
    chip.title = failed ? event.msg : `${callText(node, 'f')} retornou ${event.v.f}`
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

function renderVars(focus, lastEvent) {
  const lines = []
  if (focus) {
    focus.args.forEach((arg, index) => {
      const param = (state.data.functionParams[focus.fn] || [])[index] || `arg${index}`
      lines.push(`<div class="var"><b>${escapeHtml(param)}</b> = ${escapeHtml(arg.f)}</div>`)
    })
    if (lastEvent.t === 'r')
      lines.push(`<div class="var"><b>retorno</b> = ${escapeHtml(focus.value.f)}</div>`)
  }
  elements.vars.innerHTML = lines.join('') || '<i>—</i>'
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
