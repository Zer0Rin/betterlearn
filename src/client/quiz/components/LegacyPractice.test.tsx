import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { it, expect, vi } from 'vitest'
import { LegacyPractice } from './LegacyPractice.js'
import { fixture, attempt, answer } from '../services/practice.fixture.js'
it('keeps old browser answers read-only until the user explicitly imports a new round',async()=>{
 const f=fixture();const onRecovered=vi.fn();let view!:ReactTestRenderer
 await act(async()=>{view=create(<LegacyPractice api={f.api} storage={f.storage} quiz={{...attempt(),summary:''}} records={[{...answer,is_correct:true}]} onRecovered={onRecovered} onHistory={()=>{}}/>)})
 expect(f.mocks.createAttempt).not.toHaveBeenCalled();expect(f.mocks.saveAttempt).not.toHaveBeenCalled()
 await act(async()=>view.root.findAllByType('button').find(b=>b.props.children==='恢复本地答案为新一轮')!.props.onClick())
 expect(f.mocks.createAttempt).toHaveBeenCalledOnce();expect(f.mocks.saveAttempt).toHaveBeenCalledOnce()
 expect(onRecovered).toHaveBeenCalledOnce()
 act(()=>view.unmount())
})
