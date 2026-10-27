import { moment } from "obsidian";

const safeMoment = moment as unknown as (inp?: unknown) => { format(format: string): string };

import FastSync from "../../main";
import { dumpError } from "../utils/helpers";
import { $ } from "../../i18n/lang";


// 常见错误码 -> i18n 人话文案键映射表（覆盖客户端已知的鉴权/冲突/上传会话等高频错误码，
// 未命中的错误码回退到 ui.log.error_code.unknown，仍带上原始 code 便于排查）
// Common error code -> i18n human-readable message key map (covers the auth/conflict/upload-session
// codes the client already knows about; unmapped codes fall back to ui.log.error_code.unknown,
// which still surfaces the raw code for troubleshooting)
const ERROR_CODE_MESSAGE_KEYS: Record<number, Parameters<typeof $>[0]> = {
    300: "ui.log.error_code.300",
    302: "ui.log.error_code.302",
    303: "ui.log.error_code.303",
    305: "ui.log.error_code.305",
    307: "ui.log.error_code.307",
    308: "ui.log.error_code.308",
    309: "ui.log.error_code.309",
    310: "ui.log.error_code.310",
    312: "ui.log.error_code.312",
    420: "ui.log.error_code.420",
    463: "ui.log.error_code.463",
    530: "ui.log.error_code.530",
};

function formatErrorCodeMessage(code: number): string {
    const key = ERROR_CODE_MESSAGE_KEYS[code];
    if (key) {
        return $(key, { code });
    }
    return $("ui.log.error_code.unknown", { code });
}


export type LogType = 'send' | 'receive' | 'info' | 'error';
export type LogStatus = 'success' | 'error' | 'pending' | 'cancelled';

export type LogCategory = 'note' | 'attachment' | 'config' | 'folder' | 'summary' | 'other';

export interface SyncLog {
    id: string;
    timestamp: number;
    type: LogType;
    category: LogCategory;
    action: string;
    path?: string;
    status: LogStatus;
    progress?: number;
    message?: string;
    vault?: string;
}

interface SyncSummaryStats {
    syncType?: string;
    note?: { upload: number; modify: number; delete: number };
    file?: { upload: number; modify: number; delete: number };
    config?: { upload: number; modify: number; delete: number };
}

// 高频数据流消息：大库同步时每同步一个笔记/文件/配置/文件夹就会触发一次，量级与库大小成正比。
// notify() 已有 100ms 节流兜底（doNotify 内 getLogs() 的 O(n) 拷贝已被限流到最多 10 次/秒），
// 但 persistToFile() 是无节流的异步磁盘 append——每条新日志只要不是 pending 状态就立即写一次盘，
// 大库全量同步时会变成成千上万次磁盘 I/O。这些高频消息在"成功"路径下跳过磁盘持久化，
// 仍然写入内存 Map（日志面板打开时能看到），错误/冲突/pending 状态不受影响、照常持久化。
// High-frequency data-stream messages: fired once per synced note/file/config/folder during a
// large-vault sync, scaling with vault size. notify() already has a 100ms throttle (doNotify's
// O(n) getLogs() copy is capped to ~10 calls/sec), but persistToFile() is unthrottled async disk
// I/O — every new non-pending log writes to disk immediately, which becomes thousands of writes
// on a large full sync. These high-frequency messages skip disk persistence on the success path,
// but are still recorded into the in-memory Map (visible if the log panel is open); error/conflict/
// pending states are unaffected and still persist as before.
const HIGH_FREQUENCY_RECEIVE_ACTIONS = new Set([
    "NoteSyncModify", "NoteSyncMtime", "NoteSyncDelete", "NoteSyncRename",
    "NoteModifyAck", "NoteRenameAck", "NoteDeleteAck",
    "FileSyncDelete", "FileSyncMtime", "FileSyncRename",
    "FileUploadAck", "FileRenameAck", "FileDeleteAck",
    "SettingSyncModify", "SettingSyncMtime", "SettingSyncDelete",
    "SettingModifyAck", "SettingDeleteAck",
    "FolderSyncModify", "FolderSyncDelete", "FolderSyncRename",
]);

export class SyncLogManager {
    private static instance: SyncLogManager;
    // 底层改为 Map<id, SyncLog>，保序用 Map 天然的插入序，upsert 变为 O(1)（原 findIndex 为 O(n)）
    private logs: Map<string, SyncLog> = new Map();
    private readonly MAX_LOGS = 5000;
    // 失败项独立上限：淘汰只清成功项，失败项在自己的上限内单独淘汰，不会被 5000 条总量挤掉
    // Failed entries get their own cap: eviction only reclaims success items; failed items are
    // only trimmed once they exceed their own cap, so they are never pushed out by the 5000 total.
    private readonly MAX_FAILED_LOGS = 1000;
    private failedCount = 0;
    // 未读失败计数，供状态栏红点使用；打开日志视图切到"仅看失败"后清零
    // Unread failed count, used by the status bar red dot; cleared once the log view is opened
    // and switched to "failed only"
    private unreadFailedCount = 0;
    private failedCountListeners: Set<(count: number) => void> = new Set();
    // 状态栏点击"仅看失败"跳转到日志视图时，日志视图挂载后消费一次此标记切换筛选
    // Set right before revealing the log view from the status bar; consumed once on mount to
    // switch the view's filter to "failed only"
    private pendingOnlyFailedFilter = false;
    private listeners: Set<(logs: SyncLog[]) => void> = new Set();
    private plugin: FastSync | null = null;
    private logFilePath: string = "";

    // notify() 节流合并：高频同步消息每条都触发会导致大量 UI/工作区事件重渲染
    private readonly NOTIFY_THROTTLE_MS = 100;
    private lastNotifyTime = 0;
    private notifyTimer: number | null = null;
    private notifyPending = false;

    private constructor() { }

    public static getInstance(): SyncLogManager {
        if (!SyncLogManager.instance) {
            SyncLogManager.instance = new SyncLogManager();
        }
        return SyncLogManager.instance;
    }

    public init(plugin: FastSync) {
        this.plugin = plugin;
    }

    private getCategory(action: string): LogCategory {
        if (action === 'SyncSummary') return 'summary';
        if (action.startsWith('Note')) return 'note';
        if (action.startsWith('File')) return 'attachment';
        if (action.startsWith('Setting') || action.startsWith('Config')) return 'config';
        if (action.startsWith('Folder')) return 'folder';
        return 'other';
    }

    public addOrUpdateLog(log: Partial<SyncLog> & { id: string, action: string, type: LogType }, opts?: { skipPersist?: boolean }) {
        const existingLog = this.logs.get(log.id);
        const category = this.getCategory(log.action);

        if (existingLog) {
            // Update existing log - PRESERVE existing timestamp

            // 如果旧状态已经是成功或失败，则不允许被改回 pending
            let targetStatus = log.status || existingLog.status;
            const statusChanged = existingLog.status !== targetStatus;

            if (existingLog.status !== 'pending' && targetStatus === 'pending') {
                targetStatus = existingLog.status;
            }

            // 确保进度条只增不减，防止由于分片乱序完成导致的进度跳变
            let targetProgress = log.progress ?? existingLog.progress;
            if (existingLog.progress !== undefined && targetProgress !== undefined) {
                targetProgress = Math.max(existingLog.progress, targetProgress);
            }

            const updatedLog: SyncLog = {
                ...existingLog,
                ...log,
                category,
                status: targetStatus,
                progress: targetProgress,
                timestamp: existingLog.timestamp // Keep the original start time
            };

            // --- 保持原有顺序，避免分页时由于状态更新导致记录在页面间跳变 ---
            // --- Keep original order to prevent items jumping between pages during status updates ---
            // Map.set 更新已存在的 key 不会改变其迭代顺序位置，天然保序
            this.logs.set(log.id, updatedLog);

            if (statusChanged) {
                this.onStatusTransition(existingLog.status, targetStatus);
            }

            // 仅在状态从 pending 变为 success/error 时记录到文件，避免进度更新刷屏
            if (statusChanged && targetStatus !== 'pending' && !opts?.skipPersist) {
                void this.persistToFile(updatedLog);
            }
        } else {
            // Add new log
            const newLog: SyncLog = {
                id: log.id,
                timestamp: log.timestamp || Date.now(),
                type: log.type,
                category,
                action: log.action,
                path: log.path,
                status: log.status || 'success',
                progress: log.progress,
                message: log.message,
                vault: log.vault
            };
            this.logs.set(log.id, newLog);
            if (newLog.status === 'error') {
                this.onStatusTransition(undefined, 'error');
            }

            if (this.logs.size > this.MAX_LOGS) {
                // 淘汰最早插入的一条非失败记录（失败项不受总量上限淘汰，见 enforceFailedCap）
                // Evict the oldest non-failed record (failed entries are exempt from the total
                // cap eviction here, see enforceFailedCap)
                this.evictOldestNonError();
            }
            this.enforceFailedCap();

            // 新增记录时持久化到文件（除非是 pending 状态的进度条开头，这种通常之后会有 success）
            if (newLog.status !== 'pending' && !opts?.skipPersist) {
                void this.persistToFile(newLog);
            }
        }
        this.notify();
    }

    /**
     * 淘汰迭代序中最早的一条非失败（status !== 'error'）记录。
     * Evict the oldest record (by insertion order) whose status is not 'error'.
     */
    private evictOldestNonError(): boolean {
        for (const [key, log] of this.logs) {
            if (log.status !== 'error') {
                this.logs.delete(key);
                return true;
            }
        }
        return false;
    }

    /**
     * 失败项独立上限：超过 MAX_FAILED_LOGS 时才淘汰最早的失败记录。
     * Failed entries have their own cap: only trim the oldest failed record once MAX_FAILED_LOGS
     * is exceeded.
     */
    private enforceFailedCap(): void {
        while (this.failedCount > this.MAX_FAILED_LOGS) {
            let evicted = false;
            for (const [key, log] of this.logs) {
                if (log.status === 'error') {
                    this.logs.delete(key);
                    this.failedCount--;
                    evicted = true;
                    break;
                }
            }
            if (!evicted) break;
        }
    }

    /**
     * 维护 failedCount / unreadFailedCount 计数器，供失败项独立淘汰上限和状态栏红点使用。
     * Maintain the failedCount / unreadFailedCount counters used by the failed-item eviction cap
     * and the status bar red dot.
     */
    private onStatusTransition(fromStatus: LogStatus | undefined, toStatus: LogStatus): void {
        if (fromStatus === toStatus) return;
        if (toStatus === 'error') {
            this.failedCount++;
            this.unreadFailedCount++;
            this.notifyFailedCountListeners();
        } else if (fromStatus === 'error') {
            this.failedCount--;
            this.notifyFailedCountListeners();
        }
    }

    public getUnreadFailedCount(): number {
        return this.unreadFailedCount;
    }

    public markFailedSeen(): void {
        if (this.unreadFailedCount === 0) return;
        this.unreadFailedCount = 0;
        this.notifyFailedCountListeners();
    }

    public subscribeUnreadFailedCount(listener: (count: number) => void): () => void {
        this.failedCountListeners.add(listener);
        listener(this.unreadFailedCount);
        return () => this.failedCountListeners.delete(listener);
    }

    private notifyFailedCountListeners(): void {
        this.failedCountListeners.forEach(listener => listener(this.unreadFailedCount));
    }

    /**
     * 状态栏点击"仅看失败"跳转日志视图前调用，日志视图挂载时消费一次。
     * Called right before revealing the log view from the status bar; consumed once when the log
     * view mounts.
     */
    public requestOnlyFailedFilter(): void {
        this.pendingOnlyFailedFilter = true;
    }

    public consumePendingOnlyFailedFilter(): boolean {
        const value = this.pendingOnlyFailedFilter;
        this.pendingOnlyFailedFilter = false;
        return value;
    }

    public addLog(type: LogType, action: string, message?: string, status: LogStatus = 'success', path?: string, vault?: string, opts?: { skipPersist?: boolean }) {
        this.addOrUpdateLog({
            id: Math.random().toString(36).substring(2, 11),
            type,
            action,
            message,
            status,
            path,
            vault,
            timestamp: Date.now()
        }, opts);
    }

    /**
     * 记录接收到的 WebSocket 消息
     * @param action 消息动作类型
     * @param data 消息数据
     * @param currentSyncType 当前同步类型
     */
    public logReceivedMessage(action: string, data: unknown, currentSyncType: string): void {
        // 过滤不需要记录的消息类型 / Filter out unnecessary message types from logging
        const excludedActions = [
            "Pong", "Authorization", "ClientInfo", "FileUploadCheck", "FileChunkDownload", "NoteSyncNeedPush", "FileSyncUpdate", "FileSyncChunkDownload",
            "FolderSyncBatchAck", "NoteSyncBatchAck", "FileSyncBatchAck", "SettingSyncBatchAck",
            "FolderSyncPage", "NoteSyncPage", "FileSyncPage", "SettingSyncPage",
            "FolderSyncPageAck", "NoteSyncPageAck", "FileSyncPageAck", "SettingSyncPageAck"
        ];
        if (excludedActions.includes(action)) {
            return;
        }

        const msgData = data as { 
            data?: { Path?: string; path?: string; Vault?: string; vault?: string; sessionId?: string; SessionID?: string };
            Path?: string; path?: string; Vault?: string; vault?: string; sessionId?: string; SessionID?: string;
            code?: number; message?: string;
        };

        // 提取路径信息
        const logPath = msgData.data?.Path || msgData.Path || msgData.path || msgData.data?.path;
        // 提取 Vault 信息
        const logVault = msgData.Vault || msgData.vault || msgData.data?.Vault || msgData.data?.vault;

        // 根据消息类型调整 action 名称
        let logAction = action;
        const syncTypeActions = ["NoteSync", "FileSync", "SettingSync", "FolderSync", "NoteSyncEnd", "FileSyncEnd", "SettingSyncEnd", "FolderSyncEnd", "SyncEnd"];
        if (syncTypeActions.includes(action)) {
            logAction = `${action}_${currentSyncType}`;
        }

        // 提取 sessionId
        const sessionId = msgData.sessionId || msgData.data?.sessionId || msgData.data?.SessionID;

        if (sessionId) {
            // 根据 code 判断状态
            const hasCode = msgData.code !== undefined;
            const isError = hasCode && (msgData.code === 0 || (msgData.code as number) > 200);

            let targetStatus: LogStatus = 'pending';
            if (isError) {
                targetStatus = 'error';
            } else if (hasCode) {
                // 对于分片传输类指令,即使有 code 也不立即标记为 success,因为后续还有传输过程
                if (['FileUpload', 'FileDownload', 'ConfigUpload'].includes(action)) {
                    targetStatus = 'pending';
                } else {
                    targetStatus = 'success';
                }
            }

            // 高频数据流消息的成功路径跳过磁盘持久化；错误/pending 状态不受影响，仍照常持久化
            // Success path of high-frequency data-stream messages skips disk persistence;
            // error/pending states are unaffected and still persist as before
            const skipPersist = HIGH_FREQUENCY_RECEIVE_ACTIONS.has(action) && targetStatus === 'success';
            this.addOrUpdateLog({
                id: sessionId,
                type: 'receive',
                action: logAction,
                status: targetStatus,
                path: logPath,
                vault: logVault,
                message: msgData.message || (msgData.code !== undefined ? formatErrorCodeMessage(msgData.code) : undefined)
            }, { skipPersist });
        } else {
            // 没有 sessionId 的消息
            const status = (msgData.code !== undefined && (msgData.code === 0 || (msgData.code) > 200)) ? 'error' : 'success';
            const message = msgData.message || (msgData.code !== undefined ? formatErrorCodeMessage(msgData.code) : undefined);
            const skipPersist = HIGH_FREQUENCY_RECEIVE_ACTIONS.has(action) && status === 'success';
            this.addLog('receive', logAction, message, status, logPath, logVault, { skipPersist });
        }
    }

    /**
     * 记录发送的 WebSocket 消息
     * @param action 消息动作类型
     * @param data 消息数据(可能是对象或字符串)
     * @param currentSyncType 当前同步类型
     */
    public logSentMessage(action: string, data: object | string, currentSyncType: string): void {
        // 过滤不需要记录的消息类型 / Filter out unnecessary message types from logging
        const excludedActions = [
            "Ping", "Authorization", "ClientInfo", "FileUploadCheck", "FileChunkDownload", "NoteSyncNeedPush",
            "FolderSyncBatchAck", "NoteSyncBatchAck", "FileSyncBatchAck", "SettingSyncBatchAck",
            "FolderSyncPage", "NoteSyncPage", "FileSyncPage", "SettingSyncPage",
            "FolderSyncPageAck", "NoteSyncPageAck", "FileSyncPageAck", "SettingSyncPageAck"
        ];
        if (excludedActions.includes(action)) {
            return;
        }

        // 提取路径和 Vault 信息(仅当 data 是对象时)
        let logPath: string | undefined = undefined;
        let logVault: string | undefined = undefined;
        if (typeof data === "object" && data !== null) {
            const d = data as { Path?: string, path?: string, Vault?: string, vault?: string, data?: { Path?: string, path?: string, Vault?: string, vault?: string } };
            logPath = d.Path || d.path || d.data?.Path || d.data?.path;
            logVault = d.Vault || d.vault || d.data?.Vault || d.data?.vault;
        }

        // 根据消息类型调整 action 名称
        let logAction = action;
        if (["NoteSync", "FileSync", "SettingSync", "FolderSync"].includes(action)) {
            logAction = `${action}_${currentSyncType}`;
        }

        // 根据 action 类型判断状态:分片传输类指令标记为 pending,其他为 success
        const targetStatus: LogStatus = ['FileUpload', 'FileDownload', 'ConfigUpload'].includes(action) ? 'pending' : 'success';

        // 提取 sessionId
        const d = data as { sessionId?: string, SessionID?: string, data?: { sessionId?: string, SessionID?: string } };
        const sessionId = d?.sessionId || d?.SessionID || d?.data?.sessionId || d?.data?.SessionID;

        if (sessionId) {
            this.addOrUpdateLog({
                id: sessionId,
                type: 'send',
                action: logAction,
                status: targetStatus,
                path: logPath,
                vault: logVault,
            });
        } else {
            this.addLog('send', logAction, undefined, targetStatus, logPath, logVault);
        }
    }


    public async clearLogs() {
        this.logs.clear();
        this.failedCount = 0;
        this.unreadFailedCount = 0;
        this.notifyFailedCountListeners();
        this.notify();

        // 同时清空日志文件
        if (this.plugin && this.logFilePath) {
            try {
                await this.plugin.app.vault.adapter.write(this.logFilePath, "");
            } catch (e) {
                dumpError("Failed to clear sync log file:", e);
            }
        }
    }

    public getLogs(): SyncLog[] {
        // Map 按插入序（旧→新）迭代，反转后得到与原数组实现一致的“最新在前”顺序
        return Array.from(this.logs.values()).reverse();
    }

    public subscribe(listener: (logs: SyncLog[]) => void) {
        this.listeners.add(listener);
        listener(this.getLogs());
        return () => this.listeners.delete(listener);
    }

    private doNotify() {
        this.listeners.forEach(listener => listener(this.getLogs()));
    }

    /**
     * 节流合并通知：短时间内多次调用只会触发一次真实的监听器回调，
     * 但保证节流窗口结束后一定会用最新状态再触发一次（trailing）
     */
    private notify() {
        const now = Date.now();
        const elapsed = now - this.lastNotifyTime;

        if (elapsed >= this.NOTIFY_THROTTLE_MS) {
            this.lastNotifyTime = now;
            this.notifyPending = false;
            this.doNotify();
            return;
        }

        this.notifyPending = true;
        if (this.notifyTimer === null) {
            this.notifyTimer = window.setTimeout(() => {
                this.notifyTimer = null;
                if (this.notifyPending) {
                    this.notifyPending = false;
                    this.lastNotifyTime = Date.now();
                    this.doNotify();
                }
            }, this.NOTIFY_THROTTLE_MS - elapsed);
        }
    }

    private async persistToFile(log: SyncLog) {
        if (!this.plugin || !this.logFilePath) return;

        try {
            const timeStr = safeMoment(log.timestamp).format("YYYY-MM-DD HH:mm:ss");
            const typeStr = log.type.toUpperCase().padEnd(7);
            const categoryStr = log.category.toUpperCase().padEnd(12);
            const statusStr = log.status.toUpperCase().padEnd(8);
            const actionStr = log.action.padEnd(25);
            const pathStr = log.path ? ` [Path: ${log.path}]` : "";
            
            let msgStr = log.message ? ` [Msg: ${log.message.replace(/\n/g, ' ')}]` : "";
            // 如果是同步小结，将 JSON 格式化为易读的文本字符串写入文件
            // If it is a sync summary, format the JSON into an easy-to-read text string for the log file
            if (log.category === 'summary' && log.message) {
                try {
                    const stats = JSON.parse(log.message) as SyncSummaryStats;
                    const parts: string[] = [];
                    if (stats.note) parts.push(`Note(up:${stats.note.upload},recv:${stats.note.modify},del:${stats.note.delete})`);
                    if (stats.file) parts.push(`Attachment(up:${stats.file.upload},recv:${stats.file.modify},del:${stats.file.delete})`);
                    if (stats.config) parts.push(`Config(up:${stats.config.upload},recv:${stats.config.modify},del:${stats.config.delete})`);
                    msgStr = ` [Msg: Sync completed (${stats.syncType === 'full' ? 'Full' : 'Incremental'}): ${parts.join(', ')}]`;
                } catch {
                    // 解析失败时使用默认逻辑
                    // Fall back to default logic if parsing fails
                }
            }

            const line = `[${timeStr}] [${typeStr}] [${categoryStr}] [${statusStr}] ${actionStr}${pathStr}${msgStr}\n`;

            // 使用 Obsidian API 追加文件
            await this.plugin.app.vault.adapter.append(this.logFilePath, line);
        } catch (e) {
            dumpError("Failed to write sync log to file:", e);
        }
    }
}

