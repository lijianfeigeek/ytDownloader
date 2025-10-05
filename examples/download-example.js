#!/usr/bin/env node

/**
 * download.js 模块使用示例
 * 展示如何使用下载模块进行视频下载
 */

const { download, DownloadError } = require('../src/jobs/download');
const { JobQueue, JobStatus } = require('../src/jobs/queue');

async function exampleUsage() {
  console.log('🚀 download.js 模块使用示例\n');

  // 1. 创建作业
  const job = JobQueue.add({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // 示例URL
    outputDir: './downloads',
    options: {
      keepVideo: true,
      language: 'zh'
    },
    metadata: {
      title: '示例视频'
    }
  });

  console.log(`📋 创建作业: ${job.id}`);
  console.log(`🌐 URL: ${job.url}`);
  console.log(`📁 输出目录: ${job.outputDir}`);

  try {
    // 2. 使用 download 函数下载视频
    console.log('\n⬇️  开始下载...');

    const downloadedFile = await download(job, (progress) => {
      console.log(`📊 进度: ${progress.percent}% ${progress.message}`);

      // 更新作业进度
      JobQueue.updateProgress(job.id, progress.percent, 100, progress.message);
    });

    console.log(`\n✅ 下载完成!`);
    console.log(`📁 文件路径: ${downloadedFile}`);

    // 3. 更新作业状态
    JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
    JobQueue.advanceStage(job.id, JobStatus.COMPLETED);

    // 4. 获取作业结果
    const completedJob = JobQueue.get(job.id);
    console.log(`\n📈 作业统计:`, JobQueue.getStats());

  } catch (error) {
    console.error('\n❌ 下载失败:', error.message);

    if (error instanceof DownloadError) {
      console.error('错误代码:', error.code);
      console.error('错误详情:', error.details);
    }

    // 标记作业失败
    JobQueue.fail(job.id, {
      code: error.code || 'DOWNLOAD_ERROR',
      message: error.message
    });
  }
}

// 检查是否直接运行此文件
if (require.main === module) {
  exampleUsage().catch(error => {
    console.error('示例运行出错:', error);
    process.exit(1);
  });
}

module.exports = { exampleUsage };