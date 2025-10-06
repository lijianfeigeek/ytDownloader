#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

/**
 * 离线运行时依赖设置脚本
 * 自动检测并下载缺失的依赖
 */
class OfflineDependencySetup {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.runtimeDir = path.join(this.projectRoot, 'resources', 'runtime');
    this.binDir = path.join(this.runtimeDir, 'bin');
    this.whisperDir = path.join(this.runtimeDir, 'whisper');
    this.modelsDir = path.join(this.whisperDir, 'models');
    this.manifestPath = path.join(this.runtimeDir, 'manifest.json');
    this.platform = process.platform;
    this.results = [];
    this.downloads = [];
  }

  /**
   * 初始化目录结构
   */
  ensureDirectories() {
    const dirs = [this.runtimeDir, this.binDir, this.whisperDir, this.modelsDir];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 创建目录: ${path.relative(this.projectRoot, dir)}`);
      }
    });
  }

  /**
   * 下载文件的通用方法
   */
  async downloadFile(url, filePath, description, expectedSize = null) {
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${description} 已存在，跳过下载`);
      return true;
    }

    console.log(`📥 开始下载 ${description}...`);
    console.log(`   URL: ${url}`);
    console.log(`   目标: ${path.relative(this.projectRoot, filePath)}`);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const tempPath = `${filePath}.tmp`;
      const fileStream = fs.createWriteStream(tempPath);

      let downloadedSize = 0;
      let totalSize = expectedSize || 0;

      const protocol = url.startsWith('https:') ? https : http;

      const request = protocol.get(url, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          let redirectUrl = response.headers.location;
          if (!redirectUrl) {
            fs.unlinkSync(tempPath);
            reject(new Error(`重定向失败: 缺少 location 头`));
            return;
          }

          // 处理相对路径重定向
          if (redirectUrl.startsWith('/')) {
            const originalUrl = new URL(url);
            redirectUrl = `${originalUrl.protocol}//${originalUrl.host}${redirectUrl}`;
          }

          console.log(`\n   🔄 重定向到: ${redirectUrl}`);

          // 递归处理重定向
          return this.downloadFile(redirectUrl, filePath, description, expectedSize)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          fs.unlinkSync(tempPath);
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        totalSize = parseInt(response.headers['content-length'] || '0');

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;

          if (totalSize > 0) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            const speed = this.formatSpeed(downloadedSize, Date.now() - startTime);
            const downloadedMB = (downloadedSize / 1024 / 1024).toFixed(1);
            const totalMB = (totalSize / 1024 / 1024).toFixed(1);

            process.stdout.write(`\r   进度: ${progress}% | ${downloadedMB}/${totalMB} MB | ${speed}                    `);
          }
        });

        response.pipe(fileStream);
      });

      request.on('error', (error) => {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        reject(error);
      });

      fileStream.on('finish', () => {
        fileStream.close();

        // 重命名临时文件到最终路径
        try {
          fs.renameSync(tempPath, filePath);
          const finalSize = fs.statSync(filePath).size;
          const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
          const avgSpeed = this.formatSpeed(finalSize, Date.now() - startTime);

          console.log(`\n✅ 下载完成: ${this.formatBytes(finalSize)} | 耗时: ${timeTaken}s | 平均速度: ${avgSpeed}`);
          resolve(true);
        } catch (error) {
          reject(error);
        }
      });

      fileStream.on('error', (error) => {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        reject(error);
      });

      // 设置超时
      request.setTimeout(60000, () => {
        request.destroy();
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        reject(new Error('下载超时'));
      });
    });
  }

  /**
   * 格式化字节大小
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 格式化速度
   */
  formatSpeed(bytes, ms) {
    const bytesPerSecond = bytes / (ms / 1000);
    return this.formatBytes(bytesPerSecond) + '/s';
  }

  /**
   * 检查文件是否为可执行文件
   */
  isExecutableFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) return false;

      // 检查文件大小，避免空文件或过小文件
      if (stats.size < 1000) { // 小于1KB的文件可能不是真正的可执行文件
        return false;
      }

      // 在 Unix 系统上检查执行权限
      if (this.platform !== 'win32') {
        const mode = stats.mode;
        return (mode & parseInt('111', 8)) !== 0; // 检查所有用户的执行权限
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 为文件添加执行权限
   */
  makeExecutable(filePath) {
    if (this.platform !== 'win32') {
      try {
        fs.chmodSync(filePath, 0o755);
        return true;
      } catch (error) {
        console.warn(`⚠️ 无法设置执行权限: ${error.message}`);
        return false;
      }
    }
    return true;
  }

  /**
   * 解析当前平台应下载的 yt-dlp 发行文件
   */
  getYtDlpArtifactInfo() {
    if (this.platform === "win32") {
      return { assetName: "yt-dlp.exe", binaryName: "yt-dlp.exe" };
    }

    if (this.platform === "darwin") {
      return { assetName: "yt-dlp_macos", binaryName: "yt-dlp" };
    }

    if (this.platform === "linux") {
      const arch = process.arch;
      const archMap = {
        x64: "yt-dlp_linux",
        arm64: "yt-dlp_linux-aarch64",
        arm: "yt-dlp_linux-armv7l",
        armv7l: "yt-dlp_linux-armv7l",
        armv6l: "yt-dlp_linux-armv6l"
      };

      const assetName = archMap[arch];

      if (assetName) {
        return { assetName, binaryName: "yt-dlp" };
      }

      console.warn(`⚠️ 未识别的 Linux 架构 ${arch}，将使用 Python 版本 yt-dlp`);
      return { assetName: "yt-dlp", binaryName: "yt-dlp" };
    }

    const binaryName = this.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    return { assetName: "yt-dlp", binaryName };
  }

  /**
   * 检测下载到的 yt-dlp 是否为 Python 启动脚本
   */
  isPythonShim(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const fd = fs.openSync(filePath, "r");
      const buffer = Buffer.alloc(64);
      fs.readSync(fd, buffer, 0, buffer.length, 0);
      fs.closeSync(fd);

      const header = buffer.toString("utf8");
      return header.includes("/usr/bin/env python3") || header.includes("python3");
    } catch (_) {
      return false;
    }
  }

  /**
   * 下载 yt-dlp
   */
  async downloadYtDlp() {
    const { assetName, binaryName } = this.getYtDlpArtifactInfo();
    const targetPath = path.join(this.binDir, binaryName);

    const legacyPythonWrapper =
      this.platform !== "win32" && this.isPythonShim(targetPath);

    if (
      fs.existsSync(targetPath) &&
      this.isExecutableFile(targetPath) &&
      !legacyPythonWrapper
    ) {
      this.results.push({
        name: "yt-dlp",
        version: "unknown",
        status: "✅ Found",
        path: targetPath,
        executable: "Yes",
        notes: "Binary exists"
      });
      return;
    }

    if (legacyPythonWrapper) {
      console.log(
        "🔄 检测到旧版 Python shim yt-dlp，准备下载独立二进制以移除 Python 依赖"
      );
      try {
        fs.unlinkSync(targetPath);
      } catch (_) {}
    }

    const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;

    try {
      await this.downloadFile(downloadUrl, targetPath, "yt-dlp");
      this.makeExecutable(targetPath);

      this.results.push({
        name: "yt-dlp",
        version: "latest",
        status: "✅ Downloaded",
        path: targetPath,
        executable: "Yes",
        notes: `Successfully downloaded ${assetName}`
      });
    } catch (error) {
      console.error(`❌ yt-dlp 下载失败: ${error.message}`);
      console.log("💡 提示: 您可以手动下载或检查网络连接");

      this.results.push({
        name: "yt-dlp",
        version: "latest",
        status: "❌ Download failed",
        path: targetPath,
        executable: "No",
        notes: `Download failed: ${error.message}`
      });
    }
  }

  /**
   * 下载 ffmpeg
   */
  async downloadFFmpeg() {
    const binaryName = this.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const targetPath = path.join(this.binDir, binaryName);

    if (fs.existsSync(targetPath) && this.isExecutableFile(targetPath)) {
      this.results.push({
        name: 'ffmpeg',
        version: 'unknown',
        status: '✅ Found',
        path: targetPath,
        executable: 'Yes',
        notes: 'Binary exists'
      });
      return;
    }

    let downloadUrl;

    if (this.platform === 'win32') {
      downloadUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
      await this.downloadAndExtractFFmpeg(downloadUrl, targetPath, 'ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe');
    } else if (this.platform === 'darwin') {
      // macOS: 首先尝试从系统复制已有的 ffmpeg
      const systemFFmpegPaths = [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg'
      ];
      
      let foundSystemFFmpeg = false;
      for (const systemPath of systemFFmpegPaths) {
        if (fs.existsSync(systemPath) && this.isExecutableFile(systemPath)) {
          try {
            fs.copyFileSync(systemPath, targetPath);
            this.makeExecutable(targetPath);
            
            // 验证复制的二进制文件
            const { execSync } = require('child_process');
            const version = execSync(`"${targetPath}" -version`, { encoding: 'utf8' }).split('\n')[0];
            
            this.results.push({
              name: 'ffmpeg',
              version: version.split(' ')[2] || 'system',
              status: '✅ Copied from system',
              path: targetPath,
              executable: 'Yes',
              notes: `Copied from ${systemPath}`
            });
            foundSystemFFmpeg = true;
            return;
          } catch (error) {
            console.warn(`⚠️ 无法复制系统 ffmpeg: ${error.message}`);
          }
        }
      }
      
      if (!foundSystemFFmpeg) {
        // 如果没有找到系统 ffmpeg，尝试下载压缩包
        console.log('📥 未找到系统 ffmpeg，尝试下载...');
        downloadUrl = 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg';
        
        try {
          // 下载 7z 压缩包
          const archivePath = targetPath + '.7z';
          await this.downloadFile(downloadUrl, archivePath, 'ffmpeg archive');
          
          console.log('🔧 尝试解压 7z 压缩包...');
          
          // 尝试使用系统工具解压
          try {
            // 检查是否有 KekaArchive 或其他解压工具
            execSync(`unar -o "${path.dirname(archivePath)}" "${archivePath}"`, { stdio: 'pipe' });
            
            // 查找解压后的 ffmpeg 二进制文件
            const files = fs.readdirSync(path.dirname(archivePath));
            const ffmpegFile = files.find(file => file.startsWith('ffmpeg') && !file.includes('.'));
            
            if (ffmpegFile) {
              const extractedPath = path.join(path.dirname(archivePath), ffmpegFile);
              fs.renameSync(extractedPath, targetPath);
              this.makeExecutable(targetPath);
              
              // 验证
              const { execSync } = require('child_process');
              const version = execSync(`"${targetPath}" -version`, { encoding: 'utf8' }).split('\n')[0];
              
              this.results.push({
                name: 'ffmpeg',
                version: version.split(' ')[2] || 'unknown',
                status: '✅ Downloaded',
                path: targetPath,
                executable: 'Yes',
                notes: 'Successfully downloaded and extracted'
              });
              
              // 清理临时文件
              fs.unlinkSync(archivePath);
              return;
            }
          } catch (extractError) {
            console.warn('⚠️ 自动解压失败，可能需要手动安装 unar:');
            console.log('   brew install unar');
          }
          
          // 清理下载的压缩包
          if (fs.existsSync(archivePath)) {
            fs.unlinkSync(archivePath);
          }
          
          // 如果所有方法都失败，提供手动安装指导
          this.results.push({
            name: 'ffmpeg',
            version: 'latest',
            status: '⚠️ Manual setup required',
            path: targetPath,
            executable: 'No',
            notes: 'Please install ffmpeg manually: brew install ffmpeg, then rerun script'
          });
          
        } catch (downloadError) {
          this.results.push({
            name: 'ffmpeg',
            version: 'latest',
            status: '❌ Download failed',
            path: targetPath,
            executable: 'No',
            notes: `Download failed: ${downloadError.message}`
          });
        }
      }
    } else {
      // Linux
      downloadUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';
      await this.downloadAndExtractFFmpeg(downloadUrl, targetPath, 'ffmpeg-master-latest-linux64-gpl/bin/ffmpeg');
    }
  }

  /**
   * 下载并解压 ffmpeg 压缩包
   */
  async downloadAndExtractFFmpeg(url, targetPath, binaryInArchive) {
    try {
      // 先下载压缩包
      const archivePath = targetPath + (url.endsWith('.zip') ? '.zip' : '.tar.xz');
      await this.downloadFile(url, archivePath, 'ffmpeg archive');

      console.log('📦 正在解压 ffmpeg...');

      if (this.platform === 'win32') {
        // Windows 使用内置解压（需要 PowerShell 5.0+）
        try {
          const extractDir = path.dirname(archivePath);
          execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'pipe' });

          // 移动 ffmpeg.exe 到目标位置
          const sourceBinary = path.join(extractDir, binaryInArchive);
          if (fs.existsSync(sourceBinary)) {
            fs.renameSync(sourceBinary, targetPath);
            console.log('✅ ffmpeg 解压完成');
          } else {
            throw new Error('ffmpeg.exe not found in archive');
          }
        } catch (error) {
          console.warn('⚠️ 自动解压失败，尝试手动解压...');
          console.log(`请手动解压 ${archivePath} 并将 ${binaryInArchive} 复制到 ${targetPath}`);
          throw error;
        }
      } else {
        // Unix 系统使用 tar
        try {
          execSync(`tar -xf '${archivePath}' -C '${path.dirname(archivePath)}'`, { stdio: 'pipe' });

          // 移动 ffmpeg 到目标位置
          const sourceBinary = path.join(path.dirname(archivePath), binaryInArchive);
          if (fs.existsSync(sourceBinary)) {
            fs.renameSync(sourceBinary, targetPath);
            console.log('✅ ffmpeg 解压完成');
          } else {
            throw new Error('ffmpeg not found in archive');
          }
        } catch (error) {
          console.warn('⚠️ 自动解压失败，尝试手动解压...');
          console.log(`请手动解压 ${archivePath} 并将 ${binaryInArchive} 复制到 ${targetPath}`);
          throw error;
        }
      }

      // 清理压缩包和临时目录
      this.cleanupArchiveFiles(path.dirname(archivePath), archivePath, url.endsWith('.tar.xz'));

      this.makeExecutable(targetPath);

      this.results.push({
        name: 'ffmpeg',
        version: 'latest',
        status: '✅ Downloaded',
        path: targetPath,
        executable: 'Yes',
        notes: 'Successfully downloaded and extracted'
      });

    } catch (error) {
      console.error(`❌ ffmpeg 下载失败: ${error.message}`);
      console.log('💡 提示: 您可以手动下载 ffmpeg 并放置到正确位置');

      this.results.push({
        name: 'ffmpeg',
        version: 'latest',
        status: '❌ Download failed',
        path: targetPath,
        executable: 'No',
        notes: `Download failed: ${error.message}`
      });
    }
  }

  /**
   * 下载 whisper.cpp
   */
  async downloadWhisperCpp() {
    let binaryName;
    let downloadUrl;

    if (this.platform === 'win32') {
      binaryName = 'whisper.exe';
      downloadUrl = 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip';
      await this.downloadAndExtractWhisper(downloadUrl, binaryName, 'whisper.exe');
    } else if (this.platform === 'darwin') {
      binaryName = 'whisper-macos';
      const targetPath = path.join(this.whisperDir, binaryName);

      if (fs.existsSync(targetPath) && this.isExecutableFile(targetPath)) {
        this.results.push({
          name: 'whisper.cpp',
          version: 'latest',
          status: '✅ Found',
          path: targetPath,
          executable: 'Yes',
          notes: 'Binary exists'
        });
        return;
      }

      // macOS: 三层回退策略 - 1.自动编译(最优) -> 2.Homebrew -> 3.Xcframework提取
      let success = false;
      let successMethod = '';

      // 方法1: 自动编译 (最高优先级 - 产生真正的CLI可执行文件)
      console.log('🔨 方法1: 尝试自动编译 whisper.cpp (推荐 - Metal加速支持)...');
      try {
        await this.compileWhisperCpp(targetPath);
        success = true;
        successMethod = 'compiled';
        console.log('✅ 自动编译成功 - 获得真正的CLI可执行文件');
      } catch (compileError) {
        console.warn(`⚠️ 自动编译失败: ${compileError.message}`);
      }

      // 方法2: Homebrew安装 (回退方案)
      if (!success) {
        console.log('🍺 方法2: 尝试通过 Homebrew 安装 whisper.cpp...');
        try {
          await this.installWhisperViaBrew(targetPath);
          success = true;
          successMethod = 'brew';
          console.log('✅ Homebrew安装成功');
        } catch (brewError) {
          console.warn(`⚠️ Homebrew 安装失败: ${brewError.message}`);
        }
      }

      // 方法3: Xcframework提取 (最后回退 - 可能产生动态库而非可执行文件)
      if (!success) {
        console.log('📦 方法3: 尝试从 xcframework 提取 whisper.cpp...');
        try {
          await this.extractFromXcframework(targetPath);
          success = true;
          successMethod = 'xcframework';
          console.log('✅ Xcframework提取成功');
        } catch (xcframeworkError) {
          console.warn(`⚠️ Xcframework 提取失败: ${xcframeworkError.message}`);
        }
      }

      // 所有方法都失败，提供手动安装指导
      if (!success) {
        console.log('📝 所有自动方法均失败，请手动安装 whisper.cpp');
        console.log('');
        console.log('💡 推荐方法 - 自动编译 (Metal加速):');
        console.log('   git clone https://github.com/ggml-org/whisper.cpp.git');
        console.log('   cd whisper.cpp');
        console.log('   make WHISPER_METAL=1');
        console.log('   cp ./build/bin/whisper-cli ' + targetPath);
        console.log('');
        console.log('💡 备选方法1 - 使用 Homebrew:');
        console.log('   brew install whisper-cpp');
        console.log('   cp $(which whisper) ' + targetPath);
        console.log('');

        this.results.push({
          name: 'whisper.cpp',
          version: 'latest',
          status: '⚠️ Manual setup required',
          path: targetPath,
          executable: 'No',
          notes: `All automatic installation methods failed. Manual setup required.`
        });
        return;
      }

      // macOS安装成功后的统一成功报告
      this.results.push({
        name: 'whisper.cpp',
        version: 'latest',
        status: '✅ Downloaded',
        path: targetPath,
        executable: 'Yes',
        notes: 'Successfully installed via ' +
                (successMethod === 'compiled' ? 'auto-compilation (Metal加速)' :
                 successMethod === 'brew' ? 'Homebrew' : 'xcframework extraction')
      });

    } else {
      binaryName = 'whisper-linux';
      downloadUrl = 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-linux-x64.tar.gz';
      const targetPath = path.join(this.whisperDir, binaryName);
      await this.downloadAndExtractWhisper(downloadUrl, binaryName, 'whisper');
    }
  }

  /**
   * 下载并解压 whisper.cpp
   */
  async downloadAndExtractWhisper(url, binaryName, binaryInArchive) {
    const targetPath = path.join(this.whisperDir, binaryName);

    if (fs.existsSync(targetPath) && this.isExecutableFile(targetPath)) {
      this.results.push({
        name: 'whisper.cpp',
        version: 'latest',
        status: '✅ Found',
        path: targetPath,
        executable: 'Yes',
        notes: 'Binary exists'
      });
      return;
    }

    try {
      // 确定压缩包格式
      const isTarGz = url.endsWith('.tar.gz');
      const archivePath = targetPath + (isTarGz ? '.tar.gz' : '.zip');

      await this.downloadFile(url, archivePath, 'whisper.cpp archive');

      console.log('📦 正在解压 whisper.cpp...');

      const extractDir = path.dirname(archivePath);

      try {
        if (isTarGz) {
          // 使用 tar 解压 .tar.gz 文件
          execSync(`tar -xzf '${archivePath}' -C '${extractDir}'`, { stdio: 'pipe' });
        } else {
          // 使用 unzip 解压 .zip 文件
          if (this.platform === 'win32') {
            execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'pipe' });
          } else {
            execSync(`unzip -q '${archivePath}' -d '${extractDir}'`, { stdio: 'pipe' });
          }
        }

        // 查找并移动二进制文件
        const sourceBinary = path.join(extractDir, binaryInArchive);
        if (fs.existsSync(sourceBinary)) {
          fs.renameSync(sourceBinary, targetPath);
          console.log('✅ whisper.cpp 解压完成');
        } else {
          // 尝试在子目录中查找
          const files = fs.readdirSync(extractDir);
          let foundBinary = false;

          for (const file of files) {
            const filePath = path.join(extractDir, file);
            if (fs.statSync(filePath).isDirectory()) {
              const innerBinary = path.join(filePath, binaryInArchive);
              if (fs.existsSync(innerBinary)) {
                fs.renameSync(innerBinary, targetPath);
                console.log('✅ whisper.cpp 解压完成（从子目录）');
                foundBinary = true;
                break;
              }
            }
          }

          if (!foundBinary) {
            throw new Error(`${binaryInArchive} not found in archive or its subdirectories`);
          }
        }

        // 清理压缩包和临时目录
        this.cleanupArchiveFiles(extractDir, archivePath, isTarGz);

      } catch (error) {
        console.warn('⚠️ 自动解压失败，请手动解压');
        console.log(`请手动解压 ${archivePath} 并将 ${binaryInArchive} 复制到 ${targetPath}`);
        throw error;
      }

      this.makeExecutable(targetPath);

      this.results.push({
        name: 'whisper.cpp',
        version: 'latest',
        status: '✅ Downloaded',
        path: targetPath,
        executable: 'Yes',
        notes: 'Successfully downloaded and extracted'
      });

    } catch (error) {
      console.error(`❌ whisper.cpp 下载失败: ${error.message}`);
      console.log('💡 提示: 您可以手动下载 whisper.cpp 并放置到正确位置');

      this.results.push({
        name: 'whisper.cpp',
        version: 'latest',
        status: '❌ Download failed',
        path: targetPath,
        executable: 'No',
        notes: `Download failed: ${error.message}`
      });
    }
  }

  /**
   * 清理解压后的文件
   */
  cleanupArchiveFiles(extractDir, archivePath, isTarGz) {
    try {
      // 删除压缩包
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }

      // 安全地删除解压后的临时目录
      if (fs.existsSync(extractDir)) {
        const files = fs.readdirSync(extractDir);

        for (const file of files) {
          const filePath = path.join(extractDir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
            // 匹配常见的临时目录名模式
            if (isTarGz && file.startsWith('ffmpeg-master-')) {
              fs.rmSync(filePath, { recursive: true, force: true });
            } else if (!isTarGz && (file.startsWith('whisper') || file.startsWith('ffmpeg-master'))) {
              fs.rmSync(filePath, { recursive: true, force: true });
            }
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️ 清理临时文件时出错: ${error.message}`);
      // 不抛出错误，清理失败不影响主要功能
    }
  }

  /**
   * 下载 Whisper 模型
   */
  async downloadWhisperModel() {
    const modelName = 'ggml-large-v3-turbo-q5_0.bin';
    const targetPath = path.join(this.modelsDir, modelName);

    if (fs.existsSync(targetPath)) {
      this.results.push({
        name: 'Whisper Model',
        version: modelName,
        status: '✅ Found',
        path: targetPath,
        executable: 'N/A',
        notes: 'Model file ready'
      });
      return;
    }

    const downloadUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin';

    try {
      // 模型文件较大（约 309MB），显示更详细的进度
      await this.downloadFile(downloadUrl, targetPath, 'Whisper Model (Large V3 Turbo)', 309 * 1024 * 1024);

      this.results.push({
        name: 'Whisper Model',
        version: modelName,
        status: '✅ Downloaded',
        path: targetPath,
        executable: 'N/A',
        notes: 'Large V3 Turbo quantized model for transcription'
      });

    } catch (error) {
      console.error(`❌ Whisper 模型下载失败: ${error.message}`);
      console.log('💡 提示: 您可以手动下载模型并放置到正确位置');
      console.log(`   模型URL: ${downloadUrl}`);

      this.results.push({
        name: 'Whisper Model',
        version: modelName,
        status: '❌ Download failed',
        path: targetPath,
        executable: 'N/A',
        notes: `Download failed: ${error.message}`
      });
    }
  }

  /**
   * 运行依赖检查
   */
  async checkDependencies() {
    console.log('🔍 检查现有依赖...\n');

    // 下载缺失的依赖
    console.log('📦 开始下载缺失的依赖...\n');

    await this.downloadYtDlp();
    console.log('');

    await this.downloadFFmpeg();
    console.log('');

    await this.downloadWhisperCpp();
    console.log('');

    await this.downloadWhisperModel();
    console.log('');
  }

  /**
   * 生成最终报告
   */
  generateReport() {
    console.log('# 离线依赖设置报告\n');
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
    const failedCount = this.results.filter(r => r.status.includes('❌')).length;

    console.log('\n## 统计信息\n');
    console.log(`- ✅ 成功: ${readyCount}`);
    console.log(`- ❌ 失败: ${failedCount}`);

    if (failedCount > 0) {
      console.log('\n## 故障排除\n');
      console.log('1. 检查网络连接是否正常');
      console.log('2. 某些下载可能需要代理，请设置环境变量：');
      console.log('   ```bash');
      console.log('   export HTTPS_PROXY=http://proxy:port');
      console.log('   export HTTP_PROXY=http://proxy:port');
      console.log('   ```');
      console.log('3. 重新运行脚本：');
      console.log('   ```bash');
      console.log('   npm run setup-offline');
      console.log('   ```');
    } else {
      console.log('\n🎉 所有依赖已就绪，可以开始使用离线转写功能！');
    }

    console.log('\n## 下一步\n');
    console.log('1. 运行应用测试离线功能：');
    console.log('   ```bash');
    console.log('   npm start');
    console.log('   ```');
    console.log('2. 检查应用中的依赖检测是否正常工作');
    console.log('3. 测试视频下载和转写功能');
  }

  /**
   * 通过 Homebrew 安装 whisper.cpp
   * @param {string} targetPath - 目标二进制文件路径
   */
  async installWhisperViaBrew(targetPath) {
    const { execSync } = require('child_process');

    // 检查 Homebrew 是否可用
    try {
      execSync('brew --version', { stdio: 'pipe' });
    } catch (error) {
      throw new Error('Homebrew 未安装。请先安装 Homebrew: https://brew.sh/');
    }

    console.log('📦 安装 whisper-cpp...');

    // 检查是否已经安装
    try {
      // 尝试查找 whisper-cli 或 whisper 命令
      let whisperPath;
      try {
        whisperPath = execSync('which whisper-cli', { encoding: 'utf8' }).trim();
      } catch (e) {
        whisperPath = execSync('which whisper', { encoding: 'utf8' }).trim();
      }

      if (whisperPath && this.isExecutableFile(whisperPath)) {
        // 复制到目标位置
        fs.copyFileSync(whisperPath, targetPath);
        this.makeExecutable(targetPath);

        // 验证复制的二进制
        const helpOutput = execSync(`"${targetPath}" --help`, { encoding: 'utf8' });
        if (helpOutput.includes('whisper')) {
          console.log('✅ whisper.cpp 通过 Homebrew 安装成功');

          this.results.push({
            name: 'whisper.cpp',
            version: 'latest',
            status: '✅ Installed via Homebrew',
            path: targetPath,
            executable: 'Yes',
            notes: 'Successfully installed and copied from Homebrew'
          });
          return;
        }
      }
    } catch (error) {
      // whisper 未安装，继续执行安装
    }

    // 安装 whisper-cpp
    try {
      execSync('brew install whisper-cpp', {
        stdio: 'pipe',
        timeout: 300000 // 5分钟超时
      });

      // 获取安装后的路径
      let whisperPath;
      try {
        whisperPath = execSync('which whisper-cli', { encoding: 'utf8' }).trim();
      } catch (e) {
        whisperPath = execSync('which whisper', { encoding: 'utf8' }).trim();
      }

      if (whisperPath && fs.existsSync(whisperPath)) {
        // 复制到目标位置
        fs.copyFileSync(whisperPath, targetPath);
        this.makeExecutable(targetPath);

        // 验证复制的二进制
        const helpOutput = execSync(`"${targetPath}" --help`, { encoding: 'utf8' });
        if (helpOutput.includes('whisper')) {
          console.log('✅ whisper.cpp 通过 Homebrew 安装成功');

          this.results.push({
            name: 'whisper.cpp',
            version: 'latest',
            status: '✅ Installed via Homebrew',
            path: targetPath,
            executable: 'Yes',
            notes: 'Successfully installed and copied from Homebrew'
          });
          return;
        }
      }

      throw new Error('安装后无法找到 whisper 二进制文件');

    } catch (installError) {
      throw new Error(`Homebrew 安装失败: ${installError.message}`);
    }
  }

  /**
   * 自动编译 whisper.cpp
   * @param {string} targetPath - 目标二进制文件路径
   */
  async compileWhisperCpp(targetPath) {
    const { execSync } = require('child_process');

    // 检查是否已有 Xcode 命令行工具
    try {
      execSync('xcodebuild -version', { stdio: 'pipe' });
    } catch (error) {
      throw new Error('Xcode 命令行工具未安装。请运行: xcode-select --install');
    }

    // 创建临时目录进行编译
    const tempDir = path.join(this.whisperDir, 'whisper_compile_temp');
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      console.log('📥 克隆 whisper.cpp 仓库...');
      execSync('git clone https://github.com/ggml-org/whisper.cpp.git', {
        cwd: tempDir,
        stdio: 'pipe'
      });

      const whisperSourceDir = path.join(tempDir, 'whisper.cpp');

      console.log('🔧 编译 whisper.cpp（支持 Metal）...');

      // 尝试编译
      execSync('make WHISPER_METAL=1 -j$(sysctl -n hw.ncpu)', {
        cwd: whisperSourceDir,
        stdio: 'pipe',
        timeout: 600000 // 10分钟超时
      });

      // 查找编译后的二进制文件
      const binaryPaths = [
        path.join(whisperSourceDir, 'build', 'bin', 'whisper-cli'),
        path.join(whisperSourceDir, 'build', 'bin', 'whisper'),
        path.join(whisperSourceDir, 'bin', 'whisper-cli'),
        path.join(whisperSourceDir, 'whisper-cli'),
        path.join(whisperSourceDir, 'whisper')
      ];

      let compiledBinary = null;
      for (const binaryPath of binaryPaths) {
        if (fs.existsSync(binaryPath) && this.isExecutableFile(binaryPath)) {
          compiledBinary = binaryPath;
          break;
        }
      }

      if (!compiledBinary) {
        throw new Error('编译后未找到可用的二进制文件');
      }

      // 复制到目标位置
      fs.copyFileSync(compiledBinary, targetPath);
      this.makeExecutable(targetPath);

      // 复制所有找到的动态库到同一目录
      const buildDir = path.join(whisperSourceDir, 'build');
      const allDylibs = [];

      // 递归查找所有 .dylib 文件
      function findDylibs(dir, results = []) {
        if (!fs.existsSync(dir)) return results;

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            findDylibs(fullPath, results);
          } else if (entry.isFile() && entry.name.endsWith('.dylib')) {
            results.push(fullPath);
          }
        }
        return results;
      }

      findDylibs(buildDir, allDylibs);

      // 复制所有找到的动态库
      for (const libSrc of allDylibs) {
        const libDest = path.join(path.dirname(targetPath), path.basename(libSrc));
        fs.copyFileSync(libSrc, libDest);
        console.log(`📦 复制依赖库: ${path.basename(libSrc)}`);
      }

      // 创建必要的符号链接以解决版本依赖
      const whisperDir = path.dirname(targetPath);
      const symlinks = [
        { source: 'libwhisper.1.8.0.dylib', target: 'libwhisper.1.dylib' },
        { source: 'libwhisper.1.8.0.dylib', target: 'libwhisper.dylib' }
      ];

      for (const { source, target } of symlinks) {
        const sourcePath = path.join(whisperDir, source);
        const targetPath = path.join(whisperDir, target);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          try {
            fs.symlinkSync(source, targetPath);
            console.log(`🔗 创建符号链接: ${target} -> ${source}`);
          } catch (symlinkError) {
            console.warn(`⚠️ 符号链接创建失败: ${symlinkError.message}`);
            // 作为备选方案，直接复制文件
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`📦 复制库文件: ${target}`);
          }
        }
      }

      // 修复二进制文件的 rpath，使其在当前目录查找动态库
      try {
        const targetDir = path.dirname(targetPath);
        execSync(`install_name_tool -add_rpath @executable_path "${targetPath}"`, { stdio: 'pipe' });
        console.log('🔧 修复 rpath 为当前目录');
      } catch (rpathError) {
        console.warn(`⚠️ rpath 修复失败: ${rpathError.message}`);
      }

      // 验证编译后的二进制
      try {
        const helpOutput = execSync(`"${targetPath}" --help`, { encoding: 'utf8' });
        if (helpOutput.includes('whisper')) {
          console.log('✅ whisper.cpp 编译成功');

          this.results.push({
            name: 'whisper.cpp',
            version: 'v1.8.0',
            status: '✅ Compiled',
            path: targetPath,
            executable: 'Yes',
            notes: 'Successfully compiled with Metal support'
          });
          return;
        }
      } catch (verifyError) {
        throw new Error(`编译后的二进制验证失败: ${verifyError.message}`);
      }

    } finally {
      // 清理临时文件
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * 从 xcframework 提取 whisper 二进制文件
   * @param {string} targetPath - 目标二进制文件路径
   */
  async extractFromXcframework(targetPath) {
    const downloadUrl = 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-v1.8.0-xcframework.zip';

    // 下载 xcframework 压缩包
    const archivePath = targetPath + '.zip';
    await this.downloadFile(downloadUrl, archivePath, 'whisper.cpp xcframework');

    console.log('🔧 解压 whisper.cpp xcframework...');

    // 创建临时目录进行解压
    const tempDir = path.join(this.whisperDir, 'temp_whisper');
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // 使用系统 unzip 解压
      const { execSync } = require('child_process');
      execSync(`unzip -q "${archivePath}" -d "${tempDir}"`, { stdio: 'pipe' });

      // 查找 xcframework 中的二进制文件
      let xcframeworkPath = path.join(tempDir, 'whisper.xcframework');
      if (!fs.existsSync(xcframeworkPath)) {
        xcframeworkPath = path.join(tempDir, 'build-apple', 'whisper.xcframework');
      }

      if (fs.existsSync(xcframeworkPath)) {
        console.log('🔍 在 xcframework 中查找 whisper 二进制...');

        const binarySearchPaths = [
          path.join(xcframeworkPath, 'macos-arm64_x86_64', 'whisper.framework', 'Versions', 'A', 'whisper'),
          path.join(xcframeworkPath, 'macos-arm64', 'whisper.framework', 'Versions', 'A', 'whisper'),
          path.join(xcframeworkPath, 'macos-x86_64', 'whisper.framework', 'Versions', 'A', 'whisper'),
          path.join(xcframeworkPath, 'macos-arm64_x86_64', 'whisper'),
          path.join(xcframeworkPath, 'macos-arm64', 'whisper'),
          path.join(xcframeworkPath, 'macos-x86_64', 'whisper')
        ];

        for (const binaryPath of binarySearchPaths) {
          if (fs.existsSync(binaryPath)) {
            // 复制二进制文件到目标位置
            fs.copyFileSync(binaryPath, targetPath);
            this.makeExecutable(targetPath);
            console.log('✅ whisper.cpp 二进制文件提取成功');
            return;
          }
        }

        throw new Error('无法在 xcframework 中找到有效的二进制文件');
      } else {
        throw new Error('xcframework 解压后未找到预期目录结构');
      }
    } finally {
      // 清理临时文件
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * 运行完整设置流程
   */
  async run() {
    console.log('🚀 离线运行时依赖设置器\n');
    console.log(`平台: ${this.platform}`);
    console.log(`项目根目录: ${this.projectRoot}\n`);

    try {
      // 确保目录存在
      this.ensureDirectories();

      // 检查并下载依赖
      await this.checkDependencies();

      // 生成报告
      this.generateReport();

      // 根据结果设置退出码
      const failedCount = this.results.filter(r => r.status.includes('❌')).length;
      const warningCount = this.results.filter(r => r.status.includes('⚠️')).length;

      if (failedCount > 0) {
        console.log(`\n❌ 有 ${failedCount} 个依赖设置失败，请查看上面的错误信息`);
        process.exit(1);
      } else if (warningCount > 0) {
        console.log(`\n⚠️ 有 ${warningCount} 个依赖需要手动设置，请查看上面的指导`);
        process.exit(2); // 警告状态退出码
      } else {
        console.log('\n✅ 所有依赖设置成功！');
        process.exit(0);
      }

    } catch (error) {
      console.error('\n❌ 设置过程中发生错误:', error.message);
      console.error('请检查网络连接或手动下载依赖');
      process.exit(1);
    }
  }
}

// 主程序入口
if (require.main === module) {
  const setup = new OfflineDependencySetup();
  setup.run().catch(error => {
    console.error('❌ 未处理的错误:', error);
    process.exit(1);
  });
}

module.exports = OfflineDependencySetup;
