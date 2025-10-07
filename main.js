const {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	shell,
	Tray,
	Menu,
	clipboard,
} = require("electron");
const {autoUpdater} = require("electron-updater");
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");

// 导入日志工具
const { createJobLogger, exportDiagnostics } = require('./src/logs.js');

const execAsync = promisify(exec);
autoUpdater.autoDownload = false;
/**@type {BrowserWindow} */
let win = null;
let secondaryWindow = null;
let tray = null;
let isQuiting = false;
let indexIsOpen = true;
let trayEnabled = false;
const configFile = path.join(app.getPath("userData"), "config.json");

// setup-offline 脚本运行状态
let setupOfflineRunning = false;
let setupOfflineProcess = null;

/**
 * 初始化二进制文件路径配置
 * 在 createWindow 之前调用，确保配置文件包含必要的二进制路径
 */
function initializeBinaryPaths() {
    console.log("正在初始化二进制路径配置...");

    // 要检查的配置项和对应的二进制文件名
    const binaryConfigs = [
        { configKey: 'yt-dlp-path', binaryName: 'yt-dlp' },
        { configKey: 'ffmpeg-path', binaryName: 'ffmpeg' }
    ];

    // 检查 resources/runtime/bin 目录中的二进制文件
    const runtimeBinDir = path.join(__dirname, 'resources', 'runtime', 'bin');

    // 读取现有配置
    let config = {};
    let configChanged = false;

    if (fs.existsSync(configFile)) {
        try {
            const fileContent = fs.readFileSync(configFile, 'utf8');
            config = fileContent ? JSON.parse(fileContent) : {};
            console.log("已读取现有配置文件");
        } catch (error) {
            console.error("读取配置文件失败:", error);
            config = {};
        }
    }

    // 检查每个二进制配置
    binaryConfigs.forEach(({ configKey, binaryName }) => {
        // 如果配置已经存在且文件存在，跳过
        if (config[configKey] && fs.existsSync(config[configKey])) {
            console.log(`${configKey} 已配置: ${config[configKey]}`);
            return;
        }

        // 如果配置存在但文件不存在，或者配置不存在，则检查默认路径
        const defaultBinaryPath = path.join(runtimeBinDir, binaryName);

        if (fs.existsSync(defaultBinaryPath)) {
            // 只有当配置不存在时才写入默认值
            if (!config[configKey]) {
                console.log(`设置 ${configKey} 默认值: ${defaultBinaryPath}`);
                config[configKey] = defaultBinaryPath;
                configChanged = true;
            } else {
                console.log(`${configKey} 已配置但文件不存在: ${config[configKey]}，保持用户自定义路径`);
            }
        } else {
            console.log(`${configKey} 未配置且默认路径不存在: ${defaultBinaryPath}`);
        }
    });

    // 如果配置有变更，写入文件
    if (configChanged) {
        try {
            // 确保用户数据目录存在
            const userDataDir = path.dirname(configFile);
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }

            fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
            console.log("二进制路径配置已更新到配置文件");
        } catch (error) {
            console.error("写入配置文件失败:", error);
        }
    } else {
        console.log("二进制路径配置无需更新");
    }
}

function createWindow() {
	const bounds = JSON.parse((getItem("bounds", configFile) || "{}"));
	console.log("bounds:", bounds)

	win = new BrowserWindow({
		autoHideMenuBar: true,
		show: false,
		icon: __dirname + "/assets/images/icon.png",
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			spellcheck: false,
		},
	});
	win.setBounds(bounds)
	win.on("close", (event) => {
		if (!isQuiting && trayEnabled) {
			event.preventDefault();
			win.hide();
			if (app.dock) app.dock.hide();
		}
		return false;
	});

	win.on("resize", (event) => {
		setItem("bounds", JSON.stringify(win.getBounds()), configFile);
	});

	win.loadFile("html/index.html");
	// win.setMenu(null)
	win.show();

	// 设置作业事件转发（在win对象创建后）
	setupJobEventForwarding();

	autoUpdater.checkForUpdates().then(result => {
		// Removing unnecesary files for windows
		if (result && process.platform === "win32") {
			if (result.updateInfo.version === app.getVersion()) {
				fs.readdir(path.join(process.env.LOCALAPPDATA, "ytdownloader-updater"), {encoding: "utf-8", withFileTypes: true}, (err, files) => {
					if (err) {
						console.log("No update directory to clear")
					} else {
						files.forEach(file => {
							if (file.isFile()) {
								fs.rm(path.join(file.path, file.name), (_err) => {
									console.log("Removed file:", file.name)
								})
							} else {
								fs.rm(path.join(file.path, file.name), { recursive: true}, (err) => {
									console.log("Removed directory:", file.name)
								})
							}
						})
					}
				})

			}
		}
	});
}
let loadedLanguage;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	app.on("second-instance", (event, commandLine, workingDirectory) => {
		if (win) {
			win.show();
		}
	});
}

app.whenReady().then(() => {
	// 初始化二进制路径配置
	initializeBinaryPaths();

	// Logging
	console.log("Locale:" + app.getLocale());
	console.log("Version: " + app.getVersion());

	let locale = app.getLocale();

	if (fs.existsSync(path.join(__dirname, "translations", locale + ".json"))) {
		loadedLanguage = JSON.parse(
			fs.readFileSync(
				path.join(__dirname, "translations", locale + ".json"),
				"utf8"
			)
		);
	} else {
		loadedLanguage = JSON.parse(
			fs.readFileSync(
				path.join(__dirname, "translations", "en.json"),
				"utf8"
			)
		);
	}

	// Tray context menu
	const contextMenu = Menu.buildFromTemplate([
		{
			label: i18n("Open app"),
			click() {
				win.show();
				if (app.dock) app.dock.show();
			},
		},
		{
			label: i18n("Paste video link"),
			click() {
				const text = clipboard.readText();
				if (indexIsOpen) {
					win.show();
					if (app.dock) app.dock.show();
					win.webContents.send("link", text);
				} else {
					win.loadFile("html/index.html");
					win.show();
					indexIsOpen = true;
					let sent = false;
					ipcMain.on("ready-for-links", () => {
						if (!sent) {
							win.webContents.send("link", text);
							sent = true;
						}
					});
				}
			},
		},
		{
			label: i18n("Download playlist"),
			click() {
				indexIsOpen = false;
				win.loadFile("html/playlist.html");
				win.show();
				if (app.dock) app.dock.show();
			},
		},
		{
			label: i18n("Quit"),
			click() {
				isQuiting = true;
				app.quit();
			},
		},
	]);

	let trayInUse = false;
	// TODO: Find why tray icon isn't showing properly on gnome
	let icon;
	if (process.platform == "win32") {
		icon = path.join(__dirname, "resources/icon.ico");
	} else if (process.platform == "darwin") {
		icon = path.join(__dirname, "resources/icons/16x16.png");
	} else {
		icon = path.join(__dirname, "resources/icons/256x256.png");
	}
	ipcMain.on("useTray", (_, enabled) => {
		if (enabled && !trayInUse) {
			trayEnabled = true;
			trayInUse = true;
			tray = new Tray(icon);
			tray.setToolTip("ytDownloader");
			tray.setContextMenu(contextMenu);
			tray.on("click", () => {
				win.show();
				if (app.dock) app.dock.show();
			});
		} else if (!enabled) {
			trayEnabled = false;
		}
	});

	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
	if (process.platform === "win32") {
		app.setAppUserModelId(app.name);
	}
});

ipcMain.on("reload", () => {
	if (win) {
		win.reload();
	}
	if (secondaryWindow) {
		secondaryWindow.reload();
	}
});

ipcMain.on("get-version", () => {
	const version = app.getVersion();
	secondaryWindow.webContents.send("version", version);
});

ipcMain.on("load-win", (event, file) => {
	if (file.includes("playlist.html")) {
		indexIsOpen = false;
	} else {
		indexIsOpen = true;
	}
	win.loadFile(file);
});
ipcMain.on("load-page", (event, file) => {
	secondaryWindow = new BrowserWindow({
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
		parent: win,
		modal: true,
		show: false,
	});
	secondaryWindow.loadFile(file);
	secondaryWindow.setMenu(null);
	// secondaryWindow.maximize();
	// secondaryWindow.webContents.openDevTools()
	secondaryWindow.show();
	
});

ipcMain.on("close-secondary", () => {
	secondaryWindow.close();
	secondaryWindow = null;
});

ipcMain.on("select-location-main", () => {
	const location = dialog.showOpenDialogSync({
		properties: ["openDirectory"],
	});

	if (location) {
		win.webContents.send("downloadPath", location);
	}
});

ipcMain.on("select-location-secondary", () => {
	const location = dialog.showOpenDialogSync({
		properties: ["openDirectory"],
	});

	if (location) {
		secondaryWindow.webContents.send("downloadPath", location);
	}
});

ipcMain.on("get-directory", () => {
	const location = dialog.showOpenDialogSync({
		properties: ["openDirectory"],
	});

	if (location) {
		win.webContents.send("directory-path", location);
	}
});

ipcMain.on("select-config", () => {
	const location = dialog.showOpenDialogSync({
		properties: ["openFile"],
	});

	if (location) {
		secondaryWindow.webContents.send("configPath", location);
	}
});

ipcMain.on("quit", () => {
	isQuiting = true;
	app.quit();
});

// ipcMain.handle('get-proxy', async (event, url) => {
//   const sess = event.sender.session; // get session from sender
//   const proxy = await sess.resolveProxy(url);
//   return proxy;
// });
// Auto update
let autoUpdate = false;

ipcMain.on("autoUpdate", (event, status) => {
	autoUpdate = status;
	console.log("Auto update:", status);

	if (autoUpdate === true) {
		// Auto updater events
		autoUpdater.on(
			"update-available",
			(_event, releaseNotes, releaseName) => {
				// For macOS
				if (process.platform === "darwin") {
					/**
					 * @type {Electron.MessageBoxOptions}
					 */
					const dialogOpts = {
						type: "info",
						buttons: [i18n("Download"), i18n("No")],
						title: "Update Available",
						detail: releaseName,
						message: i18n(
							"A new version is available, do you want to download it?"
						),
					};
					dialog.showMessageBox(dialogOpts).then((returnValue) => {
						if (returnValue.response === 0) {
							if (process.arch === 'x64') {
								shell.openExternal(
									"https://github.com/aandrew-me/ytDownloader/releases/latest/download/YTDownloader_Mac_x64.dmg"
								);
							} else {
								shell.openExternal(
									"https://github.com/aandrew-me/ytDownloader/releases/latest/download/YTDownloader_Mac_arm64.dmg"
								);
							}
						}
					});
				}
				// For Windows and Linux
				else {
					/**
					 * @type {Electron.MessageBoxOptions}
					 */
					const dialogOpts = {
						type: "info",
						buttons: [i18n("Update"), i18n("No")],
						title: "Update Available",
						detail:
							process.platform === "win32"
								? releaseNotes
								: releaseName,
						message: i18n(
							"A new version is available, do you want to update?"
						),
					};
					dialog.showMessageBox(dialogOpts).then((returnValue) => {
						if (returnValue.response === 0) {
							autoUpdater.downloadUpdate();
						}
					});
				}
			}
		);
	}
});

ipcMain.on("progress", (_event, percentage) => {
	if (win) {
		win.setProgressBar(percentage)
	}
})

ipcMain.on("error_dialog", (_event, message) => {
	dialog.showMessageBox(win, {
		type: "error",
		title: "Error",
		message: message,
		buttons: [
			"Ok", "Copy error"
		]
	}).then((result) => {
		if (result.response == 1) {
			clipboard.writeText(message)
		}
	})
})

autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
	/**
	 * @type {Electron.MessageBoxOptions}
	 */
	const dialogOpts = {
		type: "info",
		buttons: [i18n("Restart"), i18n("Later")],
		title: "Update Ready",
		message: i18n("Install and restart now?"),
	};
	dialog.showMessageBox(dialogOpts).then((returnValue) => {
		if (returnValue.response === 0) {
			autoUpdater.quitAndInstall();
		} else {
			autoUpdater.autoInstallOnAppQuit;
		}
	});
});

// Translation
function i18n(phrase) {
	let translation = loadedLanguage[phrase];
	if (translation === undefined) {
		translation = phrase;
	}
	return translation;
}

/**
 * @param {string} itemName
 * @param {string} itemContent
 * @param {string} configPath
 */
function setItem(itemName, itemContent, configPath) {
	let config = {};
	if (fs.existsSync(configPath)) {
		const fileContent = fs.readFileSync(configPath).toString();
		try {
			config = fileContent ? JSON.parse(fileContent) : {};
			config[itemName] = itemContent;
		} catch (error) {
			console.log("Error has occured trying to save window info", error)
		}
	} else {
		config[itemName] = itemContent;
	}

	fs.writeFileSync(configPath, JSON.stringify(config));
}

/**
 * @param {string} item
 * @param {string} configPath
 * @returns {string}
 */
function getItem(item, configPath) {
	if (fs.existsSync(configPath)) {
		try {
			const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
			return configData[item] || "";
		} catch (err) {
			return "";
		}
	} else {
		return "";
	}
}

// ==================== 作业管理系统 ====================

// 导入作业管理模块
const { JobQueueClass, JobStatus } = require('./src/jobs/queue');
const { download } = require('./src/jobs/download');
const { extractAudio } = require('./src/jobs/audio');
const { transcribe } = require('./src/jobs/transcribe');

// 创建全局作业队列实例
const jobQueue = new JobQueueClass();

/**
 * 设置事件监听器，将队列事件转发到 Renderer
 */
function setupJobEventForwarding() {
	jobQueue.subscribe((event) => {
		if (!win || !win.webContents || win.isDestroyed()) {
			return;
		}

		switch (event.type) {
			case 'job:created':
				console.log(`[JobQueue] 发送作业创建事件: ${event.jobId}`);
				win.webContents.send('job:created', {
					jobId: event.jobId,
					job: event.job,
					timestamp: event.timestamp
				});
				break;
			case 'job:stage-changed':
				console.log(`[JobQueue] 发送状态变更事件: ${event.jobId} ${event.oldStatus} → ${event.newStatus}`);
				win.webContents.send('job:stage-changed', {
					jobId: event.jobId,
					oldStatus: event.oldStatus,
					newStatus: event.newStatus,
					timestamp: event.timestamp
				});
				break;
			case 'job:progress-updated':
				// 这个事件已经通过 emitJobProgress 处理，这里忽略
				break;
		}
	});
}

/**
 * 生成唯一作业 ID
 * @returns {string} 作业 ID
 */
function generateJobId() {
	return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 保存作业元数据到磁盘
 * @param {Object} job - 作业对象
 * @param {string} stage - 当前阶段
 * @param {Object} result - 阶段结果
 */
function saveJobMetadata(job, stage, result = null) {
	try {
		const metadataPath = path.join(job.outputDir, 'metadata.json');
		let metadata = {
			id: job.id,
			url: job.url,
			createdAt: new Date().toISOString(),
			stage: stage,
			options: job.options || {},
			stages: {}
		};

		// 如果已存在元数据，读取并更新
		if (fs.existsSync(metadataPath)) {
			const existingData = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
			metadata = { ...existingData, stage, updatedAt: new Date().toISOString() };
		}

		// 更新当前阶段信息
		metadata.stages[stage] = {
			startTime: new Date().toISOString(),
			status: result ? 'completed' : 'running',
			result: result || null
		};

		// 如果有结果，更新完成时间
		if (result) {
			metadata.stages[stage].endTime = new Date().toISOString();
		}

		fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
	} catch (error) {
		console.error('保存作业元数据失败:', error);
	}
}

/**
 * 推送作业进度到 Renderer
 * @param {string} jobId - 作业 ID
 * @param {string} stage - 当前阶段
 * @param {Object} progress - 进度信息
 */
function emitJobProgress(jobId, stage, progress) {
	// 防御性编程：自动包装基本类型参数为对象
	if (typeof progress !== 'object' || progress === null) {
		// 如果传递的是数字、字符串等基本类型，自动包装为进度对象
		const percent = typeof progress === 'number' ? progress : 0;
		progress = {
			percent: percent,
			message: typeof progress === 'string' ? progress : '',
			speed: 0,
			eta: 0
		};
		console.warn(`[emitJobProgress] 自动包装基本类型参数为对象: ${progress}`);
	}

	const payload = {
		jobId,
		stage,
		percent: progress.percent || 0,
		message: progress.message || '',
		speed: progress.speed || 0,
		eta: progress.eta || 0,
		timestamp: new Date().toISOString()
	};

	if (win && win.webContents && !win.isDestroyed()) {
		win.webContents.send('job:progress', payload);
	}
}

/**
 * 推送作业日志到 Renderer
 * @param {string} jobId - 作业 ID
 * @param {string} type - 日志类型
 * @param {string} data - 日志数据
 */
function emitJobLog(jobId, type, data) {
	const payload = {
		jobId,
		type,
		data: data.toString(),
		timestamp: new Date().toISOString()
	};

	if (win && win.webContents && !win.isDestroyed()) {
		win.webContents.send('job:log', payload);
	}
}

/**
 * 推送作业结果到 Renderer
 * @param {string} jobId - 作业 ID
 * @param {Object} result - 作业结果
 */
function emitJobResult(jobId, result) {
	const payload = {
		jobId,
		status: result.status,
		stage: result.stage,
		message: result.message,
		outputs: result.outputs || {},
		duration: result.duration || 0,
		error: result.error || null,
		timestamp: new Date().toISOString()
	};

	if (win && win.webContents && !win.isDestroyed()) {
		// 发送通用结果事件
		win.webContents.send('job:result', payload);

		// 根据状态发送专用事件
		if (result.status === 'completed') {
			win.webContents.send('job:completed', {
				jobId,
				result: result.outputs || {},
				duration: result.duration || 0,
				timestamp: payload.timestamp
			});
		} else if (result.status === 'failed') {
			win.webContents.send('job:failed', {
				jobId,
				error: result.error || null,
				timestamp: payload.timestamp
			});
		}
	}
}

/**
 * 执行作业流水线
 * @param {Object} job - 作业对象
 * @returns {Promise<Object>} 执行结果
 */
async function executeJobPipeline(job) {
	const startTime = Date.now();
	let finalResult = {
		status: 'completed',
		stage: 'completed',
		message: '作业执行完成',
		outputs: {},
		duration: 0
	};

	// 创建作业日志记录器
	const logger = createJobLogger(job.id);

	try {
		// 记录作业开始
		await logger.info('作业执行开始', {
			jobId: job.id,
			url: job.url,
			outputDir: job.outputDir,
			options: job.options
		});

		// 阶段1: 下载视频
		await logger.stageStart('DOWNLOADING', {
			url: job.url,
			options: job.options
		});

		jobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
		emitJobProgress(job.id, 'DOWNLOADING', { percent: 0, message: '开始下载视频' });
		saveJobMetadata(job, 'DOWNLOADING');

		const downloadResult = await download(job, (progress) => {
			emitJobProgress(job.id, 'DOWNLOADING', progress);
			// 在同步回调中不使用 await，改为 fire-and-forget 方式
			logger.progress('DOWNLOADING', progress.percent || 0, progress.message || '下载中', { progress }).catch(console.error);
		}, {
			ytDlpPath: job.options?.ytDlpPath,
			ytDlpInstance: job.options?.ytDlpInstance
		});

		const videoPath = downloadResult;
		finalResult.outputs.video = videoPath;

		// 保存下载结果
		saveJobMetadata(job, 'DOWNLOADING', { filePath: videoPath });
		await logger.stageComplete('DOWNLOADING', {
			videoPath,
			fileSize: fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0
		});
		emitJobProgress(job.id, 'DOWNLOADING', { percent: 100, message: '视频下载完成' });

		// 根据postAction决定后续执行阶段
		await logger.info(`开始后处理操作: ${job.postAction}`);

		let audioResult = null;
		let transcribeResult = null;

		switch (job.postAction) {
			case 'none':
				await logger.info('跳过音频提取和转写，直接进行打包');
				break;

			case 'extract':
				// 阶段2: 提取音频
				await logger.stageStart('EXTRACTING', {
					videoPath,
					outputDir: job.outputDir,
					options: {
						bitrate: job.options?.audioBitrate || '192k',
						generateWav: false // extract模式不需要WAV
					}
				});

				jobQueue.advanceStage(job.id, JobStatus.EXTRACTING);
				emitJobProgress(job.id, 'EXTRACTING', { percent: 0, message: '开始提取音频' });
				saveJobMetadata(job, 'EXTRACTING');

				audioResult = await extractAudio(videoPath, {
					outputDir: job.outputDir,
					bitrate: job.options?.audioBitrate || '192k',
					generateWav: false, // extract模式不需要WAV
					codec: 'libmp3lame',
					onLog: (type, data) => {
						emitJobLog(job.id, type, data);
						logger.debug('Audio extraction log', { type, data });
					},
					ffmpegPath: job.options?.ffmpegPath,
					spawnFn: job.options?.spawnFn
				});

				finalResult.outputs.audio = audioResult;

				// 保存音频提取结果
				saveJobMetadata(job, 'EXTRACTING', {
					mp3Path: audioResult.mp3Path,
					wavPath: audioResult.wavPath
				});

				await logger.stageComplete('EXTRACTING', {
					mp3Path: audioResult.mp3Path,
					wavPath: audioResult.wavPath,
					mp3Size: audioResult.mp3Path && fs.existsSync(audioResult.mp3Path) ? fs.statSync(audioResult.mp3Path).size : 0,
					wavSize: audioResult.wavPath && fs.existsSync(audioResult.wavPath) ? fs.statSync(audioResult.wavPath).size : 0
				});

				emitJobProgress(job.id, 'EXTRACTING', { percent: 100, message: '音频提取完成' });
				break;

			case 'transcribe':
				// 阶段2: 提取音频
				await logger.stageStart('EXTRACTING', {
					videoPath,
					outputDir: job.outputDir,
					options: {
						bitrate: job.options?.audioBitrate || '192k',
						generateWav: true // 为 Whisper 生成 WAV 文件
					}
				});

				jobQueue.advanceStage(job.id, JobStatus.EXTRACTING);
				emitJobProgress(job.id, 'EXTRACTING', { percent: 0, message: '开始提取音频' });
				saveJobMetadata(job, 'EXTRACTING');

				audioResult = await extractAudio(videoPath, {
					outputDir: job.outputDir,
					bitrate: job.options?.audioBitrate || '192k',
					generateWav: true, // 为 Whisper 生成 WAV 文件
					codec: 'libmp3lame',
					onLog: (type, data) => {
						emitJobLog(job.id, type, data);
						logger.debug('Audio extraction log', { type, data });
					},
					ffmpegPath: job.options?.ffmpegPath,
					spawnFn: job.options?.spawnFn
				});

				finalResult.outputs.audio = audioResult;

				// 保存音频提取结果
				saveJobMetadata(job, 'EXTRACTING', {
					mp3Path: audioResult.mp3Path,
					wavPath: audioResult.wavPath
				});

				await logger.stageComplete('EXTRACTING', {
					mp3Path: audioResult.mp3Path,
					wavPath: audioResult.wavPath,
					mp3Size: audioResult.mp3Path && fs.existsSync(audioResult.mp3Path) ? fs.statSync(audioResult.mp3Path).size : 0,
					wavSize: audioResult.wavPath && fs.existsSync(audioResult.wavPath) ? fs.statSync(audioResult.wavPath).size : 0
				});

				emitJobProgress(job.id, 'EXTRACTING', { percent: 100, message: '音频提取完成' });

				// 阶段3: 转写语音
				await logger.stageStart('TRANSCRIBING', {
					audioFile: audioResult.wavPath || audioResult.mp3Path,
					language: job.options?.language || 'auto',
					translate: job.options?.translate || false,
					useMetal: job.options?.useMetal
				});

				jobQueue.advanceStage(job.id, JobStatus.TRANSCRIBING);
				emitJobProgress(job.id, 'TRANSCRIBING', { percent: 0, message: '开始语音转写' });
				saveJobMetadata(job, 'TRANSCRIBING');

				const audioForTranscribe = audioResult.wavPath || audioResult.mp3Path;
				transcribeResult = await transcribe(job, audioForTranscribe, {
					language: job.options?.language || 'auto',
					translate: job.options?.translate || false,
					threads: job.options?.threads,
					useMetal: job.options?.useMetal,
					onProgress: (progress) => {
						emitJobProgress(job.id, 'TRANSCRIBING', progress);
						logger.progress('TRANSCRIBING', progress.percent || 0, progress.message || '转写中', { progress });
					},
					onLog: (type, data) => {
						emitJobLog(job.id, type, data);
						logger.debug('Transcription log', { type, data });
					},
					whisperPath: job.options?.whisperPath,
					model: job.options?.model,
					spawnFn: job.options?.spawnFn
				});

				finalResult.outputs.transcript = transcribeResult.transcriptPath;

				// 保存转写结果
				saveJobMetadata(job, 'TRANSCRIBING', {
					transcriptPath: transcribeResult.transcriptPath,
					duration: transcribeResult.duration,
					usedMetal: transcribeResult.usedMetal
				});

				await logger.stageComplete('TRANSCRIBING', {
					transcriptPath: transcribeResult.transcriptPath,
					duration: transcribeResult.duration,
					usedMetal: transcribeResult.usedMetal,
					transcriptSize: transcribeResult.transcriptPath && fs.existsSync(transcribeResult.transcriptPath) ? fs.statSync(transcribeResult.transcriptPath).size : 0
				});

				emitJobProgress(job.id, 'TRANSCRIBING', { percent: 100, message: '语音转写完成' });

				// 处理视频文件保留选项（仅对transcribe模式有效）
				if (!job.options?.keepVideo && audioResult && videoPath) {
					try {
						await fs.promises.unlink(videoPath);
						await logger.info('已删除原始视频文件（用户选择不保留）');
					} catch (error) {
						await logger.warn('删除原始视频文件失败:', error);
					}
				}
				break;

			default:
				await logger.warn(`未知的postAction类型: ${job.postAction}，跳过后处理`);
				break;
		}

		// 阶段4: 整理和打包
		await logger.stageStart('PACKING', {
			outputs: finalResult.outputs
		});

		console.log(`📦 [${job.id}] 开始打包阶段`);
		jobQueue.advanceStage(job.id, JobStatus.PACKING);
		emitJobProgress(job.id, 'PACKING', { percent: 0, message: '整理输出文件' });
		saveJobMetadata(job, 'PACKING');

		// 更新最终元数据
		const finalMetadata = {
			...job,
			completedAt: new Date().toISOString(),
			duration: (Date.now() - startTime) / 1000,
			status: 'completed',
			outputs: finalResult.outputs,
			logPath: logger.getLogFilePath()
		};

		saveJobMetadata(job, 'COMPLETED', finalMetadata);

		finalResult.duration = (Date.now() - startTime) / 1000;

		await logger.stageComplete('PACKING', {
			totalDuration: finalResult.duration,
			outputFiles: Object.values(finalResult.outputs)
		});

		await logger.info('作业执行完成', {
			duration: finalResult.duration,
			outputs: finalResult.outputs,
			finalMetadata
		});

		emitJobProgress(job.id, 'PACKING', { percent: 100, message: '作业完成' });

		// 完成作业 - 推进到最终状态
		console.log(`✅ [${job.id}] 作业完成，推进到 COMPLETED 状态`);
		jobQueue.advanceStage(job.id, JobStatus.COMPLETED);

		return finalResult;

	} catch (error) {
		console.error('作业执行失败:', error);

		// 记录错误到日志
		await logger.stageError(job.stage || 'UNKNOWN', error, {
			url: job.url,
			outputDir: job.outputDir,
			currentStage: job.stage,
			options: job.options
		});

		// 保存错误信息到元数据
		const errorMetadata = {
			stage: job.stage || 'UNKNOWN',
			error: {
				message: error.message,
				code: error.code || 'UNKNOWN_ERROR',
				stack: error.stack,
				details: error.details || {}
			},
			failedAt: new Date().toISOString()
		};

		saveJobMetadata(job, 'FAILED', errorMetadata);

		// 将作业标记为失败
		console.log(`❌ [${job.id}] 作业失败，推进到 FAILED 状态: ${error.message}`);
		jobQueue.fail(job.id, {
			code: error.code || 'UNKNOWN_ERROR',
			message: error.message,
			details: error.details || {}
		});

		finalResult = {
			status: 'failed',
			stage: job.stage || 'UNKNOWN',
			message: error.message,
			duration: (Date.now() - startTime) / 1000,
			error: {
				code: error.code || 'UNKNOWN_ERROR',
				message: error.message,
				details: error.details || {}
			}
		};

		return finalResult;
	}
}

// ==================== IPC 处理器 ====================

/**
 * 创建新作业
 */
ipcMain.handle('job:create', async (event, jobData) => {
	try {
		// 验证输入数据
		if (!jobData || !jobData.url) {
			throw new Error('作业数据缺少 URL');
		}

		// 生成作业 ID
		const jobId = generateJobId();

		// 创建输出目录
		const baseOutputDir = jobData.outputDir || path.join(app.getPath('downloads'), 'ytDownloader');
		const jobOutputDir = path.join(baseOutputDir, jobId);

		if (!fs.existsSync(jobOutputDir)) {
			fs.mkdirSync(jobOutputDir, { recursive: true });
		}

		// 创建作业对象
		const job = {
			id: jobId,
			url: jobData.url,
			outputDir: jobOutputDir,
			options: jobData.options || {},
			metadata: jobData.metadata || {},
			postAction: jobData.postAction || 'none', // 支持下载后操作：'none'|'extract'|'transcribe'
			stage: 'PENDING',
			createdAt: new Date().toISOString()
		};

		// 保存初始元数据
		saveJobMetadata(job, 'PENDING');

		// 添加到队列
		const createdJob = jobQueue.add(job);

		// 异步执行作业（不阻塞 IPC 响应）
		executeJobPipeline(job).then(result => {
			// 更新作业状态
			job.stage = result.status === 'completed' ? JobStatus.COMPLETED : JobStatus.FAILED;

			// 推送结果到 UI
			emitJobResult(jobId, result);

			// 如果是失败的作业，保持在队列中以便重试
			if (result.status === 'failed') {
				// 检查作业是否已经被标记为失败，避免重复状态转换
				const currentJob = jobQueue.get(jobId);
				if (currentJob && currentJob.status !== JobStatus.FAILED) {
					jobQueue.fail(jobId, result.error);
				}
			}
			// 成功的作业已经在 executeJobPipeline 内部推进到 COMPLETED 状态，无需重复操作
		}).catch(error => {
			console.error('作业执行异步错误:', error);

			const errorResult = {
				status: 'failed',
				stage: 'UNKNOWN',
				message: error.message,
				duration: 0,
				error: {
					code: 'ASYNC_ERROR',
					message: error.message
				}
			};

			emitJobResult(jobId, errorResult);
			jobQueue.fail(jobId, errorResult.error);
		});

		// 立即返回作业信息
		return {
			success: true,
			jobId: jobId,
			status: 'accepted',
			message: '作业已创建并加入队列'
		};

	} catch (error) {
		console.error('创建作业失败:', error);

		return {
			success: false,
			error: {
				code: 'CREATE_JOB_ERROR',
				message: error.message
			}
		};
	}
});

/**
 * 取消作业
 */
ipcMain.handle('job:cancel', async (event, jobId) => {
	try {
		if (!jobId) {
			throw new Error('缺少作业 ID');
		}

		const success = jobQueue.cancel(jobId);

		if (success) {
			// 保存取消状态到元数据
			const job = jobQueue.get(jobId);
			if (job) {
				saveJobMetadata(job, 'CANCELLED', {
					cancelledAt: new Date().toISOString()
				});
			}

			// 推送取消事件到 UI
			if (win && win.webContents && !win.isDestroyed()) {
				win.webContents.send('job:cancelled', { jobId, timestamp: new Date().toISOString() });
			}

			return {
				success: true,
				message: '作业已取消'
			};
		} else {
			return {
				success: false,
				error: {
					code: 'JOB_NOT_FOUND',
					message: '未找到指定的作业'
				}
			};
		}

	} catch (error) {
		console.error('取消作业失败:', error);

		return {
			success: false,
			error: {
				code: 'CANCEL_JOB_ERROR',
				message: error.message
			}
		};
	}
});

/**
 * 获取作业列表
 */
ipcMain.handle('job:list', async (event, filters = {}) => {
	try {
		const jobs = jobQueue.getAll();

		// 应用过滤器
		let filteredJobs = jobs;

		if (filters.status) {
			filteredJobs = filteredJobs.filter(job => job.status === filters.status);
		}

		if (filters.stage) {
			filteredJobs = filteredJobs.filter(job => job.stage === filters.stage);
		}

		// 为每个作业加载元数据
		const jobsWithMetadata = filteredJobs.map(job => {
			const metadataPath = path.join(job.outputDir, 'metadata.json');
			let metadata = {};

			if (fs.existsSync(metadataPath)) {
				try {
					metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
				} catch (error) {
					console.error(`读取作业 ${job.id} 元数据失败:`, error);
				}
			}

			return {
				...job,
				metadata,
				// 计算运行时间
				duration: job.startedAt ?
					((Date.now() - new Date(job.startedAt).getTime()) / 1000) : 0
			};
		});

		// 按创建时间排序
		jobsWithMetadata.sort((a, b) =>
			new Date(b.createdAt) - new Date(a.createdAt)
		);

		return {
			success: true,
			jobs: jobsWithMetadata,
			total: jobsWithMetadata.length,
			filtered: filteredJobs.length
		};

	} catch (error) {
		console.error('获取作业列表失败:', error);

		return {
			success: false,
			error: {
				code: 'LIST_JOBS_ERROR',
				message: error.message
			},
			jobs: [],
			total: 0,
			filtered: 0
		};
	}
});

/**
 * 获取作业详情
 */
ipcMain.handle('job:get', async (event, jobId) => {
	try {
		if (!jobId) {
			throw new Error('缺少作业 ID');
		}

		const job = jobQueue.getJob(jobId);

		if (!job) {
			return {
				success: false,
				error: {
					code: 'JOB_NOT_FOUND',
					message: '未找到指定的作业'
				}
			};
		}

		// 加载元数据
		const metadataPath = path.join(job.outputDir, 'metadata.json');
		let metadata = {};

		if (fs.existsSync(metadataPath)) {
			try {
				metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
			} catch (error) {
				console.error(`读取作业 ${jobId} 元数据失败:`, error);
			}
		}

		return {
			success: true,
			job: {
				...job,
				metadata
			}
		};

	} catch (error) {
		console.error('获取作业详情失败:', error);

		return {
			success: false,
			error: {
				code: 'GET_JOB_ERROR',
				message: error.message
			}
		};
	}
});

/**
 * 清理作业（支持单个作业清理或批量清理）
 */
ipcMain.handle('job:cleanup', async (event, param) => {
	try {
		// 如果传入的是字符串，则作为单个作业ID处理
		if (typeof param === 'string') {
			const jobId = param;

			if (!jobId) {
				return {
					success: false,
					error: {
						code: 'INVALID_JOB_ID',
						message: '作业 ID 不能为空'
					}
				};
			}

			const job = jobQueue.getJob(jobId);
			if (!job) {
				return {
					success: false,
					error: {
						code: 'JOB_NOT_FOUND',
						message: '未找到指定的作业'
					}
				};
			}

			// 只允许清理终态作业（已完成、失败、取消）
			if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
				return {
					success: false,
					error: {
						code: 'JOB_NOT_TERMINAL',
						message: '只能清理已完成、失败或取消的作业'
					}
				};
			}

			const success = jobQueue.remove(jobId);

			return {
				success: true,
				cleanedCount: success ? 1 : 0,
				message: success ? `已清理作业 ${jobId}` : `清理作业 ${jobId} 失败`
			};
		}

		// 如果传入的是对象，则作为批量清理选项处理
		const options = param || {};
		const jobs = jobQueue.getAll();
		const { keepCompleted = 5, keepFailed = 10 } = options;

		let cleanedCount = 0;

		// 按状态分组
		const completedJobs = jobs.filter(job => job.status === 'COMPLETED');
		const failedJobs = jobs.filter(job => job.status === 'FAILED');

		// 清理过多的已完成作业
		if (completedJobs.length > keepCompleted) {
			const toRemove = completedJobs
				.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
				.slice(0, completedJobs.length - keepCompleted);

			toRemove.forEach(job => {
				jobQueue.remove(job.id);
				cleanedCount++;
			});
		}

		// 清理过多的失败作业
		if (failedJobs.length > keepFailed) {
			const toRemove = failedJobs
				.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
				.slice(0, failedJobs.length - keepFailed);

			toRemove.forEach(job => {
				jobQueue.remove(job.id);
				cleanedCount++;
			});
		}

		return {
			success: true,
			cleanedCount,
			message: `已清理 ${cleanedCount} 个历史作业`
		};

	} catch (error) {
		console.error('清理作业失败:', error);

		return {
			success: false,
			error: {
				code: 'CLEANUP_JOBS_ERROR',
				message: error.message
			}
		};
	}
});

// 转写页面专用的 IPC 处理器
/**
 * 打开作业目录
 */
ipcMain.handle('job:openDirectory', async (event, jobId) => {
	try {
		const job = jobQueue.get(jobId);
		if (!job) {
			return {
				success: false,
				error: {
					code: 'JOB_NOT_FOUND',
					message: '作业不存在'
				}
			};
		}

		await shell.openPath(job.outputDir);
		return { success: true };

	} catch (error) {
		console.error('打开作业目录失败:', error);
		return {
			success: false,
			error: {
				code: 'OPEN_DIRECTORY_ERROR',
				message: error.message
			}
		};
	}
});

/**
 * 重试失败的作业
 */
ipcMain.handle('job:retry', async (event, jobId) => {
	try {
		const job = jobQueue.get(jobId);
		if (!job) {
			return {
				success: false,
				error: {
					code: 'JOB_NOT_FOUND',
					message: '作业不存在'
				}
			};
		}

		if (job.status !== 'FAILED') {
			return {
				success: false,
				error: {
					code: 'INVALID_JOB_STATUS',
					message: '只能重试失败的作业'
				}
			};
		}

		// 重置作业状态为 PENDING
		console.log(`[JobRetry] 重试作业 ${jobId}，重置状态为 PENDING`);
		jobQueue.advanceStage(jobId, 'PENDING');
		job.error = null;

		// 重新执行作业
		console.log(`[JobRetry] 开始重新执行作业 ${jobId}`);
		executeJobPipeline(job);

		return { success: true };

	} catch (error) {
		console.error('重试作业失败:', error);
		return {
			success: false,
			error: {
				code: 'RETRY_JOB_ERROR',
				message: error.message
			}
		};
	}
});

/**
 * 选择目录对话框
 */
ipcMain.handle('dialog:selectDirectory', async () => {
	try {
		const result = await dialog.showOpenDialog(mainWindow, {
			properties: ['openDirectory'],
			title: '选择输出目录'
		});

		return result;

	} catch (error) {
		console.error('选择目录对话框失败:', error);
		throw error;
	}
});

/**
 * 获取默认下载目录
 */
ipcMain.handle('app:getDownloadsPath', async () => {
	try {
		return app.getPath('downloads');
	} catch (error) {
		console.error('获取下载目录失败:', error);
		throw error;
	}
});

/**
 * 打开应用下载目录
 */
ipcMain.handle('app:openDownloadsFolder', async () => {
	try {
		const downloadsPath = path.join(app.getPath('downloads'), 'ytDownloader');

		// 确保目录存在
		if (!fs.existsSync(downloadsPath)) {
			fs.mkdirSync(downloadsPath, { recursive: true });
		}

		await shell.openPath(downloadsPath);
		return { success: true };

	} catch (error) {
		console.error('打开下载目录失败:', error);
		return {
			success: false,
			error: {
				code: 'OPEN_DOWNLOADS_ERROR',
				message: error.message
			}
		};
	}
});

/**
 * 运行 setup-offline 脚本
 */
ipcMain.handle('app:runSetupOffline', async () => {
	try {
		// 处理并发点击
		if (setupOfflineRunning && setupOfflineProcess && !setupOfflineProcess.killed) {
			return {
				success: false,
				message: 'setup-offline 脚本正在运行中，请等待完成后再试'
			};
		}

		const { spawn } = require('child_process');
		const scriptPath = path.join(__dirname, 'scripts', 'setup-offline.js');

		// 检查脚本是否存在
		if (!fs.existsSync(scriptPath)) {
			return {
				success: false,
				error: {
					code: 'SCRIPT_NOT_FOUND',
					message: 'setup-offline.js 脚本不存在'
				}
			};
		}

		// 标记为运行中
		setupOfflineRunning = true;

		let stdoutBuffer = '';
		let stderrBuffer = '';

		// 使用 spawn 运行脚本
		const child = spawn('node', [scriptPath], {
			stdio: ['ignore', 'pipe', 'pipe'],
			cwd: __dirname
		});

		// 保存进程引用
		setupOfflineProcess = child;

		// 实时监听 stdout
		child.stdout?.on('data', (data) => {
			const chunk = data.toString();
			stdoutBuffer += chunk;

			// 推送原始数据块到前端
			if (win) {
				win.webContents.send('app:setupOffline:progress', {
					type: 'stdout',
					chunk: chunk
				});
			}
		});

		// 实时监听 stderr
		child.stderr?.on('data', (data) => {
			const chunk = data.toString();
			stderrBuffer += chunk;

			// 推送原始数据块到前端
			if (win) {
				win.webContents.send('app:setupOffline:progress', {
					type: 'stderr',
					chunk: chunk
				});
			}
		});

		// 监听进程退出
		child.on('close', (code) => {
			console.log(`[setup-offline] 脚本执行完成，退出码: ${code}`);

			// 重置运行状态
			setupOfflineRunning = false;
			setupOfflineProcess = null;

			// 发送完成事件，包含完整输出
			if (win) {
				win.webContents.send('app:setupOffline:done', {
					exitCode: code,
					stdout: stdoutBuffer,
					stderr: stderrBuffer
				});
			}
		});

		// 监听进程错误（如文件不存在、权限不足等）
		child.on('error', (error) => {
			console.error('[setup-offline] 脚本执行错误:', error);

			// 重置运行状态
			setupOfflineRunning = false;
			setupOfflineProcess = null;

			// 发送错误事件
			if (win) {
				win.webContents.send('app:setupOffline:error', {
					message: error.message,
					code: 'PROCESS_ERROR',
					error: error.toString()
				});
			}
		});

		// 返回启动成功信息
		return {
			success: true,
			message: 'setup-offline 脚本已启动',
			childPid: child.pid
		};

	} catch (error) {
		console.error('运行 setup-offline 脚本失败:', error);

		// 重置运行状态
		setupOfflineRunning = false;
		setupOfflineProcess = null;

		// 发送错误事件
		if (win) {
			win.webContents.send('app:setupOffline:error', {
				message: error.message,
				code: 'SPAWN_ERROR',
				error: error.toString()
			});
		}

		return {
			success: false,
			error: {
				code: 'SPAWN_ERROR',
				message: error.message
			}
		};
	}
});

/**
 * 转写音频文件（前端专用）
 */
ipcMain.handle('transcribe-audio', async (event, { filePath, options = {}, progressId = null }) => {
	let job = null;

	try {
		// 验证输入参数
		if (!filePath || !fs.existsSync(filePath)) {
			throw new Error('音频文件不存在或路径无效');
		}

		// 创建标准的作业对象并添加到队列
		job = {
			id: generateJobId(),
			url: `file://${filePath}`,
			outputDir: path.dirname(filePath),
			options: {
				...options,
				language: options.language || 'auto',
				translate: options.translate || false,
				useMetal: options.useMetal !== false, // 默认启用Metal
				whisperPath: options.whisperPath,
				model: options.model,
				spawnFn: options.spawnFn
			},
			postAction: 'transcribe',
			metadata: {
				filePath: filePath,
				type: 'audio-transcription'
			}
		};

		// 添加到队列中，触发 job:created 事件
		const createdJob = jobQueue.add(job);

		// 广播转写开始事件，用于前端绑定 jobId 到下载条目
		if (win && win.webContents && !win.isDestroyed()) {
			win.webContents.send('transcribe:start', {
				jobId: job.id,
				filePath,
				options: options,
				outputDir: path.dirname(filePath),
				progressId: progressId || null
			});
		}

		// 创建日志记录器
		const logger = createJobLogger(job.id);

		// 推进作业状态到转写阶段
		jobQueue.advanceStage(job.id, JobStatus.TRANSCRIBING, {
			message: '开始音频转写'
		});

		await logger.info('开始音频转写', {
			filePath,
			options: options
		});

		// 执行转写
		const transcribeResult = await transcribe(job, filePath, {
			language: options.language || 'auto',
			translate: options.translate || false,
			threads: options.threads,
			useMetal: options.useMetal !== false,
			onProgress: (progress) => {
				// 使用标准的作业进度系统
				emitJobProgress(job.id, 'TRANSCRIBING', {
					percent: progress.percent || 0,
					message: progress.message || '转写中',
					speed: progress.speed,
					eta: progress.eta
				});
				logger.progress('TRANSCRIBING', progress.percent || 0, progress.message || '转写中', { progress });
			},
			onLog: (type, data) => {
				if (win) {
					win.webContents.send('job:log', {
						jobId: job.id,
						type: type,
						data: data
					});
				}
				logger.debug('Transcription log', { type, data });
			},
			whisperPath: options.whisperPath,
			model: options.model,
			spawnFn: options.spawnFn
		});

		// 推进作业到完成状态
		jobQueue.advanceStage(job.id, JobStatus.COMPLETED, {
			message: '转写完成',
			progress: { current: 100, total: 100 }
		});

		// 发送完成事件
		const result = {
			success: true,
			jobId: job.id,
			transcriptPath: transcribeResult.transcriptPath,
			duration: transcribeResult.duration,
			usedMetal: transcribeResult.usedMetal,
			message: '转写完成'
		};

		const transcriptDir = path.dirname(filePath);
		const inputBaseName = path.basename(filePath, path.extname(filePath));
		const expectedTranscriptPath = path.join(transcriptDir, `${inputBaseName}.txt`);
		const fallbackTranscriptPath = path.join(transcriptDir, `${path.basename(filePath)}.txt`);

		const ensureTranscriptFile = async () => {
			const candidateSet = new Set([
				result.transcriptPath,
				expectedTranscriptPath,
				fallbackTranscriptPath
			].filter(Boolean));

			try {
				const dirEntries = await fs.promises.readdir(transcriptDir);
				dirEntries.forEach((entry) => {
					if (!entry.toLowerCase().endsWith('.txt')) {
						return;
					}

					const entryPath = path.join(transcriptDir, entry);
					const entryName = entry.slice(0, -4);

					if (
						entryName === inputBaseName ||
						entryName === path.basename(filePath)
					) {
						candidateSet.add(entryPath);
					}
				});
			} catch (scanError) {
				await logger.warn('扫描转写输出目录失败', {
					directory: transcriptDir,
					error: scanError.message
				});
			}

			for (const candidate of candidateSet) {
				if (!candidate) {
					continue;
				}

				let candidateStats;
				try {
					candidateStats = await fs.promises.stat(candidate);
				} catch (_) {
					continue;
				}

				if (!candidateStats.isFile() || candidateStats.size === 0) {
					continue;
				}

				if (candidate !== expectedTranscriptPath) {
					try {
						await fs.promises.rename(candidate, expectedTranscriptPath);
					} catch (renameError) {
						try {
							await fs.promises.copyFile(candidate, expectedTranscriptPath);
							if (candidate !== result.transcriptPath) {
								await fs.promises.unlink(candidate).catch(() => {});
							}
						} catch (copyError) {
							await logger.warn('整理转写输出文件失败', {
								candidate,
								expectedTranscriptPath,
								renameError: renameError.message,
								copyError: copyError.message
							});
							continue;
						}
					}

					await logger.info('已整理转写文件路径', {
						from: candidate,
						to: expectedTranscriptPath
					});
				}

				result.transcriptPath = expectedTranscriptPath;
				return true;
			}

			try {
				const expectedStats = await fs.promises.stat(expectedTranscriptPath);
				if (expectedStats.isFile() && expectedStats.size > 0) {
					result.transcriptPath = expectedTranscriptPath;
					return true;
				}
			} catch (_) {}

			await logger.warn('转写完成但未找到转写文件', {
				expectedTranscriptPath,
				checkedCandidates: Array.from(candidateSet)
			});
			return false;
		};

		await ensureTranscriptFile();

		if (win) {
			win.webContents.send('job:completed', result);
		}

		await logger.info('音频转写完成', {
			result: result
		});

		if (!job.options?.keepVideo) {
			try {
				await fs.promises.unlink(filePath);
				await logger.info('已删除原始媒体文件（用户选择不保留）', {
					filePath
				});
			} catch (deleteError) {
				await logger.warn('删除原始媒体文件失败:', deleteError);
			}
		}

		return result;

	} catch (error) {
		console.error('音频转写失败:', error);

		// 如果作业已创建，标记为失败
		if (job) {
			jobQueue.fail(job.id, {
				code: 'TRANSCRIBE_ERROR',
				message: error.message,
				stage: 'TRANSCRIBING'
			});
		}

		const errorResult = {
			success: false,
			jobId: job?.id,
			error: {
				code: 'TRANSCRIBE_ERROR',
				message: error.message,
				stage: 'TRANSCRIBING'
			},
			message: '转写失败'
		};

		// 发送错误事件到UI
		if (win) {
			win.webContents.send('job:failed', errorResult);
		}

		return errorResult;
	}
});

/**
 * 检查离线依赖
 */
ipcMain.handle('deps:check', async () => {
	try {
		const platform = process.platform;
		const runtimeDir = path.join(__dirname, 'resources', 'runtime');
		const binDir = path.join(runtimeDir, 'bin');
		const whisperDir = path.join(runtimeDir, 'whisper');

		// 确定平台特定的二进制文件名
		const getYtDlpBinary = () => {
			if (platform === 'win32') return 'yt-dlp.exe';
			return 'yt-dlp';
		};

		const getFfmpegBinary = () => {
			if (platform === 'win32') return 'ffmpeg.exe';
			return 'ffmpeg';
		};

		const getWhisperBinary = () => {
			if (platform === 'win32') return 'whisper.exe';
			if (platform === 'darwin') return 'whisper-macos';
			return 'whisper-linux';
		};

		const dependencies = [
			{
				name: 'yt-dlp',
				// 优先检查 runtime/bin 目录，然后检查系统 PATH
				runtimePath: path.join(binDir, getYtDlpBinary()),
				systemCommand: 'yt-dlp --version',
				available: false,
				version: null,
				path: null
			},
			{
				name: 'ffmpeg',
				// 优先检查 runtime/bin 目录，然后检查系统 PATH
				runtimePath: path.join(binDir, getFfmpegBinary()),
				systemCommand: 'ffmpeg -version',
				available: false,
				version: null,
				path: null
			},
			{
				name: 'whisper.cpp',
				// 检查 runtime/whisper 目录中的平台特定二进制
				runtimePath: path.join(whisperDir, getWhisperBinary()),
				systemCommand: null, // whisper.cpp 通常不在系统 PATH 中
				available: false,
				version: null,
				path: null
			}
		];

		// 检查每个依赖
		for (const dep of dependencies) {
			let checked = false;

			// 首先检查 runtime 目录中的二进制文件
			if (fs.existsSync(dep.runtimePath)) {
				try {
					const command = `"${dep.runtimePath}"${dep.name === 'yt-dlp' ? ' --version' : dep.name === 'ffmpeg' ? ' -version' : ' --help'}`;
					const { stdout } = await execAsync(command);
					dep.available = true;
					dep.path = dep.runtimePath;

					// 尝试提取版本信息
					if (dep.name === 'yt-dlp') {
						const match = stdout.match(/(\d{4}\.\d{2}\.\d{2})/);
						dep.version = match ? match[1] : 'Unknown';
					} else if (dep.name === 'ffmpeg') {
						const match = stdout.match(/version ([\d.]+)/i);
						dep.version = match ? match[1] : 'Unknown';
					} else if (dep.name === 'whisper.cpp') {
						dep.version = 'ggml-large-v3-turbo';
					}

					checked = true;
					console.log(`[deps:check] ${dep.name} found in runtime: ${dep.runtimePath}`);
				} catch (error) {
					console.warn(`[deps:check] Runtime ${dep.name} exists but failed to execute:`, error.message);
				}
			}

			// 如果 runtime 目录中没有，则检查系统 PATH
			if (!checked && dep.systemCommand) {
				try {
					const { stdout } = await execAsync(dep.systemCommand);
					dep.available = true;

					// 获取系统二进制路径
					try {
						const whichCommand = platform === 'win32' ? 'where' : 'which';
						const { stdout: pathOutput } = await execAsync(`${whichCommand} ${dep.name}`);
						dep.path = pathOutput.trim().split('\n')[0];
					} catch (pathError) {
						// 无法获取路径，但二进制可用
						dep.path = dep.name;
					}

					// 尝试提取版本信息
					if (dep.name === 'yt-dlp') {
						const match = stdout.match(/(\d{4}\.\d{2}\.\d{2})/);
						dep.version = match ? match[1] : 'Unknown';
					} else if (dep.name === 'ffmpeg') {
						const match = stdout.match(/version ([\d.]+)/i);
						dep.version = match ? match[1] : 'Unknown';
					}

					console.log(`[deps:check] ${dep.name} found in system PATH`);
				} catch (error) {
					// 依赖不可用
					dep.available = false;
					console.log(`[deps:check] ${dep.name} not found: ${error.message}`);
				}
			}
		}

		// 检查模型文件
		const modelPath = path.join(whisperDir, 'models', 'ggml-large-v3-turbo-q5_0.bin');
		const modelDep = {
			name: 'Whisper Model (Large V3 Turbo)',
			available: fs.existsSync(modelPath),
			version: 'ggml-large-v3-turbo-q5_0',
			path: modelPath
		};

		dependencies.push(modelDep);

		console.log(`[deps:check] Dependencies check completed. Available: ${dependencies.filter(d => d.available).length}/${dependencies.length}`);

		return {
			success: true,
			dependencies,
			timestamp: new Date().toISOString()
		};

	} catch (error) {
		console.error('检查依赖失败:', error);
		return {
			success: false,
			error: {
				code: 'DEPS_CHECK_ERROR',
				message: error.message
			},
			timestamp: new Date().toISOString()
		};
	}
});

/**
 * 导出诊断包
 */
ipcMain.handle('job:exportDiagnostics', async (event, jobId, options = {}) => {
	try {
		console.log(`[Diagnostics] 开始导出诊断包: ${jobId}`);

		const result = await exportDiagnostics(jobId, {
			format: options.format || 'zip',
			includeSystemInfo: options.includeSystemInfo !== false,
			outputDir: options.outputDir || null
		});

		if (result.success) {
			console.log(`[Diagnostics] 诊断包导出成功: ${result.archivePath}`);

			// 发送成功通知到 Renderer
			if (win) {
				win.webContents.send('job:diagnostics-exported', {
					jobId,
					archivePath: result.archivePath,
					size: result.size,
					format: result.format,
					filesCount: result.filesCount,
					files: result.files,
					timestamp: result.timestamp
				});
			}
		} else {
			console.error(`[Diagnostics] 诊断包导出失败: ${result.error}`);

			// 发送失败通知到 Renderer
			if (win) {
				win.webContents.send('job:diagnostics-error', {
					jobId,
					error: result.error,
					timestamp: result.timestamp
				});
			}
		}

		return result;

	} catch (error) {
		console.error('导出诊断包失败:', error);

		const errorResult = {
			success: false,
			error: {
				code: 'DIAGNOSTICS_EXPORT_ERROR',
				message: error.message,
				stack: error.stack
			},
			jobId,
			timestamp: new Date().toISOString()
		};

		// 发送错误通知到 Renderer
		if (win) {
			win.webContents.send('job:diagnostics-error', errorResult);
		}

		return errorResult;
	}
});

// 启动时恢复队列中的作业（如果有的话）
app.on('ready', () => {
	// 这里可以添加持久化作业的恢复逻辑
	console.log('作业管理系统已初始化');
});

// ============================================================================
// 进度展示相关 IPC 处理器
// ============================================================================

/**
 * 读取文件内容
 */
ipcMain.handle('read-file', async (event, filePath) => {
	try {
		if (!filePath || !fs.existsSync(filePath)) {
			throw new Error('文件不存在');
		}

		const content = fs.readFileSync(filePath, 'utf8');
		return content;
	} catch (error) {
		console.error('读取文件失败:', error);
		throw error;
	}
});

/**
 * 显示文件或文件夹
 */
ipcMain.handle('show-item', async (event, itemPath) => {
	try {
		if (!itemPath || !fs.existsSync(itemPath)) {
			throw new Error('文件或文件夹不存在');
		}

		await shell.showItemInFolder(itemPath);
		return { success: true };
	} catch (error) {
		console.error('显示文件失败:', error);
		throw error;
	}
});

// 退出时清理作业
app.on('before-quit', () => {
	// 保存队列状态到磁盘（如果需要持久化）
	console.log('正在清理作业队列...');
});
