const videoToggle = getId("videoToggle");
const audioToggle = getId("audioToggle");
const incorrectMsg = getId("incorrectMsg");
const loadingMsg = getId("loadingWrapper");
const keepMediaLabel = getId("keepVideoText");

function getId(id) {
	return document.getElementById(id);
}

function updateKeepMediaLabel(type) {
	if (!keepMediaLabel) {
		return;
	}

	const translator =
		typeof window !== "undefined" && window.i18n && typeof window.i18n.__ === "function"
			? window.i18n
			: null;

	const key = type === "audio" ? "Keep audio file" : "Keep video file";
	const text = translator ? translator.__(key) : key;

	keepMediaLabel.textContent = text;
}

// Video and audio toggle

videoToggle.addEventListener("click", (event) => {
	selectVideo()
});

audioToggle.addEventListener("click", (event) => {
	selectAudio()
});

/////////////
function selectVideo(){
	localStorage.setItem("defaultWindow", "video")
	videoToggle.style.backgroundColor = "var(--box-toggleOn)";
	audioToggle.style.backgroundColor = "var(--box-toggle)";
	getId("audioList").style.display = "none";
	getId("audioExtract").style.display = "none";
	getId("videoList").style.display = "block";
	updateKeepMediaLabel("video");
}

function selectAudio(){
	localStorage.setItem("defaultWindow", "audio")
	audioToggle.style.backgroundColor = "var(--box-toggleOn)";
	videoToggle.style.backgroundColor = "var(--box-toggle)";
	getId("videoList").style.display = "none";
	getId("audioList").style.display = "block";
	getId("audioExtract").style.display = "block";
	updateKeepMediaLabel("audio");
}
