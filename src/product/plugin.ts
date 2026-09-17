import { isAbsolute } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { CoreSupervisor, type CoreSupervisorConfig } from './core-supervisor.js'
import { StructuredGenerationAdapter } from './generation-adapter.js'
import { GenerationCoordinator } from './generation-coordinator.js'
import { DshModelSelectionResolver, type ModelSelectionResolver } from './model-selection-resolver.js'
import { loadCandidateContract, type CandidateContract } from './contract.js'
import { registerProductRoutes, type ProductOperations } from './routes.js'
import {
  DshConversationSource,
  DshConversationSourceError,
} from './dsh-conversation-source.js'
import {
  KnowledgeBaseSource,
  KnowledgeBaseSourceError,
} from './knowledge-base-source.js'
import { QuizService, type QuizServicePort } from './quiz-service.js'
import { registerQuizRoutes } from './quiz-routes.js'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'

export const name = 'nobei-phase1c'
export const inject = ['agents', 'llm', 'sessionQuery', 'subprocess', 'tools', 'webServer', 'workflowEngine'] as const

export interface Config extends CoreSupervisorConfig {
  quizPythonExecutable?: string
  quizEnvFile?: string
  quizDataRoot?: string
  /** 本地知识库服务的基地址；未配置时知识库来源在界面上显示为未配置。 */
  knowledgeBaseBaseUrl?: string
  /** 读取本地知识库所用的 Bearer token。 */
  knowledgeBaseToken?: string
}
export type ProductPluginConfig = Config

const absolutePath = () => Schema.transform(Schema.string().required(), value => {
  if (!isAbsolute(value)) throw new Error('Expected an absolute path')
  return value
}).required()

// All three values belong to the local installation; no portable default exists.
export const Config: Schema<Config> = Schema.transform(Schema.object({
  pythonExecutable: absolutePath().description('Absolute path to the Python 3.12 executable.'),
  dataRoot: absolutePath().description('Absolute path to the initialized BetterLearn data directory.'),
  ownershipToken: Schema.string().min(32).pattern(/^[^\0]*$/).role('secret').required(),
  quizPythonExecutable: Schema.string(),
  quizEnvFile: Schema.string(),
  quizDataRoot: Schema.string(),
  // Optional: only needed when the local knowledge base is used as an import source.
  // Both live in the host config so the client never sees the token and cannot
  // point the reader at an arbitrary address.
  knowledgeBaseBaseUrl: Schema.string().pattern(/^https?:\/\/[^\s]+$/).description('Base URL of the local knowledge base service.'),
  knowledgeBaseToken: Schema.string().min(1).role('secret').description('Bearer token used to read the knowledge base.'),
}).required(), value => {
  const keys = Object.keys(value).filter(key => value[key as keyof typeof value] !== undefined)
  if (keys.some(key => !['dataRoot', 'knowledgeBaseBaseUrl', 'knowledgeBaseToken', 'ownershipToken', 'pythonExecutable', 'quizPythonExecutable', 'quizEnvFile', 'quizDataRoot'].includes(key))) {
    throw new Error('Unexpected BetterLearn configuration field')
  }
  const quizPaths = [value.quizPythonExecutable, value.quizEnvFile, value.quizDataRoot]
  if (quizPaths.some(path => path !== undefined) && !quizPaths.every(path => typeof path === 'string' && isAbsolute(path))) {
    throw new Error('All managed quiz paths must be absolute')
  }
  return value as Config
}).required()

export interface ProductPluginDependencies {
  packageRoot: string
  loadContract(packageRoot: string): CandidateContract
  createSupervisor(ctx: Context, config: ProductPluginConfig, contract: CandidateContract): CoreSupervisor
  createAdapter(ctx: Context, contract: CandidateContract, packageRoot: string): StructuredGenerationAdapter
  createModelSelectionResolver(ctx: Context): ModelSelectionResolver
  createConversationSource(query: SessionQueryEngine): DshConversationSource
  createQuizService(config: ProductPluginConfig, packageRoot: string): QuizServicePort | undefined
  registerQuizRoutes(ctx: Context, service?: QuizServicePort): () => void
  createKnowledgeBaseSource(config: ProductPluginConfig, service?: QuizServicePort): KnowledgeBaseSource | undefined
  createCoordinator(supervisor: CoreSupervisor, adapter: StructuredGenerationAdapter, resolver: ModelSelectionResolver): GenerationCoordinator
  registerRoutes(ctx: Context, state: { readonly state: CoreSupervisor['state'] }, operations: ProductOperations): () => void
}

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))

const defaultDependencies: ProductPluginDependencies = {
  packageRoot,
  loadContract: loadCandidateContract,
  createSupervisor: (ctx, config, contract) => new CoreSupervisor(
    ctx.subprocess,
    config,
    { schemaVersion: contract.schemaVersion, schemaSha256: contract.schemaSha256 },
  ),
  createAdapter: (ctx, contract, ownedPackageRoot) => new StructuredGenerationAdapter(
    ctx, contract, { packageRoot: ownedPackageRoot },
  ),
  createModelSelectionResolver: (ctx) => new DshModelSelectionResolver(ctx),
  createConversationSource: query => new DshConversationSource(query),
  createQuizService: (config, packageRoot) => config.quizPythonExecutable && config.quizEnvFile && config.quizDataRoot
    ? new QuizService({ pythonExecutable: config.quizPythonExecutable, envFile: config.quizEnvFile, dataRoot: config.quizDataRoot, packageRoot })
    : undefined,
  registerQuizRoutes,
  createKnowledgeBaseSource: (config, service) => service
    ? new KnowledgeBaseSource({ baseUrl: 'http://127.0.0.1', token: 'managed',
        fetch: (input, init) => service.request(new URL(String(input)).pathname.replace(/^\/api\/v1/, ''), { signal: init?.signal }) })
    : config.knowledgeBaseBaseUrl && config.knowledgeBaseToken
    ? new KnowledgeBaseSource({
      baseUrl: config.knowledgeBaseBaseUrl,
      token: config.knowledgeBaseToken,
    })
    : undefined,
  createCoordinator: (supervisor, adapter, resolver) => new GenerationCoordinator(
    supervisor, adapter, resolver,
  ),
  registerRoutes: registerProductRoutes,
}

async function disposeInOrder(actions: Array<() => void | Promise<void>>): Promise<void> {
  let firstError: unknown
  for (const action of actions) {
    try {
      await action()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
}

export async function applyProductPlugin(
  ctx: Context,
  config: ProductPluginConfig,
  dependencies: ProductPluginDependencies = defaultDependencies,
): Promise<() => Promise<void>> {
  try { config = Config(config) } catch { throw new Error('NOBEI_PHASE1C_CONFIG_INVALID') }
  const contract = dependencies.loadContract(dependencies.packageRoot)
  let supervisor: CoreSupervisor | undefined
  let coordinator: GenerationCoordinator | undefined
  let conversationSource: DshConversationSource | undefined
  // 缺少知识库配置时保持 undefined，来源卡片显示为未配置而不是报错。
  const quizService = dependencies.createQuizService(config, dependencies.packageRoot)
  const knowledgeBaseSource = quizService
    ? dependencies.createKnowledgeBaseSource(config, quizService)
    : dependencies.createKnowledgeBaseSource(config)

  const operations: ProductOperations = {
    previewDocument: (params, signal) => supervisor
      ? supervisor.withReadyClient((client) => client.previewDocument(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    previewDshConversations: async (sessionIds, signal) => {
      if (!conversationSource || !supervisor) throw new Error('CORE_UNAVAILABLE')
      const document = await conversationSource.read(sessionIds, signal)
      const preview = await supervisor.withReadyClient(client => client.previewDocument({
        filename: document.filename,
        mediaType: document.mediaType,
        text: document.text,
      }, signal))
      return { ...document, extractionPlan: preview.extractionPlan }
    },
    listKnowledgeBaseDocuments: async (signal) => {
      if (!knowledgeBaseSource) return { documents: [], configured: false }
      return { documents: await knowledgeBaseSource.list(signal), configured: true }
    },
    previewKnowledgeBase: async (docIds, signal) => {
      if (!knowledgeBaseSource || !supervisor) throw new Error('CORE_UNAVAILABLE')
      const document = await knowledgeBaseSource.read(docIds, signal)
      const preview = await supervisor.withReadyClient(client => client.previewDocument({
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
    watchRun: (runId, onChange) => coordinator!.watchRun(runId, onChange),
    getProgress: runId => coordinator!.getProgress(runId),
    launchImport: (params, signal) => coordinator
      ? coordinator.launchImport(params, signal)
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    importDshConversations: async (params, signal) => {
      if (!conversationSource || !coordinator) throw new Error('CORE_UNAVAILABLE')
      const document = await conversationSource.read(params.sessionIds, signal)
      const actual = Buffer.from(document.contentDigest, 'hex')
      const expected = Buffer.from(params.expectedDigest, 'hex')
      if (actual.length !== 32 || expected.length !== 32 || !timingSafeEqual(actual, expected)) {
        throw new DshConversationSourceError('DSH_CONVERSATION_CHANGED')
      }
      return coordinator.launchImport({
        filename: document.filename,
        mediaType: document.mediaType,
        text: document.text,
        modelSelection: params.modelSelection,
      }, signal)
    },
    launchRetry: (params, signal) => coordinator
      ? coordinator.launchRetry(params, signal)
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    importKnowledgeBase: async (params, signal) => {
      if (!knowledgeBaseSource || !coordinator) throw new Error('CORE_UNAVAILABLE')
      const document = await knowledgeBaseSource.read(params.docIds, signal)
      const actual = Buffer.from(document.contentDigest, 'hex')
      const expected = Buffer.from(params.expectedDigest, 'hex')
      if (actual.length !== 32 || expected.length !== 32 || !timingSafeEqual(actual, expected)) {
        throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_CHANGED')
      }
      return coordinator.launchImport({
        filename: document.filename,
        mediaType: document.mediaType,
        text: document.text,
        modelSelection: params.modelSelection,
      }, signal)
    },
    listRuns: signal => supervisor
      ? supervisor.withReadyClient((client) => client.listRuns(signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    getRun: (runId, signal) => supervisor
      ? supervisor.withReadyClient((client) => client.getRun({ runId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    listEvents: (runId, after, signal) => supervisor
      ? supervisor.withReadyClient((client) => client.listEvents({ runId, after }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    listCandidates: (runId, signal) => supervisor
      ? supervisor.withReadyClient((client) => client.listCandidates({ runId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    reviewCandidate: (params, signal) => supervisor
      ? supervisor.withReadyClient((client) => client.reviewCandidate(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    listKnowledgePoints: (runId, signal) => supervisor
      ? supervisor.withReadyClient((client) => client.listKnowledgePoints({ runId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    updateKnowledgePoint: (params, signal) => supervisor
      ? supervisor.withReadyClient((client) => client.updateKnowledgePoint(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    deleteRun: async (runId, signal) => {
      await coordinator!.terminateRun(runId)
      return supervisor
        ? supervisor.withReadyClient((client) => client.deleteRun({ runId }, signal))
        : Promise.reject(new Error('CORE_UNAVAILABLE'))
    },
    syncLearningCourse: (params, signal) => supervisor
      ? supervisor.withReadyClient(client => client.syncLearningCourse(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    getLearningCourse: (courseId, signal) => supervisor
      ? supervisor.withReadyClient(client => client.getLearningCourse({ courseId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    deleteLearningCourse: (courseId, signal) => supervisor
      ? supervisor.withReadyClient(client => client.deleteLearningCourse({ courseId }, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
    submitLearningAttempt: (params, signal) => supervisor
      ? supervisor.withReadyClient(client => client.submitLearningAttempt(params, signal))
      : Promise.reject(new Error('CORE_UNAVAILABLE')),
  }
  const state = {
    get state(): CoreSupervisor['state'] {
      return supervisor?.state ?? 'STARTING'
    },
  }

  let unregisterQuizRoutes: (() => void) | undefined
  let unregisterRoutes: (() => void) | undefined
  let disposePromise: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    disposePromise ??= disposeInOrder([
      () => { unregisterRoutes?.(); unregisterRoutes = undefined },
      () => { unregisterQuizRoutes?.(); unregisterQuizRoutes = undefined },
      () => coordinator?.dispose(),
      () => supervisor?.dispose(),
      () => quizService?.dispose(),
    ])
    return disposePromise
  }

  try {
    conversationSource = dependencies.createConversationSource(ctx.sessionQuery)
    unregisterQuizRoutes = dependencies.registerQuizRoutes(ctx, quizService)
    unregisterRoutes = dependencies.registerRoutes(ctx, state, operations)
    supervisor = dependencies.createSupervisor(ctx, config, contract)
    const adapter = dependencies.createAdapter(ctx, contract, dependencies.packageRoot)
    const resolver = dependencies.createModelSelectionResolver(ctx)
    coordinator = dependencies.createCoordinator(supervisor, adapter, resolver)
    await supervisor.start()
    // Quiz configuration failures must not take down existing knowledge extraction.
    // A later quiz request retries startup and returns an actionable error.
    void quizService?.start().catch(() => undefined)
    return dispose
  } catch (error) {
    await dispose().catch(() => undefined)
    throw error
  }
}

export function apply(ctx: Context, config: ProductPluginConfig): Promise<() => Promise<void>> {
  return applyProductPlugin(ctx, config)
}
