import * as WSAction from "../lib/sync/websocket_action";
import { proto } from "./v1/sync";


/**
 * This module provides mapping and translation between raw JSON DTOs and Protobuf messages.
 * 本模块提供原始 JSON DTO 与 Protobuf 消息之间的映射与互转。
 */

/**
 * Encodes payload into specific Protobuf binary message depending on the action.
 * 根据动作类型将载荷编码为特定的 Protobuf 二进制消息。
 */
function enSendDataPayload(action: WSAction.WSSendAction, payload: unknown): Uint8Array {
    if (payload === null || payload === undefined) {
        return new Uint8Array(0);
    }
    const properties = payload as Record<string, unknown>;
    switch (action) {
        case WSAction.ClientReceiveInfo: {
            const msg = proto.v1.ClientInfoMessage.create(properties);
            return proto.v1.ClientInfoMessage.encode(msg).finish();
        }
        case WSAction.NoteReceiveSync: {
            const msg = proto.v1.NoteSyncRequest.create(properties);
            return proto.v1.NoteSyncRequest.encode(msg).finish();
        }
        case WSAction.NoteReceiveModify: {
            const msg = proto.v1.NoteModifyOrCreateRequest.create(properties);
            return proto.v1.NoteModifyOrCreateRequest.encode(msg).finish();
        }
        case WSAction.NoteReceiveCheck: {
            const msg = proto.v1.NoteUpdateCheckRequest.create(properties);
            return proto.v1.NoteUpdateCheckRequest.encode(msg).finish();
        }
        case WSAction.NoteReceiveDelete: {
            const msg = proto.v1.NoteDeleteRequest.create(properties);
            return proto.v1.NoteDeleteRequest.encode(msg).finish();
        }
        case WSAction.NoteReceiveRename: {
            const msg = proto.v1.NoteRenameRequest.create(properties);
            return proto.v1.NoteRenameRequest.encode(msg).finish();
        }
        case WSAction.NoteReceiveRePush: {
            const msg = proto.v1.NoteGetRequest.create(properties);
            return proto.v1.NoteGetRequest.encode(msg).finish();
        }
        case WSAction.FileReceiveSync: {
            const msg = proto.v1.FileSyncRequest.create(properties);
            return proto.v1.FileSyncRequest.encode(msg).finish();
        }
        case WSAction.FileReceiveUploadCheck: {
            const msg = proto.v1.FileUploadCheckRequest.create(properties);
            return proto.v1.FileUploadCheckRequest.encode(msg).finish();
        }
        case WSAction.FileReceiveDelete: {
            const msg = proto.v1.FileDeleteRequest.create(properties);
            return proto.v1.FileDeleteRequest.encode(msg).finish();
        }
        case WSAction.FileReceiveRename: {
            const msg = proto.v1.FileRenameRequest.create(properties);
            return proto.v1.FileRenameRequest.encode(msg).finish();
        }
        case WSAction.FileReceiveChunkDownload: {
            const msg = proto.v1.FileChunkDownloadRequest.create(properties);
            return proto.v1.FileChunkDownloadRequest.encode(msg).finish();
        }
        case WSAction.FileReceiveRePush: {
            const msg = proto.v1.FileGetRequest.create(properties);
            return proto.v1.FileGetRequest.encode(msg).finish();
        }
        case WSAction.SettingReceiveSync: {
            const msg = proto.v1.SettingSyncRequest.create(properties);
            return proto.v1.SettingSyncRequest.encode(msg).finish();
        }
        case WSAction.SettingReceiveModify: {
            const msg = proto.v1.SettingModifyOrCreateRequest.create(properties);
            return proto.v1.SettingModifyOrCreateRequest.encode(msg).finish();
        }
        case WSAction.SettingReceiveCheck: {
            const msg = proto.v1.SettingUpdateCheckRequest.create(properties);
            return proto.v1.SettingUpdateCheckRequest.encode(msg).finish();
        }
        case WSAction.SettingReceiveDelete: {
            const msg = proto.v1.SettingDeleteRequest.create(properties);
            return proto.v1.SettingDeleteRequest.encode(msg).finish();
        }
        case WSAction.SettingReceiveClear: {
            const msg = proto.v1.SettingClearRequest.create(properties);
            return proto.v1.SettingClearRequest.encode(msg).finish();
        }
        case WSAction.SettingReceiveRePush: {
            const msg = proto.v1.SettingGetRequest.create(properties);
            return proto.v1.SettingGetRequest.encode(msg).finish();
        }
        case WSAction.FolderReceiveSync: {
            const msg = proto.v1.FolderSyncRequest.create(properties);
            return proto.v1.FolderSyncRequest.encode(msg).finish();
        }
        case WSAction.FolderReceiveModify: {
            const msg = proto.v1.FolderCreateRequest.create(properties);
            return proto.v1.FolderCreateRequest.encode(msg).finish();
        }
        case WSAction.FolderReceiveDelete: {
            const msg = proto.v1.FolderDeleteRequest.create(properties);
            return proto.v1.FolderDeleteRequest.encode(msg).finish();
        }
        case WSAction.FolderReceiveRename: {
            const msg = proto.v1.FolderRenameRequest.create(properties);
            return proto.v1.FolderRenameRequest.encode(msg).finish();
        }
        case WSAction.FolderSyncPageAck: {
            const msg = proto.v1.FolderSyncPageAckRequest.create(properties);
            return proto.v1.FolderSyncPageAckRequest.encode(msg).finish();
        }
        case WSAction.NoteSyncPageAck: {
            const msg = proto.v1.NoteSyncPageAckRequest.create(properties);
            return proto.v1.NoteSyncPageAckRequest.encode(msg).finish();
        }
        case WSAction.FileSyncPageAck: {
            const msg = proto.v1.FileSyncPageAckRequest.create(properties);
            return proto.v1.FileSyncPageAckRequest.encode(msg).finish();
        }
        case WSAction.SettingSyncPageAck: {
            const msg = proto.v1.SettingSyncPageAckRequest.create(properties);
            return proto.v1.SettingSyncPageAckRequest.encode(msg).finish();
        }
        default: {
            // Fallback to JSON encoding if not supported explicitly in proto definitions
            // 对于 proto 定义中未明确支持的消息，降级使用 JSON 编码
            const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
            return new TextEncoder().encode(jsonStr);
        }
    }
}

/**
 * Decodes specific Protobuf binary message depending on the action.
 * 根据动作类型解码特定的 Protobuf 二进制消息。
 */
function deReceiveProtobufToDTO(action: WSAction.WSReceiveAction, data: Uint8Array): unknown {
    if (!data || data.length === 0) {
        return null;
    }
    const tryJsonDecode = (): unknown => {
        try {
            const jsonStr = new TextDecoder().decode(data);
            return JSON.parse(jsonStr) as unknown;
        } catch {
            return null;
        }
    };
    switch (action) {
        case WSAction.ClientInfo: {
            try {
                return proto.v1.CheckVersionInfo.toObject(
                    proto.v1.CheckVersionInfo.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteSyncModify: {
            try {
                return proto.v1.NoteSyncModifyMessage.toObject(
                    proto.v1.NoteSyncModifyMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteSyncDelete: {
            try {
                return proto.v1.NoteSyncDeleteMessage.toObject(
                    proto.v1.NoteSyncDeleteMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteSyncRename: {
            try {
                return proto.v1.NoteSyncRenameMessage.toObject(
                    proto.v1.NoteSyncRenameMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteSyncMtime: {
            try {
                return proto.v1.NoteSyncMtimeMessage.toObject(
                    proto.v1.NoteSyncMtimeMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteSyncEnd: {
            try {
                return proto.v1.NoteSyncEndMessage.toObject(
                    proto.v1.NoteSyncEndMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteSyncNeedPush: {
            try {
                return proto.v1.NoteSyncNeedPushMessage.toObject(
                    proto.v1.NoteSyncNeedPushMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteModifyAck: {
            try {
                return proto.v1.NoteModifyAckMessage.toObject(
                    proto.v1.NoteModifyAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteRenameAck: {
            try {
                return proto.v1.NoteRenameAckMessage.toObject(
                    proto.v1.NoteRenameAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteDeleteAck: {
            try {
                return proto.v1.NoteDeleteAckMessage.toObject(
                    proto.v1.NoteDeleteAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileSyncUpdate: {
            try {
                return proto.v1.FileSyncModifyMessage.toObject(
                    proto.v1.FileSyncModifyMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileSyncDelete: {
            try {
                return proto.v1.FileSyncDeleteMessage.toObject(
                    proto.v1.FileSyncDeleteMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileSyncRename: {
            try {
                return proto.v1.FileSyncRenameMessage.toObject(
                    proto.v1.FileSyncRenameMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileSyncMtime: {
            try {
                return proto.v1.FileSyncMtimeMessage.toObject(
                    proto.v1.FileSyncMtimeMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileSyncEnd: {
            try {
                return proto.v1.FileSyncEndMessage.toObject(
                    proto.v1.FileSyncEndMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileUpload: {
            try {
                const pbObj = proto.v1.FileSyncUploadMessage.toObject(
                    proto.v1.FileSyncUploadMessage.decode(data),
                    { defaults: true, longs: Number }
                ) as proto.v1.FileSyncUploadMessage.$Properties;
                return {
                    path: pbObj.path,
                    pathHash: pbObj.pathHash,
                    sessionId: pbObj.sessionId,
                    chunkSize: pbObj.chunkSize
                };
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileSyncChunkDownload: {
            try {
                const pbObj = proto.v1.FileSyncDownloadMessage.toObject(
                    proto.v1.FileSyncDownloadMessage.decode(data),
                    { defaults: true, longs: Number }
                ) as proto.v1.FileSyncDownloadMessage.$Properties;
                return {
                    path: pbObj.path,
                    contentHash: pbObj.contentHash,
                    ctime: pbObj.ctime,
                    mtime: pbObj.mtime,
                    sessionId: pbObj.sessionId,
                    chunkSize: pbObj.chunkSize,
                    totalChunks: pbObj.totalChunks,
                    size: pbObj.size
                };
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileRenameAck: {
            try {
                return proto.v1.FileRenameAckMessage.toObject(
                    proto.v1.FileRenameAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileUploadAck: {
            try {
                return proto.v1.FileUploadAckMessage.toObject(
                    proto.v1.FileUploadAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileDeleteAck: {
            try {
                return proto.v1.FileDeleteAckMessage.toObject(
                    proto.v1.FileDeleteAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingSyncModify: {
            try {
                return proto.v1.SettingSyncModifyMessage.toObject(
                    proto.v1.SettingSyncModifyMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingSyncDelete: {
            try {
                return proto.v1.SettingSyncDeleteMessage.toObject(
                    proto.v1.SettingSyncDeleteMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingSyncMtime: {
            try {
                return proto.v1.SettingSyncMtimeMessage.toObject(
                    proto.v1.SettingSyncMtimeMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingSyncEnd: {
            try {
                return proto.v1.SettingSyncEndMessage.toObject(
                    proto.v1.SettingSyncEndMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingSyncNeedUpload: {
            try {
                return proto.v1.SettingSyncNeedUploadMessage.toObject(
                    proto.v1.SettingSyncNeedUploadMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingModifyAck: {
            try {
                return proto.v1.SettingModifyAckMessage.toObject(
                    proto.v1.SettingModifyAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingDeleteAck: {
            try {
                return proto.v1.SettingDeleteAckMessage.toObject(
                    proto.v1.SettingDeleteAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingSyncClear: {
            return null;
        }
        case WSAction.FolderSyncModify: {
            try {
                return proto.v1.FolderSyncModifyMessage.toObject(
                    proto.v1.FolderSyncModifyMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FolderSyncDelete: {
            try {
                return proto.v1.FolderSyncDeleteMessage.toObject(
                    proto.v1.FolderSyncDeleteMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FolderSyncRename: {
            try {
                return proto.v1.FolderSyncRenameMessage.toObject(
                    proto.v1.FolderSyncRenameMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FolderSyncEnd: {
            try {
                return proto.v1.FolderSyncEndMessage.toObject(
                    proto.v1.FolderSyncEndMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FolderModifyAck: {
            try {
                return proto.v1.FolderModifyAckMessage.toObject(
                    proto.v1.FolderModifyAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FolderDeleteAck: {
            try {
                return proto.v1.FolderDeleteAckMessage.toObject(
                    proto.v1.FolderDeleteAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FolderRenameAck: {
            try {
                return proto.v1.FolderRenameAckMessage.toObject(
                    proto.v1.FolderRenameAckMessage.decode(data),
                    { defaults: true, longs: Number }
                );
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.NoteSyncPage: {
            try {
                const pbObj = proto.v1.NoteSyncPageMessage.decode(data);
                return proto.v1.NoteSyncPageMessage.toObject(pbObj, { defaults: true, longs: Number });
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FileSyncPage: {
            try {
                const pbObj = proto.v1.FileSyncPageMessage.decode(data);
                return proto.v1.FileSyncPageMessage.toObject(pbObj, { defaults: true, longs: Number });
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.SettingSyncPage: {
            try {
                const pbObj = proto.v1.SettingSyncPageMessage.decode(data);
                return proto.v1.SettingSyncPageMessage.toObject(pbObj, { defaults: true, longs: Number });
            } catch {
                return tryJsonDecode();
            }
        }
        case WSAction.FolderSyncPage: {
            try {
                const pbObj = proto.v1.FolderSyncPageMessage.decode(data);
                return proto.v1.FolderSyncPageMessage.toObject(pbObj, { defaults: true, longs: Number });
            } catch {
                return tryJsonDecode();
            }
        }
        default:
            // Fallback to JSON decoding if not supported explicitly in proto definitions
            // 对于 proto 定义中未明确支持的消息，降级使用 JSON 解码
            return tryJsonDecode();
    }
}

/**
 * Encodes DTO and action into a complete WSMessage Protobuf packet for sending.
 * 将 DTO 与动作编码为完整的 WSMessage Protobuf 报文以供发送。
 */
export function enSendDTOToProtobuf(action: WSAction.WSSendAction, payload: unknown): Uint8Array {
    const innerBytes = enSendDataPayload(action, payload);
    const wsMsg = proto.v1.WSMessage.create({
        type: action,
        data: innerBytes
    });
    return proto.v1.WSMessage.encode(wsMsg).finish();
}

export interface DeserializedWSResponse {
    action: WSAction.WSReceiveAction;
    code: number;
    status: boolean;
    message: string;
    data: unknown;
    details: string;
    vault: string;
    context: string;
    // WSResponse 信封 pageIndex，线上值为 1-based：0/undefined=非分页消息，n>0=下载第 n-1 页。
    // 原始值在此透传，1-based→0-based 的转换统一在 websocket_manager.ts 做（见其注释）。
    // WSResponse envelope pageIndex, wire value is 1-based: 0/undefined=non-paginated message,
    // n>0=download page n-1. Passed through raw here; the 1-based->0-based conversion is done in
    // one place, websocket_manager.ts (see its comment).
    pageIndex: number;
}

/**
 * Unpacks the outer WSMessage packet and decodes the inner response payload.
 * 解包最外层 WSMessage 报文并解码内层响应数据。
 */
export function deReceivePacket(data: Uint8Array): DeserializedWSResponse {
    const wsMsg = proto.v1.WSMessage.decode(data);
    const action: WSAction.WSReceiveAction = wsMsg.type || "";

    const wsResp = proto.v1.WSResponse.decode(wsMsg.data);

    const dtoData = deReceiveProtobufToDTO(action, wsResp.data);

    return {
        action: action,
        code: wsResp.code || 0,
        status: wsResp.status || false,
        message: wsResp.message || "",
        data: dtoData,
        details: wsResp.details || "",
        vault: wsResp.vault || "",
        context: wsResp.context || "",
        pageIndex: wsResp.pageIndex || 0
    };
}

