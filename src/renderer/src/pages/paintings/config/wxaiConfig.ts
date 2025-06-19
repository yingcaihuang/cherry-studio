import type { WXAIPainting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export interface WXAIModel {
  id: string
  name: string
  model_provider: string
  description: string
  tags: string[]
  pricing: any
  input_schema: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
}

export const DEFAULT_WXAI_PAINTING: WXAIPainting = {
  id: uuid(),
  model: '',
  prompt: '',
  inputParams: {},
  status: 'starting',
  generationId: undefined,
  urls: [],
  files: []
}
