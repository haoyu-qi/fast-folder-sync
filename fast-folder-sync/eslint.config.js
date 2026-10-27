import obsidianmd from "eslint-plugin-obsidianmd";
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";


export default defineConfig([
  {
    ignores: [
      "src/pb/**",
      "main.js",
      "styles.css",
      "dist/**",
      "src/lib/helpers_obsidian_bypass.js"
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["src/pb/**"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        process: "readonly",
      },
    },

    // You can add your own configuration to override or add rules
    rules: {
      // example: turn off a rule from the recommended set
      "obsidianmd/sample-names": "off",
      // example: add a rule not in the recommended set and set its severity
      "obsidianmd/prefer-file-manager-trash-file": "error",
    },
  },
]);

