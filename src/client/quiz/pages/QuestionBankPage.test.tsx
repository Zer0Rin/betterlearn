import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {it,expect,vi} from 'vitest'
import {QuestionBankPage} from './QuestionBankPage.js'
import {bankFixture,bankEntry} from './bank.fixture.js'
const button=(view:ReactTestRenderer,name:string)=>view.root.findAllByType('button').find(b=>b.props.children===name)!
it('shows unanswered entries, searches literally and resets pagination when switching scope',async()=>{
 const f=bankFixture();f.mocks.getBankEntries.mockResolvedValue({items:[bankEntry()],total:25,page:1,page_size:20})
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<QuestionBankPage api={f.api} onPractice={()=>{}} onAttempt={()=>{}}/>)})
 expect(JSON.stringify(view.toJSON())).toContain('未作答')
 await act(async()=>button(view,'下一页').props.onClick())
 expect(f.mocks.getBankEntries.mock.calls.at(-1)?.[0]).toMatchObject({page:2})
 await act(async()=>view.root.findByProps({'aria-label':'当前错题'}).props.onClick())
 expect(f.mocks.getBankEntries.mock.calls.at(-1)?.[0]).toMatchObject({page:1,scope:'wrong'})
 act(()=>view.root.findByProps({'aria-label':'搜索题目'}).props.onChange({target:{value:'50%_'}}))
 await act(async()=>view.root.findByProps({'aria-label':'题库搜索'}).props.onSubmit({preventDefault(){}}))
 expect(f.mocks.getBankEntries.mock.calls.at(-1)?.[0]).toMatchObject({search:'50%_'})
 act(()=>view.unmount())
})
it('reads details and performs explicit bookmark and category writes without grading',async()=>{
 const f=bankFixture();let view!:ReactTestRenderer
 await act(async()=>{view=create(<QuestionBankPage api={f.api} onPractice={()=>{}} onAttempt={()=>{}}/>)})
 await act(async()=>button(view,'查看题目').props.onClick())
 expect(JSON.stringify(view.toJSON())).toContain('还没有交卷记录')
 await act(async()=>button(view,'收藏题目').props.onClick())
 expect(f.mocks.setBankBookmark).toHaveBeenCalledWith(1,true)
 await act(async()=>view.root.findByProps({'aria-label':'分类：概念'}).props.onChange({target:{checked:true}}))
 expect(f.mocks.setBankCategory).toHaveBeenCalledWith(1,2,true)
 act(()=>view.unmount())
})
it('shows the category deletion impact before sending DELETE',async()=>{
 const f=bankFixture();let view!:ReactTestRenderer
 await act(async()=>{view=create(<QuestionBankPage api={f.api} onPractice={()=>{}} onAttempt={()=>{}}/>)})
 act(()=>button(view,'管理分类').props.onClick())
 act(()=>view.root.findByProps({'aria-label':'删除分类：概念'}).props.onClick())
 expect(f.mocks.deleteBankCategory).not.toHaveBeenCalled()
 expect(JSON.stringify(view.toJSON())).toContain('题目和作答记录会保留')
 await act(async()=>button(view,'确认删除分类').props.onClick())
 expect(f.mocks.deleteBankCategory).toHaveBeenCalledWith(2)
 act(()=>view.unmount())
})
it('does not automatically resend an uncertain category creation',async()=>{
 const f=bankFixture();f.mocks.createBankCategory.mockRejectedValueOnce(Error('连接中断'))
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<QuestionBankPage api={f.api} onPractice={()=>{}} onAttempt={()=>{}}/>)})
 act(()=>button(view,'管理分类').props.onClick())
 act(()=>view.root.findByProps({'aria-label':'新分类名称'}).props.onChange({target:{value:'过程'}}))
 await act(async()=>button(view,'新增分类').props.onClick())
 expect(f.mocks.createBankCategory).toHaveBeenCalledTimes(1)
 expect(button(view,'新增分类').props.disabled).toBe(true)
 expect(JSON.stringify(view.toJSON())).toContain('重新读取')
 act(()=>view.unmount())
})
it('ignores a late list response from the previous filter',async()=>{
 const f=bankFixture();let resolveFirst!:(value:any)=>void
 f.mocks.getBankEntries.mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve})).mockResolvedValue({items:[bankEntry({question:{...bankEntry().question,stem:'最新筛选结果'}})],total:1,page:1,page_size:20})
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<QuestionBankPage api={f.api} onPractice={()=>{}} onAttempt={()=>{}}/>)})
 await act(async()=>view.root.findByProps({'aria-label':'当前错题'}).props.onClick())
 await act(async()=>resolveFirst({items:[bankEntry()],total:1,page:1,page_size:20}))
 expect(JSON.stringify(view.toJSON())).toContain('最新筛选结果')
 expect(JSON.stringify(view.toJSON())).not.toContain('光合作用是什么？')
 act(()=>view.unmount())
})
