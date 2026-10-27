/**
 * Mutable runtime API configuration, kept separate from the persisted PluginSettings.
 * Holds the effective base URL after any 301/302 redirect probing and the derived WS URL.
 *
 * 运行时可变的 API 配置，与持久化的 PluginSettings 分离。
 * 保存经过 301/302 探测后的实际 base URL 及其对应的 WebSocket URL。
 */
export class RuntimeConfig {
  /** 当前运行时 HTTP API 地址 / Effective HTTP API base URL */
  runApi = "";
  /** 当前运行时 WebSocket API 地址 / Effective WebSocket API base URL */
  runWsApi = "";
  /** WebSocket 配置变更标志 / Flag indicating WS settings have changed */
  wsSettingChange = false;

  /**
   * 原子更新两个 URL（去除尾部斜杠，同步推导 WS 地址）
   * Atomically update both URLs (strip trailing slash, derive WS URL).
   */
  update(api: string) {
    const clean = api ? api.replace(/\/+$/, "") : "";
    this.runApi = clean;
    this.runWsApi = clean ? clean.replace(/^http/, "ws") : "";
  }
}

