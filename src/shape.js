// Descreve argumentos que são estruturas (árvore, lista ligada, matriz, grafo) em dados
// simples e serializáveis; o painel desenha o ASCII a partir disso.
const MAX_NODES = 31
const MAX_ITEMS = 12
const MAX_NEIGHBORS = 8
const MAX_CELL_TEXT = 8
const VALUE_KEYS = ['val', 'value', 'v', 'data', 'key']
const BINARY_KEYS = [
  ['left', 'right'],
  ['l', 'r'],
]

function isPrimitive(value) {
  return value === null || (typeof value !== 'object' && typeof value !== 'function')
}

function cellText(value) {
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value)
  return text.length > MAX_CELL_TEXT ? `${text.slice(0, MAX_CELL_TEXT - 1)}…` : text
}

function labelOf(value) {
  const key = VALUE_KEYS.find((candidate) => candidate in value)
  if (!key) return '•'
  return isPrimitive(value[key]) ? cellText(value[key]) : '{…}'
}

function describeMatrix(value) {
  if (!Array.isArray(value) || !value.length) return null
  const cols = Array.isArray(value[0]) ? value[0].length : 0
  const isGrid = value.every(
    (row) => Array.isArray(row) && row.length === cols && row.every(isPrimitive),
  )
  if (!isGrid || !cols) return null
  const rows = value.slice(0, MAX_ITEMS).map((row) => row.slice(0, MAX_ITEMS).map(cellText))
  return { k: 'matrix', rows, cut: value.length > MAX_ITEMS || cols > MAX_ITEMS }
}

function neighborsText(neighbors) {
  const shown = neighbors.slice(0, MAX_NEIGHBORS).map(cellText)
  return neighbors.length > MAX_NEIGHBORS ? [...shown, '…'] : shown
}

function describeGraph(value) {
  const isList = Array.isArray(value)
  const entries = isList ? [...value.entries()] : Object.entries(value)
  if (!entries.length || !entries.every(([, row]) => Array.isArray(row) && row.every(isPrimitive)))
    return null
  if (isList && !value.every((row) => row.every(Number.isInteger))) return null
  const edges = entries
    .slice(0, MAX_ITEMS)
    .map(([from, neighbors]) => [String(from), neighborsText(neighbors)])
  return { k: 'graph', edges, cut: entries.length > MAX_ITEMS }
}

function describeList(value) {
  if (!('next' in value)) return null
  const seen = new Set()
  const items = []
  let end = 'null'
  for (let node = value; node; node = node.next) {
    if (typeof node !== 'object') break
    if (seen.has(node)) {
      end = '↺'
      break
    }
    if (items.length >= MAX_ITEMS) {
      end = '…'
      break
    }
    seen.add(node)
    items.push(labelOf(node))
  }
  return { k: 'list', items, end }
}

function childrenOf(value) {
  const pair = BINARY_KEYS.find(([left, right]) => left in value || right in value)
  if (pair) {
    return [
      { tag: 'L', child: value[pair[0]] },
      { tag: 'R', child: value[pair[1]] },
    ]
  }
  if (Array.isArray(value.children)) return value.children.map((child) => ({ tag: '', child }))
  return null
}

function buildNode(value, budget, path) {
  budget.count++
  const node = { v: labelOf(value), kids: [] }
  const slots = childrenOf(value)
  if (!slots) return node
  path.add(value)
  for (const { tag, child } of slots) {
    if (!child || typeof child !== 'object') continue
    if (path.has(child)) node.kids.push({ tag, node: { v: '↺', kids: [] } })
    else if (budget.count >= MAX_NODES) node.cut = true
    else node.kids.push({ tag, node: buildNode(child, budget, path) })
  }
  path.delete(value)
  return node
}

function describeTree(value) {
  if (Array.isArray(value) || !childrenOf(value)) return null
  return { k: 'tree', root: buildNode(value, { count: 0 }, new Set()) }
}

function describe(value) {
  if (typeof value !== 'object' || value === null) return null
  const graphSource = value instanceof Map ? Object.fromEntries(value) : value
  return (
    describeMatrix(value) ||
    describeTree(value) ||
    describeList(value) ||
    describeGraph(graphSource)
  )
}

module.exports = { describe }
