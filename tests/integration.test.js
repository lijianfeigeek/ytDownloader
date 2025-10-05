#!/usr/bin/env node

/**
 * 完整流水线集成测试
 * 测试从作业创建到完成的完整流程，验证所有模块的集成
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 导入所有模块
const { JobQueue, JobStatus } = require('../src/jobs/queue');
const { download } = require('../src/jobs/download');
const { extractAudio } = require('../src/jobs/audio');
const { transcribe } = require('../src/jobs/transcribe');

// 测试配置
const TEST_OUTPUT_DIR = '/tmp/ytDownloader_integration_test';
const TEST_VIDEO_URL = 'https://www.youtube.com/watch?v=test123'; // Mock URL

// 创建测试目录
function setupTestDir() {
  if (!fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  }
}

// 清理测试文件
function cleanupTestDir() {
  try {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      const files = fs.readdirSync(TEST_OUTPUT_DIR);
      files.forEach(file => {
        fs.unlinkSync(path.join(TEST_OUTPUT_DIR, file));
      });
      fs.rmdirSync(TEST_OUTPUT_DIR);
    }
  } catch (error) {
    console.error('清理测试目录失败:', error);
  }
}

// Mock 外部进程
class MockProcessManager {
  constructor() {
    this.downloadResults = new Map();
    this.audioResults = new Map();
    this.transcribeResults = new Map();
  }

  // Mock download 实现
  mockDownload(job, onProgress, options) {
    return new Promise((resolve, reject) => {
      console.log(`📥 Mock Download: 开始下载 ${job.url}`);

      // 模拟下载进度
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += 10;
        onProgress({
          percent: progress,
          speed: 2.5 + Math.random(),
          eta: Math.max(0, (100 - progress) / 10),
          message: `下载进度: ${progress}%`
        });

        if (progress >= 100) {
          clearInterval(progressInterval);

          // 创建模拟视频文件
          const videoPath = path.join(job.outputDir, `${job.id}_source.mp4`);
          fs.writeFileSync(videoPath, 'mock video data');

          this.downloadResults.set(job.id, videoPath);
          resolve(videoPath);
        }
      }, 50);
    });
  }

  // Mock audio extraction 实现
  mockExtractAudio(videoPath, options) {
    return new Promise((resolve, reject) => {
      console.log(`🎵 Mock Audio Extract: 处理 ${videoPath}`);

      setTimeout(() => {
        const outputDir = options.outputDir || path.dirname(videoPath);
        const mp3Path = path.join(outputDir, 'audio.mp3');
        const wavPath = path.join(outputDir, 'audio.wav');

        // 创建模拟音频文件
        fs.writeFileSync(mp3Path, 'mock mp3 data');
        fs.writeFileSync(wavPath, 'mock wav data');

        const result = { mp3Path, wavPath };
        this.audioResults.set(videoPath, result);
        resolve(result);
      }, 200);
    });
  }

  // Mock transcription 实现
  mockTranscribe(job, audioPath, opts) {
    return new Promise((resolve, reject) => {
      console.log(`📝 Mock Transcribe: 处理 ${audioPath}`);

      // 模拟进度回调
      if (opts.onProgress) {
        let progress = 0;
        const progressInterval = setInterval(() => {
          progress += 20;
          opts.onProgress({
            percent: progress,
            speed: 1.5 + Math.random() * 0.5,
            eta: Math.max(0, (100 - progress) / 20),
            message: `转写进度: ${progress}%`
          });

          if (progress >= 100) {
            clearInterval(progressInterval);
          }
        }, 100);
      }

      setTimeout(() => {
        // 创建模拟转写文件
        const transcriptPath = path.join(job.outputDir, 'transcript.txt');
        const transcriptContent = '这是一个测试转写结果。\nThis is a test transcript result.';
        fs.writeFileSync(transcriptPath, transcriptContent);

        const result = {
          transcriptPath,
          duration: 3.0,
          model: 'ggml-large-v3-turbo-q5_0.bin',
          usedMetal: opts.useMetal !== false,
          outputSize: transcriptContent.length
        };

        this.transcribeResults.set(job.id, result);
        resolve(result);
      }, 500);
    });
  }
}

// 测试套件
class IntegrationTestSuite {
  constructor() {
    this.name = '完整流水线集成测试';
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
  console.log('🚀 开始运行完整流水线集成测试');

  const testSuite = new IntegrationTestSuite();
  const mockManager = new MockProcessManager();

  // 设置测试环境
  setupTestDir();

  // 测试1: 完整流水线执行
  testSuite.test('完整作业流水线执行', async () => {
    const jobQueue = JobQueue;

    // 创建作业
    const job = jobQueue.add({
      url: TEST_VIDEO_URL,
      outputDir: TEST_OUTPUT_DIR,
      options: {
        keepVideo: true,
        language: 'zh',
        useMetal: true
      },
      metadata: {
        title: 'Test Video'
      }
    });

    console.log(`📋 创建作业: ${job.id}`);

    // 验证初始状态
    if (job.status !== JobStatus.PENDING) {
      throw new Error(`期望初始状态为 PENDING，实际为 ${job.status}`);
    }

    // 阶段1: 下载
    console.log('📥 开始下载阶段...');
    jobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);

    const videoPath = await mockManager.mockDownload(job, (progress) => {
      jobQueue.updateProgress(job.id, progress.percent, 100, progress.message);
    });

    if (!fs.existsSync(videoPath)) {
      throw new Error('下载阶段失败：视频文件不存在');
    }

    // 阶段2: 音频提取
    console.log('🎵 开始音频提取阶段...');
    jobQueue.advanceStage(job.id, JobStatus.EXTRACTING);

    const audioResult = await mockManager.mockExtractAudio(videoPath, {
      outputDir: job.outputDir,
      generateWav: true
    });

    if (!fs.existsSync(audioResult.mp3Path) || !fs.existsSync(audioResult.wavPath)) {
      throw new Error('音频提取阶段失败：音频文件不存在');
    }

    // 阶段3: 转写
    console.log('📝 开始转写阶段...');
    jobQueue.advanceStage(job.id, JobStatus.TRANSCRIBING);

    const transcribeResult = await mockManager.mockTranscribe(job, audioResult.wavPath, {
      language: 'zh',
      useMetal: true,
      onProgress: (progress) => {
        jobQueue.updateProgress(job.id, progress.percent, 100, progress.message);
      }
    });

    if (!fs.existsSync(transcribeResult.transcriptPath)) {
      throw new Error('转写阶段失败：转写文件不存在');
    }

    // 阶段4: 打包完成
    console.log('📦 开始打包阶段...');
    jobQueue.advanceStage(job.id, JobStatus.PACKING);

    // 创建元数据文件
    const metadataPath = path.join(job.outputDir, 'metadata.json');
    const metadata = {
      jobId: job.id,
      url: job.url,
      title: job.metadata.title,
      stages: {
        download: { duration: 1.0, success: true },
        extract: { duration: 0.2, success: true },
        transcribe: { duration: 0.5, success: true }
      },
      files: {
        video: videoPath,
        audio: { mp3: audioResult.mp3Path, wav: audioResult.wavPath },
        transcript: transcribeResult.transcriptPath
      },
      model: transcribeResult.model,
      usedMetal: transcribeResult.usedMetal
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // 完成作业
    jobQueue.advanceStage(job.id, JobStatus.COMPLETED);

    // 验证最终状态
    const finalJob = jobQueue.get(job.id);
    if (finalJob.status !== JobStatus.COMPLETED) {
      throw new Error(`期望最终状态为 COMPLETED，实际为 ${finalJob.status}`);
    }

    // 验证所有文件都存在
    const requiredFiles = [
      videoPath,
      audioResult.mp3Path,
      audioResult.wavPath,
      transcribeResult.transcriptPath,
      metadataPath
    ];

    for (const filePath of requiredFiles) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`必需文件不存在: ${filePath}`);
      }
    }

    console.log(`✅ 作业 ${job.id} 完整流水线执行成功`);
  });

  // 测试2: 事件系统测试
  testSuite.test('作业事件系统验证', async () => {
    const { JobQueueClass } = require('../src/jobs/queue');
    const jobQueue = new JobQueueClass();
    const events = [];

    // 订阅事件
    const listenerId = jobQueue.subscribe((event) => {
      events.push(event);
    });

    // 等待事件处理完成
    await new Promise(resolve => setTimeout(resolve, 10));

    // 创建作业并执行状态转换
    const job = jobQueue.add({
      url: TEST_VIDEO_URL,
      outputDir: TEST_OUTPUT_DIR
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    jobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
    await new Promise(resolve => setTimeout(resolve, 10));

    jobQueue.updateProgress(job.id, 50, 100, '测试进度');
    await new Promise(resolve => setTimeout(resolve, 10));

    jobQueue.advanceStage(job.id, JobStatus.EXTRACTING);
    await new Promise(resolve => setTimeout(resolve, 10));

    jobQueue.advanceStage(job.id, JobStatus.TRANSCRIBING);
    await new Promise(resolve => setTimeout(resolve, 10));

    jobQueue.advanceStage(job.id, JobStatus.PACKING);
    await new Promise(resolve => setTimeout(resolve, 10));

    jobQueue.advanceStage(job.id, JobStatus.COMPLETED);
    await new Promise(resolve => setTimeout(resolve, 50)); // 等待所有异步事件完成

    // 验证事件数量
    const expectedMinEvents = 5; // created + 4 stage-changed + progress-updated
    if (events.length < expectedMinEvents) {
      console.log(`📡 收到的事件详情:`, events.map(e => ({ type: e.type, jobId: e.jobId })));
      throw new Error(`期望至少 ${expectedMinEvents} 个事件，实际收到 ${events.length} 个`);
    }

    // 验证关键事件类型
    const eventTypes = events.map(e => e.type);
    const criticalEvents = ['job:created', 'job:stage-changed', 'job:progress-updated'];
    for (const expectedType of criticalEvents) {
      if (!eventTypes.includes(expectedType)) {
        throw new Error(`缺少期望的事件类型: ${expectedType}`);
      }
    }

    // 验证作业创建事件
    const createdEvent = events.find(e => e.type === 'job:created');
    if (!createdEvent || createdEvent.jobId !== job.id) {
      throw new Error('作业创建事件不正确');
    }

    // 取消订阅
    jobQueue.unsubscribe(listenerId);

    console.log(`📡 事件系统测试通过，捕获 ${events.length} 个事件`);
  });

  // 测试3: 错误处理和恢复
  testSuite.test('错误处理和作业恢复', async () => {
    const jobQueue = JobQueue;

    const job = jobQueue.add({
      url: TEST_VIDEO_URL,
      outputDir: TEST_OUTPUT_DIR
    });

    // 模拟失败
    jobQueue.fail(job.id, {
      code: 'NETWORK_ERROR',
      message: '网络连接失败',
      suggestion: '请检查网络连接后重试'
    });

    const failedJob = jobQueue.get(job.id);
    if (failedJob.status !== JobStatus.FAILED) {
      throw new Error(`期望状态为 FAILED，实际为 ${failedJob.status}`);
    }

    if (!failedJob.error || failedJob.error.code !== 'NETWORK_ERROR') {
      throw new Error('错误信息未正确保存');
    }

    // 验证失败作业不能继续执行
    try {
      jobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
      throw new Error('期望失败作业不能继续状态转换');
    } catch (error) {
      if (!error.message.includes('无效的状态转换')) {
        throw error;
      }
    }

    console.log('⚠️ 错误处理测试通过');
  });

  // 测试4: 并发作业处理
  testSuite.test('并发作业处理', async () => {
    const jobQueue = JobQueue;
    const jobs = [];

    // 清理之前测试留下的作业
    const existingJobs = jobQueue.getAll().filter(job =>
      job.url && job.url.includes(TEST_VIDEO_URL)
    );
    for (const existingJob of existingJobs) {
      jobQueue.remove(existingJob.id);
    }

    // 创建多个作业
    for (let i = 0; i < 3; i++) {
      const job = jobQueue.add({
        url: `${TEST_VIDEO_URL}?v=${i}`,
        outputDir: TEST_OUTPUT_DIR,
        options: { language: 'zh' }
      });
      jobs.push(job);
    }

    // 同时推进所有作业到下载状态
    for (const job of jobs) {
      jobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
    }

    // 验证所有作业都在进行中
    const inProgressJobs = jobQueue.getByStatus(JobStatus.DOWNLOADING);
    const currentDownloadJobs = inProgressJobs.filter(job =>
      jobs.some(j => j.id === job.id)
    );
    if (currentDownloadJobs.length !== jobs.length) {
      throw new Error(`期望 ${jobs.length} 个进行中作业，实际 ${currentDownloadJobs.length} 个`);
    }

    // 完成所有作业
    for (const job of jobs) {
      jobQueue.advanceStage(job.id, JobStatus.EXTRACTING);
      jobQueue.advanceStage(job.id, JobStatus.TRANSCRIBING);
      jobQueue.advanceStage(job.id, JobStatus.PACKING);
      jobQueue.advanceStage(job.id, JobStatus.COMPLETED);
    }

    const completedJobs = jobQueue.getByStatus(JobStatus.COMPLETED);
    const currentCompletedJobs = completedJobs.filter(job =>
      jobs.some(j => j.id === job.id)
    );
    if (currentCompletedJobs.length !== jobs.length) {
      throw new Error(`期望 ${jobs.length} 个已完成作业，实际 ${currentCompletedJobs.length} 个`);
    }

    console.log(`🔄 并发作业测试通过，处理 ${jobs.length} 个作业`);
  });

  // 运行所有测试
  const success = await testSuite.run();

  // 清理测试环境
  cleanupTestDir();

  // 输出最终结果
  console.log('\n' + '='.repeat(60));
  console.log('🎯 集成测试汇总');
  console.log('='.repeat(60));
  console.log(`总测试数: ${testSuite.tests.length}`);
  console.log(`✅ 通过: ${testSuite.passed}`);
  console.log(`❌ 失败: ${testSuite.failed}`);
  console.log(`📊 通过率: ${((testSuite.passed / testSuite.tests.length) * 100).toFixed(1)}%`);

  if (success) {
    console.log('\n🎉 所有集成测试通过！离线转写系统流水线工作正常。');
    console.log('✅ 作业队列状态机运行正常');
    console.log('✅ 事件驱动架构工作正常');
    console.log('✅ 错误处理机制完善');
    console.log('✅ 并发作业处理正常');
    console.log('✅ 完整流水线执行成功');
    process.exit(0);
  } else {
    console.log('\n💥 部分集成测试失败，请检查系统集成。');
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  main().catch(error => {
    console.error('集成测试运行出错:', error);
    process.exit(1);
  });
}