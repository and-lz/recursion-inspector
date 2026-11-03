/* ---------- cores de código (tema Dracula) ---------- */

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
