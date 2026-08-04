const DOMAIN_LABELS = {
  authentication: "认证",
  account: "账户",
  data: "Data",
  operators: "Operator",
  simulation: "Simulation",
  alpha: "Alpha",
  events: "事件",
  messages: "消息",
  agreements: "协议",
  tags: "Alpha List",
  competitions: "比赛",
  consultant: "顾问与 SPC",
  teams: "团队",
  search: "搜索",
  activity: "活动与表现",
  tutorials: "教程"
};

const DOMAIN_ORDER = Object.keys(DOMAIN_LABELS);
const BASE_URL = "https://api.worldquantbrain.com";

const SENSITIVITY_DESCRIPTIONS = {
  none: "未发现额外的敏感信息或高风险副作用。",
  credential: "涉及账号密码、Token 或认证凭据；分享和保存前必须移除。",
  personal_data: "涉及个人资料、用户标识或账户相关数据；示例和日志应先去敏。",
  research: "涉及 Alpha、Simulation 或研究内容；避免公开策略、表达式和结果。",
  submission: "会提交 Alpha、比赛作品或其他成果，可能改变账户状态或评审结果。",
  destructive: "可能删除资源或产生难以撤销的修改；调用前必须确认目标。",
  legal: "涉及协议接受、法律声明或合规状态；操作前应人工确认内容。"
};

const SENSITIVITY_LABELS = {
  none: "无额外敏感项",
  credential: "认证凭据",
  personal_data: "个人数据",
  research: "研究内容",
  submission: "提交操作",
  destructive: "高风险操作",
  legal: "协议与法律"
};

const CONFIDENCE_LABELS = {
  high: "高可信度",
  medium: "中等可信度",
  low: "低可信度"
};

const elements = typeof document === "undefined" ? {} : {
  workspace: document.querySelector("#workspace"),
  search: document.querySelector("#global-search"),
  clearSearch: document.querySelector("#clear-search"),
  domainNav: document.querySelector("#domain-nav"),
  endpointList: document.querySelector("#endpoint-list"),
  endpointHeading: document.querySelector("#endpoint-heading"),
  operationCount: document.querySelector("#operation-count"),
  catalogVersion: document.querySelector("#catalog-version"),
  catalogStatus: document.querySelector("#catalog-status"),
  statusDot: document.querySelector(".status-dot"),
  docPane: document.querySelector("#doc-pane"),
  parameterForm: document.querySelector("#parameter-form"),
  parameterSummary: document.querySelector("#parameter-summary"),
  codeIntro: document.querySelector("#code-intro"),
  pythonCode: document.querySelector("#python-code"),
  codeLines: document.querySelector("#code-lines"),
  copyCode: document.querySelector("#copy-code"),
  downloadCode: document.querySelector("#download-code"),
  languageSelect: document.querySelector("#language-select"),
  languageTitle: document.querySelector("#code-language-title"),
  codeFilename: document.querySelector("#code-filename"),
  securityNote: document.querySelector("#security-note"),
  securityTitle: document.querySelector("#security-title"),
  securityCopy: document.querySelector("#security-copy"),
  toast: document.querySelector("#toast")
};

const state = {
  catalog: null,
  domain: "all",
  query: "",
  selectedId: null,
  language: "python",
  operationValues: new Map(),
  generatedCode: ""
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toSnakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "value";
}

function methodBadge(method) {
  const normalized = String(method).toUpperCase();
  return `<span class="method ${normalized.toLowerCase()}">${escapeHtml(normalized)}</span>`;
}

function helpTooltip(id, label, value, description) {
  const accessibleText = `${label} ${value}：${description}`;
  return `
    <span class="meta-help-wrap">
      <button class="meta-help" type="button" aria-label="${escapeHtml(accessibleText)}" aria-describedby="${escapeHtml(id)}">?</button>
      <span class="meta-tooltip" id="${escapeHtml(id)}" role="tooltip"><b>${escapeHtml(value)}</b>${escapeHtml(description)}</span>
    </span>
  `;
}

function operationAccept(operation) {
  if (operation.accept) return operation.accept;
  const version = operation.apiVersion ?? operation.apiVersions?.[0] ?? "2.0";
  return `application/json;version=${version}`;
}

function resolveSchema(schema, seen = new Set()) {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref?.startsWith("#/schemas/")) {
    const name = schema.$ref.slice("#/schemas/".length);
    if (seen.has(name)) return schema;
    const resolved = state.catalog?.schemas?.[name];
    return resolved ? resolveSchema(resolved, new Set([...seen, name])) : schema;
  }
  return schema;
}

function expandSchemaRefs(value, trail = []) {
  if (Array.isArray(value)) return value.map((item) => expandSchemaRefs(item, trail));
  if (!value || typeof value !== "object") return value;

  const ref = value.$ref;
  if (typeof ref === "string" && ref.startsWith("#/schemas/")) {
    const name = ref.slice("#/schemas/".length);
    const siblings = Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "$ref")
      .map(([key, item]) => [key, expandSchemaRefs(item, trail)]));
    if (trail.includes(name)) {
      return { $ref: ref, ...siblings };
    }
    const target = state.catalog?.schemas?.[name];
    if (!target) return { $ref: ref, ...siblings };
    const expanded = expandSchemaRefs(target, [...trail, name]);
    return { ...expanded, ...siblings };
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandSchemaRefs(item, trail)]));
}

function countSchemaRefs(value, trail = []) {
  if (Array.isArray(value)) return value.reduce((count, item) => count + countSchemaRefs(item, trail), 0);
  if (!value || typeof value !== "object") return 0;
  const ref = value.$ref;
  const siblingCount = Object.entries(value)
    .filter(([key]) => key !== "$ref")
    .reduce((count, [, item]) => count + countSchemaRefs(item, trail), 0);
  if (typeof ref !== "string" || !ref.startsWith("#/schemas/")) return siblingCount;
  const name = ref.slice("#/schemas/".length);
  if (trail.includes(name)) return 1 + siblingCount;
  const target = state.catalog?.schemas?.[name];
  return 1 + siblingCount + (target ? countSchemaRefs(target, [...trail, name]) : 0);
}

function stripSchemaMetadata(value) {
  if (Array.isArray(value)) return value.map(stripSchemaMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith("x-wq-"))
    .map(([key, item]) => [key, stripSchemaMetadata(item)]));
}

const SCHEMA_CONFIDENCE = {
  live_response_confirmed: ["实测响应确认", "真实 API 响应经人工复核与去敏后确认"],
  fixture_confirmed: ["内置示例确认", "前端内置示例 JSON 中明确出现"],
  decoder_confirmed: ["解析器确认", "前端存在明确的响应解析或类型校验代码"],
  consumer_confirmed: ["消费代码确认", "前端读取、展示或使用了该结构"],
  inferred: ["代码推断", "根据调用逻辑、命名或上下文推断，尚未被真实响应确认"],
  unknown: ["尚未确认", "目前没有足够证据确定该结构"]
};

function evidenceLabel(value) {
  return (SCHEMA_CONFIDENCE[value] ?? [value])[0];
}

function sensitivityLabel(value) {
  return SENSITIVITY_LABELS[value] ?? value;
}

function confidenceLabel(value) {
  return CONFIDENCE_LABELS[value] ?? value;
}

function operationConfidenceLabel(operation) {
  if (operation.response?.evidenceLevel === "live_response_confirmed") return "实测已确认";
  return confidenceLabel(operation.confidence);
}

function operationResponseSchema(operation) {
  if (operation.response.schemaRef) return { $ref: `#/schemas/${operation.response.schemaRef}` };
  return operation.response.schema ?? { type: "object", additionalProperties: true };
}

function requestDefinitions(operation) {
  if (!operation.requestBody) return [];
  if (operation.requestBody.contents) {
    return Object.entries(operation.requestBody.contents).map(([contentType, definition]) => ({ contentType, definition }));
  }
  return [{ contentType: operation.requestBody.contentType, definition: operation.requestBody }];
}

function definitionSchema(definition) {
  if (definition?.schemaRef) return { $ref: `#/schemas/${definition.schemaRef}` };
  return definition?.schema ?? { type: "object", additionalProperties: true };
}

function valueHint(name, schema = {}) {
  const normalized = String(name ?? "").toLowerCase();
  const hints = {
    captcha: "YOUR_CAPTCHA_TOKEN",
    email: "user@example.com",
    password: "YOUR_PASSWORD",
    name: "Example",
    alphaid: "YOUR_ALPHA_ID",
    simulationid: "YOUR_SIMULATION_ID",
    userid: "YOUR_USER_ID",
    teamid: "YOUR_TEAM_ID",
    tagid: "YOUR_TAG_ID",
    competitionid: "YOUR_COMPETITION_ID",
    messageid: "YOUR_MESSAGE_ID",
    agreementid: "YOUR_AGREEMENT_ID",
    submissionid: "YOUR_SUBMISSION_ID",
    tutorialid: "YOUR_TUTORIAL_ID",
    resourceid: "YOUR_RESOURCE_ID",
    resourcetype: "competitions",
    expression: "rank(close)",
    regular: "rank(close)",
    code: "rank(close)"
  };
  if (Object.hasOwn(hints, normalized)) return hints[normalized];
  if (normalized.endsWith("id")) return `YOUR_${toSnakeCase(name).toUpperCase()}`;
  if (schema.format === "date") return "2026-01-01";
  if (schema.format === "date-time") return "2026-01-01T00:00:00Z";
  if (schema.format === "uri" || schema.format === "uri-reference") return "https://example.com";
  if (schema.format === "binary") return `./${toSnakeCase(name || "file")}.bin`;
  return "string";
}

function sampleFromSchema(inputSchema, name = "value", depth = 0, seen = new Set()) {
  if (depth > 7 || !inputSchema) return null;
  if (inputSchema.example !== undefined) return structuredClone(inputSchema.example);
  if (inputSchema.default !== undefined) return structuredClone(inputSchema.default);
  if (inputSchema.const !== undefined) return structuredClone(inputSchema.const);
  if (Array.isArray(inputSchema.enum) && inputSchema.enum.length) return structuredClone(inputSchema.enum[0]);
  if (inputSchema.$ref?.startsWith("#/schemas/")) {
    const refName = inputSchema.$ref.slice("#/schemas/".length);
    if (seen.has(refName)) return {};
    return sampleFromSchema(state.catalog.schemas?.[refName], name, depth + 1, new Set([...seen, refName]));
  }
  if (inputSchema.oneOf?.length) return sampleFromSchema(inputSchema.oneOf[0], name, depth + 1, seen);
  if (inputSchema.anyOf?.length) return sampleFromSchema(inputSchema.anyOf[0], name, depth + 1, seen);
  if (inputSchema.allOf?.length) {
    return Object.assign({}, ...inputSchema.allOf.map((part) => sampleFromSchema(part, name, depth + 1, seen) ?? {}));
  }

  const schema = resolveSchema(inputSchema, seen) ?? inputSchema;
  const declaredType = schema.type ?? (schema.properties ? "object" : undefined);
  const type = Array.isArray(declaredType) ? declaredType.find((item) => item !== "null") ?? declaredType[0] : declaredType;
  if (type === "object") {
    const result = {};
    const entries = Object.entries(schema.properties ?? {});
    const required = new Set(schema.required ?? []);
    const selected = entries.filter(([key]) => required.has(key));
    for (const entry of entries) if (!selected.includes(entry) && selected.length < 10) selected.push(entry);
    for (const [key, child] of selected) result[key] = sampleFromSchema(child, key, depth + 1, seen);
    return result;
  }
  if (type === "array") return [sampleFromSchema(schema.items ?? {}, name.replace(/s$/, ""), depth + 1, seen)];
  if (type === "integer") return 0;
  if (type === "number") return 0.0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return valueHint(name, schema);
}

function simulationRequestSample() {
  return {
    type: "REGULAR",
    settings: {
      instrumentType: "EQUITY",
      region: "USA",
      universe: "TOP3000",
      delay: 1,
      decay: 4,
      neutralization: "SUBINDUSTRY",
      truncation: 0.08,
      pasteurization: "ON",
      unitHandling: "VERIFY",
      nanHandling: "OFF",
      language: "FASTEXPR",
      visualization: false
    },
    regular: "rank(close)"
  };
}

function bodySample(operation, contentType) {
  const definition = requestDefinitions(operation).find((item) => item.contentType === contentType)?.definition;
  if (operation.operationId === "createSimulation" && contentType === "application/json") return simulationRequestSample();
  if (definition?.exampleRef && state.catalog?.examples?.[definition.exampleRef]) {
    return structuredClone(state.catalog.examples[definition.exampleRef].value);
  }
  return sampleFromSchema(definitionSchema(definition), "payload");
}

function parameterDefault(parameter) {
  if (parameter.schema?.default !== undefined) return String(parameter.schema.default);
  if (parameter.schema?.example !== undefined) return String(parameter.schema.example);
  if (parameter.schema?.enum?.length) return String(parameter.schema.enum[0]);
  if (parameter.in === "path") return valueHint(parameter.name, parameter.schema);
  if (parameter.name === "limit") return "50";
  if (parameter.name === "offset") return "0";
  return "";
}

function authModes(operation) {
  return [operation.auth, ...(operation.authAlternatives ?? [])].filter(Boolean);
}

function defaultOperationValues(operation) {
  const definitions = requestDefinitions(operation);
  const contentType = definitions[0]?.contentType ?? null;
  const params = {};
  for (const parameter of operation.parameters ?? []) params[`${parameter.in}:${parameter.name}`] = parameterDefault(parameter);
  return {
    params,
    contentType,
    bodies: contentType ? { [contentType]: JSON.stringify(bodySample(operation, contentType), null, 2) } : {},
    includeLogin: authModes(operation).includes("cookie_session"),
    includePolling: Boolean(operation.behavior?.poll || operation.behavior?.polling),
    bodyError: ""
  };
}

function valuesFor(operation) {
  if (!state.operationValues.has(operation.operationId)) {
    state.operationValues.set(operation.operationId, defaultOperationValues(operation));
  }
  return state.operationValues.get(operation.operationId);
}

function visibleOperations() {
  return state.catalog?.operations.filter((operation) => operation.visibility !== "hidden") ?? [];
}

function filteredOperations() {
  const query = state.query.trim().toLowerCase();
  return visibleOperations()
    .filter((operation) => state.domain === "all" || operation.domain === state.domain)
    .filter((operation) => {
      if (!query) return true;
      return [operation.operationId, operation.summary, operation.path, operation.method, DOMAIN_LABELS[operation.domain]]
        .some((value) => String(value ?? "").toLowerCase().includes(query));
    })
    .sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function selectedOperation() {
  return visibleOperations().find((operation) => operation.operationId === state.selectedId) ?? null;
}

function renderDomains() {
  const counts = Object.fromEntries(DOMAIN_ORDER.map((domain) => [domain, 0]));
  const operations = visibleOperations();
  for (const operation of operations) counts[operation.domain] = (counts[operation.domain] ?? 0) + 1;
  elements.domainNav.innerHTML = [
    `<button class="domain-button all-domains ${state.domain === "all" ? "active" : ""}" type="button" data-domain="all"><span>全部业务域</span><span>${operations.length}</span></button>`,
    ...DOMAIN_ORDER.filter((domain) => counts[domain]).map((domain) =>
      `<button class="domain-button ${state.domain === domain ? "active" : ""}" type="button" data-domain="${escapeHtml(domain)}"><span>${escapeHtml(DOMAIN_LABELS[domain])}</span><span>${counts[domain]}</span></button>`
    )
  ].join("");
}

function renderEndpointList() {
  const operations = filteredOperations();
  const label = state.query
    ? `搜索结果 · ${operations.length}`
    : state.domain === "all" ? "全部接口" : `${DOMAIN_LABELS[state.domain]} · ${operations.length}`;
  elements.endpointHeading.textContent = label;
  elements.clearSearch.hidden = !state.query;
  if (!operations.length) {
    elements.endpointList.innerHTML = `<div class="empty-list">没有匹配的接口。尝试缩短关键词或切换业务域。</div>`;
    return;
  }
  elements.endpointList.innerHTML = operations.map((operation) => `
    <button class="endpoint-button ${state.selectedId === operation.operationId ? "active" : ""}" type="button" role="option" aria-selected="${state.selectedId === operation.operationId}" data-operation-id="${escapeHtml(operation.operationId)}">
      ${methodBadge(operation.method)}
      <span class="endpoint-copy">
        <strong>${escapeHtml(operation.summary)}</strong>
        <small>${escapeHtml(operation.path)}</small>
      </span>
    </button>
  `).join("");
}

function schemaBlock(schema, label) {
  const refCount = countSchemaRefs(schema);
  const expanded = expandSchemaRefs(schema);
  const shown = stripSchemaMetadata(expanded);
  const schemaNote = refCount ? `${refCount} refs · 已递归展开` : "Schema";
  return `
    <div class="schema-block">
      <div class="schema-label"><span>${escapeHtml(label)}</span><span>${escapeHtml(schemaNote)}</span></div>
      <pre>${escapeHtml(JSON.stringify(shown, null, 2))}</pre>
    </div>
  `;
}

function responseExampleBlock(exampleRef) {
  if (!exampleRef) return "";
  const example = state.catalog?.examples?.[exampleRef];
  if (!example) return "";
  return `
    <div class="response-example">
      <div class="schema-label"><span>去敏响应示例</span></div>
      <pre>${escapeHtml(JSON.stringify(example.value, null, 2))}</pre>
    </div>
  `;
}

function schemaExampleBlock(value, label, sourceLabel = "Schema 生成") {
  return `
    <div class="response-example schema-example">
      <div class="schema-label"><span>${escapeHtml(label)}</span><span>${escapeHtml(sourceLabel)}</span></div>
      <pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>
    </div>
  `;
}

function responseExampleForOperation(operation) {
  const confirmed = responseExampleBlock(operation.response.exampleRef);
  if (confirmed) return confirmed;
  if (["empty", "headers"].includes(operation.response.mode) || operation.response.statuses?.every((status) => status === 204)) return "";
  return schemaExampleBlock(
    sampleFromSchema(operationResponseSchema(operation), "response"),
    "响应结构示例"
  );
}

function renderDoc(operation) {
  const parameters = operation.parameters ?? [];
  const definitions = requestDefinitions(operation);
  const successStatuses = operation.response.statuses ?? [];
  const errorStatuses = operation.response.errorStatuses ?? [];
  const evidence = operation.evidence ?? [];
  const behavior = operation.behavior ?? {};
  const behaviorEntries = Object.entries(behavior);
  const accepts = operation.accept
    ? [operation.accept]
    : (operation.apiVersions ?? [operation.apiVersion]).map((version) => `application/json;version=${version}`);
  const evidenceDescription = state.catalog?.evidenceLevels?.[operation.response.evidenceLevel] ?? "当前目录尚未提供该证据等级的补充说明。";
  const sensitivityDescription = SENSITIVITY_DESCRIPTIONS[operation.sensitivity] ?? "当前目录尚未提供该敏感等级的补充说明。";
  const evidenceDisplay = evidenceLabel(operation.response.evidenceLevel);
  const sensitivityDisplay = sensitivityLabel(operation.sensitivity);

  elements.docPane.innerHTML = `
    <div class="breadcrumbs"><span>WQ API</span><span>/</span><span>${escapeHtml(DOMAIN_LABELS[operation.domain] ?? operation.domain)}</span></div>
    <div class="operation-title">
      <h1>${escapeHtml(operation.summary)}</h1>
      <span class="confidence-stamp">${escapeHtml(operationConfidenceLabel(operation))}</span>
    </div>
    <p class="operation-id">operationId: ${escapeHtml(operation.operationId)}</p>
    <div class="route-card">${methodBadge(operation.method)}<code>${escapeHtml(operation.path)}</code></div>
    <div class="meta-grid">
      <div class="meta-card"><span>鉴权</span><strong>${escapeHtml(authModes(operation).join(" / "))}</strong></div>
      <div class="meta-card"><span>Accept</span><strong title="${escapeHtml(accepts.join(" / "))}">${escapeHtml(accepts.join(" / "))}</strong></div>
      <div class="meta-card"><span class="meta-label">响应证据 ${helpTooltip("response-evidence-help", "响应证据", evidenceDisplay, evidenceDescription)}</span><strong>${escapeHtml(evidenceDisplay)}</strong></div>
      <div class="meta-card"><span class="meta-label">敏感等级 ${helpTooltip("sensitivity-help", "敏感等级", sensitivityDisplay, sensitivityDescription)}</span><strong>${escapeHtml(sensitivityDisplay)}</strong></div>
    </div>

    <section class="doc-section">
      <div class="section-heading"><h2>参数</h2><span>${parameters.length} fields</span></div>
      ${parameters.length ? `
        <div class="doc-table-wrap"><table class="doc-table">
          <thead><tr><th>名称</th><th>位置</th><th>类型</th><th>默认值 / 枚举</th><th>说明</th></tr></thead>
          <tbody>${parameters.map((parameter) => `
            <tr>
              <td><code>${escapeHtml(parameter.name)}</code>${parameter.required ? '<span class="required-mark">required</span>' : ""}</td>
              <td>${escapeHtml(parameter.in)}</td>
              <td>${escapeHtml(parameter.schema?.type ?? "unknown")}</td>
              <td>${escapeHtml(parameter.schema?.default ?? parameter.schema?.enum?.join(" | ") ?? "—")}</td>
              <td>${escapeHtml(parameter.description ?? "—")}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : '<div class="empty-section">这个调用点没有路径或查询参数。</div>'}
    </section>

    <section class="doc-section">
      <div class="section-heading"><h2>请求体</h2><span>${definitions.length ? definitions.map((item) => item.contentType).join(" / ") : "none"}</span></div>
      ${definitions.length
        ? definitions.map(({ contentType, definition }) => `
          ${schemaBlock(definitionSchema(definition), contentType)}
          ${schemaExampleBlock(
            bodySample(operation, contentType),
            "请求体示例",
            definition.exampleRef ? "去敏实测示例" : "Schema 生成"
          )}
        `).join("<br>")
        : '<div class="empty-section">这个接口不发送请求体。</div>'}
    </section>

    <section class="doc-section">
      <div class="section-heading"><h2>响应</h2><span>${escapeHtml(operation.response.mode)}</span></div>
      <div class="status-row">
        ${successStatuses.map((status) => `<span class="status-chip success">HTTP ${status}</span>`).join("")}
        ${errorStatuses.map((status) => `<span class="status-chip error">HTTP ${status}</span>`).join("")}
      </div>
      <div style="height:12px"></div>
      ${schemaBlock(operationResponseSchema(operation), "响应 Schema")}
      ${responseExampleForOperation(operation)}
    </section>

    <section class="doc-section">
      <div class="section-heading"><h2>运行行为</h2><span>${behaviorEntries.length} rules</span></div>
      ${behaviorEntries.length
        ? `<ul class="behavior-list">${behaviorEntries.map(([key, value]) => `<li class="behavior-chip">${escapeHtml(key)} = ${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</li>`).join("")}</ul>`
        : '<div class="empty-section">没有从前端确认到额外的分页、轮询或重定向规则。</div>'}
    </section>

    <section class="doc-section">
      <div class="section-heading"><h2>源码证据</h2><span>${evidence.length} locations</span></div>
      ${evidence.length
        ? `<ul class="evidence-list">${evidence.map((item) => `<li><code>${escapeHtml(item.source)}${item.line ? `:${item.line}` : ""}${item.offset != null ? ` · offset ${item.offset}` : ""}</code>${item.moduleId ? ` · Webpack module ${escapeHtml(item.moduleId)}` : ""}${item.note ? `<br>${escapeHtml(item.note)}` : ""}</li>`).join("")}</ul>`
        : '<div class="empty-section">当前目录没有记录源码位置。</div>'}
    </section>
  `;
  elements.docPane.scrollTop = 0;
}

function renderParameterForm(operation) {
  const values = valuesFor(operation);
  const definitions = requestDefinitions(operation);
  const fields = [];
  const modes = authModes(operation);
  const cookieAuth = authModes(operation).includes("cookie_session");
  const credentialAuth = cookieAuth || modes.includes("basic") || modes.includes("bearer");
  if (credentialAuth) {
    fields.push(state.language === "javascript"
      ? '<div class="credential-note">请仅在已登录的 WQ 官方页面控制台运行。Cookie Session 会由 fetch 自动携带；Basic 或 Bearer 接口会在运行时通过 prompt 获取凭据。</div>'
      : '<div class="credential-note">Python 代码不写入凭据，运行时从 WQ_EMAIL、WQ_PASSWORD 或 WQ_TOKEN 环境变量读取。</div>');
  }
  if (cookieAuth && state.language === "python") {
    fields.push(`
      <label class="toggle-row"><span>包含登录与 Cookie Session</span><input type="checkbox" data-setting="includeLogin" ${values.includeLogin ? "checked" : ""}></label>
    `);
  }
  if (operation.behavior?.poll || operation.behavior?.polling) {
    fields.push(`
      <label class="toggle-row"><span>包含 Retry-After 轮询</span><input type="checkbox" data-setting="includePolling" ${values.includePolling ? "checked" : ""}></label>
    `);
  }
  for (const parameter of operation.parameters ?? []) {
    const key = `${parameter.in}:${parameter.name}`;
    fields.push(`
      <label class="generator-field">
        <span class="generator-label"><code>${escapeHtml(parameter.name)}</code><small>${escapeHtml(parameter.in)} · ${escapeHtml(parameter.schema?.type ?? "unknown")}${parameter.required ? " · required" : " · optional"}</small></span>
        <input type="text" data-parameter="${escapeHtml(key)}" value="${escapeHtml(values.params[key])}" placeholder="留空则不发送可选参数">
      </label>
    `);
  }
  if (definitions.length > 1) {
    fields.push(`
      <label class="generator-field">
        <span class="generator-label"><code>Content-Type</code><small>request body</small></span>
        <select data-setting="contentType">${definitions.map(({ contentType }) => `<option value="${escapeHtml(contentType)}" ${contentType === values.contentType ? "selected" : ""}>${escapeHtml(contentType)}</option>`).join("")}</select>
      </label>
    `);
  }
  if (values.contentType) {
    fields.push(`
      <label class="generator-field">
        <span class="generator-label"><code>request_body</code><small>${escapeHtml(values.contentType)}</small></span>
        <textarea spellcheck="false" data-body>${escapeHtml(values.bodies[values.contentType] ?? "{}")}</textarea>
      </label>
      <div id="body-error" class="form-error" ${values.bodyError ? "" : "hidden"}>${escapeHtml(values.bodyError)}</div>
    `);
  }
  if (!fields.length) fields.push('<div class="code-intro">这个接口不需要额外参数；代码仍会包含认证、响应解析和错误处理。</div>');
  elements.parameterForm.innerHTML = fields.join("");
  const adjustableCount = (operation.parameters?.length ?? 0) + (values.contentType ? 1 : 0);
  elements.parameterSummary.textContent = `${adjustableCount} 项可编辑`;
}

function pythonLiteral(value, level = 0) {
  const indent = "    ".repeat(level);
  const childIndent = "    ".repeat(level + 1);
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((item) => `${childIndent}${pythonLiteral(item, level + 1)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([key, item]) => `${childIndent}${JSON.stringify(key)}: ${pythonLiteral(item, level + 1)}`).join(",\n")}\n${indent}}`;
}

function parameterValue(raw, schema = {}) {
  if (raw === "") return undefined;
  if (schema.type === "integer") return Number.parseInt(raw, 10);
  if (schema.type === "number") return Number.parseFloat(raw);
  if (schema.type === "boolean") return String(raw).toLowerCase() === "true";
  if (["array", "object"].includes(schema.type)) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

function retryHelperLines() {
  return [
    "def retry_after_seconds(response: requests.Response, fallback: float = 1.0) -> float:",
    "    value = response.headers.get(\"Retry-After\")",
    "    if not value:",
    "        return fallback",
    "    try:",
    "        return max(float(value), 0.0)",
    "    except ValueError:",
    "        try:",
    "            target = parsedate_to_datetime(value)",
    "            return max((target - datetime.now(timezone.utc)).total_seconds(), 0.0)",
    "        except (TypeError, ValueError, OverflowError):",
    "            return fallback",
    ""
  ];
}

function requestArguments(operation, values, variableNames) {
  const args = ["endpoint", "headers=headers", "timeout=30"];
  const queryParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "query" && values.params[`query:${parameter.name}`] !== "");
  if (queryParameters.length) args.splice(2, 0, "params=params");
  if (values.contentType === "application/json") args.splice(2, 0, "json=payload");
  if (values.contentType === "multipart/form-data") {
    args.splice(2, 0, "data=form_data", "files=files");
  }
  const modes = authModes(operation);
  if (modes.includes("basic") && operation.operationId !== "createAuthentication") args.push("auth=HTTPBasicAuth(email, password)");
  if (modes.includes("bearer")) variableNames.needsBearer = true;
  return args;
}

function buildPython(operation) {
  const values = valuesFor(operation);
  const imports = new Set(["import os", "from pprint import pprint", "import requests"]);
  const lines = [];
  const variables = { needsBearer: false };
  const modes = authModes(operation);
  const needsBasic = modes.includes("basic") || values.includeLogin;
  const needsPolling = values.includePolling && Boolean(operation.behavior?.poll || operation.behavior?.polling);
  const pollOperation = needsPolling && operation.behavior?.poll
    ? state.catalog.operations.find((item) => item.operationId === operation.behavior.poll)
    : null;
  const outputResponse = pollOperation?.response ?? operation.response;
  const isMultipart = values.contentType === "multipart/form-data";
  if (needsBasic) imports.add("from requests.auth import HTTPBasicAuth");
  if (needsPolling) {
    imports.add("import time");
    imports.add("from datetime import datetime, timezone");
    imports.add("from email.utils import parsedate_to_datetime");
  }
  if (isMultipart) {
    imports.add("import json");
    imports.add("from pathlib import Path");
  }

  lines.push(`BASE_URL = ${JSON.stringify(state.catalog.generatedFrom?.baseUrl ?? BASE_URL)}`, "session = requests.Session()", "");

  if (values.includeLogin) {
    lines.push(
      "# 1. 使用 Basic 凭据建立 Cookie Session",
      'email = os.environ["WQ_EMAIL"]',
      'password = os.environ["WQ_PASSWORD"]',
      'captcha = os.environ.get("WQ_CAPTCHA")',
      "login_payload = {\"captcha\": captcha} if captcha else None",
      "",
      "login_response = session.post(",
      '    f"{BASE_URL}/authentication",',
      "    auth=HTTPBasicAuth(email, password),",
      `    headers={"Accept": ${JSON.stringify(state.catalog.generatedFrom?.defaultAccept ?? "application/json;version=2.0")}},`,
      "    json=login_payload,",
      "    timeout=30,",
      ")",
      "login_response.raise_for_status()",
      "# requests.Session 会自动保留服务端设置的 Cookie。",
      ""
    );
  } else if (modes.includes("basic")) {
    lines.push('email = os.environ["WQ_EMAIL"]', 'password = os.environ["WQ_PASSWORD"]', "");
  }
  if (modes.includes("bearer")) {
    lines.push('token = os.environ["WQ_TOKEN"]', "");
  }

  if (needsPolling) lines.push(...retryHelperLines());

  const pathParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "path");
  const queryParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "query" && values.params[`query:${parameter.name}`] !== "");
  if (pathParameters.length) {
    lines.push(`# ${values.includeLogin ? "2" : "1"}. 设置路径参数`);
    for (const parameter of pathParameters) {
      const value = parameterValue(values.params[`path:${parameter.name}`], parameter.schema);
      lines.push(`${toSnakeCase(parameter.name)} = ${pythonLiteral(value ?? valueHint(parameter.name, parameter.schema))}`);
    }
    lines.push("");
  }

  const pythonPath = operation.path.replace(/\{([^}]+)\}/g, (_, name) => `{${toSnakeCase(name)}}`);
  const step = values.includeLogin ? (pathParameters.length ? 3 : 2) : (pathParameters.length ? 2 : 1);
  lines.push(`# ${step}. 调用 ${operation.operationId}`, `endpoint = f"{BASE_URL}${pythonPath}"`);

  if (queryParameters.length) {
    const queryObject = Object.fromEntries(queryParameters.map((parameter) => [parameter.name, parameterValue(values.params[`query:${parameter.name}`], parameter.schema)]));
    lines.push(`params = ${pythonLiteral(queryObject)}`);
  }

  let parsedBody = null;
  if (values.contentType) {
    try {
      parsedBody = JSON.parse(values.bodies[values.contentType] ?? "{}");
      values.bodyError = "";
    } catch (error) {
      values.bodyError = `请求体不是有效 JSON：${error.message}`;
      parsedBody = {};
    }
  }

  if (values.contentType === "application/json") {
    lines.push(`payload = ${pythonLiteral(parsedBody)}`);
  } else if (isMultipart) {
    const schema = resolveSchema(definitionSchema(requestDefinitions(operation).find((item) => item.contentType === values.contentType)?.definition));
    const binaryKeys = Object.entries(schema?.properties ?? {}).filter(([, property]) => property.format === "binary").map(([key]) => key);
    const formData = Object.fromEntries(Object.entries(parsedBody ?? {}).filter(([key]) => !binaryKeys.includes(key)));
    if (Object.hasOwn(formData, "user") && typeof formData.user !== "string") formData.user = JSON.stringify(formData.user);
    lines.push(`form_data = ${pythonLiteral(formData)}`);
    lines.push("file_handles = {}");
    for (const key of binaryKeys) {
      const filePath = parsedBody?.[key];
      if (filePath) lines.push(`file_handles[${JSON.stringify(key)}] = Path(${JSON.stringify(filePath)}).open("rb")`);
    }
    lines.push("files = {name: (handle.name, handle) for name, handle in file_handles.items()}");
  }

  const headers = { Accept: operationAccept(operation) };
  if (modes.includes("bearer")) headers.Authorization = "Bearer {token}";
  const headerLines = Object.entries(headers).map(([key, value]) => {
    if (key === "Authorization") return `    ${JSON.stringify(key)}: f"${value}",`;
    return `    ${JSON.stringify(key)}: ${JSON.stringify(value)},`;
  });
  lines.push("headers = {", ...headerLines, "}", "");

  if (operation.operationId === "createAuthentication" && values.includeLogin) {
    lines.push("response = login_response");
  } else {
    const args = requestArguments(operation, values, variables);
    const callLines = [
      `response = session.request(${JSON.stringify(operation.method)},`,
      ...args.map((arg) => `    ${arg},`),
      ")"
    ];
    if (isMultipart) {
      lines.push("try:", ...callLines.map((line) => `    ${line}`), "finally:", "    for handle in file_handles.values():", "        handle.close()");
    } else {
      lines.push(...callLines);
    }
  }

  lines.push("response.raise_for_status()", "");

  if (needsPolling && operation.behavior?.poll) {
    const pollAccept = pollOperation ? operationAccept(pollOperation) : operationAccept(operation);
    lines.push("initial_response = response");
    if (operation.behavior.locationHeader) {
      lines.push(
        "poll_url = response.headers.get(\"Location\")",
        "if not poll_url:",
        "    raise RuntimeError(\"响应缺少 Location，无法继续轮询\")"
      );
    } else {
      lines.push("poll_url = endpoint");
    }
    if (operation.behavior?.retryAfterHeader) {
      lines.push(
        "",
        "while response.headers.get(\"Retry-After\"):",
        "    time.sleep(retry_after_seconds(response))",
        "    response = session.get(",
        "        poll_url,",
        `        headers={"Accept": ${JSON.stringify(pollAccept)}},`,
        "        timeout=30,",
        "    )",
        "    response.raise_for_status()",
        ""
      );
    } else {
      lines.push(
        "",
        "while True:",
        "    poll_response = session.get(",
        "        poll_url,",
        `        headers={"Accept": ${JSON.stringify(pollAccept)}},`,
        "        timeout=30,",
        "    )",
        "    poll_response.raise_for_status()",
        "    if poll_response.status_code != 202:",
        "        response = poll_response",
        "        break",
        "    time.sleep(retry_after_seconds(poll_response))",
        ""
      );
    }
  } else if (needsPolling && operation.behavior?.polling) {
    const pollingCondition = operation.response.statuses?.includes(202)
      ? 'response.status_code == 202 or response.headers.get("Retry-After")'
      : 'response.headers.get("Retry-After")';
    lines.push(
      `while ${pollingCondition}:`,
      "    time.sleep(retry_after_seconds(response))",
      `    response = session.request(${JSON.stringify(operation.method)}, endpoint, headers=headers, timeout=30)`,
      "    response.raise_for_status()",
      ""
    );
  }

  lines.push("# 输出状态、关键响应头与响应体", "print(f\"HTTP {response.status_code}\")");
  if (operation.response.headers?.Location || operation.behavior?.locationHeader) lines.push(`print("Location:", ${(needsPolling && operation.behavior?.poll) ? "initial_response" : "response"}.headers.get("Location"))`);
  if (outputResponse.mode === "headers") {
    lines.push("pprint(dict(response.headers))");
  } else if (["text", "text_or_empty"].includes(outputResponse.mode)) {
    lines.push("print(response.text if response.content else \"<empty response>\")");
  } else {
    lines.push(
      "if response.content:",
      "    try:",
      "        pprint(response.json())",
      "    except requests.exceptions.JSONDecodeError:",
      "        print(response.text)",
      "else:",
      "    print(\"<empty response>\")"
    );
  }

  const importLines = [...imports].sort((a, b) => {
    const fromA = a.startsWith("from ");
    const fromB = b.startsWith("from ");
    return fromA - fromB || a.localeCompare(b);
  });
  return [...importLines, "", ...lines].join("\n");
}

function indentedJson(value, spaces = 2) {
  return (JSON.stringify(value, null, 2) ?? "null").replaceAll("\n", `\n${" ".repeat(spaces)}`);
}

function buildJavascript(operation) {
  const values = valuesFor(operation);
  const lines = [
    "// 在已登录的 WQ 官方页面控制台运行；不要在其他网站执行。",
    "(async () => {",
    `  const BASE_URL = ${JSON.stringify(state.catalog.generatedFrom?.baseUrl ?? BASE_URL)};`
  ];
  const auth = operation.auth ?? "none";
  const needsPolling = values.includePolling && Boolean(operation.behavior?.poll || operation.behavior?.polling);
  const pollOperation = needsPolling && operation.behavior?.poll
    ? state.catalog.operations.find((item) => item.operationId === operation.behavior.poll)
    : null;
  const outputResponse = pollOperation?.response ?? operation.response;
  const pathParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "path");
  const queryParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "query" && values.params[`query:${parameter.name}`] !== "");

  if (auth === "basic") {
    lines.push(
      "  const email = prompt(\"WQ 登录邮箱\");",
      "  const password = prompt(\"WQ 登录密码\");",
      "  if (!email || !password) throw new Error(\"已取消 Basic 凭据输入\");",
      "  const basicBytes = new TextEncoder().encode(`${email}:${password}`);",
      "  let basicBinary = \"\";",
      "  for (const byte of basicBytes) basicBinary += String.fromCharCode(byte);",
      "  const basicAuthorization = `Basic ${btoa(basicBinary)}`;",
      ""
    );
  } else if (auth === "bearer") {
    lines.push(
      "  const token = prompt(\"WQ Bearer Token\");",
      "  if (!token) throw new Error(\"已取消 Bearer Token 输入\");",
      ""
    );
  }

  for (const parameter of pathParameters) {
    const value = parameterValue(values.params[`path:${parameter.name}`], parameter.schema);
    lines.push(`  const ${toSnakeCase(parameter.name)} = ${JSON.stringify(value ?? valueHint(parameter.name, parameter.schema))};`);
  }
  if (pathParameters.length) lines.push("");

  const javascriptPath = operation.path.replace(/\{([^}]+)\}/g, (_, name) => `\${encodeURIComponent(${toSnakeCase(name)})}`);
  lines.push(`  const endpoint = \`\${BASE_URL}${javascriptPath}\`;`);
  if (queryParameters.length) {
    const queryObject = Object.fromEntries(queryParameters.map((parameter) => [parameter.name, parameterValue(values.params[`query:${parameter.name}`], parameter.schema)]));
    lines.push(
      `  const queryValues = ${indentedJson(queryObject, 2)};`,
      "  const search = new URLSearchParams();",
      "  for (const [key, value] of Object.entries(queryValues)) {",
      "    if (Array.isArray(value)) value.forEach((item) => search.append(key, String(item)));",
      "    else search.set(key, String(value));",
      "  }",
      "  const queryString = search.toString();",
      "  const requestUrl = queryString ? `${endpoint}?${queryString}` : endpoint;"
    );
  } else {
    lines.push("  const requestUrl = endpoint;");
  }

  let parsedBody = null;
  if (values.contentType) {
    try {
      parsedBody = JSON.parse(values.bodies[values.contentType] ?? "{}");
      values.bodyError = "";
    } catch (error) {
      values.bodyError = `请求体不是有效 JSON：${error.message}`;
      parsedBody = {};
    }
  }

  const headers = { Accept: operationAccept(operation) };
  if (auth === "basic") headers.Authorization = "__BASIC__";
  if (auth === "bearer") headers.Authorization = "__BEARER__";
  lines.push("", "  const headers = {");
  for (const [key, value] of Object.entries(headers)) {
    if (value === "__BASIC__") lines.push(`    ${JSON.stringify(key)}: basicAuthorization,`);
    else if (value === "__BEARER__") lines.push(`    ${JSON.stringify(key)}: \`Bearer \${token}\`,`);
    else lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  }
  if (values.contentType === "application/json") lines.push('    "Content-Type": "application/json",');
  lines.push("  };", "  const options = {", `    method: ${JSON.stringify(operation.method)},`, '    credentials: "include",', "    headers,", "  };");

  if (values.contentType === "application/json") {
    lines.push(`  const payload = ${indentedJson(parsedBody, 2)};`, "  options.body = JSON.stringify(payload);");
  } else if (values.contentType === "multipart/form-data") {
    const schema = resolveSchema(definitionSchema(requestDefinitions(operation).find((item) => item.contentType === values.contentType)?.definition));
    const binaryKeys = Object.entries(schema?.properties ?? {}).filter(([, property]) => property.format === "binary").map(([key]) => key);
    const formData = Object.fromEntries(Object.entries(parsedBody ?? {}).filter(([key]) => !binaryKeys.includes(key)));
    lines.push(
      "  const chooseFile = (fieldName) => new Promise((resolve, reject) => {",
      "    const input = document.createElement(\"input\");",
      '    input.type = "file";',
      "    input.addEventListener(\"change\", () => {",
      "      const [file] = input.files;",
      "      file ? resolve(file) : reject(new Error(`未选择 ${fieldName}`));",
      "    }, { once: true });",
      "    input.click();",
      "  });",
      `  const formValues = ${indentedJson(formData, 2)};`,
      "  const formData = new FormData();",
      "  for (const [key, value] of Object.entries(formValues)) {",
      '    formData.append(key, typeof value === "string" ? value : JSON.stringify(value));',
      "  }"
    );
    for (const key of binaryKeys) lines.push(`  formData.append(${JSON.stringify(key)}, await chooseFile(${JSON.stringify(key)}));`);
    lines.push("  options.body = formData;");
  }

  lines.push(
    "",
    "  const assertOk = async (response) => {",
    "    if (response.ok) return;",
    "    const details = await response.text();",
    "    throw new Error(`HTTP ${response.status} ${response.statusText}${details ? `\\n${details}` : \"\"}`);",
    "  };"
  );
  if (needsPolling) {
    lines.push(
      "  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));",
      "  const retryAfterMs = (response, fallback = 1000) => {",
      '    const value = response.headers.get("Retry-After");',
      "    if (!value) return fallback;",
      "    const seconds = Number(value);",
      "    if (Number.isFinite(seconds)) return Math.max(seconds * 1000, 0);",
      "    const target = Date.parse(value);",
      "    return Number.isNaN(target) ? fallback : Math.max(target - Date.now(), 0);",
      "  };"
    );
  }

  lines.push("", "  let response = await fetch(requestUrl, options);", "  await assertOk(response);");
  if (needsPolling && operation.behavior?.poll) {
    const pollAccept = pollOperation ? operationAccept(pollOperation) : operationAccept(operation);
    lines.push("  const initialResponse = response;");
    if (operation.behavior.locationHeader) {
      lines.push(
        '  const pollUrl = response.headers.get("Location");',
        '  if (!pollUrl) throw new Error("响应缺少 Location，无法继续轮询");'
      );
    } else {
      lines.push("  const pollUrl = requestUrl;");
    }
    if (operation.behavior?.retryAfterHeader) {
      lines.push(
        '  while (response.headers.has("Retry-After")) {',
        "    await sleep(retryAfterMs(response));",
        "    response = await fetch(pollUrl, {",
        '      method: "GET",',
        '      credentials: "include",',
        `      headers: { Accept: ${JSON.stringify(pollAccept)} },`,
        "    });",
        "    await assertOk(response);",
        "  }"
      );
    } else {
      lines.push(
        "  while (true) {",
        "    response = await fetch(pollUrl, {",
        '      method: "GET",',
        '      credentials: "include",',
        `      headers: { Accept: ${JSON.stringify(pollAccept)} },`,
        "    });",
        "    await assertOk(response);",
        "    if (response.status !== 202) break;",
        "    await sleep(retryAfterMs(response));",
        "  }"
      );
    }
  } else if (needsPolling && operation.behavior?.polling) {
    const pollingCondition = operation.response.statuses?.includes(202)
      ? 'response.status === 202 || response.headers.has("Retry-After")'
      : 'response.headers.has("Retry-After")';
    lines.push(
      `  while (${pollingCondition}) {`,
      "    await sleep(retryAfterMs(response));",
      "    response = await fetch(requestUrl, options);",
      "    await assertOk(response);",
      "  }"
    );
  }

  lines.push("", "  console.log(`HTTP ${response.status}`);");
  if (operation.response.headers?.Location || operation.behavior?.locationHeader) {
    lines.push(`  console.log("Location:", ${(needsPolling && operation.behavior?.poll) ? "initialResponse" : "response"}.headers.get("Location"));`);
  }
  if (outputResponse.mode === "headers") {
    lines.push("  console.log(Object.fromEntries(response.headers.entries()));");
  } else if (["text", "text_or_empty"].includes(outputResponse.mode)) {
    lines.push('  const text = await response.text();', '  console.log(text || "<empty response>");');
  } else {
    lines.push(
      "  const text = await response.text();",
      "  if (!text) console.log(\"<empty response>\");",
      "  else {",
      "    try { console.log(JSON.parse(text)); }",
      "    catch { console.log(text); }",
      "  }"
    );
  }
  lines.push("})().catch((error) => console.error(\"WQ API 请求失败：\", error));");
  return lines.join("\n");
}

function renderCode(operation) {
  const isJavascript = state.language === "javascript";
  const code = isJavascript ? buildJavascript(operation) : buildPython(operation);
  state.generatedCode = code;
  elements.pythonCode.textContent = code;
  elements.codeLines.textContent = `${code.split("\n").length} lines`;
  elements.languageTitle.textContent = isJavascript ? "JavaScript fetch" : "Python requests";
  elements.codeFilename.textContent = isJavascript ? "generated_request.js" : "generated_request.py";
  elements.downloadCode.title = isJavascript ? "下载 JavaScript 文件" : "下载 Python 文件";
  elements.downloadCode.setAttribute("aria-label", elements.downloadCode.title);
  const values = valuesFor(operation);
  const error = document.querySelector("#body-error");
  if (error) {
    error.hidden = !values.bodyError;
    error.textContent = values.bodyError;
  }
  const flow = isJavascript
    ? "WQ 已登录页面 → credentials: include → fetch 调用"
    : values.includeLogin ? "登录 → Cookie Session → 接口调用" : `${authModes(operation).join(" / ")} → 接口调用`;
  elements.codeIntro.textContent = `${flow}。参数、请求体、响应模式与轮询规则均来自当前目录。`;
  elements.securityNote.classList.remove("manual-mode");
  elements.securityTitle.textContent = isJavascript ? "仅在 WQ 官方页面运行" : "Python 不写入凭据";
  elements.securityCopy.innerHTML = isJavascript
    ? 'fetch 使用 <code>credentials: "include"</code> 复用当前登录 Cookie；请勿在其他网站控制台执行。'
    : '生成脚本从 <code>WQ_EMAIL</code>、<code>WQ_PASSWORD</code> 或 <code>WQ_TOKEN</code> 环境变量读取敏感信息。';
}

function renderGenerator(operation) {
  renderParameterForm(operation);
  renderCode(operation);
}

function selectOperation(operationId, updateHash = true) {
  const operation = visibleOperations().find((item) => item.operationId === operationId);
  if (!operation) return;
  state.selectedId = operationId;
  renderEndpointList();
  renderDoc(operation);
  renderGenerator(operation);
  if (updateHash) history.replaceState(null, "", `#${encodeURIComponent(operationId)}`);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 1700);
}

async function copyGeneratedCode() {
  if (!state.generatedCode) return;
  try {
    await navigator.clipboard.writeText(state.generatedCode);
    elements.copyCode.textContent = "已复制";
    elements.copyCode.classList.add("copied");
    showToast(`${state.language === "javascript" ? "JavaScript" : "Python"} 代码已复制`);
    window.setTimeout(() => {
      elements.copyCode.textContent = "复制代码";
      elements.copyCode.classList.remove("copied");
    }, 1500);
  } catch {
    showToast("无法访问剪贴板，请手动选择代码");
  }
}

function downloadGeneratedCode() {
  const operation = selectedOperation();
  if (!operation || !state.generatedCode) return;
  const isJavascript = state.language === "javascript";
  const blob = new Blob([`${state.generatedCode}\n`], { type: `${isJavascript ? "text/javascript" : "text/x-python"};charset=utf-8` });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${toSnakeCase(operation.operationId)}.${isJavascript ? "js" : "py"}`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(`${isJavascript ? "JavaScript" : "Python"} 文件已生成`);
}

function bindEvents() {
  elements.domainNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-domain]");
    if (!button) return;
    state.domain = button.dataset.domain;
    renderDomains();
    renderEndpointList();
  });

  elements.endpointList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-operation-id]");
    if (button) selectOperation(button.dataset.operationId);
  });

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    renderEndpointList();
  });

  elements.clearSearch.addEventListener("click", () => {
    state.query = "";
    elements.search.value = "";
    renderEndpointList();
    elements.search.focus();
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
      event.preventDefault();
      elements.search.focus();
    }
    if (event.key === "Escape" && document.activeElement === elements.search) {
      elements.search.value = "";
      state.query = "";
      renderEndpointList();
      elements.search.blur();
    }
  });

  elements.parameterForm.addEventListener("input", (event) => {
    const operation = selectedOperation();
    if (!operation) return;
    const values = valuesFor(operation);
    if (event.target.matches("[data-parameter]")) values.params[event.target.dataset.parameter] = event.target.value;
    if (event.target.matches("[data-body]")) values.bodies[values.contentType] = event.target.value;
    if (event.target.matches('[data-setting="includeLogin"]')) values.includeLogin = event.target.checked;
    if (event.target.matches('[data-setting="includePolling"]')) values.includePolling = event.target.checked;
    renderCode(operation);
  });

  elements.parameterForm.addEventListener("change", (event) => {
    const operation = selectedOperation();
    if (!operation) return;
    const values = valuesFor(operation);
    if (event.target.matches('[data-setting="contentType"]')) {
      values.contentType = event.target.value;
      values.bodies[values.contentType] ??= JSON.stringify(bodySample(operation, values.contentType), null, 2);
      renderGenerator(operation);
    }
  });

  elements.copyCode.addEventListener("click", copyGeneratedCode);
  elements.downloadCode.addEventListener("click", downloadGeneratedCode);
  elements.languageSelect.addEventListener("change", () => {
    state.language = elements.languageSelect.value === "javascript" ? "javascript" : "python";
    const operation = selectedOperation();
    if (operation) renderGenerator(operation);
  });
}

async function initialize() {
  bindEvents();
  try {
    const response = await fetch("./data/api-catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.catalog = await response.json();
    const operations = visibleOperations();
    elements.operationCount.textContent = operations.length;
    elements.catalogVersion.textContent = `catalog ${state.catalog.catalogVersion}`;
    elements.catalogStatus.textContent = `${operations.length} operations`;
    elements.statusDot.classList.add("ready");
    elements.workspace.setAttribute("aria-busy", "false");
    renderDomains();
    const hashId = decodeURIComponent(location.hash.replace(/^#/, ""));
    const initial = operations.some((operation) => operation.operationId === hashId)
      ? hashId
      : operations.some((operation) => operation.operationId === "createSimulation")
        ? "createSimulation"
        : operations[0].operationId;
    selectOperation(initial, false);
  } catch (error) {
    elements.catalogStatus.textContent = "载入失败";
    elements.docPane.innerHTML = `<div class="empty-section"><strong>无法读取接口目录。</strong><br><br>${escapeHtml(error.message)}<br><br>请先运行 <code>node tools/build-site.mjs</code>，并通过 HTTP 服务打开 site 目录。</div>`;
    elements.pythonCode.textContent = "# API catalog failed to load";
  }
}

if (typeof document !== "undefined") initialize();

export { buildJavascript, buildPython, confidenceLabel, defaultOperationValues, evidenceLabel, expandSchemaRefs, helpTooltip, operationConfidenceLabel, responseExampleBlock, responseExampleForOperation, sampleFromSchema, schemaBlock, schemaExampleBlock, sensitivityLabel, state, stripSchemaMetadata, visibleOperations };
