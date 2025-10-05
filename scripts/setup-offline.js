#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * 离线运行时依赖检查脚本
 * 检查 yt-dlp、ffmpeg、whisper 等依赖是否存在
 */
class OfflineDependencyChecker {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.runtimeDir = path.join(this.projectRoot, 'resources', 'runtime');
    this.manifestPath = path.join(this.runtimeDir, 'manifest.json');
    this.platform = process.platform;
    this.results = [];
  }

  /**
   * 读取 manifest.json 文件
   */
  readManifest() {
    try {
      const manifestContent = fs.readFileSync(this.manifestPath, 'utf8');
      return JSON.parse(manifestContent);
    } catch (error) {
      console.error('❌ 无法读取 manifest.json:', error.message);
      process.exit(1);
    }
  }

  /**
   * 获取平台特定的二进制路径
   */
  getBinaryPath(dependency) {
    const manifest = this.readManifest();

    // 根据平台获取二进制文件路径
    if (dependency === 'whisper.cpp') {
      return manifest.platform_specific[this.platform]?.whisper_binary ||
             path.join('whisper', 'whisper');
    }

    return path.join('bin', dependency);
  }

  /**
   * 检查文件是否存在且可执行
   */
  checkFileExists(filePath) {
    const fullPath = path.join(this.runtimeDir, filePath);

    try {
      const stats = fs.statSync(fullPath);

      // 检查是否为文件（在 Unix 系统上还要检查执行权限）
      if (stats.isFile()) {
        if (this.platform !== 'win32') {
          // Unix 系统：检查执行权限
          const mode = stats.mode;
          const executable = (mode & parseInt('111', 8)) !== 0;
          return { exists: true, executable, path: fullPath };
        } else {
          // Windows：.exe 文件默认可执行
          return { exists: true, executable: true, path: fullPath };
        }
      }

      return { exists: false, executable: false, path: fullPath };
    } catch (error) {
      return { exists: false, executable: false, path: fullPath };
    }
  }

  /**
   * 检查模型文件是否存在
   */
  checkModelFile() {
    const manifest = this.readManifest();
    const modelInfo = manifest.dependencies['whisper-model'];
    const modelPath = path.join(this.runtimeDir, modelInfo.path, modelInfo.model);

    const result = this.checkFileExists(path.relative(this.runtimeDir, modelPath));
    return {
      name: 'Whisper Model',
      version: modelInfo.model,
      status: result.exists ? '✅ Found' : '❌ Missing',
      path: modelPath,
      executable: 'N/A',
      notes: result.exists ? 'Model file ready' : 'Required for transcription'
    };
  }

  /**
   * 检查所有必需的依赖
   */
  checkDependencies() {
    const manifest = this.readManifest();

    // 基础二进制依赖列表
    const required = [
      { name: 'yt-dlp', key: 'yt-dlp', description: 'Video downloader' },
      { name: 'ffmpeg', key: 'ffmpeg', description: 'Media processor' },
      { name: 'whisper.cpp', key: 'whisper.cpp', description: 'Speech recognition engine' }
    ];

    console.log('🔍 检查离线运行时依赖...\n');

    // 检查二进制文件
    required.forEach(dep => {
      const binaryPath = this.getBinaryPath(dep.key);
      const result = this.checkFileExists(binaryPath);

      let status = '❌ Missing';
      if (result.exists && result.executable) {
        status = '✅ Ready';
      } else if (result.exists && !result.executable) {
        status = '⚠️ No execute permission';
      }

      this.results.push({
        name: dep.name,
        version: manifest.dependencies[dep.key]?.version || 'unknown',
        status,
        path: result.path,
        executable: result.executable ? 'Yes' : 'No',
        notes: dep.description
      });
    });

    // 检查模型文件
    this.results.push(this.checkModelFile());
  }

  /**
   * 生成 Markdown 表格报告
   */
  generateReport() {
    console.log('# 离线依赖检查报告\n');
    console.log('## 依赖状态汇总\n');
    console.log('| 组件名称 | 版本 | 状态 | 路径 | 可执行 | 说明 |');
    console.log('|----------|------|------|------|--------|------|');

    this.results.forEach(result => {
      const name = result.name;
      const version = result.version;
      const status = result.status;
      const relativePath = path.relative(this.projectRoot, result.path);
      const executable = result.executable;
      const notes = result.notes;

      console.log(`| ${name} | ${version} | ${status} | \`${relativePath}\` | ${executable} | ${notes} |`);
    });

    // 统计信息
    const readyCount = this.results.filter(r => r.status.includes('✅')).length;
    const missingCount = this.results.filter(r => r.status.includes('❌')).length;
    const warningCount = this.results.filter(r => r.status.includes('⚠️')).length;

    console.log('\n## 统计信息\n');
    console.log(`- ✅ 就绪: ${readyCount}`);
    console.log(`- ❌ 缺失: ${missingCount}`);
    console.log(`- ⚠️ 警告: ${warningCount}`);

    if (missingCount > 0 || warningCount > 0) {
      console.log('\n## 建议操作\n');

      if (missingCount > 0) {
        console.log('1. 运行下载脚本获取缺失的依赖：');
        console.log('   ```bash');
        console.log('   npm run download-deps');
        console.log('   ```');
      }

      if (warningCount > 0) {
        console.log('2. 为缺失执行权限的文件添加权限：');
        console.log('   ```bash');
        console.log('   chmod +x resources/runtime/bin/*');
        console.log('   chmod +x resources/runtime/whisper/*');
        console.log('   ```');
      }
    } else {
      console.log('\n🎉 所有依赖已就绪，可以开始使用离线转写功能！');
    }
  }

  /**
   * 运行完整检查流程
   */
  run() {
    console.log('🚀 离线运行时依赖检查器\n');
    console.log(`平台: ${this.platform}`);
    console.log(`项目根目录: ${this.projectRoot}\n`);

    this.checkDependencies();
    this.generateReport();

    // 根据检查结果设置退出码
    const missingCount = this.results.filter(r => r.status.includes('❌')).length;
    const warningCount = this.results.filter(r => r.status.includes('⚠️')).length;

    if (missingCount > 0 || warningCount > 0) {
      // 有缺失或警告时返回退出码1
      return false;
    }

    // 所有依赖就绪时返回退出码0
    return true;
  }
}

// 主程序入口
if (require.main === module) {
  const checker = new OfflineDependencyChecker();

  try {
    const success = checker.run();
    if (!success) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 检查过程中发生错误:', error.message);
    process.exit(1);
  }
}

module.exports = OfflineDependencyChecker;