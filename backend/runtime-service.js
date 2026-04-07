const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function runSync(command, args = ['--version']) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true
  })
}

function detectCommand(command, args = ['--version']) {
  const result = runSync(command, args)

  if (result.error || result.status !== 0) {
    return {
      available: false,
      command,
      version: null,
      path: null
    }
  }

  const version = String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || null
  const whereResult = runSync('where', [command])
  const resolvedPath = whereResult.status === 0 ? String(whereResult.stdout || '').trim().split(/\r?\n/)[0] : null

  return {
    available: true,
    command,
    version,
    path: resolvedPath
  }
}

function addCandidate(candidates, seen, candidate) {
  if (!candidate) {
    return
  }

  const normalized = path.normalize(candidate)
  if (seen.has(normalized)) {
    return
  }

  seen.add(normalized)
  candidates.push(candidate)
}

function getPythonCandidates(rootDir) {
  const candidates = []
  const seen = new Set()
  const localCandidates = [
    path.join(rootDir, 'venv', 'Scripts', 'python.exe'),
    path.join(rootDir, '.venv', 'Scripts', 'python.exe')
  ]

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      addCandidate(candidates, seen, candidate)
    }
  }

  addCandidate(candidates, seen, 'python')

  const whereResult = runSync('where', ['python'])
  if (whereResult.status === 0) {
    for (const line of String(whereResult.stdout || '').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed) {
        addCandidate(candidates, seen, trimmed)
      }
    }
  }

  return candidates
}

function parseJsonLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch (error) {
      continue
    }
  }
  return null
}

function probePython(command) {
  const versionResult = runSync(command, ['--version'])
  if (versionResult.error || versionResult.status !== 0) {
    return {
      available: false,
      command,
      path: null,
      version: null,
      sqliteAvailable: false,
      numpyAvailable: false,
      cv2Available: false,
      visionReady: false
    }
  }

  const probeScript = [
    'import importlib.util',
    'import json',
    'import sys',
    "modules = {name: importlib.util.find_spec(name) is not None for name in ('sqlite3', 'numpy', 'cv2')}",
    "print(json.dumps({'executable': sys.executable, 'modules': modules}))"
  ].join('; ')

  const probeResult = runSync(command, ['-c', probeScript])
  const probeData = probeResult.error || probeResult.status !== 0 ? null : parseJsonLine(probeResult.stdout)
  const executablePath = probeData?.executable || null
  const modules = probeData?.modules || {}
  const resolvedCommand = executablePath || command

  return {
    available: true,
    command: resolvedCommand,
    path: executablePath || resolvedCommand,
    version: String(versionResult.stdout || versionResult.stderr || '').trim().split(/\r?\n/)[0] || null,
    sqliteAvailable: !!modules.sqlite3,
    numpyAvailable: !!modules.numpy,
    cv2Available: !!modules.cv2,
    visionReady: !!modules.numpy && !!modules.cv2
  }
}

function getPythonCapability(rootDir) {
  const candidates = getPythonCandidates(rootDir).map((candidate) => probePython(candidate))
  const availableCandidates = candidates.filter((candidate) => candidate.available)
  const sqliteCandidate = availableCandidates.find((candidate) => candidate.sqliteAvailable) || null
  const visionCandidate = availableCandidates.find((candidate) => candidate.visionReady) || null
  const preferredCandidate = visionCandidate || sqliteCandidate || availableCandidates[0] || null

  return {
    available: !!preferredCandidate,
    command: preferredCandidate?.command || null,
    path: preferredCandidate?.path || null,
    version: preferredCandidate?.version || null,
    sqliteAvailable: !!sqliteCandidate,
    numpyAvailable: !!preferredCandidate?.numpyAvailable,
    cv2Available: !!preferredCandidate?.cv2Available,
    visionReady: !!visionCandidate,
    sqliteCommand: sqliteCandidate?.command || null,
    visionCommand: visionCandidate?.command || null,
    candidates
  }
}

function getRuntimeCapabilities(rootDir = process.cwd()) {
  return {
    node: {
      available: true,
      command: process.execPath,
      version: process.version,
      path: process.execPath
    },
    python: getPythonCapability(rootDir),
    cpp: detectCommand('g++')
  }
}

module.exports = {
  getRuntimeCapabilities
}
