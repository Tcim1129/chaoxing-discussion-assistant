const DEFAULTS = {
  apiKey: '',
  model: 'qwen3.6-plus',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  anonymous: true,
  onlyUncertain: false,
  maxTopics: 0,
  requestTimeoutSeconds: 500,
};

const URL_PRESETS = [
  { name: '阿里百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: 'OpenAI 官方', url: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com' },
  { name: 'Kimi', url: 'https://api.moonshot.cn/v1' },
  { name: '智谱清言', url: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: '硅基流动', url: 'https://api.siliconflow.cn/v1' },
  { name: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3' },
  { name: '自定义', url: '' },
];

const STORAGE_KEYS = {
  apiKey: 'cx_discussion_api_key',
  model: 'cx_discussion_model',
  baseUrl: 'cx_discussion_base_url',
  anonymous: 'cx_discussion_anonymous',
  onlyUncertain: 'cx_discussion_only_uncertain',
  maxTopics: 'cx_discussion_max_topics',
  keyMap: 'cx_discussion_api_key_map',
  recent: 'cx_discussion_recent_presets',
  requestTimeoutSeconds: 'cx_discussion_request_timeout_seconds',
};
const MIN_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 600;

// 统一清理输入，避免空格和多余斜杠影响匹配。
function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function normalizeUrl(value) { return cleanText(value).replace(/\/+$/, ''); }
function normalizeTimeoutSeconds(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULTS.requestTimeoutSeconds;
  return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, parsed));
}
function normalizeMaxTopics(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(2000, parsed);
}

function shareableConfig(data={}) {
  const address=new URL(normalizeUrl(data[STORAGE_KEYS.baseUrl]||DEFAULTS.baseUrl));
  if(!['http:','https:'].includes(address.protocol))throw Error('请填写有效的 HTTP 或 HTTPS 接口地址');
  address.username='';address.password='';address.search='';address.hash='';
  return {
    [STORAGE_KEYS.model]:cleanText(data[STORAGE_KEYS.model]||DEFAULTS.model),
    [STORAGE_KEYS.baseUrl]:normalizeUrl(address.href),
    [STORAGE_KEYS.anonymous]:data[STORAGE_KEYS.anonymous]!==undefined?!!data[STORAGE_KEYS.anonymous]:DEFAULTS.anonymous,
    [STORAGE_KEYS.onlyUncertain]:false,
    [STORAGE_KEYS.maxTopics]:normalizeMaxTopics(data[STORAGE_KEYS.maxTopics]),
    [STORAGE_KEYS.requestTimeoutSeconds]:normalizeTimeoutSeconds(data[STORAGE_KEYS.requestTimeoutSeconds]),
  };
}

function importedConfig(data,current={}) {
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('请选择有效的 JSON 配置文件');
  const previousBase=normalizeUrl(current[STORAGE_KEYS.baseUrl]||DEFAULTS.baseUrl);
  const nextBase=normalizeUrl(data[STORAGE_KEYS.baseUrl]||DEFAULTS.baseUrl);
  const existingMap={...(current[STORAGE_KEYS.keyMap]||{})};
  if(current[STORAGE_KEYS.apiKey])existingMap[previousBase]=current[STORAGE_KEYS.apiKey];
  return {
    [STORAGE_KEYS.apiKey]:Object.hasOwn(data,STORAGE_KEYS.apiKey)?cleanText(data[STORAGE_KEYS.apiKey]):cleanText(existingMap[nextBase]||''),
    [STORAGE_KEYS.model]:cleanText(data[STORAGE_KEYS.model]||DEFAULTS.model),
    [STORAGE_KEYS.baseUrl]:nextBase,
    [STORAGE_KEYS.anonymous]:data[STORAGE_KEYS.anonymous]!==undefined?!!data[STORAGE_KEYS.anonymous]:DEFAULTS.anonymous,
    [STORAGE_KEYS.onlyUncertain]:false,
    [STORAGE_KEYS.maxTopics]:normalizeMaxTopics(data[STORAGE_KEYS.maxTopics]),
    [STORAGE_KEYS.requestTimeoutSeconds]:normalizeTimeoutSeconds(data[STORAGE_KEYS.requestTimeoutSeconds]),
    [STORAGE_KEYS.keyMap]:data[STORAGE_KEYS.keyMap]&&typeof data[STORAGE_KEYS.keyMap]==='object'&&!Array.isArray(data[STORAGE_KEYS.keyMap])?data[STORAGE_KEYS.keyMap]:existingMap,
  };
}

// 根据手动输入的地址自动识别最接近的厂家预设。
function matchPreset(url) {
  const value = normalizeUrl(url).toLowerCase();
  if (!value) return null;
  const exact = URL_PRESETS.find((item) => item.url && normalizeUrl(item.url).toLowerCase() === value);
  if (exact) return exact;
  if (value.includes('dashscope.aliyuncs.com')) return URL_PRESETS[0];
  if (value.includes('api.openai.com')) return URL_PRESETS[1];
  if (value.includes('deepseek.com')) return URL_PRESETS[2];
  if (value.includes('moonshot.cn')) return URL_PRESETS[3];
  if (value.includes('bigmodel.cn')) return URL_PRESETS[4];
  if (value.includes('siliconflow.cn')) return URL_PRESETS[5];
  if (value.includes('volces.com')) return URL_PRESETS[6];
  return null;
}

function storageGet(keys) { return new Promise((resolve) => chrome.storage.local.get(keys, resolve)); }
function storageSet(values) { return new Promise((resolve) => chrome.storage.local.set(values, resolve)); }
function storageRemove(keys) { return new Promise((resolve) => chrome.storage.local.remove(keys, resolve)); }
function setStatus(text, kind) {
  const node = document.getElementById('status');
  if (!node) return;
  node.textContent = text;
  node.classList.remove('error', 'ok');
  if (kind) node.classList.add(kind);
}

function buildChatUrl(baseUrl) {
  return `${normalizeUrl(baseUrl)}/chat/completions`;
}

async function testConnection(data) {
  const baseUrl = normalizeUrl(data[STORAGE_KEYS.baseUrl] || DEFAULTS.baseUrl);
  const apiKey = cleanText(data[STORAGE_KEYS.apiKey] || '');
  const model = cleanText(data[STORAGE_KEYS.model] || DEFAULTS.model);
  const requestTimeoutSeconds = normalizeTimeoutSeconds(data[STORAGE_KEYS.requestTimeoutSeconds]);
  if (!apiKey) throw new Error('请先填写 API Key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutSeconds * 1000);
  // 直接打一次兼容接口，确认 URL、Key、模型都可用。
  try {
    const response = await fetch(buildChatUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你只需要回复“OK”。' },
          { role: 'user', content: '测试连接' },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    return response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`测试连接超时（${requestTimeoutSeconds} 秒）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function load() {
  const data = await storageGet(Object.values(STORAGE_KEYS));
  const apiKey = document.getElementById('apiKey');
  const model = document.getElementById('model');
  const requestTimeoutSeconds = document.getElementById('requestTimeoutSeconds');
  const preset = document.getElementById('preset');
  const baseUrl = document.getElementById('baseUrl');
  const anonymous = document.getElementById('anonymous');
  const onlyUncertain = document.getElementById('onlyUncertain');
  const maxTopics = document.getElementById('maxTopics');
  const recentList = document.getElementById('recentList');

  function renderRecent() {
    if (!recentList) return;
    const recent = Array.isArray(data[STORAGE_KEYS.recent]) ? data[STORAGE_KEYS.recent] : [];
    const items = [normalizeUrl(baseUrl.value), ...recent].filter(Boolean);
    const seen = new Set();
    recentList.innerHTML = '';
    items.forEach((url) => {
      const normalized = normalizeUrl(url);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      const preset = matchPreset(normalized);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = preset ? preset.name : normalized;
      button.title = normalized;
      button.addEventListener('click', () => {
        // 快捷切换后，保留当前输入里的 Key 和模型，只更新 URL 相关字段。
        baseUrl.value = normalized;
        document.getElementById('preset').value = preset ? preset.url : '';
        apiKey.value = cleanText(data[STORAGE_KEYS.keyMap]?.[normalized] || data[STORAGE_KEYS.apiKey] || '');
        setStatus(preset ? `已选择：${preset.name}` : '已切换到自定义地址');
      });
      recentList.appendChild(button);
    });
  }

  preset.innerHTML = URL_PRESETS.map((item) => `<option value="${item.url}">${item.name}</option>`).join('');
  apiKey.value = cleanText(data[STORAGE_KEYS.apiKey] || '');
  model.value = cleanText(data[STORAGE_KEYS.model] || DEFAULTS.model);
  requestTimeoutSeconds.value = String(normalizeTimeoutSeconds(data[STORAGE_KEYS.requestTimeoutSeconds]));
  baseUrl.value = normalizeUrl(data[STORAGE_KEYS.baseUrl] || DEFAULTS.baseUrl);
  anonymous.checked = data[STORAGE_KEYS.anonymous] !== undefined ? !!data[STORAGE_KEYS.anonymous] : DEFAULTS.anonymous;
  if (onlyUncertain) onlyUncertain.checked = data[STORAGE_KEYS.onlyUncertain] !== undefined ? !!data[STORAGE_KEYS.onlyUncertain] : DEFAULTS.onlyUncertain;
  if (maxTopics) maxTopics.value = String(data[STORAGE_KEYS.maxTopics] !== undefined ? normalizeMaxTopics(data[STORAGE_KEYS.maxTopics]) : DEFAULTS.maxTopics);
  preset.value = matchPreset(baseUrl.value)?.url || '';

  preset.addEventListener('change', () => {
    if (!preset.value) return;
    baseUrl.value = preset.value;
    renderRecent();
    setStatus(`已选择：${preset.options[preset.selectedIndex].text}`);
  });
  baseUrl.addEventListener('input', () => {
    const matched = matchPreset(baseUrl.value);
    preset.value = matched?.url || '';
    renderRecent();
    setStatus(matched ? `已识别：${matched.name}` : '自定义地址');
  });

  document.getElementById('save').addEventListener('click', async () => {
    const next = {
      [STORAGE_KEYS.apiKey]: cleanText(apiKey.value),
      [STORAGE_KEYS.model]: cleanText(model.value) || DEFAULTS.model,
      [STORAGE_KEYS.baseUrl]: normalizeUrl(baseUrl.value) || DEFAULTS.baseUrl,
      [STORAGE_KEYS.anonymous]: !!anonymous.checked,
      [STORAGE_KEYS.onlyUncertain]: !!(onlyUncertain && onlyUncertain.checked),
      [STORAGE_KEYS.maxTopics]: normalizeMaxTopics(maxTopics && maxTopics.value),
      [STORAGE_KEYS.requestTimeoutSeconds]: normalizeTimeoutSeconds(requestTimeoutSeconds.value),
    };
    await storageSet(next);
    await storageSet({[STORAGE_KEYS.keyMap]:{...(data[STORAGE_KEYS.keyMap]||{}),[next[STORAGE_KEYS.baseUrl]]:next[STORAGE_KEYS.apiKey]}});
    const recent = Array.isArray(data[STORAGE_KEYS.recent]) ? data[STORAGE_KEYS.recent] : [];
    const merged = [next[STORAGE_KEYS.baseUrl], ...recent].map(normalizeUrl).filter(Boolean);
    const uniq = Array.from(new Set(merged)).slice(0, 6);
    await storageSet({ [STORAGE_KEYS.recent]: uniq });
    setStatus('配置已保存');
    await load();
  });

  document.getElementById('test').addEventListener('click', async () => {
    try {
      setStatus('正在测试连接...');
      await testConnection({
        [STORAGE_KEYS.apiKey]: apiKey.value,
        [STORAGE_KEYS.model]: model.value,
        [STORAGE_KEYS.baseUrl]: baseUrl.value,
        [STORAGE_KEYS.requestTimeoutSeconds]: requestTimeoutSeconds.value,
      });
      setStatus('连接成功', 'ok');
    } catch (error) {
      setStatus(`连接失败：${error.message}`, 'error');
    }
  });

  document.getElementById('reset').addEventListener('click', async () => {
    // 清空全部配置和最近使用记录，回到初始状态。
    await storageSet({
      [STORAGE_KEYS.apiKey]: '',
      [STORAGE_KEYS.model]: DEFAULTS.model,
      [STORAGE_KEYS.baseUrl]: DEFAULTS.baseUrl,
      [STORAGE_KEYS.anonymous]: DEFAULTS.anonymous,
      [STORAGE_KEYS.onlyUncertain]: DEFAULTS.onlyUncertain,
      [STORAGE_KEYS.maxTopics]: DEFAULTS.maxTopics,
      [STORAGE_KEYS.requestTimeoutSeconds]: DEFAULTS.requestTimeoutSeconds,
      [STORAGE_KEYS.keyMap]: {},
      [STORAGE_KEYS.recent]: [],
    });
    await storageRemove([STORAGE_KEYS.recent]);
    load();
    setStatus('已恢复默认配置');
  });

  document.getElementById('export').addEventListener('click', async () => {
    try {
    const data = shareableConfig(await storageGet(Object.values(STORAGE_KEYS)));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cx-discussion-summary-config.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('配置已导出，不含 API Key 和最近使用记录。');
    } catch(error) {
      setStatus('导出失败，请检查已保存的接口地址。','error');
    }
  });

  document.getElementById('import').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const next=importedConfig(JSON.parse(text),await storageGet(Object.values(STORAGE_KEYS)));
      await storageSet(next);
      await load();
      setStatus('配置已导入，请检查接口地址和模型名称。');
    } catch(error) {
      setStatus('导入失败，请选择有效的 JSON 配置文件。','error');
    }
    event.target.value='';
  });
}

if(typeof module==='object'&&module.exports)module.exports={shareableConfig,importedConfig};
else load();
