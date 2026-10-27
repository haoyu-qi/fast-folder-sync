import { Vault, TAbstractFile } from "obsidian";

export let logLevel: "off" | "console" | "internal";
export function setLogEnabled(level: "off" | "console" | "internal"): void;
export function dump(...message: unknown[]): void;
export function dumpError(...message: unknown[]): void;
export function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
export function vaultDelete(vault: Vault, file: TAbstractFile, force?: boolean): Promise<void>;

