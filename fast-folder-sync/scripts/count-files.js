import fs from 'fs';
import path from 'path';

// Parse arguments / 解析参数
let targetDir = null;
let useIgnore = true;
const ignoredDirs = new Set(['node_modules']);

for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--no-ignore') {
        useIgnore = false;
    } else if (arg === '--exclude' || arg === '-e') {
        const val = process.argv[++i];
        if (val) {
            val.split(',').forEach(d => ignoredDirs.add(d.trim()));
        }
    } else if (!arg.startsWith('-') && !targetDir) {
        targetDir = arg;
    }
}

// Fallback to current working directory / 默认回退到当前工作目录
if (!targetDir) {
    targetDir = process.cwd();
}

/**
 * Recursively count files in the directory and group them by extension.
 * 递归统计目录中的文件数量，并按扩展名进行分组。
 *
 * @param {string} dirPath - The target directory path. / 目标目录路径。
 * @param {boolean} useIgnore - Whether to use ignore rules. / 是否启用忽略规则。
 * @param {Set<string>} ignoredDirs - Set of directory names to ignore. / 需要忽略的目录名称集合。
 * @returns {{ totalCount: number, extensionCounts: Object.<string, number> }} - Statistics result. / 统计结果。
 */
function countFiles(dirPath, useIgnore, ignoredDirs) {
    const extensionCounts = {};
    let totalCount = 0;

    try {
        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
            // If the input path is a file, count it directly and return
            // 如果输入路径是一个文件，直接进行统计并返回
            const ext = path.extname(dirPath).toLowerCase() || '(no extension)';
            extensionCounts[ext] = 1;
            return { totalCount: 1, extensionCounts };
        }

        const files = fs.readdirSync(dirPath);

        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            try {
                const fileStats = fs.statSync(fullPath);

                if (fileStats.isDirectory()) {
                    // Check ignore rules if ignore is enabled / 如果启用了忽略规则，检查忽略规则
                    if (useIgnore) {
                        // Ignore folders starting with '.' / 忽略所有以 '.' 开头的文件夹
                        if (file.startsWith('.')) {
                            continue;
                        }
                        // Ignore specified directory names / 忽略指定的目录名称
                        if (ignoredDirs.has(file)) {
                            continue;
                        }
                    }

                    // Recursively scan subdirectories / 递归扫描子目录
                    const subResult = countFiles(fullPath, useIgnore, ignoredDirs);
                    totalCount += subResult.totalCount;
                    for (const [ext, count] of Object.entries(subResult.extensionCounts)) {
                        extensionCounts[ext] = (extensionCounts[ext] || 0) + count;
                    }
                } else if (fileStats.isFile()) {
                    // Count file by extension / 根据后缀统计文件
                    const ext = path.extname(file).toLowerCase() || '(no extension)';
                    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
                    totalCount++;
                }
            } catch (err) {
                // Ignore single file/directory errors, print warning / 忽略单个文件或目录错误，打印警告
                console.warn(`Warning: Could not access ${fullPath}: ${err.message}`);
            }
        }
    } catch (err) {
        console.error(`Error: Could not read directory ${dirPath}: ${err.message}`);
    }

    return { totalCount, extensionCounts };
}

// Main execution block / 主执行块
function main() {
    const resolvedPath = path.resolve(targetDir);

    console.log(`Starting scan for directory: ${resolvedPath}...`);
    if (useIgnore) {
        console.log(`Ignore mode: ENABLED / 忽略模式：开启`);
        console.log(`Default ignoring all directory names starting with '.' and 'node_modules'.`);
        console.log(`默认忽略所有以 '.' 开头的文件夹以及 'node_modules'。`);
        if (ignoredDirs.size > 1) {
            const customExcludes = Array.from(ignoredDirs).filter(d => d !== 'node_modules');
            console.log(`Custom excluded directories / 自定义排除目录: ${customExcludes.join(', ')}`);
        }
    } else {
        console.log(`Ignore mode: DISABLED / 忽略模式：关闭`);
    }
    console.log('-------------------------------------------');

    const result = countFiles(resolvedPath, useIgnore, ignoredDirs);

    const mdCount = (result.extensionCounts['.md'] || 0) + (result.extensionCounts['.markdown'] || 0);
    const nonMdCount = result.totalCount - mdCount;

    console.log('-------------------------------------------');
    console.log(`Scan completed for: ${resolvedPath}`);
    console.log(`Total files found: ${result.totalCount}`);
    console.log(`Markdown files / Markdown 文件:     ${mdCount}`);
    console.log(`Non-Markdown files / 非 Markdown 文件: ${nonMdCount}`);
    console.log('-------------------------------------------');
    console.log('File count by extension (descending) / 按后缀统计文件数量（降序）:');

    // Sort extensions by count descending / 按文件数量降序对后缀进行排序
    const sortedExtensions = Object.entries(result.extensionCounts).sort((a, b) => b[1] - a[1]);

    for (const [ext, count] of sortedExtensions) {
        const padding = ' '.repeat(Math.max(1, 25 - ext.length));
        console.log(`${ext}:${padding}${count}`);
    }
    console.log('-------------------------------------------');
}

main();

