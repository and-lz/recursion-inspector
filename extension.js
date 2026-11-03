const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { findRecursiveFunctions } = require('./src/detect')
const { instrument } = require('./src/instrument')
const { runTrace } = require('./src/run')

// Ordem importa: scripts clássicos compartilham o escopo global.
const PANEL_SCRIPTS = [
  'panel-state.js',
  'panel-syntax.js',
  'panel-tree.js',
  'panel-zoom.js',
  'panel-details.js',
  'panel-inspector.js',
  'panel-tooltip.js',
  'panel.js',
]

let panel = null
let pendingPayload = null
let inspectedUri = null
let highlight = null
let maximized = false

class RecursionLensProvider {
  provideCodeLenses(document) {
    if (document.languageId !== 'javascript') return []
    let functions
    try {
      functions = findRecursiveFunctions(document.getText())
    } catch {
      return []
    }
    return functions.map((fn) => {
      const position = new vscode.Position(fn.line - 1, fn.column)
      return new vscode.CodeLens(new vscode.Range(position, position), {
        title: '▶ Inspecionar recursão',
        command: 'recursionInspector.inspect',
        arguments: [document.uri.toString(), fn.start],
      })
    })
  }
}

function buildHtml(webview, extensionPath) {
  const mediaPath = (name) => vscode.Uri.file(path.join(extensionPath, 'media', name))
  const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    '',
  )
  const html = fs.readFileSync(path.join(extensionPath, 'media', 'panel.html'), 'utf8')
  const scriptTags = PANEL_SCRIPTS.map((name) => {
    const src = webview.asWebviewUri(mediaPath(name)).toString()
    return `    <script nonce="${nonce}" src="${src}"></script>`
  }).join('\n')
  return html
    .replace(/{{nonce}}/g, nonce)
    .replace(/{{cspSource}}/g, webview.cspSource)
    .replace('{{css}}', webview.asWebviewUri(mediaPath('panel.css')).toString())
    .replace('{{scripts}}', scriptTags)
}

function setHighlight(line) {
  if (!highlight || !inspectedUri) return
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() !== inspectedUri) continue
    if (!line) {
      editor.setDecorations(highlight, [])
      continue
    }
    const range = new vscode.Range(line - 1, 0, line - 1, 0)
    editor.setDecorations(highlight, [range])
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  }
}

function isFullscreen() {
  return getLayout() === 'fullscreen'
}

async function maximizeEditor() {
  if (maximized) return
  maximized = true
  await vscode.commands.executeCommand('workbench.action.maximizeEditorHideSidebar')
}

function getLayout() {
  return vscode.workspace.getConfiguration('recursionInspector').get('layout')
}

function restoreEditor() {
  if (!maximized) return
  maximized = false
  vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup')
}

function ensurePanel(context) {
  const fullscreen = isFullscreen()
  const column = getLayout() === 'beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
  if (panel) {
    panel.reveal(column, !fullscreen)
    if (fullscreen) maximizeEditor()
    return panel
  }

  panel = vscode.window.createWebviewPanel('recursionInspector', 'Recursão', column, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))],
  })
  highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
    borderStyle: 'solid',
    borderWidth: '0 0 0 3px',
  })
  if (fullscreen) maximizeEditor()
  panel.webview.html = buildHtml(panel.webview, context.extensionPath)
  panel.webview.onDidReceiveMessage((message) => {
    if (message.type === 'ready' && pendingPayload)
      panel.webview.postMessage({ type: 'data', payload: pendingPayload })
    if (message.type === 'line') setHighlight(message.line)
    if (message.type === 'settings') context.globalState.update('settings', message.settings)
  })
  panel.onDidDispose(() => {
    setHighlight(null)
    highlight.dispose()
    highlight = null
    panel = null
    restoreEditor()
  })
  return panel
}

async function inspect(context, uriString, start) {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString))
  let instrumented
  try {
    instrumented = instrument(document.getText(), start)
  } catch (error) {
    vscode.window.showErrorMessage(error.message)
    return
  }

  let result
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Executando e rastreando a recursão…',
      },
      () => runTrace(instrumented.code),
    )
  } catch (error) {
    vscode.window.showErrorMessage(`Recursion Inspector: ${error.message}`)
    return
  }

  inspectedUri = uriString
  pendingPayload = {
    fnName: instrumented.target.name,
    fnLine: instrumented.target.line,
    params: instrumented.target.params,
    functionParams: Object.fromEntries(instrumented.functions.map((fn) => [fn.name, fn.params])),
    fileName: path.basename(document.uri.fsPath),
    settings: context.globalState.get('settings') || {},
    ...result,
  }
  const target = ensurePanel(context)
  target.title = `Recursão: ${instrumented.target.name}`
  target.webview.postMessage({ type: 'data', payload: pendingPayload })
}

function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'javascript' },
      new RecursionLensProvider(),
    ),
    vscode.commands.registerCommand('recursionInspector.inspect', (uriString, start) =>
      inspect(context, uriString, start),
    ),
  )
}

function deactivate() {}

module.exports = { activate, deactivate }
