const { spawn } = require('node:child_process')
const path = require('node:path')
const { nativeImage } = require('electron')

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function averageAbsoluteDifference(left, right) {
  if (!left || !right || left.length !== right.length) {
    return 0
  }

  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index] - right[index])
  }
  return total / left.length
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) {
    return 0
  }

  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

function normalizeVisionPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  const normalized = { ...payload }
  if (!normalized.image && typeof normalized.frame === 'string') {
    normalized.image = normalized.frame
  }
  return normalized
}

function buildDescriptorFromDataUrl(image) {
  if (typeof image !== 'string' || image.trim().length === 0) {
    throw new Error('Invalid frame payload')
  }

  let frame
  try {
    frame = nativeImage.createFromDataURL(image)
  } catch (_error) {
    throw new Error('Invalid frame payload')
  }

  if (frame.isEmpty()) {
    throw new Error('Unable to decode verification frame')
  }

  const { width, height } = frame.getSize()
  const bitmap = frame.toBitmap()
  const gridSize = 8
  const grid = new Array(gridSize * gridSize).fill(0)
  const counts = new Array(gridSize * gridSize).fill(0)
  const stepX = Math.max(1, Math.floor(width / 80))
  const stepY = Math.max(1, Math.floor(height / 80))
  const centerLeft = Math.floor(width * 0.25)
  const centerRight = Math.floor(width * 0.75)
  const centerTop = Math.floor(height * 0.18)
  const centerBottom = Math.floor(height * 0.82)

  let sum = 0
  let sumSquares = 0
  let samples = 0
  let centerSum = 0
  let centerSamples = 0

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const offset = ((y * width) + x) * 4
      const blue = bitmap[offset]
      const green = bitmap[offset + 1]
      const red = bitmap[offset + 2]
      const luminance = (red * 0.299) + (green * 0.587) + (blue * 0.114)

      sum += luminance
      sumSquares += luminance * luminance
      samples += 1

      if (x >= centerLeft && x <= centerRight && y >= centerTop && y <= centerBottom) {
        centerSum += luminance
        centerSamples += 1
      }

      const gridX = Math.min(gridSize - 1, Math.floor((x / Math.max(width, 1)) * gridSize))
      const gridY = Math.min(gridSize - 1, Math.floor((y / Math.max(height, 1)) * gridSize))
      const gridIndex = (gridY * gridSize) + gridX
      grid[gridIndex] += luminance
      counts[gridIndex] += 1
    }
  }

  const mean = samples ? sum / samples : 0
  const variance = samples ? Math.max(0, (sumSquares / samples) - (mean * mean)) : 0
  const stdDev = Math.sqrt(variance)
  const centerMean = centerSamples ? centerSum / centerSamples : mean
  const averagedGrid = grid.map((value, index) => counts[index] ? value / counts[index] : mean)
  const normalizedGrid = averagedGrid.map((value) => (value - mean) / Math.max(stdDev, 1))
  const brightnessScore = clamp(1 - (Math.abs(mean - 128) / 128))
  const contrastScore = clamp(stdDev / 64)
  const centerScore = clamp(1 - (Math.abs(centerMean - mean) / 96))
  const faceConfidence = clamp((brightnessScore * 0.35) + (contrastScore * 0.45) + (centerScore * 0.2))
  const faceDetected = mean > 28 && stdDev > 14 && faceConfidence >= 0.42
  const bbox = [
    Math.round(width * 0.24),
    Math.round(height * 0.14),
    Math.round(width * 0.76),
    Math.round(height * 0.86)
  ]

  return {
    width,
    height,
    mean,
    stdDev,
    averagedGrid,
    normalizedGrid,
    faceConfidence,
    faceDetected,
    bbox
  }
}

function isVisionWorkerInfrastructureError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  if (!message) {
    return true
  }

  const infraMarkers = [
    'econn',
    'broken pipe',
    'stdin',
    'stdout',
    'spawn',
    'terminated',
    'stopped with code',
    'python',
    'traceback',
    'vision worker unavailable',
    'no python runtime is available'
  ]

  return infraMarkers.some((marker) => message.includes(marker))
}

class VisionService {
  constructor({ rootDir, pythonCommand = null }) {
    this.rootDir = rootDir
    this.pythonCommand = pythonCommand
    this.workerPath = path.join(rootDir, 'backend', 'python', 'vision_worker.py')
    this.process = null
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.workerUnavailableReason = pythonCommand ? null : 'No Python runtime is available for the vision worker.'
    this.stderrLines = []
    this.loggedFallback = false
    this.referenceDescriptor = null
    this.lastDescriptor = null
    this.modelPaths = null
    this.disposed = false
  }

  noteFallback(reason) {
    if (reason && !this.workerUnavailableReason) {
      this.workerUnavailableReason = reason
    }
    if (!this.loggedFallback) {
      const message = this.workerUnavailableReason || 'Vision worker unavailable. Using heuristic fallback.'
      console.warn(`[vision-service] ${message}`)
      this.loggedFallback = true
    }
  }

  start() {
    if (this.process || this.workerUnavailableReason || !this.pythonCommand) {
      return
    }

    this.disposed = false
    this.stderrLines = []
    this.process = spawn(this.pythonCommand, [this.workerPath], {
      cwd: this.rootDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.process.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString()
      this.flushBuffer()
    })

    this.process.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim()
      if (message) {
        this.stderrLines.push(message)
        this.stderrLines = this.stderrLines.slice(-10)
        console.warn('[vision-worker]', message)
      }
    })

    this.process.on('error', (error) => {
      this.markWorkerUnavailable(error.message)
    })

    this.process.on('exit', (code, signal) => {
      const reason = this.disposed
        ? 'Vision worker stopped'
        : this.stderrLines[this.stderrLines.length - 1] || `Vision worker stopped with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`
      const error = new Error(reason)

      if (!this.disposed) {
        this.markWorkerUnavailable(reason)
      }

      for (const pending of this.pending.values()) {
        pending.reject(error)
      }
      this.pending.clear()
      this.process = null
    })
  }

  markWorkerUnavailable(reason) {
    this.workerUnavailableReason = reason || this.workerUnavailableReason || 'Vision worker unavailable'
    this.noteFallback(this.workerUnavailableReason)
    if (this.process) {
      this.process.removeAllListeners()
      this.process = null
    }
  }

  flushBuffer() {
    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const raw = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (raw) {
        let message = null
        try {
          message = JSON.parse(raw)
        } catch (error) {
          continue
        }
        const pending = this.pending.get(message.id)
        if (pending) {
          this.pending.delete(message.id)
          if (message.success) {
            pending.resolve(message.data)
          } else {
            pending.reject(new Error(message.error || 'Vision worker error'))
          }
        }
      }
      newlineIndex = this.buffer.indexOf('\n')
    }
  }

  send(action, payload = {}) {
    if (this.workerUnavailableReason) {
      return Promise.reject(new Error(this.workerUnavailableReason))
    }

    this.start()
    if (!this.process) {
      return Promise.reject(new Error(this.workerUnavailableReason || 'Vision worker unavailable'))
    }

    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      const message = `${JSON.stringify({ id, action, payload })}\n`
      this.process.stdin.write(message, (error) => {
        if (error) {
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }

  buildFallbackIdentityMatch(descriptor) {
    if (!this.referenceDescriptor || !descriptor.faceDetected) {
      return {
        score: 0,
        threshold: 0.58,
        match: false
      }
    }

    const cosine = cosineSimilarity(this.referenceDescriptor.normalizedGrid, descriptor.normalizedGrid)
    const score = clamp((cosine + 1) / 2)
    return {
      score,
      threshold: 0.58,
      match: score >= 0.58
    }
  }

  buildFallbackLiveness(descriptor) {
    const motionDelta = averageAbsoluteDifference(this.lastDescriptor?.averagedGrid, descriptor.averagedGrid)
    const motionScore = clamp((motionDelta / 18) * 2)
    const isLive = descriptor.faceDetected && motionScore >= 0.08
    return {
      is_live: isLive,
      motion_score: motionScore,
      eyes_detected: descriptor.faceDetected ? (descriptor.faceConfidence >= 0.6 ? 2 : 1) : 0,
      blink_score: 0
    }
  }

  async initModels(payload) {
    this.modelPaths = payload
    if (this.workerUnavailableReason) {
      this.noteFallback(this.workerUnavailableReason)
      return {
        initialized: false,
        fallback: true,
        reason: this.workerUnavailableReason
      }
    }

    try {
      return await this.send('init_models', payload)
    } catch (error) {
      this.markWorkerUnavailable(error.message)
      return {
        initialized: false,
        fallback: true,
        reason: this.workerUnavailableReason
      }
    }
  }

  async ping() {
    if (this.workerUnavailableReason) {
      return { ok: true, fallback: true, reason: this.workerUnavailableReason }
    }

    try {
      return await this.send('ping', {})
    } catch (error) {
      this.markWorkerUnavailable(error.message)
      return { ok: true, fallback: true, reason: this.workerUnavailableReason }
    }
  }

  async enrollIdentity(payload) {
    const normalizedPayload = normalizeVisionPayload(payload)
    const requireMl = Boolean(normalizedPayload.requireMl)

    if (requireMl && this.workerUnavailableReason) {
      throw new Error(`ML verification unavailable: ${this.workerUnavailableReason}`)
    }

    if (!this.workerUnavailableReason) {
      try {
        return await this.send('enroll_identity', normalizedPayload)
      } catch (error) {
        if (isVisionWorkerInfrastructureError(error)) {
          this.markWorkerUnavailable(error.message)
          if (requireMl) {
            throw new Error(`ML verification unavailable: ${this.workerUnavailableReason || error.message}`)
          }
        } else if (requireMl) {
          throw error
        }
      }
    }

    if (requireMl) {
      throw new Error(`ML verification unavailable: ${this.workerUnavailableReason || 'vision worker unavailable'}`)
    }

    const descriptor = buildDescriptorFromDataUrl(normalizedPayload.image)
    if (!descriptor.faceDetected) {
      if (this.workerUnavailableReason) {
        this.noteFallback(this.workerUnavailableReason)
      }
      this.lastDescriptor = descriptor
      return {
        success: false,
        has_reference: !!this.referenceDescriptor,
        fallback: true,
        engine: 'heuristic-fallback',
        error: 'Unable to enroll identity. Please center your face and improve the lighting.'
      }
    }

    this.referenceDescriptor = descriptor
    this.lastDescriptor = descriptor
    if (this.workerUnavailableReason) {
      this.noteFallback(this.workerUnavailableReason)
    }

    return {
      success: true,
      has_reference: true,
      fallback: true,
      engine: 'heuristic-fallback'
    }
  }

  async verifyFrame(payload) {
    const normalizedPayload = normalizeVisionPayload(payload)
    const requireMl = Boolean(normalizedPayload.requireMl)

    if (requireMl && this.workerUnavailableReason) {
      throw new Error(`ML verification unavailable: ${this.workerUnavailableReason}`)
    }

    if (!this.workerUnavailableReason) {
      try {
        return await this.send('verify_frame', normalizedPayload)
      } catch (error) {
        if (isVisionWorkerInfrastructureError(error)) {
          this.markWorkerUnavailable(error.message)
          if (requireMl) {
            throw new Error(`ML verification unavailable: ${this.workerUnavailableReason || error.message}`)
          }
        } else if (requireMl) {
          throw error
        }
      }
    }

    if (requireMl) {
      throw new Error(`ML verification unavailable: ${this.workerUnavailableReason || 'vision worker unavailable'}`)
    }

    const descriptor = buildDescriptorFromDataUrl(normalizedPayload.image)
    const identityMatch = this.buildFallbackIdentityMatch(descriptor)
    const liveness = this.buildFallbackLiveness(descriptor)
    const result = {
      fallback: true,
      engine: 'heuristic-fallback',
      reason: this.workerUnavailableReason,
      face_count: descriptor.faceDetected ? 1 : 0,
      faces: descriptor.faceDetected ? [{ bbox: descriptor.bbox, confidence: descriptor.faceConfidence }] : [],
      confidence: descriptor.faceConfidence,
      identity_match: identityMatch,
      liveness,
      has_reference: !!this.referenceDescriptor
    }

    this.lastDescriptor = descriptor
    if (this.workerUnavailableReason) {
      this.noteFallback(this.workerUnavailableReason)
    }
    return result
  }

  dispose() {
    this.disposed = true
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }
}

module.exports = {
  VisionService
}
