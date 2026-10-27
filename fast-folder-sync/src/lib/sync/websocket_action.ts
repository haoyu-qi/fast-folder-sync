/**
 * WebSocketMsgType WebSocket Binary message type
 * WebSocket 二进制消息类型
 */
export type WebSocketMsgType = string;

/**
 * VaultFileMsgType vault attachment message
 * 笔记库附件消息
 */
export const VaultFileMsgType: WebSocketMsgType = "00";

/**
 * WSReceiveAction WebSocket text receive action type (messages sent from server to client)
 * WSReceiveAction WebSocket 文本接收动作类型 (服务端发往客户端的消息动作)
 */
export type WSReceiveAction = string;

/**
 * WSSendAction WebSocket text send action type (messages sent from client to server)
 * WSSendAction WebSocket 文本发送动作类型 (客户端发往服务端的消息动作)
 */
export type WSSendAction = string;

// ==================== WSReceiveAction (服务端发往客户端，客户端接收) ====================

// ---------------- Client ----------------
/**
 * ClientInfo client info ack action / 客户端信息确认发送动作
 */
export const ClientInfo: WSReceiveAction = "ClientInfo";

// ---------------- Folder ----------------
/**
 * FolderSyncModify folder synchronization modification / 文件夹同步修改
 */
export const FolderSyncModify: WSReceiveAction = "FolderSyncModify";

/**
 * FolderSyncDelete folder synchronization deletion / 文件夹同步删除
 */
export const FolderSyncDelete: WSReceiveAction = "FolderSyncDelete";

/**
 * FolderSyncEnd folder synchronization finished / 文件夹同步结束
 */
export const FolderSyncEnd: WSReceiveAction = "FolderSyncEnd";

/**
 * FolderSyncRename folder rename action / 文件夹同步重命名
 */
export const FolderSyncRename: WSReceiveAction = "FolderSyncRename";

/**
 * FolderModifyAck folder modify operation ack / 文件夹修改操作 ack
 */
export const FolderModifyAck: WSReceiveAction = "FolderModifyAck";

/**
 * FolderSyncBatchAck folder sync batch receive ack / 文件夹分批同步接收确认
 * Sent by server after receiving a non-final folder sync batch, signaling client to send next batch.
 * 服务端接收到中间批次后发回，通知客户端可以发送下一批数据。
 */
export const FolderSyncBatchAck: WSReceiveAction = "FolderSyncBatchAck";

/**
 * FolderRenameAck folder rename operation ack / 文件夹重命名操作 ack
 */
export const FolderRenameAck: WSReceiveAction = "FolderRenameAck";

/**
 * FolderDeleteAck folder delete operation ack / 文件夹删除操作 ack
 */
export const FolderDeleteAck: WSReceiveAction = "FolderDeleteAck";

// ---------------- Note ----------------
/**
 * NoteSyncModify note synchronization modification / 笔记同步修改
 */
export const NoteSyncModify: WSReceiveAction = "NoteSyncModify";

/**
 * NoteSyncDelete note synchronization deletion / 笔记同步删除
 */
export const NoteSyncDelete: WSReceiveAction = "NoteSyncDelete";

/**
 * NoteSyncRename note synchronization rename / 笔记同步重命名
 */
export const NoteSyncRename: WSReceiveAction = "NoteSyncRename";

/**
 * NoteSyncMtime note modification time synchronization / 笔记修改时间同步
 */
export const NoteSyncMtime: WSReceiveAction = "NoteSyncMtime";

/**
 * NoteSyncEnd note synchronization finished / 笔记同步结束
 */
export const NoteSyncEnd: WSReceiveAction = "NoteSyncEnd";

/**
 * NoteSyncNeedPush indicates client needs to push note content / 表示客户端需要推送笔记内容
 */
export const NoteSyncNeedPush: WSReceiveAction = "NoteSyncNeedPush";

/**
 * NoteModifyAck note modify operation ack / 笔记修改操作 ack
 */
export const NoteModifyAck: WSReceiveAction = "NoteModifyAck";

/**
 * NoteRenameAck note rename operation ack / 笔记重命名操作 ack
 */
export const NoteRenameAck: WSReceiveAction = "NoteRenameAck";

/**
 * NoteDeleteAck note delete operation ack / 笔记删除操作 ack
 */
export const NoteDeleteAck: WSReceiveAction = "NoteDeleteAck";

/**
 * NoteSyncBatchAck note sync batch receive ack / 笔记分批同步接收确认
 * Sent by server after receiving a non-final note sync batch, signaling client to send next batch.
 * 服务端接收到中间批次后发回，通知客户端可以发送下一批数据。
 */
export const NoteSyncBatchAck: WSReceiveAction = "NoteSyncBatchAck";

// ---------------- File ----------------
/**
 * FileSyncUpdate file synchronization update / 文件同步更新
 */
export const FileSyncUpdate: WSReceiveAction = "FileSyncUpdate";

/**
 * FileSyncDelete file synchronization deletion / 文件同步删除
 */
export const FileSyncDelete: WSReceiveAction = "FileSyncDelete";

/**
 * FileSyncRename file synchronization rename / 文件同步重命名
 */
export const FileSyncRename: WSReceiveAction = "FileSyncRename";

/**
 * FileSyncMtime file modification time synchronization / 文件修改时间同步
 */
export const FileSyncMtime: WSReceiveAction = "FileSyncMtime";

/**
 * FileSyncEnd file synchronization finished / 文件同步结束
 */
export const FileSyncEnd: WSReceiveAction = "FileSyncEnd";

/**
 * FileUpload file upload action / 文件上传动作
 */
export const FileUpload: WSReceiveAction = "FileUpload";

/**
 * FileSyncChunkDownload file chunk download for sync / 同步时的文件块下载
 */
export const FileSyncChunkDownload: WSReceiveAction = "FileSyncChunkDownload";

/**
 * FileRenameAck file rename operation ack / 文件重命名操作 ack
 */
export const FileRenameAck: WSReceiveAction = "FileRenameAck";

/**
 * FileUploadAck file upload complete ack / 文件上传完成 ack
 */
export const FileUploadAck: WSReceiveAction = "FileUploadAck";

/**
 * FileDeleteAck file delete operation ack / 文件删除操作 ack
 */
export const FileDeleteAck: WSReceiveAction = "FileDeleteAck";

/**
 * FileSyncBatchAck file sync batch receive ack / 附件分批同步接收确认
 * Sent by server after receiving a non-final file sync batch, signaling client to send next batch.
 * 服务端接收到中间批次后发回，通知客户端可以发送下一批数据。
 */
export const FileSyncBatchAck: WSReceiveAction = "FileSyncBatchAck";

// ---------------- Setting ----------------
/**
 * SettingSyncModify setting synchronization modification / 设置同步修改
 */
export const SettingSyncModify: WSReceiveAction = "SettingSyncModify";

/**
 * SettingSyncDelete setting synchronization deletion / 设置同步删除
 */
export const SettingSyncDelete: WSReceiveAction = "SettingSyncDelete";

/**
 * SettingSyncMtime setting modification time synchronization / 设置修改时间同步
 */
export const SettingSyncMtime: WSReceiveAction = "SettingSyncMtime";

/**
 * SettingSyncEnd setting synchronization finished / 设置同步结束
 */
export const SettingSyncEnd: WSReceiveAction = "SettingSyncEnd";

/**
 * SettingSyncNeedUpload indicates client needs to upload setting / 表示客户端需要上传设置
 */
export const SettingSyncNeedUpload: WSReceiveAction = "SettingSyncNeedUpload";

/**
 * SettingSyncClear sync clear all settings / 同步清理所有设置
 */
export const SettingSyncClear: WSReceiveAction = "SettingSyncClear";

/**
 * SettingModifyAck setting modify operation ack / 设置修改操作 ack
 */
export const SettingModifyAck: WSReceiveAction = "SettingModifyAck";

/**
 * SettingDeleteAck setting delete operation ack / 设置删除操作 ack
 */
export const SettingDeleteAck: WSReceiveAction = "SettingDeleteAck";

/**
 * SettingSyncBatchAck setting sync batch receive ack / 配置分批同步接收确认
 * Sent by server after receiving a non-final setting sync batch, signaling client to send next batch.
 * 服务端接收到中间批次后发回，通知客户端可以发送下一批数据。
 */
export const SettingSyncBatchAck: WSReceiveAction = "SettingSyncBatchAck";

/**
 * FolderSyncPage folder sync page notification / 文件夹同步分页通知
 */
export const FolderSyncPage: WSReceiveAction = "FolderSyncPage";

/**
 * NoteSyncPage note sync page notification / 笔记同步分页通知
 */
export const NoteSyncPage: WSReceiveAction = "NoteSyncPage";

/**
 * FileSyncPage file sync page notification / 文件同步分页通知
 */
export const FileSyncPage: WSReceiveAction = "FileSyncPage";

/**
 * SettingSyncPage setting sync page notification / 配置同步分页通知
 */
export const SettingSyncPage: WSReceiveAction = "SettingSyncPage";

// ---------------- Share ----------------
/**
 * ShareSyncRefresh notify clients to refresh share state / 通知客户端刷新分享状态
 */
export const ShareSyncRefresh: WSReceiveAction = "ShareSyncRefresh";


// ==================== WSSendAction (客户端发往服务端，服务端接收) ====================

// ---------------- Client ----------------
/**
 * ClientReceiveInfo client info action / 客户端信息接收动作
 */
export const ClientReceiveInfo: WSSendAction = "ClientInfo";

/**
 * ClientReceiveAuth client authorization action / 客户端鉴权接收动作
 */
export const ClientReceiveAuth: WSSendAction = "Authorization";

// ---------------- Folder ----------------
/**
 * FolderReceiveSync folder synchronization request / 文件夹同步请求
 */
export const FolderReceiveSync: WSSendAction = "FolderSync";

/**
 * FolderReceiveModify folder modify or create request / 文件夹修改或创建请求
 */
export const FolderReceiveModify: WSSendAction = "FolderModify";

/**
 * FolderReceiveDelete folder delete request / 文件夹删除请求
 */
export const FolderReceiveDelete: WSSendAction = "FolderDelete";

/**
 * FolderReceiveRename folder rename request / 文件夹重命名请求
 */
export const FolderReceiveRename: WSSendAction = "FolderRename";

// ---------------- Note ----------------
/**
 * NoteReceiveSync note synchronization request / 笔记同步请求
 */
export const NoteReceiveSync: WSSendAction = "NoteSync";

/**
 * NoteReceiveModify note modify or create request / 笔记修改或创建请求
 */
export const NoteReceiveModify: WSSendAction = "NoteModify";

/**
 * NoteReceiveDelete note delete request / 笔记删除请求
 */
export const NoteReceiveDelete: WSSendAction = "NoteDelete";

/**
 * NoteReceiveRename note rename request / 笔记重命名请求
 */
export const NoteReceiveRename: WSSendAction = "NoteRename";

/**
 * NoteReceiveCheck note modification check request / 笔记修改检查请求
 */
export const NoteReceiveCheck: WSSendAction = "NoteCheck";

/**
 * NoteReceiveRePush Note missing pull request / 笔记缺失请求拉取
 */
export const NoteReceiveRePush: WSSendAction = "NoteRePush";

// ---------------- File ----------------
/**
 * FileReceiveSync file synchronization request / 文件同步请求
 */
export const FileReceiveSync: WSSendAction = "FileSync";

/**
 * FileReceiveUploadCheck file upload pre-check request / 文件上传前检查请求
 */
export const FileReceiveUploadCheck: WSSendAction = "FileUploadCheck";

/**
 * FileReceiveDelete file delete request / 文件删除请求
 */
export const FileReceiveDelete: WSSendAction = "FileDelete";

/**
 * FileReceiveRename file rename request / 文件重命名请求
 */
export const FileReceiveRename: WSSendAction = "FileRename";

/**
 * FileReceiveChunkDownload file chunk download request / 文件分片下载请求
 */
export const FileReceiveChunkDownload: WSSendAction = "FileChunkDownload";

/**
 * FileReceiveRePush file missing pull request / 文件缺失请求拉取
 */
export const FileReceiveRePush: WSSendAction = "FileRePush";

// ---------------- Setting ----------------
/**
 * SettingReceiveSync setting synchronization request / 设置同步请求
 */
export const SettingReceiveSync: WSSendAction = "SettingSync";

/**
 * SettingReceiveModify setting modify or create request / 设置修改或创建请求
 */
export const SettingReceiveModify: WSSendAction = "SettingModify";

/**
 * SettingReceiveDelete setting delete request / 设置删除请求
 */
export const SettingReceiveDelete: WSSendAction = "SettingDelete";

/**
 * SettingReceiveCheck setting modification check request / 设置修改检查请求
 */
export const SettingReceiveCheck: WSSendAction = "SettingCheck";

/**
 * SettingReceiveClear clear all settings request / 清理所有设置请求
 */
export const SettingReceiveClear: WSSendAction = "SettingClear";

/**
 * SettingReceiveRePush setting missing pull request / 配置缺失请求拉取
 */
export const SettingReceiveRePush: WSSendAction = "SettingRePush";

/**
 * FolderSyncPageAck folder sync page ack / 文件夹同步分页确认
 */
export const FolderSyncPageAck: WSSendAction = "FolderSyncPageAck";

/**
 * NoteSyncPageAck note sync page ack / 笔记同步分页确认
 */
export const NoteSyncPageAck: WSSendAction = "NoteSyncPageAck";

/**
 * FileSyncPageAck file sync page ack / 文件同步分页确认
 */
export const FileSyncPageAck: WSSendAction = "FileSyncPageAck";

/**
 * SettingSyncPageAck setting sync page ack / 配置同步分页确认
 */
export const SettingSyncPageAck: WSSendAction = "SettingSyncPageAck";


/**
 * WSQueuedMessage represents a message item to be sent
 * WSQueuedMessage used to collect messages during sync process, and sent together in SyncEnd message
 * WSQueuedMessage 表示待发送的消息项
 * WSQueuedMessage 用于在同步过程中收集消息,在 SyncEnd 消息中统一合并发送
 */
export interface WSQueuedMessage {
    action: string;    // Message action/type // 消息动作/类型
    data: unknown;     // Message data payload // 消息数据负载
    context: string;   // Context // 上下文
}

