export const DSH_CONVERSATION_MEDIA_TYPE = 'application/vnd.betterlearn.dsh-conversation+markdown' as const

export type DshConversationSourceErrorCode =
  | 'DSH_CONVERSATION_NOT_FOUND'
  | 'DSH_CONVERSATION_NOT_ORDINARY'
  | 'DSH_CONVERSATION_EMPTY'
  | 'DSH_CONVERSATION_TOO_LARGE'
  | 'DSH_CONVERSATION_READ_FAILED'
  | 'DSH_CONVERSATION_CHANGED'

export class DshConversationSourceError extends Error {
  readonly name = 'DshConversationSourceError'

  constructor(
    readonly code: DshConversationSourceErrorCode,
    readonly detail?: Record<string, number>,
  ) {
    super(code)
  }
}

