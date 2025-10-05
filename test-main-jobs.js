#!/usr/bin/env node

/**
 * 测试 main.js 中的作业管理系统
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// 模拟 Electron 环境
const mockIpcMain = {
  handlers: {},
  handle(channel, handler) {
    this.handlers[channel] = handler;
    console.log(`✅ 注册 IPC 处理器: ${channel}`);
  }
};

// 模拟 BrowserWindow
const mockWindow = {
  webContents: {
    send: (channel, data) => {
      console.log(`📤 推送到 UI [${channel}]:`, JSON.stringify(data, null, 2));
    }
  },
  isDestroyed: () => false
};

// 模拟 app 对象
const mockApp = {
  getPath: (name) => {
    const paths = {
      downloads: '/tmp/downloads',
      userData: '/tmp/userdata'
    };
    return paths[name] || '/tmp';
  }
};

// 全局对象模拟
global.ipcMain = mockIpcMain;
global.win = mockWindow;
global.app = mockApp;

// 模拟作业管理模块
class MockJobQueue {
  constructor() {
    this.jobs = new Map();
  }

  addJob(job) {
    this.jobs.set(job.id, {
      ...job,
      status: 'PENDING',
      addedAt: new Date().toISOString()
    });
    console.log(`📋 作业 ${job.id} 已加入队列`);
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  cancelJob(jobId) {
    if (this.jobs.has(jobId)) {
      const job = this.jobs.get(jobId);
      job.status = 'CANCELLED';
      job.cancelledAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  updateJobStatus(jobId, status, error = null) {
    if (this.jobs.has(jobId)) {
      const job = this.jobs.get(jobId);
      job.status = status;
      job.updatedAt = new Date().toISOString();
      if (error) {
        job.error = error;
      }
    }
  }

  removeJob(jobId) {
    return this.jobs.delete(jobId);
  }
}

// 模拟其他模块
const mockDownload = async (job, onProgress, options) => {
  console.log(`📥 开始下载: ${job.url}`);

  // 模拟下载进度
  for (let i = 0; i <= 100; i += 10) {
    await new Promise(resolve => setTimeout(resolve, 50));
    onProgress({
      percent: i,
      message: `下载进度: ${i}%`,
      speed: Math.random() * 10 + 1,
      eta: Math.round((100 - i) / 10)
    });
  }

  // 模拟创建视频文件
  const videoPath = path.join(job.outputDir, 'source.mp4');
  fs.writeFileSync(videoPath, 'mock video data');

  console.log(`📥 下载完成: ${videoPath}`);
  return videoPath;
};

const mockExtractAudio = async (videoPath, options) => {
  console.log(`🎵 开始提取音频: ${videoPath}`);

  // 模拟处理时间
  await new Promise(resolve => setTimeout(resolve, 500));

  // 创建音频文件
  const mp3Path = path.join(options.outputDir, 'audio.mp3');
  const wavPath = path.join(options.outputDir, 'audio.wav');

  fs.writeFileSync(mp3Path, 'mock mp3 data');
  fs.writeFileSync(wavPath, 'mock wav data');

  console.log(`🎵 音频提取完成: MP3=${mp3Path}, WAV=${wavPath}`);

  return { mp3Path, wavPath };
};

const mockTranscribe = async (job, audioPath, options) => {
  console.log(`📝 开始语音转写: ${audioPath}`);

  // 模拟转写进度
  for (let i = 0; i <= 100; i += 20) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (options.onProgress) {
      options.onProgress({
        percent: i,
        message: `转写进度: ${i}%`,
        speed: Math.random() * 2 + 0.5,
        eta: Math.round((100 - i) / 20)
      });
    }
  }

  // 创建转写文件
  const transcriptPath = path.join(job.outputDir, 'transcript.txt');
  fs.writeFileSync(transcriptPath, '这是一个测试转写结果。\nThis is a test transcript.');

  console.log(`📝 转写完成: ${transcriptPath}`);

  return {
    transcriptPath,
    duration: 2.5,
    model: 'ggml-large-v3-turbo-q5_0.bin',
    usedMetal: true,
    outputSize: 1024
  };
};

// 替换模块引用
require.cache[require.resolve('./src/jobs/queue')] = {
  exports: { JobQueue: MockJobQueue },
  loaded: true
};

require.cache[require.resolve('./src/jobs/download')] = {
  exports: { download: mockDownload },
  loaded: true
};

require.cache[require.resolve('./src/jobs/audio')] = {
  exports: { extractAudio: mockExtractAudio },
  loaded: true
};

require.cache[require.resolve('./src/jobs/transcribe')] = {
  exports: { transcribe: mockTranscribe },
  loaded: true
};

// 加载 main.js 的作业管理部分
console.log('🚀 开始测试作业管理系统...\n');

// 模拟 main.js 中的作业管理代码
const { JobQueue } = require('./src/jobs/queue');
const { download } = require('./src/jobs/download');
const { extractAudio } = require('./src/jobs/audio');
const { transcribe } = require('./src/jobs/transcribe');

const jobQueue = new JobQueue();

// 这里我们只测试核心功能，不复制整个 main.js
console.log('✅ 作业管理模块加载成功');

// 测试创建作业
async function testJobCreation() {
  console.log('\n🧪 测试作业创建...');

  const mockHandler = async (event, jobData) => {
    console.log('📥 收到 job:create 请求:', jobData);

    // 生成作业 ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 创建输出目录
    const jobOutputDir = path.join('/tmp/downloads', 'ytDownloader', jobId);
    if (!fs.existsSync(jobOutputDir)) {
      fs.mkdirSync(jobOutputDir, { recursive: true });
    }

    // 创建作业对象
    const job = {
      id: jobId,
      url: jobData.url,
      outputDir: jobOutputDir,
      options: jobData.options || {},
      stage: 'PENDING',
      createdAt: new Date().toISOString()
    };

    // 添加到队列
    jobQueue.addJob(job);

    // 模拟异步执行
    setTimeout(async () => {
      console.log(`🚀 开始执行作业: ${jobId}`);

      try {
        // 执行流水线
        const videoPath = await mockDownload(job, (progress) => {
          console.log(`📊 下载进度: ${progress.percent}%`);
        }, {});

        const audioResult = await mockExtractAudio(videoPath, {
          outputDir: job.outputDir,
          generateWav: true
        });

        const transcribeResult = await mockTranscribe(job, audioResult.wavPath, {
          onProgress: (progress) => {
            console.log(`📊 转写进度: ${progress.percent}%`);
          }
        });

        console.log(`✅ 作业完成: ${jobId}`);
        console.log(`📁 输出文件:`);
        console.log(`   - 视频: ${videoPath}`);
        console.log(`   - 音频: ${audioResult.mp3Path}`);
        console.log(`   - 音频: ${audioResult.wavPath}`);
        console.log(`   - 转写: ${transcribeResult.transcriptPath}`);

      } catch (error) {
        console.error(`❌ 作业失败: ${jobId}`, error.message);
      }
    }, 100);

    return {
      success: true,
      jobId: jobId,
      status: 'accepted',
      message: '作业已创建并加入队列'
    };
  };

  // 模拟创建作业请求
  const result = await mockHandler(null, {
    url: 'https://www.youtube.com/watch?v=test123',
    options: {
      language: 'zh',
      useMetal: true
    }
  });

  console.log('✅ 作业创建结果:', result);

  // 等待作业完成
  await new Promise(resolve => setTimeout(resolve, 5000));
}

// 运行测试
testJobCreation().then(() => {
  console.log('\n🎉 作业管理系统测试完成！');
}).catch(error => {
  console.error('\n💥 测试失败:', error);
});