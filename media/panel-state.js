const vscode = acquireVsCodeApi()

const NODE_WIDTH_CHAR = 6.8
const NODE_HEIGHT = 40
const COMPACT_HEIGHT = 28
const LEVEL_GAP = 40
const SLOT_GAP = 14
const MARGIN = 20
const MAX_LABEL = 30
const SVG_NS = 'http://www.w3.org/2000/svg'
const FN_COLORS = ['#3b82f6', '#c084fc', '#f97316', '#14b8a6', '#ec4899', '#a3a3a3']
const DELAY_MS = { explained: 1400, compact: 250 }

const elements = {}
for (const id of [
  'empty',
  'app',
  'fnLegend',
  'menu',
  'menuButton',
  'showExplain',
  'showReturns',
  'showSidebar',
  'sidebar',
  'explain',
  'returns',
  'title',
  'rootSelect',
  'modeSelect',
  'speedSelect',
  'explainText',
  'summary',
  'tree',
  'treeWrap',
  'returnChips',
  'stack',
  'vars',
  'log',
  'first',
  'prev',
  'play',
  'next',
  'last',
  'slider',
  'counter',
]) {
  elements[id] = document.getElementById(id)
}

const state = {
  data: null,
  roots: [],
  trace: null,
  step: 0,
  playing: false,
  timer: null,
  view: null,
}

function ordinal(index) {
  return `${index + 1}ª`
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char],
  )
}

function code(text) {
  return `<code>${escapeHtml(text)}</code>`
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function callText(node, field) {
  return `${node.fn}(${node.args.map((arg) => arg[field]).join(', ')})`
}

/* ---------- dados ---------- */

// Raiz = chamada da função clicada que não está dentro de outra chamada dela mesma.
// Chamadas de outras funções recursivas feitas lá dentro entram na mesma árvore.
function findRoots(events) {
  const roots = []
  const functionOf = new Map()
  let openTargets = 0
  let current = null

  events.forEach((event, index) => {
    if (event.t === 'c') {
      functionOf.set(event.id, event.fn)
      if (event.fn !== state.data.fnName) return
      if (openTargets === 0) {
        current = { startIndex: index, endIndex: events.length - 1, id: event.id }
        roots.push(current)
      }
      openTargets++
      return
    }
    if (functionOf.get(event.id) !== state.data.fnName) return
    openTargets--
    if (openTargets === 0) current.endIndex = index
  })
  return roots
}

function buildTrace(root) {
  const events = state.data.events.slice(root.startIndex, root.endIndex + 1)
  const nodes = new Map()
  let maxDepth = 0

  events.forEach((event, index) => {
    if (event.t === 'c') {
      const node = {
        id: event.id,
        fn: event.fn,
        parent: nodes.get(event.parent) || null,
        children: [],
        depth: event.depth - events[0].depth,
        args: event.args,
        line: event.line,
        callIndex: index,
        endIndex: Infinity,
        kind: null,
        value: null,
        message: null,
      }
      if (node.parent) node.parent.children.push(node)
      nodes.set(event.id, node)
      maxDepth = Math.max(maxDepth, node.depth)
      return
    }
    const node = nodes.get(event.id)
    node.endIndex = index
    node.kind = event.t === 'r' ? 'return' : 'throw'
    node.value = event.v || null
    node.message = event.msg || null
  })

  return { events, nodes, rootNode: nodes.get(root.id), maxDepth, total: nodes.size }
}
