# Knowledge version answer statistics

继续已授权后端路线，前端暂停。只读统计可信已交卷且有来源快照的题库作答，
按 (knowledge_point_id, content_version) 分组；不读取当前映射或自由文本标签。
不计算/写回 mastery。DeepTutor 最近五次加权掌握公式会把同题重做当更多证据，
本阶段不移植该公式，复用已有题库查询边界与历史事实。

GET /question-bank/knowledge-stats：page/page_size，与可选 knowledge_point_id、
content_version（version 必须同时指定 ID）。items 返回 source（该组最后记录来源摘要，省略 evidence）、
answer_count/correct_count/accuracy、distinct_question_count/repeated_answer_count、
first_correct_count/first_accuracy、latest_correct_count/latest_accuracy、
entry_count/attempt_count、first_answered_at/last_answered_at。
正确率均为百分数，分母分别为全部答案或独立内容数；保留两位小数。
同知识点同版本跨课程合并，source 只是最后一个来源示例，不是当前 Core 内容。

独立内容指 canonical JSON 的 type/stem/options/answer/image_url SHA-256；
options 按 key/text 排序、answer 排序；不包含卷 ID、题号、讲解、难度或自由标签。
这是精确内容去重，不做语义识别，不宣称新题/能力证据独立。图片 URL 不同视作不同内容。
first/latest 按持久 question_bank_attempts.id 顺序，时间仅用于显示，避免同毫秒歧义。

GET /question-bank/knowledge-stats/history 必须指定知识点 ID/version，分页返回
该版本的作答、题目内容键、entry_id/quiz_id/question_id/attempt_id、source 摘要、
答案、对错与时长。完整证据仍可从原题库条目历史读取，避免分页重复大段引用。排除未关联、旧客户端判分与草稿，归属隔离；无数据返回空列表。

无需迁移；在一个 SQLite 事务快照中读可信记录，流式聚合不保存整个历史列表。
时间 O(用户历史)，内存 O(独立题目+组+轮次)。分页不限制扫描；
后续数据规模大时可做带版本的增量聚合，本阶段避免维护第二套成绩事实。
错误查询拒绝；Host 精确白名单和重复参数验证。无写操作/模型调用。
