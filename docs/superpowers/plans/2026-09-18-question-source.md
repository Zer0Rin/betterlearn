# Question source implementation

- [x] 写 Quiz API 测试复现来源接口缺失；Host 测试复现透传风险。
- [x] schema v4 + 升级备份/回滚测试；旧迁移路径不引用新表。
- [x] 来源模型/仓库/受管理私有接口；题库详情/列表/历史与交卷快照。
- [x] Host 来源适配器，连接 standalone/plugin Core operations，更新契约。
- [x] 并发、重启、历史与归属边界测试；独立代码审查。
- [x] Quiz/Host 回归、build、diff 检查，更新文档/交接。保留所有工作树改动。


验证记录：Quiz 261 passed；最终 Web 全量523 passed；Host/服务16 passed；来源/迁移定向7 passed；
构建与 diff check 通过。独立审查修复来源删除后的重放和过期版本错误码，
跨语言 fixture 校验通过。旧 DSH product-plugin 测试因缺少 @deepseek-ai/cordis
无法加载，未安装 DSH 依赖；独立运行链路测试通过。
