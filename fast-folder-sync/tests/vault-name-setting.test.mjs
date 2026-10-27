import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "src", "lib", "settings", "vault_name.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const module = { exports: {} };

vm.runInNewContext(
  transpiled,
  {
    module,
    exports: module.exports,
    require: (id) => {
      throw new Error(`Unexpected import: ${id}`);
    },
  },
  { filename: sourcePath },
);

const { updateVaultName } = module.exports;
assert.equal(typeof updateVaultName, "function");

let clearCount = 0;
let saveCount = 0;
const plugin = {
  settings: { vault: "Original" },
  wsSettingChange: false,
  localStorageManager: {
    clearSyncTime() {
      clearCount += 1;
    },
  },
  async saveAndReloadServices() {
    saveCount += 1;
  },
};

await updateVaultName(plugin, "New Vault");

assert.equal(plugin.settings.vault, "New Vault");
assert.equal(plugin.wsSettingChange, true);
assert.equal(clearCount, 1);
assert.equal(saveCount, 1);

// Test that calling it with the same value does not trigger reload/clear
await updateVaultName(plugin, "New Vault");

assert.equal(clearCount, 1);
assert.equal(saveCount, 1);
