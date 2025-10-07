const cp = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const {shell, ipcRenderer, clipboard} = require("electron");
const {default: YTDlpWrap} = require("yt-dlp-wrap-plus");
const {constants} = require("fs/promises");

// Runtime binaries directory
const runtimeBinDir = path.join(__dirname, '..', 'resources', 'runtime', 'bin');

// Bundled yt-dlp and ffmpeg paths
const bundledYtDlp = process.platform === 'win32'
    ? path.join(runtimeBinDir, 'yt-dlp.exe')
    : path.join(runtimeBinDir, 'yt-dlp');

const bundledFfmpeg = process.platform === 'win32'
    ? path.join(runtimeBinDir, 'ffmpeg.exe')
    : path.join(runtimeBinDir, 'ffmpeg');

let ffmpeg = "";

// Directories
const homedir = os.homedir();
let appdir = path.join(homedir, "Downloads");

if (os.platform() === "linux") {
	try {
		const xdgDownloadDir = cp
			.execSync("xdg-user-dir DOWNLOAD")
			.toString()
			.trim();
		if (xdgDownloadDir.length > 1) {
			appdir = xdgDownloadDir;
			console.log("xdg download dir:", xdgDownloadDir);
		}
	} catch (_err) {}
}
const hiddenDir = path.join(homedir, ".ytDownloader");
const i18n = new (require("../translations/i18n"))();

fs.mkdir(hiddenDir, {recursive: true}, () => {});

// System tray
const trayEnabled = localStorage.getItem("closeToTray");

if (trayEnabled == "true") {
	console.log("Tray is Enabled");
	ipcRenderer.send("useTray", true);
}

// Download directory
let downloadDir = "";

// Global variables
let title, onlyVideo, thumbnail, ytDlp, duration, extractor_key;
let audioExtensionList = [];
let rangeCmd = "";
let subs = "";
let subLangs;
let rangeOption = "--download-sections";
let cookieArg = "";
let browser = "";
let maxActiveDownloads = 5;
let showMoreFormats = false;
let configArg = "";
let configTxt = "";
let proxy = "";
let downloadedItemList = [];
let ytDlpIsPresent = false;

// Post-download actions state
let postActionState = {
    selected: 'none', // 'none' | 'extract' | 'transcribe'
    transcribeLanguage: 'auto',
    keepVideo: false
};

// Progress animation state cache to smooth UI updates
const progressAnimations = new Map();
const requestAnimationFrameSafe =
	typeof window !== "undefined" && window.requestAnimationFrame
		? window.requestAnimationFrame.bind(window)
		: (callback) => setTimeout(callback, 16);
const cancelAnimationFrameSafe =
	typeof window !== "undefined" && window.cancelAnimationFrame
		? window.cancelAnimationFrame.bind(window)
		: (id) => clearTimeout(id);

if (localStorage.getItem("configPath")) {
	configArg = "--config-location";
	configTxt = `"${localStorage.getItem("configPath")}"`;
}

checkMaxDownloads();

// Get system proxy
// getSystemProxy("https://www.google.com").then((proxyInfo) => {
// 	if (proxyInfo != "DIRECT") {
// 		try {
// 			const proxyUrl = proxyInfo.split(" ")[1];

// 			proxy = proxyUrl;

// 			console.log("System proxy: " + proxy);
// 		} catch (_) {}
// 	}
// });

// Check for updates
let autoUpdate = true;

if (localStorage.getItem("autoUpdate") == "false") {
	autoUpdate = false;
}

if (process.windowsStore) {
	autoUpdate = false;
}

if (process.env.YTDOWNLOADER_AUTO_UPDATES == "0") {
	autoUpdate = false;
}

ipcRenderer.send("autoUpdate", autoUpdate);

let currentDownloads = 0;
let controllers = new Object();

// Video and audio preferences
let preferredVideoQuality = 1080;
let preferredAudioQuality = "";
let preferredVideoCodec = "avc1";
/**
 *
 * @param {string} id
 */

downloadPathSelection();

const possiblePaths = [
	"/opt/homebrew/bin/yt-dlp", // Apple Silicon
	"/usr/local/bin/yt-dlp", // Intel
];

// Checking for yt-dlp
let ytDlpPath = path.join(os.homedir(), ".ytDownloader", "ytdlp");

// Priority 1: Check bundled yt-dlp first for all platforms
if (fs.existsSync(bundledYtDlp)) {
	ytDlpPath = bundledYtDlp;
}

if (os.platform() == "win32") {
	// If bundled yt-dlp wasn't found, use Windows user directory
	if (!fs.existsSync(bundledYtDlp)) {
		ytDlpPath = path.join(os.homedir(), ".ytDownloader", "ytdlp.exe");
	}
}

// Macos yt-dlp check
if (os.platform() === "darwin") {
	// If bundled yt-dlp wasn't found in the initial check, try system paths
	if (!fs.existsSync(bundledYtDlp)) {
		ytDlpPath = possiblePaths.find((p) => fs.existsSync(p)) || null;

		if (ytDlpPath == null) {
			showMacYtdlpPopup();
		} else {
			ytDlpIsPresent = true;
			ytDlp = new YTDlpWrap(`"${ytDlpPath}"`);
			setLocalStorageYtDlp(ytDlpPath);
		}
	} else {
		// Bundled yt-dlp was found in initial check
		ytDlpIsPresent = true;
		ytDlp = new YTDlpWrap(`"${ytDlpPath}"`);
		setLocalStorageYtDlp(ytDlpPath);
	}
}

// Use system yt-dlp for freebsd
if (os.platform() === "freebsd") {
	// If bundled yt-dlp wasn't found in the initial check, try system yt-dlp
	if (!fs.existsSync(bundledYtDlp)) {
		try {
			ytDlpPath = cp
				.execSync("which yt-dlp")
				.toString("utf8")
				.split("\n")[0]
				.trim();

			ytDlpIsPresent = true;
			ytDlp = new YTDlpWrap(`"${ytDlpPath}"`);
			setLocalStorageYtDlp(ytDlpPath);
		} catch (error) {
			console.log(error);

			hidePasteBtn();

			getId("incorrectMsg").textContent = i18n.__(
				"No yt-dlp found in PATH. Make sure you have the full executable. App will not work"
			);
		}
	} else {
		// Bundled yt-dlp was found in initial check
		ytDlpIsPresent = true;
		ytDlp = new YTDlpWrap(`"${ytDlpPath}"`);
		setLocalStorageYtDlp(ytDlpPath);
	}
}

// Getting yt-dlp path from environment variable
if (process.env.YTDOWNLOADER_YTDLP_PATH) {
	ytDlpPath = process.env.YTDOWNLOADER_YTDLP_PATH;

	if (fs.existsSync(ytDlpPath)) {
		logYtDlpPresent(ytDlpPath);

		ytDlp = new YTDlpWrap(`"${ytDlpPath}"`);
		ytDlpIsPresent = true;
		setLocalStorageYtDlp(ytDlpPath);
	} else {
		hidePasteBtn();

		getId("incorrectMsg").textContent = i18n.__(
			"You have specified YTDOWNLOADER_YTDLP_PATH, but no file exists there."
		);
	}
}

// Checking if yt-dlp bin is present
if (
	localStorage.getItem("ytdlp") &&
	os.platform() != "darwin" &&
	os.platform() != "freebsd" &&
	!process.env.YTDOWNLOADER_YTDLP_PATH
) {
	const localStorageytDlpPath = localStorage.getItem("ytdlp");

	if (fs.existsSync(localStorageytDlpPath)) {
		logYtDlpPresent(ytDlpPath);

		ytDlp = new YTDlpWrap(`"${ytDlpPath}"`);

		cp.spawn(`${ytDlpPath}`, ["-U"]).stdout.on("data", (data) =>
			console.log(data.toString("utf8"))
		);

		ipcRenderer.send("ready-for-links");

		ytDlpIsPresent = true;
		setLocalStorageYtDlp(ytDlpPath);
	}
}

if (
	!ytDlpIsPresent &&
	!process.env.YTDOWNLOADER_YTDLP_PATH &&
	os.platform() !== "freebsd" &&
	os.platform() !== "darwin"
) {
	// yt-dlp download path
	let ytDlpDownloadPath;
	if (os.platform() == "win32") {
		ytDlpDownloadPath = path.join(
			os.homedir(),
			".ytDownloader",
			"ytdlp.exe"
		);
	} else {
		ytDlpDownloadPath = path.join(os.homedir(), ".ytDownloader", "ytdlp");
	}

	cp.exec(`"${ytDlpPath}" --version`, (error, _stdout, _stderr) => {
		if (error) {
			getId("popupBox").style.display = "block";

			process.on("uncaughtException", (_reason, _promise) => {
				handleYtDlpError();
			});

			downloadYtDlp(ytDlpDownloadPath);
		} else {
			logYtDlpPresent(ytDlpPath);

			ytDlp = new YTDlpWrap(`"${ytDlpPath}"`);

			cp.spawn(`${ytDlpPath}`, ["-U"]).stdout.on("data", (data) =>
				console.log(data.toString("utf8"))
			);

			ipcRenderer.send("ready-for-links");
			setLocalStorageYtDlp(ytDlpPath);
		}
	});
}

// Ffmpeg check
// Priority 1: Check bundled ffmpeg first
if (fs.existsSync(bundledFfmpeg)) {
	ffmpeg = `"${bundledFfmpeg}"`;
} else if (os.platform() === "win32") {
	// Priority 2: Fall back to Windows default location
	ffmpeg = `"${__dirname}\\..\\ffmpeg.exe"`;
} else if (os.platform() === "freebsd") {
	// Priority 2: Fall back to system ffmpeg on FreeBSD
	try {
		ffmpeg = cp
			.execSync("which ffmpeg")
			.toString("utf8")
			.split("\n")[0]
			.trim();
	} catch (error) {
		console.log(error);

		getId("incorrectMsg").textContent = i18n.__("No ffmpeg found in PATH");
	}
} else {
	// Priority 2: Fall back to default Unix location
	ffmpeg = `"${__dirname}/../ffmpeg"`;
}

if (process.env.YTDOWNLOADER_FFMPEG_PATH) {
	ffmpeg = `"${process.env.YTDOWNLOADER_FFMPEG_PATH}"`;

	if (fs.existsSync(process.env.YTDOWNLOADER_FFMPEG_PATH)) {
		console.log("Using YTDOWNLOADER_FFMPEG_PATH");
	} else {
		getId("incorrectMsg").textContent = i18n.__(
			"You have specified YTDOWNLOADER_FFMPEG_PATH, but no file exists there."
		);
	}
}

console.log(ffmpeg);

getId("closeHidden").addEventListener("click", () => {
	hideHidden();
	getId("loadingWrapper").style.display = "none";
});

document.addEventListener("keydown", (event) => {
	if (
		(event.ctrlKey || event.metaKey) &&
		event.key == "v" &&
		document.activeElement.tagName !== "INPUT"
	) {
		pasteUrl();
	}
});

getId("pasteUrl").addEventListener("click", () => {
	pasteUrl();
});

// Post-download actions event listeners
document.querySelectorAll('input[name="postAction"]').forEach(radio => {
	radio.addEventListener("change", (e) => {
		postActionState.selected = e.target.value;

		// Show/hide transcribe options
		const transcribeOptions = getId("transcribeOptions");
		if (e.target.value === 'transcribe') {
			transcribeOptions.style.display = 'block';
			// Auto-check keep video for transcription
			getId("keepVideoAfterTranscribe").checked = true;
			postActionState.keepVideo = true;
		} else {
			transcribeOptions.style.display = 'none';
		}

		// Update download button text
		updateDownloadButtonText();
	});
});

getId("transcribeLanguage").addEventListener("change", (e) => {
	postActionState.transcribeLanguage = e.target.value;
});

getId("keepVideoAfterTranscribe").addEventListener("change", (e) => {
	postActionState.keepVideo = e.target.checked;
});

// Getting video info
/**
 *
 * @param {string} url
 */
async function getInfo(url) {
	audioExtensionList = [];
	let selected = false;
	onlyVideo = false;
	let audioIsPresent = false;
	downloadPathSelection();

	// Cleaning text
	resetDomValues();

	if (localStorage.getItem("preferredVideoQuality")) {
		preferredVideoQuality = Number(
			localStorage.getItem("preferredVideoQuality")
		);
	}

	if (localStorage.getItem("preferredAudioQuality")) {
		preferredAudioQuality = localStorage.getItem("preferredAudioQuality");
		getId("extractSelection").value = preferredAudioQuality;
	}

	if (localStorage.getItem("preferredVideoCodec")) {
		preferredVideoCodec = localStorage.getItem("preferredVideoCodec");
	}

	if (localStorage.getItem("showMoreFormats") === "true") {
		showMoreFormats = true;
	} else {
		showMoreFormats = false;
	}

	proxy = getLocalStorageItem("proxy");

	// Whether to use browser cookies or not
	if (localStorage.getItem("browser")) {
		browser = localStorage.getItem("browser");
	}

	if (browser) {
		cookieArg = "--cookies-from-browser";
	} else {
		cookieArg = "";
	}

	let validInfo = true;

	let info = "";

	const infoOptions = [
		"-j",
		"--no-playlist",
		"--no-warnings",
		proxy ? "--no-check-certificate" : "",
		proxy ? "--proxy" : "",
		proxy,
		cookieArg,
		browser,
		configArg,
		configTxt,
		`"${url}"`,
	].filter((item) => item);

	const infoProcess = cp.spawn(`"${ytDlpPath}"`, infoOptions, {
		shell: true,
	});

	infoProcess.stdout.on("data", (data) => {
		info += data;
	});

	infoProcess.stderr.on("data", (error) => {
		const errorString = error.toString("utf8");
		const trimmedError = errorString.trim();
		// Treat Python 3.9 deprecation notice as a non-fatal warning so yt-dlp output can still be processed
		if (
			trimmedError.startsWith("WARNING") ||
			trimmedError
				.toLowerCase()
				.includes("support for python version 3.9 has been deprecated")
		) {
			console.warn(trimmedError);
			return;
		}
		validInfo = false;
		// Error message handling
		console.log(errorString);
		getId("loadingWrapper").style.display = "none";
		getId("incorrectMsg").textContent = i18n.__(
			"Some error has occurred. Check your network and use correct URL"
		);
		getId("errorBtn").style.display = "inline-block";
		getId("errorDetails").innerHTML = `
		<strong>URL: ${url}</strong>
		<br><br>
		${errorString}
		`;
		getId("errorDetails").title = i18n.__("Click to copy");
	});

	infoProcess.on("close", () => {
		if (validInfo) {
			/**
			 * @typedef {import("./types").info} info
			 * @type {info}
			 */
			const parsedInfo = JSON.parse(info);
			console.log(parsedInfo);

			title = `${parsedInfo.title} [${parsedInfo.id}]`;
			thumbnail = parsedInfo.thumbnail;
			duration = parsedInfo.duration;
			extractor_key = parsedInfo.extractor_key;
			/**
			 * @typedef {import("./types").format} format
			 * @type {format[]}
			 */
			const formats = parsedInfo.formats || [];
			console.log(formats);

			/**
			 * @type {HTMLInputElement[]}
			 */
			// @ts-ignore
			const urlElements = document.querySelectorAll(".url");
			urlElements.forEach((element) => {
				element.value = url;
			});

			getId("loadingWrapper").style.display = "none";

			getId("hidden").style.display = "inline-block";
			getId("hidden").classList.add("scaleUp");

			const titleElement = getId("title");
			titleElement.textContent = "";

			titleElement.append(
				Object.assign(document.createElement("b"), {
					textContent: i18n.__("Title "),
				}),
				": ",
				Object.assign(document.createElement("input"), {
					className: "title",
					id: "titleName",
					type: "text",
					value: title,
					onchange: renameTitle,
				})
			);

			let audioSize = 0;
			let defaultVideoFormat = 144;
			let videoFormatCodecs = {};

			let preferredAudioFormatLength = 0;
			let preferredAudioFormatCount = 0;
			let maxAudioFormatNoteLength = 10;

			// Initially going through all formats
			// Getting approx size of audio file and checking if audio is present
			for (let format of formats) {
				// Find the item with the preferred video format
				if (
					format.height <= preferredVideoQuality &&
					format.height >= defaultVideoFormat &&
					format.video_ext !== "none" &&
					!(
						format.video_ext === "mp4" &&
						format.vcodec &&
						format.vcodec.split(".")[0] === "vp09"
					) &&
					(!showMoreFormats ? format.video_ext !== "webm" : true)
				) {
					defaultVideoFormat = format.height;

					// Creating a list of available codecs for the required video height
					if (!videoFormatCodecs[format.height]) {
						videoFormatCodecs[format.height] = {codecs: []};
					}
					if (format.vcodec) {
						videoFormatCodecs[format.height].codecs.push(
							format.vcodec.split(".")[0]
						);
					}
				}

				// Going through audio list
				if (
					format.audio_ext !== "none" ||
					(format.acodec !== "none" && format.video_ext === "none")
				) {
					audioIsPresent = true;
					onlyVideo = true;
					audioSize =
						Number(format.filesize || format.filesize_approx) /
						1000000;

					if (!audioExtensionList.includes(format.audio_ext)) {
						audioExtensionList.push(format.audio_ext);
					}

					if (
						format.format_note &&
						format.format_note.length > maxAudioFormatNoteLength
					) {
						maxAudioFormatNoteLength = format.format_note.length;
					}
				}

				if (
					format.audio_ext === preferredAudioQuality ||
					format.acodec === preferredAudioQuality
				) {
					preferredAudioFormatLength++;
				}
			}

			const availableCodecs = videoFormatCodecs[defaultVideoFormat]
				? videoFormatCodecs[defaultVideoFormat].codecs
				: [];

			if (!availableCodecs.includes(preferredVideoCodec)) {
				preferredVideoCodec =
					availableCodecs[availableCodecs.length - 1];
			}

			for (let format of formats) {
				let size;
				let selectedText = "";
				let audioSelectedText = "";

				if (
					format.height == defaultVideoFormat &&
					format.vcodec &&
					format.vcodec.split(".")[0] === preferredVideoCodec &&
					!selected &&
					format.video_ext !== "none" &&
					!(
						format.video_ext === "mp4" &&
						format.vcodec &&
						format.vcodec.split(".")[0] === "vp09"
					) &&
					(!showMoreFormats ? format.video_ext !== "webm" : true)
				) {
					selectedText = " selected ";
					selected = true;
				}

				if (format.filesize || format.filesize_approx) {
					size = (
						Number(format.filesize || format.filesize_approx) /
						1000000
					).toFixed(2);
				} else {
					// if (format.tbr) {
					// 	size = (
					// 		(format.tbr * 50 * duration) /
					// 		1000000
					// 	).toFixed(2);
					// } else {

					// }
					size = i18n.__("Unknown size");
				}

				// For videos

				if (
					format.video_ext !== "none" &&
					!(
						format.video_ext === "mp4" &&
						format.vcodec &&
						format.vcodec.split(".")[0] === "vp09"
					) &&
					(!showMoreFormats ? format.video_ext !== "webm" : true)
				) {
					if (size !== i18n.__("Unknown size")) {
						size = (Number(size) + 0 || Number(audioSize)).toFixed(
							1
						);
						size = size + " " + i18n.__("MB");
					}

					const format_id =
						format.format_id +
						"|" +
						format.ext +
						"|" +
						(format.height || "NO");

					// Video codec

					const vcodec =
						format.vcodec && showMoreFormats
							? format.vcodec.split(".")[0]
							: "";
					let spaceAfterVcodec = showMoreFormats
						? "&#160".repeat(5 - vcodec.length)
						: "";
					showMoreFormats
						? (spaceAfterVcodec += "|  ")
						: (spaceAfterVcodec += "");

					// Quality
					const quality =
						(format.height
							? format.height +
							  "p" +
							  (format.fps == 60 ? "60" : "")
							: "") ||
						format.format_note ||
						format.resolution ||
						format.format_id ||
						"Unknown quality";
					const spaceAfterQuality = "&#160".repeat(
						quality.length <= 8 && 8 - quality.length > 0
							? 8 - quality.length
							: 1
					);

					// Extension
					const extension = format.ext;

					// Format and Quality Options
					const element =
						"<option value='" +
						format_id +
						"'" +
						selectedText +
						">" +
						quality +
						spaceAfterQuality +
						"| " +
						extension.padEnd(5, "\xa0") +
						"|  " +
						(vcodec ? vcodec + spaceAfterVcodec : "") +
						size +
						(format.acodec !== "none" ? " 🔊" : "") +
						"</option>";
					getId("videoFormatSelect").innerHTML += element;
				}
				// For audios
				else if (
					format.audio_ext !== "none" ||
					(format.acodec !== "none" && format.video_ext === "none")
				) {
					if (!showMoreFormats && format.audio_ext === "webm") {
						continue;
					}

					size =
						size !== i18n.__("Unknown size")
							? size + " MB"
							: i18n.__("Unknown size");
					let audio_ext;

					if (format.audio_ext === "webm") {
						audio_ext = "opus";
					} else {
						audio_ext = format.audio_ext;
					}
					if (
						format.audio_ext === preferredAudioQuality ||
						format.acodec === preferredAudioQuality
					) {
						preferredAudioFormatCount += 1;
						if (
							preferredAudioFormatCount ===
							preferredAudioFormatLength
						) {
							audioSelectedText = " selected ";
						}
					}

					const format_id = format.format_id + "|" + audio_ext;

					/**@type {string} */
					let formatNote =
						i18n.__(format.format_note) ||
						i18n.__("Unknown quality");

					formatNote = formatNote.padEnd(
						maxAudioFormatNoteLength,
						"\xa0"
					);

					const element =
						"<option value='" +
						format_id +
						"'" +
						audioSelectedText +
						">" +
						// i18n.__("Quality") +
						// ": " +
						formatNote +
						"| " +
						audio_ext.padEnd(4, "\xa0") +
						" | " +
						size +
						"</option>";

					getId("audioFormatSelect").innerHTML += element;
					getId("audioForVideoFormatSelect").innerHTML += element;
				}
				// Both audio and video available
				else if (
					format.audio_ext !== "none" ||
					(format.acodec !== "none" && format.video_ext !== "none")
				) {
					// Skip them
				}

				// When there is no audio
				if (audioIsPresent === false) {
					getId("audioPresent").style.display = "none";
				} else {
					getId("audioPresent").style.display = "block";
				}
			}
		}
	});
}

// Video download event
getId("videoDownload").addEventListener("click", (event) => {
	checkMaxDownloads();
	hideHidden();
	console.log(`Current:${currentDownloads} Max:${maxActiveDownloads}`);

	if (currentDownloads < maxActiveDownloads) {
		manageAdvanced(duration);
		download("video");
		currentDownloads++;
	} else {
		// Handling active downloads for video
		manageAdvanced(duration);
		const range1 = rangeOption;
		const range2 = rangeCmd;
		const subs1 = subs;
		const subs2 = subLangs;
		const url1 = getId("url").value;
		const thumb1 = thumbnail;
		const title1 = title;

		const randId = Math.random().toFixed(10).toString().slice(2);
		const item = `
		<div class="item" id="${randId}">
			<div class="itemIconBox">
			<img src="${
				thumbnail || "../assets/images/thumb.png"
			}" alt="No thumbnail" class="itemIcon" crossorigin="anonymous">
			<span class="itemType">${i18n.__("Video")}</span>
			</div>
			<div class="itemBody">
				<div class="itemTitle">${title}</div>
				<p>${i18n.__("Download pending")}</p>
			</div>
		</div>
		`;
		getId("list").innerHTML += item;
		const interval = setInterval(() => {
			if (currentDownloads < maxActiveDownloads) {
				getId(randId).remove();
				download(
					"video",
					url1,
					range1,
					range2,
					subs1,
					subs2,
					thumb1,
					title1
				);
				currentDownloads++;
				clearInterval(interval);
			}
		}, 2000);
	}
});

// Audio download event
getId("audioDownload").addEventListener("click", (event) => {
	checkMaxDownloads();
	hideHidden();
	console.log(`Current:${currentDownloads} Max:${maxActiveDownloads}`);

	if (currentDownloads < maxActiveDownloads) {
		manageAdvanced(duration);
		download("audio");
		currentDownloads++;
	} else {
		// Handling active downloads for audio
		manageAdvanced(duration);
		const range1 = rangeOption;
		const range2 = rangeCmd;
		const subs1 = subs;
		const subs2 = subLangs;
		const url1 = getId("url").value;
		const thumb1 = thumbnail;
		const title1 = title;

		const randId = Math.random().toFixed(10).toString().slice(2);

		const item = `
		
		<div class="item" id="${randId}">
			<div class="itemIconBox">
			<img src="${thumbnail}" alt="No thumbnail" class="itemIcon" crossorigin="anonymous">
			<span class="itemType">${i18n.__("Audio")}</span>
			</div>
			<div class="itemBody">
				<div class="itemTitle">${title}</div>
				<p>${i18n.__("Download pending")}</p>
			</div>
		</div>
		`;
		getId("list").innerHTML += item;
		const interval = setInterval(() => {
			if (currentDownloads < maxActiveDownloads) {
				getId(randId).remove();
				download(
					"audio",
					url1,
					range1,
					range2,
					subs1,
					subs2,
					thumb1,
					title1
				);
				currentDownloads++;
				clearInterval(interval);
			}
		}, 2000);
	}
});

getId("extractBtn").addEventListener("click", () => {
	checkMaxDownloads();
	hideHidden();

	console.log(`Current:${currentDownloads} Max:${maxActiveDownloads}`);

	if (currentDownloads < maxActiveDownloads) {
		manageAdvanced(duration);
		download("extract");
		currentDownloads++;
	} else {
		manageAdvanced(duration);
		const range1 = rangeOption;
		const range2 = rangeCmd;
		const subs1 = subs;
		const subs2 = subLangs;
		const url1 = getId("url").value;
		const randId = Math.random().toFixed(10).toString().slice(2);
		const thumb1 = thumbnail;
		const title1 = title;
		const extractFormat = getId("extractSelection").value;
		const extractQuality = getId("extractQualitySelect").value;

		const item = `
		<div class="item" id="${randId}">
			<div class="itemIconBox">
			<img src="${thumbnail}" alt="No thumbnail" class="itemIcon" crossorigin="anonymous">
			<span class="itemType">${i18n.__("Audio")}</span>
		</div>
			<div class="itemBody">
				<div class="itemTitle">${title}</div>
				<p>${i18n.__("Download pending")}</p>
			</div>
		</div>
		`;
		getId("list").innerHTML += item;
		const interval = setInterval(() => {
			if (currentDownloads < maxActiveDownloads) {
				getId(randId).remove();
				download(
					"extract",
					url1,
					range1,
					range2,
					subs1,
					subs2,
					thumb1,
					title1,
					extractFormat,
					extractQuality
				);
				currentDownloads++;
				clearInterval(interval);
			}
		}, 2000);
	}
});

// Time formatting

function timeFormat(duration) {
	// Hours, minutes and seconds
	var hrs = ~~(duration / 3600);
	var mins = ~~((duration % 3600) / 60);
	var secs = ~~duration % 60;
	// Output like "1:01" or "4:03:59" or "123:03:59"
	var ret = "";
	if (hrs > 0) {
		ret += "" + hrs + ":" + (mins < 10 ? "0" : "");
	}
	ret += "" + mins + ":" + (secs < 10 ? "0" : "");
	ret += "" + secs;
	return ret;
}

// Manage advanced options, needs to be called

function manageAdvanced(duration) {
	let startTime = getId("startTime").value;
	let endTime = getId("endTime").value;

	if (startTime && !endTime) {
		rangeCmd = `*${startTime}-${timeFormat(duration)}`;
		rangeOption = "--download-sections";
	} else if (!startTime && endTime) {
		rangeCmd = `*0-${endTime}`;
		rangeOption = "--download-sections";
	} else if (startTime && endTime) {
		rangeCmd = `*${startTime}-${endTime}`;
		rangeOption = "--download-sections";
	} else {
		rangeOption = "";
		rangeCmd = "";
	}

	// If subtitles are checked
	if (getId("subChecked").checked) {
		subs = "--write-subs";
		subLangs = "--sub-langs all";
	} else {
		subs = "";
		subLangs = "";
	}

	console.log("Range option: " + rangeOption);
	console.log("rangeCmd:" + rangeCmd);
}
//////////////////////////////
// Downloading with yt-dlp
//////////////////////////////

function download(
	type,
	url1 = "",
	range1 = "",
	range2 = "",
	subs1 = "",
	subs2 = "",
	thumb1 = "",
	title1 = "",
	extractFormat = "",
	extractQuality = ""
) {
	// Config file
	const newTitle = title1 || title;

	if (localStorage.getItem("configPath")) {
		configArg = "--config-location";
		configTxt = `"${localStorage.getItem("configPath")}"`;
	}

	const url = url1 || getId("url").value;
	console.log("URL", url);
	let ext, extractExt, extractFormat1, extractQuality1, audioForVideoExt;

	/**@type {string}*/
	let format_id, audioForVideoFormat_id;
	const randomId = "a" + Math.random().toFixed(10).toString().slice(2);

	// Whether to close app
	let quit = Boolean(getId("quitChecked").checked);

	if (type === "video") {
		const videoValue = getId("videoFormatSelect").value;
		/**@type {string} */
		const audioForVideoValue = getId("audioForVideoFormatSelect").value;

		format_id = videoValue.split("|")[0];
		const videoExt = videoValue.split("|")[1];

		if (videoValue.split("|")[2] != "NO") {
			preferredVideoQuality = Number(videoValue.split("|")[2]);
		}

		audioForVideoFormat_id = audioForVideoValue.split("|")[0];

		if (audioForVideoValue.split("|")[1] === "webm") {
			audioForVideoExt = "opus";
		} else {
			audioForVideoExt = audioForVideoValue.split("|")[1];
		}

		if (
			(videoExt === "mp4" && audioForVideoExt === "opus") ||
			(videoExt === "webm" &&
				(audioForVideoExt === "m4a" || audioForVideoExt === "mp4"))
		) {
			ext = "mkv";
		} else {
			ext = videoExt;
		}
	} else if (type === "audio") {
		format_id = getId("audioFormatSelect").value.split("|")[0];
		if (getId("audioFormatSelect").value.split("|")[1] === "webm") {
			ext = "opus";
		} else {
			ext = getId("audioFormatSelect").value.split("|")[1];
		}
	}
	console.log("Download extension:", ext);

	const newItem = `
		<div class="item" id="${randomId}">
		<div class="itemIconBox">
			<img src="${
				thumb1 || thumbnail || "../assets/images/thumb.png"
			}" alt="No thumbnail" class="itemIcon" crossorigin="anonymous">
			<span class="itemType">${
				type === "video" ? i18n.__("Video") : i18n.__("Audio")
			}</span>
		</div>
		<img src="../assets/images/close.png" onClick="fadeItem('${randomId}')" class="itemClose"}" id="${
		randomId + ".close"
	}">


		<div class="itemBody">
			<div class="itemTitle">${newTitle}</div>
			<strong class="itemSpeed" id="${randomId + "speed"}"></strong>
			<div id="${randomId + "prog"}" class="itemProgress"></div>
		</div>
	</div>
	`;
	getId("list").innerHTML += newItem;
	getId("loadingWrapper").style.display = "none";
	getId(randomId + "prog").textContent = i18n.__("Preparing...");

	getId(randomId + ".close").addEventListener("click", () => {
		if (getId(randomId)) {
			removeFromDownloadedList(randomId);
			fadeItem(randomId);
		}
	});

	let downloadProcess;
	let filename = "";

	// Filtering characters for Unix platforms
	let pattern = ["/", '"', "`", "#"];

	if (os.platform() === "win32") {
		pattern = [
			"[",
			"]",
			"*",
			"<",
			">",
			"|",
			"\\",
			"/",
			"?",
			'"',
			"`",
			"#",
			"：",
			":",
		];
	}

	// Trying to remove ambiguous characters
	for (let i = 0; i < newTitle.length; i++) {
		let letter = "";
		if (pattern.includes(newTitle[i])) {
			letter = "";
		} else {
			letter = newTitle[i];
		}
		filename += letter;
	}
	filename = filename.slice(0, 100);
	if (filename[0] === ".") {
		filename = filename.slice(1, 100);
	}

	// Adding info about trimmed range to filename
	if (range2 || rangeCmd) {
		let rangeTxt = (range2 || rangeCmd).replace("*", "");
		if (os.platform() === "win32") {
			rangeTxt = rangeTxt.replaceAll(":", "_");
			console.log({rangeTxt});
		}
		filename += `[${rangeTxt}]`;
	}
	console.log("Filename:", filename);

	/**@type {string} */
	let audioFormat = "+ba";

	if (audioForVideoFormat_id === "auto") {
		if (ext === "mp4") {
			if (!(audioExtensionList.length == 0)) {
				if (audioExtensionList.includes("m4a")) {
					audioFormat = "+m4a";
				}
			} else {
				audioFormat = "";
			}
		}
	} else if (audioForVideoFormat_id === "none") {
		audioFormat = "";
	} else {
		audioFormat = `+${audioForVideoFormat_id}`;
	}

	const controller = new AbortController();
	controllers[randomId] = controller;

	console.log(rangeOption + " " + rangeCmd);
	console.log(`-f ${format_id}${audioFormat}`);

	if (type === "video" && onlyVideo) {
		// If video has no sound, audio needs to be downloaded
		console.log("Downloading both video and audio");

		const cleanFfmpegPathWin = path.join(__dirname, "..", "ffmpeg.exe");

		const args = [
			range1 || rangeOption,
			range2 || rangeCmd,
			"-f",
			`${format_id}${audioFormat}`,
			"-o",
			`"${path.join(downloadDir, filename + `.${ext}`)}"`,
			"--ffmpeg-location",
			ffmpeg,
			// Fix for windows media player
			os.platform() == "win32" && audioFormat == "" && ext == "mp4"
				? `--exec "\\"${cleanFfmpegPathWin}\\" -y -i {} -c copy -movflags +faststart -brand isom {}.fixed.mp4 && move /Y {}.fixed.mp4 {}"`
				: "",
			subs1 || subs,
			subs2 || subLangs,
			"--no-playlist",
			"--embed-chapters",
			// "--embed-metadata",
			ext == "mp4" &&
			audioForVideoExt === "m4a" &&
			extractor_key === "Youtube" &&
			os.platform() !== "darwin"
				? "--embed-thumbnail"
				: "",
			configArg,
			configTxt,
			cookieArg,
			browser,
			"--no-mtime",
			proxy ? "--no-check-certificate" : "",
			proxy ? "--proxy" : "",
			proxy,
			`"${url}"`,
		].filter((item) => item);

		downloadProcess = ytDlp.exec(
			args,
			{shell: true, detached: false},
			controller.signal
		);
	} else if (type === "extract") {
		if (extractFormat == "alac") {
			extractExt = "m4a";
		} else if (extractFormat == "vorbis") {
			extractExt = "ogg";
		} else {
			extractExt = extractFormat || getId("extractSelection").value;
		}
		extractFormat1 = extractFormat || getId("extractSelection").value;
		extractQuality1 = extractQuality || getId("extractQualitySelect").value;

		console.log(extractFormat1);
		console.log(extractQuality1);

		const args = [
			"-x",
			"--audio-format",
			extractFormat1,
			"--audio-quality",
			extractQuality1,
			"-o",
			`"${path.join(downloadDir, filename + `.${extractExt}`)}"`,
			"--ffmpeg-location",
			ffmpeg,
			"--embed-chapters",
			"--no-playlist",
			// "--embed-metadata",
			(extractFormat1 == "m4a" || extractFormat1 == "mp3") &&
			extractor_key === "Youtube" &&
			os.platform() !== "darwin"
				? "--embed-thumbnail"
				: "",
			cookieArg,
			browser,
			configArg,
			configTxt,
			"--no-mtime",
			proxy ? "--no-check-certificate" : "",
			proxy ? "--proxy" : "",
			proxy,
			`"${url}"`,
		].filter((item) => item);

		downloadProcess = ytDlp.exec(
			args,
			{shell: true, detached: false},
			controller.signal
		);
	}
	// If downloading only audio or video with audio
	else {
		console.log("downloading only audio or video with audio");

		const args = [
			range1 || rangeOption,
			range2 || rangeCmd,
			"-f",
			format_id,
			"-o",
			`"${path.join(downloadDir, filename + `.${ext}`)}"`,
			"--ffmpeg-location",
			ffmpeg,
			subs1 || subs,
			subs2 || subLangs,
			"--no-playlist",
			"--embed-chapters",
			// "--embed-metadata",
			(ext == "m4a" || ext == "mp4") &&
			extractor_key === "Youtube" &&
			os.platform() !== "darwin"
				? "--embed-thumbnail"
				: "",
			cookieArg,
			browser,
			configArg,
			configTxt,
			"--no-mtime",
			proxy ? "--no-check-certificate" : "",
			proxy ? "--proxy" : "",
			proxy,
			`"${url}"`,
		].filter((item) => item);

		downloadProcess = ytDlp.exec(
			args,
			{shell: true, detached: false},
			controller.signal
		);
	}

	console.log(
		"Spawn args:" +
			downloadProcess.ytDlpProcess.spawnargs[
				downloadProcess.ytDlpProcess.spawnargs.length - 1
			]
	);

	getId(randomId + ".close").addEventListener("click", () => {
		controller.abort();
		try {
			process.kill(downloadProcess.ytDlpProcess.pid, "SIGINT");
		} catch (_error) {}
	});

	downloadProcess
		.on("progress", (progress) => {
			if (progress.percent == 100) {
				getId(randomId + "speed").textContent = "";
				getId(randomId + "prog").textContent =
					i18n.__("Processing") + "...";

				ipcRenderer.send("progress", 0);
			} else {
				getId(randomId + "speed").textContent = `${i18n.__("Speed")}: ${
					progress.currentSpeed || 0
				}`;
				ipcRenderer.send("progress", progress.percent);

				getId(
					randomId + "prog"
				).innerHTML = `<progress class="progressBar" min=0 max=100 value=${progress.percent}>`;

				ipcRenderer.send("progress", progress.percent / 100);
			}
		})
		.once("ytDlpEvent", (_eventType, _eventData) => {
			getId(randomId + "prog").textContent = i18n.__("Downloading...");
		})
		.once("close", (code) => {
			getId(randomId + "speed").textContent = "";
			addToDownloadedList(randomId);
			currentDownloads--;
			console.log("Closed with code " + code);
			if (code == 0) {
				// If extration is done
				if (type === "extract") {
					console.log(
						path.join(downloadDir, filename + `.${extractFormat1}`)
					);

					afterSave(
						downloadDir,
						filename + `.${extractExt}`,
						randomId + "prog",
						thumb1 || thumbnail,
						{ type: 'extract', originalFilename: filename, url: url }
					);
				}
				// If download is done
				else {
					console.log(path.join(downloadDir, filename + `.${ext}`));
					afterSave(
						downloadDir,
						filename + `.${ext}`,
						randomId + "prog",
						thumb1 || thumbnail,
						{ type: 'download', filename: filename, ext: ext, url: url }
					);
				}
			}
			if (quit) {
				console.log("Quitting app");
				quitApp();
			}
		})
		.once("error", (error) => {
			currentDownloads--;
			getId(randomId + "prog").textContent = i18n.__(
				"Some error has occurred. Hover to see details"
			);
			getId(randomId + "prog").title = error.message;
			console.log(error.message);
		});
}

function quitApp() {
	ipcRenderer.send("quit", "quit");
}

// Removing item

function fadeItem(id) {
	controllers[id].abort();
	getId(id).classList.add("scale");
	setTimeout(() => {
		if (getId(id)) {
			getId(id).remove();
		}
	}, 500);
}

function clearAllDownloaded() {
	downloadedItemList.forEach((item) => {
		fadeItem(item);
	});
	downloadedItemList = [];
	hideClearBtn();
}

function addToDownloadedList(id) {
	downloadedItemList.push(id);

	if (downloadedItemList.length > 1) {
		getId("clearBtn").style.display = "inline-block";
	}
}

function removeFromDownloadedList(id) {
	downloadedItemList.splice(downloadedItemList.indexOf(id), 1);

	if (downloadedItemList.length < 2) {
		hideClearBtn();
	}
}

function hideClearBtn() {
	getId("clearBtn").style.display = "none";
}
// After saving video

function afterSave(location, filename, progressId, thumbnail, downloadInfo = null) {
	const notify = new Notification("ytDownloader", {
		body: filename,
		icon: thumbnail,
	});

	notify.onclick = () => {
		showItem(finalLocation, finalFilename);
	};

	let finalLocation = location;
	let finalFilename = filename;
	if (os.platform() === "win32") {
		finalLocation = location.split(path.sep).join("\\\\");
		finalFilename = filename.split(path.sep).join("\\\\");
	}
	const fileSavedElement = document.createElement("b");
	fileSavedElement.textContent = i18n.__("File saved. Click to Open");
	fileSavedElement.onclick = () => {
		showItem(finalLocation, finalFilename);
	};

	getId(progressId).innerHTML = "";
	getId(progressId).appendChild(fileSavedElement);

	// Handle post-download actions
	handlePostDownloadAction(location, filename, progressId, downloadInfo);

	window.scrollTo(0, document.body.scrollHeight);
}

// Handle post-download actions (extract audio or transcribe)
function handlePostDownloadAction(location, filename, progressId, downloadInfo) {
	switch (postActionState.selected) {
		case 'extract':
			performAudioExtraction(location, filename, progressId);
			break;
		case 'transcribe':
			performTranscription(location, filename, progressId, downloadInfo);
			break;
		case 'none':
		default:
			// No action needed
			break;
	}
}

// Perform audio extraction
function performAudioExtraction(location, filename, progressId) {
	const progressElement = getId(progressId);
	if (!progressElement) return;

	progressElement.innerHTML = `<div style="color: var(--blueBtn);">${i18n.__("Extracting audio")}...</div>`;

	// Get the selected extraction format and quality
	const extractFormat = getId("extractSelection")?.value || "mp3";
	const extractQuality = getId("extractQualitySelect")?.value || "5";

	// Send extraction request to main process
	ipcRenderer.invoke('extract-audio', {
		inputFile: path.join(location, filename),
		outputDir: location,
		format: extractFormat,
		quality: extractQuality
	}).then(() => {
		progressElement.innerHTML = `<div style="color: var(--greenBtn);">${i18n.__("Audio extracted successfully")}</div>`;
	}).catch((error) => {
		progressElement.innerHTML = `<div style="color: var(--redBtn);">${i18n.__("Extraction failed")}: ${error.message}</div>`;
	});
}

// Perform transcription
function performTranscription(location, filename, progressId, downloadInfo) {
	const progressElement = getId(progressId);
	if (!progressElement) return;

	progressElement.innerHTML = `<div style="color: var(--blueBtn);">${i18n.__("Starting transcription")}...</div>`;

	// Send transcription request to main process
	ipcRenderer.invoke('transcribe-audio', {
		filePath: path.join(location, filename),
		progressId,
		options: {
			language: postActionState.transcribeLanguage,
			keepVideo: postActionState.keepVideo
		}
	}).then((result) => {
		if (result.success) {
			progressElement.innerHTML = `<div style="color: var(--greenBtn);">${i18n.__("Transcription completed")}</div>`;
		} else {
			progressElement.innerHTML = `<div style="color: var(--redBtn);">${i18n.__("Transcription failed")}: ${result.error?.message || 'Unknown error'}</div>`;
		}
	}).catch((error) => {
		progressElement.innerHTML = `<div style="color: var(--redBtn);">${i18n.__("Transcription failed")}: ${error.message}</div>`;
	});
}

// async function getSystemProxy(url) {
// 	const proxy = await ipcRenderer.invoke("get-proxy", url);
// 	return proxy;
// }

function showItem(location, filename) {
	shell.showItemInFolder(`${path.join(location, filename)}`);
}

// Rename title

function renameTitle() {
	title = getId("titleName").value;
	console.log(title);
}

// Opening windows
function closeMenu() {
	getId("menuIcon").style.transform = "rotate(0deg)";
	let count = 0;
	let opacity = 1;
	const fade = setInterval(() => {
		if (count >= 10) {
			clearInterval(fade);
			getId("menu").style.display = "none";
		} else {
			opacity -= 0.1;
			getId("menu").style.opacity = String(opacity);
			count++;
		}
	}, 50);
}

function hideHidden() {
	getId("hidden").classList.remove("scaleUp");
	getId("hidden").classList.add("scale");
	setTimeout(() => {
		getId("hidden").style.display = "none";
		getId("hidden").classList.remove("scale");
	}, 400);
}

// Popup message
function showPopup(text) {
	console.log("Triggered showpopup");
	getId("popupText").textContent = text;
	getId("popupText").style.display = "inline-block";
	setTimeout(() => {
		getId("popupText").style.display = "none";
	}, 2200);
}

/**
 *
 * @param {string} item
 * @returns string
 */
function getLocalStorageItem(item) {
	return localStorage.getItem(item) || "";
}

function updateDownloadButtonText() {
	const videoBtn = getId("videoDownload");
	const audioBtn = getId("audioDownload");

	if (!videoBtn || !audioBtn) return;

	switch (postActionState.selected) {
		case 'extract':
			videoBtn.textContent = i18n.__("Download and extract audio");
			audioBtn.textContent = i18n.__("Download and extract audio");
			break;
		case 'transcribe':
			videoBtn.textContent = i18n.__("Download and transcribe text");
			audioBtn.textContent = i18n.__("Download and transcribe text");
			break;
		default:
			videoBtn.textContent = i18n.__("Download");
			audioBtn.textContent = i18n.__("Download");
	}
}

function getId(id) {
	return document.getElementById(id);
}

function downloadPathSelection() {
	let localPath = localStorage.getItem("downloadPath");

	if (localPath) {
		downloadDir = localPath;
		try {
			fs.accessSync(localPath, constants.W_OK);
			downloadDir = localPath;
		} catch (err) {
			console.log(
				"Unable to write to download directory. Switching to default one."
			);
			console.log(err);
			downloadDir = appdir;
			localStorage.setItem("downloadPath", appdir);
		}
	} else {
		downloadDir = appdir;
		localStorage.setItem("downloadPath", appdir);
	}
	getId("path").textContent = downloadDir;
	fs.mkdir(downloadDir, {recursive: true}, () => {});
}

// Menu
getId("preferenceWin").addEventListener("click", () => {
	closeMenu();
	ipcRenderer.send("load-page", __dirname + "/preferences.html");
});

getId("aboutWin").addEventListener("click", () => {
	closeMenu();
	ipcRenderer.send("load-page", __dirname + "/about.html");
});

getId("playlistWin").addEventListener("click", () => {
	closeMenu();
	ipcRenderer.send("load-win", __dirname + "/playlist.html");
});

getId("transcribeWin").addEventListener("click", () => {
	closeMenu();
	ipcRenderer.send("load-win", __dirname + "/transcribe.html");
});
getId("compressorWin").addEventListener("click", () => {
	closeMenu();
	ipcRenderer.send("load-win", __dirname + "/compressor.html");
});
// getId("newPlaylistWin").addEventListener("click", () => {
// 	closeMenu();
// 	ipcRenderer.send("load-win", __dirname + "/playlist_new.html");
// });

ipcRenderer.on("link", (event, text) => {
	pasteFromTray(text);
});

// Selecting download directory
getId("selectLocation").addEventListener("click", () => {
	ipcRenderer.send("select-location-main", "");
});

getId("clearBtn").addEventListener("click", () => {
	clearAllDownloaded();
});

ipcRenderer.on("downloadPath", (event, downloadPath) => {
	console.log(downloadPath);
	getId("path").textContent = downloadPath[0];
	downloadDir = downloadPath[0];
});

// Downloading yt-dlp
async function downloadYtDlp(downloadPath) {
	document.querySelector("#popupBox p").textContent = i18n.__(
		"Please wait, necessary files are being downloaded"
	);
	getId("popupSvg").style.display = "inline";

	// Downloading appropriate version of yt-dlp
	await YTDlpWrap.downloadFromGithub(downloadPath);

	getId("popupBox").style.display = "none";
	ytDlp = new YTDlpWrap(`"${ytDlpPath}"`);
	localStorage.setItem("ytdlp", ytDlpPath);
	console.log("yt-dlp bin Path: " + ytDlpPath);
}

function checkMaxDownloads() {
	if (localStorage.getItem("maxActiveDownloads")) {
		const number = Number(localStorage.getItem("maxActiveDownloads"));
		if (number < 1) {
			maxActiveDownloads = 1;
		} else {
			maxActiveDownloads = number;
		}
	}
}

function defaultVideoToggle() {
	let defaultWindow = "video";
	if (localStorage.getItem("defaultWindow")) {
		defaultWindow = localStorage.getItem("defaultWindow");
	}
	if (defaultWindow == "video") {
		selectVideo();
	} else {
		selectAudio();
	}
}

// Pasting url from clipboard
function pasteUrl() {
	defaultVideoToggle();
	hideHidden();
	getId("loadingWrapper").style.display = "flex";
	getId("incorrectMsg").textContent = "";
	const url = clipboard.readText();
	getInfo(url);
}

function pasteFromTray(url) {
	defaultVideoToggle();
	hideHidden();
	getId("loadingWrapper").style.display = "flex";
	getId("incorrectMsg").textContent = "";
	getInfo(url);
}

function showMacYtdlpPopup() {
	getId("popupBoxMac").style.display = "block";
}

function handleYtDlpError() {
	document.querySelector("#popupBox p").textContent = i18n.__(
		"Failed to download necessary files. Please check your network and try again"
	);
	getId("popupSvg").style.display = "none";
	getId("popup").innerHTML += `<button id="tryBtn">${i18n.__(
		"Try again"
	)}</button>`;

	console.log("Failed to download yt-dlp");

	getId("tryBtn").addEventListener("click", () => {
		getId("popup").removeChild(getId("popup").lastChild);
		downloadYtDlp();
	});
}

function resetDomValues() {
	getId("videoFormatSelect").innerHTML = "";
	getId("audioFormatSelect").innerHTML = "";
	getId(
		"audioForVideoFormatSelect"
	).innerHTML = `<option value="none|none">No Audio</option>`;
	getId("startTime").value = "";
	getId("endTime").value = "";
	getId("errorBtn").style.display = "none";
	getId("errorDetails").style.display = "none";
	getId("errorDetails").textContent = "";
}

function logYtDlpPresent(ytDlpPath) {
	console.log("yt-dlp bin is present");
	console.log(ytDlpPath);
}

function hidePasteBtn() {
	getId("pasteUrl").style.display = "none";
}

function setLocalStorageYtDlp(ytDlpPath) {
	localStorage.setItem("ytdlp", ytDlpPath);
}

// ============================================================================
// 进度展示相关功能
// ============================================================================

/**
 * 创建进度条HTML
 * @param {string} id - 进度条ID
 * @param {string} stage - 当前阶段
 * @param {number} percent - 进度百分比
 * @returns {string} 进度条HTML
 */
function createProgressBar(id, stage, percent = 0) {
	const numericPercent = sanitizePercent(percent) ?? 0;
	const displayPercent = formatPercentText(numericPercent);

	return `
		<div class="progress-container" id="progress-${id}" data-status="active">
			<div class="progress-stage">${stage}</div>
			<div class="progress-bar-wrapper">
				<div class="progress-bar">
					<div class="progress-fill" style="width: ${numericPercent.toFixed(2)}%"></div>
				</div>
				<div class="progress-text">${displayPercent}%</div>
			</div>
			<div class="progress-speed"></div>
			<div class="progress-eta"></div>
		</div>
	`;
}

/**
 * 更新进度条
 * @param {string} id - 进度条ID
 * @param {Object} progress - 进度信息
 */
function updateProgressBar(id, progress) {
	const container = getId(`progress-${id}`);
	if (!container) return;

	container.dataset.status = container.dataset.status || "active";

	const stageElement = container.querySelector(".progress-stage");
	const fillElement = container.querySelector(".progress-fill");
	const textElement = container.querySelector(".progress-text");
	const speedElement = container.querySelector(".progress-speed");
	const etaElement = container.querySelector(".progress-eta");

	if (progress.stage) {
		container.dataset.stage = progress.stage;
		if (stageElement) {
			stageElement.textContent = getStageDisplayName(progress.stage);
			stageElement.style.color = '';
		}
	}

	const percentValue = sanitizePercent(progress.percent);
	if (fillElement && textElement && percentValue !== null) {
		fillElement.style.width = `${percentValue.toFixed(2)}%`;
		const displayPercent = formatPercentText(percentValue);
		textElement.textContent = `${displayPercent}%`;
	}

	if (speedElement) {
		if (progress.speed && progress.speed > 0) {
			speedElement.textContent = `速度: ${formatSpeed(progress.speed)}`;
			speedElement.style.display = "block";
		} else {
			speedElement.textContent = "";
			speedElement.style.display = "none";
		}
	}

	if (etaElement) {
		if (progress.eta && progress.eta > 0) {
			etaElement.textContent = `剩余: ${formatTime(progress.eta)}`;
			etaElement.style.display = "block";
		} else {
			etaElement.textContent = "";
			etaElement.style.display = "none";
		}
	}

	const existingMessageElement = container.querySelector(".progress-message");
	if (progress.message) {
		let messageElement = existingMessageElement;
		if (!messageElement) {
			messageElement = document.createElement("div");
			messageElement.className = "progress-message";
			container.appendChild(messageElement);
		}
		messageElement.textContent = progress.message;
	} else if (existingMessageElement) {
		existingMessageElement.remove();
	}
}

/**
 * 获取阶段显示名称
 * @param {string} stage - 阶段代码
 * @returns {string} 显示名称
 */
function getStageDisplayName(stage) {
	const stageNames = {
		'PENDING': '等待中',
		'DOWNLOADING': '下载中',
		'EXTRACTING': '提取音频中',
		'TRANSCRIBING': '转写中',
		'PACKING': '整理文件中',
		'COMPLETED': '完成',
		'FAILED': '失败',
		'CANCELLED': '已取消'
	};
	return stageNames[stage] || stage;
}

/**
 * 格式化速度显示
 * @param {number} speed - 速度值
 * @returns {string} 格式化后的速度
 */
function formatSpeed(speed) {
	if (speed < 1024) {
		return `${speed.toFixed(1)} B/s`;
	} else if (speed < 1024 * 1024) {
		return `${(speed / 1024).toFixed(1)} KB/s`;
	} else {
		return `${(speed / (1024 * 1024)).toFixed(1)} MB/s`;
	}
}

/**
 * 格式化百分比文本显示
 * @param {number} value - 百分比值
 * @returns {string}
 */
function formatPercentText(value) {
	if (value >= 99.9) {
		return "100";
	}
	if (value <= 0.05) {
		return "0";
	}
	return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

/**
 * 将百分比值规范化到 0-100 之间，无法解析时返回 null
 * @param {number|string|undefined|null} value
 * @returns {number|null}
 */
function sanitizePercent(value) {
	if (value === undefined || value === null) {
		return null;
	}
	const parsed = Number.parseFloat(value);
	if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
		return null;
	}
	return Math.min(100, Math.max(0, parsed));
}

/**
 * 停止并清理指定进度条的动画状态
 * @param {string} id - 进度条ID
 */
function clearProgressAnimation(id) {
	const state = progressAnimations.get(id);
	if (!state) return;
	if (state.rafId !== null) {
		cancelAnimationFrameSafe(state.rafId);
	}
	progressAnimations.delete(id);
}

/**
 * 平滑更新进度条，减少跳动
 * @param {string} id - 进度条ID
 * @param {Object} progress - 进度信息
 */
function smoothProgressUpdate(id, progress) {
	const targetPercent = sanitizePercent(progress.percent);

	if (targetPercent === null) {
		// 无百分比信息时直接刷新其他字段
		updateProgressBar(id, progress);
		return;
	}

	let state = progressAnimations.get(id);

	if (!state) {
		state = {
			current: targetPercent,
			target: targetPercent,
			meta: { ...progress, percent: targetPercent },
			rafId: null
		};
		progressAnimations.set(id, state);
		updateProgressBar(id, state.meta);
		return;
	}

	const previousStage = state.meta?.stage;
	const nextStage = progress.stage ?? previousStage;
	state.target = targetPercent;
	state.meta = { ...progress, stage: nextStage, percent: state.current };

	const stageChanged = previousStage && nextStage && previousStage !== nextStage;

	if (stageChanged) {
		if (state.rafId !== null) {
			cancelAnimationFrameSafe(state.rafId);
			state.rafId = null;
		}
		state.current = targetPercent;
		state.target = targetPercent;
		state.meta.percent = targetPercent;
		updateProgressBar(id, state.meta);
		return;
	}

	// 若当前已经接近目标，直接更新即可
	if (Math.abs(state.current - state.target) <= 0.1 && state.rafId === null) {
		state.current = state.target;
		state.meta.percent = state.current;
		updateProgressBar(id, state.meta);
		return;
	}

	// 如果动画正在进行，先更新显示其它字段，等待下一帧继续动画
	if (state.rafId !== null) {
		updateProgressBar(id, { ...state.meta, percent: state.current });
		return;
	}

	const step = () => {
		state.rafId = null;
		const diff = state.target - state.current;

		if (Math.abs(diff) <= 0.1) {
			state.current = state.target;
			state.meta.percent = state.current;
			updateProgressBar(id, state.meta);
			return;
		}

		state.current += diff * 0.25;
		state.meta.percent = state.current;
		updateProgressBar(id, state.meta);
		state.rafId = requestAnimationFrameSafe(step);
	};

	state.rafId = requestAnimationFrameSafe(step);
}

/**
 * 格式化时间显示
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间
 */
function formatTime(seconds) {
	if (seconds < 60) {
		return `${Math.round(seconds)}秒`;
	} else if (seconds < 3600) {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = Math.round(seconds % 60);
		return `${minutes}分${remainingSeconds}秒`;
	} else {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		return `${hours}小时${minutes}分`;
	}
}

/**
 * 完成进度显示
 * @param {string} id - 进度条ID
 * @param {string} message - 完成消息
 * @param {boolean} success - 是否成功
 */
function completeProgressBar(id, message, success = true) {
	const container = getId(`progress-${id}`);
	if (!container) return;

	clearProgressAnimation(id);

	const progressElement = container.querySelector('.progress-bar-wrapper');
	const stageElement = container.querySelector('.progress-stage');

	if (progressElement) {
		progressElement.style.display = 'none';
	}

	if (stageElement) {
		stageElement.textContent = message;
		stageElement.style.color = success ? 'var(--greenBtn)' : 'var(--redBtn)';
	}

	container.dataset.status = success ? 'completed' : 'failed';
	container.dataset.stage = success ? 'COMPLETED' : 'FAILED';

	// 移除速度和ETA显示
	const speedElement = container.querySelector('.progress-speed');
	const etaElement = container.querySelector('.progress-eta');
	if (speedElement) speedElement.style.display = 'none';
	if (etaElement) etaElement.style.display = 'none';

	const messageElement = container.querySelector('.progress-message');
	if (messageElement) {
		messageElement.remove();
	}
}

/**
 * 移除进度条
 * @param {string} id - 进度条ID
 */
function removeProgressBar(id) {
	const container = getId(`progress-${id}`);
	if (container) {
		clearProgressAnimation(id);
		container.remove();
	}
}

// ============================================================================
// IPC 事件监听器
// ============================================================================

// 监听作业进度事件
ipcRenderer.on('job:progress', (event, data) => {
	console.log('收到作业进度:', data);

	const { jobId, stage, percent, message, speed, eta } = data;

	// 查找对应的下载项
	const downloadItems = document.querySelectorAll('#list .item');
	let targetItem = null;
	let progressId = null;

	for (const item of downloadItems) {
		// 优先匹配 jobId
		if (item.dataset.jobId === jobId) {
			targetItem = item;
			progressId = `job-${jobId}`;
			break;
		}
		// 兜底：如果没有 jobId，尝试匹配 transcribeJobId（兼容转写任务）
		else if (item.dataset.transcribeJobId === jobId) {
			targetItem = item;
			progressId = `transcribe-${jobId}`;
			break;
		}
	}

	if (!targetItem) return;

	// 查找或创建进度条容器
	let progressContainer = targetItem.querySelector('.download-progress');
	if (!progressContainer) {
		progressContainer = document.createElement('div');
		progressContainer.className = 'download-progress';
		targetItem.appendChild(progressContainer);
	}

	// 更新或创建进度条
	let progressBar = progressContainer.querySelector('.progress-container');
	const progressPayload = {
		stage,
		percent,
		message,
		speed,
		eta
	};

	if (!progressBar) {
		const initialPercent = sanitizePercent(percent) ?? 0;
		progressContainer.innerHTML = createProgressBar(progressId, getStageDisplayName(stage), initialPercent);
	}

	smoothProgressUpdate(progressId, progressPayload);
});

// 监听作业状态变更事件
ipcRenderer.on('job:status', (event, data) => {
	console.log('收到作业状态变更:', data);

	const { jobId, status, stage } = data;
	const progressId = `job-${jobId}`;

	if (status === 'COMPLETED') {
		completeProgressBar(progressId, '✅ 下载完成', true);
	} else if (status === 'FAILED') {
		completeProgressBar(progressId, '❌ 下载失败', false);
	} else if (status === 'CANCELLED') {
		completeProgressBar(progressId, '⏹️ 已取消', false);
	}
});

// 监听作业结果事件
ipcRenderer.on('job:result', (event, data) => {
	console.log('收到作业结果:', data);

	const { jobId, status, stage, result } = data;
	const progressId = `job-${jobId}`;

	if (status === 'completed') {
		let message = '✅ 完成';

		if (stage === 'TRANSCRIBING') {
			message = result.transcriptPath ?
				'✅ 转写完成' :
				'✅ 下载和转写完成';
		} else if (stage === 'EXTRACTING') {
			message = '✅ 音频提取完成';
		} else {
			message = '✅ 下载完成';
		}

		completeProgressBar(progressId, message, true);

		// 如果有转写结果，添加复制文本按钮
		if (result.transcriptPath) {
			addTranscriptResult(jobId, result.transcriptPath);
		}
	} else {
		completeProgressBar(progressId, `❌ ${stage}失败`, false);
	}
});

// 监听转写进度事件（旧版本兼容）
ipcRenderer.on('transcribe:progress', (event, data) => {
	console.log('收到转写进度:', data);

	const { jobId, progress } = data;
	const progressId = `transcribe-${jobId}`;

	// 查找对应的下载项
	const downloadItems = document.querySelectorAll('#list .item');
	let targetItem = null;

	for (const item of downloadItems) {
		if (item.dataset.transcribeJobId === jobId) {
			targetItem = item;
			break;
		}
	}

	if (!targetItem) return;

	// 查找或创建进度条容器
	let progressContainer = targetItem.querySelector('.download-progress');
	if (!progressContainer) {
		progressContainer = document.createElement('div');
		progressContainer.className = 'download-progress';
		targetItem.appendChild(progressContainer);
	}

	// 更新或创建进度条
	let progressBar = progressContainer.querySelector('.progress-container');
	const progressPayload = {
		stage: 'TRANSCRIBING',
		percent: progress.percent,
		message: progress.message
	};

	if (!progressBar) {
		const initialPercent = sanitizePercent(progress.percent) ?? 0;
		progressContainer.innerHTML = createProgressBar(progressId, '转写中', initialPercent);
	}

	smoothProgressUpdate(progressId, progressPayload);
});

// 监听转写开始事件
ipcRenderer.on('transcribe:start', (event, data) => {
	console.log('转写开始:', data);

	const { jobId, filePath, progressId } = data;

	let targetItem = null;

	// 优先根据 progressId 在 DOM 中快速定位
	if (progressId) {
		const progressElement = document.getElementById(progressId);
		if (progressElement) {
			targetItem = progressElement.closest('.item');
		}
	}

	// 兼容旧逻辑：若 progressId 未找到节点，则回退到文件路径匹配
	if (!targetItem && filePath) {
		const downloadItems = document.querySelectorAll('#list .item');
		for (const item of downloadItems) {
			const locationElement = item.querySelector('.location');
			const titleElement = item.querySelector('.title');
			const itemFilePath = locationElement?.textContent || '';
			const itemFileName = titleElement?.textContent || '';

			if (itemFilePath === filePath ||
				itemFilePath.includes(path.basename(filePath)) ||
				itemFileName === path.basename(filePath)) {
				targetItem = item;
				break;
			}
		}
	}

	if (!targetItem) {
		console.warn('未能找到与转写作业关联的下载项', { jobId, filePath, progressId });
		return;
	}

	targetItem.dataset.jobId = jobId;
	targetItem.dataset.transcribeJobId = jobId;
	console.log(`已绑定 jobId ${jobId} 到下载项:`, targetItem);
});

/**
 * 添加转写结果显示
 * @param {string} jobId - 作业ID
 * @param {string} transcriptPath - 转写文件路径
 */
function addTranscriptResult(jobId, transcriptPath) {
	const downloadItems = document.querySelectorAll('#list .item');
	let targetItem = null;

	for (const item of downloadItems) {
		if (item.dataset.jobId === jobId) {
			targetItem = item;
			break;
		}
	}

	if (!targetItem) return;

	// 创建转写结果显示区域
	let transcriptContainer = targetItem.querySelector('.transcript-result');
	if (!transcriptContainer) {
		transcriptContainer = document.createElement('div');
		transcriptContainer.className = 'transcript-result';
		targetItem.appendChild(transcriptContainer);
	}

	transcriptContainer.innerHTML = `
		<div class="transcript-header">
			<span>📝 转写结果</span>
			<button class="copy-transcript-btn" data-path="${transcriptPath}">复制文本</button>
			<button class="open-transcript-btn" data-path="${transcriptPath}">打开文件</button>
		</div>
		<div class="transcript-preview">点击复制文本按钮查看内容</div>
	`;

	// 绑定事件
	const copyBtn = transcriptContainer.querySelector('.copy-transcript-btn');
	const openBtn = transcriptContainer.querySelector('.open-transcript-btn');
	const preview = transcriptContainer.querySelector('.transcript-preview');

	copyBtn.addEventListener('click', async () => {
		try {
			const result = await ipcRenderer.invoke('read-file', transcriptPath);
			await navigator.clipboard.writeText(result);
			preview.textContent = '✅ 文本已复制到剪贴板';
			setTimeout(() => {
				preview.textContent = result.substring(0, 200) + (result.length > 200 ? '...' : '');
			}, 2000);
		} catch (error) {
			preview.textContent = '❌ 复制失败: ' + error.message;
		}
	});

	openBtn.addEventListener('click', () => {
		ipcRenderer.invoke('show-item', transcriptPath);
	});
}
