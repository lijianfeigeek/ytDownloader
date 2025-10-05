# Jobs 模块文档

本目录包含 YTDownloader 作业系统的核心模块，实现了一个完整的离线转录流水线。

## 模块概览

### `queue.js` - 作业队列和状态管理
- **功能**: 管理作业生命周期、状态转换、事件发布
- **核心类**: `JobQueue`, `JobStatus`
- **API**:
  ```js
  const job = JobQueue.add({ url, outputDir, options });
  JobQueue.advanceStage(jobId, newStatus);
  JobQueue.updateProgress(jobId, current, total, message);
  JobQueue.subscribe(listener);
  ```

### `download.js` - 视频下载模块
- **功能**: 封装 yt-dlp-wrap-plus，提供视频下载功能
- **核心类**: `DownloadError`
- **API**:
  ```js
  const { download } = require('./download');
  const filePath = await download(job, (progress) => {
    console.log(`进度: ${progress.percent}%`);
  });
  ```

### `audio.js` - 音频处理模块 (计划中)
- **功能**: 使用 ffmpeg 提取和转换音频
- **支持格式**: MP3, WAV, AAC 等

### `transcribe.js` - 转写模块 (计划中)
- **功能**: 使用 whisper.cpp 进行离线语音转写
- **支持**: Metal GPU 加速 (macOS), CPU fallback

## 使用示例

### 基本下载流程

```js
const { download, DownloadError } = require('./download');
const { JobQueue, JobStatus } = require('./queue');

// 1. 创建作业
const job = JobQueue.add({
  url: 'https://youtube.com/watch?v=example',
  outputDir: './downloads',
  options: {
    keepVideo: true,
    language: 'auto'
  }
});

// 2. 下载视频
try {
  const filePath = await download(job, (progress) => {
    JobQueue.updateProgress(job.id, progress.percent, 100, progress.message);
  });

  console.log('下载完成:', filePath);
  JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);

} catch (error) {
  if (error instanceof DownloadError) {
    console.error('下载失败:', error.code, error.message);
    JobQueue.fail(job.id, { code: error.code, message: error.message });
  }
}
```

### 错误处理

```js
const { DownloadError } = require('./download');

try {
  await download(job, onProgress);
} catch (error) {
  if (error instanceof DownloadError) {
    console.error('错误代码:', error.code);
    console.error('错误详情:', error.details);

    // 根据错误代码处理不同情况
    switch (error.code) {
      case 'INVALID_URL':
        // 处理无效URL
        break;
      case 'DOWNLOAD_EXEC_ERROR':
        // 处理下载执行错误
        break;
      default:
        // 处理其他错误
        break;
    }
  }
}
```

## 测试

运行各个模块的测试:

```bash
# 作业队列测试
npm run test

# 下载模块测试
npm run test:download

# 运行所有测试 (需要添加)
npm run test:all
```

## 作业状态流转

```
PENDING → DOWNLOADING → EXTRACTING → TRANSCRIBING → PACKING → COMPLETED
   ↓         ↓           ↓            ↓          ↓        ↓
CANCELLED  FAILED      FAILED       FAILED     FAILED   (终态)
```

## 配置选项

### 下载选项
- `keepVideo`: 是否保留视频文件 (默认: false)
- `language`: 语言偏好 (默认: 'auto')
- `format`: 视频格式优先级
- `quality`: 视频质量选择

### 作业目录结构
```
downloads/
  <jobId>/
    source.mp4          # 原始视频
    audio.mp3           # 提取的音频
    audio.wav           # 高质量音频 (用于转写)
    transcript.txt      # 转写结果
    metadata.json       # 作业元数据
    logs.txt            # 详细日志
```

## 扩展开发

### 添加新的作业阶段

1. 在 `JobStatus` 中添加新状态
2. 在 `VALID_TRANSITIONS` 中定义转换规则
3. 创建相应的模块文件
4. 更新测试用例

### 错误代码规范

使用统一的错误代码格式: `模块_错误类型`

- `DOWNLOAD_INVALID_URL`: 下载模块 - 无效URL
- `AUDIO_EXTRACTION_FAILED`: 音频模块 - 提取失败
- `TRANSCRIBE_MODEL_NOT_FOUND`: 转写模块 - 模型未找到

## 注意事项

1. **错误处理**: 所有异步操作都应该捕获错误并转换为自定义错误类
2. **进度报告**: 使用四舍五入的百分比，避免频繁的小数更新
3. **资源清理**: 在 `finally` 块中清理事件监听器和临时资源
4. **路径安全**: 使用 `path.join()` 构建路径，避免路径注入攻击