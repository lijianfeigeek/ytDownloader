/**
 * Whisper 转写模块 - 使用 whisper.cpp 进行本地语音转文字
 * 支持 Metal GPU 加速和 CPU fallback，实时进度解析
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 默认 whisper.cpp 二进制路径配置
const DEFAULT_WHISPER_PATHS = {
  win32: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'whisper.exe'),
  darwin: path.join(process.cwd(), 'resources', 'runtime', 'whisper', 'whisper-macos'),
  linux: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'whisper'),
  freebsd: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'whisper')
};

// 默认模型路径配置
const DEFAULT_MODEL_PATHS = {
  win32: path.join(process.cwd(), 'resources', 'runtime', 'whisper', 'models', 'ggml-large-v3-turbo-q5_0.bin'),
  darwin: path.join(process.cwd(), 'resources', 'runtime', 'whisper', 'models', 'ggml-large-v3-turbo-q5_0.bin'),
  linux: path.join(process.cwd(), 'resources', 'runtime', 'whisper', 'models', 'ggml-large-v3-turbo-q5_0.bin'),
  freebsd: path.join(process.cwd(), 'resources', 'runtime', 'whisper', 'models', 'ggml-large-v3-turbo-q5_0.bin')
};

/**
 * 获取默认 whisper.cpp 路径
 * @returns {string} whisper.cpp 二进制文件路径
 */
function getDefaultWhisperPath() {
  const platform = os.platform();
  return DEFAULT_WHISPER_PATHS[platform] || DEFAULT_WHISPER_PATHS.linux;
}

/**
 * 获取默认模型路径
 * @returns {string} 模型文件路径
 */
function getDefaultModelPath() {
  const platform = os.platform();
  return DEFAULT_MODEL_PATHS[platform] || DEFAULT_MODEL_PATHS.linux;
}

/**
 * 自定义转写错误类
 */
class TranscribeError extends Error {
  constructor(message, code = 'TRANSCRIBE_ERROR', details = {}) {
    super(message);
    this.name = 'TranscribeError';
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
 * 验证输入参数
 * @param {Object} job - 作业对象
 * @param {string} audioPath - 音频文件路径
 * @param {Object} opts - 转写选项
 * @throws {TranscribeError} 当参数无效时
 */
function validateInput(job, audioPath, opts = {}) {
  if (!job || typeof job !== 'object') {
    throw new TranscribeError('作业对象必须是有效的对象', 'INVALID_JOB');
  }

  if (!job.id || !job.outputDir) {
    throw new TranscribeError('作业缺少必需的 id 或 outputDir 字段', 'MISSING_JOB_FIELDS');
  }

  if (!audioPath || typeof audioPath !== 'string') {
    throw new TranscribeError('音频文件路径必须是非空字符串', 'INVALID_AUDIO_PATH');
  }

  if (!fs.existsSync(audioPath)) {
    throw new TranscribeError('音频文件不存在', 'AUDIO_FILE_NOT_FOUND', { audioPath });
  }

  // 验证音频文件格式
  const audioExt = path.extname(audioPath).toLowerCase();
  const audioExtensions = ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'];
  if (!audioExtensions.includes(audioExt)) {
    throw new TranscribeError(
      `不支持的音频格式: ${audioExt}`,
      'UNSUPPORTED_AUDIO_FORMAT',
      { audioPath, extension: audioExt }
    );
  }

  // 验证选项
  if (opts.model && typeof opts.model !== 'string') {
    throw new TranscribeError('模型路径必须是字符串', 'INVALID_MODEL_PATH');
  }

  if (opts.language && typeof opts.language !== 'string') {
    throw new TranscribeError('语言代码必须是字符串', 'INVALID_LANGUAGE');
  }

  if (opts.useMetal !== undefined && typeof opts.useMetal !== 'boolean') {
    throw new TranscribeError('useMetal 必须是布尔值', 'INVALID_USE_METAL');
  }
}

/**
 * 检测 Metal 支持状态
 * @returns {Promise<boolean>} 是否支持 Metal
 */
async function detectMetalSupport() {
  return new Promise((resolve) => {
    if (os.platform() !== 'darwin') {
      resolve(false);
      return;
    }

    // 在 macOS 上检测 Metal 支持
    const { spawn } = require('child_process');
    const systemProfiler = spawn('system_profiler', ['SPDisplaysDataType', '-json']);

    let output = '';
    systemProfiler.stdout.on('data', (data) => {
      output += data.toString();
    });

    systemProfiler.on('close', (code) => {
      if (code !== 0) {
        resolve(false);
        return;
      }

      try {
        const displays = JSON.parse(output);
        const hasMetal = displays.SPDisplaysDataType?.some(display =>
          display.Metal || display.supports_metal
        );
        resolve(hasMetal === true);
      } catch (error) {
        // 如果解析失败，假设支持 Metal（大多数现代 Mac 都支持）
        resolve(true);
      }
    });

    systemProfiler.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * 构建 whisper.cpp 命令参数
 * @param {string} modelPath - 模型文件路径
 * @param {string} audioPath - 音频文件路径
 * @param {Object} opts - 转写选项
 * @returns {Array} whisper.cpp 命令参数数组
 */
function buildWhisperArgs(modelPath, audioPath, opts = {}) {
  const args = [
    '--model', modelPath,
    '--file', audioPath,
    '--output-txt',
    '--print-progress'
  ];

  // 语言设置
  if (opts.language && opts.language !== 'auto') {
    args.push('--language', opts.language);
  }

  // Metal 编码器设置
  if (opts.useMetal !== false && os.platform() === 'darwin') {
    args.push('--encoder', 'metal');
  }

  // 其他选项
  if (opts.threads) {
    args.push('--threads', opts.threads.toString());
  }

  if (opts.translate) {
    args.push('--translate');
  }

  return args;
}

/**
 * 解析 whisper.cpp 进度输出
 * @param {string} output - whisper.cpp 输出内容
 * @returns {Object|null} 解析出的进度信息
 */
function parseProgressOutput(output) {
  // 匹配进度格式: [percent] 时间信息
  const progressMatch = output.match(/\[(\d+)%\]/);

  if (progressMatch) {
    const percent = parseInt(progressMatch[1]);

    // 尝试解析速度和 ETA 信息
    const speedMatch = output.match(/(\d+\.\d+)x/);
    const etaMatch = output.match(/in (\d+)s/);

    return {
      percent,
      speed: speedMatch ? parseFloat(speedMatch[1]) : 0,
      eta: etaMatch ? parseInt(etaMatch[1]) : 0,
      message: output.trim()
    };
  }

  return null;
}

/**
 * 执行 whisper.cpp 命令
 * @param {Array} args - whisper.cpp 命令参数
 * @param {string} whisperPath - whisper.cpp 二进制路径
 * @param {Function} onProgress - 进度回调函数
 * @param {Function} onLog - 日志回调函数
 * @param {Function} spawnFn - spawn 函数 (用于测试依赖注入)
 * @returns {Promise<Object>} 执行结果
 */
function executeWhisper(args, whisperPath, onProgress = null, onLog = null, spawnFn = null) {
  return new Promise((resolve, reject) => {
    const spawnFunc = spawnFn || require('child_process').spawn;
    const process = spawnFunc(whisperPath, args);

    let stdout = '';
    let stderr = '';
    let lastProgress = 0;
    const startTime = Date.now();

    // 捕获标准输出
    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;

      if (onLog) {
        onLog('stdout', output);
      }

      // 解析进度信息
      if (onProgress) {
        const progress = parseProgressOutput(output);
        if (progress && progress.percent > lastProgress) {
          lastProgress = progress.percent;
          onProgress(progress);
        }
      }
    });

    // 捕获标准错误
    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;

      if (onLog) {
        onLog('stderr', output);
      }
    });

    // 监听进程错误
    process.on('error', (error) => {
      reject(new TranscribeError(
        `whisper.cpp 进程错误: ${error.message}`,
        'WHISPER_PROCESS_ERROR',
        { originalError: error.message, args }
      ));
    });

    // 监听进程结束
    process.on('close', (code, signal) => {
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000; // 转换为秒

      if (signal) {
        reject(new TranscribeError(
          `whisper.cpp 进程被信号终止: ${signal}`,
          'WHISPER_TERMINATED',
          { signal, args, stderr }
        ));
      } else if (code !== 0) {
        reject(new TranscribeError(
          `whisper.cpp 执行失败 (退出码: ${code})`,
          'WHISPER_FAILED',
          { exitCode: code, args, stderr: stderr || '无错误输出' }
        ));
      } else {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          duration,
          exitCode: code
        });
      }
    });
  });
}

/**
 * 检查 Metal 初始化错误并自动 fallback 到 CPU
 * @param {string} stderr - 错误输出
 * @returns {boolean} 是否需要 fallback 到 CPU
 */
function shouldFallbackToCpu(stderr) {
  const metalErrorPatterns = [
    'metal initialization failed',
    'metal device not found',
    'metal command buffer failed',
    'metal compilation failed',
    'failed to initialize metal',
    'metal is not supported'
  ];

  const lowerStderr = stderr.toLowerCase();
  return metalErrorPatterns.some(pattern => lowerStderr.includes(pattern));
}

/**
 * 从音频文件转写文本
 * @param {Object} job - 作业对象
 * @param {string} audioPath - 音频文件路径
 * @param {Object} opts - 转写选项
 * @param {string} opts.model - 模型文件路径 (可选)
 * @param {string} opts.language - 语言代码 (默认: "auto")
 * @param {boolean} opts.useMetal - 是否使用 Metal 加速 (默认: 自动检测)
 * @param {boolean} opts.translate - 是否翻译到英文 (默认: false)
 * @param {number} opts.threads - 线程数 (可选)
 * @param {Function} opts.onProgress - 进度回调函数 (progress) => void
 * @param {Function} opts.onLog - 日志回调函数 (type, data) => void
 * @param {string} opts.whisperPath - whisper.cpp 二进制路径 (可选)
 * @param {Function} opts.spawnFn - 自定义 spawn 函数 (用于测试)
 * @returns {Promise<Object>} 包含转写文件路径和耗时的对象
 * @throws {TranscribeError} 当转写失败时
 */
async function transcribe(job, audioPath, opts = {}) {
  validateInput(job, audioPath, opts);

  const {
    model = null,
    language = 'auto',
    useMetal = null, // null 表示自动检测
    translate = false,
    threads = null,
    onProgress = null,
    onLog = null,
    whisperPath = null,
    spawnFn = null
  } = opts;

  // 获取实际路径
  const actualWhisperPath = whisperPath || getDefaultWhisperPath();
  const actualModelPath = model || getDefaultModelPath();

  // 验证文件存在（仅在没有使用依赖注入时检查）
  if (!spawnFn && !fs.existsSync(actualWhisperPath)) {
    throw new TranscribeError(
      'whisper.cpp 二进制文件不存在',
      'WHISPER_NOT_FOUND',
      { whisperPath: actualWhisperPath }
    );
  }

  if (!spawnFn && !fs.existsSync(actualModelPath)) {
    throw new TranscribeError(
      '模型文件不存在',
      'MODEL_NOT_FOUND',
      { modelPath: actualModelPath }
    );
  }

  // 生成输出文件路径
  const outputPath = path.join(job.outputDir, 'transcript.txt');

  // 检查输出目录
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 检测 Metal 支持（如果未明确指定）
  let shouldUseMetal = useMetal;
  if (useMetal === null) {
    shouldUseMetal = await detectMetalSupport();
    if (onLog) {
      onLog('info', `Metal 支持检测结果: ${shouldUseMetal ? '支持' : '不支持'}`);
    }
  }

  const startTime = Date.now();

  try {
    let result = null;
    let attemptCpuFallback = false;

    // 第一次尝试（如果启用 Metal）
    if (shouldUseMetal && os.platform() === 'darwin') {
      if (onLog) {
        onLog('info', '开始使用 Metal GPU 加速转写');
      }

      try {
        const metalArgs = buildWhisperArgs(actualModelPath, audioPath, {
          language,
          useMetal: true,
          translate,
          threads
        });

        if (onLog) {
          onLog('info', `Whisper 命令: ${actualWhisperPath} ${metalArgs.join(' ')}`);
        }

        result = await executeWhisper(metalArgs, actualWhisperPath, onProgress, onLog, spawnFn);

        // 检查是否需要 fallback 到 CPU
        if (shouldFallbackToCpu(result.stderr)) {
          attemptCpuFallback = true;
          if (onLog) {
            onLog('warning', 'Metal 初始化失败，准备切换到 CPU 模式');
          }
        }
      } catch (error) {
        // 如果是 Metal 相关错误，标记需要 fallback
        if (error.details?.args?.includes('--encoder metal') ||
            error.message.toLowerCase().includes('metal')) {
          attemptCpuFallback = true;
          if (onLog) {
            onLog('warning', `Metal 执行失败: ${error.message}，准备切换到 CPU 模式`);
          }
        } else {
          throw error;
        }
      }
    }

    // CPU fallback 或直接使用 CPU
    if (!result && (!shouldUseMetal || attemptCpuFallback || os.platform() !== 'darwin')) {
      if (onLog) {
        onLog('info', attemptCpuFallback ? '切换到 CPU 模式重试' : '使用 CPU 模式转写');
      }

      const cpuArgs = buildWhisperArgs(actualModelPath, audioPath, {
        language,
        useMetal: false,
        translate,
        threads
      });

      if (onLog) {
        onLog('info', `Whisper 命令: ${actualWhisperPath} ${cpuArgs.join(' ')}`);
      }

      result = await executeWhisper(cpuArgs, actualWhisperPath, onProgress, onLog, spawnFn);
    }

    // 查找生成的转写文件
    let transcriptPath = outputPath;

    // whisper.cpp 在音频文件同目录生成输出文件，文件名为 输入文件名.txt
    const audioBaseName = path.basename(audioPath); // 包含扩展名的完整文件名
    const defaultOutputPath = path.join(path.dirname(audioPath), `${audioBaseName}.txt`);

    // 也可能使用不带扩展名的音频文件名
    const audioBaseNameWithoutExt = path.basename(audioPath, path.extname(audioPath));
    const altOutputPath = path.join(path.dirname(audioPath), `${audioBaseNameWithoutExt}.txt`);

    // 按优先级查找文件
    if (fs.existsSync(defaultOutputPath)) {
      // 移动文件到目标位置
      if (defaultOutputPath !== outputPath) {
        fs.copyFileSync(defaultOutputPath, outputPath);
        fs.unlinkSync(defaultOutputPath); // 删除临时文件
      }
      transcriptPath = outputPath;
    } else if (fs.existsSync(altOutputPath)) {
      // 移动文件到目标位置
      if (altOutputPath !== outputPath) {
        fs.copyFileSync(altOutputPath, outputPath);
        fs.unlinkSync(altOutputPath); // 删除临时文件
      }
      transcriptPath = outputPath;
    } else if (fs.existsSync(outputPath)) {
      transcriptPath = outputPath;
    } else {
      throw new TranscribeError(
        '转写完成但未找到输出文件',
        'TRANSCRIPT_NOT_FOUND',
        { expectedPaths: [outputPath, defaultOutputPath, altOutputPath] }
      );
    }

    const endTime = Date.now();
    const totalDuration = (endTime - startTime) / 1000;

    // 验证文件内容
    if (fs.statSync(transcriptPath).size === 0) {
      throw new TranscribeError(
        '转写文件为空',
        'EMPTY_TRANSCRIPT',
        { transcriptPath }
      );
    }

    if (onLog) {
      onLog('info', `转写完成: ${transcriptPath} (耗时: ${totalDuration.toFixed(2)}s)`);
    }

    return {
      transcriptPath,
      duration: totalDuration,
      model: actualModelPath,
      usedMetal: shouldUseMetal && !attemptCpuFallback,
      outputSize: fs.statSync(transcriptPath).size
    };

  } catch (error) {
    if (error instanceof TranscribeError) {
      throw error;
    }

    // 包装其他错误
    const errorMessage = error && error.message ? error.message : String(error);
    throw new TranscribeError(
      `转写失败: ${errorMessage}`,
      'TRANSCRIBE_ERROR',
      {
        originalError: errorMessage,
        audioPath,
        outputPath,
        whisperPath: actualWhisperPath,
        modelPath: actualModelPath
      }
    );
  }
}

module.exports = {
  transcribe,
  TranscribeError,
  // 工具函数
  getDefaultWhisperPath,
  getDefaultModelPath,
  detectMetalSupport,
  buildWhisperArgs,
  parseProgressOutput,
  shouldFallbackToCpu,
  executeWhisper
};