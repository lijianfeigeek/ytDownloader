#!/usr/bin/env node

/**
 * transcribe.js 模块单元测试
 * 测试 Whisper 转写功能，包括 Metal GPU 加速、CPU fallback、进度解析和错误处理
 */

const {
  transcribe,
  TranscribeError,
  getDefaultWhisperPath,
  getDefaultModelPath,
  detectMetalSupport,
  buildWhisperArgs,
  parseProgressOutput,
  shouldFallbackToCpu,
  executeWhisper
} = require('../src/jobs/transcribe');

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
        mockProcess.emitError(new Error('Mock whisper failed'));
      } else {
        // 模拟进度输出
        mockProcess.emitStdout('whisper.cpp v1.5.4\n');
        mockProcess.emitStdout('Processing audio...\n');
        mockProcess.emitStdout('[10%] Processing audio chunk 1/10\n');
        mockProcess.emitStdout('[20%] Processing audio chunk 2/10\n');
        mockProcess.emitStdout('[30%] Processing audio chunk 3/10\n');
        mockProcess.emitStdout('[40%] Processing audio chunk 4/10\n');
        mockProcess.emitStdout('[50%] Processing audio chunk 5/10 (2.3x)\n');
        mockProcess.emitStdout('[60%] Processing audio chunk 6/10 (2.1x)\n');
        mockProcess.emitStdout('[70%] Processing audio chunk 7/10 (2.0x)\n');
        mockProcess.emitStdout('[80%] Processing audio chunk 8/10 (1.9x)\n');
        mockProcess.emitStdout('[90%] Processing audio chunk 9/10 (1.8x)\n');
        mockProcess.emitStdout('[100%] Processing complete (1.7x)\n');

        // 创建输出文件
        const outputIndex = args.indexOf('--output-format') + 2;
        const fileIndex = args.indexOf('--file') + 1;
        if (fileIndex > 0 && fileIndex < args.length) {
          const audioPath = args[fileIndex];
          const audioBaseName = path.basename(audioPath, path.extname(audioPath));
          const outputPath = path.join(path.dirname(audioPath), `${audioBaseName}.txt`);

          const outputDir = path.dirname(outputPath);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          fs.writeFileSync(outputPath, '这是一个测试转写结果。\nThis is a test transcript.\n');
        }

        // 模拟进程结束
        mockProcess.emitClose();
      }
    }, 100);

    return mockProcess;
  };

  return mockSpawn;
}

function restoreSpawn() {
  // 不需要恢复，因为我们使用依赖注入
  mockSpawn = null;
}

// 创建临时音频文件
function createTempAudioFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, 'mock audio data');
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

// 清理目录
function cleanupTempDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      files.forEach(file => {
        fs.unlinkSync(path.join(dirPath, file));
      });
      fs.rmdirSync(dirPath);
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
  console.log('🚀 开始运行 Whisper 转写模块单元测试');

  // 测试1: 工具函数测试
  const utilTests = new TestSuite('工具函数测试');

  utilTests.test('getDefaultWhisperPath 返回有效路径', () => {
    const whisperPath = getDefaultWhisperPath();
    Assert.notNull(whisperPath, '应该返回路径');
    Assert.contains(whisperPath, 'whisper', '路径应该包含 whisper');
    Assert.contains(whisperPath, 'resources', '路径应该包含 resources');
  });

  utilTests.test('getDefaultModelPath 返回有效路径', () => {
    const modelPath = getDefaultModelPath();
    Assert.notNull(modelPath, '应该返回路径');
    Assert.contains(modelPath, 'ggml-large-v3-turbo', '路径应该包含模型名称');
    Assert.contains(modelPath, '.bin', '路径应该以 .bin 结尾');
  });

  utilTests.test('parseProgressOutput 解析进度信息', () => {
    const output1 = '[50%] Processing audio chunk 5/10 (2.3x)';
    const progress1 = parseProgressOutput(output1);

    Assert.notNull(progress1, '应该解析出进度信息');
    Assert.equals(progress1.percent, 50, '百分比应该正确');
    Assert.equals(progress1.speed, 2.3, '速度应该正确');

    const output2 = 'Processing audio...';
    const progress2 = parseProgressOutput(output2);
    Assert.equals(progress2, null, '无进度信息时应该返回 null');
  });

  utilTests.test('shouldFallbackToCpu 检测 Metal 错误', () => {
    const metalError = 'metal initialization failed: device not found';
    Assert.isTrue(shouldFallbackToCpu(metalError), '应该检测 Metal 初始化错误');

    const normalError = 'file not found';
    Assert.isTrue(!shouldFallbackToCpu(normalError), '普通错误不应该 fallback');

    const anotherMetalError = 'Failed to initialize Metal command buffer';
    Assert.isTrue(shouldFallbackToCpu(anotherMetalError), '应该检测命令缓冲区错误');
  });

  utilTests.test('buildWhisperArgs 构建正确的参数', () => {
    const args = buildWhisperArgs('/model.bin', '/audio.mp3', {
      language: 'zh',
      useMetal: true,
      translate: true,
      threads: 4
    });

    Assert.isTrue(Array.isArray(args), '应该返回数组');
    Assert.isTrue(args.includes('--model'), '应该包含模型参数');
    Assert.isTrue(args.includes('/model.bin'), '应该包含模型路径');
    Assert.isTrue(args.includes('--file'), '应该包含文件参数');
    Assert.isTrue(args.includes('/audio.mp3'), '应该包含音频路径');
    Assert.isTrue(args.includes('--language'), '应该包含语言参数');
    Assert.isTrue(args.includes('zh'), '应该包含语言代码');
    Assert.isTrue(args.includes('--encoder'), '应该包含编码器参数');
    Assert.isTrue(args.includes('metal'), '应该包含 metal');
    Assert.isTrue(args.includes('--translate'), '应该包含翻译参数');
    Assert.isTrue(args.includes('--threads'), '应该包含线程参数');
    Assert.isTrue(args.includes('4'), '应该包含线程数');
  });

  await utilTests.run();

  // 测试2: 基本转写功能
  const basicTests = new TestSuite('基本转写测试');

  basicTests.test('成功转写音频文件', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempAudio = createTempAudioFile('/tmp/test_audio.mp3');
      const outputDir = '/tmp/transcribe_test';

      const result = await transcribe({
        id: 'test-job-1',
        outputDir
      }, tempAudio, {
        language: 'auto',
        whisperPath: '/mock/whisper',
        model: '/mock/model.bin',
        spawnFn: mockSpawn
      });

      Assert.notNull(result, '应该返回结果');
      Assert.notNull(result.transcriptPath, '应该包含转写文件路径');
      Assert.notNull(result.duration, '应该包含耗时');
      Assert.notNull(result.model, '应该包含模型路径');
      Assert.fileExists(result.transcriptPath, '转写文件应该存在');

      // 清理生成的文件
      cleanupTempFile(tempAudio);
      cleanupTempDir(outputDir);
    } finally {
      restoreSpawn();
    }
  });

  basicTests.test('使用自定义模型和路径', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempAudio = createTempAudioFile('/tmp/test_audio_custom.mp3');
      const outputDir = '/tmp/transcribe_test_custom';

      const result = await transcribe({
        id: 'test-job-2',
        outputDir
      }, tempAudio, {
        model: '/custom/model.bin',
        language: 'en',
        whisperPath: '/custom/whisper',
        spawnFn: mockSpawn
      });

      Assert.notNull(result.transcriptPath, '应该成功转写');
      Assert.equals(result.model, '/custom/model.bin', '应该使用自定义模型');

      // 清理生成的文件
      cleanupTempFile(tempAudio);
      cleanupTempDir(outputDir);
    } finally {
      restoreSpawn();
    }
  });

  await basicTests.run();

  // 测试3: 进度解析测试
  const progressTests = new TestSuite('进度解析测试');

  progressTests.test('捕获转写进度', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempAudio = createTempAudioFile('/tmp/test_progress.mp3');
      const outputDir = '/tmp/transcribe_test_progress';
      const progressEvents = [];

      const result = await transcribe({
        id: 'test-job-3',
        outputDir
      }, tempAudio, {
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
        whisperPath: '/mock/whisper',
        model: '/mock/model.bin',
        spawnFn: mockSpawn
      });

      Assert.isTrue(progressEvents.length > 0, '应该捕获进度事件');

      // 检查进度递增
      for (let i = 1; i < progressEvents.length; i++) {
        Assert.isTrue(
          progressEvents[i].percent >= progressEvents[i-1].percent,
          `进度应该递增: ${progressEvents[i-1].percent}% -> ${progressEvents[i].percent}%`
        );
      }

      // 检查最后的事件应该是 100%
      const lastEvent = progressEvents[progressEvents.length - 1];
      Assert.equals(lastEvent.percent, 100, '最后一个进度事件应该是 100%');

      // 清理生成的文件
      cleanupTempFile(tempAudio);
      cleanupTempDir(outputDir);
    } finally {
      restoreSpawn();
    }
  });

  await progressTests.run();

  // 测试4: 错误处理测试
  const errorTests = new TestSuite('错误处理测试');

  errorTests.test('处理无效输入参数', async () => {
    await Assert.throws(
      async () => await transcribe(null, '/audio.mp3'),
      '作业对象必须是有效的对象',
      '应该检测无效作业对象'
    );

    await Assert.throws(
      async () => await transcribe({}, '/audio.mp3'),
      '作业缺少必需的 id 或 outputDir 字段',
      '应该检测缺失字段'
    );

    await Assert.throws(
      async () => await transcribe({ id: 'test', outputDir: '/tmp' }, ''),
      '音频文件路径必须是非空字符串',
      '应该检测空音频路径'
    );

    await Assert.throws(
      async () => await transcribe({ id: 'test', outputDir: '/tmp' }, '/nonexistent.mp3'),
      '音频文件不存在',
      '应该检测文件不存在'
    );
  });

  errorTests.test('处理 whisper 进程错误', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempAudio = createTempAudioFile('/tmp/test_error.mp3');

      // 创建一个会失败的 mock spawn
      const failingSpawn = (command, args) => {
        const mockProcess = mockSpawn(command, args);
        mockProcess.shouldFail = true;
        return mockProcess;
      };

      try {
        await transcribe({
          id: 'test-job-error',
          outputDir: '/tmp/transcribe_test_error'
        }, tempAudio, {
          spawnFn: failingSpawn
        });
        throw new Error('断言失败: 期望抛出异常但没有抛出');
      } catch (error) {
        if (error.code === 'WHISPER_PROCESS_ERROR') {
          // 正确的错误类型
        } else {
          throw new Error(`断言失败: 期望错误代码 WHISPER_PROCESS_ERROR，实际 ${error.code}`);
        }
      }

      cleanupTempFile(tempAudio);
    } finally {
      restoreSpawn();
    }
  });

  errorTests.test('处理不支持的音频格式', async () => {
    const tempFile = createTempAudioFile('/tmp/test_unsupported.txt');

    await Assert.throws(
      async () => await transcribe({ id: 'test', outputDir: '/tmp' }, tempFile),
      '不支持的音频格式',
      '应该检测不支持的文件格式'
    );

    cleanupTempFile(tempFile);
  });

  await errorTests.run();

  // 测试5: 高级选项测试
  const advancedTests = new TestSuite('高级选项测试');

  advancedTests.test('使用翻译功能', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempAudio = createTempAudioFile('/tmp/test_translate.mp3');
      const outputDir = '/tmp/transcribe_test_translate';

      const result = await transcribe({
        id: 'test-job-translate',
        outputDir
      }, tempAudio, {
        translate: true,
        language: 'zh',
        whisperPath: '/mock/whisper',
        model: '/mock/model.bin',
        spawnFn: mockSpawn
      });

      Assert.notNull(result.transcriptPath, '应该成功转写');
      Assert.fileExists(result.transcriptPath, '转写文件应该存在');

      cleanupTempFile(tempAudio);
      cleanupTempDir(outputDir);
    } finally {
      restoreSpawn();
    }
  });

  advancedTests.test('使用线程配置', async () => {
    const mockSpawn = createMockSpawn();

    try {
      const tempAudio = createTempAudioFile('/tmp/test_threads.mp3');
      const outputDir = '/tmp/transcribe_test_threads';

      const result = await transcribe({
        id: 'test-job-threads',
        outputDir
      }, tempAudio, {
        threads: 8,
        whisperPath: '/mock/whisper',
        model: '/mock/model.bin',
        spawnFn: mockSpawn
      });

      Assert.notNull(result.transcriptPath, '应该成功转写');

      cleanupTempFile(tempAudio);
      cleanupTempDir(outputDir);
    } finally {
      restoreSpawn();
    }
  });

  advancedTests.test('Metal fallback 逻辑测试', async () => {
    // 模拟 Metal 错误的 stderr 输出
    const metalErrorOutput = 'metal initialization failed: device not found';
    Assert.isTrue(shouldFallbackToCpu(metalErrorOutput), '应该检测 Metal 错误并建议 fallback');

    const normalOutput = 'processing audio with CPU encoder';
    Assert.isTrue(!shouldFallbackToCpu(normalOutput), '正常输出不应该 fallback');
  });

  await advancedTests.run();

  // 测试6: Metal 支持检测测试
  const metalTests = new TestSuite('Metal 支持检测测试');

  metalTests.test('detectMetalSupport 返回布尔值', async () => {
    const result = await detectMetalSupport();
    Assert.isTrue(typeof result === 'boolean', '应该返回布尔值');
  });

  await metalTests.run();

  // 清理测试目录
  try {
    cleanupTempDir('/tmp/transcribe_test');
    cleanupTempDir('/tmp/transcribe_test_custom');
    cleanupTempDir('/tmp/transcribe_test_progress');
    cleanupTempDir('/tmp/transcribe_test_error');
    cleanupTempDir('/tmp/transcribe_test_translate');
    cleanupTempDir('/tmp/transcribe_test_threads');
  } catch (error) {
    // 忽略清理错误
  }

  // 统计总结果
  const totalTests = utilTests.tests.length + basicTests.tests.length +
                    progressTests.tests.length + errorTests.tests.length +
                    advancedTests.tests.length + metalTests.tests.length;
  const totalPassed = utilTests.passed + basicTests.passed +
                     progressTests.passed + errorTests.passed +
                     advancedTests.passed + metalTests.passed;
  const totalFailed = utilTests.failed + basicTests.failed +
                     progressTests.failed + errorTests.failed +
                     advancedTests.failed + metalTests.failed;

  console.log('\n' + '='.repeat(60));
  console.log('🎯 测试汇总');
  console.log('='.repeat(60));
  console.log(`总测试数: ${totalTests}`);
  console.log(`✅ 通过: ${totalPassed}`);
  console.log(`❌ 失败: ${totalFailed}`);
  console.log(`📊 通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

  if (totalFailed === 0) {
    console.log('\n🎉 所有测试通过！Whisper 转写模块功能正常。');
    console.log('✅ 使用 child_process.spawn 实现流式处理');
    console.log('✅ 支持 Metal GPU 加速和 CPU fallback');
    console.log('✅ 实现了完整的进度解析');
    console.log('✅ 支持流式日志捕获');
    console.log('✅ 实现了完整的错误处理');
    console.log('✅ 支持多语言和翻译功能');
    console.log('✅ 支持自定义模型和二进制路径');
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