import { createHash } from 'node:crypto'
import type { KnowledgeBaseDocumentSummary } from './types.js'

export const KNOWLEDGE_BASE_MEDIA_TYPE = 'application/vnd.betterlearn.knowledge-base+markdown' as const

const MAX_DOCUMENT_BYTES = 512 * 1024
const MAX_DOCUMENTS = 50
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_MS = 120_000

export type KnowledgeBaseSourceErrorCode =
  | 'KNOWLEDGE_BASE_UNAVAILABLE'
  | 'KNOWLEDGE_BASE_DOCUMENT_NOT_FOUND'
  | 'KNOWLEDGE_BASE_DOCUMENT_NOT_READY'
  | 'KNOWLEDGE_BASE_EMPTY'
  | 'KNOWLEDGE_BASE_TOO_LARGE'
  | 'KNOWLEDGE_BASE_READ_FAILED'
  | 'KNOWLEDGE_BASE_CHANGED'

export class KnowledgeBaseSourceError extends Error {
  readonly name = 'KnowledgeBaseSourceError'

  constructor(
    readonly code: KnowledgeBaseSourceErrorCode,
    readonly detail?: Record<string, number | string>,
  ) {
    super(code)
  }
}

/** 列表里的一项，对应知识库文档的元数据。 */
export type { KnowledgeBaseDocumentSummary }

export interface KnowledgeBaseDocument {
  docIds: string[]
  filename: string
  mediaType: typeof KNOWLEDGE_BASE_MEDIA_TYPE
  text: string
  contentDigest: string
  documentCount: number
  characterCount: number
  byteSize: number
}

export interface KnowledgeBaseImportParams {
  docIds: string[]
  expectedDigest: string
}

export interface KnowledgeBaseFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
}

interface KnowledgeBaseApiOptions {
  baseUrl: string
  token: string
  fetch?: KnowledgeBaseFetch
  timeoutMs?: number
}

interface ApiEnvelope {
  code: number
  message?: string
  data?: unknown
}

/**
 * 按与知识库文档之间约定的路径约定，把一个文件名整理成可读标题。
 * 保留原始文件名（含扩展名），便于审核时对照来源。
 */
function filenameFor(documents: readonly KnowledgeBaseDocumentSummary[]): string {
  if (documents.length === 1) return documents[0]!.fileName
  return `${documents[0]!.fileName} 等 ${documents.length} 篇知识库文档.md`
}

function documentBlock(document: KnowledgeBaseDocumentSummary, text: string): string {
  return `# ${document.fileName}\n\n${text}`
}

/**
 * 把多篇文档拼接成一份连续正文。
 *
 * 拼接用的是空行而不是任意字符，正文本身逐字保留，证据偏移量才能落在原文上。
 */
function joinDocuments(parts: readonly string[]): string {
  return parts.join('\n\n')
}

function isReady(status: unknown): status is 'ready' | 'uploaded' {
  return status === 'ready' || status === 'uploaded'
}

export class KnowledgeBaseSource {
  private readonly fetchImpl: KnowledgeBaseFetch
  private readonly timeoutMs: number

  constructor(private readonly options: KnowledgeBaseApiOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    const requested = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.timeoutMs = Math.min(Math.max(requested, 1_000), MAX_TIMEOUT_MS)
  }

  private async call(path: string, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${this.options.token}` },
        signal: combined,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_READ_FAILED')
    }
    const body = await response.json().catch(() => undefined) as ApiEnvelope | undefined
    if (!response.ok || body === undefined || typeof body !== 'object' || body.code !== 0) {
      if (response.status === 404) {
        throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_DOCUMENT_NOT_FOUND')
      }
      if (response.status === 401 || response.status === 403) {
        throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_UNAVAILABLE', {
          message: '知识库凭证无效，请检查 BetterLearn 的知识库配置。',
        })
      }
      throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_READ_FAILED')
    }
    return body.data
  }

  async list(signal?: AbortSignal): Promise<KnowledgeBaseDocumentSummary[]> {
    const data = await this.call('/api/v1/knowledge/documents', signal)
    const items = (data as { items?: unknown } | undefined)?.items
    if (!Array.isArray(items)) throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_READ_FAILED')
    return items
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
      .map((item): KnowledgeBaseDocumentSummary | null => {
        const docId = String(item.doc_id ?? '')
        const fileName = String(item.file_name ?? '')
        if (docId === '' || fileName === '') return null
        return {
          docId,
          fileName,
          fileType: String(item.file_type ?? ''),
          fileSize: typeof item.file_size === 'number' ? item.file_size : 0,
          status: item.status === 'uploaded' || item.status === 'ready' || item.status === 'failed' || item.status === 'processing'
            ? item.status
            : 'failed',
          chunkCount: typeof item.chunk_count === 'number' ? item.chunk_count : 0,
          ...(typeof item.error_message === 'string' ? { errorMessage: item.error_message } : {}),
          createdAt: String(item.created_at ?? ''),
        }
      })
      .filter((document): document is KnowledgeBaseDocumentSummary => document !== null)
      .slice(0, MAX_DOCUMENTS)
  }

  async read(docIds: readonly string[], signal?: AbortSignal): Promise<KnowledgeBaseDocument> {
    if (docIds.length === 0) throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_EMPTY')
    if (docIds.length > MAX_DOCUMENTS) {
      throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_TOO_LARGE', { documentCount: docIds.length })
    }
    const known = await this.list(signal)
    const byId = new Map(known.map(document => [document.docId, document]))
    const selected = docIds.map(docId => {
      const document = byId.get(docId)
      if (!document) throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_DOCUMENT_NOT_FOUND')
      if (!isReady(document.status)) {
        throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_DOCUMENT_NOT_READY', { docId })
      }
      return document
    })

    const parts: string[] = []
    let byteSize = 0
    for (const document of selected) {
      const data = await this.call(
        `/api/v1/knowledge/documents/${encodeURIComponent(document.docId)}/content`,
        signal,
      )
      const text = (data as { text?: unknown } | undefined)?.text
      if (typeof text !== 'string' || text.trim() === '') {
        throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_EMPTY', { docId: document.docId })
      }
      // 逐篇累计，超限时不再继续拉取后面的文档。
      byteSize += Buffer.byteLength(text, 'utf8')
      if (byteSize > MAX_DOCUMENT_BYTES) {
        throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_TOO_LARGE', {
          byteSize,
          limit: MAX_DOCUMENT_BYTES,
        })
      }
      parts.push(documentBlock(document, text))
    }

    const text = joinDocuments(parts)
    const encoded = Buffer.byteLength(text, 'utf8')
    if (encoded > MAX_DOCUMENT_BYTES) {
      throw new KnowledgeBaseSourceError('KNOWLEDGE_BASE_TOO_LARGE', {
        byteSize: encoded,
        limit: MAX_DOCUMENT_BYTES,
      })
    }
    return {
      docIds: [...docIds],
      filename: filenameFor(selected),
      mediaType: KNOWLEDGE_BASE_MEDIA_TYPE,
      text,
      contentDigest: createHash('sha256').update(text, 'utf8').digest('hex'),
      documentCount: selected.length,
      characterCount: text.length,
      byteSize: encoded,
    }
  }
}
