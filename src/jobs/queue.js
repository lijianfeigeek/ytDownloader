/**
 * @module JobQueue
 * @description 可扩展的作业状态机，管理离线转写作业的生命周期
 *
 * 功能特性：
 * - 完整的作业状态转换管理
 * - 事件驱动的状态变更通知
 * - 订阅机制支持多个监听器
 * - 自动时间戳记录
 * - 内存数据结构，无外部依赖
 *
 * @example
 * const { JobQueue, JobStatus } = require('./queue');
 *
 * // 创建新作业
 * const job = JobQueue.add({
 *   url: 'https://example.com/video',
 *   outputDir: '/downloads',
 *   options: { keepVideo: true }
 * });
 *
 * // 监听状态变更
 * JobQueue.subscribe((event) => {
 *   console.log(`Job ${event.jobId}: ${event.oldStatus} → ${event.newStatus}`);
 * });
 *
 * // 推进作业状态
 * JobQueue.advanceStage(job.id, JobStatus.DOWNLOADING);
 * JobQueue.advanceStage(job.id, JobStatus.COMPLETED);
 *
 * @example
 * // 批量查询作业状态
 * const pendingJobs = JobQueue.getByStatus(JobStatus.PENDING);
 * const completedJobs = JobQueue.getByStatus(JobStatus.COMPLETED);
 *
 * @example
 * // 获取作业统计信息
 * const stats = JobQueue.getStats();
 * console.log(`总计: ${stats.total}, 进行中: ${stats.inProgress}`);
 */

/**
 * 生成简单的唯一ID
 * @private
 * @returns {string} 唯一标识符
 */
function generateJobId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * 作业状态枚举
 * @readonly
 * @enum {string}
 */
const JobStatus = {
  /** 等待开始 */
  PENDING: 'PENDING',
  /** 正在下载 */
  DOWNLOADING: 'DOWNLOADING',
  /** 正在提取音频 */
  EXTRACTING: 'EXTRACTING',
  /** 正在转写 */
  TRANSCRIBING: 'TRANSCRIBING',
  /** 正在打包结果 */
  PACKING: 'PACKING',
  /** 已完成 */
  COMPLETED: 'COMPLETED',
  /** 已失败 */
  FAILED: 'FAILED',
  /** 已取消 */
  CANCELLED: 'CANCELLED'
};

/**
 * 有效的状态转换映射
 * @private
 */
const VALID_TRANSITIONS = {
  [JobStatus.PENDING]: [JobStatus.DOWNLOADING, JobStatus.CANCELLED, JobStatus.FAILED],
  [JobStatus.DOWNLOADING]: [JobStatus.EXTRACTING, JobStatus.FAILED, JobStatus.CANCELLED],
  [JobStatus.EXTRACTING]: [JobStatus.TRANSCRIBING, JobStatus.FAILED, JobStatus.CANCELLED],
  [JobStatus.TRANSCRIBING]: [JobStatus.PACKING, JobStatus.FAILED, JobStatus.CANCELLED],
  [JobStatus.PACKING]: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED],
  [JobStatus.COMPLETED]: [], // 终态
  [JobStatus.FAILED]: [], // 终态
  [JobStatus.CANCELLED]: [] // 终态
};

/**
 * 进行中的状态集合（非终态）
 * @private
 */
const IN_PROGRESS_STATUSES = new Set([
  JobStatus.DOWNLOADING,
  JobStatus.EXTRACTING,
  JobStatus.TRANSCRIBING,
  JobStatus.PACKING
]);

/**
 * 终态集合
 * @private
 */
const TERMINAL_STATUSES = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED
]);

/**
 * 作业状态机队列类
 * @class
 */
class JobQueue {
  constructor() {
    /** @private {Map<string, Object>} 作业存储映射 */
    this.jobs = new Map();
    /** @private {Array<Function>} 事件监听器列表 */
    this.listeners = [];
    /** @private {number} 监听器ID计数器 */
    this.listenerIdCounter = 0;
    /** @private {Map<number, Function>} 监听器ID映射 */
    this.listenerMap = new Map();
  }

  /**
   * 创建新作业
   * @param {Object} jobData - 作业数据
   * @param {string} jobData.url - 视频/音频URL
   * @param {string} jobData.outputDir - 输出目录
   * @param {Object} [jobData.options] - 作业选项
   * @param {boolean} [jobData.options.keepVideo=false] - 是否保留视频文件
   * @param {string} [jobData.options.language='auto'] - 转写语言
   * @param {Object} [jobData.metadata] - 额外元数据
   * @returns {Object} 新创建的作业对象
   *
   * @example
   * const job = JobQueue.add({
   *   url: 'https://youtube.com/watch?v=123',
   *   outputDir: '/path/to/downloads',
   *   options: { keepVideo: true, language: 'zh' },
   *   metadata: { title: 'Sample Video' }
   * });
   */
  add(jobData) {
    if (!jobData.url || !jobData.outputDir) {
      throw new Error('作业必须包含 url 和 outputDir 字段');
    }

    const now = new Date().toISOString();
    const job = {
      id: jobData.id || generateJobId(),
      url: jobData.url,
      outputDir: jobData.outputDir,
      options: {
        keepVideo: false,
        language: 'auto',
        ...jobData.options
      },
      metadata: {
        title: '',
        duration: 0,
        ...jobData.metadata
      },
      status: JobStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      stageStartTime: now,
      progress: {
        current: 0,
        total: 100,
        message: ''
      },
      error: null,
      result: {
        files: [],
        transcript: '',
        metadata: {}
      }
    };

    this.jobs.set(job.id, job);

    this._emitEvent({
      type: 'job:created',
      jobId: job.id,
      job,
      timestamp: now
    });

    return job;
  }

  /**
   * 获取作业信息
   * @param {string} jobId - 作业ID
   * @returns {Object|null} 作业对象，不存在返回null
   */
  get(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * 获取作业信息 (get方法的别名，提供更明确的命名)
   * @param {string} jobId - 作业ID
   * @returns {Object|null} 作业对象，不存在返回null
   */
  getJob(jobId) {
    return this.get(jobId);
  }

  /**
   * 更新作业数据
   * @param {string} jobId - 作业ID
   * @param {Object} updates - 更新数据
   * @returns {boolean} 是否更新成功
   */
  update(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    const oldJob = { ...job };
    Object.assign(job, updates, { updatedAt: new Date().toISOString() });

    this._emitEvent({
      type: 'job:updated',
      jobId,
      oldJob,
      newJob: { ...job },
      updates,
      timestamp: job.updatedAt
    });

    return true;
  }

  /**
   * 推进作业到下一阶段
   * @param {string} jobId - 作业ID
   * @param {string} newStatus - 新状态
   * @param {Object} [context] - 上下文信息
   * @param {string} [context.message] - 状态变更消息
   * @param {Object} [context.progress] - 进度信息
   * @param {Object} [context.error] - 错误信息
   * @returns {boolean} 是否成功推进
   *
   * @example
   * // 正常状态推进
   * JobQueue.advanceStage(jobId, JobStatus.DOWNLOADING);
   *
   * // 带错误信息的状态推进
   * JobQueue.advanceStage(jobId, JobStatus.FAILED, {
   *   error: { code: 'NETWORK_ERROR', message: '网络连接失败' }
   * });
   */
  advanceStage(jobId, newStatus, context = {}) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    const oldStatus = job.status;

    // 检查状态转换是否有效
    if (!this._isValidTransition(oldStatus, newStatus)) {
      throw new Error(`无效的状态转换: ${oldStatus} → ${newStatus}`);
    }

    const now = new Date().toISOString();
    const oldJob = { ...job };

    // 更新作业状态
    job.status = newStatus;
    job.updatedAt = now;
    job.stageStartTime = now;

    // 更新上下文信息
    if (context.progress) {
      job.progress = { ...job.progress, ...context.progress };
    }
    if (context.message) {
      job.progress.message = context.message;
    }
    if (context.error) {
      job.error = context.error;
    }

    // 清除错误信息（如果不是失败状态）
    if (newStatus !== JobStatus.FAILED) {
      job.error = null;
    }

    this._emitEvent({
      type: 'job:stage-changed',
      jobId,
      oldStatus,
      newStatus,
      oldJob,
      newJob: { ...job },
      context,
      timestamp: now
    });

    return true;
  }

  /**
   * 取消作业
   * @param {string} jobId - 作业ID
   * @param {string} [reason] - 取消原因
   * @returns {boolean} 是否成功取消
   */
  cancel(jobId, reason = '') {
    const job = this.jobs.get(jobId);
    if (!job || TERMINAL_STATUSES.has(job.status)) {
      return false;
    }

    return this.advanceStage(jobId, JobStatus.CANCELLED, {
      message: reason || '用户取消'
    });
  }

  /**
   * 标记作业失败
   * @param {string} jobId - 作业ID
   * @param {Object} error - 错误信息
   * @param {string} error.code - 错误代码
   * @param {string} error.message - 错误消息
   * @param {string} [error.suggestion] - 建议操作
   * @returns {boolean} 是否成功标记
   */
  fail(jobId, error) {
    return this.advanceStage(jobId, JobStatus.FAILED, { error });
  }

  /**
   * 更新作业进度
   * @param {string} jobId - 作业ID
   * @param {number} current - 当前进度值
   * @param {number} total - 总进度值
   * @param {string} message - 进度消息
   * @returns {boolean} 是否成功更新
   */
  updateProgress(jobId, current, total = 100, message = '') {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    const oldProgress = { ...job.progress };
    job.progress = { current, total, message };
    job.updatedAt = new Date().toISOString();

    this._emitEvent({
      type: 'job:progress-updated',
      jobId,
      oldProgress,
      newProgress: { ...job.progress },
      timestamp: job.updatedAt
    });

    return true;
  }

  /**
   * 获取指定状态的作业列表
   * @param {string} status - 作业状态
   * @returns {Array<Object>} 作业列表
   */
  getByStatus(status) {
    return Array.from(this.jobs.values()).filter(job => job.status === status);
  }

  /**
   * 获取所有作业列表
   * @returns {Array<Object>} 所有作业
   */
  getAll() {
    return Array.from(this.jobs.values());
  }

  /**
   * 删除作业
   * @param {string} jobId - 作业ID
   * @returns {boolean} 是否成功删除
   */
  remove(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    // 只能删除终态作业
    if (!TERMINAL_STATUSES.has(job.status)) {
      return false;
    }

    const removedJob = this.jobs.get(jobId);
    this.jobs.delete(jobId);

    this._emitEvent({
      type: 'job:removed',
      jobId,
      job: removedJob,
      timestamp: new Date().toISOString()
    });

    return true;
  }

  /**
   * 清理完成的作业
   * @param {number} [olderThanHours=24] - 清理多少小时前完成的作业
   * @returns {number} 清理的作业数量
   */
  cleanup(olderThanHours = 24) {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - olderThanHours);

    let cleanedCount = 0;
    for (const [jobId, job] of this.jobs.entries()) {
      if (TERMINAL_STATUSES.has(job.status) &&
          new Date(job.updatedAt) < cutoffTime) {
        this.jobs.delete(jobId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this._emitEvent({
        type: 'jobs:cleaned',
        count: cleanedCount,
        olderThanHours,
        timestamp: new Date().toISOString()
      });
    }

    return cleanedCount;
  }

  /**
   * 获取作业统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const jobs = Array.from(this.jobs.values());
    const stats = {
      total: jobs.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      byStatus: {}
    };

    // 按状态统计
    for (const status of Object.values(JobStatus)) {
      stats.byStatus[status] = 0;
    }

    for (const job of jobs) {
      stats.byStatus[job.status]++;

      if (job.status === JobStatus.PENDING) {
        stats.pending++;
      } else if (IN_PROGRESS_STATUSES.has(job.status)) {
        stats.inProgress++;
      } else if (job.status === JobStatus.COMPLETED) {
        stats.completed++;
      } else if (job.status === JobStatus.FAILED) {
        stats.failed++;
      } else if (job.status === JobStatus.CANCELLED) {
        stats.cancelled++;
      }
    }

    return stats;
  }

  /**
   * 订阅作业事件
   * @param {Function} listener - 事件监听器函数
   * @returns {number} 监听器ID，用于取消订阅
   *
   * @example
   * const listenerId = JobQueue.subscribe((event) => {
   *   console.log('事件类型:', event.type);
   *   console.log('作业ID:', event.jobId);
   *   if (event.type === 'job:stage-changed') {
   *     console.log(`状态变更: ${event.oldStatus} → ${event.newStatus}`);
   *   }
   * });
   *
   * // 取消订阅
   * JobQueue.unsubscribe(listenerId);
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new Error('监听器必须是一个函数');
    }

    const listenerId = ++this.listenerIdCounter;
    this.listeners.push(listener);
    this.listenerMap.set(listenerId, listener);

    return listenerId;
  }

  /**
   * 取消订阅作业事件
   * @param {number} listenerId - 监听器ID
   * @returns {boolean} 是否成功取消订阅
   */
  unsubscribe(listenerId) {
    const listener = this.listenerMap.get(listenerId);
    if (!listener) {
      return false;
    }

    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
      this.listenerMap.delete(listenerId);
      return true;
    }

    return false;
  }

  /**
   * 清除所有监听器
   */
  clearListeners() {
    this.listeners = [];
    this.listenerMap.clear();
  }

  /**
   * 检查状态转换是否有效
   * @private
   * @param {string} fromStatus - 源状态
   * @param {string} toStatus - 目标状态
   * @returns {boolean} 是否有效
   */
  _isValidTransition(fromStatus, toStatus) {
    const validTargets = VALID_TRANSITIONS[fromStatus];
    return validTargets && validTargets.includes(toStatus);
  }

  /**
   * 发送事件到所有监听器
   * @private
   * @param {Object} event - 事件对象
   */
  _emitEvent(event) {
    // 异步发送事件，避免阻塞主流程
    setImmediate(() => {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('事件监听器执行错误:', error);
        }
      }
    });
  }
}

// 创建全局单例实例
const jobQueue = new JobQueue();

module.exports = {
  JobQueue: jobQueue,
  JobStatus,
  // 提供类引用用于扩展
  JobQueueClass: JobQueue
};