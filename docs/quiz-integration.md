# 题库集成与数据迁移

BetterLearn 将修改后的鱼皮 AI 闯关学习教程作为内置题库服务发布，保留 MySQL、上传文件和 Chroma 向量存储。浏览器统一使用 DSH 页面；`betterlearn start` 由 Host 启动和关闭题库服务，通过本机受管理接口完成认证，无须 Vite、独立后端命令或手工复制 JWT。

## 代码来源

原项目：[liyupi/yu-ai-learn](https://github.com/liyupi/yu-ai-learn)，MIT License，Copyright (c) 2026 liyupi。移植基于本地修改后的工作副本，其基线提交为 `32c7c1623d2bd88139534ed19c04f0545e72a0f8`；它并非该提交的原样拷贝。服务代码位于 `services/quiz/app`，原许可证随包保存在 `services/quiz/LICENSE`。本次集成增加受 Host 管理的启动、认证桥接和 DSH 内题库界面。

## 安装后的目录与配置

以下路径以安装的 `--home` 为根：

| 内容 | 路径 |
| --- | --- |
| Core 独立 Python 环境 | `venv/` |
| 题库独立 Python 3.12 环境 | `quiz-venv/` |
| 私有题库配置 | `quiz.env`（0600） |
| 文件和向量目录 | `quiz-data/uploads/`、`quiz-data/chroma/` |
| 服务源码 | `packages/<安装标识>/package/services/quiz/` |

安装、重装、升级都为题库安装对应 requirements.txt，依赖与 Core 隔离。范围版本依赖会随升级重新解析；应先在独立环境验证再升级正式数据。安装只自动生成一次 JWT 密钥；已有 quiz.env 原样保留，不替换任何 provider、模型名、密钥或数据库设置。模板中的模型名只是首次安装默认值，迁移时应保留原项目的实际配置。

启动配置使用 `config.json` 中三个绝对路径 `quizPythonExecutable`、`quizEnvFile`、`quizDataRoot`。CLI 将其分别传给 `BETTERLEARN_QUIZ_PYTHON_EXECUTABLE`、`BETTERLEARN_QUIZ_ENV_FILE`、`BETTERLEARN_QUIZ_DATA_ROOT`，bundle patch 再传给 Host。尚未升级的旧安装可全部省略三个字段，继续使用原有 Core。不要只填写其中一项。服务目录由插件包位置自动确定，数据不存入源码目录。

首次启动前准备 MySQL 服务和独立数据库账户，在 quiz.env 中填写 MYSQL_*。再从原配置复制所需 DEEPSEEK_*、TAVILY_*、DASHSCOPE_*、COS_* 值。COS 可继续引用原对象，但应先保存对象清单及必要备份。DSH 的普通对话模型配置与题库服务配置分别保留，安装器不自动改名或互相覆盖。

## 从原教程迁移

1. 停止原教程的写入和后台任务，保留原项目、原 `.env` 与全部目录，记录当前模型名称及数据库版本。
2. 使用 MySQL 原生一致性导出工具备份原数据库；以可恢复的方式备份上传目录和整个 Chroma 持久化目录。停止服务后复制向量目录，避免只复制一部分 SQLite/WAL 文件。若使用 COS，另行备份对象及清单。所有备份应保留在迁移目标之外。
3. 在全新 `--home` 安装 BetterLearn，把数据库导入另一个目标数据库，使用仅访问目标数据库的账户。不要让试迁移直接写原库。
4. 首次启动前将上传目录内容复制到 `quiz-data/uploads/`，整个 Chroma 持久化目录复制到 `quiz-data/chroma/`。保留目录结构、文档ID和数据库关系；若数据库记录中存在原机器的绝对路径，需要先在目标副本上按实际路径修正并核对文件可访问性。
5. 编辑目标 quiz.env，指向目标MySQL并复制原provider配置；保留原 embedding 模型及其维度。不要因迁移随意切换 embedding 模型，否则已有向量可能不兼容。Host 使用新的受管理登录，无须移植浏览器登录token。
6. 启动 BetterLearn，核对用户、题目、做题记录、知识库文档和向量检索，以及文件/图片访问。确认目标副本完整可用后再切换日常使用。迁移期间始终保留可独立恢复的原环境。

## 维护边界

`betterlearn backup`、`restore` 和升级前自动备份仅覆盖旧 Core SQLite，**不包含 MySQL、uploads、Chroma 或 COS**。升级前需停掉 DSH 并单独备份这些数据。恢复题库时应恢复同一时间点的数据库、文件与向量目录，再恢复匹配的 quiz.env 和依赖环境。

卸载仅移除插件，保留题库环境、quiz.env、所有本地数据和外部MySQL。升级失败可能已部分更新Python依赖或DSH插件，配置只在成功后切到新包；修复原因后重试。撤回旧版本前应检查数据schema兼容性，必要时恢复成套备份；Core SQLite备份不能撤回题库变更。
