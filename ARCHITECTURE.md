# 离线转写功能架构设计

## 1. 背景与目标
- 在现有 Electron（主进程 + Renderer）架构上扩展「下载 → 提取音频 → Whisper 转写 → 导出文本」的离线流水线。
- 支持单链接输入，产出 `.mp3` 与 `.txt`，全程离线运行（除 `yt-dlp` 下载源站内容外无任何云调用）。
- 针对 macOS 设备启用 `whisper.cpp` Large V3 Turbo 量化模型 + Metal GPU 加速，兼顾高精度与高吞吐；其他平台提供 CPU fallback。
- 目标体验：单作业可视化进度、失败可重试、产物可追溯，满足桌面级 App 易用与稳定性要求。

## 2. 架构总览
```
+--------------------------- Electron App ---------------------------+
| Renderer(UI)  <==IPC==>  Main Process  <==spawn==>  Runtime Layer |
|  - 表单/队列视图           - 作业队列             - yt-dlp        |
|  - 日志面板               - 状态机               - ffmpeg        |
|  - 依赖检查               - 事件广播             - whisper.cpp   |
+-------------------------------------------------------------------+
                         ↓ 文件系统（downloads/）
```
- Renderer 层：负责用户交互、输入校验、状态渲染、错误提示。
- 主进程编排层：集中处理 IPC、队列、子进程生命周期、作业元数据、权限控制。
- Runtime 层：封装第三方二进制执行环境与脚本，确保命令行调用可复用、可测试。
- 持久化：所有产物与日志写入 `downloads/<jobId>/`，便于离线管理与恢复。

## 3. 核心流程
1. **作业创建**：Renderer 触发 `job:create`，参数包含 URL、输出目录、是否保留视频、语言偏好。
2. **队列入列**：主进程校验参数、依赖，生成 `jobId` 与 metadata，写入磁盘并推送 `job:accepted`。
3. **下载阶段**：调用 `yt-dlp` 下载最佳音视频流，实时解析 stdout，广播 `job:progress(download)`。
4. **音频提取**：下载完成后用 `ffmpeg` 抽取音轨，生成 `audio.mp3`（必要时保留 `audio.wav` 供 Whisper）。
5. **转写阶段**：在独立 worker/子进程中运行 `whisper.cpp`，开启 Metal (`--encoder metal`)，获取实时进度并写入 `transcript.txt`。
6. **收尾整理**：汇总产物（`source.mp4`、`audio.mp3`、`transcript.txt`、`metadata.json`、`logs.txt`），标记作业完成或失败，通知 Renderer。
7. **用户操作**：UI 提供「打开目录」「复制文本」「重试」等操作；失败场景可单独重跑某一阶段。

## 4. 关键模块职责
### 4.1 Renderer UI (`html/transcribe.html`, `src/transcribe.js`)
- 提供任务创建表单、依赖状态指示、作业列表、实时日志。
- 使用 `src/common.js` 中的 IPC 封装（如 `ipcInvoke`, `ipcOn`）统一通信。
- 支持批量操作（取消、清理历史记录）、失败重试与用户偏好设置缓存（默认输出目录等）。

### 4.2 主进程编排 (`main.js`, `src/jobs/queue.js`)
- 注册 IPC：`job:create`, `job:cancel`, `job:list`, `job:logs`, `deps:check`。
- 队列状态机：`PENDING → DOWNLOADING → EXTRACTING → TRANSCRIBING → PACKING → COMPLETED/FAILED/CANCELLED`。
- 负责进度节流（避免频繁向 Renderer 发送事件）、失败重试策略、磁盘配额检查。

### 4.3 媒体管线 (`src/jobs/download.js`, `src/jobs/audio.js`)
- `download.js`：封装 `yt-dlp-wrap-plus`，实现断点续传、重试、网络错误分类。
- `audio.js`：调用 `ffmpeg` 输出目标比特率的 MP3，并可通过可配置参数生成 WAV 以提升 Whisper 准确率。
- 对 stdout/stderr 进行结构化解析，写入统一日志流并推送给 Renderer。

### 4.4 Whisper 执行 (`resources/runtime/whisper/`, `src/jobs/transcribe.js`)
- 管理 `whisper.cpp` 二进制与模型文件（默认 `ggml-large-v3-turbo-q5_0.bin`）。
- 运行命令示例：
  ```bash
  ./whisper \
    --model ggml-large-v3-turbo-q5_0.bin \
    --file audio.wav \
    --language auto \
    --output-format txt \
    --print-progress \
    --encoder metal
  ```
- 对 Metal 初始化失败时自动降级至 `--encoder cpu` 并在 UI 警示；记录推理耗时与模型版本。

### 4.5 存储结构
```
downloads/
  <jobId>/
    source.mp4
    audio.mp3
    audio.wav (可选)
    transcript.txt
    metadata.json
    logs.txt
```
- `metadata.json`：记录 URL、提交时间、作业阶段耗时、模型信息、命令参数、错误栈。
- `logs.txt`：聚合 yt-dlp、ffmpeg、whisper 输出，便于排查。

### 4.6 IPC & 数据约定
| 事件           | 方向              | 说明 |
|----------------|-------------------|------|
| `job:create`   | Renderer → Main    | 创建作业，请求参数校验与入列 |
| `job:accepted` | Main → Renderer   | 返回 `jobId`、初始状态 |
| `job:progress` | Main → Renderer   | 阶段名称、百分比、附加消息 |
| `job:log`      | Main → Renderer   | 流式日志行（节流后发送） |
| `job:result`   | Main → Renderer   | 完成/失败状态、产物路径 |
| `deps:check`   | Renderer ⇄ Main   | 校验离线依赖是否齐备 |
| `app:runSetupOffline` | Renderer → Main | 运行 setup-offline 脚本 |
| `app:setupOffline:progress` | Main → Renderer | 实时进度事件，格式：`{ type: 'stdout'|'stderr', chunk }` |
| `app:setupOffline:done` | Main → Renderer | 脚本完成事件，包含 `exitCode`、`stdout`、`stderr` |
| `app:setupOffline:error` | Main → Renderer | 脚本异常事件 |

## 5. 运行环境与依赖
- 必备二进制：`yt-dlp`、`ffmpeg`、`whisper.cpp`、Large V3 Turbo 量化模型。
- `npm run setup-offline`：
  1. 下载或验证上述二进制与模型。
  2. 写入 SHA256 校验值与版本信息至 `resources/runtime/manifest.json`。
  3. 在 macOS 上自动赋予执行权限，检测 Metal 支持（`system_profiler SPDisplaysDataType`）。
- **自动路径配置**：应用启动时自动检测 `resources/runtime/bin` 中的二进制文件，若配置文件中缺少 `yt-dlp-path` 或 `ffmpeg-path`，则自动写入默认路径值。尊重用户自定义路径，不覆盖现有配置。
- 用户可在设置中自定义 `downloads` 目录、最大并发、默认语言；配置持久化存储于应用 config（`app.getPath("userData")/config.json`）。

## 6. 离线与安全设计
- 主进程维护允许执行的二进制白名单，所有命令均以参数数组形式传递并记录日志，防止注入。
- 禁止 Renderer 直接发起网络请求；下载阶段只通过主进程控制的 `yt-dlp`。
- 提供「离线依赖检查」入口，逐项检测文件存在、版本、哈希，结果反馈至 UI。
- 作业目录权限设置为用户私有（`0o700`），避免跨用户访问。

## 7. 性能与并发
- 默认单任务串行；配置项允许设定最大并发（Metal 建议 =1，CPU 可选 >1）。
- 下载/转码/转写阶段均记录开始结束时间，供性能可视化和后续调优。
- 支持增量缓存：若检测到相同 URL 且用户允许复用，可跳过下载阶段直接进入转码/转写。
- Whisper 调度优先考虑 GPU 资源占用，避免与其他 GPU 作业冲突（通过互斥锁或信号量控制）。

## 8. 错误处理与可观测性
- 统一错误模型：包含 `stage`, `code`, `message`, `suggestion`，写入 `metadata.json` 并在 UI 显示。
- 关键节点（作业开始/结束、阶段切换、失败）写入 `logs.txt` 与 主进程控制台，便于用户反馈。
- 提供「导出诊断包」功能，打包 metadata、日志与配置，用于支持排查。
- 常见错误（网络中断、磁盘空间不足、Metal 不支持）提供引导提示与重试建议。

## 9. 测试策略
- 单元测试：对 `queue.js` 状态机、参数校验、命令构建进行 Node 层测试。
- 集成测试：使用模拟二进制（mock yt-dlp/ffmpeg/whisper）验证完整流水线与错误分支。
- 手动回归：真实设备上验证下载、提取、转写、导出；针对 macOS Metal、Intel CPU、Windows/Linux CPU fallback 分别执行。
- 性能基准：记录示例视频的端到端耗时、各阶段耗时、GPU 占用，作为后续优化基线。

## 10. 构建与交付
- `package.json` 的 `build.files` 中添加 `resources/runtime/whisper/**` 与模型文件；若模型过大，可在首次运行时拉取并校验。
- macOS 安装后执行 PostInstall：设置执行权限、Metal 检测、提示用户放置模型目录。
- Windows/Linux 构建保留 CPU 路径，UI 中标注 Metal 加速仅限 macOS。
- 官方 Release 中附带离线依赖版本信息与 SHA256，方便用户验证。

## 11. 未来扩展
- 支持批量 URL、播放列表、进度恢复、字幕（SRT/JSON）导出、多语言翻译模式。
- 抽象模型接口，允许替换为其他推理后端（如 `faster-whisper`, `whisper-large-v3` 非量化版、OpenCL/CUDA）。
- 引入自动更新离线依赖的机制，结合签名校验以确保安全性。
- 扩展 UI：作业历史视图、性能仪表、系统资源占用提示。
