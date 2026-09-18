# 手动向量化

上传只保存本地文件，状态 uploaded。用户点击“开始向量化”后调用 POST /knowledge/documents/{doc_id}/vectorize。原子状态领取防止同一文档重放收费；失败无自动重试，需重新上传并明确启动。既有 ready 文档不重建。uploaded 原件可供文本知识提取，不必先付费向量化；可在上传后配置 Embedding。

SQLite v8 在备份后事务迁移文档表，新增 uploaded 状态，保留原记录、索引、触发器。向量目录不变。测试覆盖 v7 升级、失败回滚、重启保持 uploaded、重复启动、归属检查及上传不启动任务。

验证：379 项 quiz Python 测试通过；73 项相关前端/API/文档来源测试通过；真实服务端到端测试通过（含先上传后修改 Embedding、未向量化正文提取）。最终打包 Electron 使用临时 home 和 fake provider 验证上传/刷新无模型请求、点击后有请求、重启后待向量化文件仍未启动，全部通过。DMG 校验通过。

安装包：dist/installers/BetterLearn-0.1.0-arm64-manual-vectorization.dmg。测试未使用真实模型密钥或付费 API。
