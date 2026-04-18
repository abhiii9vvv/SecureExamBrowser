const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const https = require('node:https')

class ModelService {
  constructor({ rootDir, database }) {
    this.rootDir = rootDir
    this.database = database
    this.registry = [
      {
        modelId: 'opencv-haarcascade-frontalface',
        family: 'opencv',
        version: 'master',
        githubUrl: 'https://github.com/opencv/opencv',
        sourceUrl: 'https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_default.xml',
        localRelativePath: path.join('assets', 'models', 'opencv', 'haarcascade_frontalface_default.xml'),
        minBytes: 1024
      },
      {
        modelId: 'opencv-zoo-yunet-face-detector',
        family: 'opencv-zoo',
        version: '2023mar',
        githubUrl: 'https://github.com/opencv/opencv_zoo',
        sourceUrl: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
        localRelativePath: path.join('assets', 'models', 'opencv_zoo', 'face_detection_yunet_2023mar.onnx'),
        minBytes: 100000
      },
      {
        modelId: 'opencv-zoo-sface-identity',
        family: 'opencv-zoo',
        version: '2021dec',
        githubUrl: 'https://github.com/opencv/opencv_zoo',
        sourceUrl: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx',
        localRelativePath: path.join('assets', 'models', 'opencv_zoo', 'face_recognition_sface_2021dec.onnx'),
        minBytes: 1000000
      },
      {
        modelId: 'silent-face-antispoof-miniFASNetV2',
        family: 'silent-face-anti-spoofing',
        version: 'main',
        githubUrl: 'https://github.com/minivision-ai/Silent-Face-Anti-Spoofing',
        sourceUrl: 'https://raw.githubusercontent.com/minivision-ai/Silent-Face-Anti-Spoofing/master/resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth',
        localRelativePath: path.join('assets', 'models', 'antispoof', '2.7_80x80_MiniFASNetV2.pth'),
        minBytes: 1000000
      },
      {
        modelId: 'silero-vad-onnx',
        family: 'audio-vad',
        version: 'master',
        githubUrl: 'https://github.com/snakers4/silero-vad',
        sourceUrl: 'https://raw.githubusercontent.com/snakers4/silero-vad/master/files/silero_vad.onnx',
        localRelativePath: path.join('assets', 'models', 'audio', 'silero_vad.onnx'),
        minBytes: 1000000
      },
      {
        modelId: 'silero-vad-jit',
        family: 'audio-vad',
        version: 'master',
        githubUrl: 'https://github.com/snakers4/silero-vad',
        sourceUrl: 'https://raw.githubusercontent.com/snakers4/silero-vad/master/files/silero_vad.jit',
        localRelativePath: path.join('assets', 'models', 'audio', 'silero_vad.jit'),
        minBytes: 1000000
      },
      {
        modelId: 'picovoice-porcupine-params',
        family: 'audio-keyword-spotting',
        version: 'master',
        githubUrl: 'https://github.com/Picovoice/porcupine',
        sourceUrl: 'https://raw.githubusercontent.com/Picovoice/porcupine/master/lib/common/porcupine_params.pv',
        localRelativePath: path.join('assets', 'models', 'audio', 'porcupine_params.pv'),
        minBytes: 1024
      }
    ]
  }

  resolveLocalPath(model) {
    return path.join(this.rootDir, model.localRelativePath)
  }

  ensureParentDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }

  calculateChecksum(filePath) {
    const hash = crypto.createHash('sha256')
    hash.update(fs.readFileSync(filePath))
    return hash.digest('hex')
  }

  isLikelyGitLfsPointer(filePath) {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 120)
    return head.includes('git-lfs.github.com/spec/v1')
  }

  getFileMetadata(model) {
    const localPath = this.resolveLocalPath(model)
    if (!fs.existsSync(localPath)) {
      return null
    }

    const stats = fs.statSync(localPath)
    const invalid = stats.size < model.minBytes || this.isLikelyGitLfsPointer(localPath)
    return {
      localPath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      checksum: invalid ? null : this.calculateChecksum(localPath),
      invalid
    }
  }

  downloadToFile(sourceUrl, destinationPath, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects while downloading model'))
        return
      }

      const request = https.get(sourceUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          this.downloadToFile(response.headers.location, destinationPath, redirectCount + 1)
            .then(resolve)
            .catch(reject)
          return
        }

        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`Download failed: HTTP ${response.statusCode}`))
          return
        }

        this.ensureParentDir(destinationPath)
        const stream = fs.createWriteStream(destinationPath)
        response.pipe(stream)

        stream.on('finish', () => stream.close(() => resolve()))
        stream.on('error', (error) => reject(error))
      })

      request.on('error', (error) => reject(error))
    })
  }

  async upsertAsset(model, details) {
    await this.database.upsertModelAsset({
      modelId: model.modelId,
      family: model.family,
      version: model.version,
      githubUrl: model.githubUrl,
      sourceUrl: model.sourceUrl,
      localPath: details.localPath,
      status: details.status,
      sizeBytes: details.sizeBytes || 0,
      checksum: details.checksum || null,
      syncedAt: details.syncedAt || null,
      errorMessage: details.errorMessage || null
    })
  }

  async sync(force = false) {
    const results = []

    for (const model of this.registry) {
      const localPath = this.resolveLocalPath(model)
      const metadata = this.getFileMetadata(model)
      if (metadata && !metadata.invalid && !force) {
        const ready = {
          modelId: model.modelId,
          localPath,
          sizeBytes: metadata.sizeBytes,
          checksum: metadata.checksum,
          syncedAt: metadata.modifiedAt,
          status: 'ready'
        }
        await this.upsertAsset(model, ready)
        results.push({ ...model, ...ready })
        continue
      }

      try {
        await this.downloadToFile(model.sourceUrl, localPath)
        const fresh = this.getFileMetadata(model)
        if (!fresh || fresh.invalid) {
          throw new Error('Downloaded file is invalid or appears to be a Git LFS pointer')
        }
        const downloaded = {
          modelId: model.modelId,
          localPath,
          sizeBytes: fresh.sizeBytes,
          checksum: fresh.checksum,
          syncedAt: fresh.modifiedAt,
          status: 'downloaded'
        }
        await this.upsertAsset(model, downloaded)
        results.push({ ...model, ...downloaded })
      } catch (error) {
        const failed = {
          modelId: model.modelId,
          localPath,
          sizeBytes: 0,
          checksum: null,
          syncedAt: null,
          status: 'failed',
          errorMessage: error.message
        }
        await this.upsertAsset(model, failed)
        results.push({ ...model, ...failed })
      }
    }

    return results
  }

  async getRegistryWithStatus() {
    const dbAssets = await this.database.getModelAssets().catch(() => [])
    const byId = new Map(dbAssets.map((asset) => [asset.model_id || asset.modelId, asset]))

    return this.registry.map((model) => {
      const metadata = this.getFileMetadata(model)
      const asset = byId.get(model.modelId)
      const status = metadata && !metadata.invalid ? (asset?.status || 'ready') : (asset?.status || 'missing')
      return {
        ...model,
        localPath: this.resolveLocalPath(model),
        sizeBytes: metadata && !metadata.invalid ? metadata.sizeBytes : 0,
        checksum: metadata && !metadata.invalid ? metadata.checksum : null,
        syncedAt: metadata && !metadata.invalid ? metadata.modifiedAt : (asset?.synced_at || null),
        status,
        available: !!(metadata && !metadata.invalid),
        errorMessage: asset?.error_message || null
      }
    })
  }

  async getVisionModelPaths() {
    const models = await this.getRegistryWithStatus()
    const getPath = (modelId) => models.find((item) => item.modelId === modelId && item.available)?.localPath || null
    return {
      detectorPath: getPath('opencv-zoo-yunet-face-detector'),
      recognizerPath: getPath('opencv-zoo-sface-identity'),
      fallbackCascadePath: getPath('opencv-haarcascade-frontalface')
    }
  }

  async getAudioModelPaths() {
    const models = await this.getRegistryWithStatus()
    const getPath = (modelId) => models.find((item) => item.modelId === modelId && item.available)?.localPath || null
    return {
      sileroVadOnnxPath: getPath('silero-vad-onnx'),
      sileroVadJitPath: getPath('silero-vad-jit'),
      porcupineParamsPath: getPath('picovoice-porcupine-params')
    }
  }
}

module.exports = {
  ModelService
}
