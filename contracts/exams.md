# 多来源组卷、覆盖审核和计时自测 API

公共前缀 `/nobei/quiz/v1`，内部 Quiz 前缀 `/api/v1`。所有接口按当前本机用户隔离；公开 Host 使用现有同源认证、JSON 请求限制、精确路由与查询白名单。Quiz schema7、Core schema2。新能力经 HTTP 提供，MCP 维持17工具，共享 Web/Electron 前端已接入组卷、审核、计时答题、成绩和独立报告入口。

## 接口

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/exam-papers/preview` | POST | 只读匹配题库、返回候选和来源缺口 |
| `/exam-papers` | POST | 幂等创建冻结试卷 |
| `/exam-papers` | GET | 分页试卷摘要 |
| `/exam-papers/{paper_id}` | GET | 审核详情、答案、来源快照和审核记录 |
| `/exam-papers/{paper_id}/review` | PUT | 完整逐题覆盖审核，CAS |
| `/exam-papers/{paper_id}/sessions` | POST | 从已审核版本幂等开考 |
| `/exam-sessions` | GET | 分页考试摘要，含状态和已交卷分数 |
| `/exam-sessions/{session_id}` | GET | 读取考试、已保存答案、交卷结果 |
| `/exam-sessions/{session_id}/answers` | PUT | 全量替换草稿，CAS |
| `/exam-sessions/{session_id}/submit` | POST | 服务端交卷及历史投影 |

paper_id 是 `paper_`+32位小写十六进制，session_id 是 `exam_`+32位小写十六进制。仅两个列表GET接受page=1..1000000、page_size=1..100（默认1/20）。其他查询参数、重复参数均拒绝。JSON各层严格拒绝额外字段，不接受user_id、客户端分数或完整来源快照。

## 组卷

预览输入 `{title,duration_seconds,allocations}`；创建额外要求UUID字符串`request_id`。标题trim后1..120字符；时长整数60..14400秒。allocations为1..20项：

```json
{
  "knowledge_point_id": "kp_11111111111111111111",
  "content_version": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "count": 3
}
```

ID/version必须来自真实题库来源，而非自造示例。每项1..100题，全卷最多100；重复来源版本拒绝。按当前用户已绑定该版本的题库候选匹配；同一知识点不同内容版本是不同来源。仅合法可判分选择题可入卷。全卷复用qcontent_v1精确内容键去重；最大匹配会挪动早先分配，避免贪心误报缺口。选择是确定性的，不承诺随机或未见题。

预览返回 `{ready,total_questions,coverage,items}`。coverage逐来源含count、selected、missing、available_distinct、invalid_count；available_distinct是来源候选数，跨来源共享题仍只能占一个名额。items含卷内question（新ID q1..q100）、entry_id、allocation_index、source_revision及完整冻结source。items序列化UTF-8上限8MiB，过大422要求拆卷；不能产生Host无法读取的已创建试卷。

预览不写库、不调用模型。缺口时创建409，无部分卷、无自动生成。用现有显式来源出题接口补题后可重新预览。同一用户request_id及规范化条件重复创建返回原卷；条件变化409。重放优先于重新选题，题库改绑/Core删除/新增题目不改变已冻结卷。题目内容不可原地编辑；调整需新建卷。

## 覆盖审核

`{expected_revision,reviews:[{question_id,approved,note}]}`，revision为0..9007199254740990整数；approved严格布尔值；note可空、最多1000字符。必须覆盖所有卷内题号且不得重复。保存后revision+1；相同操作丢响应可按原revision和内容重放；其他旧版本409。

全部approved才将试卷status设为approved，否则draft。来源配额满足只证明分配正确，approved表示用户显式核对题意与来源，均不等于AI证明语义覆盖或考试认证。首次开考后审核锁定（已完成同操作重放仍安全），重新审核须新建试卷。审核详情有标准答案；本机单用户仍可查原题库，因此这是自测，不是防作弊环境。

## 计时与保存

开考输入 `{request_id,expected_revision}`，每次新考试用新UUID。同一编号+同一卷/审核版本返回原会话，不能重置计时；不同条件409。开考不调用模型，也不提前创建普通quiz或attempt，旧练习详情不会意外泄漏本次考试的答案。

会话交卷前只返回题干、选项、题型、配图及卷内题号，不含标准答案、解析、正确性、来源正文或普通attempt ID。草稿格式：

```json
{
  "expected_revision": 0,
  "answer_records": [
    {"question_id": "q1", "selected_answers": ["A"], "duration_ms": 1000}
  ]
}
```

草稿是全量替换（不是patch）；可省略题或显式空选项，最多100条。题号不能重复或未知，选项不能重复或不存在；单选/判断最多一个，多选顺序无关。duration_ms为0..14400000整数，仅统计字段，不控制考试期限。保存CAS，成功revision+1；原revision+相同答案可重放一次既成保存。

started_at/deadline_at取服务端UTC，毫秒精度，重启/备份恢复不延长。达到deadline的精确时刻即到期，草稿保存409。GET只读：到期但未结算显示expired、result=null，不在后台隐式调用模型。调用submit完成到期结算。

## 交卷与结果

submit输入与草稿相同。截止前CAS检查通过后以该请求的全量答案交卷；未答或空选项算错。到期后只用此前保存的草稿结算，忽略迟到请求的答案及revision，不能靠网络延迟追加正确答案。旧请求仍需满足JSON基础Schema。超时submitted_at设为deadline，finalized_at记录实际结算时刻。

单题等权，多选严格集合匹配，无部分分。复用DeepTutor改编grade_choice；总accuracy沿用普通练习的整数百分比，by_source提供各来源的正确数量/count和两位百分比。结果另含未答数量、完整标准答案和判分、reason（submitted/timeout）、attempt_id/quiz_id及xp_gain=0。

普通交卷重放须原revision+相同规范化答案；变化409。超时结算重放始终返回已有结果，不接受新答案。交卷结果、已交卷quiz/attempt、题库可信作答及冻结来源在一个事务内写入，任一失败全部回滚。考试不发XP、不改Core掌握度或复习队列。重复考试保留独立成绩，但精确内容去重不会增加知识点独立证据量。

AI报告继续显式调用 `/quiz/attempts/{attempt_id}/report`；失败可独立重试，不重判、不重发经验、不丢成绩。会话result是固定成绩，报告状态从原attempt详情读取。

## 持久化与兼容

schema7增加exam_papers、exam_sessions；v1..6启动升级前生成`.pre-v7-*.bak`，所有迁移处于单个事务，失败回滚且备份保留。已有题目/成绩/XP不重写。整个quiz-data已在home备份范围内，无新增外部存储路径。真实临时home验证进行中考试经重启及备份恢复继续保存/交卷；所有验收使用fake provider，不迁移日常home。
