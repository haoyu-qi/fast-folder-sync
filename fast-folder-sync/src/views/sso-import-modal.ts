import { App, Modal, setIcon, ButtonComponent } from "obsidian";

import { $ } from "../i18n/lang";


export interface SsoImportData {
    pushApi: string;
    pushApiToken?: string;
    pushVault?: string;
}

/**
 * SSO 配置导入确认弹窗
 * Structured confirmation modal for SSO config import via obsidian:// protocol
 *
 * @param isHighRisk - true: show red warning UI (untrusted server);
 *                     false: show neutral/info UI (empty config or same domain)
 */
export class SsoImportModal extends Modal {
    private data: SsoImportData;
    private onConfirm: () => void;
    private isHighRisk: boolean;
    private isTokenVisible: boolean = false;

    constructor(app: App, data: SsoImportData, onConfirm: () => void, isHighRisk = true) {
        super(app);
        this.data = data;
        this.onConfirm = onConfirm;
        this.isHighRisk = isHighRisk;
    }

    onOpen() {
        this.render();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("fns-sso-modal");

        // ── 顶部 Title Group ──────────────────────────────────────────
        this.titleEl.empty();
        const headerContainer = this.titleEl.createDiv("fns-share-header-group");
        const titleIcon = headerContainer.createSpan("fns-share-title-icon");
        setIcon(titleIcon, this.isHighRisk ? "shield-alert" : "shield-check");
        if (this.isHighRisk) {
            titleIcon.addClass("fns-sso-title-icon--warning");
        } else {
            titleIcon.addClass("fns-sso-title-icon--safe");
        }
        headerContainer.createSpan({
            text: this.isHighRisk
                ? ($("ui.sso.banner_title_warning") || "远端服务同步配置导入")
                : ($("ui.sso.banner_title_safe") || "远端服务同步配置导入")
        });

        // ── Container ───────────────────────────────────────────────
        const container = contentEl.createDiv("fns-share-container");

        // ── Subtitle / Badge ────────────────────────────────────────
        const subtitleBadge = container.createDiv("fns-file-badge");
        const badgeIcon = subtitleBadge.createSpan("fns-file-icon");
        setIcon(badgeIcon, this.isHighRisk ? "alert-triangle" : "info");
        subtitleBadge.createSpan({
            text: this.isHighRisk
                ? ($("ui.sso.banner_subtitle_warning") || "检测到一个外部链接正尝试为您配置一个未知的同步服务器")
                : ($("ui.sso.banner_subtitle_safe") || "点击确认后将导入以下同步服务器配置")
        });
        if (this.isHighRisk) {
            subtitleBadge.addClass("fns-sso-badge--warning");
        }

        // ── Main Card ───────────────────────────────────────────────
        const mainCard = container.createDiv("fns-share-card");

        const table = mainCard.createEl("table", { cls: "fns-sso-table" });
        const tbody = table.createEl("tbody");

        // 1. API Url Section
        const apiRow = tbody.createEl("tr");
        const apiLabelTd = apiRow.createEl("td", { cls: "fns-sso-table-label" });
        const apiLabelWrapper = apiLabelTd.createDiv("fns-sso-label-wrapper");
        setIcon(apiLabelWrapper.createSpan("fns-header-icon"), "globe");
        apiLabelWrapper.createSpan({ text: $("setting.remote.api_url") || "远端服务地址" });

        const apiValueTd = apiRow.createEl("td", { cls: "fns-sso-table-value" });
        apiValueTd.createSpan({ text: this.data.pushApi, cls: "fns-sso-static-text" });

        // 2. Vault Name Section
        const vaultRow = tbody.createEl("tr");
        const vaultLabelTd = vaultRow.createEl("td", { cls: "fns-sso-table-label" });
        const vaultLabelWrapper = vaultLabelTd.createDiv("fns-sso-label-wrapper");
        setIcon(vaultLabelWrapper.createSpan("fns-header-icon"), "folder");
        vaultLabelWrapper.createSpan({ text: $("setting.remote.vault_name") || "远端笔记库名" });

        const vaultValueTd = vaultRow.createEl("td", { cls: "fns-sso-table-value" });
        vaultValueTd.createSpan({ 
            text: this.data.pushVault || ($("ui.sso.default_vault") || "默认（当前 Vault）"), 
            cls: "fns-sso-static-text" 
        });

        // 3. API Token Section
        const tokenRow = tbody.createEl("tr");
        const tokenLabelTd = tokenRow.createEl("td", { cls: "fns-sso-table-label" });
        const tokenLabelWrapper = tokenLabelTd.createDiv("fns-sso-label-wrapper");
        setIcon(tokenLabelWrapper.createSpan("fns-header-icon"), "key");
        tokenLabelWrapper.createSpan({ text: $("setting.remote.api_token") || "远端授权令牌" });

        const tokenValueTd = tokenRow.createEl("td", { cls: "fns-sso-table-value" });
        const tokenContainer = tokenValueTd.createDiv({ cls: "fns-sso-token-container" });
        const tokenValue = this.data.pushApiToken || "";
        const isMasked = !this.isTokenVisible;
        
        let tokenDisplayText = ($("ui.sso.no_token") || "（未提供）");
        if (tokenValue) {
            tokenDisplayText = isMasked ? "••••••••••••••••" : tokenValue;
        }

        const tokenSpan = tokenContainer.createSpan({ 
            text: tokenDisplayText, 
            cls: "fns-sso-static-text" 
        });
        if (isMasked && tokenValue) {
            tokenSpan.addClass("fns-sso-token-masked");
        }

        if (tokenValue) {
            const eyeWrapper = tokenContainer.createSpan({ cls: "fns-sso-eye-wrapper" });
            const eyeBtn = new ButtonComponent(eyeWrapper)
                .setIcon(this.isTokenVisible ? "eye-off" : "eye");
            eyeBtn.buttonEl.addClass("fns-input-action-btn", "fns-sso-eye-btn");
            eyeBtn.onClick(() => {
                this.isTokenVisible = !this.isTokenVisible;
                this.render();
            });
        }

        // ── 风险提示 (High Risk Only) ──────────────────────────────────
        if (this.isHighRisk) {
            const risk = container.createDiv("fns-sso-risk");

            const riskIcon = risk.createDiv("fns-sso-risk-icon");
            setIcon(riskIcon, "triangle-alert");

            const riskText = risk.createDiv("fns-sso-risk-text");
            riskText.createEl("strong", { text: $("ui.sso.risk_title") || "安全提示：" });
            riskText.appendText(
                $("ui.sso.risk_desc") ||
                " 导入非信任服务器将导致您的所有笔记在自动同步时发送至该服务器。请仅在您完全信任来源时确认。"
            );
        }

        // ── Action Buttons ──────────────────────────────────────────
        const actions = container.createDiv("fns-sso-actions");

        const cancelBtn = new ButtonComponent(actions)
            .setButtonText($("ui.button.cancel") || "取消")
            .onClick(() => this.close());
        cancelBtn.buttonEl.addClass("fns-sso-btn", "fns-sso-btn-cancel");

        const confirmBtn = new ButtonComponent(actions)
            .setButtonText($("ui.button.confirm") || "确认")
            .onClick(() => {
                this.close();
                this.onConfirm();
            });
        confirmBtn.buttonEl.addClass("fns-sso-btn");
        if (this.isHighRisk) {
            confirmBtn.buttonEl.addClass("fns-sso-btn-confirm--warning");
        } else {
            confirmBtn.buttonEl.addClass("fns-sso-btn-confirm--safe");
        }

        // Esc 关闭；高危不绑 Enter（防误按）/ Esc closes; high-risk ignores Enter to prevent accidents
        this.scope.register([], "Escape", () => this.close());
        if (!this.isHighRisk) {
            this.scope.register([], "Enter", (evt) => {
                evt.preventDefault();
                this.close();
                this.onConfirm();
            });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

