# 新 session 修复交接：评审复核结果

## 用户意图与当前状态

用户要求“打包，我在新 session 完成修复”。本 session 只核对并打包，不实施修复、不重装插件、不改日常数据库、不提交或推送新改动。

仓库：`/Users/guyue/Documents/code/betterlearn-for-dsh`。
分支：`codex/electron-desktop`。
已推送基线：`c02b3410e99933fe04b11b9aef7b1046c9ccd12d`，GitHub：Zer0Rin/betterlearn-for-dsh。
本交接文件新增前工作区干净。不要把旧交接里的“功能已验收”理解为下面的问题已修复。

复现均使用临时 SQLite、测试身份、fake model，没有操作日常 home。测试代码只在忽略的 output/verification 下；应把最终回归正式加入对应 tests 目录。

## 优先问题及实测结果

### 1. 兼容报告入口绕过已有新式轮次

路径：Host `src/product/quiz-routes.ts` 的 `/report/generate` 白名单 → `services/quiz/app/services/report_service.py:handle_report_generate` → `repositories/attempt_repository.py:submit_legacy`。

submit_legacy 只找 legacy_source=1，不管已有现代草稿/轮次。_submit 的 legacy 检查是旧 answer_records 表，不是 legacy_source。

实测：创建新式草稿 → 旧报告提交五题正确 → 同卷两个轮次且兼容轮次领取20 XP → 原草稿交卷XP=0。它新增轮次并影响最新成绩、汇总和题库状态，不是修改原轮次的存储成绩；未证实跨用户越权。旧客户端 API 方法已无页面调用方。

建议决定是否彻底关闭公开兼容入口，或保留严格兼容语义。若保留：防止已有新式轮次时偷偷新建提交，明确兼容轮次XP政策。注意 report_service 会把 AttemptError 包成 ReportGenerationError，单在仓库抛冲突不一定得到HTTP409，需检查整条错误映射。

验收：请求被拒绝/安全处理后，XP、已交轮次数、wrong/ever_wrong和latest_attempt_id不变；正常attempt报告仍可生成；已存兼容报告的读取/重放行为明确。

### 2. 目标截止后结果可被正常延迟结算改变

这是已复现的日常操作，不依赖时钟回拨或改库。

2030-01-01 00:00开考，考试截止00:01；目标截止00:02；考试草稿已保存。00:02:10读取目标：deadline_passed=true，criteria_met=false。此时结算到期考试，exam_repository 将submitted_at设为考试截止00:01，finalized_at为00:02:10。再次读取同一目标：criteria_met=true。

原因：learning_goal_repository.detail每次按submitted_at截止重新聚合，没有冻结结果；exam_repository.submit对timeout回填考试deadline。界面和使用指南“之后作答不改变这个目标”的承诺超出实现。

产品语义尚未由用户选择：按记录中的交卷时间动态计算（修正文案），还是冻结期限结果。若选择冻结，需同时规定未结算到期考试的归属；仅“第一次截止后读取时冻结”会令结果受读取时机影响。避免仅修时钟异常而漏掉正常timeout结算。

### 3. 未作答考试题进入学习证据

exam_repository.submit为全卷补齐空答案 → exam_result.persist → question_bank_projection.record_attempt → 统计/assessment/目标。

实测：只答1/5，unanswered_count=4，但answer_count=5、distinct_question_count=5。test_exams.py已有明确断言保护全卷投影，属于当前产品语义，不是漏写分支。

建议（尚未作为用户最终决定）：考试总分仍未答计错，知识点学习证据排除空选择。需同时考虑错题展示与学习证据是否应分离、显式清空与从未作答如何处理、已存在的历史投影如何排除。只改未来投影不解决旧证据。不得未经备份迁移用户日常数据。

验收：总分和未答数保持正确；basis、answer_count、distinct_question_count、目标数量门槛只包含符合新规则的记录；历史兼容、重复交卷和原子事务保持成立。

### 4. 考试草稿dirty误报

`src/client/quiz/components/ExamAttempt.tsx`直接JSON.stringify比较answer_records。选择处理把修改题移到数组末尾，服务端按question_id排序；多选键也会被规范化。

组件实测：已保存q1=A、q2=B；取消q1再选回A，所有事实相同，仍显示“有本地修改尚未保存”。需规范化记录及选项顺序后比较，保持真实修改和冲突仍可识别。

“已保存 N/M”目前只数非空答案。建议区分“草稿已保存”与“已作答题数”；不要简单把清空记录解释为完成了一题。

### 5. 已安装宿主技能落后且存在同名模板

只读比对：
- plugins/shared/SKILL.md 与 dist/plugins/codex/betterlearn/skills/betterlearn/SKILL.md：5716字节，17个唯一工具名。
- ~/.claude/skills/betterlearn/skills/betterlearn/SKILL.md 和 ~/plugins/betterlearn/skills/betterlearn/SKILL.md：2447字节，7个工具名。
- 当前技能目录指向的 ~/.codex/plugins/cache/personal/betterlearn/0.1.0+codex.20260917090517/skills/betterlearn/SKILL.md 也为2447字节、7工具。
- ~/.claude/skills/betterlearn/SKILL.md 为318字节TODO模板。

新session应检查宿主正式安装方式、备份旧安装后升级，并移除/隔离同名stub；不要只修改缓存文件或仓库生成包就宣称宿主已升级。当前未执行重装或删除。

## 次要项：确认与纠正

- schema6涉及4个契约文件、5个位置：knowledge-assessment.md、learning-goals.md的两处、mcp-learning.md、source-generation.md。实际Quiz schema7。保留“目标表在schema6引入”的历史事实，修正当前版本和升级备份路径，勿机械替换。
- 指南“目标创建前同版本证据可计入”和“后来绑定不回填旧作答”不矛盾。可统一表述为：按交卷时冻结的来源决定归属，而非目标创建时间。
- due_at小写z确实被拒绝，MCP仅校验字符串长度。属于输入兼容/错误提示，不是已证实数据破坏。
- NULL日期：KnowledgeStatistics实际读取last_answered_at，不是报告声称的first_answered_at；goalTime(null)抛TypeError，不是Invalid Date。正常现代提交写入时间，聚合排除旧legacy记录，尚无正常数据触发证据；作为防御性补强。
- Python round(62.5)=62；前端渲染服务器62仍为62，并未证实同一成绩前后端62/63不一致。by_source保留两位小数，整卷分数为整数，需先定精度规则。
- Host /user/quizzes 的page/page_size验证确实比Python宽松，非法值会透传422；属于低优先级接口一致性。
- 聚合确实扫描相关历史，默认列表/曾错/收藏缺少针对性索引；已有用户前缀索引，不是完全无索引。普通B-tree也不能直接解决前置%搜索。未做规模基准，不宣称已发生严重性能故障。
- evidence_state未直接渲染，但页面已有无证据和小样本说明，不是完全未表达状态。
- 8MiB是整份试卷快照上限，16MiB是Host响应上限；尚无实际超限复现。作为边界断言，不按确定缺陷修。

## 可重复验证

仓库根目录已有脚本：

```bash
PYTHONPATH=services/quiz services/quiz/.venv/bin/python -m pytest -p tests.conftest output/verification/test_review_findings.py -q -s
node_modules/.bin/esbuild output/verification/exam-dirty-review.tsx --bundle --platform=node --format=esm --packages=external --jsx=automatic --outfile=output/verification/exam-dirty-review.mjs
node output/verification/exam-dirty-review.mjs
```

注意：这3个pytest是“确认旧问题存在”的复现实验，当前通过不代表修复正确。修复后必须改为期望正确行为的正式回归。

本轮结果：3 passed；dirty组件输出从“与服务端一致”变为“有本地修改”，尽管选项已经恢复原值。

基线验证历史：Web624、Core414、Quiz369；桌面与打包应用完整链路通过，但桌面脚本当前也认可未答题进入三条统计，改变语义必须同步更新该断言。scripts/verify-desktop-learning.mjs、真实Host测试和契约都需要查找相关断言。

修复后运行直接相关回归和构建，再检查必要的全套与插件/桌面验收。不得用自动换request_id、自动重试模型或修改客户端业务事实来绕过冲突。得分曲线、错题组卷、CSV导出等新功能暂缓。

## 给新 session 的起始指令

请先阅读本文件并检查git状态。按这里的已复现问题开展修复，先处理兼容报告入口和目标截止结算；对尚未确定的证据/冻结语义，明确方案及影响后再实施。将复现实验改为正式回归，检查既有历史数据和错误映射，补齐文档与插件同步。保留现有工作，不操作日常home；是否提交推送按新session用户指令执行。
