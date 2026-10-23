# 维护范围与可核验记录

本项目公开仓库从 1.1.0 开始发布。公开前的本地开发不能等同于长期社区维护；版本说明也不能代替真实使用者或下载量证明。

## 现有维护与验证入口

| 问题或责任 | 代码或公开检查 | 证据边界 |
| --- | --- | --- |
| 选择班级、话题和时间范围 | `extension/analysis/collection-scope.js`、`tests/discussion-collection-scope.test.js` | 合成输入的范围计算；不代表任意课程分页已完整采集 |
| 同班重复记录和跨班编号冲突 | `extension/analysis/engine.js`、`tests/discussion-record-count.test.js` | 验证稳定编号去重、跨班父子关联及保留原始材料 |
| 可调整基础分与缺项处理 | `extension/analysis/grading.js`、`tests/discussion-grading-configurable-base.test.js` | 验证计分规则；不证明模型评分准确或教学效果 |
| 分享配置不带出密钥 | `extension/options.js`、`tests/extension-public-config.test.js` | 检查分享配置与接口切换的密钥隔离；不是完整凭据审计 |
| 语法、入口文件及公开材料 | `scripts/verify.mjs`、`scripts/audit-public.mjs` | 检查规则覆盖的内容；不能替代人工隐私审查 |
| 安装包与源码对应 | `scripts/package.py` | 检查运行文件白名单、ZIP CRC 和包内字节一致性，生成 SHA-256 |

1.1.0 的范围与回复采集修正见 [更新记录](../CHANGELOG.md)。今后的真实修复应通过 Issue/PR、提交、测试和 Release 形成可追溯记录，不补造历史或用户反馈。

## 后续维护重点

- 平台页面改动后的采集适配，尤其时间边界、旧话题回复和楼中楼。
- 中断、暂停和网络异常后的状态恢复，保留已采集和已分析的有效材料。
- 用固定的模拟材料核对统计口径，区分资料不足、确认为零和模型漏答。
- 课堂纪要与评分的引用依据，以及导入导出的兼容性。
- 窄窗口、浏览器缩放和不同系统下的可读性。
- 将合成测试与真实课程、真实模型和教师体验分别记录，不互相替代。

## 拟使用维护工具的方式

Codex 可用于分析脱敏问题、辅助审查 PR、补充回归测试和整理发布说明。若未来获得 API 额度，可在维护者手动启动、有调用上限的工作流中生成修复建议和模拟测试；不自动执行模型生成命令，不自动合并 PR，不在外部 PR 工作流中提供密钥，也不传送真实课堂数据。

上述 API 自动化尚未接入。当前 GitHub Actions 仅运行离线源码检查和打包，不调用模型。
