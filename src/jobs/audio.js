/**
 * 音频处理模块 - 使用 ffmpeg 进行音频提取和转换
 * 提供视频到音频的转换功能，支持 MP3 和 WAV 格式
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 默认 ffmpeg 二进制路径配置
const DEFAULT_FFMPEG_PATHS = {
  win32: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'ffmpeg.exe'),
  darwin: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'ffmpeg'),
  linux: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'ffmpeg'),
  freebsd: path.join(process.cwd(), 'resources', 'runtime', 'bin', 'ffmpeg')
};

/**
 * 获取默认 ffmpeg 路径
 * @returns {string} ffmpeg 二进制文件路径
 */
function getDefaultFfmpegPath() {
  const platform = os.platform();
  return DEFAULT_FFMPEG_PATHS[platform] || DEFAULT_FFMPEG_PATHS.linux;
}

/**
 * 自定义音频提取错误类
 */
class AudioExtractError extends Error {
  constructor(message, code = 'AUDIO_EXTRACT_ERROR', details = {}) {
    super(message);
    this.name = 'AudioExtractError';
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
 * 检查文件是否已经是音频格式
 * @param {string} filePath - 文件路径
 * @returns {boolean} 是否为音频文件
 */
function isAudioFile(filePath) {
  const audioExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus'];
  const ext = path.extname(filePath).toLowerCase();
  return audioExtensions.includes(ext);
}

/**
 * 验证输入参数
 * @param {string} videoPath - 视频文件路径
 * @param {Object} options - 转换选项
 * @throws {AudioExtractError} 当参数无效时
 */
function validateInput(videoPath, options = {}) {
  if (!videoPath || typeof videoPath !== 'string') {
    throw new AudioExtractError('文件路径必须是非空字符串', 'INVALID_VIDEO_PATH');
  }

  if (!fs.existsSync(videoPath)) {
    throw new AudioExtractError('文件不存在', 'VIDEO_FILE_NOT_FOUND', { videoPath });
  }

  // 检查文件扩展名
  const fileExt = path.extname(videoPath).toLowerCase();
  const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'];
  const audioExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus'];

  if (!videoExtensions.includes(fileExt) && !audioExtensions.includes(fileExt)) {
    throw new AudioExtractError(
      `不支持的文件格式: ${fileExt}`,
      'UNSUPPORTED_VIDEO_FORMAT',
      { videoPath, extension: fileExt }
    );
  }

  // 验证比特率
  if (options.bitrate && typeof options.bitrate !== 'string') {
    throw new AudioExtractError('比特率必须是字符串格式 (如 "192k")', 'INVALID_BITRATE');
  }

  // 验证输出目录
  if (options.outputDir && !fs.existsSync(options.outputDir)) {
    try {
      fs.mkdirSync(options.outputDir, { recursive: true });
    } catch (error) {
      throw new AudioExtractError(
        `无法创建输出目录: ${error.message}`,
        'OUTPUT_DIR_ERROR',
        { outputDir: options.outputDir }
      );
    }
  }
}

/**
 * 生成输出文件路径
 * @param {string} videoPath - 视频文件路径
 * @param {Object} options - 转换选项
 * @returns {Object} 包含 mp3 和 wav 路径的对象
 */
function generateOutputPaths(videoPath, options = {}) {
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const outputDir = options.outputDir || path.dirname(videoPath);

  // 清理文件名，替换特殊字符
  const cleanName = videoName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');

  const mp3Path = path.join(outputDir, `${cleanName}.mp3`);
  const wavPath = path.join(outputDir, `${cleanName}.wav`);

  return { mp3Path, wavPath };
}

/**
 * 构建 ffmpeg 命令参数
 * @param {string} videoPath - 输入视频路径
 * @param {Object} paths - 输出路径对象
 * @param {Object} options - 转换选项
 * @returns {Array} ffmpeg 命令参数数组
 */
function buildFfmpegArgs(videoPath, paths, options = {}) {
  const args = ['-y']; // 覆盖输出文件

  // 输入文件
  args.push('-i', videoPath);

  // 音频编解码器设置
  if (options.codec) {
    args.push('-c:a', options.codec);
  } else {
    args.push('-c:a', 'libmp3lame'); // 默认使用 MP3 编码器
  }

  // 比特率设置 (默认 192k)
  const bitrate = options.bitrate || '192k';
  args.push('-b:a', bitrate);

  // 音频质量设置
  if (options.quality !== undefined && options.quality !== null) {
    args.push('-q:a', options.quality.toString());
  }

  // 采样率设置
  if (options.sampleRate) {
    args.push('-ar', options.sampleRate.toString());
  }

  // 声道设置
  if (options.channels) {
    args.push('-ac', options.channels.toString());
  }

  // 输出文件
  args.push(paths.mp3Path);

  return args;
}

/**
 * 构建 WAV 转换命令参数
 * @param {string} mp3Path - MP3 文件路径
 * @param {string} wavPath - WAV 文件路径
 * @returns {Array} ffmpeg 命令参数数组
 */
function buildWavArgs(mp3Path, wavPath) {
  return [
    '-y',                    // 覆盖输出文件
    '-i', mp3Path,          // 输入 MP3 文件
    '-c:a', 'pcm_s16le',    // WAV 编码器
    '-ar', '44100',         // 采样率 44.1kHz
    '-ac', '2',             // 立体声
    wavPath                 // 输出 WAV 文件
  ];
}

/**
 * 执行 ffmpeg 命令
 * @param {Array} args - ffmpeg 命令参数
 * @param {string} ffmpegPath - ffmpeg 二进制路径
 * @param {Function} onLog - 日志回调函数
 * @param {Function} spawnFn - spawn 函数 (用于测试依赖注入)
 * @returns {Promise<void>}
 */
function executeFfmpeg(args, ffmpegPath, onLog = null, spawnFn = null) {
  return new Promise((resolve, reject) => {
    const spawnFunc = spawnFn || require('child_process').spawn;
    const process = spawnFunc(ffmpegPath, args);
    let stdout = '';
    let stderr = '';

    // 捕获标准输出
    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      if (onLog) {
        onLog('stdout', output);
      }
    });

    // 捕获标准错误 (ffmpeg 主要使用 stderr 输出)
    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      if (onLog) {
        onLog('stderr', output);
      }
    });

    // 监听进程错误
    process.on('error', (error) => {
      reject(new AudioExtractError(
        `ffmpeg 进程错误: ${error.message}`,
        'FFMPEG_PROCESS_ERROR',
        { originalError: error.message, args }
      ));
    });

    // 监听进程结束
    process.on('close', (code, signal) => {
      if (signal) {
        reject(new AudioExtractError(
          `ffmpeg 进程被信号终止: ${signal}`,
          'FFMPEG_TERMINATED',
          { signal, args, stderr }
        ));
      } else if (code !== 0) {
        reject(new AudioExtractError(
          `ffmpeg 执行失败 (退出码: ${code})`,
          'FFMPEG_FAILED',
          { exitCode: code, args, stderr: stderr || '无错误输出' }
        ));
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

/**
 * 从视频中提取音频
 * @param {string} videoPath - 视频文件路径
 * @param {Object} options - 转换选项
 * @param {string} options.bitrate - 音频比特率 (默认: "192k")
 * @param {boolean} options.generateWav - 是否生成 WAV 文件 (默认: false)
 * @param {string} options.outputDir - 输出目录 (默认: 视频文件所在目录)
 * @param {string} options.codec - 音频编解码器 (默认: "libmp3lame")
 * @param {number} options.quality - 音频质量 (0-9)
 * @param {string} options.sampleRate - 采样率 (如 "44100")
 * @param {number} options.channels - 声道数 (如 2)
 * @param {Function} options.onLog - 日志回调函数 (type, data) => void
 * @param {string} options.ffmpegPath - ffmpeg 二进制路径 (可选)
 * @param {Object} options.ffmpegInstance - 自定义 ffmpeg 实例 (用于测试)
 * @param {Function} options.spawnFn - 自定义 spawn 函数 (用于测试)
 * @returns {Promise<Object>} 包含输出文件路径的对象 {mp3Path, wavPath?}
 * @throws {AudioExtractError} 当转换失败时
 */
async function extractAudio(videoPath, options = {}) {
  validateInput(videoPath, options);

  const {
    bitrate = '192k',
    generateWav = false,
    outputDir = null,
    codec = 'libmp3lame',
    quality = null,
    sampleRate = null,
    channels = null,
    onLog = null,
    ffmpegPath = null,
    ffmpegInstance = null,
    spawnFn = null
  } = options;

  // 检查输入文件是否已经是音频格式
  if (isAudioFile(videoPath)) {
    const fileExt = path.extname(videoPath).toLowerCase();

    if (onLog) {
      onLog('info', `输入文件已经是音频格式 (${fileExt})，跳过音频提取步骤`);
      onLog('info', `使用现有音频文件: ${videoPath}`);
    }

    const result = { mp3Path: videoPath };

    // 如果输入文件是 MP3 且需要生成 WAV 文件
    if (generateWav && fileExt === '.mp3') {
      const paths = generateOutputPaths(videoPath, { outputDir });

      if (onLog) {
        onLog('info', `开始从 MP3 生成 WAV 文件: ${paths.wavPath}`);
      }

      const actualFfmpegPath = ffmpegPath || getDefaultFfmpegPath();
      const wavArgs = buildWavArgs(videoPath, paths.wavPath);

      try {
        // 执行 WAV 转换
        if (ffmpegInstance) {
          await ffmpegInstance(wavArgs, actualFfmpegPath, onLog);
        } else {
          await executeFfmpeg(wavArgs, actualFfmpegPath, onLog, spawnFn);
        }

        // 验证 WAV 文件是否生成成功
        if (fs.existsSync(paths.wavPath)) {
          const wavStats = fs.statSync(paths.wavPath);
          if (onLog) {
            onLog('info', `WAV 转换完成: ${paths.wavPath} (${wavStats.size} bytes)`);
          }
          result.wavPath = paths.wavPath;
        }
      } catch (error) {
        if (onLog) {
          onLog('warn', `WAV 生成失败，但 MP3 文件可用: ${error.message}`);
        }
      }
    }

    if (onLog) {
      onLog('info', '音频处理完成（使用现有音频文件）');
    }

    return result;
  }

  // 处理视频文件的情况
  const paths = generateOutputPaths(videoPath, { outputDir });

  // 检查输出文件是否已存在
  if (fs.existsSync(paths.mp3Path)) {
    if (onLog) {
      onLog('info', `MP3 文件已存在，将覆盖: ${paths.mp3Path}`);
    }
  }

  const actualFfmpegPath = ffmpegPath || getDefaultFfmpegPath();

  try {
    // 构建 MP3 转换命令
    const mp3Args = buildFfmpegArgs(videoPath, paths, {
      bitrate,
      codec,
      quality,
      sampleRate,
      channels
    });

    if (onLog) {
      onLog('info', `开始转换音频: ${videoPath} -> ${paths.mp3Path}`);
      onLog('info', `FFmpeg 命令: ${actualFfmpegPath} ${mp3Args.join(' ')}`);
    }

    // 执行 MP3 转换
    if (ffmpegInstance) {
      // 使用注入的实例 (测试用)
      await ffmpegInstance(mp3Args, actualFfmpegPath, onLog);
    } else {
      // 使用实际的 ffmpeg
      await executeFfmpeg(mp3Args, actualFfmpegPath, onLog, spawnFn);
    }

    // 验证 MP3 文件是否生成成功
    if (!fs.existsSync(paths.mp3Path)) {
      throw new AudioExtractError(
        'MP3 文件生成失败',
        'MP3_NOT_CREATED',
        { outputPath: paths.mp3Path }
      );
    }

    // 获取文件信息
    const mp3Stats = fs.statSync(paths.mp3Path);
    if (onLog) {
      onLog('info', `MP3 转换完成: ${paths.mp3Path} (${mp3Stats.size} bytes)`);
    }

    const result = { mp3Path: paths.mp3Path };

    // 如果需要生成 WAV 文件
    if (generateWav) {
      if (onLog) {
        onLog('info', `开始生成 WAV 文件: ${paths.wavPath}`);
      }

      const wavArgs = buildWavArgs(paths.mp3Path, paths.wavPath);

      // 执行 WAV 转换
      if (ffmpegInstance) {
        await ffmpegInstance(wavArgs, actualFfmpegPath, onLog);
      } else {
        await executeFfmpeg(wavArgs, actualFfmpegPath, onLog, spawnFn);
      }

      // 验证 WAV 文件是否生成成功
      if (!fs.existsSync(paths.wavPath)) {
        throw new AudioExtractError(
          'WAV 文件生成失败',
          'WAV_NOT_CREATED',
          { outputPath: paths.wavPath }
        );
      }

      const wavStats = fs.statSync(paths.wavPath);
      if (onLog) {
        onLog('info', `WAV 转换完成: ${paths.wavPath} (${wavStats.size} bytes)`);
      }

      result.wavPath = paths.wavPath;
    }

    if (onLog) {
      onLog('info', '音频提取完成');
    }

    return result;

  } catch (error) {
    if (error instanceof AudioExtractError) {
      throw error;
    }

    // 包装其他错误
    const errorMessage = error && error.message ? error.message : String(error);
    throw new AudioExtractError(
      `音频提取失败: ${errorMessage}`,
      'AUDIO_EXTRACT_ERROR',
      {
        originalError: errorMessage,
        videoPath,
        outputPath: paths.mp3Path
      }
    );
  }
}

module.exports = {
  extractAudio,
  AudioExtractError,
  // 工具函数
  isAudioFile,
  getDefaultFfmpegPath,
  validateInput,
  generateOutputPaths,
  buildFfmpegArgs,
  buildWavArgs,
  executeFfmpeg
};