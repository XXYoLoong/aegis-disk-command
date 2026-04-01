# Aegis Disk Command

[English](./README.en.md)

[![Stars](https://img.shields.io/github/stars/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/stargazers)
[![Forks](https://img.shields.io/github/forks/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/network/members)
[![Issues](https://img.shields.io/github/issues/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/issues)
[![Last Commit](https://img.shields.io/github/last-commit/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/commits/main)
[![Platform](https://img.shields.io/badge/Platform-Windows_10%2B-0078D6?style=flat-square&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![AI](https://img.shields.io/badge/AI-DeepSeek-4D6BFE?style=flat-square)](https://api-docs.deepseek.com/)
[![Mode](https://img.shields.io/badge/Mode-Local--First-0B1220?style=flat-square)](#)

一个面向 Windows 的本地优先磁盘指挥舱。它把实时容量遥测、目录扫描、启发式兜底和可选的 DeepSeek AI 分析组合在一起，让你可以像看中控台一样持续观察所有盘符的状态、热点目录和整理机会。

## 特性

- 实时监控所有已挂载的 Windows 文件系统盘
- 汇总总量、已用、剩余和容量压力
- 后台轮转扫描每个盘的顶层目录、焦点目录和可见大文件
- 识别回收站、缓存区、下载仓、同步目录、工具链堆积、虚拟磁盘和游戏库等高占用区域
- 在启用 `DEEPSEEK_API_KEY` 时使用 AI 输出更细的单盘机会项与跨盘标准化建议
- 在 AI 不可用、超时或返回异常时自动回退到本地规则分析
- 使用深色科技驾驶舱界面呈现高密度、可管理、可洞察的信息

## 分析是怎么实现的

当前分析链路不是“前端写死几段文案”，而是分成两层：

1. 数据采集层  
   `server/scan-drive.ps1` 会读取每个盘的顶层目录、焦点目录和可见大文件；`systeminformation` 提供盘符容量、CPU 和内存状态。

2. 分析层  
   `server/index.mjs` 会先生成本地启发式分析结果，作为永远可用的兜底；如果检测到环境变量里的 `DEEPSEEK_API_KEY`，就会调用 DeepSeek 官方 `POST /chat/completions` 接口，请模型返回严格 JSON，再把 AI 结果和本地规则结果合并。

也就是说：

- 没有 AI 时，项目依然能正常跑
- 有 AI 时，分析不再完全依赖固定规则
- AI 出错时，会自动退回本地规则，不会把看板直接搞挂

## AI 模式说明

默认情况下，只要环境里存在 `DEEPSEEK_API_KEY`，服务端就会启用 AI 分析。相关可选变量：

```bash
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_MS=12000
AI_ANALYSIS_ENABLED=true
```

说明：

- `DEEPSEEK_MODEL` 默认是 `deepseek-chat`
- `AI_ANALYSIS_ENABLED=false` 可以强制关闭 AI，保留纯本地规则模式
- AI 模式会把经过裁剪的目录元数据、路径、大小和已有机会项摘要发送给 DeepSeek，用于生成更高层的结构化建议

## 技术栈

- React 19
- TypeScript
- Vite
- Express 5
- `systeminformation`
- Windows PowerShell
- DeepSeek Chat Completions API（可选）

## 项目结构

```text
disk-command-cockpit/
  docs/
    step-by-step-log.md
  server/
    ai-analysis.mjs
    index.mjs
    scan-drive.ps1
  src/
    lib/
    App.tsx
    index.css
    main.tsx
    types.ts
  dist/
  package.json
```

## 本地运行

```bash
npm install
npm run dev
```

启动后会得到两个服务：

- 本地磁盘分析服务：`http://127.0.0.1:5525`
- Vite 开发服务：`http://127.0.0.1:5173`

如果想按本地生产模式运行：

```bash
npm run build
npm run start
```

然后打开：

```text
http://127.0.0.1:5525
```

## 运行机制

- 容量遥测刷新频率：每 5 秒
- 深度扫描策略：后台排队，按盘顺序执行
- 单盘扫描完成后：
  - 先生成规则兜底分析
  - 再尝试调用 DeepSeek 生成结构化 JSON 分析
  - 合并机会项，并更新跨盘标准化建议
- AI 不可用时，直接保留本地规则结果

## 说明

- 项目默认是本地优先的，不会上传完整文件内容
- 当前界面只读取盘符元数据和目录结构，不会删除或移动文件
- 开启 AI 时，会把裁剪后的路径、目录名、大小等摘要信息发送给 DeepSeek
- 这个工作区的 npm 缓存通过 `.npmrc` 固定在 `F:`，不会落到 `C:`

## 后续方向

- 增量扫描与持久化历史遥测
- 导出 Markdown / JSON 报告
- 更丰富的 Treemap / Sunburst 可视化
- 单盘分析进度反馈
- 可配置的 AI 提示词与隐私裁剪策略
