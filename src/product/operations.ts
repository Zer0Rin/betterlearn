import { timingSafeEqual } from 'node:crypto'
import type { CoreSupervisor } from './core-supervisor.js'
import type { GenerationCoordinator } from './generation-coordinator.js'
import type { DshConversationPreview } from './types.js'
interface ConversationSource { read(ids: readonly string[], signal?: AbortSignal): Promise<Omit<DshConversationPreview, 'extractionPlan'>> }
import { DshConversationSourceError } from './conversation-error.js'
import { KnowledgeBaseSourceError, type KnowledgeBaseSource } from './knowledge-base-source.js'
import type { ProductOperations } from './routes.js'

export function createProductOperations(ports: {
 readonly supervisor: CoreSupervisor | undefined
 readonly coordinator: GenerationCoordinator | undefined
 readonly conversationSource?: ConversationSource
 readonly knowledgeBaseSource?: KnowledgeBaseSource
}): ProductOperations {
  return {
    previewDocument: (params, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient((client) => client.previewDocument(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    previewDshConversations: async (sessionIds, signal) => {
      if (!ports.conversationSource || !ports.supervisor) throw new Error('CORE_UNAVAILABLE')
      const document = await ports.conversationSource.read(sessionIds, signal)
      const preview = await ports.supervisor.withReadyClient(client => client.previewDocument({
        filename: document.filename,
        mediaType: document.mediaType,
        text: document.text,
      }, signal))
      return { ...document, extractionPlan: preview.extractionPlan }
    },
    listKnowledgeBaseDocuments: async (signal) => {
      if (!ports.knowledgeBaseSource) return { documents: [], configured: false }
      return { documents: await ports.knowledgeBaseSource.list(signal), configured: true }
    },
    previewKnowledgeBase: async (docIds, signal) => {
      if (!ports.knowledgeBaseSource || !ports.supervisor) throw new Error('CORE_UNAVAILABLE')
      const document = await ports.knowledgeBaseSource.read(docIds, signal)
      const preview = await ports.supervisor.withReadyClient(client => client.previewDocument({
        filename: document.filename,
        mediaType: document.mediaType,
        text: document.text,
      }, signal))
      return {
        docIds: document.docIds,
        filename: document.filename,
        mediaType: document.mediaType,
        text: document.text,
        contentDigest: document.contentDigest,
        documentCount: document.documentCount,
        characterCount: document.characterCount,
        byteSize: document.byteSize,
        extractionPlan: preview.extractionPlan,
      }
    },
    watchRun: (runId, onChange) => ports.coordinator!.watchRun(runId, onChange),
    getProgress: runId => ports.coordinator!.getProgress(runId),
    launchImport: (params, signal) => ports.coordinator
      ? ports.coordinator.launchImport(params, signal)
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    importDshConversations: async (params, signal) => {
      if (!ports.conversationSource || !ports.coordinator) throw new Error('CORE_UNAVAILABLE')
      const document = await ports.conversationSource.read(params.sessionIds, signal)
      const actual = Buffer.from(document.contentDigest, 'hex')
      const expected = Buffer.from(params.expectedDigest, 'hex')
      if (actual.length !== 32 || expected.length !== 32 || !timingSafeEqual(actual, expected)) {
        throw new DshConversationSourceError('DSH_CONVERSATION_CHANGED')
      }
      return ports.coordinator.launchImport({
        filename: document.filename,
        mediaType: document.mediaType,
        text: document.text,
        modelSelection: params.modelSelection,
      }, signal)
    },
    launchRetry: (params, signal) => ports.coordinator
      ? ports.coordinator.launchRetry(params, signal)
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    importKnowledgeBase: async (params, signal) => {
      if (!ports.knowledgeBaseSource || !ports.coordinator) throw new Error('CORE_UNAVAILABLE')
      const document = await ports.knowledgeBaseSource.read(params.docIds, signal)
      const actual = Buffer.from(document.contentDigest, 'hex')
      const expected = Buffer.from(params.expectedDigest, 'hex')
      if (actual.length !== 32 || expected.length !== 32 || !timingSafeEqual(actual, expected)) {
        throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_CHANGED')
      }
      return ports.coordinator.launchImport({
        filename: document.filename,
        mediaType: document.mediaType,
        text: document.text,
        modelSelection: params.modelSelection,
      }, signal)
    },
    listRuns: signal => ports.supervisor
      ? ports.supervisor.withReadyClient((client) => client.listRuns(signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    getRun: (runId, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient((client) => client.getRun({ runId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    listEvents: (runId, after, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient((client) => client.listEvents({ runId, after }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    listCandidates: (runId, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient((client) => client.listCandidates({ runId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    reviewCandidate: (params, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient((client) => client.reviewCandidate(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    listKnowledgePoints: (runId, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient((client) => client.listKnowledgePoints({ runId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    updateKnowledgePoint: (params, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient((client) => client.updateKnowledgePoint(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    deleteRun: async (runId, signal) => {
      await ports.coordinator!.terminateRun(runId)
      return ports.supervisor
        ? ports.supervisor.withReadyClient((client) => client.deleteRun({ runId }, signal))
        : Promise.reject(new Error('CORE_UNAVAILABLE'))
    },
    syncLearningCourse: (params, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient(client => client.syncLearningCourse(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    getLearningCourse: (courseId, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient(client => client.getLearningCourse({ courseId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    deleteLearningCourse: (courseId, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient(client => client.deleteLearningCourse({ courseId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    submitLearningAttempt: (params, signal) => ports.supervisor
      ? ports.supervisor.withReadyClient(client => client.submitLearningAttempt(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
  }
}
