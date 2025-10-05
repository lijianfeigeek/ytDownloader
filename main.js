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

	try {
		// 阶段1: 下载视频
		console.log(`🚀 [${job.id}] 开始下载阶段`);
		jobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
		emitJobProgress(job.id, 'DOWNLOADING', { percent: 0, message: '开始下载视频' });
		saveJobMetadata(job, 'DOWNLOADING');

		const downloadResult = await download(job, (progress) => {
			emitJobProgress(job.id, 'DOWNLOADING', progress);
		}, {
			ytDlpPath: job.options?.ytDlpPath,
			ytDlpInstance: job.options?.ytDlpInstance
		});

		const videoPath = downloadResult;
		finalResult.outputs.video = videoPath;

		// 保存下载结果
		saveJobMetadata(job, 'DOWNLOADING', { filePath: videoPath });
		emitJobProgress(job.id, 'DOWNLOADING', { percent: 100, message: '视频下载完成' });

		// 阶段2: 提取音频
		console.log(`🎵 [${job.id}] 开始音频提取阶段`);
		jobQueue.advanceStage(job.id, JobStatus.EXTRACTING);
		emitJobProgress(job.id, 'EXTRACTING', { percent: 0, message: '开始提取音频' });
		saveJobMetadata(job, 'EXTRACTING');

		const audioResult = await extractAudio(videoPath, {
			outputDir: job.outputDir,
			bitrate: job.options?.audioBitrate || '192k',
			generateWav: true, // 为 Whisper 生成 WAV 文件
			codec: 'libmp3lame',
			onLog: (type, data) => {
				emitJobLog(job.id, type, data);
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

		emitJobProgress(job.id, 'EXTRACTING', { percent: 100, message: '音频提取完成' });

		// 阶段3: 转写语音
		console.log(`📝 [${job.id}] 开始转写阶段`);
		jobQueue.advanceStage(job.id, JobStatus.TRANSCRIBING);
		emitJobProgress(job.id, 'TRANSCRIBING', { percent: 0, message: '开始语音转写' });
		saveJobMetadata(job, 'TRANSCRIBING');

		const audioForTranscribe = audioResult.wavPath || audioResult.mp3Path;
		const transcribeResult = await transcribe(job, audioForTranscribe, {
			language: job.options?.language || 'auto',
			translate: job.options?.translate || false,
			threads: job.options?.threads,
			useMetal: job.options?.useMetal,
			onProgress: (progress) => {
				emitJobProgress(job.id, 'TRANSCRIBING', progress);
			},
			onLog: (type, data) => {
				emitJobLog(job.id, type, data);
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

		emitJobProgress(job.id, 'TRANSCRIBING', { percent: 100, message: '语音转写完成' });

		// 阶段4: 整理和打包
		console.log(`📦 [${job.id}] 开始打包阶段`);
		jobQueue.advanceStage(job.id, JobStatus.PACKING);
		emitJobProgress(job.id, 'PACKING', { percent: 0, message: '整理输出文件' });
		saveJobMetadata(job, 'PACKING');

		// 生成日志文件
		const logs = [];
		logs.push(`# 作业执行日志 - ${job.id}`);
		logs.push(`创建时间: ${new Date().toISOString()}`);
		logs.push(`URL: ${job.url}`);
		logs.push(`输出目录: ${job.outputDir}`);
		logs.push(`选项: ${JSON.stringify(job.options, null, 2)}`);
		logs.push('');
		logs.push('## 执行结果');
		logs.push(`- 视频文件: ${finalResult.outputs.video}`);
		logs.push(`- MP3 音频: ${finalResult.outputs.audio.mp3Path}`);
		if (finalResult.outputs.audio.wavPath) {
			logs.push(`- WAV 音频: ${finalResult.outputs.audio.wavPath}`);
		}
		logs.push(`- 转写文本: ${finalResult.outputs.transcript}`);
		logs.push(`- 总耗时: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

		const logsPath = path.join(job.outputDir, 'logs.txt');
		fs.writeFileSync(logsPath, logs.join('\n'), 'utf8');

		// 更新最终元数据
		const finalMetadata = {
			...job,
			completedAt: new Date().toISOString(),
			duration: (Date.now() - startTime) / 1000,
			status: 'completed',
			outputs: finalResult.outputs,
			logPath: logsPath
		};

		saveJobMetadata(job, 'COMPLETED', finalMetadata);

		finalResult.duration = (Date.now() - startTime) / 1000;
		emitJobProgress(job.id, 'PACKING', { percent: 100, message: '作业完成' });

		// 完成作业 - 推进到最终状态
		console.log(`✅ [${job.id}] 作业完成，推进到 COMPLETED 状态`);
		jobQueue.advanceStage(job.id, JobStatus.COMPLETED);

		return finalResult;

	} catch (error) {
		console.error('作业执行失败:', error);

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
 * 检查离线依赖
 */
ipcMain.handle('deps:check', async () => {
	try {
		const dependencies = [
			{
				name: 'yt-dlp',
				command: 'yt-dlp --version',
				available: false,
				version: null,
				path: null
			},
			{
				name: 'ffmpeg',
				command: 'ffmpeg -version',
				available: false,
				version: null,
				path: null
			},
			{
				name: 'whisper.cpp',
				command: path.join(__dirname, '../resources/runtime/whisper/whisper --help'),
				available: false,
				version: null,
				path: null
			}
		];

		// 检查每个依赖
		for (const dep of dependencies) {
			try {
				const { stdout } = await execAsync(dep.command);
				dep.available = true;

				// 尝试提取版本信息
				if (dep.name === 'yt-dlp') {
					const match = stdout.match(/(\d{4}\.\d{2}\.\d{2})/);
					dep.version = match ? match[1] : 'Unknown';
				} else if (dep.name === 'ffmpeg') {
					const match = stdout.match(/version ([\d.]+)/i);
					dep.version = match ? match[1] : 'Unknown';
				} else if (dep.name === 'whisper.cpp') {
					dep.version = 'ggml-large-v3-turbo';
					dep.path = path.join(__dirname, '../resources/runtime/whisper/whisper');
				}

			} catch (error) {
				// 依赖不可用
				dep.available = false;
			}
		}

		// 检查模型文件
		const modelPath = path.join(__dirname, '../resources/runtime/whisper/models/ggml-large-v3-turbo-q5_0.bin');
		const modelDep = {
			name: 'Whisper Model (Large V3 Turbo)',
			available: fs.existsSync(modelPath),
			version: 'ggml-large-v3-turbo-q5_0',
			path: modelPath
		};

		dependencies.push(modelDep);

		return {
			success: true,
			dependencies
		};

	} catch (error) {
		console.error('检查依赖失败:', error);
		return {
			success: false,
			error: {
				code: 'DEPS_CHECK_ERROR',
				message: error.message
			}
		};
	}
});

// 启动时恢复队列中的作业（如果有的话）
app.on('ready', () => {
	// 这里可以添加持久化作业的恢复逻辑
	console.log('作业管理系统已初始化');
});

// 退出时清理作业
app.on('before-quit', () => {
	// 保存队列状态到磁盘（如果需要持久化）
	console.log('正在清理作业队列...');
});
