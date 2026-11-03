/* ---------- cores de código (herdam as cores do tema do VS Code) ---------- */

const TOKEN_PATTERN = new RegExp(
  [
    String.raw`(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`)',
    String.raw`(?<number>\b\d+(?:\.\d+)?(?:e[+-]?\d+)?n?\b|\bNaN\b|\bInfinity\b)`,
    String.raw`(?<literal>\b(?:true|false|null|undefined)\b)`,
    String.raw`(?<keyword>\b(?:return|if|else|new|typeof|function|const|let|var|in|of|instanceof)\b)`,
    String.raw`(?<call>[A-Za-z_$][\w$]*)(?=\()`,
    String.raw`(?<operator>===|!==|==|!=|<=|>=|&&|\|\||\?\?|=>|[-+*/%<>=!?:&|^~])`,
  ].join('|'),
  'g',
)

// Devolve o texto já escapado, com <span class="tok-..."> nos trechos reconhecidos.
function highlight(text) {
  let html = ''
  let cursor = 0
  for (const match of String(text).matchAll(TOKEN_PATTERN)) {
    const kind = Object.keys(match.groups).find((name) => match.groups[name] !== undefined)
    html += escapeHtml(text.slice(cursor, match.index))
    html += `<span class="tok-${kind}">${escapeHtml(match[0])}</span>`
    cursor = match.index + match[0].length
  }
  return html + escapeHtml(text.slice(cursor))
}

/* ---------- quebra de linha de valores (estilo prettier) ---------- */

const PRETTY_CLOSERS = { '{': '}', '[': ']', '(': ')' }
const PRETTY_INDENT = 2
const PRETTY_WIDTH = 36

// Texto -> lista de itens separados por vírgula; cada item é uma lista de trechos (string ou grupo).
function parseItems(text, start, closer) {
  const items = []
  let parts = []
  let plain = ''
  let index = start
  const flush = () => {
    if (plain) parts.push(plain)
    plain = ''
  }
  while (index < text.length) {
    const char = text[index]
    if (char === closer) {
      flush()
      if (parts.length) items.push(parts)
      return { items, end: index + 1 }
    }
    if (char === ',') {
      flush()
      items.push(parts)
      parts = []
      index++
      // O espaço depois da vírgula vira quebra/espaço na impressão.
      while (text[index] === ' ') index++
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const quoted = text
        .slice(index)
        .match(/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/)
      const literal = quoted ? quoted[0] : char
      plain += literal
      index += literal.length
      continue
    }
    if (PRETTY_CLOSERS[char]) {
      flush()
      const inner = parseItems(text, index + 1, PRETTY_CLOSERS[char])
      if (!inner) return null
      parts.push({ open: char, close: PRETTY_CLOSERS[char], items: inner.items })
      index = inner.end
      continue
    }
    plain += char
    index++
  }
  return null
}

function flatLength(parts) {
  return parts.reduce(
    (total, part) =>
      total +
      (typeof part === 'string'
        ? part.length
        : part.open.length + flatItemsLength(part.items) + part.close.length),
    0,
  )
}

function flatItemsLength(items) {
  return (
    items.reduce((total, item) => total + flatLength(item), 0) + Math.max(0, items.length - 1) * 2
  )
}

function printParts(parts, indent, column, width, trailing) {
  let output = ''
  let current = column
  parts.forEach((part, position) => {
    if (typeof part === 'string') {
      output += part
      current += part.length
      return
    }
    const isLast = position === parts.length - 1
    const flat = part.open.length + flatItemsLength(part.items) + part.close.length
    if (!part.items.length || current + flat + (isLast ? trailing : 0) <= width) {
      const body = part.items.map((item) => printParts(item, indent, 0, Infinity, 0)).join(', ')
      output += `${part.open}${body}${part.close}`
      current += flat
      return
    }
    const inner = indent + PRETTY_INDENT
    const lines = part.items.map((item, itemIndex) => {
      const comma = itemIndex < part.items.length - 1 ? ',' : ''
      return ' '.repeat(inner) + printParts(item, inner, inner, width, comma.length) + comma
    })
    output += `${part.open}\n${lines.join('\n')}\n${' '.repeat(indent)}${part.close}`
    current = indent + part.close.length
  })
  return output
}

// Quebra {…}, […] e (…) que não cabem em `width` colunas, um item por linha, indentado.
function prettyValue(text, width = PRETTY_WIDTH) {
  const source = String(text)
  if (source.length <= width) return source
  const parsed = parseItems(`${source})`, 0, ')')
  if (!parsed || parsed.items.length !== 1 || parsed.end !== source.length + 1) return source
  return printParts(parsed.items[0], 0, 0, width, 0)
}
