/* ---------- quadro: estruturas de dados em ASCII ---------- */

function matrixText(shape) {
  const width = Math.max(...shape.rows.flat().map((cell) => cell.length))
  const rule = `+${shape.rows[0].map(() => '-'.repeat(width + 2)).join('+')}+`
  const lines = [rule]
  for (const row of shape.rows) {
    lines.push(`| ${row.map((cell) => cell.padStart(width)).join(' | ')} |`, rule)
  }
  if (shape.cut) lines.push('…')
  return lines.join('\n')
}

function treeLines(node, prefix, lines) {
  const kids = node.kids
  kids.forEach((kid, index) => {
    const isLast = index === kids.length - 1 && !node.cut
    const tag = kid.tag ? `${kid.tag} ` : ''
    lines.push(`${prefix}${isLast ? '└─' : '├─'} ${tag}${kid.node.v}`)
    treeLines(kid.node, prefix + (isLast ? '   ' : '│  '), lines)
  })
  if (node.cut) lines.push(`${prefix}└─ …`)
}

function treeText(shape) {
  const lines = [shape.root.v]
  treeLines(shape.root, '', lines)
  return lines.join('\n')
}

function listText(shape) {
  return [...shape.items, shape.end].join(' → ')
}

function graphText(shape) {
  const width = Math.max(...shape.edges.map(([from]) => from.length))
  const lines = shape.edges.map(
    ([from, neighbors]) => `${from.padEnd(width)} → ${neighbors.join(', ') || '—'}`,
  )
  if (shape.cut) lines.push('…')
  return lines.join('\n')
}

const BOARD_DRAWERS = { matrix: matrixText, tree: treeText, list: listText, graph: graphText }

function boardText(shape) {
  return BOARD_DRAWERS[shape.k](shape)
}

// Desenha as estruturas que a chamada em foco recebeu como argumento.
function renderBoard(focus) {
  const params = focus ? state.data.functionParams[focus.fn] || [] : []
  const blocks = focus
    ? focus.args.flatMap((arg, index) =>
        arg.d
          ? [
              `<div class="boardName">${escapeHtml(params[index] || `arg${index}`)}</div><pre>${escapeHtml(boardText(arg.d))}</pre>`,
            ]
          : [],
      )
    : []
  elements.boardTitle.hidden = !blocks.length
  elements.board.hidden = !blocks.length
  elements.board.innerHTML = blocks.join('')
}
