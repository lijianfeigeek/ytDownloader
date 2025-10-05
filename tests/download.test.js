#!/usr/bin/env node

/**
 * download.js 模块单元测试
 * 测试下载模块的基本功能和错误处理
 */

const { download, DownloadError } = require('../src/jobs/download');

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
  console.log('🚀 开始运行下载模块单元测试');

  // 测试1: 错误处理
  const errorTests = new TestSuite('错误处理测试');

  errorTests.test('无效作业对象', async () => {
    Assert.throws(
      async () => await download(null, () => {}),
      '作业对象必须是有效的对象',
      '应该抛出无效作业对象错误'
    );
  });

  errorTests.test('缺少必需字段', async () => {
    Assert.throws(
      async () => await download({}, () => {}),
      '作业缺少必需的 id 字段',
      '应该抛出缺少作业ID错误'
    );

    Assert.throws(
      async () => await download({ id: 'test' }, () => {}),
      '作业缺少必需的 url 字段',
      '应该抛出缺少URL错误'
    );

    Assert.throws(
      async () => await download({ id: 'test', url: 'test' }, () => {}),
      '作业缺少必需的 outputDir 字段',
      '应该抛出缺少输出目录错误'
    );
  });

  errorTests.test('无效URL格式', async () => {
    Assert.throws(
      async () => await download({
        id: 'test',
        url: 'invalid-url',
        outputDir: '/tmp'
      }, () => {}),
      '无效的 URL 格式',
      '应该抛出无效URL错误'
    );
  });

  errorTests.test('无效进度回调', async () => {
    Assert.throws(
      async () => await download({
        id: 'test',
        url: 'https://example.com/video',
        outputDir: '/tmp'
      }, 'not-a-function'),
      'onProgress 必须是一个函数',
      '应该抛出无效回调错误'
    );
  });

  await errorTests.run();

  // 测试2: DownloadError 类
  const classTests = new TestSuite('DownloadError 类测试');

  classTests.test('创建 DownloadError', () => {
    const error = new DownloadError('测试错误', 'TEST_CODE', { detail: 'test' });

    Assert.equals(error.name, 'DownloadError', '错误名称应该正确');
    Assert.equals(error.message, '测试错误', '错误消息应该正确');
    Assert.equals(error.code, 'TEST_CODE', '错误代码应该正确');
    Assert.isTrue(error.details.detail === 'test', '错误详情应该正确');
  });

  classTests.test('DownloadError JSON 序列化', () => {
    const error = new DownloadError('测试错误', 'TEST_CODE');
    const json = error.toJSON();

    Assert.equals(json.name, 'DownloadError', 'JSON序列化应包含名称');
    Assert.equals(json.message, '测试错误', 'JSON序列化应包含消息');
    Assert.equals(json.code, 'TEST_CODE', 'JSON序列化应包含代码');
  });

  await classTests.run();

  // 统计总结果
  const totalTests = errorTests.tests.length + classTests.tests.length;
  const totalPassed = errorTests.passed + classTests.passed;
  const totalFailed = errorTests.failed + classTests.failed;

  console.log('\n' + '='.repeat(60));
  console.log('🎯 测试汇总');
  console.log('='.repeat(60));
  console.log(`总测试数: ${totalTests}`);
  console.log(`✅ 通过: ${totalPassed}`);
  console.log(`❌ 失败: ${totalFailed}`);
  console.log(`📊 通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

  if (totalFailed === 0) {
    console.log('\n🎉 所有测试通过！下载模块基本功能正常。');
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

module.exports = { TestSuite, Assert };