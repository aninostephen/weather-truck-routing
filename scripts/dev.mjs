import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BE_DIR = path.join(ROOT_DIR, 'be')
const FE_DIR = path.join(ROOT_DIR, 'fe')
const IS_WIN = process.platform === 'win32'

function resolvePythonBin() {
  const candidates = IS_WIN
    ? [
        path.join(BE_DIR, 'venv', 'Scripts', 'python.exe'),
        path.join(BE_DIR, '.venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(BE_DIR, 'venv', 'bin', 'python'),
        path.join(BE_DIR, '.venv', 'bin', 'python'),
      ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return IS_WIN ? 'python' : 'python3'
}

function prefixStream(stream, tag, ansiColor) {
  let remainder = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    const combined = remainder + chunk
    const lines = combined.split(/\r?\n/)
    remainder = lines.pop() ?? ''
    for (const line of lines) {
      if (line.length > 0) {
        process.stdout.write(`${ansiColor}[${tag}]\x1b[0m ${line}\n`)
      }
    }
  })
  stream.on('end', () => {
    if (remainder.length > 0) {
      process.stdout.write(`${ansiColor}[${tag}]\x1b[0m ${remainder}\n`)
    }
  })
}

const pythonBin = resolvePythonBin()

if (process.argv.includes('--test-be')) {
  const res = spawnSync(pythonBin, ['manage.py', 'test', 'tests', '-v', '2'], {
    cwd: BE_DIR,
    stdio: 'inherit',
  })
  process.exit(res.status ?? 1)
}

const viteEntry = path.join(FE_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(viteEntry)) {
  console.error('Frontend dependencies not found. Run `cd fe && npm install` first.')
  process.exit(1)
}

console.log('\x1b[36mStarting Backend (Django) + Frontend (Vite) from root...\x1b[0m')

const beProc = spawn(pythonBin, ['-u', 'manage.py', 'runserver'], {
  cwd: BE_DIR,
  env: { ...process.env, PYTHONUNBUFFERED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const feProc = spawn(process.execPath, [viteEntry], {
  cwd: FE_DIR,
  env: { ...process.env, FORCE_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

prefixStream(beProc.stdout, 'BE', '\x1b[36m')
prefixStream(beProc.stderr, 'BE', '\x1b[36m')
prefixStream(feProc.stdout, 'FE', '\x1b[32m')
prefixStream(feProc.stderr, 'FE', '\x1b[32m')

let shuttingDown = false

function killTree(child) {
  if (!child?.pid) {
    return
  }
  if (IS_WIN) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    })
  } else {
    child.kill('SIGTERM')
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  console.log('\nStopping BE & FE servers...')
  killTree(beProc)
  killTree(feProc)
  process.exit(exitCode)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

beProc.on('exit', (code) => {
  if (!shuttingDown && code !== 0) {
    console.error(`\x1b[31m[BE] exited with code ${code}\x1b[0m`)
    shutdown(code ?? 1)
  }
})

feProc.on('exit', (code) => {
  if (!shuttingDown && code !== 0) {
    console.error(`\x1b[31m[FE] exited with code ${code}\x1b[0m`)
    shutdown(code ?? 1)
  }
})

