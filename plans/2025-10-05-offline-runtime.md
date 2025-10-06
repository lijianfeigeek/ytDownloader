# 离线运行时修复待办清单

- [x] **1. 更新 Renderer 默认路径检测**  
  提示词：
  ```markdown
  你是一位资深的Electron前端工程师，请在 `src/renderer.js` 中实现以下调整：
  1. 在文件开头新增 `const runtimeBinDir = path.join(__dirname, '..', 'resources', 'runtime', 'bin');`，并派生 `bundledYtDlp`、`bundledFfmpeg` 路径（根据平台附加 `.exe`）。
  2. 在现有 yt-dlp 检测逻辑之前（`possiblePaths` 之后）优先检查 `bundledYtDlp`，若存在则设置 `ytDlpPath`、`ytDlpIsPresent`、`ytDlp`、`localStorage`，并避开 `showMacYtdlpPopup()`。
  3. 在 ffmpeg 变量初始化处优先使用 `bundledFfmpeg`，保持原有 fallback 逻辑。
  约束：不移除现有 Homebrew/环境变量/which 逻辑，确保其它平台仍能走旧流程；不要在此任务修改 UI 文案。
  CHECKLIST:
  - [x] `bundledYtDlp` 与 `bundledFfmpeg` 常量定义完成
  - [x] 内置二进制存在时不再触发 Homebrew 弹框
  - [x] macOS/Windows/Linux 均能回退到原有路径查找
  ```

- [x] **2. 升级 setup-offline 脚本：自动下载依赖**  
ultrathink 提示词：
  ```markdown
  ultrathink 你是一位资深Node脚本工程师，请重构 `scripts/setup-offline.js` 达成以下目标：
  1. 在检测缺失依赖后，自动下载/复制 `yt-dlp`、`ffmpeg`、`whisper.cpp`、大型模型至 `resources/runtime/bin` 与 `resources/runtime/whisper/models`；支持 macOS/Windows/Linux（可使用平台分支决定下载源）。
  2. 为下载过程添加进度/提示输出，并在完成后重新执行依赖检查给出最终报告。
  3. 脚本应可被 `npm run setup-offline` 调用，无需额外参数；若某依赖已存在则跳过。
  约束：避免引入重量级依赖库；下载失败时应提供重试提示但不中断后续检查。
  CHECKLIST:
  - [x] 自动下载逻辑覆盖四个必需组件
  - [x] 脚本末尾输出更新后的依赖表
  - [x] 在干净环境下运行一次后全部状态均为 Ready
  ```

- [x] **3. 增强 GUI 依赖检查弹窗**  
  提示词：
  ```markdown
  你是一位资深Electron前端工程师，请更新 `src/transcribe.js` 与 `html/transcribe.html`：
  1. 在依赖检查模态中，当存在缺失依赖时保持“运行 setup-offline”按钮可见，点击后通过 IPC `app:runSetupOffline` 触发脚本，并在脚本执行期间禁用按钮与展示加载状态。
  2. 监听主进程推送的 `app:setupOffline:progress`、`app:setupOffline:done`、`app:setupOffline:error` 事件，在模态内实时显示进度并于脚本完成后自动调用 `checkDependencies()` 刷新结果。
  约束：确保 UI 操作不会阻塞主线程；日志面板或模态内必须展示实时反馈。
  CHECKLIST:
  - [x] 按钮触发脚本且执行期间状态可见
  - [x] 接收到进度/完成/错误事件时界面更新正确
  - [x] 脚本结束后依赖列表自动刷新
  ```

- [x] **4. 提供 setup-offline 进度 IPC**  
  提示词：
  ```markdown
  你是一位资深Electron主进程工程师，请完善 `main.js` 的 `app:runSetupOffline` 处理：
  1. 使用 `child_process.spawn`（不可 `exec`）运行脚本，实时监听 stdout/stderr 并通过 `win.webContents.send('app:setupOffline:progress', { type: 'stdout'|'stderr', chunk })` 推送。
  2. 脚本退出时发送 `app:setupOffline:done`，包含 `exitCode`、`stdout`、`stderr` 汇总；异常则发送 `app:setupOffline:error`。
  3. 处理并发点击：若已有脚本在运行，直接返回正在执行的提示。
  CHECKLIST:
  - [x] 前端能收到进度与完成事件
  - [x] 脚本退出后没有残留进程
  - [x] 重复触发时不会并发创建多份脚本
  ```

- [x] **5. 自动配置默认二进制路径**  
  提示词：
  ```markdown
  你是一位资深Electron架构师，请在主进程启动时自动写入本地二进制路径：
  1. 在 `createWindow` 之前读取 `config.json`，若缺少 `yt-dlp-path`/`ffmpeg-path` 且 `resources/runtime/bin` 中存在对应文件，则写入这些默认值。
  2. 若用户已经配置自定义路径或文件缺失，则保持原样，不要覆盖。
  CHECKLIST:
  - [x] 首次启动后 `config.json` 包含默认路径
  - [x] 已存在的自定义配置不会被覆盖
  - [x] 内置文件不存在时不会写入无效路径
  ```

- [x] **6. 回归测试与文档更新**  
  提示词：
  ```markdown
  你是一位资深QA工程师，请执行以下回归步骤并更新文档：
  1. 删除 `resources/runtime/bin` 与模型目录，运行 `npm run setup-offline`，确认自动下载并最终通过 CLI/GUI 检查。
  2. 启动应用，打开 Offline Transcribe → 依赖检查 → 运行 setup-offline，验证进度与完成提示正常，依赖状态刷新为 Ready。
  3. 更新 README / ARCHITECTURE / AGENTS 中关于依赖下载与默认路径的说明。
  CHECKLIST:
  - [x] CLI 与 GUI 依赖检查均显示 Ready
  - [x] README/文档包含最新操作指引
  - [x] QA 记录（步骤、结果、截图/日志）已归档
  ```
