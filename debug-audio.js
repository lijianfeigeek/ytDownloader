const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 创建测试文件
const testVideo = '/tmp/test_video.mp4';
const testDir = '/tmp/test_audio';

if (!fs.existsSync(testVideo)) {
  fs.writeFileSync(testVideo, 'fake video data');
}

if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

console.log('开始 ffmpeg 测试...');

const args = [
  '-y',
  '-i', testVideo,
  '-c:a', 'libmp3lame',
  '-b:a', '192k',
  path.join(testDir, 'test_output.mp3')
];

console.log('命令: ffmpeg', args.join(' '));

const ffmpegProcess = spawn('ffmpeg', args);

let stdout = '';
let stderr = '';

ffmpegProcess.stdout.on('data', (data) => {
  const output = data.toString();
  stdout += output;
  console.log('stdout:', output.trim());
});

ffmpegProcess.stderr.on('data', (data) => {
  const output = data.toString();
  stderr += output;
  console.log('stderr:', output.trim());
});

ffmpegProcess.on('error', (error) => {
  console.error('进程错误:', error);
});

ffmpegProcess.on('close', (code, signal) => {
  console.log('进程关闭 - 代码:', code, '信号:', signal);
  console.log('stdout 总计:', stdout.length);
  console.log('stderr 总计:', stderr.length);

  const outputPath = path.join(testDir, 'test_output.mp3');
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    console.log('输出文件大小:', stats.size, 'bytes');
  } else {
    console.log('输出文件不存在');
  }

  // 清理
  try {
    fs.unlinkSync(testVideo);
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    fs.rmdirSync(testDir);
  } catch (e) {
    console.log('清理错误:', e.message);
  }
});