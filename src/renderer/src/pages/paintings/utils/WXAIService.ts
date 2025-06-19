import { CacheService } from '@renderer/services/CacheService'
import { FileType, WXAIPainting } from '@renderer/types'

import type { WXAIModel } from '../config/wxaiConfig'

export interface WXAIGenerationRequest {
  model: string
  input: {
    prompt: string
    [key: string]: any
  }
}

export interface WXAIGenerationResponse {
  success: boolean
  data?: {
    id: string
    status: string
    images?: Array<{ url: string }>
  }
  message?: string
}

export interface WXAIModelsResponse {
  success: boolean
  data?: WXAIModel[]
  message?: string
}

export class WXAIService {
  private apiHost: string
  private apiKey: string

  constructor(apiHost: string, apiKey: string) {
    this.apiHost = apiHost
    this.apiKey = apiKey
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(errorData.message || `HTTP ${response.status}: Request failed`)
    }
    return response.json()
  }

  /**
   * Fetch available models from WXAI API
   */
  async fetchModels(): Promise<WXAIModel[]> {
    const cacheKey = `wxai_models_${this.apiHost}`

    // Check cache first
    const cachedModels = CacheService.get<WXAIModel[]>(cacheKey)
    if (cachedModels) {
      return cachedModels
    }

    const response = await fetch(`${this.apiHost}/v1/images/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    })

    const data: WXAIModelsResponse = await this.handleResponse(response)

    if (!data.success || !data.data) {
      throw new Error('Failed to fetch models')
    }

    // Cache for 60 minutes (3,600,000 milliseconds)
    CacheService.set(cacheKey, data.data, 60 * 60 * 1000)

    return data.data
  }

  /**
   * Create a new generation request
   */
  async createGeneration(request: WXAIGenerationRequest, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.apiHost}/v1/images/generations`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
      signal
    })

    const data: WXAIGenerationResponse = await this.handleResponse(response)

    if (!data.success || !data.data?.id) {
      throw new Error(data.message || 'Failed to create generation')
    }

    return data.data.id
  }

  /**
   * Get generation status and result
   */
  async getGeneration(generationId: string): Promise<WXAIGenerationResponse['data']> {
    const response = await fetch(`${this.apiHost}/v1/images/generations/${generationId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    })

    const data: WXAIGenerationResponse = await this.handleResponse(response)

    if (!data.success) {
      throw new Error(data.message || 'Failed to get generation')
    }

    return data.data
  }

  /**
   * Download images from URLs and convert to FileType
   */
  async downloadImages(urls: string[]): Promise<FileType[]> {
    const files: FileType[] = []

    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (!response.ok) continue

        const blob = await response.blob()
        const arrayBuffer = await blob.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        const fileName = `wxai_${Date.now()}_${Math.random().toString(36).substring(7)}.png`
        const filePath = await window.api.file.save(fileName, buffer)

        if (filePath) {
          const fileStats = await window.api.file.getStats(filePath)
          const file: FileType = {
            id: `wxai_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: fileName,
            origin_name: fileName,
            path: filePath,
            size: fileStats?.size || buffer.length,
            ext: 'png',
            type: 'image',
            created_at: new Date().toISOString(),
            count: 0
          }
          files.push(file)
        }
      } catch (error) {
        console.error('Failed to download image:', error)
      }
    }

    return files
  }

  /**
   * Poll for generation result with automatic retry logic
   */
  async pollGenerationResult(
    generationId: string,
    options: {
      onStatusUpdate?: (updates: Partial<WXAIPainting>) => void
      maxRetries?: number
      timeoutMs?: number
      intervalMs?: number
    } = {}
  ): Promise<WXAIGenerationResponse['data']> {
    const {
      onStatusUpdate,
      maxRetries = 10,
      timeoutMs = 120000, // 2 minutes
      intervalMs = 2000
    } = options

    const startTime = Date.now()
    let retryCount = 0

    while (retryCount < maxRetries && Date.now() - startTime < timeoutMs) {
      try {
        const result = await this.getGeneration(generationId)

        if (result) {
          if (onStatusUpdate) {
            onStatusUpdate({ status: result.status as any })
          }

          if (result.status === 'succeeded') {
            return result
          }

          if (result.status === 'failed' || result.status === 'cancelled') {
            throw new Error(`Generation ${result.status}`)
          }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs))
        retryCount++
      } catch (error) {
        if (retryCount >= maxRetries - 1) {
          throw error
        }
        retryCount++
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }
    }

    throw new Error('Generation timeout or max retries exceeded')
  }

  /**
   * Create generation and poll for result in one call
   */
  async generateAndWait(
    request: WXAIGenerationRequest,
    options: {
      onStatusUpdate?: (updates: Partial<WXAIPainting>) => void
      signal?: AbortSignal
      maxRetries?: number
      timeoutMs?: number
      intervalMs?: number
    } = {}
  ): Promise<WXAIGenerationResponse['data']> {
    const { signal, onStatusUpdate, ...pollOptions } = options
    const generationId = await this.createGeneration(request, signal)
    if (onStatusUpdate) {
      onStatusUpdate({ generationId })
    }
    return this.pollGenerationResult(generationId, { ...pollOptions, onStatusUpdate })
  }
}

export default WXAIService
