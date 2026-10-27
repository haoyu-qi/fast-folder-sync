const fs = require("fs");
const path = require("path");

const dtsPath = path.join(__dirname, "..", "src", "pb", "v1", "sync.d.ts");

if (fs.existsSync(dtsPath)) {
    let content = fs.readFileSync(dtsPath, "utf8");

    // 移除任何先前可能存在的 eslint-disable 第一行
    content = content.replace(/^\/\*\s*eslint-disable\s*\*\/\r?\n?/, "");

    // 替换 require 导入为 ES6 导入 (Fixes require-imports rule)
    content = content.replace(/import Long = require\("long"\);/g, 'import Long from "long";');

    // 将空接口替换为类型别名 (Fixes no-empty-interface rule)
    content = content.replace(/interface\s+(\w+)\s+extends\s+([a-zA-Z0-9_\.$]+)\s*\{\s*\r?\n?\s*\}/g, "type $1 = $2;");

    // 将 { [k: string]: any } 替换为 { [k: string]: unknown }
    content = content.replace(/\{\s*\[\s*k\s*:\s*string\s*\]\s*:\s*any\s*\}/g, "{ [k: string]: unknown }");

    fs.writeFileSync(dtsPath, content, "utf8");
    console.log("Successfully patched sync.d.ts: fixed require, empty interfaces, and replaced any with unknown.");
} else {
    console.error("sync.d.ts not found at " + dtsPath);
}

