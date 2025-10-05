#!/usr/bin/env node

/**
 * download.js 模块完整测试套件
 * 包含成功下载、失败路径、进度回调和 mock 支持
 */

const {
  download,
  DownloadError,
  createYtDlpInstance,
  validateJob,
  generateOutputFilename,
  buildYtDlpOptions,
  parseProgressEvent
} = require('../src/jobs/download');

// Mock YtDlpWrap 类
class MockYtDlpWrap {
  constructor(ytDlpPath = null) {
    this.ytDlpPath = ytDlpPath;
    this.options = [];
    this.listeners = new Map();
    this.shouldFail = false;
    this.failError = null;
    this.progressEvents = [];
    this.finalFilePath = null;
    this.isMock = true; // 标识这是一个 mock 实例
  }

  setOptions(options) {
    this.options = options;
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  removeAllListeners() {
    this.listeners.clear();
  }

  // 模拟进度事件
  addProgressEvent(percent, speed = 0, eta = 0) {
    this.progressEvents.push({ percent, speed, eta });
  }

  // 模拟失败
  setShouldFail(fail, error = null) {
    this.shouldFail = fail;
    this.failError = error;
  }

  // 模拟完成
  setFinalFilePath(filePath) {
    this.finalFilePath = filePath;
  }

  async exec(url) {
    // 模拟下载过程
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this.shouldFail) {
          const error = this.failError || new Error('Mock download failed');
          this.emit('error', error);
          reject(error);
          return;
        }

        // 模拟进度事件
        this.progressEvents.forEach(progress => {
          this.emit('progress', progress);
        });

        // 模拟完成
        if (this.finalFilePath) {
          this.emit('finish', this.finalFilePath);
          resolve(this.finalFilePath);
        } else {
          reject(new Error('No file path specified'));
        }
      }, 100); // 模拟网络延迟
    });
  }

  emit(event, data) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error('Mock listener error:', error);
        }
      });
    }
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

  static greaterThan(actual, expected, message) {
    if (actual <= expected) {
      throw new Error(`断言失败: ${message}\n  期望大于: ${expected}\n  实际: ${actual}`);
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
  console.log('🚀 开始运行下载模块完整测试');

  // 测试1: 工具函数测试
  const utilTests = new TestSuite('工具函数测试');

  utilTests.test('getDefaultYtDlpPath 返回有效路径', () => {
    const path = require('path');
    const os = require('os');
    const { getDefaultYtDlpPath } = require('../src/jobs/download');

    const defaultPath = getDefaultYtDlpPath();
    Assert.notNull(defaultPath, '应该返回路径');
    Assert.contains(defaultPath, 'yt-dlp', '路径应该包含 yt-dlp');
    Assert.contains(defaultPath, 'resources', '路径应该包含 resources');
  });

  utilTests.test('generateOutputFilename 生成唯一文件名', () => {
    const job1 = {
      id: 'test123',
      metadata: { title: 'Test Video Title' }
    };

    const job2 = {
      id: 'test456',
      metadata: { title: 'Another Video' }
    };

    const filename1 = generateOutputFilename(job1);
    const filename2 = generateOutputFilename(job2);

    Assert.notNull(filename1, '应该生成文件名');
    Assert.notNull(filename2, '应该生成文件名');
    Assert.isTrue(filename1 !== filename2, '不同作业应该生成不同文件名');
    Assert.contains(filename1, 'test123', '文件名应该包含作业ID');
    Assert.contains(filename2, 'test456', '文件名应该包含作业ID');
  });

  utilTests.test('buildYtDlpOptions 构建正确的参数', () => {
    const job = {
      id: 'test',
      outputDir: '/tmp/downloads',
      url: 'https://example.com/video',
      options: {
        keepVideo: true,
        language: 'zh'
      }
    };

    const options = buildYtDlpOptions(job, 'test_filename');

    Assert.isTrue(Array.isArray(options), '应该返回数组');
    Assert.greaterThan(options.length, 5, '应该包含多个参数');
    Assert.isTrue(options.includes('--no-progress'), '应该包含 no-progress 参数');
    Assert.isTrue(options.includes('--output'), '应该包含 output 参数');
  });

  utilTests.test('parseProgressEvent 解析进度信息', () => {
    const event = {
      percent: 75.7,
      speed: 1048576, // 1MB/s in bytes
      eta: 120,        // 2 minutes
      downloaded: 10485760,
      total: 20971520
    };

    const progress = parseProgressEvent(event);

    Assert.equals(progress.percent, 76, '百分比应该四舍五入');
    Assert.greaterThan(progress.speed, 0, '速度应该大于0');
    Assert.greaterThan(progress.eta, 0, 'ETA应该大于0');
    Assert.notNull(progress.message, '应该生成进度消息');
    Assert.contains(progress.message, '76%', '消息应该包含百分比');
  });

  await utilTests.run();

  // 测试2: 成功下载测试
  const successTests = new TestSuite('成功下载测试');

  successTests.test('使用 mock 成功下载', async () => {
    const mockYtDlp = new MockYtDlpWrap();

    // 模拟进度事件
    mockYtDlp.addProgressEvent(25);
    mockYtDlp.addProgressEvent(50);
    mockYtDlp.addProgressEvent(75);
    mockYtDlp.addProgressEvent(100);

    // 模拟完成
    mockYtDlp.setFinalFilePath('/tmp/downloads/test_video.mp4');

    const job = {
      id: 'test123',
      url: 'https://example.com/video',
      outputDir: '/tmp/downloads',
      metadata: { title: 'Test Video' }
    };

    let progressCallCount = 0;
    let lastProgress = null;

    const result = await download(job, (progress) => {
      progressCallCount++;
      lastProgress = progress;
    }, {
      ytDlpInstance: mockYtDlp
    });

    Assert.notNull(result, '应该返回文件路径');
    Assert.equals(result, '/tmp/downloads/test_video.mp4', '应该返回正确的文件路径');
    Assert.greaterThan(progressCallCount, 1, '进度回调应该被调用多次');
    Assert.notNull(lastProgress, '应该有最后的进度信息');
    Assert.equals(lastProgress.percent, 100, '最后的进度应该是100%');
  });

  successTests.test('自定义 yt-dlp 路径', async () => {
    const mockYtDlp = new MockYtDlpWrap();
    mockYtDlp.setFinalFilePath('/tmp/custom/video.mp4');

    const job = {
      id: 'test456',
      url: 'https://example.com/video',
      outputDir: '/tmp/custom'
    };

    const result = await download(job, () => {}, {
      ytDlpInstance: mockYtDlp,
      ytDlpPath: '/custom/path/yt-dlp'
    });

    Assert.notNull(result, '应该成功下载');
    Assert.contains(result, 'video.mp4', '应该包含正确的文件名');
  });

  await successTests.run();

  // 测试3: 失败路径测试
  const failureTests = new TestSuite('失败路径测试');

  failureTests.test('网络错误处理', async () => {
    const mockYtDlp = new MockYtDlpWrap();
    mockYtDlp.setShouldFail(true, new Error('Network connection failed'));

    const job = {
      id: 'test789',
      url: 'https://example.com/video',
      outputDir: '/tmp/test'
    };

    let caughtError = null;
    try {
      await download(job, () => {}, { ytDlpInstance: mockYtDlp });
    } catch (error) {
      caughtError = error;
    }

    Assert.notNull(caughtError, '应该捕获错误');
    Assert.isTrue(caughtError instanceof DownloadError, '应该是 DownloadError 类型');
    Assert.equals(caughtError.code, 'DOWNLOAD_EXEC_ERROR', '错误代码应该正确');
    Assert.contains(caughtError.message, 'Network connection failed', '应该包含网络错误信息');
  });

  failureTests.test('yt-dlp 命令错误', async () => {
    const mockYtDlp = new MockYtDlpWrap();
    mockYtDlp.setShouldFail(true, new Error('yt-dlp: ERROR: Video not found'));

    const job = {
      id: 'test999',
      url: 'https://invalid-url.com/video',
      outputDir: '/tmp/test'
    };

    let caughtError = null;
    try {
      await download(job, () => {}, { ytDlpInstance: mockYtDlp });
    } catch (error) {
      caughtError = error;
    }

    Assert.notNull(caughtError, '应该捕获错误');
    Assert.isTrue(caughtError instanceof DownloadError, '应该是 DownloadError 类型');
    Assert.equals(caughtError.code, 'DOWNLOAD_EXEC_ERROR', '错误代码应该正确');
    Assert.contains(caughtError.message, 'Video not found', '应该包含原始错误信息');
  });

  await failureTests.run();

  // 测试4: 进度回调详细测试
  const progressTests = new TestSuite('进度回调详细测试');

  progressTests.test('进度回调至少被调用两次', async () => {
    const mockYtDlp = new MockYtDlpWrap();

    // 添加多个进度事件
    mockYtDlp.addProgressEvent(10, 1000000, 300);
    mockYtDlp.addProgressEvent(30, 2000000, 240);
    mockYtDlp.addProgressEvent(60, 1500000, 120);
    mockYtDlp.addProgressEvent(90, 1800000, 30);
    mockYtDlp.addProgressEvent(100, 1600000, 0);

    mockYtDlp.setFinalFilePath('/tmp/test/video.mp4');

    const job = {
      id: 'progress_test',
      url: 'https://example.com/video',
      outputDir: '/tmp/test'
    };

    const progressCalls = [];
    const result = await download(job, (progress) => {
      progressCalls.push(progress);
    }, {
      ytDlpInstance: mockYtDlp
    });

    Assert.greaterThan(progressCalls.length, 1, '进度回调应该至少被调用两次');
    Assert.equals(progressCalls[0].percent, 10, '第一次进度应该是10%');
    Assert.equals(progressCalls[progressCalls.length - 1].percent, 100, '最后一次进度应该是100%');

    // 验证进度是递增的
    for (let i = 1; i < progressCalls.length; i++) {
      Assert.greaterThan(progressCalls[i].percent, progressCalls[i - 1].percent,
        `进度应该是递增的 (${progressCalls[i - 1].percent} -> ${progressCalls[i].percent})`);
    }
  });

  progressTests.test('进度事件解析准确性', async () => {
    const mockYtDlp = new MockYtDlpWrap();

    // 测试各种进度数据
    mockYtDlp.addProgressEvent(33.3, 524288, 180); // 1/3 progress
    mockYtDlp.addProgressEvent(66.6, 1048576, 90); // 2/3 progress
    mockYtDlp.addProgressEvent(99.9, 2097152, 5);  // almost done

    mockYtDlp.setFinalFilePath('/tmp/test/video.mp4');

    const job = {
      id: 'progress_accuracy_test',
      url: 'https://example.com/video',
      outputDir: '/tmp/test'
    };

    const progressCalls = [];
    await download(job, (progress) => {
      progressCalls.push(progress);
    }, {
      ytDlpInstance: mockYtDlp
    });

    Assert.equals(progressCalls[0].percent, 33, '33.3% 应该四舍五入为 33%');
    Assert.equals(progressCalls[1].percent, 67, '66.6% 应该四舍五入为 67%');
    Assert.equals(progressCalls[2].percent, 100, '99.9% 应该四舍五入为 100%');

    // 验证进度消息格式
    progressCalls.forEach(progress => {
      Assert.notNull(progress.message, '应该有进度消息');
      Assert.contains(progress.message, '%', '消息应该包含百分比');
    });
  });

  await progressTests.run();

  // 统计总结果
  const totalTests = utilTests.tests.length + successTests.tests.length +
                    failureTests.tests.length + progressTests.tests.length;
  const totalPassed = utilTests.passed + successTests.passed +
                     failureTests.passed + progressTests.passed;
  const totalFailed = utilTests.failed + successTests.failed +
                     failureTests.failed + progressTests.failed;

  console.log('\n' + '='.repeat(60));
  console.log('🎯 测试汇总');
  console.log('='.repeat(60));
  console.log(`总测试数: ${totalTests}`);
  console.log(`✅ 通过: ${totalPassed}`);
  console.log(`❌ 失败: ${totalFailed}`);
  console.log(`📊 通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

  if (totalFailed === 0) {
    console.log('\n🎉 所有测试通过！下载模块功能完整。');
    console.log('✅ 支持自定义 yt-dlp 路径');
    console.log('✅ 支持依赖注入和 mock');
    console.log('✅ 覆盖成功和失败路径');
    console.log('✅ 验证进度回调机制');
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

module.exports = { TestSuite, Assert, MockYtDlpWrap };