#!/usr/bin/env node

/**
 * download.js 模块高级使用示例
 * 展示自定义 yt-dlp 路径、依赖注入和错误处理
 */

const {
  download,
  DownloadError,
  createYtDlpInstance,
  getDefaultYtDlpPath,
  validateJob
} = require('../src/jobs/download');
const { JobQueue, JobStatus } = require('../src/jobs/queue');

async function basicUsage() {
  console.log('🔧 基本使用示例\n');

  const job = JobQueue.add({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    outputDir: './downloads',
    options: {
      keepVideo: true,
      language: 'zh'
    }
  });

  try {
    const filePath = await download(job, (progress) => {
      console.log(`📊 下载进度: ${progress.percent}% ${progress.message}`);
      JobQueue.updateProgress(job.id, progress.percent, 100, progress.message);
    });

    console.log(`✅ 下载完成: ${filePath}`);
    JobQueue.advanceStage(job.id, JobStatus.COMPLETED);

  } catch (error) {
    console.error('❌ 下载失败:', error.message);
    if (error instanceof DownloadError) {
      console.error('错误代码:', error.code);
    }
    JobQueue.fail(job.id, { code: error.code || 'DOWNLOAD_ERROR', message: error.message });
  }
}

async function customYtDlpPath() {
  console.log('\n🎯 自定义 yt-dlp 路径示例\n');

  const job = JobQueue.add({
    url: 'https://www.youtube.com/watch?v=example',
    outputDir: './downloads'
  });

  // 方式1: 直接指定 yt-dlp 路径
  const customPath = '/usr/local/bin/yt-dlp'; // 或其他自定义路径

  try {
    const filePath = await download(job, (progress) => {
      console.log(`📊 [自定义路径] 进度: ${progress.percent}%`);
    }, {
      ytDlpPath: customPath
    });

    console.log(`✅ 使用自定义路径下载完成: ${filePath}`);

  } catch (error) {
    console.error('❌ 自定义路径下载失败:', error.message);
  }
}

async function advancedUsage() {
  console.log('\n🚀 高级用法示例\n');

  // 获取默认 yt-dlp 路径
  const defaultPath = getDefaultYtDlpPath();
  console.log(`📍 默认 yt-dlp 路径: ${defaultPath}`);

  // 创建自定义 yt-dlp 实例
  const customYtDlp = createYtDlpInstance('/path/to/custom/yt-dlp');
  console.log(`🔧 自定义 yt-dlp 实例: ${customYtDlp.constructor.name}`);

  const job = JobQueue.add({
    url: 'https://www.youtube.com/watch?v=example',
    outputDir: './downloads',
    options: {
      keepVideo: false, // 只要音频
      language: 'en'
    }
  });

  try {
    // 使用自定义 yt-dlp 实例
    const filePath = await download(job, (progress) => {
      console.log(`📊 [高级] 进度: ${progress.percent}%`);
    }, {
      ytDlpInstance: customYtDlp
    });

    console.log(`✅ 高级用法下载完成: ${filePath}`);

  } catch (error) {
    console.error('❌ 高级用法下载失败:', error.message);
  }
}

async function errorHandlingExample() {
  console.log('\n⚠️ 错误处理示例\n');

  const testCases = [
    {
      name: '无效作业对象',
      job: null,
      expectedError: '作业对象必须是有效的对象'
    },
    {
      name: '缺少URL',
      job: { id: 'test', outputDir: '/tmp' },
      expectedError: '作业缺少必需的 url 字段'
    },
    {
      name: '无效URL格式',
      job: { id: 'test', url: 'invalid-url', outputDir: '/tmp' },
      expectedError: '无效的 URL 格式'
    }
  ];

  for (const testCase of testCases) {
    console.log(`🧪 测试: ${testCase.name}`);

    try {
      await download(testCase.job, () => {});
      console.log(`  ❌ 期望失败但成功了`);
    } catch (error) {
      if (error instanceof DownloadError && error.message.includes(testCase.expectedError)) {
        console.log(`  ✅ 正确捕获错误: ${error.code}`);
      } else {
        console.log(`  ⚠️ 错误不匹配: ${error.message}`);
      }
    }
  }
}

async function progressMonitoringExample() {
  console.log('\n📈 进度监控示例\n');

  const job = JobQueue.add({
    url: 'https://www.youtube.com/watch?v=example',
    outputDir: './downloads'
  });

  let progressCount = 0;
  let lastProgress = null;

  const progressCallback = (progress) => {
    progressCount++;
    lastProgress = progress;

    console.log(`📊 进度更新 #${progressCount}:`);
    console.log(`   百分比: ${progress.percent}%`);
    console.log(`   速度: ${progress.speed ? (progress.speed / 1024 / 1024).toFixed(1) + 'MB/s' : 'N/A'}`);
    console.log(`   剩余时间: ${progress.eta ? progress.eta + 's' : 'N/A'}`);
    console.log(`   消息: ${progress.message}`);
    console.log('');

    // 更新作业进度
    JobQueue.updateProgress(job.id, progress.percent, 100, progress.message);
  };

  try {
    console.log('🎬 开始下载 (监控进度)...');
    const filePath = await download(job, progressCallback);
    console.log(`✅ 下载完成!`);
    console.log(`📁 文件路径: ${filePath}`);
    console.log(`📊 总进度更新次数: ${progressCount}`);

    if (lastProgress) {
      console.log(`📊 最终进度: ${lastProgress.percent}%`);
    }

  } catch (error) {
    console.error('❌ 下载失败:', error.message);
  }
}

// 运行所有示例
async function runAllExamples() {
  console.log('🚀 download.js 模块高级使用示例\n');
  console.log('='.repeat(60));

  try {
    await basicUsage();
    await customYtDlpPath();
    await advancedUsage();
    await errorHandlingExample();
    await progressMonitoringExample();

    console.log('\n' + '='.repeat(60));
    console.log('🎉 所有示例运行完成!');
    console.log('✅ 展示了基本用法、自定义路径、高级配置、错误处理和进度监控');

  } catch (error) {
    console.error('\n💥 示例运行出错:', error);
  }
}

// 检查是否直接运行此文件
if (require.main === module) {
  runAllExamples().catch(error => {
    console.error('示例运行出错:', error);
    process.exit(1);
  });
}

module.exports = {
  basicUsage,
  customYtDlpPath,
  advancedUsage,
  errorHandlingExample,
  progressMonitoringExample,
  runAllExamples
};