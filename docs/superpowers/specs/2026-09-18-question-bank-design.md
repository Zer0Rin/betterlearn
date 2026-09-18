# 题库与错题本后端

状态：2026-09-18 后端实现及验证完成。

继续已确定的 DeepTutor 复用与学习后端路线；前端暂停，保留现有工作树，仅测试临时数据库。

## 选择与范围

采用 DeepTutor notebook 的题目状态、收藏、分类和共用筛选查询，适配 BetterLearn 身份和作答事务。
直接搬入其 session store 会引入另一套存储；单纯从每轮答案列表临时聚合则无法稳定保存收藏和分类。
本次建立持久题目条目和 attempt 关联，不引入其 agent、模型或客户端判分入口。

- 每条目以 user_id + quiz_id + question_id + 题目内容 hash 唯一；跨卷同名题号不合并，题目修改形成新版本。
- 已保存的合法题目进入题库，未答题 is_correct 为 null，不进入错题集合。
- 交卷在同一事务内关联 attempt 与条目，更新最新对错、作答次数和错误次数；重复交卷不重复计数。
- wrong 筛选为最新作答错误；ever_wrong 保留曾错记录。改对只退出当前错题，不删除任何历史。
- 每条目的作答历史分页读取原 attempt_answers，按提交关联递增序号倒序，避免同毫秒交卷排序歧义；报告失败、重试与此无关。
- 收藏是显式设置布尔值；分类按用户唯一，trim 后 casefold 去重，支持新增、改名、删除和单题关联/移除。
- 不提供客户端修改判分、题目或覆盖作答历史的入口。分类删除仅移除分类关联。

## 复用来源

DeepTutor `deeptutor/services/session/sqlite_store.py` 的 `_escape_like`、
`_question_bank_filters`、`_load_categories_for`、分页排序、统计与分类关联查询改编为独立仓储。
保留 Apache-2.0 许可证，明确新增用户隔离、可信交卷投影和版本键；更新 PROVENANCE。

## 存储与升级

schema v3 添加 question_bank_entries、question_bank_attempts、question_bank_categories、question_bank_entry_categories。
已有 v1/v2 升级前使用 SQLite backup API 生成 `.pre-v3-<uuid>.bak`，备份失败不升级；事务失败全部回滚。
回填已有合法题目与可信 v2 作答（legacy_records_json IS NULL），保持原 XP、成绩、报告。
v1 导入的 legacy_records_json 属于旧客户端判分历史，不作为当前错题事实；原历史入口仍完整保留。
历史中无法通过 Question schema 的题目不自动进入题库，不阻断升级。

## API

前缀 `/question-bank`，Host 同步精确白名单：

- GET /entries：page/page_size、scope=all|wrong|ever_wrong|bookmarked|uncategorized、category_id、quiz_id、search、sort=recent|oldest。
- GET /stats：用户全部条目的 total/wrong/ever_wrong/bookmarked/uncategorized。
- GET /entries/{id}、GET /entries/{id}/history（分页）。
- PUT /entries/{id}：只接受 bookmarked。
- GET/POST /categories、PUT/DELETE /categories/{id}。
- PUT/DELETE /entries/{id}/categories/{category_id}：同用户归属检查，重复设置幂等。

每页 1–100，默认 20；搜索最多 200 字符，按字面转义 LIKE 的 %/_/反斜线。
所有者或对象不存在统一 404，名称冲突 409，非法输入 422。列表和总数使用同一筛选。
本轮不接前端，不新增收费生成入口，不实现组卷、单题复习/复习调度或知识点掌握度。

## 验证

先复现无题库接口；测试未答/错/改对/再次错、报告失败与提交重放、版本隔离、分页与字面检索、
收藏分类、跨用户访问、v1/v2 回填和升级失败回滚。运行 quiz 全套、Host 路由测试和 build。
