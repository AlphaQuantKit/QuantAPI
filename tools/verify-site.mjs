import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(toolsDir, "..");
const siteDir = path.join(rootDir, "site");

const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const checks = [];
const check = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail });

const canonicalCatalog = read("catalog/api-catalog.json");
const siteCatalog = read("site/data/api-catalog.json");
const canonical = JSON.parse(canonicalCatalog);
const catalog = JSON.parse(siteCatalog);
const html = read("site/index.html");
const app = read("site/assets/app.js");
const css = read("site/assets/styles.css");
const workflow = read(".github/workflows/pages.yml");

check("站点目录快照与唯一数据源一致", sha256(canonicalCatalog) === sha256(siteCatalog));
check("站点包含全部目录操作", catalog.operations.length === canonical.operations.length, `${catalog.operations.length}/${canonical.operations.length}`);
check("operationId 在站点数据中唯一", new Set(catalog.operations.map((operation) => operation.operationId)).size === catalog.operations.length);

const assetRefs = [...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)].map((match) => match[1]);
const missingAssets = assetRefs.filter((reference) => !fs.existsSync(path.resolve(siteDir, reference)));
check("HTML 本地资源引用有效", missingAssets.length === 0, missingAssets.join(", "));

const generatorMarkers = [
  'session.post(',
  '/authentication',
  'session.request(',
  'HTTPBasicAuth',
  'Retry-After',
  'WQ_EMAIL',
  'WQ_PASSWORD',
  'WQ_TOKEN',
  'buildJavascript',
  'credentials: "include"',
  'fetch(requestUrl, options)',
  'api-catalog.json'
];
const missingMarkers = generatorMarkers.filter((marker) => !app.includes(marker));
check("双语言生成器包含认证、调用、轮询和凭据处理", missingMarkers.length === 0, missingMarkers.join(", "));
check("页面具备接口目录、详情与右侧代码面板", ["nav-pane", "doc-pane", "code-pane"].every((className) => html.includes(className)));
check("代码面板支持 Python 与 JavaScript 语言选择", html.includes('id="language-select"') && html.includes("Python requests") && html.includes("JavaScript fetch"));
check("页面已移除 QUICK TEST 与本地测试器", !html.includes("QUICK TEST") && !html.includes("LOCAL ONLY") && !app.includes("LocalTester"));
check(
  "右侧代码面板使用统一浅色主题",
  css.includes("--code: #fbfaf6")
    && css.includes("background: #fbfaf6")
    && css.includes("background: rgba(255, 253, 249, 0.76)")
    && !css.includes("--code: #101522")
);
check("响应式布局规则存在", css.includes("@media (max-width: 700px)") && css.includes("@media (max-width: 980px)"));
check("GitHub Pages 工作流构建目录快照", workflow.includes("node tools/build-site.mjs"));
check("GitHub Pages 工作流执行站点验证", workflow.includes("node tools/verify-site.mjs"));
check("GitHub Pages 工作流只发布 site", /path:\s*site/.test(workflow));

const generator = await import(new URL("../site/assets/app.js", import.meta.url));
generator.state.catalog = catalog;
const expandedSearchResults = generator.expandSchemaRefs({ $ref: "#/schemas/SearchResults" });
const expandedSearchResultsText = JSON.stringify(expandedSearchResults);
check(
  "嵌套 Schema 引用已递归展开且不注入响应字段",
  expandedSearchResults.type === "object"
    && expandedSearchResults.additionalProperties?.type === "object"
    && expandedSearchResults.additionalProperties?.properties?.count?.type === "integer"
    && expandedSearchResults.additionalProperties?.properties?.results?.items?.type === "object"
    && !expandedSearchResultsText.includes('"$ref"')
    && !expandedSearchResultsText.includes('"x-wq-ref"')
    && !expandedSearchResultsText.includes('"x-wq-circular-ref"')
    && !expandedSearchResultsText.includes('"x-wq-unresolved-ref"')
);
const unresolvedSchemas = Object.entries(catalog.schemas ?? {})
  .filter(([, schema]) => JSON.stringify(generator.expandSchemaRefs(schema)).includes('"$ref"'))
  .map(([name]) => name);
check("目录中的 Schema 引用均可解析", unresolvedSchemas.length === 0, unresolvedSchemas.join(", "));
check("Schema 面板注明 x-wq 元数据不是响应字段", app.includes("x-wq-* 非响应字段"));
const generated = [];
for (const operation of catalog.operations) {
  generator.state.operationValues.clear();
  generated.push({
    operation,
    python: generator.buildPython(operation),
    javascript: generator.buildJavascript(operation)
  });
}
const malformedPython = generated.filter(({ python }) => !python.includes("import requests") || !python.includes("response") || python.includes("undefined"));
check("全部接口均可生成完整 Python 文本", malformedPython.length === 0, malformedPython.map(({ operation }) => operation.operationId).join(", "));
const malformedJavascript = generated.filter(({ javascript }) =>
  !javascript.includes("fetch(requestUrl, options)")
    || !javascript.includes('credentials: "include"')
    || !javascript.includes("response")
    || javascript.includes("undefined")
);
check("全部接口均可生成 WQ 页面 fetch 文本", malformedJavascript.length === 0, malformedJavascript.map(({ operation }) => operation.operationId).join(", "));
const javascriptSyntaxFailures = generated.filter(({ javascript }) => spawnSync(process.execPath, ["--check"], { input: javascript, encoding: "utf8" }).status !== 0);
check("126 个 JavaScript 脚本均通过语法检查", javascriptSyntaxFailures.length === 0, javascriptSyntaxFailures.map(({ operation }) => operation.operationId).join(", "));

const pythonCandidates = process.platform === "win32" ? ["python"] : ["python3", "python"];
const pythonCommand = pythonCandidates.find((candidate) => !spawnSync(candidate, ["--version"], { encoding: "utf8" }).error);
if (pythonCommand) {
  const syntaxFailures = generated.filter(({ python }) => {
    const result = spawnSync(pythonCommand, ["-c", "import sys; compile(sys.stdin.buffer.read(), '<generated_request.py>', 'exec')"], { input: Buffer.from(python, "utf8") });
    return result.status !== 0;
  });
  check("126 个生成脚本均通过 Python 语法检查", syntaxFailures.length === 0, syntaxFailures.map(({ operation }) => operation.operationId).join(", "));
} else {
  check("Python 语法检查器可用", true, "当前环境无 Python，已跳过；GitHub Actions ubuntu-latest 将提供 python3");
}

const publicText = [html, app, css, siteCatalog].join("\n");
const sensitivePatterns = [
  /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{12,}/i,
  /sessionid=[A-Za-z0-9._-]{8,}/i,
  /[A-Za-z0-9._%+-]+@(?!example\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
];
const leaked = sensitivePatterns.filter((pattern) => pattern.test(publicText)).map(String);
check("公开站点敏感信息扫描通过", leaked.length === 0, leaked.join(", "));

const failures = checks.filter((item) => !item.passed);
const report = { passed: failures.length === 0, operationCount: catalog.operations.length, checks, failures };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
