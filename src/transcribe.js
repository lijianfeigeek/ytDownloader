/**
 * 离线转写功能前端逻辑
 * 负责与主进程进行 IPC 通信，管理作业创建、状态更新和日志显示
 */

const { ipcRenderer } = require('electron');
const path = require('path');

// 作业状态枚举（与后端保持一致）
const JobStatus = {
    PENDING: 'PENDING',
    DOWNLOADING: 'DOWNLOADING',
    EXTRACTING: 'EXTRACTING',
    TRANSCRIBING: 'TRANSCRIBING',
    PACKING: 'PACKING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED'
};

// 全局状态
let jobs = new Map(); // 存储作业信息
let logs = []; // 存储日志消息
let isLogPanelVisible = false;

// DOM 元素
const elements = {
    jobForm: null,
    urlInput: null,
    outputDirInput: null,
    languageSelect: null,
    keepVideoCheckbox: null,
    submitJobBtn: null,
    checkDepsBtn: null,
    jobList: null,
    jobLog: null,
    logPanel: null,
    toggleLogsBtn: null,
    clearLogsBtn: null,
    noJobsMessage: null,
    depsStatus: null,
    depsList: null,
    depsModal: null,
    depsResultsList: null,
    depsCheckTime: null,
    depsRecommendationsContent: null,
    closeDepsModal: null,
    closeDepsModalBtn: null,
    runSetupOfflineBtn: null,
    errorToast: null,
    successToast: null
};

/**
 * 获取DOM元素的辅助函数
 */
function getId(id) {
    return document.getElementById(id);
}

/**
 * 初始化 DOM 元素引用
 */
function initializeElements() {
    elements.jobForm = getId('job-form');
    elements.urlInput = getId('url-input');
    elements.outputDirInput = getId('output-dir-input');
    elements.languageSelect = getId('language-select');
    elements.keepVideoCheckbox = getId('keep-video-checkbox');
    elements.submitJobBtn = getId('submit-job-btn');
    elements.checkDepsBtn = getId('check-deps-btn');
    elements.jobList = getId('job-list');
    elements.jobLog = getId('job-log');
    elements.logPanel = getId('log-panel');
    elements.toggleLogsBtn = getId('toggle-logs-btn');
    elements.clearLogsBtn = getId('clear-logs-btn');
    elements.noJobsMessage = getId('no-jobs-message');
    elements.depsStatus = getId('deps-status');
    elements.depsList = getId('deps-list');
    elements.depsModal = getId('deps-modal');
    elements.depsResultsList = getId('deps-results-list');
    elements.depsCheckTime = getId('deps-check-time');
    elements.depsRecommendationsContent = getId('deps-recommendations-content');
    elements.closeDepsModal = getId('close-deps-modal');
    elements.closeDepsModalBtn = getId('close-deps-modal-btn');
    elements.runSetupOfflineBtn = getId('run-setup-offline-btn');
    elements.errorToast = getId('error-toast');
    elements.successToast = getId('success-toast');
}

/**
 * 显示提示消息
 */
function showToast(message, type = 'error') {
    const toast = type === 'error' ? elements.errorToast : elements.successToast;
    toast.textContent = message;
    toast.style.display = 'block';

    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

/**
 * 添加日志消息
 */
function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    logs.push(logEntry);

    // 保持日志数量在合理范围内
    if (logs.length > 1000) {
        logs = logs.slice(-500);
    }

    // 如果日志面板可见，更新显示
    if (isLogPanelVisible) {
        updateLogDisplay();
    }
}

/**
 * 更新日志显示
 */
function updateLogDisplay() {
    if (elements.jobLog) {
        elements.jobLog.textContent = logs.join('\n');
        elements.jobLog.scrollTop = elements.jobLog.scrollHeight;
    }
}

/**
 * 获取状态的显示文本
 */
function getStatusText(status) {
    const statusMap = {
        [JobStatus.PENDING]: '等待中',
        [JobStatus.DOWNLOADING]: '下载中',
        [JobStatus.EXTRACTING]: '提取音频',
        [JobStatus.TRANSCRIBING]: '转写中',
        [JobStatus.PACKING]: '打包中',
        [JobStatus.COMPLETED]: '已完成',
        [JobStatus.FAILED]: '失败',
        [JobStatus.CANCELLED]: '已取消'
    };
    return statusMap[status] || status;
}

/**
 * 获取状态的 CSS 类
 */
function getStatusClass(status) {
    const classMap = {
        [JobStatus.PENDING]: 'status-pending',
        [JobStatus.DOWNLOADING]: 'status-downloading',
        [JobStatus.EXTRACTING]: 'status-extracting',
        [JobStatus.TRANSCRIBING]: 'status-transcribing',
        [JobStatus.PACKING]: 'status-packing',
        [JobStatus.COMPLETED]: 'status-completed',
        [JobStatus.FAILED]: 'status-failed',
        [JobStatus.CANCELLED]: 'status-cancelled'
    };
    return classMap[status] || '';
}

/**
 * 创建作业 DOM 元素
 */
function createJobElement(job) {
    const li = document.createElement('li');
    li.className = 'item';
    li.id = `job-${job.id}`;

    // 主要内容区域
    const itemBody = document.createElement('div');
    itemBody.className = 'itemBody';

    // 左侧：作业信息
    const jobInfo = document.createElement('div');
    jobInfo.style.flex = '1';

    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '5px';
    title.textContent = job.metadata?.title || job.url;

    const url = document.createElement('div');
    url.style.fontSize = 'small';
    url.style.opacity = '0.7';
    url.textContent = job.url;

    const status = document.createElement('div');
    status.style.marginTop = '8px';
    status.innerHTML = `<strong>状态:</strong> <span class="${getStatusClass(job.status)}">${getStatusText(job.status)}</span>`;

    jobInfo.appendChild(title);
    jobInfo.appendChild(url);
    jobInfo.appendChild(status);

    // 进度条（如果正在进行中）
    if ([JobStatus.DOWNLOADING, JobStatus.EXTRACTING, JobStatus.TRANSCRIBING, JobStatus.PACKING].includes(job.status)) {
        const progressContainer = document.createElement('div');
        progressContainer.style.marginTop = '10px';

        const progressBar = document.createElement('div');
        progressBar.style.cssText = `
            width: 100%;
            height: 8px;
            background-color: var(--box-separation);
            border-radius: 4px;
            overflow: hidden;
        `;

        const progressFill = document.createElement('div');
        progressFill.style.cssText = `
            height: 100%;
            background-color: var(--greenBtn);
            transition: width 0.3s ease;
            width: ${job.progress?.current || 0}%;
        `;

        const progressText = document.createElement('div');
        progressText.style.fontSize = 'small';
        progressText.style.marginTop = '5px';
        progressText.textContent = job.progress?.message || `${job.progress?.current || 0}%`;

        progressBar.appendChild(progressFill);
        progressContainer.appendChild(progressBar);
        progressContainer.appendChild(progressText);
        jobInfo.appendChild(progressContainer);
    }

    // 错误信息（如果失败）
    if (job.status === JobStatus.FAILED && job.error) {
        const errorInfo = document.createElement('div');
        errorInfo.style.marginTop = '8px';
        errorInfo.style.color = 'var(--redBtn)';
        errorInfo.style.fontSize = 'small';
        errorInfo.innerHTML = `<strong>错误:</strong> ${job.error.message}`;
        jobInfo.appendChild(errorInfo);
    }

    itemBody.appendChild(jobInfo);

    // 右侧：操作按钮
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexDirection = 'column';
    actions.style.gap = '8px';
    actions.style.alignItems = 'flex-end';

    // 打开目录按钮
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
        const openDirBtn = document.createElement('button');
        openDirBtn.className = 'blueBtn';
        openDirBtn.style.padding = '5px 10px';
        openDirBtn.style.fontSize = 'small';
        openDirBtn.textContent = '打开目录';
        openDirBtn.onclick = () => openJobDirectory(job);
        actions.appendChild(openDirBtn);
    }

    // 重试按钮（仅对失败作业）
    if (job.status === JobStatus.FAILED) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'submitBtn';
        retryBtn.style.padding = '5px 10px';
        retryBtn.style.fontSize = 'small';
        retryBtn.textContent = '重试';
        retryBtn.onclick = () => retryJob(job);
        actions.appendChild(retryBtn);
    }

    // 取消按钮（仅对进行中作业）
    if ([JobStatus.PENDING, JobStatus.DOWNLOADING, JobStatus.EXTRACTING, JobStatus.TRANSCRIBING, JobStatus.PACKING].includes(job.status)) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'blueBtn';
        cancelBtn.style.padding = '5px 10px';
        cancelBtn.style.fontSize = 'small';
        cancelBtn.textContent = '取消';
        cancelBtn.onclick = () => cancelJob(job);
        actions.appendChild(cancelBtn);
    }

    // 清理按钮（仅对已完成作业）
    if ([JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED].includes(job.status)) {
        const cleanupBtn = document.createElement('button');
        cleanupBtn.className = 'blueBtn';
        cleanupBtn.style.padding = '5px 10px';
        cleanupBtn.style.fontSize = 'small';
        cleanupBtn.textContent = '清理';
        cleanupBtn.onclick = () => cleanupJob(job);
        actions.appendChild(cleanupBtn);
    }

    itemBody.appendChild(actions);
    li.appendChild(itemBody);

    return li;
}

/**
 * 更新作业列表显示
 */
function updateJobList() {
    if (!elements.jobList) return;

    elements.jobList.innerHTML = '';

    if (jobs.size === 0) {
        elements.noJobsMessage.style.display = 'block';
        return;
    }

    elements.noJobsMessage.style.display = 'none';

    // 按创建时间倒序排列
    const sortedJobs = Array.from(jobs.values()).sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
    );

    sortedJobs.forEach(job => {
        const jobElement = createJobElement(job);
        elements.jobList.appendChild(jobElement);
    });
}

/**
 * 处理作业创建
 */
async function handleJobCreation(event) {
    event.preventDefault();

    const url = elements.urlInput.value.trim();
    const outputDir = elements.outputDirInput.value.trim();
    const language = elements.languageSelect.value;
    const keepVideo = elements.keepVideoCheckbox.checked;

    if (!url) {
        showToast('请输入视频 URL', 'error');
        return;
    }

    if (!outputDir) {
        showToast('请选择输出目录', 'error');
        return;
    }

    // 禁用提交按钮，防止重复提交
    elements.submitJobBtn.disabled = true;
    elements.submitJobBtn.textContent = '创建中...';

    try {
        const result = await ipcRenderer.invoke('job:create', {
            url,
            outputDir,
            options: {
                language,
                keepVideo
            }
        });

        if (result.success) {
            addLog(`作业创建成功: ${result.job.id}`);
            showToast('作业创建成功', 'success');

            // 清空表单
            elements.jobForm.reset();
            elements.outputDirInput.value = result.job.outputDir;

            // 刷新作业列表
            await loadJobs();
        } else {
            addLog(`作业创建失败: ${result.error.message}`);
            showToast(`创建失败: ${result.error.message}`, 'error');
        }
    } catch (error) {
        addLog(`作业创建异常: ${error.message}`);
        showToast(`创建异常: ${error.message}`, 'error');
    } finally {
        // 恢复提交按钮
        elements.submitJobBtn.disabled = false;
        elements.submitJobBtn.textContent = '开始转写';
    }
}

/**
 * 加载作业列表
 */
async function loadJobs() {
    try {
        const result = await ipcRenderer.invoke('job:list');
        if (result.success) {
            jobs.clear();
            result.jobs.forEach(job => {
                jobs.set(job.id, job);
            });
            updateJobList();
        } else {
            addLog(`加载作业列表失败: ${result.error.message}`);
        }
    } catch (error) {
        addLog(`加载作业列表异常: ${error.message}`);
    }
}

/**
 * 打开作业目录
 */
async function openJobDirectory(job) {
    try {
        await ipcRenderer.invoke('job:openDirectory', job.id);
    } catch (error) {
        showToast(`打开目录失败: ${error.message}`, 'error');
    }
}

/**
 * 重试作业
 */
async function retryJob(job) {
    try {
        const result = await ipcRenderer.invoke('job:retry', job.id);
        if (result.success) {
            addLog(`作业重试成功: ${job.id}`);
            showToast('重试成功', 'success');
            await loadJobs();
        } else {
            addLog(`作业重试失败: ${result.error.message}`);
            showToast(`重试失败: ${result.error.message}`, 'error');
        }
    } catch (error) {
        addLog(`作业重试异常: ${error.message}`);
        showToast(`重试异常: ${error.message}`, 'error');
    }
}

/**
 * 取消作业
 */
async function cancelJob(job) {
    try {
        const result = await ipcRenderer.invoke('job:cancel', job.id, '用户取消');
        if (result.success) {
            addLog(`作业取消成功: ${job.id}`);
            showToast('取消成功', 'success');
            await loadJobs();
        } else {
            addLog(`作业取消失败: ${result.error.message}`);
            showToast(`取消失败: ${result.error.message}`, 'error');
        }
    } catch (error) {
        addLog(`作业取消异常: ${error.message}`);
        showToast(`取消异常: ${error.message}`, 'error');
    }
}

/**
 * 清理作业
 */
async function cleanupJob(job) {
    try {
        const result = await ipcRenderer.invoke('job:cleanup', job.id);
        if (result.success) {
            addLog(`作业清理成功: ${job.id}`);
            showToast('清理成功', 'success');
            jobs.delete(job.id);
            updateJobList();
        } else {
            addLog(`作业清理失败: ${result.error.message}`);
            showToast(`清理失败: ${result.error.message}`, 'error');
        }
    } catch (error) {
        addLog(`作业清理异常: ${error.message}`);
        showToast(`清理异常: ${error.message}`, 'error');
    }
}

/**
 * 切换日志面板显示
 */
function toggleLogPanel() {
    isLogPanelVisible = !isLogPanelVisible;

    if (isLogPanelVisible) {
        elements.logPanel.style.display = 'block';
        elements.toggleLogsBtn.innerHTML = '<span i18n="transcribe.hideLogs">隐藏日志</span>';
        updateLogDisplay();
    } else {
        elements.logPanel.style.display = 'none';
        elements.toggleLogsBtn.innerHTML = '<span i18n="transcribe.toggleLogs">显示日志</span>';
    }
}

/**
 * 清空日志
 */
function clearLogs() {
    logs = [];
    updateLogDisplay();
    addLog('日志已清空');
}

/**
 * 检查依赖
 */
async function checkDependencies() {
    try {
        // 显示加载状态
        showDepsModalLoading();

        // 调用依赖检查（非阻塞）
        const result = await ipcRenderer.invoke('deps:check');

        if (result.success) {
            renderDepsCheckResults(result.dependencies);
            showDepsModal();
        } else {
            showToast(`依赖检查失败: ${result.error.message}`, 'error');
            addLog(`依赖检查失败: ${result.error.message}`);
        }
    } catch (error) {
        showToast(`依赖检查异常: ${error.message}`, 'error');
        addLog(`依赖检查异常: ${error.message}`);
    }
}

/**
 * 显示依赖检查模态框加载状态
 */
function showDepsModalLoading() {
    const modal = getId('deps-modal');
    const resultsList = getId('deps-results-list');
    const checkTime = getId('deps-check-time');
    const recommendations = getId('deps-recommendations-content');

    // 显示加载状态
    resultsList.innerHTML = '<div style="text-align: center; padding: 20px;">正在检查依赖...</div>';
    checkTime.textContent = '';
    recommendations.innerHTML = '';

    // 显示模态框
    modal.style.display = 'flex';
}

/**
 * 渲染依赖检查结果
 */
function renderDepsCheckResults(dependencies) {
    const resultsList = getId('deps-results-list');
    const checkTime = getId('deps-check-time');
    const recommendations = getId('deps-recommendations-content');

    // 显示检查时间
    const now = new Date();
    checkTime.textContent = `检查时间: ${now.toLocaleString()}`;

    // 渲染依赖列表
    let html = '';
    let missingDeps = [];
    let availableDeps = [];

    dependencies.forEach(dep => {
        const statusIcon = dep.available ? '✅' : '❌';
        const statusClass = dep.available ? 'status-completed' : 'status-failed';
        const statusText = dep.available ? '已安装' : '缺失';

        html += `<div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--box-separation); border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <strong>${statusIcon} ${dep.name}</strong>
                <span class="${statusClass}" style="font-weight: bold;">${statusText}</span>
            </div>
            ${dep.version ? `<div style="font-size: small; opacity: 0.8; margin-bottom: 3px;">版本: ${dep.version}</div>` : ''}
            ${dep.path ? `<div style="font-size: small; opacity: 0.7; word-break: break-all;">路径: ${dep.path}</div>` : ''}
        </div>`;

        if (dep.available) {
            availableDeps.push(dep);
        } else {
            missingDeps.push(dep);
        }
    });

    resultsList.innerHTML = html;

    // 生成操作建议
    let recommendationsHtml = '';

    if (missingDeps.length === 0) {
        recommendationsHtml = '<div style="color: var(--greenBtn);">🎉 所有依赖都已安装，可以正常使用离线转写功能！</div>';
    } else {
        recommendationsHtml = `<div style="margin-bottom: 10px;">
            <strong>发现 ${missingDeps.length} 个缺失的依赖：</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
                ${missingDeps.map(dep => `<li>${dep.name}</li>`).join('')}
            </ul>
        </div>`;

        recommendationsHtml += '<div style="margin-bottom: 10px;">';

        if (missingDeps.some(dep => dep.name === 'yt-dlp')) {
            recommendationsHtml += '<div>• <strong>yt-dlp:</strong> 请访问 <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" style="color: var(--blueBtn);">yt-dlp GitHub</a> 下载并安装</div>';
        }

        if (missingDeps.some(dep => dep.name === 'ffmpeg')) {
            recommendationsHtml += '<div>• <strong>ffmpeg:</strong> 请访问 <a href="https://ffmpeg.org/download.html" target="_blank" style="color: var(--blueBtn);">FFmpeg 官网</a> 下载并安装</div>';
        }

        if (missingDeps.some(dep => dep.name === 'whisper.cpp' || dep.name.includes('Whisper Model'))) {
            recommendationsHtml += '<div>• <strong>whisper.cpp:</strong> 运行 <code>npm run setup-offline</code> 自动下载和配置</div>';
        }

        recommendationsHtml += '</div>';

        recommendationsHtml += '<div style="background-color: rgba(255, 193, 7, 0.1); border-left: 4px solid var(--yellowBtn); padding: 8px; margin-top: 10px;">';
        recommendationsHtml += '<strong>💡 提示:</strong> 运行 "setup-offline" 脚本可以自动处理大部分依赖问题';
        recommendationsHtml += '</div>';
    }

    recommendations.innerHTML = recommendationsHtml;

    // 根据是否有缺失依赖来显示/隐藏 setup-offline 按钮
    const setupOfflineBtn = getId('run-setup-offline-btn');
    setupOfflineBtn.style.display = missingDeps.length > 0 ? 'inline-block' : 'none';
}

/**
 * 显示依赖检查模态框
 */
function showDepsModal() {
    const modal = getId('deps-modal');
    modal.style.display = 'flex';
}

/**
 * 隐藏依赖检查模态框
 */
function hideDepsModal() {
    const modal = getId('deps-modal');
    modal.style.display = 'none';
}

/**
 * 运行 setup-offline 脚本
 */
async function runSetupOffline() {
    try {
        hideDepsModal();
        showToast('正在运行 setup-offline 脚本...', 'info');
        addLog('开始运行 setup-offline 脚本');

        // 这里可以通过 IPC 调用主进程运行脚本，或者提供用户指导
        // 目前先提供用户指导
        const result = await ipcRenderer.invoke('app:runSetupOffline');

        if (result && result.success) {
            showToast('setup-offline 脚本执行完成', 'success');
            addLog('setup-offline 脚本执行完成');
            // 重新检查依赖
            setTimeout(() => {
                checkDependencies();
            }, 2000);
        } else {
            // 提供手动运行指导
            showToast('请在终端运行: npm run setup-offline', 'info');
            addLog('请在终端运行: npm run setup-offline');
        }
    } catch (error) {
        // 如果 IPC 调用失败，提供手动运行指导
        showToast('请在终端运行: npm run setup-offline', 'info');
        addLog('请在终端运行: npm run setup-offline');
        console.log('setup-offline 指导:', error);
    }
}

/**
 * 初始化事件监听器
 */
function initializeEventListeners() {
    // 表单提交
    elements.jobForm.addEventListener('submit', handleJobCreation);

    // 日志面板切换
    elements.toggleLogsBtn.addEventListener('click', toggleLogPanel);

    // 清空日志
    elements.clearLogsBtn.addEventListener('click', clearLogs);

    // 选择输出目录
    getId('select-output-dir').addEventListener('click', async () => {
        try {
            const result = await ipcRenderer.invoke('dialog:selectDirectory');
            if (result && !result.canceled) {
                elements.outputDirInput.value = result.filePaths[0];
            }
        } catch (error) {
            showToast(`选择目录失败: ${error.message}`, 'error');
        }
    });

    // 返回主页
    getId('backToMain').addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    // 打开下载目录
    getId('openDownloadsFolder').addEventListener('click', async () => {
        try {
            await ipcRenderer.invoke('app:openDownloadsFolder');
        } catch (error) {
            showToast(`打开下载目录失败: ${error.message}`, 'error');
        }
    });

    // 依赖检查模态框事件监听器
    const depsModal = getId('deps-modal');
    const closeDepsModal = getId('close-deps-modal');
    const closeDepsModalBtn = getId('close-deps-modal-btn');
    const runSetupOfflineBtn = getId('run-setup-offline-btn');

    // 关闭模态框事件
    const closeModal = () => {
        hideDepsModal();
    };

    closeDepsModal.addEventListener('click', closeModal);
    closeDepsModalBtn.addEventListener('click', closeModal);

    // 点击模态框背景关闭
    depsModal.addEventListener('click', (event) => {
        if (event.target === depsModal) {
            closeModal();
        }
    });

    // 运行 setup-offline 脚本
    runSetupOfflineBtn.addEventListener('click', runSetupOffline);

    // ESC 键关闭模态框
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && depsModal.style.display === 'flex') {
            closeModal();
        }
    });

    // IPC 事件监听
    ipcRenderer.on('job:log', (event, data) => {
        addLog(`[${data.jobId}] ${data.type}: ${data.data}`);
    });

    ipcRenderer.on('job:progress', (event, data) => {
        addLog(`[${data.jobId}] ${data.stage}: ${data.percent}% - ${data.message}`);

        // 更新作业信息
        if (jobs.has(data.jobId)) {
            const job = jobs.get(data.jobId);
            job.progress = {
                current: data.percent,
                message: data.message
            };
            updateJobList();
        }
    });

    ipcRenderer.on('job:stage-changed', (event, data) => {
        console.log('[Transcribe] 收到状态变更事件:', data);
        addLog(`[${data.jobId}] 状态变更: ${data.oldStatus} → ${data.newStatus}`);

        // 更新作业信息
        if (jobs.has(data.jobId)) {
            const job = jobs.get(data.jobId);
            job.status = data.newStatus;
            updateJobList();
        }
    });

    // 专用事件处理（提供更详细的信息）
  ipcRenderer.on('job:completed', (event, data) => {
        addLog(`[${data.jobId}] 作业完成`);

        // 更新作业信息
        if (jobs.has(data.jobId)) {
            const job = jobs.get(data.jobId);
            job.status = JobStatus.COMPLETED;
            job.result = data.result;
            job.duration = data.duration;
            updateJobList();
        }

        showToast('作业完成！', 'success');
    });

    ipcRenderer.on('job:failed', (event, data) => {
        addLog(`[${data.jobId}] 作业失败: ${data.error?.message || '未知错误'}`);

        // 更新作业信息
        if (jobs.has(data.jobId)) {
            const job = jobs.get(data.jobId);
            job.status = JobStatus.FAILED;
            job.error = data.error;
            updateJobList();
        }

        showToast(`作业失败: ${data.error?.message || '未知错误'}`, 'error');
    });

    ipcRenderer.on('job:cancelled', (event, data) => {
        addLog(`[${data.jobId}] 作业已取消`);

        // 更新作业信息
        if (jobs.has(data.jobId)) {
            const job = jobs.get(data.jobId);
            job.status = JobStatus.CANCELLED;
            updateJobList();
        }

        showToast('作业已取消', 'success');
    });

  // 通用结果事件处理（作为备用，处理所有作业状态变化）
  ipcRenderer.on('job:result', (event, data) => {
        addLog(`[${data.jobId}] 作业结果: ${data.status} - ${data.message}`);

        // 更新作业信息
        if (jobs.has(data.jobId)) {
            const job = jobs.get(data.jobId);
            const needsUpdate =
                job.status !== (data.status === 'completed' ? JobStatus.COMPLETED :
                              data.status === 'failed' ? JobStatus.FAILED : job.status);

            if (needsUpdate) {
                job.status = data.status === 'completed' ? JobStatus.COMPLETED :
                            data.status === 'failed' ? JobStatus.FAILED : job.status;

                if (data.outputs) {
                    job.result = data.outputs;
                }
                if (data.error) {
                    job.error = data.error;
                }
                if (data.duration) {
                    job.duration = data.duration;
                }

                updateJobList();
            }
        }
    });
}

/**
 * 初始化应用
 */
async function initializeApp() {
    // 初始化元素
    initializeElements();

    // 初始化主题
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('theme', savedTheme);
    getId('themeToggle').value = savedTheme;

    // 设置默认输出目录
    try {
        const defaultDir = await ipcRenderer.invoke('app:getDownloadsPath');
        elements.outputDirInput.value = defaultDir;
    } catch (error) {
        console.warn('获取默认下载目录失败:', error);
    }

    // 加载作业列表
    await loadJobs();

    // 检查依赖
    await checkDependencies();

    // 初始化事件监听器
    initializeEventListeners();

    // 添加初始日志
    addLog('离线转写页面已加载');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initializeApp);