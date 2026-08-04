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
const favicon = fs.readFileSync(path.join(siteDir, "assets", "favicon-32.png"));
const logo = fs.readFileSync(path.join(siteDir, "assets", "quantapi-logo.png"));
const pngDimensions = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

check("站点目录快照与唯一数据源一致", sha256(canonicalCatalog) === sha256(siteCatalog));
check(
  "公开目录彻底移除 x-wq-confidence",
  !canonicalCatalog.includes('"x-wq-confidence"')
    && !siteCatalog.includes('"x-wq-confidence"')
    && !app.includes('"x-wq-confidence"')
);
check("站点包含全部目录操作", catalog.operations.length === canonical.operations.length, `${catalog.operations.length}/${canonical.operations.length}`);
check("operationId 在站点数据中唯一", new Set(catalog.operations.map((operation) => operation.operationId)).size === catalog.operations.length);

const assetRefs = [...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)].map((match) => match[1]);
const missingAssets = assetRefs.filter((reference) => !fs.existsSync(path.resolve(siteDir, reference)));
check("HTML 本地资源引用有效", missingAssets.length === 0, missingAssets.join(", "));
const appVersion = sha256(app).slice(0, 12);
const stylesVersion = sha256(css).slice(0, 12);
const faviconVersion = sha256(favicon).slice(0, 12);
const logoVersion = sha256(logo).slice(0, 12);
check(
  "页面资源使用内容哈希避免旧目录名称缓存",
  html.includes(`./assets/app.js?v=${appVersion}`)
    && html.includes(`./assets/styles.css?v=${stylesVersion}`)
);
check(
  "标签页使用 QuantAPI 专用图标",
  html.includes(`rel="icon" type="image/png" sizes="32x32" href="./assets/favicon-32.png?v=${faviconVersion}"`)
    && html.includes(`rel="apple-touch-icon" href="./assets/quantapi-logo.png?v=${logoVersion}"`)
    && pngDimensions(favicon).width === 32
    && pngDimensions(favicon).height === 32
    && pngDimensions(logo).width === 256
    && pngDimensions(logo).height === 256
);

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
const topbarMetaHtml = html.match(/<div class="topbar-meta">([\s\S]*?)<\/div>/)?.[1] ?? "";
check(
  "左上角显示动态 catalog 版本且右上角不再重复",
  html.includes('<small id="catalog-version">catalog —</small>')
    && !html.includes("非官方 · 源码分析版")
    && !topbarMetaHtml.includes('id="catalog-version"')
    && app.includes('elements.catalogVersion.textContent = `catalog ${state.catalog.catalogVersion}`')
);
const tagOperations = catalog.operations.filter((operation) => operation.domain === "tags");
check(
  "标签业务域统一显示为 Alpha List",
  app.includes('tags: "Alpha List"')
    && !app.includes('tags: "标签"')
    && tagOperations.length > 0
    && tagOperations.every((operation) => operation.summary.includes("Alpha List") && !operation.summary.includes("标签"))
);
check(
  "页头提供可访问的 GitHub 仓库链接",
  html.includes('href="https://github.com/AlphaQuantKit/QuantAPI"')
    && html.includes('rel="noopener noreferrer"')
    && html.includes('aria-label="在新标签页打开 QuantAPI GitHub 仓库"')
    && html.includes('src="./assets/github-invertocat.svg"')
    && css.includes(".github-link")
);
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
const visibleOperations = generator.visibleOperations();
const hiddenOperations = catalog.operations.filter((operation) => operation.visibility === "hidden");
const alphaCorrelationOperation = catalog.operations.find((operation) => operation.operationId === "getAlphaCorrelation");
const correlationTypeParameter = alphaCorrelationOperation?.parameters?.find((parameter) => parameter.name === "correlationType");
check(
  "Alpha 三类相关性共用一个动态接口入口",
  alphaCorrelationOperation?.path === "/alphas/{alphaId}/correlations/{correlationType}"
    && !catalog.operations.some((operation) => operation.operationId === "getAlphaProdCorrelation")
    && JSON.stringify(correlationTypeParameter?.schema?.enum) === JSON.stringify(["self", "power-pool", "prod"])
    && visibleOperations.filter((operation) => operation.operationId === "getAlphaCorrelation").length === 1
    && generator.defaultOperationValues(alphaCorrelationOperation).params["path:correlationType"] === "self"
);
const expectedLeadingDomainOrder = ["authentication", "account", "data", "operators", "simulation", "alpha", "events", "messages"];
const visibleDomains = new Set(visibleOperations.map((operation) => operation.domain));
check(
  "接口目录按认证、账户、Data、Operator、Simulation、Alpha、Event、Message 排序",
  expectedLeadingDomainOrder.every((domain, index) =>
    app.indexOf(`${domain}:`) >= 0
      && (index === 0 || app.indexOf(`${expectedLeadingDomainOrder[index - 1]}:`) < app.indexOf(`${domain}:`))
  )
    && expectedLeadingDomainOrder.every((domain) => visibleDomains.has(domain))
    && app.includes('events: "Event"')
    && app.includes('messages: "Message"')
    && !app.includes('events: "事件"')
    && !app.includes('messages: "消息"')
);
const spcOperationIds = ["getSpcSubmissionOptions", "listSpcSubmissions", "createSpcSubmission", "getSpcSubmission", "patchSpcSubmission"];
const competitionOperations = visibleOperations.filter((operation) => operation.domain === "competitions");
const consultantOperations = visibleOperations.filter((operation) => operation.domain === "consultant");
check(
  "SPC 提交接口并入比赛目录且顾问目录独立",
  spcOperationIds.every((operationId) => competitionOperations.some((operation) => operation.operationId === operationId))
    && consultantOperations.every((operation) => !operation.path.startsWith("/competitions/spc/"))
    && competitionOperations.length === 13
    && consultantOperations.length === 4
    && app.includes('consultant: "顾问"')
    && !app.includes('consultant: "顾问与 SPC"')
);
check(
  "数据与算子业务域使用英文名称",
  app.includes('data: "Data"')
    && app.includes('operators: "Operator"')
    && !app.includes('data: "数据"')
    && !app.includes('operators: "算子"')
);
const hiddenAgreementAndTeamOperations = catalog.operations.filter((operation) => ["agreements", "teams"].includes(operation.domain));
const listSelfAgreementsOperation = catalog.operations.find((operation) => operation.operationId === "listSelfAgreements");
const additionallyHiddenOperationIds = ["acceptCompetition", "getResearcherPerformance", "getConfiguration"];
check(
  "协议、团队业务域及当前用户协议接口全部从网页隐藏",
  hiddenAgreementAndTeamOperations.length > 0
    && hiddenAgreementAndTeamOperations.every((operation) =>
      operation.visibility === "hidden"
        && !visibleOperations.includes(operation)
    )
    && listSelfAgreementsOperation?.visibility === "hidden"
    && !visibleOperations.includes(listSelfAgreementsOperation)
    && !visibleOperations.some((operation) => ["agreements", "teams"].includes(operation.domain))
);
check(
  "指定比赛、表现与配置接口从网页隐藏",
  additionallyHiddenOperationIds.every((operationId) =>
    catalog.operations.some((operation) => operation.operationId === operationId && operation.visibility === "hidden")
      && !visibleOperations.some((operation) => operation.operationId === operationId)
  )
);
const registrationOptionsOperation = catalog.operations.find((operation) => operation.operationId === "getUserRegistrationOptions");
check(
  "注册字段接口归类到账户业务域",
  registrationOptionsOperation?.domain === "account"
    && visibleOperations.includes(registrationOptionsOperation)
);
const videoCoursesOperation = catalog.operations.find((operation) => operation.operationId === "listVideoCourses");
const deprecatedVideoCourseOperation = catalog.operations.find((operation) => operation.operationId === "getVideoCourse");
const videoCoursesExample = catalog.examples?.videoCourses;
const videoCourseSchema = catalog.schemas?.VideoCourse;
const videoSchema = catalog.schemas?.VideoCourseVideo;
const videoCourseParameters = new Map((videoCoursesOperation?.parameters ?? []).map((parameter) => [parameter.name, parameter]));
const videoCoursesExampleHtml = generator.responseExampleBlock(videoCoursesOperation?.response?.exampleRef);
check(
  "视频课程列表已由实测响应确认并提供完整去敏结构",
  videoCoursesOperation?.response?.evidenceLevel === "live_response_confirmed"
    && videoCoursesOperation?.response?.schemaRef === "VideoCourseList"
    && videoCoursesOperation?.response?.exampleRef === "videoCourses"
    && videoCoursesOperation?.verification?.rawSampleStored === false
    && videoCoursesOperation?.behavior?.pagination === "limit_offset"
    && videoCourseParameters.get("limit")?.schema?.example === 10
    && videoCourseParameters.get("offset")?.schema?.example === 0
    && videoCoursesExample?.sanitized === true
    && videoCoursesExample?.value?.results?.[0]?.videos?.[0]?.source === "YouTube"
    && ["id", "category", "videos", "duration", "title", "sequence", "description", "lastModified"].every((field) => videoCourseSchema?.required?.includes(field))
    && ["id", "category", "duration", "title", "uid", "numericalId", "language", "sequence", "source", "description", "transcript", "lastModified"].every((field) => videoSchema?.required?.includes(field))
    && videoCoursesExampleHtml.includes("去敏响应示例")
    && videoCoursesExampleHtml.includes("YOUTUBE_VIDEO_UID")
    && generator.defaultOperationValues(videoCoursesOperation).params["query:limit"] === "10"
    && generator.defaultOperationValues(videoCoursesOperation).params["query:offset"] === "0"
);
check(
  "废弃视频详情接口保留在数据中但不在网页显示",
  deprecatedVideoCourseOperation?.deprecated === true
    && deprecatedVideoCourseOperation?.visibility === "hidden"
    && deprecatedVideoCourseOperation?.deprecation?.replacementOperationId === "listVideoCourses"
    && deprecatedVideoCourseOperation?.response?.errorStatuses?.includes(404)
    && catalog.operations.includes(deprecatedVideoCourseOperation)
    && !visibleOperations.some((operation) => operation.operationId === "getVideoCourse")
    && visibleOperations.length === catalog.operations.length - hiddenOperations.length
    && app.includes('operation.visibility !== "hidden"')
);
const tutorialOperations = [
  ["getTutorial", "TutorialDetail", "tutorialDetail"],
  ["listTutorials", "TutorialList", "tutorialList"],
  ["getTutorialPage", "TutorialPage", "tutorialPage"]
];
check(
  "三个教程接口展示实测 Schema 与去敏示例",
  tutorialOperations.every(([operationId, schemaRef, exampleRef]) => {
    const operation = catalog.operations.find((item) => item.operationId === operationId);
    const exampleHtml = generator.responseExampleBlock(operation?.response?.exampleRef);
    return operation?.response?.evidenceLevel === "live_response_confirmed"
      && operation?.response?.schemaRef === schemaRef
      && operation?.response?.exampleRef === exampleRef
      && catalog.examples?.[exampleRef]?.sanitized === true
      && exampleHtml.includes("去敏响应示例");
  })
    && generator.defaultOperationValues(catalog.operations.find((operation) => operation.operationId === "getTutorial"))
      .params["path:tutorialId"] === "YOUR_TUTORIAL_STEP_SLUG"
);
const accountLiveChecks = [
  ["getConfiguration", "PlatformConfiguration", "platformConfiguration"],
  ["getUser", "WqUser", "user"],
  ["getUserProfile", "PublicUserProfile", "publicUserProfile"],
  ["getSimulationSettings", "SimulationSettings", "simulationSettings"],
  ["updateSimulationSettings", "SimulationSettings", "simulationSettings"],
  ["listSelfAgreements", "AgreementList", "selfAgreements"]
];
check(
  "六个账户接口在目录保留实测 Schema 与去敏响应示例",
  accountLiveChecks.every(([operationId, schemaRef, exampleRef]) => {
    const operation = catalog.operations.find((item) => item.operationId === operationId);
    return operation?.response?.schemaRef === schemaRef
      && operation?.response?.exampleRef === exampleRef
      && operation?.response?.evidenceLevel === "live_response_confirmed"
      && operation?.verification?.rawSampleStored === false
      && catalog.examples?.[exampleRef]?.sanitized === true
      && generator.responseExampleBlock(exampleRef).includes("去敏响应示例");
  })
);
const getUserOperation = catalog.operations.find((operation) => operation.operationId === "getUser");
const getUserProfileOperation = catalog.operations.find((operation) => operation.operationId === "getUserProfile");
const getSimulationSettingsOperation = catalog.operations.find((operation) => operation.operationId === "getSimulationSettings");
const updateSimulationSettingsOperation = catalog.operations.find((operation) => operation.operationId === "updateSimulationSettings");
const updateSimulationDefaults = generator.defaultOperationValues(updateSimulationSettingsOperation);
check(
  "网页记录跨用户只读权限边界并使用实测模拟设置请求示例",
  app.includes("<th>说明</th>")
    && getUserOperation?.response?.errorStatuses?.includes(403)
    && getUserOperation?.parameters?.[0]?.description?.includes("HTTP 403")
    && getUserProfileOperation?.parameters?.[0]?.description?.includes("公开字段子集")
    && getSimulationSettingsOperation?.response?.errorStatuses?.includes(404)
    && getSimulationSettingsOperation?.parameters?.[0]?.description?.includes("HTTP 404")
    && updateSimulationSettingsOperation?.parameters?.[0]?.description?.includes("未测试任何跨用户写入")
    && updateSimulationSettingsOperation?.requestBody?.exampleRef === "simulationSettings"
    && JSON.parse(updateSimulationDefaults.bodies["application/json"]).instrumentType === "EQUITY"
    && updateSimulationSettingsOperation?.response?.statuses?.includes(201)
);
const tagReadChecks = [
  ["getTagOptions", "TagOptions", "tagOptions"],
  ["listSelfTags", "AlphaListTagPage", "alphaLists"],
  ["getTag", "AlphaListTag", "alphaList"],
  ["getTagInnerCorrelation", "TagInnerCorrelation", "tagInnerCorrelation"],
  ["getTagSelfCorrelation", "TabularRecordset", "tagSelfCorrelation"]
];
check(
  "五个 Alpha List 只读接口展示实测 Schema 与去敏响应示例",
  tagReadChecks.every(([operationId, schemaRef, exampleRef]) => {
    const operation = catalog.operations.find((item) => item.operationId === operationId);
    return operation?.response?.schemaRef === schemaRef
      && operation?.response?.exampleRef === exampleRef
      && operation?.response?.evidenceLevel === "live_response_confirmed"
      && operation?.verification?.rawSampleStored === false
      && catalog.examples?.[exampleRef]?.sanitized === true
      && generator.responseExampleBlock(exampleRef).includes("去敏响应示例");
  })
);
const listSelfTagsOperation = catalog.operations.find((operation) => operation.operationId === "listSelfTags");
const innerTagCorrelationOperation = catalog.operations.find((operation) => operation.operationId === "getTagInnerCorrelation");
const selfTagCorrelationOperation = catalog.operations.find((operation) => operation.operationId === "getTagSelfCorrelation");
check(
  "Alpha List 分页默认值和相关性 Retry-After 轮询进入代码生成器",
  generator.defaultOperationValues(listSelfTagsOperation).params["query:limit"] === "9"
    && generator.defaultOperationValues(listSelfTagsOperation).params["query:offset"] === "0"
    && [innerTagCorrelationOperation, selfTagCorrelationOperation].every((operation) =>
      operation?.behavior?.polling === true
        && operation?.behavior?.retryAfterHeader === true
        && generator.defaultOperationValues(operation).includePolling === true
    )
    && catalog.examples?.tagOptions?.value?.actions?.POST?.name?.maxLength === 96
    && catalog.examples?.tagSelfCorrelation?.value?.records?.[0]?.[1] === null
);
const createTagOperation = catalog.operations.find((operation) => operation.operationId === "createTag");
const patchTagOperation = catalog.operations.find((operation) => operation.operationId === "patchTag");
const deleteTagOperation = catalog.operations.find((operation) => operation.operationId === "deleteTag");
const createTagDefaults = generator.defaultOperationValues(createTagOperation);
const patchTagDefaults = generator.defaultOperationValues(patchTagOperation);
check(
  "三个 Alpha List 写接口展示实测结构且临时资源已清理",
  createTagOperation?.requestBody?.exampleRef === "createAlphaListRequest"
    && createTagOperation?.response?.exampleRef === "createdAlphaList"
    && createTagOperation?.response?.evidenceLevel === "live_response_confirmed"
    && JSON.parse(createTagDefaults.bodies["application/json"]).alphas.length === 0
    && patchTagOperation?.requestBody?.exampleRef === "patchAlphaListRequest"
    && patchTagOperation?.response?.exampleRef === "patchedAlphaList"
    && patchTagOperation?.response?.evidenceLevel === "live_response_confirmed"
    && Object.keys(JSON.parse(patchTagDefaults.bodies["application/json"])).join(",") === "op,alphas"
    && JSON.parse(patchTagDefaults.bodies["application/json"]).op === "add"
    && JSON.parse(patchTagDefaults.bodies["application/json"]).alphas[0] === "ALPHA_ID_EXAMPLE"
    && catalog.examples?.patchedAlphaList?.value?.alphas?.[0]?.name === null
    && patchTagOperation?.verification?.observations?.some((observation) => observation.includes("op=add"))
    && deleteTagOperation?.response?.evidenceLevel === "live_response_confirmed"
    && deleteTagOperation?.response?.mode === "empty"
    && deleteTagOperation?.response?.statuses?.[0] === 204
    && !deleteTagOperation?.response?.exampleRef
    && deleteTagOperation?.verification?.observations?.some((observation) => observation.includes("临时资源已成功清理"))
    && generator.responseExampleForOperation(deleteTagOperation) === ""
);
const getAlphaOperation = catalog.operations.find((operation) => operation.operationId === "getAlpha");
const patchAlphaOperation = catalog.operations.find((operation) => operation.operationId === "patchAlpha");
const listRelatedAlphasOperation = catalog.operations.find((operation) => operation.operationId === "listRelatedAlphas");
const submitAlphaOperation = catalog.operations.find((operation) => operation.operationId === "submitAlpha");
const pollAlphaSubmissionOperation = catalog.operations.find((operation) => operation.operationId === "pollAlphaSubmission");
const patchAlphaDefaults = generator.defaultOperationValues(patchAlphaOperation);
const patchAlphaBody = JSON.parse(patchAlphaDefaults.bodies["application/json"]);
check(
  "五个 Alpha 详情、描述、子项与提交接口展示实测 Schema 和示例",
  [
    [getAlphaOperation, "Alpha", "superAlpha"],
    [patchAlphaOperation, "Alpha", "superAlpha"],
    [listRelatedAlphasOperation, "AlphaList", "relatedAlphas"],
    [submitAlphaOperation, "AlphaCheckResponse", "alphaSubmissionChecks"],
    [pollAlphaSubmissionOperation, "AlphaCheckResponse", "alphaSubmissionChecks"]
  ].every(([operation, schemaRef, exampleRef]) =>
    operation?.response?.schemaRef === schemaRef
      && operation?.response?.exampleRef === exampleRef
      && operation?.response?.evidenceLevel === "live_response_confirmed"
      && operation?.verification?.rawSampleStored === false
      && catalog.examples?.[exampleRef]?.sanitized === true
      && generator.responseExampleBlock(exampleRef).includes("去敏响应示例")
  )
    && patchAlphaOperation?.requestBody?.schemaRef === "AlphaPatchRequest"
    && patchAlphaOperation?.requestBody?.exampleRef === "patchSuperAlphaDescriptionRequest"
    && patchAlphaBody.selection.description.length >= 100
    && patchAlphaBody.combo.description.length >= 100
    && listRelatedAlphasOperation?.behavior?.pagination === "limit_offset"
);
const submitAlphaPython = generator.buildPython(submitAlphaOperation);
const submitAlphaJavascript = generator.buildJavascript(submitAlphaOperation);
check(
  "Super Alpha 提交代码按 Retry-After 等待并改用 GET 轮询",
  submitAlphaOperation?.behavior?.poll === "pollAlphaSubmission"
    && submitAlphaOperation?.behavior?.retryAfterHeader === true
    && pollAlphaSubmissionOperation?.verification?.observedPollCount === 16
    && submitAlphaPython.includes('while response.headers.get("Retry-After"):')
    && submitAlphaPython.includes("response = session.get(")
    && !submitAlphaPython.includes("poll_response.status_code != 202")
    && submitAlphaJavascript.includes('while (response.headers.has("Retry-After"))')
    && submitAlphaJavascript.includes('method: "GET"')
    && !submitAlphaJavascript.includes("response.status !== 202")
);
const newlyConfirmedReadOnlyChecks = [
  ["listOperators", "OperatorList", "operators"],
  ["listAlphas", "AlphaList", "alphaSearchResults"],
  ["listTagAlphas", "AlphaList", "tagAlphas"],
  ["getUserAlphaOptions", "Options", "alphaQueryOptions"],
  ["getAlphaChecks", "AlphaCheckResponse", "alphaChecks"],
  ["getAlphaCorrelation", "CorrelationRecordset", "alphaCorrelation"],
  ["listAlphaRecordsets", "RecordsetList", "alphaRecordsets"],
  ["getAlphaRecordset", "Recordset", "alphaRecordset"],
  ["getSelfAlphaPerformance", "AlphaPerformanceComparison", "alphaPerformanceComparison"],
  ["getSelfAlphaSummary", "AlphaSummary", "alphaSummary"],
  ["getAlphaTutorial", "AlphaTutorialCheck", "alphaTutorialCheck"],
  ["listEvents", "EventList", "events"],
  ["getEventOptions", "Options", "eventOptions"],
  ["listSelfMessages", "MessageList", "messages"],
  ["getSelfMessageSummary", "MessageSummary", "messageSummary"]
];
check(
  "Operator、Alpha、Event 与消息新增只读接口展示实测结构",
  newlyConfirmedReadOnlyChecks.every(([operationId, schemaRef, exampleRef]) => {
    const operation = catalog.operations.find((item) => item.operationId === operationId);
    return operation?.response?.schemaRef === schemaRef
      && operation?.response?.exampleRef === exampleRef
      && operation?.response?.evidenceLevel === "live_response_confirmed"
      && operation?.verification?.rawSampleStored === false
      && catalog.examples?.[exampleRef]?.sanitized === true
      && generator.responseExampleBlock(exampleRef).includes("去敏响应示例");
  })
);
const newlyConfirmedById = new Map(newlyConfirmedReadOnlyChecks.map(([operationId]) => [
  operationId,
  catalog.operations.find((operation) => operation.operationId === operationId)
]));
const listAlphasDefaults = generator.defaultOperationValues(newlyConfirmedById.get("listAlphas"));
const listTagAlphasDefaults = generator.defaultOperationValues(newlyConfirmedById.get("listTagAlphas"));
const eventDefaults = generator.defaultOperationValues(newlyConfirmedById.get("listEvents"));
const messageDefaults = generator.defaultOperationValues(newlyConfirmedById.get("listSelfMessages"));
check(
  "新增查询参数进入代码生成器且使用实测默认值",
  listAlphasDefaults.params["query:limit"] === "10"
    && listAlphasDefaults.params["query:offset"] === "0"
    && listAlphasDefaults.params["query:type"] === "REGULAR"
    && listAlphasDefaults.params["query:stage"] === "IS"
    && listAlphasDefaults.params["query:status"] === "UNSUBMITTED"
    && listTagAlphasDefaults.params["path:tagId"] === "YOUR_TAG_ID"
    && eventDefaults.params["query:type"] === "ONLINE"
    && eventDefaults.params["query:language"] === "en"
    && messageDefaults.params["query:type"] === "ANNOUNCEMENT"
    && messageDefaults.params["query:read"] === ""
);
check(
  "Alpha 前置条件与未测试接口边界在网页数据中保持准确",
  newlyConfirmedById.get("getSelfAlphaPerformance")?.response?.errorStatuses?.includes(400)
    && newlyConfirmedById.get("getAlphaTutorial")?.response?.mode === "json_or_empty"
    && newlyConfirmedById.get("getAlphaTutorial")?.response?.errorStatuses?.includes(412)
    && ["bulkPatchAlphas", "patchMessage", "patchSelfMessageSummary", "getTeamAlphaPerformance", "getCompetitionAlphaPerformance"]
      .every((operationId) => catalog.operations.find((operation) => operation.operationId === operationId)?.response?.evidenceLevel !== "live_response_confirmed")
);
const createAuthenticationOperation = catalog.operations.find((operation) => operation.operationId === "createAuthentication");
const getAuthenticationOperation = catalog.operations.find((operation) => operation.operationId === "getAuthentication");
const deleteAuthenticationOperation = catalog.operations.find((operation) => operation.operationId === "deleteAuthentication");
const createAuthenticationPython = generator.buildPython(createAuthenticationOperation);
const hiddenAuthenticationIds = [
  "authenticateBrainLabs",
  "createAuthenticationPersona",
  "authenticateWorkday",
  "changeEmail",
  "reverifyEmail",
  "verifyEmail",
  "changePassword",
  "forgotPassword",
  "resetPassword",
  "createUserToken",
  "createUser",
  "patchSelfUser",
  "deleteSelfUser"
];
check(
  "三个基础认证接口展示实测结构且登录不要求 captcha",
  [createAuthenticationOperation, getAuthenticationOperation].every((operation) =>
    operation?.response?.schemaRef === "AuthSession"
      && operation?.response?.exampleRef === "authenticationSession"
      && operation?.response?.evidenceLevel === "live_response_confirmed"
      && operation?.verification?.rawSampleStored === false
  )
    && !createAuthenticationOperation?.requestBody
    && !createAuthenticationPython.includes("captcha")
    && deleteAuthenticationOperation?.response?.schemaRef === "EmptyObject"
    && deleteAuthenticationOperation?.response?.exampleRef === "authenticationLogout"
    && deleteAuthenticationOperation?.response?.evidenceLevel === "live_response_confirmed"
    && catalog.examples?.authenticationSession?.sanitized === true
    && catalog.examples?.authenticationLogout?.sanitized === true
);
check(
  "高敏感认证与账户接口保留在目录但不在网页显示",
  hiddenAuthenticationIds.every((operationId) =>
    catalog.operations.some((operation) => operation.operationId === operationId && operation.visibility === "hidden")
      && !visibleOperations.some((operation) => operation.operationId === operationId)
  )
);
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
const displaySearchResultsText = JSON.stringify(generator.stripSchemaMetadata(expandedSearchResults));
check("请求与响应 Schema JSON 不显示 x-wq 文档元数据", !displaySearchResultsText.includes('"x-wq-'));
check(
  "页面不展示冗余的结构、可信度和验证说明块",
  !app.includes("文档可信度：")
    && !app.includes("文档证据，不属于实际请求或响应")
    && !app.includes("不是真实 API 响应")
    && !app.includes("实测验证")
    && !app.includes('class="example-note"')
    && !css.includes(".schema-confidence")
    && !css.includes(".example-note")
    && !css.includes(".verification-card")
);
const achievementsOperation = catalog.operations.find((operation) => operation.operationId === "getUserAchievements");
const ordinaryHighConfidenceOperation = catalog.operations.find((operation) => operation.confidence === "high" && operation.response.evidenceLevel !== "live_response_confirmed");
const achievementsExample = catalog.examples?.userAchievements;
const achievementsExampleHtml = generator.responseExampleBlock(achievementsOperation?.response?.exampleRef);
check(
  "用户成就实测响应已去敏并展示",
  achievementsOperation?.response?.evidenceLevel === "live_response_confirmed"
    && achievementsOperation?.response?.exampleRef === "userAchievements"
    && achievementsExample?.sanitized === true
    && achievementsExampleHtml.includes("去敏响应示例")
    && achievementsExampleHtml.includes("SIMULATION_20")
    && !achievementsExampleHtml.includes("证据：")
    && !JSON.stringify(achievementsExample.value).includes("x-wq-")
);
const schemaGeneratedResponseOperation = catalog.operations.find((operation) =>
  !operation.response.exampleRef
    && !["empty", "headers"].includes(operation.response.mode)
    && !operation.response.statuses?.every((status) => status === 204)
);
const generatedResponseExample = generator.responseExampleForOperation(schemaGeneratedResponseOperation);
const requestSchemaWithoutHint = generator.schemaBlock({ type: "object" }, "application/json");
const requestExampleWithoutHint = generator.schemaExampleBlock({ regular: "rank(close)" }, "请求体示例");
check(
  "请求体与响应 Schema 均提供易读示例",
  app.includes("请求体示例")
    && app.includes("响应结构示例")
    && !requestSchemaWithoutHint.includes("文档可信度")
    && !requestExampleWithoutHint.includes("结构示例")
    && !requestExampleWithoutHint.includes("根据请求 Schema 自动生成")
    && generatedResponseExample.includes("Schema 生成")
    && !generatedResponseExample.includes("example-note")
    && generator.sampleFromSchema({ type: ["number", "null"] }) === 0
);
const evidenceTooltip = generator.helpTooltip("evidence-test", "响应证据", "consumer_confirmed", catalog.evidenceLevels.consumer_confirmed);
const sensitivityTooltip = generator.helpTooltip("sensitivity-test", "敏感等级", "personal_data", "涉及个人资料、用户标识或账户相关数据；示例和日志应先去敏。");
check(
  "响应证据与敏感等级提供可访问的问号说明",
  app.includes("SENSITIVITY_DESCRIPTIONS")
    && app.includes("response-evidence-help")
    && app.includes("sensitivity-help")
    && evidenceTooltip.includes('role="tooltip"')
    && evidenceTooltip.includes("响应字段消费代码确认")
    && sensitivityTooltip.includes("示例和日志应先去敏")
    && css.includes(".meta-help-wrap:focus-within .meta-tooltip")
    && css.includes(".meta-help:focus-visible")
);
check(
  "可信度、响应证据与敏感等级全部使用中文展示",
  generator.confidenceLabel("high") === "高可信度"
    && generator.confidenceLabel("medium") === "中等可信度"
    && generator.confidenceLabel("low") === "低可信度"
    && generator.evidenceLabel("live_response_confirmed") === "实测响应确认"
    && generator.evidenceLabel("consumer_confirmed") === "消费代码确认"
    && generator.sensitivityLabel("none") === "无额外敏感项"
    && generator.sensitivityLabel("personal_data") === "个人数据"
    && generator.operationConfidenceLabel(achievementsOperation) === "实测已确认"
    && generator.operationConfidenceLabel(ordinaryHighConfidenceOperation) === "高可信度"
    && !app.includes("operation.confidence)} confidence")
    && !app.includes("example.evidenceLevel)}</strong>")
);
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
check(`${visibleOperations.length} 个 JavaScript 脚本均通过语法检查`, javascriptSyntaxFailures.length === 0, javascriptSyntaxFailures.map(({ operation }) => operation.operationId).join(", "));

const pythonCandidates = process.platform === "win32" ? ["python"] : ["python3", "python"];
const pythonCommand = pythonCandidates.find((candidate) => !spawnSync(candidate, ["--version"], { encoding: "utf8" }).error);
if (pythonCommand) {
  const syntaxFailures = generated.filter(({ python }) => {
    const result = spawnSync(pythonCommand, ["-c", "import sys; compile(sys.stdin.buffer.read(), '<generated_request.py>', 'exec')"], { input: Buffer.from(python, "utf8") });
    return result.status !== 0;
  });
  check(`${visibleOperations.length} 个生成脚本均通过 Python 语法检查`, syntaxFailures.length === 0, syntaxFailures.map(({ operation }) => operation.operationId).join(", "));
} else {
  check("Python 语法检查器可用", true, "当前环境无 Python，已跳过；GitHub Actions ubuntu-latest 将提供 python3");
}

const publicText = [html, app, css, siteCatalog].join("\n");
const sensitivePatterns = [
  /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{12,}/i,
  /sessionid=[A-Za-z0-9._-]{8,}/i,
  /[A-Za-z0-9._%+-]+@(?!example\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /\b[A-Z]{2}\d{5}\b/
];
const leaked = sensitivePatterns.filter((pattern) => pattern.test(publicText)).map(String);
check("公开站点敏感信息扫描通过", leaked.length === 0, leaked.join(", "));

const failures = checks.filter((item) => !item.passed);
const report = { passed: failures.length === 0, operationCount: catalog.operations.length, checks, failures };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
