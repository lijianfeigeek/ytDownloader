/**
 * 作业日志工具模块
 * 提供作业日志记录和诊断包导出功能
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 简单的文件锁实现，防止并发写入冲突
class FileLock {
    constructor() {
        this.locks = new Map();
    }

    async acquire(filePath) {
        const lockKey = path.resolve(filePath);

        // 等待现有锁释放
        while (this.locks.has(lockKey)) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // 获取锁
        this.locks.set(lockKey, true);
        return lockKey;
    }

    release(lockKey) {
        this.locks.delete(lockKey);
    }
}

const fileLock = new FileLock();

/**
 * 创建作业日志记录器
 * @param {string} jobId - 作业ID
 * @returns {Object} 日志记录器实例
 */
function createJobLogger(jobId) {
    if (!jobId) {
        throw new Error('jobId is required');
    }

    const jobDir = path.join(getDownloadsDirectory(), jobId);
    const logFilePath = path.join(jobDir, 'logs.txt');

    // 确保作业目录存在
    ensureDirectoryExists(jobDir);

    const logger = {
        /**
         * 写入日志到文件和控制台
         * @param {string} level - 日志级别 (info, warn, error, debug)
         * @param {string} message - 日志消息
         * @param {Object} meta - 额外的元数据
         */
        async writeLog(level, message, meta = {}) {
            const timestamp = new Date().toISOString();
            const pid = process.pid;
            const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
            const logLine = `[${timestamp}] [${level.toUpperCase()}] [${jobId}] [PID:${pid}] ${message} ${metaStr}\n`;

            // 控制台输出
            console.log(`[JobLogger:${jobId}] ${logLine.trim()}`);

            // 文件输出（使用文件锁）
            const lockKey = await fileLock.acquire(logFilePath);
            try {
                await fs.promises.appendFile(logFilePath, logLine, 'utf8');
            } finally {
                fileLock.release(lockKey);
            }
        },

        /**
         * 记录信息级别日志
         * @param {string} message - 日志消息
         * @param {Object} meta - 额外的元数据
         */
        info(message, meta = {}) {
            return this.writeLog('info', message, meta);
        },

        /**
         * 记录警告级别日志
         * @param {string} message - 日志消息
         * @param {Object} meta - 额外的元数据
         */
        warn(message, meta = {}) {
            return this.writeLog('warn', message, meta);
        },

        /**
         * 记录错误级别日志
         * @param {string} message - 日志消息
         * @param {Object} meta - 额外的元数据
         */
        error(message, meta = {}) {
            return this.writeLog('error', message, meta);
        },

        /**
         * 记录调试级别日志
         * @param {string} message - 日志消息
         * @param {Object} meta - 额外的元数据
         */
        debug(message, meta = {}) {
            return this.writeLog('debug', message, meta);
        },

        /**
         * 记录作业阶段开始
         * @param {string} stage - 阶段名称
         * @param {Object} details - 阶段详情
         */
        stageStart(stage, details = {}) {
            return this.info(`Stage started: ${stage}`, { stage, event: 'stage_start', ...details });
        },

        /**
         * 记录作业阶段完成
         * @param {string} stage - 阶段名称
         * @param {Object} details - 阶段详情
         */
        stageComplete(stage, details = {}) {
            return this.info(`Stage completed: ${stage}`, { stage, event: 'stage_complete', ...details });
        },

        /**
         * 记录作业阶段失败
         * @param {string} stage - 阶段名称
         * @param {Error} error - 错误对象
         * @param {Object} details - 额外详情
         */
        stageError(stage, error, details = {}) {
            return this.error(`Stage failed: ${stage}`, {
                stage,
                event: 'stage_error',
                error: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                },
                ...details
            });
        },

        /**
         * 记录进度信息
         * @param {string} stage - 当前阶段
         * @param {number} percentage - 进度百分比 (0-100)
         * @param {string} message - 进度描述
         * @param {Object} details - 额外详情
         */
        progress(stage, percentage, message, details = {}) {
            return this.info(`Progress: ${percentage}% - ${message}`, {
                stage,
                percentage,
                event: 'progress',
                ...details
            });
        },

        /**
         * 获取日志文件路径
         * @returns {string} 日志文件路径
         */
        getLogFilePath() {
            return logFilePath;
        },

        /**
         * 读取日志内容
         * @param {number} lines - 读取最后几行，默认全部
         * @returns {Promise<string>} 日志内容
         */
        async readLogs(lines = null) {
            try {
                if (!fs.existsSync(logFilePath)) {
                    return '';
                }

                const content = await fs.promises.readFile(logFilePath, 'utf8');

                if (lines && lines > 0) {
                    const logLines = content.trim().split('\n');
                    return logLines.slice(-lines).join('\n');
                }

                return content;
            } catch (error) {
                await this.error(`Failed to read logs: ${error.message}`, { error: error.message });
                return '';
            }
        },

        /**
         * 清空日志文件
         */
        async clearLogs() {
            try {
                await fs.promises.writeFile(logFilePath, '', 'utf8');
                await this.info('Log file cleared');
            } catch (error) {
                await this.error(`Failed to clear logs: ${error.message}`, { error: error.message });
            }
        }
    };

    // 记录日志器创建
    logger.info('Job logger created', { jobId, logFile: logFilePath });

    return logger;
}

/**
 * 导出诊断包
 * @param {string} jobId - 作业ID
 * @param {Object} options - 导出选项
 * @returns {Promise<Object>} 导出结果
 */
async function exportDiagnostics(jobId, options = {}) {
    const {
        format = 'zip', // 'zip' 或 'tar'
        includeSystemInfo = true,
        outputDir = null
    } = options;

    const jobDir = path.join(getDownloadsDirectory(), jobId);
    const targetDir = outputDir || jobDir;

    try {
        // 验证作业目录存在
        if (!fs.existsSync(jobDir)) {
            throw new Error(`Job directory not found: ${jobDir}`);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const diagnosticName = `diagnostics_${jobId}_${timestamp}`;
        const archivePath = path.join(targetDir, `${diagnosticName}.${format === 'zip' ? 'zip' : 'tar.gz'}`);
        let systemInfoPath = null; // 用于存储临时系统信息文件路径

        // 需要包含的文件列表
        const filesToInclude = [];

        // 1. 元数据文件
        const metadataPath = path.join(jobDir, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
            filesToInclude.push({
                source: metadataPath,
                target: 'metadata.json'
            });
        }

        // 2. 日志文件
        const logPath = path.join(jobDir, 'logs.txt');
        if (fs.existsSync(logPath)) {
            filesToInclude.push({
                source: logPath,
                target: 'logs.txt'
            });
        }

        // 3. 系统信息文件
        if (includeSystemInfo) {
            const systemInfo = await gatherSystemInfo(jobId);
            systemInfoPath = path.join(jobDir, 'system_info.json');
            await fs.promises.writeFile(systemInfoPath, JSON.stringify(systemInfo, null, 2), 'utf8');
            filesToInclude.push({
                source: systemInfoPath,
                target: 'system_info.json'
            });
        }

        // 4. 其他相关文件
        const additionalFiles = ['transcript.txt', 'source.mp4', 'audio.mp3'];
        for (const file of additionalFiles) {
            const filePath = path.join(jobDir, file);
            if (fs.existsSync(filePath)) {
                filesToInclude.push({
                    source: filePath,
                    target: file
                });
            }
        }

        if (filesToInclude.length === 0) {
            throw new Error('No files found to include in diagnostic package');
        }

        // 创建诊断包
        if (format === 'zip') {
            await createZipArchive(archivePath, filesToInclude);
        } else {
            await createTarArchive(archivePath, filesToInclude);
        }

        // 清理临时文件
        if (includeSystemInfo && systemInfoPath && fs.existsSync(systemInfoPath)) {
            await fs.promises.unlink(systemInfoPath);
        }

        return {
            success: true,
            archivePath,
            format,
            size: fs.statSync(archivePath).size,
            filesCount: filesToInclude.length,
            files: filesToInclude.map(f => f.target),
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            jobId,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * 获取下载目录 - 保持与作业输出目录一致
 * @returns {string} 下载目录路径
 */
function getDownloadsDirectory() {
    let baseDownloadsPath;

    try {
        // 在 Electron 环境中，使用与主进程作业输出相同的目录结构
        // main.js 中使用: path.join(app.getPath('downloads'), 'ytDownloader')
        const electronApp = require('electron').app;
        baseDownloadsPath = electronApp.getPath('downloads');
    } catch (error) {
        // 在 Node.js 环境中（测试时），使用用户主目录下的 Downloads
        baseDownloadsPath = path.join(os.homedir(), 'Downloads');
    }

    const downloadsDir = path.join(baseDownloadsPath, 'ytDownloader');

    // 确保下载目录存在
    ensureDirectoryExists(downloadsDir);

    return downloadsDir;
}

/**
 * 确保目录存在
 * @param {string} dirPath - 目录路径
 */
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * 收集系统信息
 * @param {string} jobId - 作业ID
 * @returns {Promise<Object>} 系统信息
 */
async function gatherSystemInfo(jobId) {
    const systemInfo = {
        jobId,
        timestamp: new Date().toISOString(),
        system: {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            hostname: os.hostname(),
            uptime: os.uptime(),
            loadavg: os.loadavg(),
            totalmem: os.totalmem(),
            freemem: os.freemem(),
            cpus: os.cpus().map(cpu => ({
                model: cpu.model,
                speed: cpu.speed,
                times: cpu.times
            }))
        },
        process: {
            pid: process.pid,
            version: process.version,
            versions: process.versions,
            execPath: process.execPath,
            execArgv: process.execArgv,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        }
    };

    // 尝试获取应用信息（在 Electron 环境中）
    try {
        const electronApp = require('electron').app;
        systemInfo.app = {
            name: electronApp.getName(),
            version: electronApp.getVersion(),
            path: electronApp.getAppPath()
        };
    } catch (error) {
        systemInfo.app = {
            name: 'YTDownloader',
            version: '1.0.0',
            path: __dirname,
            error: 'Not running in Electron environment'
        };
    }

    // 添加 macOS 特定信息
    if (os.platform() === 'darwin') {
        try {
            const { execSync } = require('child_process');
            const displaysInfo = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf8' });
            systemInfo.macos = {
                displays: displaysInfo.split('\n').slice(0, 10).join('\n'), // 只取前10行避免过长
                metalSupport: displaysInfo.includes('Metal') || displaysInfo.includes('Metal Family')
            };
        } catch (error) {
            systemInfo.macos = {
                error: `Failed to get macOS info: ${error.message}`
            };
        }
    }

    return systemInfo;
}

/**
 * 创建 ZIP 归档 - 使用系统 zip 命令或简单复制
 * @param {string} archivePath - 归档文件路径
 * @param {Array} files - 文件列表
 */
async function createZipArchive(archivePath, files) {
    const { execSync } = require('child_process');

    try {
        // 尝试使用系统 zip 命令（在 macOS/Linux 上通常可用）
        if (process.platform !== 'win32') {
            const args = ['-r', archivePath];
            files.forEach(({ source, target }) => {
                if (fs.existsSync(source)) {
                    args.push(target);
                }
            });

            // 在包含文件的目录中执行 zip 命令
            const firstFileDir = path.dirname(files[0]?.source || archivePath);
            execSync(`zip ${args.join(' ')}`, {
                cwd: firstFileDir,
                stdio: 'ignore'
            });
            return;
        }
    } catch (error) {
        // 如果系统 zip 命令不可用，使用简单复制方法
        console.log('系统 zip 命令不可用，使用简单复制方法');
    }

    // 备用方法：创建目录并将文件复制到其中
    const archiveDir = archivePath.replace(/\.zip$/, '');
    ensureDirectoryExists(archiveDir);

    // 复制文件到目录
    for (const { source, target } of files) {
        if (fs.existsSync(source)) {
            const targetPath = path.join(archiveDir, target);
            ensureDirectoryExists(path.dirname(targetPath));
            await fs.promises.copyFile(source, targetPath);
        }
    }

    // 创建一个 README 文件说明这是一个诊断包目录
    const readmeContent = [
        `# 诊断包 - ${new Date().toISOString()}`,
        '',
        '这是一个诊断包目录，包含以下文件：',
        ...files.map(f => `- ${f.target}`),
        '',
        '如果您需要压缩文件，请手动压缩此目录。'
    ].join('\n');

    await fs.promises.writeFile(path.join(archiveDir, 'README.txt'), readmeContent, 'utf8');
}

/**
 * 创建 TAR 归档
 * @param {string} archivePath - 归档文件路径
 * @param {Array} files - 文件列表
 */
async function createTarArchive(archivePath, files) {
    const { execSync } = require('child_process');

    try {
        // 尝试使用系统 tar 命令
        const args = ['-czf', archivePath];
        files.forEach(({ source, target }) => {
            if (fs.existsSync(source)) {
                args.push(target);
            }
        });

        const firstFileDir = path.dirname(files[0]?.source || archivePath);
        execSync(`tar ${args.join(' ')}`, {
            cwd: firstFileDir,
            stdio: 'ignore'
        });
    } catch (error) {
        // 如果 tar 命令不可用，回退到 zip 方法
        console.log('系统 tar 命令不可用，使用 zip 方法');
        await createZipArchive(archivePath.replace(/\.tar\.gz$/, '.zip'), files);
    }
}

module.exports = {
    createJobLogger,
    exportDiagnostics,
    getDownloadsDirectory,
    ensureDirectoryExists
};