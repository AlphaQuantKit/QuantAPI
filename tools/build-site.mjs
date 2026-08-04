import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(toolsDir, "..");
const catalogPath = path.join(rootDir, "catalog", "api-catalog.json");
const siteDir = path.join(rootDir, "site");
const dataDir = path.join(siteDir, "data");

const requiredFiles = [
  path.join(siteDir, "index.html"),
  path.join(siteDir, "assets", "styles.css"),
  path.join(siteDir, "assets", "app.js"),
  path.join(siteDir, "assets", "favicon-32.png"),
  path.join(siteDir, "assets", "quantapi-logo.png")
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`站点文件缺失: ${path.relative(rootDir, file)}`);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
if (!Array.isArray(catalog.operations) || catalog.operations.length === 0) throw new Error("API 目录没有 operations");

const operationIds = new Set();
for (const operation of catalog.operations) {
  if (operationIds.has(operation.operationId)) throw new Error(`重复 operationId: ${operation.operationId}`);
  operationIds.add(operation.operationId);
}

fs.mkdirSync(dataDir, { recursive: true });
fs.copyFileSync(catalogPath, path.join(dataDir, "api-catalog.json"));

const assetVersion = (relativePath) => crypto
  .createHash("sha256")
  .update(fs.readFileSync(path.join(siteDir, relativePath)))
  .digest("hex")
  .slice(0, 12);
const indexPath = path.join(siteDir, "index.html");
const appVersion = assetVersion(path.join("assets", "app.js"));
const stylesVersion = assetVersion(path.join("assets", "styles.css"));
const faviconVersion = assetVersion(path.join("assets", "favicon-32.png"));
const logoVersion = assetVersion(path.join("assets", "quantapi-logo.png"));
const versionedIndex = fs.readFileSync(indexPath, "utf8")
  .replace(/\.\/assets\/styles\.css(?:\?v=[^"']+)?/g, `./assets/styles.css?v=${stylesVersion}`)
  .replace(/\.\/assets\/app\.js(?:\?v=[^"']+)?/g, `./assets/app.js?v=${appVersion}`)
  .replace(/\.\/assets\/favicon-32\.png(?:\?v=[^"']+)?/g, `./assets/favicon-32.png?v=${faviconVersion}`)
  .replace(/\.\/assets\/quantapi-logo\.png(?:\?v=[^"']+)?/g, `./assets/quantapi-logo.png?v=${logoVersion}`);
fs.writeFileSync(indexPath, versionedIndex, "utf8");

fs.writeFileSync(path.join(dataDir, "site-meta.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  catalogVersion: catalog.catalogVersion,
  operationCount: catalog.operations.length,
  domainCount: new Set(catalog.operations.map((operation) => operation.domain)).size
}, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  output: path.relative(rootDir, siteDir).replaceAll("\\", "/"),
  catalogVersion: catalog.catalogVersion,
  operations: catalog.operations.length,
  assetVersions: { app: appVersion, styles: stylesVersion, favicon: faviconVersion, logo: logoVersion },
  assets: requiredFiles.length + 3
}, null, 2)}\n`);
