#!/usr/bin/env node

/**
 * audio.js 模块单元测试
 * 测试音频提取功能，包括成功路径、错误处理和日志捕获
 */

const {
  extractAudio,
  AudioExtractError,
  getDefaultFfmpegPath,
  validateInput,
  generateOutputPaths,
  buildFfmpegArgs,
  buildWavArgs
} = require('../src/jobs/audio');

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock child_process.spawn
class MockChildProcess {
  constructor() {
    this.listeners = new Map();
    this.stdoutEvents = [];
    this.stderrEvents = [];
    this.stdout = {
      on: (event, listener) => {
        if (event === 'data') {
          this.stdoutEvents.push(listener);
        }
      }
    };
    this.stderr = {
      on: (event, listener) => {
        if (event === 'data') {
          this.stderrEvents.push(listener);
        }
      }
    };
    this.shouldFail = false;
    this.exitCode = 0;
    this.signal = null;
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  // 模拟进程结束
  emitClose() {
    const closeListeners = this.listeners.get('close');
    if (closeListeners) {
      closeListeners.forEach(listener => {
        try {
          listener(this.exitCode, this.signal);
        } catch (error) {
          console.error('Mock close listener error:', error);
        }
      });
    }
  }

  // 模拟进程错误
  emitError(error) {
    const errorListeners = this.listeners.get('error');
    if (errorListeners) {
      errorListeners.forEach(listener => {
        try {
          listener(error);
        } catch (e) {
          console.error('Mock error listener error:', e);
        }
      });
    }
  }

  // 模拟输出数据
  emitStdout(data) {
    this.stdoutEvents.forEach(listener => {
      try {
        listener(Buffer.from(data));
      } catch (error) {
        console.error('Mock stdout listener error:', error);
      }
    });
  }

  emitStderr(data) {
    this.stderrEvents.forEach(listener => {
      try {
        listener(Buffer.from(data));
      } catch (error) {
        console.error('Mock stderr listener error:', error);
      }
    });
  }
}

// Mock spawn 函数
let mockSpawn = null;
const originalSpawn = require('child_process').spawn;

function createMockSpawn() {
  mockSpawn = (command, args) => {
    const mockProcess = new MockChildProcess();

    // 异步执行模拟进程
    setTimeout(() => {
      if (mockProcess.shouldFail) {
        mockProcess.emitError(new Error('Mock ffmpeg failed'));
      } else {
        // 模拟正常输出
        mockProcess.emitStdout('ffmpeg output\n');
        mockProcess.emitStderr('Processing audio...\n');

        // 创建输出文件
        const outputPath = args[args.length - 1];
        const outputDir = require('path').dirname(outputPath);
        if (!require('fs').existsSync(outputDir)) {
          require('fs').mkdirSync(outputDir, { recursive: true });
        }
        require('fs').writeFileSync(outputPath, 'mock audio data');

        // 模拟进程结束
        mockProcess.emitClose();
      }
    }, 50);

    return mockProcess;
  };

  // 替换原始 spawn
  const childProcess = require('child_process');
  childProcess.spawn = mockSpawn;
  return mockSpawn;
}

function restoreSpawn() {
  require('child_process').spawn = originalSpawn;
  mockSpawn = null;
}

// 创建临时测试文件
function createTempVideoFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, 'mock video data');
  return filePath;
}

// 清理临时文件
function cleanupTempFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // 忽略清理错误
  }
}

// 简单的断言库
class Assert {
  static isTrue(condition, message) {
    if (!condition) {
      throw new Error(`断言失败: ${message}`);
    }
  }

  static equals(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`断言失败: ${message}\n  期望: ${expected}\n  实际: ${actual}`);
    }
  }

  static notNull(value, message) {
    if (value === null || value === undefined) {
      throw new Error(`断言失败: ${message} (值为 ${value})`);
    }
  }

  static async throws(fn, expectedError, message) {
    try {
      await fn();
      throw new Error(`断言失败: ${message} (期望抛出异常)`);
    } catch (error) {
      if (expectedError && !error.message.includes(expectedError)) {
        throw new Error(`断言失败: ${message}\n  期望异常: ${expectedError}\n  实际异常: ${error.message}`);
      }
    }
  }

  static contains(actual, expected, message) {
    if (!actual.includes(expected)) {
      throw new Error(`断言失败: ${message}\n  期望包含: ${expected}\n  实际: ${actual}`);
    }
  }

  static fileExists(filePath, message) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`断言失败: ${message} (文件不存在: ${filePath})`);
    }
  }
}

// 测试套件
class TestSuite {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(description, testFn) {
    this.tests.push({ description, testFn });
  }

  async run() {
    console.log(`\n🧪 运行测试套件: ${this.name}`);
    console.log('='.repeat(50));

    for (const { description, testFn } of this.tests) {
      try {
        const result = testFn();
        if (result instanceof Promise) {
          await result;
        }
        console.log(`✅ ${description}`);
        this.passed++;
      } catch (error) {
        console.log(`❌ ${description}`);
        console.log(`   错误: ${error.message}`);
        this.failed++;
      }
    }

    console.log('='.repeat(50));
    console.log(`通过: ${this.passed}/${this.tests.length}, 失败: ${this.failed}/${this.tests.length}`);

    return this.failed === 0;
  }
}

async function main() {
  console.log('🚀 开始运行音频处理模块单元测试');

  // 测试1: 工具函数测试
  const utilTests = new TestSuite('工具函数测试');

  utilTests.test('getDefaultFfmpegPath 返回有效路径', () => {
    const ffmpegPath = getDefaultFfmpegPath();
    Assert.notNull(ffmpegPath, '应该返回路径');
    Assert.contains(ffmpegPath, 'ffmpeg', '路径应该包含 ffmpeg');
    Assert.contains(ffmpegPath, 'resources', '路径应该包含 resources');
  });

  utilTests.test('validateInput 验证有效输入', () => {
    const tempVideo = createTempVideoFile('/tmp/test_video.mp4');

    // 不应该抛出异常
    validateInput(tempVideo, { bitrate: '128k' });

    cleanupTempFile(tempVideo);
  });

  utilTests.test('validateInput 检测无效输入', async () => {
    await Assert.throws(
      async () => validateInput('', {}),
      '视频文件路径必须是非空字符串',
      '应该检测空路径'
    );

    await Assert.throws(
      async () => validateInput('/nonexistent/file.mp4', {}),
      '视频文件不存在',
      '应该检测文件不存在'
    );

    const tempTxt = createTempVideoFile('/tmp/test_file.txt');
    await Assert.throws(
      async () => validateInput(tempTxt, {}),
      '不支持的文件格式',
      '应该检测不支持的文件格式'
    );
    cleanupTempFile(tempTxt);
  });

  utilTests.test('generateOutputPaths 生成正确的输出路径', () => {
    const paths = generateOutputPaths('/path/to/video.mp4');

    Assert.notNull(paths.mp3Path, '应该生成 mp3 路径');
    Assert.notNull(paths.wavPath, '应该生成 wav 路径');
    Assert.contains(paths.mp3Path, '.mp3', 'mp3 路径应该以 .mp3 结尾');
    Assert.contains(paths.wavPath, '.wav', 'wav 路径应该以 .wav 结尾');
  });

  utilTests.test('buildFfmpegArgs 构建正确的参数', () => {
    const videoPath = '/input/video.mp4';
    const paths = { mp3Path: '/output/audio.mp3', wavPath: '/output/audio.wav' };

    const args = buildFfmpegArgs(videoPath, paths, { bitrate: '128k' });

    Assert.isTrue(Array.isArray(args), '应该返回数组');
    Assert.isTrue(args.includes('-i'), '应该包含输入参数');
    Assert.isTrue(args.includes(videoPath), '应该包含视频路径');
    Assert.isTrue(args.includes(paths.mp3Path), '应该包含输出路径');
    Assert.isTrue(args.includes('128k'), '应该包含比特率');
  });

  await utilTests.run();

  // 测试2: 基本音频提取功能
  const basicTests = new TestSuite('基本音频提取测试');

  basicTests.test('成功提取音频到 MP3', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempVideo = createTempVideoFile('/tmp/test_basic.mp4');

      const result = await extractAudio(tempVideo, {
        outputDir: '/tmp/audio_test',
        bitrate: '192k',
        spawnFn: mockSpawn
      });

      Assert.notNull(result, '应该返回结果');
      Assert.notNull(result.mp3Path, '应该包含 mp3 路径');
      Assert.contains(result.mp3Path, '.mp3', 'mp3 路径应该正确');

      cleanupTempFile(tempVideo);
    } finally {
      restoreSpawn();
    }
  });

  basicTests.test('同时生成 MP3 和 WAV', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempVideo = createTempVideoFile('/tmp/test_wav.mp4');

      const result = await extractAudio(tempVideo, {
        outputDir: '/tmp/audio_test',
        generateWav: true,
        bitrate: '128k',
        spawnFn: mockSpawn
      });

      Assert.notNull(result.mp3Path, '应该包含 mp3 路径');
      Assert.notNull(result.wavPath, '应该包含 wav 路径');
      Assert.contains(result.wavPath, '.wav', 'wav 路径应该正确');

      cleanupTempFile(tempVideo);
    } finally {
      restoreSpawn();
    }
  });

  await basicTests.run();

  // 测试3: 日志捕获测试
  const logTests = new TestSuite('日志捕获测试');

  logTests.test('捕获 ffmpeg 输出日志', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempVideo = createTempVideoFile('/tmp/test_log.mp4');
      const logEntries = [];

      const result = await extractAudio(tempVideo, {
        outputDir: '/tmp/audio_test',
        onLog: (type, data) => {
          logEntries.push({ type, data: data.toString().trim() });
        },
        spawnFn: mockSpawn
      });

      Assert.isTrue(logEntries.length > 0, '应该捕获日志条目');

      // 检查是否包含不同类型的日志
      const hasInfo = logEntries.some(entry => entry.type === 'info');
      const hasStderr = logEntries.some(entry => entry.type === 'stderr');

      Assert.isTrue(hasInfo, '应该包含 info 类型日志');
      Assert.isTrue(hasStderr, '应该包含 stderr 类型日志');

      cleanupTempFile(tempVideo);
    } finally {
      restoreSpawn();
    }
  });

  await logTests.run();

  // 测试4: 错误处理测试
  const errorTests = new TestSuite('错误处理测试');

  errorTests.test('处理 ffmpeg 进程错误', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempVideo = createTempVideoFile('/tmp/test_error.mp4');

      // 创建一个会失败的 mock spawn
      const failingSpawn = (command, args) => {
        const mockProcess = mockSpawn(command, args);
        mockProcess.shouldFail = true;
        return mockProcess;
      };

      try {
        await extractAudio(tempVideo, {
          outputDir: '/tmp/audio_test',
          spawnFn: failingSpawn
        });
        throw new Error('断言失败: 期望抛出异常但没有抛出');
      } catch (error) {
        if (error.code === 'FFMPEG_PROCESS_ERROR') {
          // 正确的错误类型
        } else {
          throw new Error(`断言失败: 期望错误代码 FFMPEG_PROCESS_ERROR，实际 ${error.code}`);
        }
      }

      cleanupTempFile(tempVideo);
    } finally {
      restoreSpawn();
    }
  });

  errorTests.test('处理无效比特率', async () => {
    const tempVideo = createTempVideoFile('/tmp/test_bitrate.mp4');

    await Assert.throws(
      async () => await extractAudio(tempVideo, { bitrate: 123 }),
      '比特率必须是字符串格式',
      '应该检测无效比特率'
    );

    cleanupTempFile(tempVideo);
  });

  errorTests.test('处理不支持的文件格式', async () => {
    const tempFile = createTempVideoFile('/tmp/test_unsupported.txt');

    await Assert.throws(
      async () => await extractAudio(tempFile, {}),
      '不支持的文件格式',
      '应该检测不支持的文件格式'
    );

    cleanupTempFile(tempFile);
  });

  await errorTests.run();

  // 测试5: 高级选项测试
  const advancedTests = new TestSuite('高级选项测试');

  advancedTests.test('使用自定义 ffmpeg 路径', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempVideo = createTempVideoFile('/tmp/test_custom.mp4');

      const result = await extractAudio(tempVideo, {
        outputDir: '/tmp/audio_test',
        ffmpegPath: '/custom/path/ffmpeg',
        spawnFn: mockSpawn
      });

      Assert.notNull(result.mp3Path, '应该成功提取音频');

      cleanupTempFile(tempVideo);
    } finally {
      restoreSpawn();
    }
  });

  advancedTests.test('使用依赖注入 (自定义 ffmpeg 实例)', async () => {
    const tempVideo = createTempVideoFile('/tmp/test_inject.mp4');
    const logEntries = [];

    // 自定义 ffmpeg 实例
    const mockFfmpegInstance = async (args, ffmpegPath, onLog) => {
      logEntries.push(`Mock ffmpeg called with: ${ffmpegPath} ${args.join(' ')}`);

      // 模拟创建输出文件
      const mp3Path = args[args.length - 1];
      fs.writeFileSync(mp3Path, 'mock mp3 data');
    };

    const result = await extractAudio(tempVideo, {
      outputDir: '/tmp/audio_test',
      ffmpegInstance: mockFfmpegInstance
    });

    Assert.notNull(result.mp3Path, '应该成功提取音频');
    Assert.isTrue(logEntries.length > 0, '应该调用自定义 ffmpeg 实例');
    Assert.fileExists(result.mp3Path, '应该创建输出文件');

    // 清理生成的文件
    cleanupTempFile(tempVideo);
    cleanupTempFile(result.mp3Path);
  });

  await advancedTests.run();

  // 清理测试目录
  try {
    if (fs.existsSync('/tmp/audio_test')) {
      const files = fs.readdirSync('/tmp/audio_test');
      files.forEach(file => {
        fs.unlinkSync(path.join('/tmp/audio_test', file));
      });
      fs.rmdirSync('/tmp/audio_test');
    }
  } catch (error) {
    // 忽略清理错误
  }

  // 统计总结果
  const totalTests = utilTests.tests.length + basicTests.tests.length +
                    logTests.tests.length + errorTests.tests.length +
                    advancedTests.tests.length;
  const totalPassed = utilTests.passed + basicTests.passed +
                     logTests.passed + errorTests.passed +
                     advancedTests.passed;
  const totalFailed = utilTests.failed + basicTests.failed +
                     logTests.failed + errorTests.failed +
                     advancedTests.failed;

  console.log('\n' + '='.repeat(60));
  console.log('🎯 测试汇总');
  console.log('='.repeat(60));
  console.log(`总测试数: ${totalTests}`);
  console.log(`✅ 通过: ${totalPassed}`);
  console.log(`❌ 失败: ${totalFailed}`);
  console.log(`📊 通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

  if (totalFailed === 0) {
    console.log('\n🎉 所有测试通过！音频处理模块功能正常。');
    console.log('✅ 使用 child_process.spawn 实现流式处理');
    console.log('✅ 支持自定义 ffmpeg 路径');
    console.log('✅ 实现了完整的错误处理');
    console.log('✅ 支持流式日志捕获');
    console.log('✅ 支持 MP3 和 WAV 格式输出');
    process.exit(0);
  } else {
    console.log('\n💥 部分测试失败，请检查代码。');
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  main().catch(error => {
    console.error('测试运行出错:', error);
    process.exit(1);
  });
}

module.exports = { TestSuite, Assert, MockChildProcess, createMockSpawn, restoreSpawn };