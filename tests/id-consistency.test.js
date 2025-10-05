#!/usr/bin/env node

/**
 * ID一致性集成测试
 * 测试main.js生成的job ID与JobQueue中的ID保持一致
 * 这修复了之前的严重回归问题
 */

const fs = require('fs');
const path = require('path');

// 模拟 Electron 环境
const mockIpcMain = {
  handlers: {},
  handle(channel, handler) {
    this.handlers[channel] = handler;
    console.log(`📡 注册 IPC 处理器: ${channel}`);
  }
};

const mockApp = {
  getPath: (name) => {
    const paths = {
      downloads: '/tmp/downloads',
      userData: '/tmp/userdata'
    };
    return paths[name] || '/tmp';
  }
};

const mockWindow = {
  webContents: {
    send: (channel, data) => {
      console.log(`📤 推送到 UI [${channel}]:`, JSON.stringify(data, null, 2));
    }
  },
  isDestroyed: () => false
};

// 设置全局模拟
global.ipcMain = mockIpcMain;
global.app = mockApp;
global.win = mockWindow;

// 导入作业管理模块
const { JobQueueClass, JobStatus } = require('../src/jobs/queue');

// 创建作业队列
const jobQueue = new JobQueueClass();

// 模拟 main.js 中的作业创建逻辑
function createJobInMain(jobData) {
  // 这就是main.js中的ID生成逻辑
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const job = {
    id: jobId, // main.js生成的ID
    url: jobData.url,
    outputDir: jobData.outputDir,
    options: jobData.options || {},
    metadata: jobData.metadata || {}
  };

  // 将作业加入队列 - 现在会保持原始ID
  const queuedJob = jobQueue.add(job);

  return { job, queuedJob };
}

// 测试套件
class IDConsistencyTestSuite {
  constructor() {
    this.name = 'ID一致性集成测试';
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(description, testFn) {
    this.tests.push({ description, testFn });
  }

  async run() {
    console.log(`\n🧪 运行测试套件: ${this.name}`);
    console.log('='.repeat(60));

    for (const { description, testFn } of this.tests) {
      try {
        await testFn();
        console.log(`✅ ${description}`);
        this.passed++;
      } catch (error) {
        console.log(`❌ ${description}`);
        console.log(`   错误: ${error.message}`);
        this.failed++;
      }
    }

    console.log('='.repeat(60));
    console.log(`通过: ${this.passed}/${this.tests.length}, 失败: ${this.failed}/${this.tests.length}`);

    return this.failed === 0;
  }
}

// 主测试函数
async function main() {
  console.log('🚀 开始运行ID一致性集成测试');

  const testSuite = new IDConsistencyTestSuite();

  // 测试1: 基础ID一致性
  testSuite.test('基础ID一致性验证', async () => {
    const jobData = {
      url: 'https://youtube.com/watch?v=test123',
      outputDir: '/tmp/test_id_consistency',
      options: { language: 'zh' }
    };

    const { job, queuedJob } = createJobInMain(jobData);

    // 验证ID保持一致
    if (job.id !== queuedJob.id) {
      throw new Error(`ID不一致: main.js生成的ID=${job.id}, 队列中的ID=${queuedJob.id}`);
    }

    // 验证作业确实在队列中
    const retrievedJob = jobQueue.get(job.id);
    if (!retrievedJob) {
      throw new Error(`无法通过ID ${job.id} 检索到作业`);
    }

    if (retrievedJob.id !== job.id) {
      throw new Error(`检索到的作业ID不匹配: 期望=${job.id}, 实际=${retrievedJob.id}`);
    }

    console.log(`✅ ID一致性验证通过: ${job.id}`);
  });

  // 测试2: 作业生命周期中的ID一致性
  testSuite.test('作业生命周期中的ID一致性', async () => {
    const jobData = {
      url: 'https://youtube.com/watch?v=lifecycle_test',
      outputDir: '/tmp/test_lifecycle',
      options: { language: 'auto' }
    };

    const { job } = createJobInMain(jobData);
    const jobId = job.id;

    // 验证初始状态
    let currentJob = jobQueue.get(jobId);
    if (currentJob.status !== JobStatus.PENDING) {
      throw new Error(`期望初始状态为 PENDING，实际为 ${currentJob.status}`);
    }

    // 推进到下载阶段
    jobQueue.advanceStage(jobId, JobStatus.DOWNLOADING);
    currentJob = jobQueue.get(jobId);
    if (currentJob.status !== JobStatus.DOWNLOADING) {
      throw new Error(`期望状态为 DOWNLOADING，实际为 ${currentJob.status}`);
    }

    // 更新进度
    jobQueue.updateProgress(jobId, 50, 100, '下载中...');
    currentJob = jobQueue.get(jobId);
    if (currentJob.progress.current !== 50) {
      throw new Error(`期望进度为 50，实际为 ${currentJob.progress.current}`);
    }

    // 推进到音频提取阶段
    jobQueue.advanceStage(jobId, JobStatus.EXTRACTING);
    currentJob = jobQueue.get(jobId);
    if (currentJob.status !== JobStatus.EXTRACTING) {
      throw new Error(`期望状态为 EXTRACTING，实际为 ${currentJob.status}`);
    }

    // 推进到转写阶段
    jobQueue.advanceStage(jobId, JobStatus.TRANSCRIBING);
    currentJob = jobQueue.get(jobId);
    if (currentJob.status !== JobStatus.TRANSCRIBING) {
      throw new Error(`期望状态为 TRANSCRIBING，实际为 ${currentJob.status}`);
    }

    // 推进到完成
    jobQueue.advanceStage(jobId, JobStatus.PACKING);
    jobQueue.advanceStage(jobId, JobStatus.COMPLETED);
    currentJob = jobQueue.get(jobId);
    if (currentJob.status !== JobStatus.COMPLETED) {
      throw new Error(`期望最终状态为 COMPLETED，实际为 ${currentJob.status}`);
    }

    // 验证所有操作都使用相同的ID成功
    console.log(`✅ 生命周期ID一致性验证通过: ${jobId}`);
  });

  // 测试3: 作业取消时的ID一致性
  testSuite.test('作业取消时的ID一致性', async () => {
    const jobData = {
      url: 'https://youtube.com/watch?v=cancel_test',
      outputDir: '/tmp/test_cancel_id',
      options: { language: 'zh' }
    };

    const { job } = createJobInMain(jobData);
    const jobId = job.id;

    // 取消作业
    const success = jobQueue.cancel(jobId, '测试取消');
    if (!success) {
      throw new Error('作业取消失败');
    }

    const cancelledJob = jobQueue.get(jobId);
    if (cancelledJob.status !== JobStatus.CANCELLED) {
      throw new Error(`期望状态为 CANCELLED，实际为 ${cancelledJob.status}`);
    }

    if (cancelledJob.id !== jobId) {
      throw new Error(`取消后的作业ID不匹配`);
    }

    console.log(`✅ 取消操作ID一致性验证通过: ${jobId}`);
  });

  // 测试4: 作业失败时的ID一致性
  testSuite.test('作业失败时的ID一致性', async () => {
    const jobData = {
      url: 'https://youtube.com/watch?v=fail_test',
      outputDir: '/tmp/test_fail_id',
      options: { language: 'en' }
    };

    const { job } = createJobInMain(jobData);
    const jobId = job.id;

    // 标记作业失败
    const errorInfo = {
      code: 'NETWORK_ERROR',
      message: '网络连接失败',
      suggestion: '请检查网络连接后重试'
    };

    jobQueue.fail(jobId, errorInfo);

    const failedJob = jobQueue.get(jobId);
    if (failedJob.status !== JobStatus.FAILED) {
      throw new Error(`期望状态为 FAILED，实际为 ${failedJob.status}`);
    }

    if (failedJob.id !== jobId) {
      throw new Error(`失败后的作业ID不匹配`);
    }

    if (!failedJob.error || failedJob.error.code !== errorInfo.code) {
      throw new Error('错误信息未正确保存');
    }

    console.log(`✅ 失败处理ID一致性验证通过: ${jobId}`);
  });

  // 测试5: 多个作业的ID唯一性
  testSuite.test('多个作业的ID唯一性', async () => {
    const jobs = [];
    const jobIds = new Set();

    // 创建多个作业
    for (let i = 0; i < 5; i++) {
      const jobData = {
        url: `https://youtube.com/watch?v=unique_test_${i}`,
        outputDir: `/tmp/test_unique_${i}`,
        options: { language: 'zh' }
      };

      const { job } = createJobInMain(jobData);
      jobs.push(job);
      jobIds.add(job.id);
    }

    // 验证所有ID都是唯一的
    if (jobIds.size !== jobs.length) {
      throw new Error(`期望 ${jobs.length} 个唯一ID，实际 ${jobIds.size} 个`);
    }

    // 验证每个作业都可以通过其ID访问
    for (const job of jobs) {
      const retrievedJob = jobQueue.get(job.id);
      if (!retrievedJob) {
        throw new Error(`无法访问作业 ${job.id}`);
      }
      if (retrievedJob.id !== job.id) {
        throw new Error(`作业 ${job.id} 的ID不匹配`);
      }
    }

    console.log(`✅ 多作业ID唯一性验证通过，创建了 ${jobs.length} 个唯一作业`);
  });

  // 测试6: IPC处理器中的ID一致性
  testSuite.test('IPC处理器中的ID一致性', async () => {
    // 模拟main.js中的job:create IPC处理器逻辑
    const mockIpcEvent = {};
    const jobData = {
      url: 'https://youtube.com/watch?v=ipc_test',
      options: {
        language: 'zh',
        useMetal: true
      }
    };

    // main.js中的ID生成和作业创建逻辑
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const jobOutputDir = path.join('/tmp/downloads', 'ytDownloader', jobId);

    if (!fs.existsSync(jobOutputDir)) {
      fs.mkdirSync(jobOutputDir, { recursive: true });
    }

    const job = jobQueue.add({
      id: jobId, // 现在会保持这个ID
      url: jobData.url,
      outputDir: jobOutputDir,
      options: jobData.options || {}
    });

    // 验证IPC处理器返回的ID与队列中的ID一致
    if (job.id !== jobId) {
      throw new Error(`IPC处理器ID不一致: 期望=${jobId}, 实际=${job.id}`);
    }

    // 模拟后续的IPC操作都使用相同的ID
    const retrievedJob = jobQueue.get(jobId);
    if (!retrievedJob) {
      throw new Error('IPC处理器无法通过ID检索作业');
    }

    // 模拟job:list IPC处理器
    const allJobs = jobQueue.getAll();
    const ourJob = allJobs.find(j => j.id === jobId);
    if (!ourJob) {
      throw new Error('job:list无法找到我们的作业');
    }

    // 模拟job:get IPC处理器
    const specificJob = jobQueue.get(jobId);
    if (!specificJob || specificJob.id !== jobId) {
      throw new Error('job:get返回错误的作业');
    }

    console.log(`✅ IPC处理器ID一致性验证通过: ${jobId}`);
  });

  // 运行测试
  const success = await testSuite.run();

  // 清理测试目录
  const testDirs = [
    '/tmp/test_id_consistency',
    '/tmp/test_lifecycle',
    '/tmp/test_cancel_id',
    '/tmp/test_fail_id'
  ];

  for (let i = 0; i < 5; i++) {
    testDirs.push(`/tmp/test_unique_${i}`);
  }

  for (const dir of testDirs) {
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          fs.unlinkSync(path.join(dir, file));
        });
        fs.rmdirSync(dir);
      }
    } catch (error) {
      // 忽略清理错误
    }
  }

  // 输出结果
  console.log('\n' + '='.repeat(60));
  console.log('🎯 ID一致性集成测试汇总');
  console.log('='.repeat(60));
  console.log(`总测试数: ${testSuite.tests.length}`);
  console.log(`✅ 通过: ${testSuite.passed}`);
  console.log(`❌ 失败: ${testSuite.failed}`);
  console.log(`📊 通过率: ${((testSuite.passed / testSuite.tests.length) * 100).toFixed(1)}%`);

  if (success) {
    console.log('\n🎉 所有ID一致性测试通过！');
    console.log('✅ main.js生成的ID与队列中的ID保持一致');
    console.log('✅ 作业生命周期中ID保持一致');
    console.log('✅ 取消、失败操作ID保持一致');
    console.log('✅ 多作业ID唯一性验证通过');
    console.log('✅ IPC处理器ID一致性验证通过');
    console.log('\n🚀 ID同步问题已完全修复，主进程与队列集成完全就绪！');
    process.exit(0);
  } else {
    console.log('\n💥 部分ID一致性测试失败，请检查实现。');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('ID一致性测试运行出错:', error);
    process.exit(1);
  });
}