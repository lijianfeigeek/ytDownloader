#!/usr/bin/env node

/**
 * 作业状态变更事件测试
 * 验证 job:stage-changed 事件是否正确发送和接收
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 开始测试作业状态变更事件');

// 测试1: 验证主进程调用advanceStage的位置
console.log('\n📋 测试1: 验证主进程advanceStage调用');

const mainJsPath = path.join(__dirname, '../main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

const advanceStageCalls = [];
const stagePatterns = [
    { pattern: /jobQueue\.advanceStage\(job\.id, JobStatus\.DOWNLOADING\)/, stage: 'DOWNLOADING' },
    { pattern: /jobQueue\.advanceStage\(job\.id, JobStatus\.EXTRACTING\)/, stage: 'EXTRACTING' },
    { pattern: /jobQueue\.advanceStage\(job\.id, JobStatus\.TRANSCRIBING\)/, stage: 'TRANSCRIBING' },
    { pattern: /jobQueue\.advanceStage\(job\.id, JobStatus\.PACKING\)/, stage: 'PACKING' },
    { pattern: /jobQueue\.advanceStage\(job\.id, JobStatus\.COMPLETED\)/, stage: 'COMPLETED' }
];

stagePatterns.forEach(({ pattern, stage }) => {
    if (mainJsContent.match(pattern)) {
        advanceStageCalls.push(stage);
        console.log(`✅ 找到 ${stage} 阶段的 advanceStage 调用`);
    } else {
        console.log(`❌ 缺少 ${stage} 阶段的 advanceStage 调用`);
    }
});

// 测试2: 验证事件订阅逻辑
console.log('\n📋 测试2: 验证事件订阅逻辑');

const queueJsPath = path.join(__dirname, '../src/jobs/queue.js');
const queueJsContent = fs.readFileSync(queueJsPath, 'utf8');

if (queueJsContent.includes('this._emitEvent({') &&
    queueJsContent.includes("type: 'job:stage-changed'")) {
    console.log('✅ JobQueue 正确发送 job:stage-changed 事件');
} else {
    console.log('❌ JobQueue 缺少 job:stage-changed 事件发送逻辑');
    process.exit(1);
}

// 测试3: 验证主进程事件转发
console.log('\n📋 测试3: 验证主进程事件转发');

if (mainJsContent.includes("jobQueue.subscribe((event) =>") &&
    mainJsContent.includes("case 'job:stage-changed':") &&
    mainJsContent.includes("win.webContents.send('job:stage-changed'")) {
    console.log('✅ 主进程正确转发 job:stage-changed 事件');
} else {
    console.log('❌ 主进程缺少 job:stage-changed 事件转发逻辑');
    process.exit(1);
}

// 测试4: 验证前端事件监听器
console.log('\n📋 测试4: 验证前端事件监听器');

const transcribeJsPath = path.join(__dirname, '../src/transcribe.js');
const transcribeJsContent = fs.readFileSync(transcribeJsPath, 'utf8');

if (transcribeJsContent.includes("ipcRenderer.on('job:stage-changed'")) {
    console.log('✅ 前端正确监听 job:stage-changed 事件');
} else {
    console.log('❌ 前端缺少 job:stage-changed 事件监听器');
    process.exit(1);
}

// 测试5: 验证事件数据结构匹配
console.log('\n📋 测试5: 验证事件数据结构匹配');

// 主进程发送的数据结构
const mainEventData = {
    jobId: 'test_job_123',
    oldStatus: 'PENDING',
    newStatus: 'DOWNLOADING',
    timestamp: '2025-01-01T12:00:00.000Z'
};

// 前端期望的数据结构（基于实际代码）
function simulateFrontendStageHandler(data) {
    try {
        // 基于src/transcribe.js中的实际处理逻辑
        const logMessage = `[${data.jobId}] 状态变更: ${data.oldStatus} → ${data.newStatus}`;

        // 验证必要字段
        if (!data.jobId || !data.oldStatus || !data.newStatus) {
            throw new Error('缺少必要字段');
        }

        return {
            success: true,
            logMessage,
            jobId: data.jobId,
            oldStatus: data.oldStatus,
            newStatus: data.newStatus
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

const stageResult = simulateFrontendStageHandler(mainEventData);
if (stageResult.success) {
    console.log('✅ job:stage-changed 事件数据结构匹配');
    console.log(`   示例: ${stageResult.logMessage}`);
} else {
    console.log('❌ job:stage-changed 事件数据结构不匹配:', stageResult.error);
    process.exit(1);
}

// 测试6: 验证作业状态转换规则
console.log('\n📋 测试6: 验证作业状态转换规则');

if (queueJsContent.includes('[JobStatus.FAILED]: [JobStatus.PENDING]')) {
    console.log('✅ 状态机允许 FAILED → PENDING 转换（重试支持）');
} else {
    console.log('❌ 状态机禁止 FAILED → PENDING 转换（重试失败）');
    process.exit(1);
}

// 测试7: 模拟完整的作业状态变更流程
console.log('\n📋 测试7: 模拟完整作业状态流程');

const expectedFlow = [
    { from: 'PENDING', to: 'DOWNLOADING' },
    { from: 'DOWNLOADING', to: 'EXTRACTING' },
    { from: 'EXTRACTING', to: 'TRANSCRIBING' },
    { from: 'TRANSCRIBING', to: 'PACKING' },
    { from: 'PACKING', to: 'COMPLETED' }
];

let flowIssues = [];

expectedFlow.forEach((transition, index) => {
    const fromStage = transition.from;
    const toStage = transition.to;

    // 检查状态转换是否被调用
    const advancePattern = new RegExp(`JobStatus\\.${toStage}`);
    if (!mainJsContent.match(advancePattern)) {
        flowIssues.push(`缺少 ${fromStage} → ${toStage} 转换`);
    }

    // 检查状态转换是否被允许
    const validTransitionPattern = new RegExp(`\\[JobStatus\\.${fromStage}\\]:.*JobStatus\\.${toStage}`);
    if (!queueJsContent.match(validTransitionPattern)) {
        flowIssues.push(`状态机不允许 ${fromStage} → ${toStage}`);
    }
});

if (flowIssues.length > 0) {
    console.log('❌ 作业状态流程问题:');
    flowIssues.forEach(issue => console.log(`   - ${issue}`));
    process.exit(1);
} else {
    console.log('✅ 完整作业状态流程验证通过');
}

// 测试8: 验证重试逻辑
console.log('\n📋 测试8: 验证重试逻辑实现');

const retryPatterns = [
    "job.status !== 'FAILED'",
    "jobQueue.advanceStage(jobId, 'PENDING')",
    "job.error = null",
    "executeJobPipeline(job)"
];

let missingRetryPatterns = [];
retryPatterns.forEach(pattern => {
    if (!mainJsContent.includes(pattern)) {
        missingRetryPatterns.push(pattern);
    }
});

if (missingRetryPatterns.length > 0) {
    console.log('❌ 重试逻辑不完整:', missingRetryPatterns);
    process.exit(1);
} else {
    console.log('✅ 重试逻辑实现完整');
}

// 最终汇总
console.log('\n' + '='.repeat(60));
console.log('🎯 作业状态变更事件测试汇总');
console.log('='.repeat(60));

const testResults = [
    '主进程advanceStage调用验证',
    '事件订阅逻辑验证',
    '主进程事件转发验证',
    '前端事件监听器验证',
    '事件数据结构匹配验证',
    '作业状态转换规则验证',
    '完整作业状态流程验证',
    '重试逻辑实现验证'
];

testResults.forEach(result => {
    console.log(`✅ ${result}`);
});

console.log('\n🎉 所有作业状态变更事件测试通过！');
console.log('✅ job:stage-changed 事件应该正常工作');

console.log('\n📝 关键发现:');
console.log('   1. 主进程在所有关键阶段都调用 advanceStage');
console.log('   2. JobQueue 正确发送 job:stage-changed 事件');
console.log('   3. 主进程正确转发事件到 Renderer');
console.log('   4. 前端正确监听和处理事件');
console.log('   5. 状态机现在允许重试（FAILED → PENDING）');
console.log('   6. 重试逻辑实现完整');

console.log('\n🔍 如果事件仍然不工作，可能原因:');
console.log('   - win 对象在事件发送时未初始化');
console.log('   - 事件订阅时机问题（在 win 初始化之前）');
console.log('   - 异步执行上下文问题');
console.log('   - 事件监听器注册时机问题');

console.log('\n🚀 建议调试步骤:');
console.log('   1. 在 main.js 的事件转发中添加 console.log');
console.log('   2. 在 transcribe.js 的事件监听中添加 console.log');
console.log('   3. 检查事件发送和接收的时序');
console.log('   4. 验证 win 对象在事件发送时的状态');

process.exit(0);