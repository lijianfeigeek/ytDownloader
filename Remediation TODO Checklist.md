# Remediation TODO Checklist

  - [x] Task 1: Fix Offline Dependency Detection Cache (ultrathink)
    Prompt for Claude Code:

    你是一位资深的 Electron 主进程工程师，请在 ultrathink 模式下修复 setup-offline GUI 运行后依赖状态仍然显示缺失的问题。
    目标：
      1. 深入 scripts/setup-offline.js、main/services/dependencyService.ts、renderer/store/runtimeSlice.ts，找出状态未刷新的根因（可能是缓存、路径或异步竞态）。
      2. 修改主进程与渲染进程的依赖检测逻辑，实现运行 setup-offline 后自动重新执行依赖检查，并返回最新成功/失败结果。
    约束与风险：
      - 不要更改 setup-offline 的下载位置（仍为 resources/runtime）。
      - 保持 CLI npm run setup-offline 行为不变。
      - 注意处理 Mac/Win/Linux 的路径差异，防止 regression。
    示例提示：在 dependencyService 内增加 await runSetupOffline().then(() => refreshDependencies())。
    输出结构：
      - 根因分析（列表）
      - 代码修改说明（按文件列出）
      - 验证记录
    验收检查清单：
      - [x] 清空 resources/runtime 后运行 GUI “运行 setup-offline”，最终所有依赖变为✅。
      - [x] 重启应用后再次检查，状态保持 ✅。
      - [x] npm run setup-offline 仍可在 CLI 成功运行。
    Checklist: run GUI setup-offline after wiping runtime; ensure table shows all ✅; restart app to confirm persistence; confirm CLI script unaffected.
    Checklist: run GUI setup-offline after wiping runtime; ensure table shows all ✅; restart app to confirm persistence; confirm CLI script unaffected.
    
  - [ ] Task 2: Refresh Renderer Status Post Setup Execution
    Prompt for Claude Code:

    你是一位资深的前端工程师，请在 renderer 端实现 setup-offline 执行完成后的状态刷新。
    目标：
      1. 在 renderer/store/runtimeSlice.ts 或等效模块中，监听 setupOfflineProgress 的 done 事件后自动 dispatch fetchRuntimeStatus。
      2. 更新离线依赖 Modal，在展示 “运行 setup-offline” 的按钮附近增加执行成功/失败的即时提示。
    约束与风险：
      - 不要引入额外的全局状态管理库。
      - 保证在进度流结束前不会触发重复拉取。
    示例：在 IPC 监听器中添加 builder.addCase(setupOfflineDone, fetchRuntimeStatus)。
    输出结构：
      - 状态流更新说明
      - 关键代码片段
      - UI 效果描述
    验收检查清单：
      - [ ] GUI 中点击运行脚本后，进度完成即刷新表格且显示成功提示。
      - [ ] 若脚本失败，显示明确错误并保持表格为 ❌。
      - [ ] 多次点击运行不会产生重复请求或内存泄露。

    Checklist: confirm status auto-refresh; success/ failure messaging displayed; monitor for duplicate requests via devtools.
    
  - [ ] Task 3: Merge Transcribe Option into Existing Download Modal
    Prompt for Claude Code:

    你是一位资深的 Electron + React 架构师，请将“生成文本”选项合并到当前的下载对话框中，而非单独菜单。
    目标：
      1. 在现有的剪贴板流程 UI 中，保持“下载视频/音频”选择，并添加“下载后执行：无 / 提取音频 / 转文本”单选或复选区域。
      2. 默认保持原行为（无后置动作），用户可勾选“转文本”以触发转写。
    约束与风险：
      - 不得破坏既有快捷键（Ctrl/Cmd+V）。
      - 交互需简洁，不新增冗余弹窗。
    示例：在 DownloadOptionsPanel 中新增 `postAction` 字段并绑定状态。
    输出结构：
      - UI 改动说明
      - 组件/状态字段列表
      - 可视化描述或截图占位
    验收检查清单：
      - [ ] 粘贴链接后仍可选择视频/音频。
      - [ ] 新的“转文本”选项可与视频/音频组合使用。
      - [ ] 未选中时行为与旧版本一致。

    Checklist: verify UI flow via manual test; ensure default behavior unaffected; new option visible and functional.
    
  - [ ] Task 4: Extend Job Orchestrator for Optional Transcribe Step
    Prompt for Claude Code:

    你是一位资深的 Node 后端工程师，请扩展现有作业状态机，使“转文本”作为下载任务的可选后置步骤。
    目标：
      1. 在 job pipeline 中新增 postAction 字段，复用既有下载逻辑，仅在完成下载后才调用转写模块。
      2. 确保错误处理：若转写失败，提示用户并保留已下载文件。
    约束与风险：
      - 不要复制全新的下载逻辑，必须复用现有 downloadExecutor。
      - 保障状态机的事件顺序（下载完成 → 可选提取 → 可选转写）。
    示例代码：`if (job.postAction === 'transcribe') await whisperService.transcribe(audioPath);`
    输出结构：
      - 状态机拓扑说明
      - 关键函数签名
      - 错误处理策略
    验收检查清单：
      - [ ] 触发“转文本”时先完成下载，再执行 whisper。
      - [ ] 下载失败不会进入转写阶段。
      - [ ] 转写失败时，状态显示失败且保留音频文件路径。

    Checklist: run job with transcribe: ensure steps order; simulate failure to check behavior.
    
  - [ ] Task 5: Auto-bind Bundled Binaries for Transcribe Action
    Prompt for Claude Code:

    你是一位资深的跨平台 Electron 工程师，请确保当 setup-offline 下载完成后，新建的转文本任务自动引用 resources/runtime 下的二进制。
    目标：
      1. 更新配置写入逻辑，优先读取本地捆绑路径（yt-dlp、ffmpeg、whisper.cpp、模型）。
      2. 若本地路径缺失，保持已有的手动配置 fallback，不弹出多余警告。
    约束与风险：
      - 不要硬编码用户路径；使用 path.resolve(app.getAppPath(), 'resources/runtime/...')。
      - 兼容 macOS / Windows / Linux。
    示例：`config.transcribe.whisperBinary = runtimeLocator.find('whisper').executablePath;`
    输出结构：
      - 配置流程说明
      - 关键路径映射表
      - 平台差异处理
    验收检查清单：
      - [ ] 清空配置后运行 setup-offline，一次重启即可自动填充默认路径。
      - [ ] 若删除资源目录，应用提示缺失而不崩溃。
      - [ ] CLI 与 GUI 调用转写均成功找到二进制。

    Checklist: test after clearing config; ensure fallback messaging; run CLI/GUI transcribe job.
  - [ ] Task 6: Regression Tests & Docs Update
    Prompt for Claude Code:

    你是一位资深的测试与文档工程师，请为新的离线依赖与转写流程补充覆盖并更新文档。
    目标：
      1. 添加至少一个自动化测试（可使用 Playwright / Spectron / Jest-IPC stub）验证运行 setup-offline 后依赖检测成功。
      2. 更新 README / AGENTS.md，说明统一下载流程与新的“转文本”选项。
    约束与风险：
      - 测试需可在 CI（无 GUI）运行，必要时 mock IPC。
      - 文档保持 200~400 字节的增量，避免重复信息。
    示例：使用 Jest 对 dependencyService.runSetupOffline mock 成功后断言 state=ready。
    输出结构：
      - 新增测试列表
      - 文档变化摘要
      - CI 运行说明
    验收检查清单：
      - [ ] npm test 在本地与 CI 均通过（含新用例）。
      - [ ] 新文档明确说明“运行 setup-offline 后需看到全绿”。
      - [ ] 版本记录或 CHANGELOG 更新包含本次修复。

    Checklist: run npm test; review docs for clarity; ensure changelog entry.