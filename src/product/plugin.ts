import { createProductOperations } from './operations.js'
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
  registerQuizRoutes(ctx: Context, service?: QuizServicePort, sourceResolver?: Pick<ProductOperations, 'getLearningCourse'>): () => void
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

  const operations = createProductOperations({
    get supervisor() { return supervisor }, get coordinator() { return coordinator },
    get conversationSource() { return conversationSource }, knowledgeBaseSource,
  })

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
    unregisterQuizRoutes = dependencies.registerQuizRoutes(ctx, quizService, operations)
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
