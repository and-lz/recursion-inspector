const vscode = acquireVsCodeApi()

const NODE_WIDTH_CHAR = 6.8
const NODE_HEIGHT = 40
const COMPACT_HEIGHT = 28
const LEVEL_GAP = 40
const SLOT_GAP = 14
const EDGE_CHAR_WIDTH = 7.5
const MIN_EDGE_CHARS = 4
const MARGIN = 20
const TOP_MARGIN = 48
const MAX_ARGS = 30
const STATE_DOT_RADIUS = 4.5
const STATE_DOT_GAP = 6
const STATE_PILL_PADDING = 8
const STATE_PILL_DROP = 4
const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const ZOOM_SPEED = 0.01
const LOW_DETAIL_ZOOM = 0.45
const DOT_SIZE = 12
const DOT_GAP = 3
const DOT_LEVEL_GAP = 10
const DOT_MARGIN = 10
const SCROLLBAR_ALLOWANCE = 20
const MIN_AVAILABLE_WIDTH = 200
const OUTLINE_INDENT = 18
const OUTLINE_MIN_INDENT = 3
const OUTLINE_ROW_GAP = 4
const EDGE_LABEL_WIDTH = 70
const SVG_NS = 'http://www.w3.org/2000/svg'
const FN_COLORS = ['#3b82f6', '#c084fc', '#f97316', '#14b8a6', '#ec4899', '#a3a3a3']
const EXPLAINED_DELAY_MS = 1400
const COMPACT_MAX_DELAY_MS = 250
const COMPACT_TOTAL_MS = 2000
const MAX_ANIMATED_STEPS = 100
const SUMMARY_HEAD = 20

const elements = {}
for (const id of [
  'empty',
  'rootPicker',
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
  'explainText',
  'summary',
  'tree',
  'treeWrap',
  'returnChips',
  'stack',
  'inspectorBox',
  'inspector',
  'inspectorLights',
  'inspectorClose',
  'inspectorResizer',
  'sidebarResizer',
  'vars',
  'board',
  'boardTitle',
  'log',
  'tooltip',
  'first',
  'prev',
  'play',
  'next',
  'last',
  'slider',
  'zoomReset',
  'counter',
  'viewMode',
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
  playFrom: null,
  view: null,
  inspected: null,
  zoom: 1,
  treeSize: null,
  viewport: null,
  summarized: true,
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
  return `<code>${highlight(text)}</code>`
}

// `return ...` com em negrito o trecho que de fato foi devolvido (return com ?: ou ||, &&).
function returnCode(node) {
  const pick = node.returnPick
  if (!pick) return code(`return ${node.returnSrc}`)
  const { returnSrc } = node
  return `<code>${highlight('return ')}${highlight(returnSrc.slice(0, pick.from))}<b class="pick">${highlight(returnSrc.slice(pick.from, pick.to))}</b>${highlight(returnSrc.slice(pick.to))}</code>`
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function argsText(node, field) {
  return node.args.map((arg) => arg[field]).join(', ')
}

function callText(node, field) {
  return `${node.fn}(${argsText(node, field)})`
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

// `at` das sondas é global (nº de eventos até então); vira relativo ao passo desta raiz.
function attachProbes(nodes, startIndex) {
  for (const probe of state.data.probes || []) {
    const node = nodes.get(probe.id)
    if (!node) continue
    const at = probe.at - startIndex
    if (probe.kind === 'final') {
      node.finals = probe.vars
      node.returnSrc = probe.src
      node.returnPick = probe.pick
    } else if (probe.kind === 'var') node.locals.push({ name: probe.name, v: probe.v, at })
    else
      node.conds.push({
        src: probe.src,
        result: probe.result,
        operands: probe.operands,
        terms: probe.terms || [],
        line: probe.line,
        at,
      })
  }
}

function localsAt(node, step) {
  const latest = new Map()
  for (const local of node.locals) {
    if (local.at > step) break
    latest.set(local.name, local)
  }
  return [...latest.values()]
}

function condsAt(node, step) {
  return node.conds.filter((cond) => cond.at <= step)
}

// Parâmetros e locais num mesmo passo; parâmetro reatribuído mostra o valor novo.
function variablesAt(node, step) {
  const params = state.data.functionParams[node.fn] || []
  const variables = node.args.map((arg, index) => ({
    name: params[index] || `arg${index}`,
    value: arg.f,
    isParam: true,
  }))
  for (const local of localsAt(node, step)) {
    const existing = variables.find((variable) => variable.name === local.name)
    if (existing) existing.value = local.v.f
    else variables.push({ name: local.name, value: local.v.f, isParam: false })
  }
  return variables
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
        locals: [],
        finals: null,
        returnSrc: null,
        returnPick: null,
        conds: [],
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

  attachProbes(nodes, root.startIndex)

  return { events, nodes, rootNode: nodes.get(root.id), maxDepth, total: nodes.size }
}
