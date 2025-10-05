#!/usr/bin/env node

/**
 * 作业队列单元测试
 * 覆盖正常流程、失败流程、状态转换和事件机制
 */

const { JobQueue, JobStatus } = require('../src/jobs/queue');

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

  static throws(fn, expectedError, message) {
    try {
      fn();
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

// 测试前重置队列
function resetQueue() {
  // 由于 JobQueue 是单例，我们需要手动清理所有作业
  const allJobs = JobQueue.getAll();
  for (const job of allJobs) {
    // 直接从 Map 中删除，绕过终态检查
    JobQueue.jobs.delete(job.id);
  }
  // 清除所有监听器
  JobQueue.clearListeners();
  // 确保监听器计数器也被重置
  JobQueue.listenerIdCounter = 0;
  JobQueue.listenerMap.clear();
}

// 等待异步事件的工具函数
function waitForEvents(ms = 50) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 开始运行作业队列单元测试');

  // 测试1: 作业创建和基本操作
  const basicTests = new TestSuite('基本功能测试');

  basicTests.test('创建作业', () => {
    resetQueue();

    const job = JobQueue.add({
      url: 'https://youtube.com/watch?v=test123',
      outputDir: '/tmp/downloads'
    });

    Assert.notNull(job, '作业应该被创建');
    Assert.notNull(job.id, '作业应该有ID');
    Assert.equals(job.status, JobStatus.PENDING, '初始状态应为PENDING');
    Assert.notNull(job.createdAt, '应该有创建时间');
    Assert.notNull(job.updatedAt, '应该有更新时间');
  });

  basicTests.test('作业数据验证', () => {
    resetQueue();

    Assert.throws(
      () => JobQueue.add({}),
      '必须包含 url 和 outputDir 字段',
      '缺少必需字段时应抛出异常'
    );

    Assert.throws(
      () => JobQueue.add({ url: 'test' }),
      '必须包含 url 和 outputDir 字段',
      '缺少outputDir时应抛出异常'
    );
  });

  basicTests.test('作业查询和更新', () => {
    resetQueue();

    const job = JobQueue.add({
      url: 'https://example.com/video1',
      outputDir: '/tmp/test1'
    });

    const retrieved = JobQueue.get(job.id);
    Assert.equals(retrieved.id, job.id, '应该能通过ID获取作业');
    Assert.equals(retrieved.url, job.url, '作业URL应该匹配');

    const updated = JobQueue.update(job.id, {
      metadata: { title: 'Test Video' }
    });
    Assert.isTrue(updated, '更新应该成功');

    const updatedJob = JobQueue.get(job.id);
    Assert.equals(updatedJob.metadata.title, 'Test Video', '元数据应该被更新');
  });

  await basicTests.run();

  // 测试2: 状态转换验证
  const stateTransitionTests = new TestSuite('状态转换测试');

  stateTransitionTests.test('正常状态转换流程', async () => {
    resetQueue();

    const events = [];
    JobQueue.subscribe(event => {
      if (event.type === 'job:stage-changed') {
        events.push(event);
      }
    });

    const job = JobQueue.add({
      url: 'https://example.com/video2',
      outputDir: '/tmp/test2'
    });

    // 正常流程
    JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
    JobQueue.advanceStage(job.id, JobStatus.EXTRACTING);
    JobQueue.advanceStage(job.id, JobStatus.TRANSCRIBING);
    JobQueue.advanceStage(job.id, JobStatus.PACKING);
    JobQueue.advanceStage(job.id, JobStatus.COMPLETED);

    await waitForEvents(100);

    Assert.equals(events.length, 5, '应该有5个状态变更事件');
    Assert.equals(events[0].oldStatus, JobStatus.PENDING, '初始状态应为PENDING');
    Assert.equals(events[4].newStatus, JobStatus.COMPLETED, '最终状态应为COMPLETED');
  });

  stateTransitionTests.test('失败状态转换', () => {
    resetQueue();

    const job = JobQueue.add({
      url: 'https://example.com/video3',
      outputDir: '/tmp/test3'
    });

    Assert.isTrue(JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING), '应该能转换到DOWNLOADING');

    const failResult = JobQueue.fail(job.id, {
      code: 'NETWORK_ERROR',
      message: '网络连接失败'
    });
    Assert.isTrue(failResult, '应该能标记为失败');

    const failedJob = JobQueue.get(job.id);
    Assert.equals(failedJob.status, JobStatus.FAILED, '状态应为FAILED');
    Assert.notNull(failedJob.error, '应该有错误信息');
    Assert.equals(failedJob.error.code, 'NETWORK_ERROR', '错误代码应该匹配');
  });

  stateTransitionTests.test('取消状态转换', () => {
    resetQueue();

    const job = JobQueue.add({
      url: 'https://example.com/video4',
      outputDir: '/tmp/test4'
    });

    const cancelResult = JobQueue.cancel(job.id, '用户主动取消');
    Assert.isTrue(cancelResult, '应该能取消作业');

    const cancelledJob = JobQueue.get(job.id);
    Assert.equals(cancelledJob.status, JobStatus.CANCELLED, '状态应为CANCELLED');
  });

  stateTransitionTests.test('非法状态转换', () => {
    resetQueue();

    const job = JobQueue.add({
      url: 'https://example.com/video5',
      outputDir: '/tmp/test5'
    });

    Assert.throws(
      () => JobQueue.advanceStage(job.id, JobStatus.COMPLETED),
      '无效的状态转换',
      '从PENDING直接到COMPLETED应该失败'
    );

    // 测试从终态无法继续转换
    JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
    JobQueue.fail(job.id, { code: 'ERROR', message: 'test' });

    Assert.throws(
      () => JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING),
      '无效的状态转换',
      '从FAILED状态继续转换应该失败'
    );
  });

  await stateTransitionTests.run();

  // 测试3: 进度更新和统计
  const progressTests = new TestSuite('进度和统计测试');

  progressTests.test('进度更新', async () => {
    resetQueue();

    const events = [];
    JobQueue.subscribe(event => {
      if (event.type === 'job:progress-updated') {
        events.push(event);
      }
    });

    const job = JobQueue.add({
      url: 'https://example.com/video6',
      outputDir: '/tmp/test6'
    });

    const updateResult = JobQueue.updateProgress(job.id, 50, 100, '下载中...');
    Assert.isTrue(updateResult, '进度更新应该成功');

    await waitForEvents(50);

    Assert.equals(events.length, 1, '应该有进度更新事件');
    Assert.equals(events[0].newProgress.current, 50, '进度值应该匹配');
    Assert.equals(events[0].newProgress.message, '下载中...', '进度消息应该匹配');

    const updatedJob = JobQueue.get(job.id);
    Assert.equals(updatedJob.progress.current, 50, '作业进度应该被更新');
  });

  progressTests.test('统计信息', () => {
    resetQueue();

    // 创建不同状态的作业
    const job1 = JobQueue.add({ url: 'url1', outputDir: '/tmp1' });
    const job2 = JobQueue.add({ url: 'url2', outputDir: '/tmp2' });
    const job3 = JobQueue.add({ url: 'url3', outputDir: '/tmp3' });

    JobQueue.advanceStage(job1.id, JobStatus.DOWNLOADING);
    JobQueue.advanceStage(job2.id, JobStatus.DOWNLOADING);
    JobQueue.advanceStage(job2.id, JobStatus.EXTRACTING);

    // job3 完成完整流程
    JobQueue.advanceStage(job3.id, JobStatus.DOWNLOADING);
    JobQueue.advanceStage(job3.id, JobStatus.EXTRACTING);
    JobQueue.advanceStage(job3.id, JobStatus.TRANSCRIBING);
    JobQueue.advanceStage(job3.id, JobStatus.PACKING);
    JobQueue.advanceStage(job3.id, JobStatus.COMPLETED);

    const stats = JobQueue.getStats();

    Assert.equals(stats.total, 3, '总数应为3');
    Assert.equals(stats.pending, 0, '待处理应为0');
    Assert.equals(stats.inProgress, 2, '进行中应为2');
    Assert.equals(stats.completed, 1, '完成应为1');
    Assert.equals(stats.failed, 0, '失败应为0');
  });

  progressTests.test('按状态查询', () => {
    resetQueue();

    // 创建三个不同状态的作业
    const job1 = JobQueue.add({ url: 'url1', outputDir: '/tmp1' });
    const job2 = JobQueue.add({ url: 'url2', outputDir: '/tmp2' });
    const job3 = JobQueue.add({ url: 'url3', outputDir: '/tmp3' });

    // job1 保持 PENDING
    // job2 转换到 DOWNLOADING
    JobQueue.advanceStage(job2.id, JobStatus.DOWNLOADING);

    // job3 取消
    JobQueue.cancel(job3.id, '测试取消');

    const pendingJobs = JobQueue.getByStatus(JobStatus.PENDING);
    const downloadingJobs = JobQueue.getByStatus(JobStatus.DOWNLOADING);
    const cancelledJobs = JobQueue.getByStatus(JobStatus.CANCELLED);

    Assert.equals(pendingJobs.length, 1, 'PENDING作业应为1');
    Assert.equals(downloadingJobs.length, 1, 'DOWNLOADING作业应为1');
    Assert.equals(cancelledJobs.length, 1, 'CANCELLED作业应为1');
  });

  await progressTests.run();

  // 测试4: 事件订阅机制
  const eventTests = new TestSuite('事件订阅测试');

  eventTests.test('事件订阅和取消订阅', async () => {
    resetQueue();

    const events = [];
    const listener = (event) => {
      events.push(event.type);
    };

    const listenerId = JobQueue.subscribe(listener);

    const job = JobQueue.add({ url: 'url1', outputDir: '/tmp1' });
    JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);

    await waitForEvents(50);

    Assert.isTrue(events.includes('job:created'), '应该收到创建事件');
    Assert.isTrue(events.includes('job:stage-changed'), '应该收到状态变更事件');

    const unsubscribeResult = JobQueue.unsubscribe(listenerId);
    Assert.isTrue(unsubscribeResult, '取消订阅应该成功');

    // 再次操作不应收到事件
    events.length = 0;
    JobQueue.advanceStage(job.id, JobStatus.EXTRACTING);
    await waitForEvents(50);

    Assert.equals(events.length, 0, '取消订阅后不应收到事件');
  });

  eventTests.test('多监听器支持', async () => {
    resetQueue();

    const events1 = [];
    const events2 = [];

    JobQueue.subscribe((event) => events1.push(event.type));
    JobQueue.subscribe((event) => events2.push(event.type));

    const job = JobQueue.add({ url: 'url1', outputDir: '/tmp1' });
    await waitForEvents(50);

    Assert.equals(events1.length, 1, '监听器1应该收到事件');
    Assert.equals(events2.length, 1, '监听器2应该收到事件');
    Assert.equals(events1[0], 'job:created', '事件类型应该正确');
    Assert.equals(events2[0], 'job:created', '事件类型应该正确');
  });

  eventTests.test('监听器异常处理', async () => {
    resetQueue();

    // 添加一个会抛出异常的监听器
    JobQueue.subscribe(() => {
      throw new Error('监听器测试异常');
    });

    // 添加正常监听器
    const events = [];
    JobQueue.subscribe((event) => events.push(event.type));

    // 创建作业，不应该因为异常监听器而中断
    const job = JobQueue.add({ url: 'url1', outputDir: '/tmp1' });
    await waitForEvents(50);

    Assert.equals(events.length, 1, '正常监听器应该仍然工作');
  });

  await eventTests.run();

  // 测试5: 作业清理
  const cleanupTests = new TestSuite('清理功能测试');

  cleanupTests.test('作业删除', () => {
    resetQueue();

    const job = JobQueue.add({ url: 'url1', outputDir: '/tmp1' });

    // 完成完整流程
    JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
    JobQueue.advanceStage(job.id, JobStatus.EXTRACTING);
    JobQueue.advanceStage(job.id, JobStatus.TRANSCRIBING);
    JobQueue.advanceStage(job.id, JobStatus.PACKING);
    JobQueue.advanceStage(job.id, JobStatus.COMPLETED);

    const removeResult = JobQueue.remove(job.id);
    Assert.isTrue(removeResult, '终态作业应该能被删除');

    const deletedJob = JobQueue.get(job.id);
    Assert.isTrue(deletedJob === null, '删除后应该查询不到');
  });

  cleanupTests.test('删除非终态作业', () => {
    resetQueue();

    const job = JobQueue.add({ url: 'url1', outputDir: '/tmp1' });

    const removeResult = JobQueue.remove(job.id);
    Assert.isTrue(!removeResult, '非终态作业不应该能被删除');
  });

  await cleanupTests.run();

  // 统计总结果
  const totalTests = basicTests.tests.length +
                    stateTransitionTests.tests.length +
                    progressTests.tests.length +
                    eventTests.tests.length +
                    cleanupTests.tests.length;

  const totalPassed = basicTests.passed +
                     stateTransitionTests.passed +
                     progressTests.passed +
                     eventTests.passed +
                     cleanupTests.passed;

  const totalFailed = basicTests.failed +
                     stateTransitionTests.failed +
                     progressTests.failed +
                     eventTests.failed +
                     cleanupTests.failed;

  console.log('\n' + '='.repeat(60));
  console.log('🎯 测试汇总');
  console.log('='.repeat(60));
  console.log(`总测试数: ${totalTests}`);
  console.log(`✅ 通过: ${totalPassed}`);
  console.log(`❌ 失败: ${totalFailed}`);
  console.log(`📊 通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

  if (totalFailed === 0) {
    console.log('\n🎉 所有测试通过！作业队列模块工作正常。');
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