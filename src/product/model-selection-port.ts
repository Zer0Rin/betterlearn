import type { ModelSelectionSnapshot } from './types.js'
export interface ModelSelectionResolver {
  resolve(selection: ModelSelectionSnapshot, signal?: AbortSignal): Promise<ModelSelectionSnapshot>
}

export class ModelSelectionResolutionError extends Error {
  readonly code = 'MODEL_SELECTION_INVALID'

  constructor() {
    super('MODEL_SELECTION_INVALID')
    this.name = 'ModelSelectionResolutionError'
  }
}

