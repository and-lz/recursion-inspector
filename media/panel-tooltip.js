/* ---------- tooltip de detalhes ---------- */

const TOOLTIP_OFFSET = 14
const TOOLTIP_MARGIN = 8

const tooltip = { node: null, source: null, describe: null }

function attachTooltip(element, node, describe = describeNode) {
  element.addEventListener('mouseenter', (event) => showTooltip(node, describe, event))
  element.addEventListener('mousemove', moveTooltip)
  element.addEventListener('mouseleave', hideTooltip)
}

function showTooltip(node, describe, event) {
  const html = describe(node, state.step)
  if (!html) return
  tooltip.node = node
  tooltip.describe = describe
  tooltip.source = event.currentTarget
  elements.tooltip.innerHTML = html
  elements.tooltip.hidden = false
  moveTooltip(event)
}

function moveTooltip(event) {
  const box = elements.tooltip
  const maxLeft = window.innerWidth - box.offsetWidth - TOOLTIP_MARGIN
  const maxTop = window.innerHeight - box.offsetHeight - TOOLTIP_MARGIN
  const below = event.clientY + TOOLTIP_OFFSET
  const top = below > maxTop ? event.clientY - TOOLTIP_OFFSET - box.offsetHeight : below
  box.style.left = `${Math.max(TOOLTIP_MARGIN, Math.min(event.clientX + TOOLTIP_OFFSET, maxLeft))}px`
  box.style.top = `${Math.max(TOOLTIP_MARGIN, top)}px`
}

function hideTooltip() {
  tooltip.node = null
  tooltip.source = null
  tooltip.describe = null
  elements.tooltip.hidden = true
}

// Durante o play o passo muda com o mouse parado: atualiza o conteúdo. Pilha e chips são
// recriados a cada passo, então o elemento sob o mouse some sem disparar mouseleave.
function refreshTooltip() {
  if (!tooltip.node) return
  if (tooltip.source.isConnected === false) {
    hideTooltip()
    return
  }
  const html = tooltip.describe(tooltip.node, state.step)
  if (!html) {
    hideTooltip()
    return
  }
  elements.tooltip.innerHTML = html
}

const CLOSERS = { '[': ']', '{': '}' }

function stringEnd(text, start) {
  let index = start + 1
  while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1
  return index + 1
}

// Devolve o texto de um caractere de pontuação, ajustando a pilha de aberturas.
function punctuation(char, stack) {
  const indent = () => `\n${'  '.repeat(stack.length)}`
  if (CLOSERS[char]) {
    stack.push(char)
    return char + indent()
  }
  if (char === '(') {
    stack.push(char)
    return char
  }
  if (char === ')') {
    stack.pop()
    return char
  }
  if (char === ']' || char === '}') {
    stack.pop()
    return indent() + char
  }
  if (char === ',' && CLOSERS[stack[stack.length - 1]]) return char + indent()
  return char
}

// O valor vem em uma linha só: quebra em cada vírgula dentro de [] e {} e indenta por nível.
function prettify(text) {
  const stack = []
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      const end = stringEnd(text, index)
      out += text.slice(index, end)
      index = end
      continue
    }
    index++
    if (CLOSERS[char] && text[index] === CLOSERS[char]) {
      out += char + text[index++]
      continue
    }
    out += punctuation(char, stack)
    if (char === ',' && text[index] === ' ') index++
  }
  return out
}

function describeEdgeValue(node, step) {
  const lastEvent = step > 0 ? state.trace.events[step - 1] : null
  const stateName = nodeState(node, step, lastEvent)
  const head = `<header class="tipHead">${code(callText(node, 'f'))}</header>`
  if (stateName === 'error') return head + tipSection('Erro', escapeHtml(node.message), 'failed')
  if (stateName !== 'done' && stateName !== 'returning') return ''
  const source =
    node.returnSrc && node.returnSrc !== node.value.f
      ? `<div class="tipNote"><code>return ${escapeHtml(node.returnSrc)}</code></div>`
      : ''
  const value = `<pre class="tipValue">${escapeHtml(prettify(node.value.f))}</pre>`
  return head + tipSection('Retorno', source + value)
}

// Destaca em negrito cada termo avaliado do teste (verde = verdadeiro, vermelho = falso);
// o que o curto-circuito pulou fica sem destaque.
function highlightTerms(cond) {
  let html = ''
  let cursor = 0
  for (const term of [...(cond.terms || [])].sort((first, second) => first.from - second.from)) {
    if (term.from < cursor) continue
    html += escapeHtml(cond.src.slice(cursor, term.from))
    html += `<b class="term ${term.result ? 'yes' : 'no'}">${escapeHtml(cond.src.slice(term.from, term.to))}</b>`
    cursor = term.to
  }
  return html + escapeHtml(cond.src.slice(cursor))
}
