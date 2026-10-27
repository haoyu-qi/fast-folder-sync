import { App, Modal, setIcon, ButtonComponent, setTooltip } from "obsidian";

import { ConfirmModal } from "./confirm-modal";
import { ShareModal } from "./share-modal";
import { showSyncNotice, dumpError } from "../lib/utils/helpers";
import { HttpApiService, ShareListItem } from "../lib/api/http_api_service";
import type FastSync from "../main";
import { $ } from "../i18n/lang";

// Go 零值时间序列化后的 ISO 字符串，表示服务端未设置过期时间（永久有效）
function formatExpiresAt(iso?: string): string {
    if (!iso) return $("ui.share.expire.never");
    const ts = new Date(iso).getTime();
    if (isNaN(ts) || ts <= 0) return $("ui.share.expire.never");
    return new Date(ts).toLocaleString();
}

export class ShareManageModal extends Modal {
    private plugin: FastSync;
    private api: HttpApiService;
    private page: number = 1;
    private pageSize: number = 20;
    private totalRows: number = 0;
    private items: ShareListItem[] = [];
    private loading: boolean = false;
    private abortController: AbortController | null = null;

    constructor(app: App, plugin: FastSync) {
        super(app);
        this.plugin = plugin;
        this.api = new HttpApiService(plugin);
    }

    onOpen() {
        void this.loadData();
    }

    onClose() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        const { contentEl } = this;
        contentEl.empty();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("fns-share-manage-modal");
        this.containerEl.addClass("fns-modal-wide");

        this.titleEl.innerText = $("ui.share_manage.title");

        const listContainer = contentEl.createDiv("fns-list-container");
        this.renderList(listContainer);
    }

    private renderList(listContainer: HTMLElement) {
        listContainer.empty();

        if (!this.plugin.websocket || !this.plugin.websocket.isAuth) {
            const emptyState = listContainer.createDiv({ cls: "fns-empty-state fns-offline-state" });
            emptyState.addClass("fns-text-center", "fns-muted-text");
            emptyState.setCssProps({
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                minHeight: "250px"
            });
            const emptyIcon = emptyState.createDiv();
            emptyIcon.addClass("fns-margin-b-15", "fns-opacity-6");
            setIcon(emptyIcon, "wifi-off");
            const emptyText = emptyState.createDiv();
            emptyText.addClass("fns-font-lg");
            emptyText.innerText = $("setting.remote.disconnected");
            return;
        }

        if (this.loading && (!this.items || this.items.length === 0)) {
            const loadingDiv = listContainer.createDiv("fns-loading");
            loadingDiv.addClass("fns-padding-40", "fns-text-center");
            loadingDiv.innerText = $("ui.history.loading");
            return;
        }

        if (!this.items || this.items.length === 0) {
            const emptyState = listContainer.createDiv({ cls: "fns-empty-state" });
            emptyState.addClass("fns-text-center", "fns-muted-text");
            emptyState.setCssProps({
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                minHeight: "250px"
            });
            const emptyIcon = emptyState.createDiv();
            emptyIcon.addClass("fns-margin-b-15", "fns-opacity-6");
            setIcon(emptyIcon, "share-2");
            const emptyText = emptyState.createDiv();
            emptyText.addClass("fns-font-lg");
            emptyText.innerText = $("ui.share_manage.empty");
            return;
        }

        this.items.forEach(item => {
            this.renderItem(listContainer, item);
        });

        listContainer.addEventListener("scroll", () => {
            if (this.loading || this.items.length >= this.totalRows) return;
            if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 50) {
                this.page++;
                void this.loadData(true);
            }
        });

        if (this.items.length < this.totalRows) {
            const loadMoreDiv = listContainer.createDiv("fns-load-more");
            loadMoreDiv.addClass("fns-text-center", "fns-padding-20");
            if (this.loading) {
                loadMoreDiv.innerText = $("ui.history.loading");
            } else {
                new ButtonComponent(loadMoreDiv)
                    .setButtonText($("ui.recycle_bin.load_more"))
                    .onClick(() => {
                        this.page++;
                        void this.loadData(true);
                    });
            }
        }
    }

    private renderItem(container: HTMLElement, item: ShareListItem) {
        const itemDiv = container.createDiv("fns-share-manage-item");
        itemDiv.addClass("fns-flex-between", "fns-padding-8-10", "fns-border-b");

        const leftDiv = itemDiv.createDiv();
        leftDiv.addClass("fns-flex", "fns-items-center", "fns-gap-8", "fns-overflow-hidden", "fns-flex-1");

        const iconDiv = leftDiv.createDiv();
        setIcon(iconDiv, "file-text");

        const infoDiv = leftDiv.createDiv();
        infoDiv.addClass("fns-flex", "fns-flex-col", "fns-overflow-hidden", "fns-flex-1");

        const nameEl = infoDiv.createDiv();
        nameEl.innerText = item.notePath || item.title;
        nameEl.addClass("fns-font-bold", "fns-no-wrap", "fns-overflow-hidden", "fns-text-ellipsis");
        nameEl.title = item.notePath || item.title;

        const metaEl = infoDiv.createDiv();
        metaEl.addClass("fns-font-sm", "fns-muted-text");
        const isCancelled = item.status === 2;
        const statusText = isCancelled ? $("ui.share_manage.status_cancelled") : $("ui.share_manage.status_active");
        const pwdText = item.isPassword ? $("ui.share_manage.has_password") : $("ui.share_manage.no_password");
        metaEl.innerText = `${statusText}  |  ${pwdText}  |  ${$("ui.share.expire.current")}: ${formatExpiresAt(item.expiresAt)}`;

        const rightDiv = itemDiv.createDiv();
        rightDiv.addClass("fns-flex", "fns-gap-5");

        const shareUrl = `${item.baseUrl || ""}${item.url || ""}`;

        new ButtonComponent(rightDiv)
            .setIcon("copy")
            .setTooltip($("ui.share.copy"))
            .onClick(() => {
                void navigator.clipboard.writeText(shareUrl);
                showSyncNotice($("ui.share.copy_success"));
            });

        const editBtn = new ButtonComponent(rightDiv)
            .setButtonText($("ui.share_manage.edit"))
            .setDisabled(isCancelled);
        setTooltip(editBtn.buttonEl, $("ui.share_manage.edit"));
        editBtn.onClick(() => {
            new ShareModal(this.app, this.plugin, item.notePath).open();
        });

        const cancelBtn = new ButtonComponent(rightDiv)
            .setButtonText($("ui.share.cancel"))
            .setCta()
            .setDisabled(isCancelled);
        cancelBtn.onClick(() => {
            new ConfirmModal(
                this.app,
                $("ui.share.cancel"),
                $("ui.share_manage.cancel_confirm"),
                () => {
                    void this.cancelItem(item);
                },
                undefined,
                undefined,
                false
            ).open();
        });
    }

    private async cancelItem(item: ShareListItem) {
        const success = await this.api.cancelShare(item.notePath);
        if (success) {
            showSyncNotice($("ui.share.cancel_success"));
            void this.plugin.shareIndicatorManager?.removeSharedPath(item.notePath);
            this.page = 1;
            await this.loadData();
        }
    }

    private async loadData(append: boolean = false) {
        if (this.abortController) {
            this.abortController.abort();
        }

        if (!this.plugin.websocket || !this.plugin.websocket.isAuth) {
            this.render();
            return;
        }

        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        this.loading = true;
        this.render();

        try {
            const res = await this.api.listShares(this.page, this.pageSize, "created_at", "desc", signal);
            if (append) {
                this.items = [...(this.items || []), ...res.list];
            } else {
                this.items = res.list;
            }
            this.totalRows = res.pager?.totalRows || 0;
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
                return;
            }
            showSyncNotice($("ui.history.load_failed"));
            dumpError("Failed to load share list", e);
        } finally {
            if (!signal.aborted) {
                this.loading = false;
                this.render();
            }
        }
    }
}

