import type { AttemptAnswers, PracticeAttempt } from '../types.js'
import type { QuizApi } from './contracts.js'

export type PracticeStorage = Pick<Storage, 'getItem' | 'setItem'>
type Selection = AttemptAnswers['answer_records'][number]
type Pending = { kind: 'save' | 'submit'; input: AttemptAnswers }
interface Pointer { attemptId?: string; requestId?: string }
export interface PracticeState {
  attempt?: PracticeAttempt
  pending?: Pending
  busy: boolean
  ready: boolean
  error: string
  conflict: boolean
}
const message = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试'
const currentKey = (id: string) => `betterlearn:quiz:current:${id}`
const pendingKey = (id: string) => `betterlearn:quiz:pending:${id}`
const selections = (records: Selection[]) => records.map(({ question_id, selected_answers, duration_ms }) => ({ question_id, selected_answers: [...selected_answers], duration_ms }))
const digest = (records: Selection[]) => JSON.stringify(selections(records).map(r => ({ ...r, selected_answers: [...r.selected_answers].sort() })).sort((a,b)=>a.question_id.localeCompare(b.question_id)))
function read<T>(storage: PracticeStorage, key: string): T | undefined {
  const value = storage.getItem(key)
  return value ? JSON.parse(value) ?? undefined : undefined
}

/** One writer per panel session. Pending payloads are durable before any mutation. */
export class PracticeController {
  state: PracticeState = { busy:false, ready:false, error:'', conflict:false }
  private listeners = new Set<() => void>()
  private pointer: Pointer
  private readonly isCurrent: boolean
  constructor(private api: QuizApi, private storage: PracticeStorage, readonly quizId: string, attemptId?: string, private options: { pointerKey?: string; createNew?: boolean } = {}) {
    this.isCurrent = !attemptId
    try { this.pointer = attemptId ? { attemptId } : read<Pointer>(storage,this.options.pointerKey ?? currentKey(quizId)) ?? {} }
    catch { this.pointer = {}; this.state.error = '无法读取本地恢复记录，请检查浏览器存储。' }
  }
  get unresolvedCreation() { return !this.pointer.attemptId && !!this.pointer.requestId }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<PracticeState>) { this.state = {...this.state,...patch}; for (const listener of this.listeners) listener() }
  private persist(key: string, value: unknown) {
    try { this.storage.setItem(key, JSON.stringify(value)) }
    catch { throw Error('无法保存本地恢复记录，请释放浏览器存储空间后重试。') }
  }
  private remember() { if (this.isCurrent) this.persist(this.options.pointerKey ?? currentKey(this.quizId),this.pointer) }
  private accept(attempt: PracticeAttempt) {
    if (attempt.quiz_id !== this.quizId || (this.pointer.attemptId && attempt.attempt_id !== this.pointer.attemptId)) throw Error('作答记录不匹配，请重新读取。')
    this.update({attempt})
  }
  async load() {
    if (this.state.busy) return
    this.update({busy:true,ready:false,error:''})
    try {
      if (!this.pointer.attemptId) {
        if (!this.pointer.requestId) {
          // If a browser cache was lost, prefer existing work over silently creating another round.
          const { items } = this.options.createNew ? {items:[]} : await this.api.listAttempts(this.quizId)
          const existing = items.find(a=>a.status==='draft') ?? items[0]
          this.pointer = existing ? {attemptId:existing.attempt_id} : {requestId:crypto.randomUUID()}
          this.remember()
        }
        if (!this.pointer.attemptId) {
          this.remember()
          const result = await this.api.createAttempt(this.quizId,this.pointer.requestId!)
          this.accept(result)
          this.pointer.attemptId = result.attempt_id
          this.remember()
        }
      }
      const remote = await this.api.getAttempt(this.pointer.attemptId!)
      this.accept(remote)
      const pending = this.state.pending ?? read<Pending>(this.storage,pendingKey(remote.attempt_id))
      this.update({pending,conflict:false})
      if (pending) this.reconcile(remote,pending)
      this.update({ready:true})
    } catch(e) { this.update({error:message(e)}) }
    finally { this.update({busy:false}) }
  }
  private clearPending() {
    this.persist(pendingKey(this.pointer.attemptId!),null)
    this.update({pending:undefined,conflict:false,error:'',ready:true})
  }
  private reconcile(remote: PracticeAttempt, pending: Pending) {
    const same = digest(remote.answer_records) === digest(pending.input.answer_records)
    if ((pending.kind==='submit' && remote.status==='submitted' && same) ||
        (pending.kind==='save' && remote.revision > pending.input.expected_revision && same)) {
      this.clearPending(); return
    }
    const conflict = remote.status==='submitted' || remote.revision!==pending.input.expected_revision
    this.update({conflict,error:conflict ? '另一处已修改这轮作答。本地答案已保留，请核对后选择使用服务端记录。' : '本地答案尚未确认保存，可重试原请求。'})
  }
  private async perform(pending: Pending) {
    const id = this.pointer.attemptId!
    this.update({pending})
    this.persist(pendingKey(id),pending)
    try {
      const result = pending.kind==='save' ? await this.api.saveAttempt(id,pending.input) : await this.api.submitAttempt(id,pending.input)
      this.accept(result); this.clearPending()
    } catch(e) {
      this.update({error:message(e)})
      try { const remote=await this.api.getAttempt(id);this.accept(remote);this.reconcile(remote,pending) }
      catch { this.update({error:`${message(e)}；尚未确认服务端状态，本地答案已保留。`}) }
    }
  }
  async answer(answer: Selection) {
    const a=this.state.attempt
    if (this.state.busy || this.state.pending || !this.state.ready || !a || a.status!=='draft') return
    this.update({busy:true,error:''})
    try { await this.perform({kind:'save',input:{expected_revision:a.revision,answer_records:[...selections(a.answer_records.filter(r=>r.question_id!==answer.question_id)),...selections([answer])]}}) }
    catch(e) { this.update({error:message(e)}) }
    finally { this.update({busy:false}) }
  }
  async importAnswers(records: Selection[]) {
    const a=this.state.attempt
    if (this.state.busy || this.state.pending || !this.state.ready || !a || a.status!=='draft' || a.answer_records.length) return
    this.update({busy:true,error:''})
    try { await this.perform({kind:'save',input:{expected_revision:a.revision,answer_records:selections(records)}}) }
    catch(e) { this.update({error:message(e)}) }
    finally { this.update({busy:false}) }
  }
  async submit() {
    const a=this.state.attempt
    if (this.state.busy || this.state.pending || !this.state.ready || !a || a.status!=='draft') return
    if (a.answer_records.length!==a.questions.length) { this.update({error:'请先完成全部题目。'});return }
    this.update({busy:true,error:''})
    try { await this.perform({kind:'submit',input:{expected_revision:a.revision,answer_records:selections(a.answer_records)}}) }
    catch(e) { this.update({error:message(e)}) }
    finally { this.update({busy:false}) }
  }
  async retry() {
    if (this.state.busy) return
    // Always read first. Never raise expected_revision on an uncertain request.
    await this.load()
    const pending=this.state.pending
    if (!pending || this.state.conflict || !this.state.attempt || this.state.attempt.revision!==pending.input.expected_revision) return
    // load may have failed: perform only after a fresh successful read.
    this.update({busy:true})
    try {
      const remote=await this.api.getAttempt(this.pointer.attemptId!);this.accept(remote);this.reconcile(remote,pending)
      if (this.state.pending && !this.state.conflict) await this.perform(pending)
    } catch(e) { this.update({error:message(e)}) }
    finally { this.update({busy:false}) }
  }
  async discardLocal() {
    if (this.state.busy) return
    this.update({busy:true,error:''})
    try { const remote=await this.api.getAttempt(this.pointer.attemptId!);this.accept(remote);this.clearPending() }
    catch(e) { this.update({error:message(e)}) }
    finally { this.update({busy:false}) }
  }
  async generateReport() {
    if (this.state.busy || this.state.attempt?.status!=='submitted') return
    this.update({busy:true,error:''})
    try {
      const remote=await this.api.getAttempt(this.pointer.attemptId!);this.accept(remote)
      if (remote.report_status==='running' || remote.report_status==='completed') return
      const report=await this.api.generateAttemptReport(remote.attempt_id)
      this.accept({...remote,report,report_status:'completed',report_error:null})
    } catch(e) {
      try { this.accept(await this.api.getAttempt(this.pointer.attemptId!)) } catch { /* Keep saved results visible. */ }
      this.update({error:message(e)})
    } finally { this.update({busy:false}) }
  }
}

// Mutations survive route changes and panel unmounts; all views of a round share the writer.
const controllers = new WeakMap<PracticeStorage, Map<string, PracticeController>>()
export function getPractice(api: QuizApi, storage: PracticeStorage, quizId: string, attemptId?: string) {
  let map=controllers.get(storage)
  if (!map) { map=new Map();controllers.set(storage,map) }
  const key=attemptId ?? `current:${quizId}`
  if (attemptId) {
    const existing=[...map.values()].find(c=>c.quizId===quizId && c.state.attempt?.attempt_id===attemptId)
    if (existing) return existing
  }
  let controller=map.get(key)
  if (!controller) { controller=new PracticeController(api,storage,quizId,attemptId);map.set(key,controller) }
  return controller
}
export function newPractice(api: QuizApi, storage: PracticeStorage, quizId: string) {
  const old=getPractice(api,storage,quizId)
  if (old.unresolvedCreation) return old
  if (old.state.busy) throw Error('当前操作尚未完成，请稍后再开始新一轮。')
  // Keep the previous writer addressable for saved history and unsynced drafts.
  const map=controllers.get(storage)!
  if (old.state.attempt) map.set(old.state.attempt.attempt_id,old)
  try { storage.setItem(currentKey(quizId),JSON.stringify({requestId:crypto.randomUUID()})) }
  catch { throw Error('无法保存新一轮请求编号，请检查浏览器存储。') }
  const next=new PracticeController(api,storage,quizId)
  map.set(`current:${quizId}`,next)
  return next
}
