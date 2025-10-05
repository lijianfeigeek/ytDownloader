/**
 * 下载模块 - 封装 yt-dlp-wrap-plus
 * 提供视频下载功能，支持进度回调和错误处理
 */

const path = require('path');
const os = require('os');

// 默认 yt-dlp 二进制路径配置
const DEFAULT_YTDLP_PATHS = {
  win32: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'yt-dlp.exe'),
  darwin: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'yt-dlp'),
  linux: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'yt-dlp'),
  freebsd: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'yt-dlp')
};

/**
 * 获取默认 yt-dlp 路径
 * @returns {string} yt-dlp 二进制文件路径
 */
function getDefaultYtDlpPath() {
  const platform = os.platform();
  return DEFAULT_YTDLP_PATHS[platform] || DEFAULT_YTDLP_PATHS.linux;
}

/**
 * 创建 yt-dlp 实例工厂函数
 * @param {string} ytDlpPath - yt-dlp 二进制文件路径
 * @returns {Object} yt-dlp 实例
 */
function createYtDlpInstance(ytDlpPath = null) {
  const YtDlpWrap = require('yt-dlp-wrap-plus').default;

  if (ytDlpPath) {
    return new YtDlpWrap(ytDlpPath);
  }

  // 使用默认路径
  const defaultPath = getDefaultYtDlpPath();
  return new YtDlpWrap(defaultPath);
}

/**
 * 自定义下载错误类
 */
class DownloadError extends Error {
  constructor(message, code = 'DOWNLOAD_ERROR', details = {}) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack
    };
  }
}

/**
 * 验证作业对象
 * @param {Object} job - 作业对象
 * @throws {DownloadError} 当作业对象无效时
 */
function validateJob(job) {
  if (!job || typeof job !== 'object') {
    throw new DownloadError('作业对象必须是有效的对象', 'INVALID_JOB');
  }

  if (!job.id) {
    throw new DownloadError('作业缺少必需的 id 字段', 'MISSING_JOB_ID');
  }

  if (!job.url) {
    throw new DownloadError('作业缺少必需的 url 字段', 'MISSING_URL');
  }

  if (!job.outputDir) {
    throw new DownloadError('作业缺少必需的 outputDir 字段', 'MISSING_OUTPUT_DIR');
  }

  // 验证 URL 格式
  try {
    new URL(job.url);
  } catch {
    throw new DownloadError('无效的 URL 格式', 'INVALID_URL', { url: job.url });
  }
}

/**
 * 生成输出文件名
 * @param {Object} job - 作业对象
 * @returns {string} 格式化的文件名（不含扩展名）
 */
function generateOutputFilename(job) {
  // 使用作业ID作为基础文件名，确保唯一性
  const baseName = job.id;

  // 如果有标题信息，进行清理并用作文件名
  if (job.metadata && job.metadata.title) {
    const cleanTitle = job.metadata.title
      .replace(/[<>:"/\\|?*]/g, '_') // 替换非法字符
      .replace(/\s+/g, '_') // 替换空格
      .substring(0, 50); // 限制长度

    return `${baseName}_${cleanTitle}`;
  }

  return baseName;
}

/**
 * 构建 yt-dlp 下载参数
 * @param {Object} job - 作业对象
 * @param {string} outputFilename - 输出文件名
 * @returns {Array} yt-dlp 参数数组
 */
function buildYtDlpOptions(job, outputFilename) {
  const outputPath = path.join(job.outputDir, `${outputFilename}.%(ext)s`);

  const options = [
    '--no-warnings',           // 禁用警告
    '--no-progress',           // 禁用内置进度条，我们使用事件回调
    '--newline',               // 每行输出新事件
    '--format', 'best[ext=mp4]/best[height<=720]/best', // 格式优先级
    '--output', outputPath,    // 输出路径
    '--embed-metadata',        // 嵌入元数据
    '--embed-chapters',        // 嵌入章节信息
  ];

  // 添加自定义选项
  if (job.options) {
    // 如果指定保持视频，不添加仅音频选项
    if (!job.options.keepVideo) {
      options.push('--extract-audio', '--audio-format', 'mp3');
    }

    // 语言偏好
    if (job.options.language && job.options.language !== 'auto') {
      options.push('--sub-langs', job.options.language);
    }
  }

  return options;
}

/**
 * 解析 yt-dlp 进度事件
 * @param {Object} event - yt-dlp 进度事件
 * @returns {Object} 标准化的进度信息
 */
function parseProgressEvent(event) {
  const progress = {
    percent: 0,
    speed: 0,
    eta: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    message: ''
  };

  try {
    // 根据 yt-dlp-wrap-plus 的事件结构解析进度
    if (event.percent) {
      progress.percent = Math.round(event.percent);
    }

    if (event.speed) {
      progress.speed = event.speed;
    }

    if (event.eta) {
      progress.eta = event.eta;
    }

    if (event.total) {
      progress.totalBytes = event.total;
    }

    if (event.downloaded) {
      progress.downloadedBytes = event.downloaded;
    }

    // 构建进度消息
    const messages = [];
    if (progress.percent > 0) {
      messages.push(`${progress.percent}%`);
    }
    if (progress.speed > 0) {
      messages.push(`${(progress.speed / 1024 / 1024).toFixed(1)}MB/s`);
    }
    if (progress.eta > 0) {
      const etaMinutes = Math.floor(progress.eta / 60);
      const etaSeconds = progress.eta % 60;
      messages.push(`ETA: ${etaMinutes}:${etaSeconds.toString().padStart(2, '0')}`);
    }

    progress.message = messages.join(' ');
  } catch (error) {
    // 如果解析失败，返回默认进度
    progress.message = '解析进度信息...';
  }

  return progress;
}

/**
 * 下载视频文件
 * @param {Object} job - 作业对象
 * @param {Function} onProgress - 进度回调函数 (progress) => void
 * @param {Object} options - 下载选项
 * @param {string} options.ytDlpPath - yt-dlp 二进制文件路径 (可选)
 * @param {Object} options.ytDlpInstance - 自定义 yt-dlp 实例 (用于测试)
 * @returns {Promise<string>} 下载完成的文件路径
 * @throws {DownloadError} 当下载失败时
 */
async function download(job, onProgress, options = {}) {
  validateJob(job);

  if (typeof onProgress !== 'function') {
    throw new DownloadError('onProgress 必须是一个函数', 'INVALID_PROGRESS_CALLBACK');
  }

  const outputFilename = generateOutputFilename(job);
  const ytDlpOptions = buildYtDlpOptions(job, outputFilename);

  let ytDlpProcess = null;
  let downloadedFilePath = null;

  try {
    // 创建 yt-dlp 实例 (支持依赖注入)
    if (options.ytDlpInstance) {
      ytDlpProcess = options.ytDlpInstance;
    } else {
      ytDlpProcess = createYtDlpInstance(options.ytDlpPath);
    }

    // 设置下载参数
    ytDlpProcess.setOptions(ytDlpOptions);

    // 监听进度事件
    ytDlpProcess.on('progress', (progressEvent) => {
      try {
        const progress = parseProgressEvent(progressEvent);
        onProgress(progress);
      } catch (error) {
        console.error('解析进度事件失败:', error);
        // 不抛出错误，继续下载
      }
    });

    // 监听错误事件 (在测试中不打印错误信息)
    if (!options.ytDlpInstance || !options.ytDlpInstance.isMock) {
      ytDlpProcess.on('error', (error) => {
        console.error('yt-dlp 错误:', error);
      });
    }

    // 监听完成事件
    ytDlpProcess.on('finish', (filePath) => {
      downloadedFilePath = filePath;
    });

    // 开始下载
    console.log(`开始下载: ${job.url}`);
    const result = await ytDlpProcess.exec(job.url);

    if (!result || !downloadedFilePath) {
      throw new DownloadError('下载完成但未获取到文件路径', 'NO_FILE_PATH');
    }

    console.log(`下载完成: ${downloadedFilePath}`);
    return downloadedFilePath;

  } catch (error) {
    console.error('下载失败:', error);

    // 如果是自定义错误，直接抛出
    if (error instanceof DownloadError) {
      throw error;
    }

    // 否则包装为 DownloadError
    const downloadError = new DownloadError(
      `下载失败: ${error.message}`,
      'DOWNLOAD_EXEC_ERROR',
      {
        originalError: error.message,
        url: job.url,
        jobId: job.id
      }
    );

    throw downloadError;

  } finally {
    // 清理资源
    if (ytDlpProcess) {
      try {
        ytDlpProcess.removeAllListeners();
      } catch (error) {
        console.error('清理 yt-dlp 监听器失败:', error);
      }
    }
  }
}

module.exports = {
  download,
  DownloadError,
  // 用于测试和高级配置的工具函数
  createYtDlpInstance,
  getDefaultYtDlpPath,
  validateJob,
  generateOutputFilename,
  buildYtDlpOptions,
  parseProgressEvent
};