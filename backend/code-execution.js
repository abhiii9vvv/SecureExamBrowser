const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => deepEqual(a[key], b[key]))
  }
  return false
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs || 5000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut: false })
    })
  })
}

function ensureTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seb-run-'))
}

function isTransientCleanupError(error) {
  return error && ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)
}

function deferTempDirCleanup(tempDir) {
  fs.rm(tempDir, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 120
  }, () => {})
}

function cleanupTempDir(tempDir) {
  try {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 120
    })
  } catch (error) {
    if (isTransientCleanupError(error)) {
      deferTempDirCleanup(tempDir)
      return
    }

    if (error && error.code === 'ENOENT') {
      return
    }

    deferTempDirCleanup(tempDir)
  }
}

function normalizeTests(testCases, mode) {
  const relevant = mode === 'sample' ? testCases.filter((item) => !item.hidden) : testCases
  return relevant.map((testCase) => ({
    args: Object.keys(testCase.input || {}).map((key) => testCase.input[key]),
    input: testCase.input,
    expected: testCase.output,
    hidden: !!testCase.hidden,
    description: testCase.description || ''
  }))
}

function toCppType(value) {
  if (Array.isArray(value)) {
    const innerType = value.length > 0 ? toCppType(value[0]) : 'int'
    return `std::vector<${innerType}>`
  }
  if (typeof value === 'string') return 'std::string'
  if (typeof value === 'boolean') return 'bool'
  return 'int'
}

function escapeCppString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function toCppLiteral(value) {
  if (Array.isArray(value)) {
    const type = toCppType(value)
    return `${type}{${value.map((item) => toCppLiteral(item)).join(', ')}}`
  }
  if (typeof value === 'string') return `std::string("${escapeCppString(value)}")`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return `${value}`
}

function buildJavaScriptRunner(code, functionName, tests) {
  return `
const tests = ${JSON.stringify(tests)};
${code}

function __sebResolve() {
  if (typeof ${functionName} !== 'function') {
    throw new Error('Function ${functionName} not found');
  }
  return ${functionName};
}

(async () => {
  const fn = __sebResolve();
  const results = [];
  for (const test of tests) {
    const started = Date.now();
    try {
      const actual = await fn(...test.args);
      results.push({ ok: true, actual: typeof actual === 'undefined' ? null : actual, elapsedMs: Date.now() - started });
    } catch (error) {
      results.push({ ok: false, error: error && error.stack ? error.stack : String(error), elapsedMs: Date.now() - started });
    }
  }
  process.stdout.write(JSON.stringify({ results }));
})().catch((error) => {
  process.stderr.write(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`
}

function buildPythonRunner(code, functionName, tests) {
  const serialized = JSON.stringify(tests)
    .replace(/\\/g, '\\\\')
    .replace(/'''/g, "\\'\\'\\'")

  return `
import json
import time

TESTS = json.loads(r'''${serialized}''')

${code}

if not callable(globals().get('${functionName}')):
    raise RuntimeError('Function ${functionName} not found')

results = []
for test in TESTS:
    started = time.perf_counter()
    try:
        actual = globals()['${functionName}'](*test['args'])
        results.append({
            'ok': True,
            'actual': actual,
            'elapsedMs': int((time.perf_counter() - started) * 1000)
        })
    except Exception as exc:
        results.append({
            'ok': False,
            'error': str(exc),
            'elapsedMs': int((time.perf_counter() - started) * 1000)
        })

print(json.dumps({'results': results}))
`
}

function buildCppRunner(code, functionName, tests) {
  const blocks = tests.map((test) => {
    const args = test.args.map((value) => toCppLiteral(value)).join(', ')
    return `
    {
        auto started = std::chrono::steady_clock::now();
        try {
            auto actual = ${functionName}(${args});
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
            appendSuccess(toJson(actual), elapsed);
        } catch (const std::exception& error) {
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
            appendFailure(error.what(), elapsed);
        } catch (...) {
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
            appendFailure("Unknown C++ exception", elapsed);
        }
    }
`
  }).join('\n')

  return String.raw`
#include <bits/stdc++.h>
using namespace std;

${code}

string escapeJson(const string& value) {
    string out;
    for (char ch : value) {
        switch (ch) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += ch; break;
        }
    }
    return out;
}

template <typename T>
string toJson(const T& value) {
    std::ostringstream stream;
    stream << value;
    return stream.str();
}

string toJson(const string& value) {
    return "\"" + escapeJson(value) + "\"";
}

string toJson(const char* value) {
    return toJson(string(value));
}

string toJson(bool value) {
    return value ? "true" : "false";
}

template <typename T>
string toJson(const vector<T>& values) {
    string out = "[";
    for (size_t index = 0; index < values.size(); ++index) {
        if (index > 0) {
            out += ",";
        }
        out += toJson(values[index]);
    }
    out += "]";
    return out;
}

int main() {
    bool first = true;
    cout << "{\"results\":[";
    auto appendSuccess = [&](const string& actualJson, long long elapsedMs) {
        if (!first) cout << ",";
        first = false;
        cout << "{\"ok\":true,\"actual\":" << actualJson << ",\"elapsedMs\":" << elapsedMs << "}";
    };
    auto appendFailure = [&](const string& message, long long elapsedMs) {
        if (!first) cout << ",";
        first = false;
        cout << "{\"ok\":false,\"error\":\"" << escapeJson(message) << "\",\"elapsedMs\":" << elapsedMs << "}";
    };
${blocks}
    cout << "]}";
    return 0;
}
`
}

function summarizeResults(tests, executionResults) {
  const results = tests.map((test, index) => {
    const execution = executionResults[index] || { ok: false, error: 'Missing execution result', elapsedMs: 0 }
    const passed = execution.ok ? deepEqual(execution.actual, test.expected) : false
    return {
      passed,
      input: test.input,
      expectedOutput: test.expected,
      actualOutput: execution.ok ? execution.actual : null,
      error: execution.ok ? null : execution.error,
      hidden: test.hidden,
      description: test.description,
      executionTimeMs: execution.elapsedMs || 0
    }
  })

  return {
    status: results.every((item) => item.passed) ? 'Accepted' : 'Wrong Answer',
    allPassed: results.every((item) => item.passed),
    passedCount: results.filter((item) => item.passed).length,
    totalCount: results.length,
    totalTimeMs: results.reduce((sum, item) => sum + (item.executionTimeMs || 0), 0),
    results
  }
}

class CodeExecutionService {
  constructor({ database, runtimeCapabilities }) {
    this.database = database
    this.runtimeCapabilities = runtimeCapabilities
  }

  getPythonCommand() {
    return this.runtimeCapabilities?.python?.command || 'python'
  }

  getCppCommand() {
    return this.runtimeCapabilities?.cpp?.command || 'g++'
  }

  async runCode({ sessionId = null, questionId, language, code, mode }) {
    const normalizedLanguage = language === 'c++' ? 'cpp' : language
    const capabilityKey = normalizedLanguage === 'javascript' ? 'node' : normalizedLanguage === 'python' ? 'python' : 'cpp'
    const capability = this.runtimeCapabilities[capabilityKey]
    if (!capability || !capability.available) {
      return { success: false, error: `${language} runtime is not available on this machine.` }
    }

    const question = await this.database.getQuestionForExecution(questionId)
    const tests = normalizeTests(question.testCases || [], mode)
    if (!tests.length) {
      return { success: false, error: 'No test cases are available for this question.' }
    }

    const tempDir = ensureTempDir()
    let executionOutcome
    try {
      if (normalizedLanguage === 'javascript') {
        executionOutcome = await this.runJavaScript(tempDir, question, tests, code)
      } else if (normalizedLanguage === 'python') {
        executionOutcome = await this.runPython(tempDir, question, tests, code)
      } else {
        executionOutcome = await this.runCpp(tempDir, question, tests, code)
      }
    } finally {
      cleanupTempDir(tempDir)
    }

    if (!executionOutcome.success) {
      await this.database.saveCodeRun({
        sessionId,
        questionId,
        language: normalizedLanguage,
        mode,
        code,
        status: 'Error',
        passedCount: 0,
        totalCount: tests.length,
        totalTimeMs: 0,
        runtimeDetails: executionOutcome
      })
      return executionOutcome
    }

    const summary = summarizeResults(tests, executionOutcome.executionResults)
    await this.database.saveCodeRun({
      sessionId,
      questionId,
      language: normalizedLanguage,
      mode,
      code,
      status: summary.status,
      passedCount: summary.passedCount,
      totalCount: summary.totalCount,
      totalTimeMs: summary.totalTimeMs,
      runtimeDetails: summary
    })

    return { success: true, ...summary }
  }

  async runJavaScript(tempDir, question, tests, code) {
    const runnerPath = path.join(tempDir, 'runner.js')
    fs.writeFileSync(runnerPath, buildJavaScriptRunner(code, question.functionName, tests), 'utf8')
    return this.parseExecutionResult(await runProcess(process.execPath, [runnerPath], { cwd: tempDir, timeoutMs: 7000 }), 'JavaScript execution failed')
  }

  async runPython(tempDir, question, tests, code) {
    const runnerPath = path.join(tempDir, 'runner.py')
    fs.writeFileSync(runnerPath, buildPythonRunner(code, question.functionName, tests), 'utf8')
    return this.parseExecutionResult(await runProcess(this.getPythonCommand(), [runnerPath], { cwd: tempDir, timeoutMs: 7000 }), 'Python execution failed')
  }

  async runCpp(tempDir, question, tests, code) {
    const sourcePath = path.join(tempDir, 'runner.cpp')
    const executablePath = path.join(tempDir, 'runner.exe')
    fs.writeFileSync(sourcePath, buildCppRunner(code, question.functionName, tests), 'utf8')

    const compile = await runProcess(this.getCppCommand(), ['-std=c++17', '-O2', sourcePath, '-o', executablePath], { cwd: tempDir, timeoutMs: 20000 })
    if (compile.timedOut) {
      return {
        success: false,
        error: 'C++ compilation timed out.',
        details: {
          stage: 'compile',
          stderr: String(compile.stderr || '').trim(),
          stdout: String(compile.stdout || '').trim()
        }
      }
    }
    if (compile.code !== 0) {
      return {
        success: false,
        error: compile.stderr.trim() || 'C++ compilation failed.',
        details: {
          stage: 'compile',
          stderr: String(compile.stderr || '').trim(),
          stdout: String(compile.stdout || '').trim(),
          exitCode: compile.code
        }
      }
    }
    return this.parseExecutionResult(await runProcess(executablePath, [], { cwd: tempDir, timeoutMs: 7000 }), 'C++ execution failed')
  }

  parseExecutionResult(result, fallbackMessage) {
    if (result.timedOut) {
      return {
        success: false,
        error: 'Execution timed out.',
        details: {
          stderr: String(result.stderr || '').trim(),
          stdout: String(result.stdout || '').trim()
        }
      }
    }
    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr.trim() || fallbackMessage,
        details: {
          stderr: String(result.stderr || '').trim(),
          stdout: String(result.stdout || '').trim(),
          exitCode: result.code
        }
      }
    }
    try {
      const parsed = JSON.parse(result.stdout.trim())
      return { success: true, executionResults: parsed.results || [] }
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse execution output: ${result.stdout || result.stderr}`,
        details: {
          stderr: String(result.stderr || '').trim(),
          stdout: String(result.stdout || '').trim()
        }
      }
    }
  }
}

module.exports = {
  CodeExecutionService
}
