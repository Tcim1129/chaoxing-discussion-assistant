(function () {
  'use strict';

  const rootWindow = window;
  const TEST_MODE = !!rootWindow.__CX_DISCUSSION_SUMMARY_TEST_MODE__;
  const CaptureScope=typeof DiscussionCollectionScope!=='undefined'?DiscussionCollectionScope:null;
  const scopedCapture=options=>CaptureScope&&CaptureScope.bounded(options?.captureScope);
  let collectionControl=CaptureScope?.createControl?.(),collectionRestarting=false,collectionPauseChanging=false,captureControlsAtStart='';
  const collectionJobs=new Set();
  function trackCollection(work){const job=Promise.resolve().then(work);collectionJobs.add(job);job.then(()=>collectionJobs.delete(job),()=>collectionJobs.delete(job));return job;}
  function beginCollection(resume=true){if(collectionControl?.cancelled)collectionControl=CaptureScope?.createControl?.();if(resume)collectionControl?.resume();}
  async function stopLocalCollection(){
    collectionControl?.cancel();rejectRuntimePending('已停止旧范围采集');
    for(const [id,pending] of bridgePending){rootWindow.clearTimeout(pending.timeout);pending.reject(new Error('已停止旧范围采集'));bridgePending.delete(id);}
    await Promise.allSettled([...collectionJobs]);state.collecting=false;setBusy(false);
  }
  function captureControlsStamp(){return JSON.stringify([getSelectedCourseClassIds().slice().sort(),...['cxda-capture-window','cxda-capture-from','cxda-capture-to','cxda-capture-topic','cxda-capture-topic-link'].map(id=>document.getElementById(id)?.value||''),captureSessionStartedAt]);}
  const collectionGate=async()=>{if(extensionContextInvalidated)throw Error('扩展已更新，请刷新当前课程页后重试');await collectionControl?.wait();if(extensionContextInvalidated)throw Error('扩展已更新，请刷新当前课程页后重试');};
  function setCollectionPaused(paused){
    if(paused)collectionControl?.pause();else collectionControl?.resume();
    for(const map of [runtimePending,bridgePending])for(const pending of map.values()){
      if(paused){if(!pending.pausedAt)pending.pausedAt=Date.now();rootWindow.clearTimeout(pending.timeout);}
      else if(pending.pausedAt){pending.pausedMs=(pending.pausedMs||0)+Date.now()-pending.pausedAt;pending.pausedAt=0;pending.refreshTimeout?.();}
    }
    setBusy(state.loading);updateCollectionButtons();
    if(state.collecting||state.bridgeProgress)setStatus(state.lastCollectionStatus||'正在采集…','info');
  }
  function updateCollectionButtons(){const paused=collectionControl?.paused,button=document.getElementById('cxda-pause-collect'),collect=document.getElementById('cx-discussion-summary-collect');if(button){button.hidden=extensionContextInvalidated||!state.collecting;button.disabled=extensionContextInvalidated||collectionRestarting||collectionPauseChanging;button.textContent=paused?(captureControlsAtStart!==captureControlsStamp()?'按新范围重新采集':'继续收集'):'暂停收集';}if(collect){collect.disabled=extensionContextInvalidated||collectionRestarting||collectionPauseChanging||state.loading&&!paused;collect.textContent=collectionRestarting?'正在停止旧采集…':paused?'按新范围重新采集':document.getElementById('cxda-capture-window')?.value==='all'?'收集全部发言':'收集本时段发言';}}
  async function toggleCollectionPause(){if(collectionPauseChanging||collectionRestarting)return;if(collectionControl?.paused&&captureControlsAtStart!==captureControlsStamp())return collectFromPanel();const paused=!collectionControl?.paused;collectionPauseChanging=true;setCollectionPaused(paused);try{await runtimeMessage({type:'discussion-analysis',action:'collection-control',paused});}catch(error){setCollectionPaused(!paused);setStatus(error.message,'danger');}finally{collectionPauseChanging=false;setBusy(state.loading);}}
  async function collectFromPanel(){
    if(collectionRestarting||collectionPauseChanging||state.loading&&!collectionControl?.paused)return;
    if(collectionControl?.paused){try{readCaptureOptions(shouldUseCourseTopicMode(document));collectionRestarting=true;setBusy(true);await runtimeMessage({type:'discussion-analysis',action:'collection-reset'});}catch(error){setStatus(error.message,'danger');return;}finally{collectionRestarting=false;setBusy(state.loading);}}
    const payload=await handleCollect();if(payload&&(!payload.captureScope||payload.captureSelectedCount>0||payload.complete===true))await publishAnalysisDataset(true,true).catch(e=>setStatus(e.message,'danger'));const title=document.getElementById('cxda-title');if(title)title.textContent=state.topicContext.title||'课堂讨论';
  }
  const currentLocation = rootWindow.location || document.location || { href: '', pathname: '' };
  const IS_TOP_FRAME = rootWindow.top === rootWindow.self;

  function isChaoxingTopicPageUrl(url) {
    const value = String(url || '');
    try {
      const parsed = new URL(value);
      return /^https?:$/i.test(parsed.protocol)
        && parsed.hostname.toLowerCase() === 'groupweb.chaoxing.com'
        && /^\/course\/topic(?:\/|$)/i.test(parsed.pathname);
    } catch (error) {
      return /^https?:\/\/groupweb\.chaoxing\.com\/course\/topic(?:\/|$)/i.test(value);
    }
  }

  function isDiscussionReplyPageUrl(url) {
    return isChaoxingTopicPageUrl(url) && /(?:topicDiscuss\/)?replysList/i.test(String(url || ''));
  }

  function isChaoxingCourseTopicListPageUrl(url) {
    const value = String(url || '');
    try {
      const parsed = new URL(value);
      return /^https?:$/i.test(parsed.protocol)
        && parsed.hostname.toLowerCase() === 'groupweb.chaoxing.com'
        && /^\/course\/topic\/topicList(?:\/|$)/i.test(parsed.pathname);
    } catch (error) {
      return /^https?:\/\/groupweb\.chaoxing\.com\/course\/topic\/topicList(?:[/?#]|$)/i.test(value);
    }
  }

  function isChaoxingCoursePageUrl(url) {
    const value = String(url || '');
    try {
      const parsed = new URL(value);
      return /^https?:$/i.test(parsed.protocol)
        && parsed.hostname.toLowerCase() === 'mooc2-ans.chaoxing.com'
        && /^\/mooc2-ans\/mycourse\/(?:stu|tch)(?:\/|$)/i.test(parsed.pathname);
    } catch (error) {
      return /^https?:\/\/mooc2-ans\.chaoxing\.com\/mooc2-ans\/mycourse\/(?:stu|tch)(?:[/?#]|$)/i.test(value);
    }
  }

  function getFrameSrc(frame) {
    if (!frame) return '';
    return String(frame.src || (typeof frame.getAttribute === 'function' ? frame.getAttribute('src') : '') || '');
  }

  function hasCourseTopicListFrame(doc) {
    const targetDoc = doc || document;
    if (!targetDoc || typeof targetDoc.querySelectorAll !== 'function') return false;
    return Array.from(targetDoc.querySelectorAll('iframe') || [])
      .some((frame) => isChaoxingCourseTopicListPageUrl(getFrameSrc(frame)));
  }

  function shouldUseCourseTopicMode(doc) {
    return IS_COURSE_TOPIC_MODE || hasCourseTopicListFrame(doc || document);
  }

  function shouldInstallPanelOnCurrentPage() {
    return IS_TOP_FRAME
      && (IS_CHAOXING_TOPIC_PAGE || IS_CHAOXING_COURSE_PAGE || hasCourseTopicListFrame(document));
  }

  const IS_CHAOXING_TOPIC_PAGE = isChaoxingTopicPageUrl(currentLocation.href || '');
  const IS_DISCUSSION_PAGE = isDiscussionReplyPageUrl(currentLocation.href || '');
  const IS_CHAOXING_COURSE_TOPIC_LIST_PAGE = isChaoxingCourseTopicListPageUrl(currentLocation.href || '');
  const IS_CHAOXING_COURSE_PAGE = isChaoxingCoursePageUrl(currentLocation.href || '');
  const IS_COURSE_TOPIC_MODE = IS_CHAOXING_COURSE_PAGE || IS_CHAOXING_COURSE_TOPIC_LIST_PAGE;

  const DEFAULTS = {
    model: 'qwen3.6-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    anonymous: true,
    requestTimeoutSeconds: 500,
    maxTopics: 0,
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

  const CANDIDATE_SELECTORS = [
    '.comment-item', '.commentItem', '.reply-item', '.replyItem', '.discuss-item', '.discussion-item',
    '.topic-reply', '.bbs-reply', '.message-item', '.msg-item', '[class*="comment"]', '[class*="Comment"]',
    '[class*="reply"]', '[class*="Reply"]', '[class*="discuss"]', '[class*="Discuss"]',
    '[class*="topic"]', '[class*="Topic"]', '[class*="bbs"]', '[class*="message"]', '[class*="Message"]',
  ];

  const CONTENT_SELECTORS = [
    '.comment-content', '.reply-content', '.discuss-content', '.topic-content', '.message-content',
    '.content', '.text', '.detail', '.replyCon', '.replyText', '.replyContent', '.replyReplyContent', '.plnr',
    '[class*="content"]', '[class*="Content"]', '[class*="text"]', '[class*="Text"]',
    '[class*="detail"]', '[class*="Detail"]',
  ];

  const AUTHOR_SELECTORS = [
    '.author', '.name', '.username', '.userName', '.user-name', '.reply-name', '.comment-name',
    '.replyReplyer', '.nick', '.nickname', '.uname', '[class*="author"]', '[class*="Author"]',
    '[class*="name"]', '[class*="Name"]', '[class*="user"]', '[class*="User"]', '[class*="nick"]', '[class*="Nick"]',
  ];
  const COURSE_TOPIC_SELECTORS = [
    '.dataBody_topic',
    '.dataBody_td',
    '.dataBody > li',
    'ul.topicList > li', '.topicList li', 'ul.topic-list > li',
    '.topicList .topicItem', '.topic-list .topic-item', '.topicItem', '.topic-item',
    '.discussList .discussItem', '.discuss-list .discuss-item', '.discussItem', '.discuss-item',
    '.bbsList .bbsItem', '.bbs-list .bbs-item',
    'li[id*="topicId_"]', 'li[id*="topic"]', 'li[data-topicid]', '[data-topicid]', 'tr[data-topicid]',
    '.topicli', '[data-uuid]',
    '[class*="topicItem"]', '[class*="TopicItem"]',
    '[class*="discussItem"]', '[class*="DiscussItem"]',
  ];
  const COURSE_TOPIC_TITLE_SELECTORS = [
    '.topicli_title_text', '.topicli_title',
    '.topicTitle', '.topic-title', '.title', '.name', '.bt', '.subject',
    '[class*="topicTitle"]', '[class*="TopicTitle"]', '[class*="title"]', '[class*="Title"]',
  ];
  const COURSE_TOPIC_CONTENT_SELECTORS = [
    '.topicli_content',
    '.topicContent', '.topic-content', '.content', '.summary', '.intro', '.detail', '.desc',
    '[class*="topicContent"]', '[class*="TopicContent"]', '[class*="content"]', '[class*="Content"]',
    '[class*="summary"]', '[class*="Summary"]', '[class*="intro"]', '[class*="Intro"]',
  ];
  const COURSE_TOPIC_META_SELECTORS = [
    '.topicli_head_left', '.topicli_head', '.classNameInfo', '.topicli_from',
    '.topicInfo', '.topic-info', '.info', '.meta', '.author', '.creator', '.userName', '.name',
    '[class*="topicInfo"]', '[class*="TopicInfo"]', '[class*="author"]', '[class*="Author"]',
    '[class*="creator"]', '[class*="Creator"]', '[class*="teacher"]', '[class*="Teacher"]',
  ];

  const BRIDGE_SOURCE = 'cx-discussion-summary';
  const BRIDGE_PORT_NAME = 'cx-discussion-summary';
  const LOAD_MORE_TEXTS = ['点击加载更多', '加载更多', '更多回复', '查看更多', '展开更多', '之前的评论', '下一页', '下页', '更多', 'more', 'next'];
  const IDEOLOGY_KEYWORDS = [
    { term: '制度自信', aliases: ['制度自信', '制度优势', '治理体系', '治理能力', '国家治理', '中国制度'] },
    { term: '人民性', aliases: ['人民性', '以人民为中心', '人民', '群众', '为民', '惠民', '利民', '人民至上'] },
    { term: '民生', aliases: ['民生', '公共服务', '教育', '医疗', '就业', '养老', '社会保障', '住房', '基层服务'] },
    { term: '国家战略', aliases: ['国家战略', '科技强国', '高质量发展', '乡村振兴', '中国式现代化', '城市更新', '人才强国', '创新驱动'] },
    { term: '公平性', aliases: ['公平性', '公平', '公正', '公平正义', '机会公平', '权益保障', '均衡发展', '共同富裕'] },
    { term: '国家安全', aliases: ['国家安全', '安全感', '粮食安全', '能源安全', '文化安全', '总体国家安全观'] },
    { term: '责任担当', aliases: ['责任', '担当', '青年责任', '使命', '奉献', '奋斗', '家国情怀'] },
    { term: '基层治理', aliases: ['基层治理', '社区治理', '基层', '治理', '协同治理', '社会治理'] },
    { term: '财政保障', aliases: ['财政', '财政资金', '专项补助', '预算', '转移支付', '公共财政'] },
    { term: '文化自信', aliases: ['文化自信', '中华优秀传统文化', '主旋律', '爱国主义', '民族精神'] },
  ];
  const DEFAULT_ANALYSIS_PROFILE = {
    dimensions: IDEOLOGY_KEYWORDS.map((item) => ({
      name: item.term,
      aliases: item.aliases.slice(),
    })),
  };

  const STORAGE_KEYS = {
    apiKey: 'cx_discussion_api_key',
    model: 'cx_discussion_model',
    baseUrl: 'cx_discussion_base_url',
    anonymous: 'cx_discussion_anonymous',
    keyMap: 'cx_discussion_api_key_map',
    recent: 'cx_discussion_recent_presets',
    requestTimeoutSeconds: 'cx_discussion_request_timeout_seconds',
    maxTopics: 'cx_discussion_max_topics',
    analysisProfile: 'cx_discussion_analysis_profile',
  };

  const PANEL_ID = 'cx-discussion-summary-panel';
  const TOGGLE_ID = 'cx-discussion-summary-toggle';
  const MIN_TIMEOUT_SECONDS = 30;
  const MAX_TIMEOUT_SECONDS = 600;
  const DEFAULT_BRIDGE_TIMEOUT_MS = 30000;
  const COURSE_TOPIC_BRIDGE_TIMEOUT_MS = 240000;
  const MIN_COLLECTION_ROUNDS = 12;
  const COLLECTION_STABLE_ROUNDS_TO_STOP = 8;
  const MODEL_INPUT_SAFE_CHARS = 200000;
  const DEFAULT_PROMPT_COMMENT_CHARS = 800;
  const MIN_PROMPT_COMMENT_CHARS = 1;
  const MAX_PREVIEW_CHARS = 60000;
  const MAX_COURSE_TOPIC_CONTENT_CHARS = 20000;
  const MAX_COURSE_TOPIC_REPLY_PAGES = 500;

  const state = {
    comments: [],
    rawComments: [],
    capturePayload: null,
    datasetId: null,
    networkComments: [],
    topicContext: { title: '', question: '' },
    analysisMode: 'discussionReplies',
    rawLoadedCount: 0,
    collectionWarning: '',
    summary: '',
    analysisError: '',
    localAnalysis: null,
    classOptions: [],
    selectedClassIds: [],
    loading: false,
  };
  const bridgePending = new Map();
  const runtimePending = new Map();
  let runtimePort = null;
  let runtimeBridgeSuspended = false;
  let extensionContextInvalidated = false;
  let runtimeRegistrationTimer = null;
  // 运行期缓存，尽量避免在总结请求时反复访问 storage。
  let settingsCache = null;

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function countTextOccurrences(text, needle) {
    const source = String(text || '');
    const target = String(needle || '');
    if (!source || !target) return 0;
    let count = 0;
    let index = 0;
    while (index < source.length) {
      const found = source.indexOf(target, index);
      if (found === -1) break;
      count += 1;
      index = found + target.length;
    }
    return count;
  }

  function normalizeMaxTopics(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0; // 0 表示不限制
    return Math.min(2000, parsed);
  }

  function normalizeAnalysisProfile(profile) {
    const source = profile && Array.isArray(profile.dimensions) ? profile.dimensions : DEFAULT_ANALYSIS_PROFILE.dimensions;
    const dimensions = [];
    source.forEach((item) => {
      const name = cleanText(item && (item.name || item.term));
      const aliases = Array.isArray(item && item.aliases) ? item.aliases : [];
      const cleanedAliases = Array.from(new Set(aliases.map(cleanText).filter(Boolean)));
      if (!name && !cleanedAliases.length) return;
      dimensions.push({
        name: name || cleanedAliases[0],
        aliases: cleanedAliases.length ? cleanedAliases : [name],
      });
    });
    return { dimensions: dimensions.length ? dimensions : DEFAULT_ANALYSIS_PROFILE.dimensions.map((item) => ({ name: item.name, aliases: item.aliases.slice() })) };
  }

  function formatAnalysisProfileForDisplay(profile) {
    return normalizeAnalysisProfile(profile).dimensions
      .map((item) => `${item.name}：${item.aliases.join('、')}`)
      .join('\n');
  }

  function parseAnalysisProfileText(text) {
    const dimensions = cleanText(text)
      .split('\n')
      .map((line) => cleanText(line))
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[：:]/);
        const name = cleanText(parts.shift());
        const aliases = parts.join('：').split(/[、,，;；\s]+/).map(cleanText).filter(Boolean);
        return { name, aliases };
      });
    return normalizeAnalysisProfile({ dimensions });
  }

  function getProfileKeywordDefinitions(profile) {
    return normalizeAnalysisProfile(profile).dimensions.map((item) => ({
      term: item.name,
      aliases: item.aliases,
    }));
  }

  function extractIdeologyKeywords(items, limit = 20, profile) {
    const text = (Array.isArray(items) ? items : [])
      .map((item) => `${cleanText(item && item.title)}\n${cleanText(item && item.content)}`)
      .join('\n');
    const max = Math.max(1, Number.parseInt(String(limit || 20), 10) || 20);
    return getProfileKeywordDefinitions(profile)
      .map((definition) => ({
        term: definition.term,
        count: definition.aliases.reduce((total, alias) => total + countTextOccurrences(text, alias), 0),
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'zh-Hans-CN'))
      .slice(0, max);
  }

  const AUTO_KEYWORD_STOPWORDS = new Set([
    '标题', '问题', '回答', '答案', '内容', '学生', '话题', '讨论', '分析', '说明', '结合',
    '如何', '什么', '哪些', '为什么', '是否', '能否', '请问', '请', '从', '在', '中',
    '能够', '可以', '需要', '通过', '进行', '体现', '影响', '作用', '意义', '关系',
    '主要', '核心', '方面', '一种', '一个', '这个', '这些', '其中', '中的', '以及',
  ]);

  function escapeRegExpLiteral(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const AUTO_KEYWORD_PROFESSIONAL_TERMS = [
    '竞争性专项转移支付', '专项转移支付', '一般性转移支付', '转移支付结构', '分档定额补助',
    '定额补助', '以奖代补', '全过程绩效管理', '预算绩效管理', '绩效评价', '绩效约束',
    '财政资源配置效率', '财政资源配置', '资源配置效率', '财政资金效率', '资金效率',
    '财政支出结构', '财政可持续性', '财政风险防控', '财政风险', '地方债务风险',
    '预算约束', '财政分权', '地方财政自主性', '中央财政', '地方财政', '公共财政',
    '公共财政职能', '收入分配职能', '经济稳定职能', '资源配置职能', '财政公平原则',
    '纵向财政公平', '区域公平', '公共服务均等化', '公共服务供给', '公共服务', '民生保障',
    '社会保障', '养老保障', '中央财政兜底', '养老金', '养老保险', '共同富裕',
    '激励相容机制', '激励相容', '道德风险', '逆向选择', '策略性申报', '数据操纵',
    '治理创新', '基层治理', '协同治理', '国家治理', '制度优势', '制度自信',
    '高质量发展', '新质生产力', '扩大内需', '超长期特别国债', '特别国债',
    '消费补贴', '财政补贴', '以旧换新', '消费需求', '产业升级', '城市更新',
    '公共产品', '准公共产品', '外部性', '市场失灵', '乘数效应', '替代效应', '收入效应',
    '财政撬动', '财政金融协同', '绿色发展', '代际公平', '预算公开',
  ];
  const AUTO_KEYWORD_PROFESSIONAL_SET = new Set(AUTO_KEYWORD_PROFESSIONAL_TERMS);
  const AUTO_KEYWORD_TERM_PATTERN_SOURCE = AUTO_KEYWORD_PROFESSIONAL_TERMS
    .map(escapeRegExpLiteral)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const AUTO_KEYWORD_CORE_PATTERN = new RegExp(AUTO_KEYWORD_TERM_PATTERN_SOURCE, 'g');
  const AUTO_KEYWORD_DOMAIN_PATTERN = new RegExp(`[\\u4e00-\\u9fa5]{0,8}(?:${AUTO_KEYWORD_TERM_PATTERN_SOURCE})[\\u4e00-\\u9fa5]{0,4}`, 'g');

  function normalizeAutoKeywordTerm(value) {
    const raw = cleanText(value);
    if (AUTO_KEYWORD_PROFESSIONAL_SET.has(raw)) return raw;
    return raw
      .replace(/^[请就从在对把将以和与及、，。；;：:\s]+/g, '')
      .replace(/(如何|什么|哪些|为什么|是否|能否|吗|呢|关系|作用|意义|方面|问题|分析|说明|影响)$/g, '')
      .replace(/^(标题|问题|回答|答案)\s*[:：]?/g, '')
      .trim();
  }

  function isAutoKeywordCandidate(value) {
    const term = cleanText(value);
    if (!term || term.length < 2 || term.length > 18) return false;
    if (AUTO_KEYWORD_STOPWORDS.has(term)) return false;
    if (/^[\d\s:：.-]+$/.test(term)) return false;
    if (/B?24[\u4e00-\u9fa5A-Za-z]{1,20}\d*\s*班/.test(term)) return false;
    if (/(如何|能够|中的|标题|回答|答案)/.test(term)) return false;
    if (/^(也会|可能|需要|可以|通过|进行|提升|影响|约束)/.test(term)) return false;
    if (/^(标题|问题|回答|答案|如何|什么|哪些|为什么|是否|能否|能够|可以|需要|通过|进行)$/.test(term)) return false;
    return /[\u4e00-\u9fa5]/.test(term);
  }

  function getAutoKeywordProfessionalScore(value) {
    const term = cleanText(value);
    if (AUTO_KEYWORD_PROFESSIONAL_SET.has(term)) return 3;
    if (AUTO_KEYWORD_PROFESSIONAL_TERMS.some((item) => term.includes(item))) return 2;
    if (AUTO_KEYWORD_PROFESSIONAL_TERMS.some((item) => item.includes(term) && term.length >= 4)) return 1;
    return 0;
  }

  function collectAutoKeywordCandidates(text) {
    const source = cleanText(text);
    const candidates = [];
    const add = (value) => {
      const term = normalizeAutoKeywordTerm(value);
      if (isAutoKeywordCandidate(term)) candidates.push(term);
    };

    AUTO_KEYWORD_PROFESSIONAL_TERMS.forEach((term) => {
      if (countTextOccurrences(source, term) > 0) add(term);
    });
    for (const match of source.matchAll(AUTO_KEYWORD_DOMAIN_PATTERN)) add(match[0]);
    for (const match of source.matchAll(AUTO_KEYWORD_CORE_PATTERN)) add(match[0]);
    for (const match of source.matchAll(/[“"「『]([^”"」』]{2,18})[”"」』]/g)) add(match[1]);

    const normalized = source
      .replace(/B?24[\u4e00-\u9fa5A-Za-z]{1,20}\d*\s*班/g, ' ')
      .replace(/[\dA-Za-z_/:?&=#%.-]+/g, ' ')
      .replace(/[，。！？、；;：:（）()《》“”"「」『』【】\[\]\n\r\t]/g, ' ');
    const splitter = /(的|了|和|与|及|在|对|从|中|上|下|是|为|以|等|方面|问题|影响|体现|如何|什么|哪些|分析|说明|结合|是否|能够|可以|需要|通过|进行|主要|核心|一种|一个|这个|这些|其中|以及)/g;
    normalized.split(splitter)
      .map(normalizeAutoKeywordTerm)
      .filter(isAutoKeywordCandidate)
      .forEach(add);

    return candidates;
  }

  function extractAutoKeywords(items, limit = 24) {
    const text = (Array.isArray(items) ? items : [])
      .map((item) => `${cleanText(item && item.title)}\n${cleanText(item && item.content)}`)
      .join('\n');
    const max = Math.max(1, Number.parseInt(String(limit || 24), 10) || 24);
    const counts = new Map();
    for (const term of collectAutoKeywordCandidates(text)) {
      counts.set(term, countTextOccurrences(text, term));
    }
    const sorted = Array.from(counts, ([term, count]) => ({
      term,
      count,
      source: 'auto',
      professionalScore: getAutoKeywordProfessionalScore(term),
    }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.professionalScore - a.professionalScore
        || b.count - a.count
        || b.term.length - a.term.length
        || a.term.localeCompare(b.term, 'zh-Hans-CN'));
    const filtered = [];
    for (const item of sorted) {
      if (filtered.some((existing) => (existing.term.includes(item.term) || item.term.includes(existing.term)) && existing.count >= item.count)) continue;
      filtered.push(item);
      if (filtered.length >= max) break;
    }
    return filtered;
  }

  // 只列「确实识别到相关表达」的班级：一个班在本次讨论里什么都没识出来，就不显示（老师要求）。
  function buildClassStats(items, hitTest) {
    const rows = new Map();
    const list = Array.isArray(items) ? items : [];
    list.forEach((item, index) => {
      const name = normalizeCourseClassName(item && (item.className || item.classId));
      if (!name) return;
      if (!rows.has(name)) rows.set(name, { name, count: 0, hits: 0 });
      const row = rows.get(name);
      row.count += 1;
      if (typeof hitTest !== 'function' || hitTest(index)) row.hits += 1;
    });
    return Array.from(rows.values())
      .filter((row) => row.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  function makeCoverageMetric(name, count, total, detail) {
    const safeCount = Math.max(0, Number.parseInt(String(count || 0), 10) || 0);
    const safeTotal = Math.max(0, Number.parseInt(String(total || 0), 10) || 0);
    const percent = safeTotal ? Math.round((safeCount / safeTotal) * 100) : 0;
    return {
      name,
      count: safeCount,
      total: safeTotal,
      percent: Math.max(0, Math.min(100, percent)),
      detail: cleanText(detail),
    };
  }

  const CURRENT_AFFAIRS_POLICY_PATTERN = /(时政|政治|政策|国家|中央|政府|财政部|两会|十五五|十四五|规划|预算|财政|税收|国债|专项债|转移支付|补助|补贴|公共服务|民生|养老|教育|医疗|就业|城市更新|以旧换新|扩大内需|高质量发展|共同富裕|国家战略|国家治理|基层治理|公平|公正|人民|安全|新质生产力)/;

  function isCurrentAffairsPolicyRelatedText(text) {
    return CURRENT_AFFAIRS_POLICY_PATTERN.test(cleanText(text));
  }

  // 思辨表达：学生自己做了比较、权衡、反驳、追问，或讲清了理由，而不是只把课件的话搬过来。
  // 老师反馈原来的覆盖率偏低：只要沾边的都算，不再要求写满一整句论证。
  const DELIBERATION_PATTERN = /(对比|相比之下|相比之|一方面|另一方面|然而|反而|相反|未必|不一定|不能只|不仅|除了|更重要|关键在于|取决于|权衡|利弊|反驳|不同意|质疑|商榷|值得商榷|这是因为|原因在于|假设|会不会|能否|是否|我认为|我觉得|我的看法|因为|所以|如果|只要|只有|才能|应该|建议|需要|其实|实际上|可能|也许|可以|而且|同时|另外|例如|比如|举个例子|根据|数据显示|案例|现象|问题|影响|作用|意义|价值|风险|挑战|对策|措施|途径|方式|角度|层面|首先|其次|最后)/;
  // 思政/时政这一侧也放宽：出现这些词就算「靠边」。
  const POLICY_TOUCH_PATTERN = /(国家|政府|政策|制度|民生|公平|社会|公共|财政|税|补贴|转移支付|教育|医疗|养老|就业|住房|扶贫|保障|治理|管理|法律|法规|规定|改革|经济|市场|企业|农村|城市|基层|中央|地方|预算|债务|基金|服务|资源|分配)/;

  function hasDeliberationHit(text) {
    const value = cleanText(text);
    return value.length >= 6 && DELIBERATION_PATTERN.test(value);
  }

  // 纯应声（好的、收到、嗯嗯、同意…）不参与覆盖率：算进去只会把比率灌高，老师要的是「真的谈了东西」。
  const ACK_ONLY_PATTERN = /^(好|好的|好啊|收到|嗯+|哦+|噢+|哈哈+|呵呵+|支持|同意|赞成|赞同|赞|谢谢|多谢|明白|了解|知道了|懂了|ok|OK|可以|行|是的|对|没错|厉害|棒|优秀|\+1|1)[。！!？?~～,，、.\s]*$/;
  function isPureAcknowledgement(text) {
    const value = cleanText(text);
    if (!value) return true;
    if (value.length < 8) return true;
    return ACK_ONLY_PATTERN.test(value);
  }

  // 命中口径统一放在这里：思政维度别名、时政政策、专业概念、思辨表达，四者之一即算「有内容」。
  function buildCoverageHitTest(profile, autoKeywords) {
    const normalizedProfile = normalizeAnalysisProfile(profile);
    const autoTerms = (autoKeywords || []).map((item) => cleanText(item && item.term)).filter(Boolean);
    return (text) => {
      const value = cleanText(text);
      if (!value) return false;
      if (isPureAcknowledgement(value)) return false;
      if (normalizedProfile.dimensions.some((dimension) => dimension.aliases.some((alias) => countTextOccurrences(value, alias) > 0))) return true;
      if (isCurrentAffairsPolicyRelatedText(value)) return true;
      if (POLICY_TOUCH_PATTERN.test(value)) return true;
      if (autoTerms.some((term) => countTextOccurrences(value, term) > 0)) return true;
      return hasDeliberationHit(value);
    };
  }

  function replyTextsOf(items) {
    const out = [];
    for (const item of Array.isArray(items) ? items : []) {
      for (const reply of (item && Array.isArray(item.replies) ? item.replies : [])) {
        const text = `${cleanText(reply && reply.title)}\n${cleanText(reply && reply.content)}`;
        if (cleanText(text)) out.push(text);
      }
    }
    return out;
  }

  function buildCoverageMetrics(items, topicTexts, profile, autoKeywords) {
    const sourceItems = Array.isArray(items) ? items : [];
    const texts = Array.isArray(topicTexts) ? topicTexts : [];
    const normalizedProfile = normalizeAnalysisProfile(profile);
    const topicCount = texts.length;
    const hasHit = buildCoverageHitTest(normalizedProfile, autoKeywords);
    const hasDimensionHit = (text) => normalizedProfile.dimensions
      .some((dimension) => dimension.aliases.some((alias) => countTextOccurrences(text, alias) > 0));
    const autoTerms = (autoKeywords || []).map((item) => cleanText(item && item.term)).filter(Boolean);
    const hasProfessionalConceptHit = (text) => autoTerms.some((term) => countTextOccurrences(text, term) > 0);
    const hasTopicCoverageHit = (text) => hasHit(text);
    const topicHitCount = texts.filter(hasTopicCoverageHit).length;
    const replyTexts = replyTextsOf(sourceItems);
    const replyHitCount = replyTexts.filter(hasTopicCoverageHit).length;
    const hitDimensionCount = normalizedProfile.dimensions
      .filter((dimension) => texts.some((text) => dimension.aliases.some((alias) => countTextOccurrences(text, alias) > 0)))
      .length;
    const allClasses = new Set();
    const hitClasses = new Set();
    sourceItems.forEach((item, index) => {
      const className = normalizeCourseClassName(item && (item.className || item.classId));
      if (!className) return;
      allClasses.add(className);
      if (hasTopicCoverageHit(texts[index] || '')) hitClasses.add(className);
    });
    const autoTopicHitCount = autoTerms.length
      ? texts.filter(hasProfessionalConceptHit).length
      : 0;
    const hiddenClasses = Math.max(0, allClasses.size - hitClasses.size);
    return [
      makeCoverageMetric('话题覆盖率', topicHitCount, topicCount, `${topicHitCount}/${topicCount} 个学生话题`),
      makeCoverageMetric('回复覆盖率', replyHitCount, replyTexts.length, `${replyHitCount}/${replyTexts.length} 条学生回复`),
      makeCoverageMetric('维度覆盖率', hitDimensionCount, normalizedProfile.dimensions.length, `${hitDimensionCount}/${normalizedProfile.dimensions.length} 个分析维度`),
      makeCoverageMetric('班级覆盖率', hitClasses.size, allClasses.size, hiddenClasses
        ? `${hitClasses.size}/${allClasses.size} 个班级出现相关表达（${hiddenClasses} 个班级没有识别到，列表里已隐藏）`
        : `${hitClasses.size}/${allClasses.size} 个班级出现相关表达`),
      makeCoverageMetric('专业概念覆盖率', autoTopicHitCount, topicCount, `${autoTopicHitCount}/${topicCount} 个话题含专业概念`),
    ];
  }

  function buildLocalTeacherAnalysis(items, profile) {
    const normalizedProfile = normalizeAnalysisProfile(profile);
    const topicTexts = (Array.isArray(items) ? items : []).map((item) => `${cleanText(item && item.title)}\n${cleanText(item && item.content)}`);
    const combinedText = topicTexts.join('\n');
    const dimensions = normalizedProfile.dimensions.map((dimension) => {
      const count = dimension.aliases.reduce((total, alias) => total + countTextOccurrences(combinedText, alias), 0);
      const topicCount = topicTexts.filter((text) => dimension.aliases.some((alias) => countTextOccurrences(text, alias) > 0)).length;
      return {
        name: dimension.name,
        aliases: dimension.aliases.slice(),
        count,
        topicCount,
      };
    }).filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    const hitDimensionNames = new Set(dimensions.map((item) => item.name));
    const uncoveredDimensions = normalizedProfile.dimensions
      .map((dimension) => dimension.name)
      .filter((name) => !hitDimensionNames.has(name));
    const totalKeywordHits = dimensions.reduce((total, item) => total + item.count, 0);
    const autoKeywords = extractAutoKeywords(items, 24);
    const coverageHit = buildCoverageHitTest(normalizedProfile, autoKeywords);
    const classStats = buildClassStats(items, (index) => coverageHit(topicTexts[index] || ''));
    const coverageMetrics = buildCoverageMetrics(items, topicTexts, normalizedProfile, autoKeywords);
    const placeholderPattern = /^\[(图片|附件)回复，尚未读取(?:图片|附件)内容\]$/;
    let placeholderCount = 0;
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (placeholderPattern.test(cleanText(item && item.content))) placeholderCount += 1;
      (item && Array.isArray(item.replies) ? item.replies : []).forEach((reply) => {
        if (placeholderPattern.test(cleanText(reply && reply.content))) placeholderCount += 1;
      });
    });
    return {
      topicCount: topicTexts.length,
      totalKeywordHits,
      autoKeywordHits: autoKeywords.reduce((total, item) => total + item.count, 0),
      topDimension: dimensions[0] ? dimensions[0].name : '',
      keywords: extractIdeologyKeywords(items, 24, normalizedProfile),
      autoKeywords,
      classStats,
      coverageMetrics,
      dimensions,
      uncoveredDimensions,
      placeholders: placeholderCount,
      profile: normalizedProfile,
    };
  }

  function formatLocalKeywordSummaryForPrompt(analysis) {
    if (!analysis) return '本地关键词统计：暂未命中教师设定的分析口径，请结合学生原文谨慎分析。';
    const hasPresetKeywords = !!analysis.totalKeywordHits;
    const hasAutoKeywords = !!(analysis.autoKeywords || []).length;
    if (!hasPresetKeywords && !hasAutoKeywords) return '本地关键词统计：暂未命中教师设定的分析口径，请结合学生原文谨慎分析。';
    const keywords = (analysis.keywords || []).slice(0, 12).map((item) => `${item.term} ${item.count}`).join('；');
    const autoKeywords = (analysis.autoKeywords || []).slice(0, 12).map((item) => `${item.term} ${item.count}`).join('；');
    const classStats = (analysis.classStats || []).slice(0, 12).map((item) => `${item.name} ${item.hits}/${item.count} 个话题有相关表达`).join('；');
    const dimensions = (analysis.dimensions || []).slice(0, 8).map((item) => `${item.name}：${item.count}次，覆盖${item.topicCount}个话题`).join('；');
    const uncovered = (analysis.uncoveredDimensions || []).length
      ? `未覆盖维度（0 次）：${analysis.uncoveredDimensions.join('、')}`
      : '';
    const coverage = (analysis.coverageMetrics || []).map((item) => `${item.name}${item.percent}%（${item.detail}）`).join('；');
    return [
      '本地关键词统计：',
      classStats ? `班级统计：${classStats}` : '',
      keywords ? `预设关键词：${keywords}` : '',
      autoKeywords ? `自动提炼专业概念：${autoKeywords}` : '',
      coverage ? `覆盖率指标：${coverage}` : '',
      dimensions ? `思政维度覆盖：${dimensions}` : '',
      uncovered,
    ].filter(Boolean).join('\n');
  }

  function formatAnalysisProfileForPrompt(profile) {
    return normalizeAnalysisProfile(profile).dimensions
      .map((item) => `${item.name}：${item.aliases.join('、')}`)
      .join('\n');
  }

  function buildTeacherAnalysisReport(options) {
    const source = options || {};
    const comments = Array.isArray(source.comments) ? source.comments : [];
    const analysis = source.analysis || buildLocalTeacherAnalysis(comments, source.analysisProfile);
    const topicContext = normalizeTopicContext(source.topicContext);
    const title = cleanText(topicContext.title) || '课程讨论';
    const question = cleanText(topicContext.question);
    const summary = cleanText(source.summary);
    const error = cleanText(source.error);
    const keywordLines = (analysis.keywords || []).length
      ? analysis.keywords.slice(0, 20).map((item, index) => `${index + 1}. ${item.term}：${item.count}`).join('\n')
      : '暂未命中教师设定的关键词。';
    const autoKeywordLines = (analysis.autoKeywords || []).length
      ? analysis.autoKeywords.slice(0, 24).map((item, index) => `${index + 1}. ${item.term}：${item.count}`).join('\n')
      : '暂未提炼出明显高频词。';
    const coverageLines = (analysis.coverageMetrics || []).length
      ? analysis.coverageMetrics.map((item) => `- ${item.name}：${item.percent}%（${item.detail}）`).join('\n')
      : '暂未生成覆盖率指标。';
    const classLines = (analysis.classStats || []).length
      ? analysis.classStats.slice(0, 20).map((item) => `${item.name}：${item.hits}/${item.count} 个话题有相关表达`).join('\n')
      : '暂未读取到班级信息。';
    const dimensionLines = (analysis.dimensions || []).length
      ? analysis.dimensions.slice(0, 12).map((item, index) => `${index + 1}. ${item.name}：${item.count}次，覆盖${item.topicCount}个话题`).join('\n')
      : '暂未形成明显维度覆盖。';
    const uncoveredLines = (analysis.uncoveredDimensions || []).length
      ? `未覆盖维度（0 次）：${analysis.uncoveredDimensions.join('、')}`
      : '';
    return [
      '# 课程讨论分析报告',
      '',
      '## 基本信息',
      `- 讨论标题：${title}`,
      question ? `- 讨论引导：${question}` : '',
      `- 采集话题数：${comments.length}`,
      `- 关键词命中数：${analysis.totalKeywordHits || 0}`,
      analysis.topDimension ? `- 主要维度：${analysis.topDimension}` : '',
      '',
      '## 覆盖率指标',
      coverageLines,
      '',
      '## 班级统计',
      classLines,
      '',
      '## 关键词',
      keywordLines,
      '',
      '## 自动提炼专业概念',
      autoKeywordLines,
      '',
      '## 思政维度覆盖',
      dimensionLines,
      uncoveredLines,
      '',
      '## AI 深度总结',
      summary || `AI 深度总结暂不可用${error ? `：${error}` : '。'}`,
    ].filter((line) => line !== '').join('\n');
  }

  function normalizeUrl(value) {
    return cleanText(value).replace(/\/+$/, '');
  }

  function normalizeTimeoutSeconds(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return DEFAULTS.requestTimeoutSeconds;
    return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, parsed));
  }

  function normalizeRecent(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const out = [];
    values.map(normalizeUrl).filter(Boolean).forEach((url) => {
      if (seen.has(url)) return;
      seen.add(url);
      out.push(url);
    });
    return out.slice(0, 6);
  }

  function makeSettingsFromStorage(data) {
    const source = data || {};
    return {
      apiKey: cleanText(source[STORAGE_KEYS.apiKey] || ''),
      model: cleanText(source[STORAGE_KEYS.model] || DEFAULTS.model) || DEFAULTS.model,
      baseUrl: normalizeUrl(source[STORAGE_KEYS.baseUrl] || DEFAULTS.baseUrl) || DEFAULTS.baseUrl,
      anonymous: source[STORAGE_KEYS.anonymous] !== undefined ? !!source[STORAGE_KEYS.anonymous] : DEFAULTS.anonymous,
      keyMap: source[STORAGE_KEYS.keyMap] || {},
      recent: normalizeRecent(source[STORAGE_KEYS.recent]),
      requestTimeoutSeconds: normalizeTimeoutSeconds(source[STORAGE_KEYS.requestTimeoutSeconds]),
      maxTopics: source[STORAGE_KEYS.maxTopics] !== undefined ? normalizeMaxTopics(source[STORAGE_KEYS.maxTopics]) : DEFAULTS.maxTopics,
      analysisProfile: normalizeAnalysisProfile(source[STORAGE_KEYS.analysisProfile]),
    };
  }

  function applyStoragePatchToSettings(settings, patch) {
    const next = { ...(settings || makeSettingsFromStorage({})) };
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.apiKey)) next.apiKey = cleanText(patch[STORAGE_KEYS.apiKey]);
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.model)) next.model = cleanText(patch[STORAGE_KEYS.model]) || DEFAULTS.model;
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.baseUrl)) next.baseUrl = normalizeUrl(patch[STORAGE_KEYS.baseUrl]) || DEFAULTS.baseUrl;
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.anonymous)) next.anonymous = !!patch[STORAGE_KEYS.anonymous];
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.keyMap)) next.keyMap = patch[STORAGE_KEYS.keyMap] || {};
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.recent)) next.recent = normalizeRecent(patch[STORAGE_KEYS.recent]);
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.requestTimeoutSeconds)) next.requestTimeoutSeconds = normalizeTimeoutSeconds(patch[STORAGE_KEYS.requestTimeoutSeconds]);
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.maxTopics)) next.maxTopics = normalizeMaxTopics(patch[STORAGE_KEYS.maxTopics]);
    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.analysisProfile)) next.analysisProfile = normalizeAnalysisProfile(patch[STORAGE_KEYS.analysisProfile]);
    return next;
  }

  function getRequestTimeoutMs(settings) {
    return normalizeTimeoutSeconds(settings && settings.requestTimeoutSeconds) * 1000;
  }

  // 把手输的地址映射到最接近的官方预设，减少手工选择成本。
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

  function storageGet(keys) {
    return extensionCall(callback => chrome.storage.local.get(keys, callback));
  }

  function storageSet(values) {
    return extensionCall(callback => chrome.storage.local.set(values, callback));
  }

  async function persistSettings(settings) {
    const values = {
      [STORAGE_KEYS.apiKey]: settings.apiKey || '',
      [STORAGE_KEYS.model]: settings.model || DEFAULTS.model,
      [STORAGE_KEYS.baseUrl]: settings.baseUrl || DEFAULTS.baseUrl,
      [STORAGE_KEYS.anonymous]: !!settings.anonymous,
      [STORAGE_KEYS.keyMap]: settings.keyMap || {},
      [STORAGE_KEYS.requestTimeoutSeconds]: normalizeTimeoutSeconds(settings.requestTimeoutSeconds),
      [STORAGE_KEYS.maxTopics]: normalizeMaxTopics(settings.maxTopics),
      [STORAGE_KEYS.analysisProfile]: normalizeAnalysisProfile(settings.analysisProfile),
    };
    if (Array.isArray(settings.recent)) values[STORAGE_KEYS.recent] = normalizeRecent(settings.recent);
    await storageSet(values);
  }

  async function pushRecent(baseUrl) {
    const current = await storageGet([STORAGE_KEYS.recent]);
    const recent = Array.isArray(current[STORAGE_KEYS.recent]) ? current[STORAGE_KEYS.recent] : [];
    const merged = [normalizeUrl(baseUrl), ...recent].map(normalizeUrl).filter(Boolean);
    const uniq = Array.from(new Set(merged)).slice(0, 6);
    await storageSet({ [STORAGE_KEYS.recent]: uniq });
    if (settingsCache) settingsCache.recent = uniq;
    return uniq;
  }

  async function getSettings() {
    const data = await storageGet(Object.values(STORAGE_KEYS));
    settingsCache = makeSettingsFromStorage(data);
    return settingsCache;
  }

  async function saveSettings(partial) {
    await storageSet(partial);
    settingsCache = applyStoragePatchToSettings(settingsCache, partial);
  }

  function getApiKeyFor(settings, baseUrl) {
    const normalized = normalizeUrl(baseUrl);
    const preset = matchPreset(normalized);
    return cleanText(settings.keyMap[normalized] || (preset && settings.keyMap[normalizeUrl(preset.url)]) || settings.apiKey);
  }

  async function saveKeyFor(baseUrl, key) {
    const settings = settingsCache || await getSettings();
    const normalized = normalizeUrl(baseUrl);
    settings.keyMap[normalized] = cleanText(key);
    try {
      await saveSettings({
        [STORAGE_KEYS.keyMap]: settings.keyMap,
        [STORAGE_KEYS.apiKey]: cleanText(key),
      });
    } catch (error) {
      settingsCache = settings;
      throw error;
    }
  }

  function queryAll(root, selectors) {
    for (const sel of selectors) {
      try {
        const list = root.querySelectorAll(sel);
        if (list && list.length) return Array.from(list);
      } catch (error) { }
    }
    return [];
  }

  function queryOne(root, selectors) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (error) { }
    }
    return null;
  }

  function allSameOriginFrames() {
    const fs = [];
    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
      try { if (frame.contentWindow && frame.contentDocument) fs.push(frame.contentDocument); } catch (error) { }
    }
    return fs;
  }

  function getNodeText(node) { return cleanText(node && (node.innerText || node.textContent || '')); }
  function compactText(value) { return cleanText(value).replace(/\s+/g, ''); }

  function getContentNodeText(node) {
    if (!node) return '';
    let attributeText = '';
    try {
      attributeText = cleanText(node.getAttribute && node.getAttribute('content'));
    } catch (error) { }
    return htmlToPlainText(attributeText || node.innerHTML || getNodeText(node));
  }

  function limitText(value, maxLength) {
    const text = cleanText(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
  }

  function queryFirstText(root, selectors) {
    const node = queryOne(root, selectors);
    return getNodeText(node);
  }

  function queryAllNodes(root, selector) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    try { return Array.from(root.querySelectorAll(selector) || []); } catch (error) { return []; }
  }

  function isTimeLikeText(text) {
    return /(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}:\d{2}|今天|昨天|刚刚|\d+\s*(分钟前|小时前|天前))/.test(cleanText(text));
  }

  function isMetadataLine(text) {
    const line = cleanText(text);
    if (!line) return true;
    if (isNoiseText(line)) return true;
    if (/^\d+\s*楼$/.test(line)) return true;
    if (/^共\s*\d+\+?\s*条回复$/.test(line)) return true;
    if (/^阅读\s*\d+\+?$/.test(line)) return true;
    if (/^\d+\+?$/.test(line)) return true;
    if (/^(时间倒序|时间正序|词云)$/.test(line)) return true;
    if (/^课程积分$/.test(line)) return true;
    if (/上传图片、附件即表示您已阅读并接受《用户协议》/.test(line)) return true;
    if (/^教学重点难点\s*精?$/.test(line)) return true;
    if (/^(班级|行政班级|教学班|所属班级|学院|院系|专业|年级|学号|工号|姓名|昵称|学校|课程|课程名称|来源|平台|系统|客户端|设备|浏览器|IP属地|单位|部门)\s*[:：]/.test(line)) return true;
    if (/^B?24[\u4e00-\u9fa5A-Za-z（）()]{1,40}\d+\s*班$/.test(line)) return true;
    if (/^B?24[\u4e00-\u9fa5A-Za-z]{1,20}\d+([、,，]\s*\d+)+$/.test(line)) return true;
    if (/^(来自|来源于)\s*(智慧树|知到|超星|学习通|系统|平台)/.test(line)) return true;
    if (/^(发表于|发布于|回复于|时间[:：]?)?\s*(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[-/.月]\d{1,2}日?|今天|昨天|刚刚|\d+\s*(分钟前|小时前|天前))(\s+\d{1,2}:\d{2}(:\d{2})?)?\s*$/.test(line)) return true;
    return false;
  }

  function isCourseTopicMetadataLine(text) {
    const line = cleanText(text);
    if (!line) return true;
    if (isMetadataLine(line)) return true;
    if (/^来源\s*[:：]/.test(line)) return true;
    if (/^(全部班级|B?2[0-9][\u4e00-\u9fa5A-Za-z（）()]{1,40}\d+\s*班)$/.test(line)) return true;
    if (/(^|[\u4e00-\u9fa5A-Za-z])(?:20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}|[01]?\d-[0-3]?\d)\s+\d{1,2}:\d{2}\s*B?2[0-9][\u4e00-\u9fa5A-Za-z（）()]{1,40}\d+\s*班$/.test(line)) return true;
    if (/^(?:20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}|[01]?\d-[0-3]?\d)\s+\d{1,2}:\d{2}\s*B?2[0-9][\u4e00-\u9fa5A-Za-z（）()]{1,40}\d+\s*班$/.test(line)) return true;
    return false;
  }

  function removeLeadingTimeText(text) {
    return cleanText(text)
      .replace(/^(发表于|发布于|回复于)\s*/g, '')
      .replace(/^(发布时间|回复时间|时间)\s*[:：]\s*/g, '')
      .replace(/^20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?(\s+\d{1,2}:\d{2}(:\d{2})?)?\s*[:：,，-]?\s*/g, '')
      .replace(/^(今天|昨天)\s+\d{1,2}:\d{2}(:\d{2})?\s*[:：,，-]?\s*/g, '')
      .replace(/^(\d+\s*(分钟前|小时前|天前)|刚刚)\s*[:：,，-]\s*/g, '')
      .trim();
  }

  function sanitizeCommentContent(value) {
    return cleanText(value)
      .split('\n')
      .map((line) => removeLeadingTimeText(line))
      .map((line) => cleanText(line))
      .filter((line) => line && !isMetadataLine(line))
      .join('\n');
  }

  function isRosterLikeAdminContent(text) {
    const value = cleanText(text);
    if (!value) return false;
    const classCount = (value.match(/班/g) || []).length;
    const examCount = (value.match(/补考|缓考|重修|免修/g) || []).length;
    const classCodeCount = (value.match(/B?24[\u4e00-\u9fa5A-Za-z（）()]{1,32}\d+\s*班/g) || []).length;
    const abbreviatedClassCode = /B?24[\u4e00-\u9fa5A-Za-z]{1,16}\d+([、,，]\s*\d+)+/.test(value);
    const personAssignment = /^[\u4e00-\u9fa5A-Za-z]{2,12}\s*[:：]\s*[\u4e00-\u9fa5A-Za-z]{2,12}\s*[-:：]?\s*B?24/.test(value);
    const nestedPersonAssignment = /^[\u4e00-\u9fa5A-Za-z]{2,12}\s*[:：]\s*[\u4e00-\u9fa5A-Za-z]{2,12}\s*[:：-]/.test(value) && /B?24/.test(value);
    const teacherTime = /老师\s*20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(value) || /20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}.*老师/.test(value);
    if (examCount >= 5) return true;
    if ((personAssignment || nestedPersonAssignment) && (classCodeCount >= 1 || abbreviatedClassCode)) return true;
    if (classCodeCount >= 2) return true;
    if (/校企联合培养/.test(value) && classCodeCount >= 1) return true;
    if (classCount >= 6 && value.length > 80) return true;
    if (teacherTime && (classCount >= 2 || examCount >= 2) && value.length > 80) return true;
    return false;
  }

  function isUnrelatedSystemContent(text) {
    const value = cleanText(text);
    if (!value) return true;
    if (isMetadataLine(value)) return true;
    if (isRosterLikeAdminContent(value)) return true;
    return false;
  }

  function stripMetadata(fullText, author) {
    let text = cleanText(fullText);
    const name = cleanText(author);
    if (name) text = cleanText(text.replace(name, ''));
    return sanitizeCommentContent(text)
      .split('\n')
      .map((line) => cleanText(line))
      .filter((line) => line && !isMetadataLine(line))
      .join('\n');
  }

  function isUsefulCommentText(text) {
    const value = cleanText(text);
    if (!value) return false;
    if (/^(回复|赞|点赞|举报|删除|展开|收起|加载更多|更多|next|more)$/i.test(value)) return false;
    if (/^[\d\s:：.-]+$/.test(value)) return false;
    if (isUnrelatedSystemContent(value)) return false;
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(value)) return false;
    return true;
  }

  function isUsefulCourseTopicText(text) {
    const value = cleanText(text);
    if (!value) return false;
    if (/^(回复|赞|点赞|举报|删除|展开|收起|加载更多|更多|next|more)$/i.test(value)) return false;
    if (/^[\d\s:：.-]+$/.test(value)) return false;
    if (isUnrelatedSystemContent(value)) return false;
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(value)) return false;
    return true;
  }

  function isNoiseText(text) {
    return /^(回复|赞|点赞|举报|删除|取消|确定|展开|收起|加载更多|更多|next|more)$/i.test(cleanText(text));
  }

  function uniqueComments(comments) {
    const seen = new Set();
    const result = [];
    for (const comment of comments || []) {
      if (!comment || !isUsefulCommentText(comment.content)) continue;
      const content = sanitizeCommentContent(comment.content);
      if (!isUsefulCommentText(content)) continue;
      if (isUnrelatedSystemContent(content)) continue;
      const key = cleanText(comment.uniqueKey) || [cleanText(comment.authorId || comment.userId), cleanText(comment.author), cleanText(comment.createdAt || comment.time), compactText(content)].join('|');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push({
        ...comment,
        author: cleanText(comment.author),
        time: '',
        content,
        source: cleanText(comment.source),
        uniqueKey: key,
      });
    }
    return result;
  }

  function getChaoxingItemKey(item) {
    if (!item) return '';
    try {
      const realid = cleanText(item.getAttribute && item.getAttribute('realid'));
      if (realid) return `realid:${realid}`;
    } catch (error) { }
    const id = cleanText(item.id);
    if (id) return `id:${id}`;
    const floor = cleanText(queryFirstText(item, ['.topicReply_right .floor', '.floor']));
    if (floor) return `floor:${floor}`;
    return '';
  }

  function getRecordMetadata(node) {
    const attr = (names) => {
      for (const name of names) { const value = node && node.getAttribute && node.getAttribute(name); if (value) return cleanText(value); }
      return '';
    };
    const authorNode = queryOne(node, ['.author', '.replyReplyer', '.replyer', '.userName', '.creator']);
    const authorId = attr(['data-user-id', 'data-uid', 'userid', 'uid', 'data-author-id'])
      || cleanText(authorNode && authorNode.getAttribute && (authorNode.getAttribute('data-uid') || authorNode.getAttribute('userid')));
    const info = getNodeText(queryOne(node, ['.topicDetail_info', '.replyInfo', '.topicli_head', '.info']));
    const timeNode = queryOne(node, ['time', '.time', '.customedTime', '.reply-time', '.createTime', '.topicli_time', '.topicli_head_right']);
    const createdAt = attr(['data-create-time', 'data-time'])
      || cleanText(timeNode && timeNode.getAttribute && timeNode.getAttribute('datetime'))
      || getNodeText(timeNode)
      || (info.match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?)?/) || [])[0] || '';
    const role = attr(['data-role', 'role-type']);
    const isTeacher = attr(['isteacher','data-isteacher']);
    return {authorId, createdAt, platformId:attr(['realid']), domId:attr(['id']),classId:normalizeCourseClassId(attr(['classid','clazzid','data-classid','data-clazzid'])),className:getNodeText(queryOne(node,['.department','.classNameInfo'])),role: ['student','teacher','system'].includes(role) ? role : isTeacher==='true'?'teacher':isTeacher==='false'?'student':'unknown'};
  }

  function parseChaoxingReplyInfo(item) {
    const authorText = queryFirstText(item, ['.topicDetail_info .author', '.author', '.replyInfo .author', '.reply-info .author']);
    if (authorText) return { ...getRecordMetadata(item), author: normalizeAuthorName(authorText), time: '', itemKey: getChaoxingItemKey(item) };
    const infoText = getNodeText(queryOne(item, ['.topicDetail_info', '.replyInfo', '.reply-info']));
    const lines = infoText.split('\n').map((line) => cleanText(line)).filter(Boolean);
    const author = lines.find((line) => (
      !isTimeLikeText(line)
      && !/^\d+\s*楼$/.test(line)
      && !isNoiseText(line)
      && !/^共\s*\d+\s*条回复$/.test(line)
    )) || '';
    return { ...getRecordMetadata(item), author: limitText(author, 80), time: '', itemKey: getChaoxingItemKey(item) };
  }

  function pushComment(out, contentNode, source, meta) {
    const originalContent=contentNode&&(contentNode.getAttribute?.('content')||contentNode.innerHTML)||getContentNodeText(contentNode);
    const rich=readDiscussionContent(originalContent),content=sanitizeCommentContent(rich.text)||(rich.hasImages?'[图片回复，尚未读取图片内容]':'');
    if (!isUsefulCommentText(content)) return;
    out.push({
      ...(meta || {}),
      author: meta && meta.author ? meta.author : '',
      time: '',
      content,
      ...(originalContent!==content?{originalContent}:{}),
      ...(rich.hasImages?{images:rich.images,hasImages:true}:{}),
      source,
      uniqueKey: meta && meta.uniqueKey ? meta.uniqueKey : '',
    });
  }

  function getChaoxingReplyItemsFromDoc(doc) {
    return queryAllNodes(doc, '.topicDetail_replyList .topicDetail_replyItem');
  }

  function countNestedRepliesInItem(item) {
    const replyNodes = queryAllNodes(item, '.replyReply');
    if (replyNodes.length) return replyNodes.length;
    return queryAllNodes(item, '.replyReplyContent').length;
  }

  function getRawLoadedReplyInfoFromDocs(docs) {
    let count = 0;
    let topLevelCount = 0;
    let nestedReplyCount = 0;
    let hasChaoxingStructure = false;
    for (const doc of docs || []) {
      const items = getChaoxingReplyItemsFromDoc(doc);
      if (!items.length) continue;
      hasChaoxingStructure = true;
      for (const item of items) {
        const nested = countNestedRepliesInItem(item);
        topLevelCount += 1;
        nestedReplyCount += nested;
        count += 1 + nested;
      }
    }
    return { count, topLevelCount, nestedReplyCount, hasChaoxingStructure };
  }

  function extractChaoxingDiscussionCommentsFromDoc(doc) {
    const items = getChaoxingReplyItemsFromDoc(doc);
    if (!items.length) return [];
    const comments = [];
    for (const [itemIndex, item] of items.entries()) {
      const meta = parseChaoxingReplyInfo(item);
      if (!meta.itemKey) meta.itemKey = `local:${itemIndex}`;
      pushComment(comments, queryOne(item, ['.topicReply_right .replyContent', '.replyContent']), 'chaoxing-topic-reply', { ...meta, kind:'reply', uniqueKey: `${meta.itemKey || 'topic'}:main` });
      const nestedNodes = queryAllNodes(item, '.replyReplyContent');
      nestedNodes.forEach((nestedNode, index) => {
        const nestedMeta = {
          ...getRecordMetadata(nestedNode.parentElement),
          parentId: `${meta.itemKey}:main`,
          topicId: cleanText(currentLocation.href),
          kind: 'reply',
          author: normalizeAuthorName(queryFirstText(nestedNode.parentElement, ['.replyReplyer a', '.replyReplyer', '.replyer', '.author', '.name'])),
          time: '',
          uniqueKey: `${meta.itemKey || 'topic'}:nested:${index}`,
        };
        pushComment(comments, nestedNode, 'chaoxing-nested-reply', nestedMeta);
      });
    }
    return uniqueComments(comments);
  }

  function descendantCandidateCount(node) {
    if (!node || typeof node.querySelectorAll !== 'function') return 0;
    try { return node.querySelectorAll(CANDIDATE_SELECTORS.join(',')).length; } catch (error) { return 0; }
  }

  function commentFromNode(node) {
    if (!node) return null;
    const contentFromChild = queryFirstText(node, CONTENT_SELECTORS);
    const author = limitText(queryFirstText(node, AUTHOR_SELECTORS), 80);
    const content = sanitizeCommentContent(contentFromChild || stripMetadata(getNodeText(node), author));
    if (!isUsefulCommentText(content) || isNoiseText(content)) return null;
    if (!contentFromChild && descendantCandidateCount(node) > 6) return null;
    return {
      author,
      time: '',
      content,
      source: `${node.tagName || ''}.${String(node.className || '').trim().replace(/\s+/g, '.')}`,
      uniqueKey: cleanText(node.id) || `${node.tagName || ''}.${String(node.className || '').trim().replace(/\s+/g, '.')}#${compactText(content)}`,
    };
  }

  function extractCommentsFromDocs(docs) {
    const rawInfo = getRawLoadedReplyInfoFromDocs(docs);
    const chaoxingComments = [];
    for (const doc of docs || []) chaoxingComments.push(...extractChaoxingDiscussionCommentsFromDoc(doc));
    if (rawInfo.hasChaoxingStructure) return uniqueComments(chaoxingComments);

    const nodes = [];
    const seenNodes = new Set();
    for (const doc of docs || []) {
      for (const selector of CANDIDATE_SELECTORS) {
        for (const node of queryAllNodes(doc, selector)) {
          if (!node || seenNodes.has(node)) continue;
          seenNodes.add(node);
          nodes.push(node);
        }
      }
    }
    return uniqueComments(nodes.map(commentFromNode).filter(Boolean));
  }

  function isTeacherLikeText(text) {
    const value = cleanText(text);
    if (!value) return false;
    return /(老师|教师|讲师|助教|教员)/.test(value);
  }

  function getCourseTopicNodeKey(node) {
    if (!node) return '';
    try {
      const id = cleanText(node.id || (node.getAttribute && node.getAttribute('id')));
      if (id) return `id:${id}`;
      const dataId = cleanText(node.getAttribute && (node.getAttribute('data-id') || node.getAttribute('topicid') || node.getAttribute('topicId')));
      if (dataId) return `topic:${dataId}`;
    } catch (error) { }
    return '';
  }

  const COURSE_TOPIC_LINK_ATTRS = [
    'href', 'src', 'url', 'data-url', 'data-href', 'data-link', 'data-action',
    'onclick', 'data-onclick', 'topicUrl', 'topic-url',
  ];

  function normalizeCourseTopicDetailUrl(value) {
    const raw = String(value || '').replace(/&amp;/gi, '&').trim();
    if (!raw) return '';
    try {
      const base = /^\/?course\/topic(?:\/|$)/i.test(raw)
        ? 'https://groupweb.chaoxing.com'
        : (currentLocation.href || 'https://groupweb.chaoxing.com');
      const absolute = new URL(raw, base).href;
      return isDiscussionReplyPageUrl(absolute) ? absolute : '';
    } catch (error) {
      return '';
    }
  }

  function extractCourseTopicDetailUrlFromText(value) {
    const source = String(value || '').replace(/&amp;/gi, '&');
    const match = source.match(/https?:\/\/groupweb\.chaoxing\.com\/course\/topic\/[^'"<>\s)]+replysList[^'"<>\s)]*/i)
      || source.match(/\/course\/topic\/[^'"<>\s)]+replysList[^'"<>\s)]*/i);
    return normalizeCourseTopicDetailUrl(match && match[0]);
  }

  function extractCourseTopicUuidFromText(value) {
    const source = String(value || '');
    const pathMatch = source.match(/\/bbs\/[^/]+\/([^/?#'"<>\s)]+)(?:\/replysList|[/?#'"<>\s)]|$)/i);
    if (pathMatch) return cleanText(pathMatch[1]);
    const openDetail = source.match(/openDetail\(\s*['"]([^'"]+)['"]/i);
    if (openDetail) return cleanText(openDetail[1]);
    const hyphenated = source.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    if (hyphenated) return cleanText(hyphenated[0]);
    const suffixed = source.match(/[a-f0-9]{32}_topicDiscuss/i);
    if (suffixed) return cleanText(suffixed[0]);
    const named = source.match(/(?:uuid|topicUuid|topicid|topicId)\s*[:=]\s*['"]?([a-f0-9-]{16,80}(?:_topicDiscuss)?)/i);
    if (named) return cleanText(named[1]);
    const plain = source.match(/[a-f0-9]{32}/i);
    return plain ? cleanText(plain[0]) : '';
  }

  function stripCourseTopicDiscussSuffix(uuid) {
    return cleanText(uuid).replace(/_topicDiscuss$/i, '');
  }

  function decodeUrlPart(value) {
    try {
      return decodeURIComponent(String(value || ''));
    } catch (error) {
      return String(value || '');
    }
  }

  function parseCourseTopicDetailUrlParts(value) {
    const url = normalizeCourseTopicDetailUrl(value);
    if (!url) return null;
    try {
      const parsed = new URL(url, currentLocation.href || undefined);
      const match = parsed.pathname.match(/\/course\/topic\/v3\/bbs\/([^/]+)\/([^/]+)\/replysList/i);
      if (!match) return null;
      return {
        url: parsed.href,
        bbsid: cleanText(decodeUrlPart(match[1])),
        uuid: stripCourseTopicDiscussSuffix(decodeUrlPart(match[2])),
        requestUuid: cleanText(decodeUrlPart(match[2])),
      };
    } catch (error) {
      return null;
    }
  }

  function collectCourseTopicAttributeTexts(node, out, depth) {
    if (!node || depth > 8) return;
    for (const name of COURSE_TOPIC_LINK_ATTRS) {
      try {
        const attrValue = typeof node.getAttribute === 'function' ? node.getAttribute(name) : '';
        if (attrValue) out.push(String(attrValue));
      } catch (error) { }
      try {
        const propertyValue = typeof node[name] === 'string' ? node[name] : '';
        if (propertyValue) out.push(propertyValue);
      } catch (error) { }
    }
    try {
      const attrs = node.attributes;
      if (attrs && typeof attrs.length === 'number') {
        for (const attr of Array.from(attrs)) {
          if (attr && attr.value) out.push(String(attr.value));
        }
      } else if (attrs && typeof attrs === 'object') {
        for (const value of Object.values(attrs)) {
          if (value) out.push(String(value));
        }
      }
    } catch (error) { }
    for (const child of Array.from(node.children || [])) collectCourseTopicAttributeTexts(child, out, depth + 1);
  }

  function getCourseTopicAttributeTexts(node) {
    const values = [];
    collectCourseTopicAttributeTexts(node, values, 0);
    return values;
  }

  function getCourseTopicDetailUrl(node) {
    for (const value of getCourseTopicAttributeTexts(node)) {
      const url = extractCourseTopicDetailUrlFromText(value) || normalizeCourseTopicDetailUrl(value);
      if (url) return url;
    }
    return '';
  }

  function getCourseTopicUuid(node) {
    if (!node) return '';
    const direct = typeof node.getAttribute === 'function'
      ? cleanText(node.getAttribute('data-uuid') || node.getAttribute('uuid') || node.getAttribute('topicUuid'))
      : '';
    if (direct) return direct;
    for (const value of getCourseTopicAttributeTexts(node)) {
      const uuid = extractCourseTopicUuidFromText(value);
      if (uuid) return uuid;
    }
    return '';
  }

  function sanitizeStudentName(value) {
    if (!value) return '';
    let s = cleanText(value).split(/\s*回复\s*/)[0].replace(/\s*[:：]\s*$/,'');
    s = s.replace(/^(?:置顶|精华|推荐|精|【[^】]+】|\[[^\]]+\])\s*/g, '');
    const parts = s.split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    let candidate = parts[0];
    candidate = candidate.replace(/\d+[-/.年]\d+.*$/, '').replace(/[:：\d].*$/, '').trim();
    if (!candidate || candidate.length > 20 || /[。，！？；、“”‘’（）\(\)]/.test(candidate)) return '';
    return limitText(candidate, 40);
  }

  function extractCourseTopicAuthor(node) {
    if (!node) return '';
    let authorNodeText = queryFirstText(node, ['.topicInfo .author', '.topic-info .author', '.author', '.userName', '.creator', '.name']);
    if (authorNodeText) {
      const name = sanitizeStudentName(authorNodeText);
      if (name && !isNoiseText(name)) return name;
    }

    const metaCandidates = [
      queryFirstText(node, [
        '.topicli_head_left', '.topicli_head', '[class*="topicli_head"]',
        '.topicInfo', '.topic-info', '.info', '.meta'
      ]),
      (node && /(?:topicli_head|topicInfo|meta|info)/.test(String(node.className || ''))) ? getNodeText(node) : ''
    ];

    for (const text of metaCandidates) {
      if (!text) continue;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        let s = line.replace(/^(?:置顶|精华|推荐|精|【[^】]+】|\[[^\]]+\])\s*/g, '');
        s = s.replace(/(?:20\d{2}|\d{2})?[^\s\d,，]{1,10}?(?:\d{1,2}班|[一二三四五六七八九十]班)/g, ' ');
        s = s.replace(/(?:刚刚|昨天|前天|\d+\s*(?:秒|分钟|小时|天|周|月|年))\s*前?/g, ' ');
        s = s.replace(/\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?/g, ' ');
        s = s.replace(/\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}(?::\d{1,2})?/g, ' ');
        s = s.replace(/\d{1,2}:\d{1,2}(?::\d{1,2})?/g, ' ');
        const parts = s.trim().split(/\s+/).filter(Boolean);
        if (parts.length) {
          const name = sanitizeStudentName(parts[0]);
          if (name && !isNoiseText(name) && !/^(?:置顶|精华|推荐)$/.test(name)) return name;
        }
      }
    }

    const fullText = getNodeText(node);
    let s = fullText.replace(/^(?:置顶|精华|推荐|精|【[^】]+】|\[[^\]]+\])\s*/g, '');
    s = s.replace(/(?:20\d{2}|\d{2})?[^\s\d,，]{1,10}?(?:\d{1,2}班|[一二三四五六七八九十]班)/g, ' ');
    s = s.replace(/(?:刚刚|昨天|前天|\d+\s*(?:秒|分钟|小时|天|周|月|年))\s*前?/g, ' ');
    s = s.replace(/\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?/g, ' ');
    s = s.replace(/\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}(?::\d{1,2})?/g, ' ');
    s = s.replace(/\d{1,2}:\d{1,2}(?::\d{1,2})?/g, ' ');
    const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/).filter(Boolean);
      if (parts.length) {
        const name = sanitizeStudentName(parts[0]);
        if (name && !isNoiseText(name) && !/^(?:置顶|精华|推荐)$/.test(name)) return name;
      }
    }

    return '';
  }

  function getCourseTopicMetaText(node) {
    const parts = [];
    for (const selector of COURSE_TOPIC_META_SELECTORS) {
      for (const item of queryAllNodes(node, selector)) {
        const text = getNodeText(item);
        if (text) parts.push(text);
      }
    }
    return cleanText(parts.join('\n'));
  }

  function isTeacherCourseTopic(node) {
    if (!node) return false;
    const marker = getNodeAttribute(node, ['isteacher', 'data-isteacher']);
    if (marker === 'false') return false;
    if (marker === 'true') return true;
    if (/(?:^|\s)dataBody_top(?:\s|$)/.test(String(node.className || ''))) return true;
    const text = getNodeText(node);
    if (isTeacherLikeText(text)) return true;
    return isTeacherLikeText(getCourseTopicMetaText(node));
  }

  function htmlToPlainText(value) {
    if(typeof DiscussionAnalysis!=='undefined'&&DiscussionAnalysis.discussionContent)return DiscussionAnalysis.discussionContent(value).text;
    const html = String(value || '');
    if (!html) return '';
    try {
      if (typeof DOMParser === 'function') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return cleanText(doc.body ? doc.body.innerText || doc.body.textContent || '' : '');
      }
    } catch (error) { }
    return cleanText(html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"));
  }

  function readDiscussionContent(value,item={}) {
    if(typeof DiscussionAnalysis!=='undefined'&&DiscussionAnalysis.discussionContent)return DiscussionAnalysis.discussionContent(value,{images:item.images||item.img_data,baseUrl:String(window.location?.href||'')});
    return {text:htmlToPlainText(value),images:[],hasImages:Boolean(item.img_data?.length)};
  }

  function extractBalancedJsonObject(text, startIndex) {
    const source = String(text || '');
    const objectStart = source.indexOf('{', Math.max(0, startIndex || 0));
    if (objectStart < 0) return '';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = objectStart; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(objectStart, index + 1);
      }
    }
    return '';
  }

  function courseTopicFromDetailData(topic, sourceName) {
    if (!topic || typeof topic !== 'object') return null;
    const originalContent=topic.content ?? topic.text_content ?? topic.rtf_content ?? topic.rtfContent ?? '',rich=readDiscussionContent(originalContent,topic);
    const content = rich.text||(rich.hasImages?'[图片回复，尚未读取图片内容]':'');
    const lastReplyContent = sanitizeCourseTopicContent(topic.last_reply_content || topic.lastReplyContent || '');
    const title = sanitizeTopicTitleText(topic.title || '');
    if (!title && !content && !lastReplyContent) return null;
    const rawTag = cleanText(topic.classId||topic.classid||topic.clazzId||topic.clazzid||topic.tag||topic.tags||'');
    const rawClassId = normalizeCourseClassId(rawTag);
    const topicCourseLevel = isCourseLevelClassId(rawTag) || isCourseLevelClassId(rawClassId);
    const topicClassId = topicCourseLevel ? '' : rawClassId;
    return {
      author: getApiRecordAuthor(topic),
      authorId: cleanText(topic.createrId || topic.creater_id || topic.uid || topic.userId || (topic.createrPuid ? 'puid:'+topic.createrPuid : '')),
      authorPuid: cleanText(topic.createrPuid || topic.create_puid || ''),
      createdAt: cleanText(topic.createTime || topic.create_time || topic.createtime || ''),
      role: getApiRecordRole(topic),
      classId: topicClassId,
      ...(topicCourseLevel ? { courseLevel: true } : {}),
      className: normalizeCourseClassName(topic.className||topic.classname||topic.department||''),
      time: '',
      title,
      content,
      ...(originalContent!==content?{originalContent}:{}),
      ...(rich.hasImages?{images:rich.images,hasImages:true}:{}),
      lastReplyContent,
      replyCount: Number.parseInt(cleanText(topic.reply_count || topic.s_replycount || topic.replyCount || '0'), 10) || 0,
      bbsid: cleanText(topic.bbsid || ''),
      source: sourceName || 'chaoxing-course-topic-detail',
      uuid: cleanText(topic.uuid || ''),
      platformId: cleanText(topic.id || ''),
      uniqueKey: topic.uuid ? `uuid:${cleanText(topic.uuid)}` : (topic.id ? `id:topicId_${cleanText(topic.id)}` : compactText(`${title}\n${content}`)),
    };
  }

  function parseCourseTopicDetailPayload(payload, sourceName) {
    let data = payload;
    if (typeof payload === 'string') {
      try { data = JSON.parse(payload); } catch (error) { return null; }
    }
    const topic = data && typeof data === 'object'
      ? (data.datas || data.topic || data.data || data)
      : null;
    return courseTopicFromDetailData(topic, sourceName);
  }

  function parseCourseTopicDetailHtml(html) {
    const source = String(html || '');
    const topicMatch = /\btopic\s*:\s*\{/.exec(source);
    if (!topicMatch) return null;
    const json = extractBalancedJsonObject(source, topicMatch.index);
    if (!json) return null;
    let topic = null;
    try { topic = JSON.parse(json); } catch (error) { return null; }
    return courseTopicFromDetailData(topic, 'chaoxing-course-topic-detail');
  }

  function courseTopicReplyFromData(item) {
    if (!item || typeof item !== 'object') return null;
    const author = getApiRecordAuthor(item);
    const wrapper=['datas','data','list','rows','second_data','secondData','children','childList','replyList','replies'].some(key=>item[key]&&typeof item[key]==='object');
    if(wrapper&&!author&&!item.uuid&&!item.replyId&&!item.reply_id&&!item.createrId&&!item.creater_id&&!item.userId&&!item.uid&&!item.create_puid&&!item.createrPuid)return null;
    const rawContent = item.content ?? item.replyContent ?? item.text_content ?? item.rtf_content ?? item.rtfContent ?? '';
    const rich=readDiscussionContent(rawContent,item),content = cleanText(rich.text) || (rich.hasImages ? '[图片回复，尚未读取图片内容]' : item.attachment?.length ? '[附件回复，尚未读取附件内容]' : '');
    if (!content) return null;
    const id = cleanText(item.uuid || item.id || item.replyId || item.reply_id || '');
    return {
      author,
      authorId: cleanText(item.createrId || item.creater_id || item.uid || item.userId || (item.createrPuid || item.create_puid ? 'puid:'+(item.createrPuid || item.create_puid) : '')),
      authorPuid: cleanText(item.createrPuid || item.create_puid || ''),
      createdAt: cleanText(item.createTime || item.create_time || item.replyTime || ''),
      role: getApiRecordRole(item),
      parentId: ['-1','0'].includes(cleanText(item.parentId || item.parent_id || item.replyToId || item.reply_to_id || item.replyTo?.replyToId || ''))?'':cleanText(item.parentId || item.parent_id || item.replyToId || item.reply_to_id || item.replyTo?.replyToId || ''),
      platformId: cleanText(item.id || ''),
      kind: 'reply',
      classId: normalizeCourseClassId(item.classId||item.classid||item.clazzId||item.clazzid||item.tag||item.tags||''),
      className: normalizeCourseClassName(item.className||item.classname||item.department||''),
      content,
      ...(String(rawContent)!==content?{originalContent:String(rawContent)}:{}),
      ...(rich.hasImages?{images:rich.images,hasImages:true}:{}),
      uniqueKey: id ? `reply:${id}` : [author, cleanText(item.createTime || item.create_time), compactText(content)].join('|'),
    };
  }

  function collectCourseTopicRepliesFromValue(value, replies, seen, depth, parentKey) {
    if (!value || depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value) collectCourseTopicRepliesFromValue(item, replies, seen, depth + 1, parentKey);
      return;
    }
    if (typeof value !== 'object') return;
    const reply = courseTopicReplyFromData(value);
    if(reply && !reply.parentId && parentKey)reply.parentId=parentKey;
    if (reply && !seen.has(reply.uniqueKey)) {
      seen.add(reply.uniqueKey);
      replies.push(reply);
    }
    for (const key of ['datas', 'data', 'list', 'rows', 'second_data', 'secondData', 'children', 'childList', 'replyList', 'replies']) {
      if (value[key]) collectCourseTopicRepliesFromValue(value[key], replies, seen, depth + 1, reply ? reply.uniqueKey : parentKey);
    }
  }

  function parseCourseTopicReplyListPayload(payload) {
    let data = payload;
    if (typeof payload === 'string') {
      try { data = JSON.parse(payload); } catch (error) { data = null; }
    }
    const replies = [];
    const seen = new Set();
    const source = data && typeof data === 'object' ? (data.datas || data.data || data.rows || data.list || []) : [];
    collectCourseTopicRepliesFromValue(source, replies, seen, 0);
    const poff = (data && typeof data === 'object' && data.poff && typeof data.poff === 'object') ? data.poff : {};
    const lastPageValue = poff.lastPage;
    const explicitEnd=lastPageValue===true||lastPageValue===1||lastPageValue==='1'||String(lastPageValue).toLowerCase()==='true',emptyTerminal=!!data&&(data.status===true||data.success===true)&&explicitEnd&&!['datas','data','rows','list'].some(key=>Object.hasOwn(data,key));
    const valid = !!data && typeof data === 'object' && data.status !== false && data.status !== 'false'&&data.success!==false
      && data.result !== false && (['datas','data','rows','list'].some(key => Object.hasOwn(data,key))||emptyTerminal);
    const lastPage = valid && (lastPageValue === true || lastPageValue === 1 || lastPageValue === '1' || String(lastPageValue).toLowerCase() === 'true');
    const missingNested = [];
    function inspect(value) {
      if (Array.isArray(value)) { value.forEach(inspect); return; }
      if (!value || typeof value !== 'object') return;
      const children = value.second_data || value.secondData || value.children || value.childList;
      const expected = Number(value.second_reply_count ?? value.secondReplyCount ?? value.childReplyCount ?? 0);
      const loaded=Array.isArray(children)?children.length:0;
      if (Number.isFinite(expected) && expected > loaded) {
        missingNested.push({id:cleanText(value.uuid||value.id),expected,loaded,lastReplyAt:cleanText(value.last_reply_time||value.lastReplyTime||value.last_reply_at||'')});
      }
      for (const key of ['datas','data','list','rows','second_data','secondData','children','childList','replyList','replies']) if(value[key])inspect(value[key]);
    }
    inspect(source);
    return {
      replies,
      valid,
      missingNested,
      poff,
      lastPage,
      lastValue: cleanText(poff.lastValue || ''),
      lastAuxValue: cleanText(poff.lastAuxValue || ''),
      rootActivities:Array.isArray(source)?source.map(item=>({lastReplyAt:cleanText(item.last_reply_time||item.lastReplyTime||item.last_reply_at||'')})):[],
    };
  }

  function getApiRecordRole(item) {
    if (['student','teacher','system'].includes(item.role)) return item.role;
    const marker = item.isteacher ?? item.isTeacher ?? item.is_teacher;
    return marker === true || marker === 'true' || marker === 1 || marker === '1' ? 'teacher'
      : marker === false || marker === 'false' || marker === 0 || marker === '0' ? 'student' : 'unknown';
  }

  function normalizeAuthorName(value) {
    return sanitizeStudentName(value);
  }
  function getApiRecordAuthor(item) {
    const values=[item.creater_name,item.createrName,item.creatorName,item.createName,item.authorName,item.author,item.userName,item.realName,item.name,item.creator?.name,item.user?.name];
    return normalizeAuthorName(values.find(value=>typeof value==='string'&&value.trim())||'');
  }

  function hasTruncatedMarker(text) {
    return /(?:\.\.\.|…)/.test(cleanText(text));
  }

  function looksHardCappedTopicContent(text) {
    const value = cleanText(text);
    return value.length >= 190 && !/[。！？.!?）)]\s*$/.test(value);
  }

  function shouldFetchCourseTopicDetail(topic) {
    if (!topic || (!cleanText(topic.uuid) && !normalizeCourseTopicDetailUrl(topic.detailUrl))) return false;
    const title = cleanText(topic.title);
    const content = cleanText(topic.content);
    return hasTruncatedMarker(title) || hasTruncatedMarker(content) || looksHardCappedTopicContent(content);
  }

  function getRuntimeCourseTopicData(uuid) {
    const key = cleanText(uuid);
    if (!key) return null;
    try {
      const map = rootWindow.Discuss && rootWindow.Discuss.topicDataMap;
      if (map && typeof map.get === 'function') {
        const candidates = [key, key.replace(/_topicDiscuss$/i, ''), `${key.replace(/_topicDiscuss$/i, '')}_topicDiscuss`];
        for (const candidate of Array.from(new Set(candidates.map(cleanText).filter(Boolean)))) {
          const item = map.get(candidate);
          if (item && typeof item === 'object') return item;
        }
      }
    } catch (error) { }
    return null;
  }

  function courseTopicFromRuntimeData(data, fallback) {
    if (!data || typeof data !== 'object') return fallback || null;
    const title = sanitizeTopicTitleText(data.title || (fallback && fallback.title) || '');
    const content = apiTopicContent(data.content ?? data.rtf_content ?? (fallback && fallback.content) ?? '');
    if (!title && !content) return fallback || null;
    const uuid = cleanText(data.uuid || (fallback && fallback.uuid) || '');
    return {
      ...(fallback || {}),
      author: getApiRecordAuthor(data) || cleanText(fallback && fallback.author || ''),
      time: '',
      authorId: cleanText(data.createrId || data.creater_id || data.userId || data.uid || (data.createrPuid ? 'puid:'+data.createrPuid : '') || (fallback && fallback.authorId) || ''),
      createdAt: cleanText(data.createTime || data.create_time || (fallback && fallback.createdAt) || ''),
      role: getApiRecordRole(data) !== 'unknown' ? getApiRecordRole(data) : ((fallback && fallback.role) || 'unknown'),
      title,
      content,
      classId: normalizeCourseClassId((fallback && fallback.classId) || data.classId || data.classid || data.clazzId || data.clazzid || ''),
      className: normalizeCourseClassName((fallback && fallback.className) || data.className || data.classname || data.classText || ''),
      source: 'chaoxing-course-topic-runtime',
      uuid,
      detailUrl: normalizeCourseTopicDetailUrl((fallback && fallback.detailUrl) || data.detailUrl || data.url || ''),
      uniqueKey: uuid ? `uuid:${uuid}` : cleanText((fallback && fallback.uniqueKey) || (data.id ? `id:topicId_${data.id}` : compactText(`${title}\n${content}`))),
    };
  }

  function stripCourseTopicMetadata(fullText, title, author) {
    let text = cleanText(fullText);
    for (const value of [title, author]) {
      const part = cleanText(value);
      if (part) text = cleanText(text.replace(part, ''));
    }
    return sanitizeCommentContent(text)
      .split('\n')
      .map((line) => cleanText(line))
      .filter((line) => line && !isCourseTopicMetadataLine(line))
      .join('\n');
  }

  function apiTopicContent(value) { return cleanText(htmlToPlainText(value)); }

  function sanitizeCourseTopicContent(value) {
    const raw = String(value || '');
    const text = /<[^>]+>/.test(raw) ? htmlToPlainText(raw) : raw;
    return sanitizeCommentContent(text)
      .split('\n')
      .map((line) => cleanText(line))
      .filter((line) => line && !isCourseTopicMetadataLine(line))
      .join('\n');
  }

  function normalizeCourseClassId(value) {
    const text = cleanText(value);
    if (!text) return '';
    let id = '';
    try {
      if (/^https?:\/\//i.test(text)) {
        const url = new URL(text);
        id = url.searchParams.get('classId') || url.searchParams.get('classid') || url.searchParams.get('clazzId') || url.searchParams.get('clazzid') || '';
      }
    } catch (error) { }
    if (!id && /^\d{5,}$/.test(text)) id = text;
    if (!id) {
      const match = text.match(/(?:classId|classid|clazzId|clazzid)\s*[=:]?\s*["']?(\d{5,})/i)
        || text.match(/classId(\d{5,})/i);
      id = match ? match[1] : '';
    }
    id = cleanText(id).replace(/[^\d]/g, '');
    if (!id || /^0+$/.test(id) || /^0*1$/.test(id)) return '';
    return id;
  }

  function getNodeAttribute(node, names) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    for (const name of names || []) {
      const value = node.getAttribute(name);
      if (value != null && cleanText(value)) return cleanText(value);
    }
    return '';
  }

  function normalizeCourseClassName(value) {
    // 班级列表行如「示例二班　学生人数 ： 32　上课　活动列表」：班名后面跟着元数据，必须截掉。
    // 不截的话整行都成了班级名，按班名匹配记录的班号（classId）会失败，人数还会被挂到错误的班级上。
    return cleanText(value)
      .replace(/^(来源|发布给|班级)\s*[:：]\s*/, '')
      .replace(/\s*(?:学生|学员|班级)\s*人数\s*[:：]?[\s\S]*$/, '')
      .replace(/\s*(?:上课|活动列表|查看详情|进入班级|班级活动)\s*$/, '')
      .replace(/^(全部班级|请选择|无搜索结果)$/g, '')
      .trim();
  }

  // 平台用 tags="classId0000001" 表示「全部班级」：它不是一个真实班级号，
  // 当成班号会把课程级话题错记成某个班的话题。normalizeCourseClassId 会把这个伪号规整成空串
  // （全零后面跟一个 1），所以这里必须能直接认原始写法。
  function isCourseLevelClassId(value) {
    const text = cleanText(value);
    if (!text) return false;
    const id = text.replace(/^(?:classId|classid|clazzId|clazzid)\s*[=:]?\s*/i, '').replace(/[^\d]/g, '');
    if (!id) return false;
    return id === '0000001' || /^0+$/.test(id) || /^0*1$/.test(id);
  }

  function extractCourseTopicClassInfo(node) {
    if (!node) return { classId: '', className: '', courseLevel: false, teacherTopic: false };
    const rawText = getNodeText(node);
    if (rawText.includes('老师') || isTeacherCourseTopic(node)) {
      // 「教师导学」是按班分区的：它没有自己的班号，但属于当前浏览的那个班，
      // 用 teacherTopic 跟「来源：全部班级」的课程级话题区分开。
      return { classId: '', className: '教师导学', courseLevel: true, teacherTopic: true };
    }
    const classId = normalizeCourseClassId(getNodeAttribute(node, [
      'tags', 'tag', 'data-tags', 'data-tag', 'classid', 'classId', 'clazzid', 'clazzId', 'data-classid', 'data-classId', 'data-clazzid', 'data-clazzId',
    ]));
    let className = normalizeCourseClassName(
      queryFirstText(node, [
        '.classNameInfo', '.topicli_from', '.clazzName', '.clazz-name',
        '.className', '.class-name', '[class*="className"]', '[class*="ClassName"]',
        '[class*="clazzName"]', '[class*="topicli_from"]', '.topicFrom', '.topic-from'
      ]),
    );
    if (!className) {
      const metaCandidates = [
        queryFirstText(node, [
          '.topicli_head_left', '.topicli_head', '[class*="topicli_head"]',
          '.topicInfo', '.topic-info', '.info', '.meta'
        ]),
        getNodeText(node)
      ];
      for (const text of metaCandidates) {
        if (!text) continue;
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (line.includes('、')) continue;
          const parts = line.split(/\s+/).filter(Boolean);
          if (parts.length >= 3) {
            const tail = parts[parts.length - 1];
            if (/(?:20\d{2}|\d{2})?[^\s\d,，]{1,10}?(?:\d{1,2}班|[一二三四五六七八九十]班)$/.test(tail)) {
              className = normalizeCourseClassName(tail);
              break;
            }
          }
        }
        if (className) break;
      }
      const rawText = getNodeText(node);
      if (!className && !rawText.includes('、')) {
        const classMatch = rawText.match(/(?:20\d{2}|\d{2})?[^\s\d,，、]{1,10}?(?:\d{1,2}班|[一二三四五六七八九十]班)/);
        if (classMatch) {
          className = normalizeCourseClassName(classMatch[0]);
        }
      }
    }
    // 「来源： 全部班级」的话题对所有班可见：它的 classNameInfo 是 30 个班名的串联，
    // tags 是伪班号 classId0000001。这种话题没有自己的班号，按课程级话题处理，
    // 而不是硬塞给当前正在浏览的那个班——那就是「选了 3 个班却全被送进去」的根源之一。
    const fromLine = rawText.split('\n').map((line) => cleanText(line)).find((line) => /^来源/.test(line)) || '';
    const multiClass = !!className && className.includes('、');
    if (multiClass) className = '';
    if (!className && /全部班级/.test(fromLine)) className = '全部班级';
    const rawClassId = normalizeCourseClassId(classId);
    let resolvedId = rawClassId;
    if (isCourseLevelClassId(resolvedId)) resolvedId = '';
    if (!resolvedId && className && Array.isArray(state.classOptions)) {
      const found = state.classOptions.find(opt => opt.name === className);
      if (found) resolvedId = found.id;
    }
    // 课程级话题只在有明确证据时才算：多班串联、来源写着「全部班级」、或者伪班号 classId0000001。
    // 页面没给班号（缺属性）不算证据——那种情况退回「这次从哪个班读到」，比错记成课程级更安全。
    const courseLevel = multiClass || /全部班级/.test(fromLine) || isCourseLevelClassId(rawClassId);
    return { classId: resolvedId, className, courseLevel, teacherTopic: false };
  }

  function extractCourseClassOptionFromNode(node) {
    const id = normalizeCourseClassId(getNodeAttribute(node, [
      'classid', 'classId', 'clazzid', 'clazzId', 'data-classid', 'data-classId', 'data-clazzid', 'data-clazzId', 'value', 'href',
    ]));
    const name = normalizeCourseClassName(getNodeText(node) || getNodeAttribute(node, ['title', 'aria-label']));
    if (!id || !name || /全部班级|请选择|无搜索结果/.test(name)) return null;
    if(name.includes('、'))return null; // 多班级话题标签不是独立班级选项。
    const count=readEnrollmentCount(node);
    return { id, name:name.replace(/[（(]\s*\d+\s*人\s*[）)]/g,'').trim(),...(count!==null?{studentCount:count,studentCountSource:'班级页面人数'}:{}) };
  }

  function readEnrollmentCount(node) {
    const raw=getNodeAttribute(node,['data-student-count','studentcount','studentCount','stuCount','data-students-total']);
    const text=getNodeText(node);
    // 只认「学生人数：32」这类明确写法；「共 N 人」必须和班级/学生/人数同现，
    // 否则页面里任何一个「… 5 人」都会被当成本班人数（这正是人数读错的来源之一）。
    const strict=text.match(/(?:学生|学员|班级)\s*人数\s*[:：]?\s*(\d+)/)?.[1];
    const loose=/班|学生|学员|人数/.test(text)?text.match(/(?:共|共计|合计)\s*(\d+)\s*人/)?.[1]:undefined;
    const value=raw||strict||loose||'';
    const count=Number(value);
    return /^\d+$/.test(String(value))&&Number.isInteger(count)&&count>=0&&count<=100000?count:null;
  }

  function uniqueCourseClassOptions(options) {
    const seen = new Set();
    const result = [];
    for (const option of options || []) {
      const id = normalizeCourseClassId(option && option.id);
      const name = normalizeCourseClassName(option && option.name);
      if (!id || !name) continue;
      if(seen.has(id)){
        const prior=result.find(c=>c.id===id);
        if(prior.name.includes('、')&&!name.includes('、'))prior.name=name;
        if(Number.isInteger(option.studentCount)&&!prior.studentCountConflict){
          if(Number.isInteger(prior.studentCount)&&prior.studentCount!==option.studentCount){prior.studentCount=null;prior.studentCountConflict=true;}
          else {prior.studentCount=option.studentCount;prior.studentCountSource=option.studentCountSource||'班级页面人数';}
        }
        continue;
      }
      seen.add(id);
      result.push({ id, name,...(Number.isInteger(option.studentCount)?{studentCount:option.studentCount,studentCountSource:option.studentCountSource||'班级页面人数'}:{}),...(option.studentCountConflict?{studentCount:null,studentCountConflict:true}:{}) });
    }
    return result;
  }

  function extractCourseClassOptionsFromDocs(docs) {
    const options = [];
    for (const doc of docs || []) {
      for (const selector of ['li', 'option', 'a']) {
        for (const node of queryAllNodes(doc, selector)) {
          if(node.closest?.(`#${PANEL_ID}`))continue;
          const option = extractCourseClassOptionFromNode(node);
          if (option) options.push(option);
        }
      }
      const classId=normalizeCourseClassId(doc.location?.href||doc.URL||currentLocation.href);
      const counts=queryAllNodes(doc,'#studentCount, #stuCount, #classStudentCount, .studentCount, [data-student-count], [data-students-total]');
      for(const node of counts){
        const id=normalizeCourseClassId(getNodeAttribute(node,['classid','clazzid','data-classid','data-clazzid']))||classId;
        const count=readEnrollmentCount(node)??(/^\d+$/.test(String(node.value||''))?Number(node.value):null);
        if(id&&count!==null&&count<=100000)options.push({id,name:options.find(c=>c.id===id)?.name||'班级 '+id,studentCount:count,studentCountSource:'课程页面学生人数'});
      }
    }
    return uniqueCourseClassOptions(options);
  }

  function normalizeCourseClassFilter(options) {
    const ids = Array.isArray(options && options.classIds) ? options.classIds : [];
    return new Set(ids.map(normalizeCourseClassId).filter(Boolean));
  }

  function buildCourseTopicClassCollectionPlan(options, classOptions) {
    const classIdSet = normalizeCourseClassFilter(options);
    const selectedIds = Array.from(classIdSet);
    if (!selectedIds.length) {
      return [{ classId: '', classIds: [], className: '', usePageClassFilter: false }];
    }
    const classNameById = new Map(uniqueCourseClassOptions(classOptions || [])
      .map((item) => [item.id, item.name]));
    return selectedIds.map((classId) => ({
      classId,
      classIds: [classId],
      className: classNameById.get(classId) || '',
      usePageClassFilter: true,
    }));
  }

  function matchesCourseClassFilter(topic, classIdSet) {
    if (!classIdSet || !classIdSet.size) return true;
    // 课程级话题（来源：全部班级 / 教师导学）对所有班级可见：选了班也应该看到它，
    // 它只是没有自己的班号而已，不能因为班号对不上就被丢掉。
    if (topic && topic.courseLevel === true) return true;
    const id = normalizeCourseClassId(topic && topic.classId);
    if (id && classIdSet.has(id)) return true;
    if (topic && topic.className && Array.isArray(state.classOptions)) {
      if (topic.className.includes('、')) return false;
      const selectedNames = state.classOptions
        .filter(c => classIdSet.has(c.id))
        .map(c => c.name);
      if (selectedNames.some(name => name === topic.className)) {
        return true;
      }
    }
    return false;
  }

  // 列表里每条话题旁边的数字（div.comment span）是平台按「全课程」统计的回复数。
  // 采集是按班进行的，两者天然可能不等——留一个对照值，而不是假装两个数字一致。
  function readPlatformReplyCount(node) {
    const raw = queryFirstText(node, ['.comment span', '.topic_interactive .comment span', '.comment']);
    const digits = cleanText(raw).replace(/[^\d]/g, '');
    if (!digits) return null; // 没有这个节点时不能把空字符串读成 0 条回复
    const count = Number(digits);
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  function courseTopicFromNode(node, options) {
    if (!node || (!(options && options.includeTeacherTopics) && isTeacherCourseTopic(node))) return null;
    const detailUrl = getCourseTopicDetailUrl(node);
    const uuid = getCourseTopicUuid(node);
    const title = limitText(sanitizeTopicTitleText(queryFirstText(node, COURSE_TOPIC_TITLE_SELECTORS)), 180);
    const author = extractCourseTopicAuthor(node);
    const classInfo = extractCourseTopicClassInfo(node);
    if(!classInfo.classId && options?.includeTeacherTopics && isTeacherCourseTopic(node)){
      const currentClass=getCurrentCourseTopicFrameClassId();
      if(normalizeCourseClassFilter(options).has(currentClass))classInfo.classId=currentClass;
    }
    // 话题自己的班号（行上的 tags="classId<班号>"）才是「这条话题属于哪个班」的依据；
    // collectedClassId 只表示「这次是从哪个班的页面读到的」，留作备查，不能覆盖话题自己的班号。
    const collectedClassId = normalizeCourseClassId(options && options.collectedClassId);
    const contentFromChild = sanitizeCourseTopicContent(queryFirstText(node, COURSE_TOPIC_CONTENT_SELECTORS));
    const content = contentFromChild || stripCourseTopicMetadata(getNodeText(node), title, author);
    if (!isUsefulCourseTopicText(title) && !isUsefulCourseTopicText(content)) return null;
    const topic = {
      ...getRecordMetadata(node),
      author,
      time: '',
      title,
      content,
      classId: classInfo.classId || (classInfo.courseLevel && !classInfo.teacherTopic ? '' : collectedClassId),
      className: classInfo.className,
      collectedClassId,
      domClassId: classInfo.classId,
      ...(classInfo.courseLevel ? { courseLevel: true } : {}),
      source: 'chaoxing-course-topic',
      uuid,
      detailUrl,
      uniqueKey: uuid ? `uuid:${uuid}` : (getCourseTopicNodeKey(node) || compactText(`${title}\n${content}`)),
    };
    const resolved = courseTopicFromRuntimeData(getRuntimeCourseTopicData(uuid), topic) || topic;
    const platformReplyCount = readPlatformReplyCount(node);
    if (Number.isInteger(platformReplyCount)) resolved.platformReplyCount = platformReplyCount;
    if (isTeacherCourseTopic(node)) {
      topic.role = 'teacher';
      resolved.role = 'teacher';
    }
    if (collectedClassId) {
      resolved.collectedClassId = collectedClassId;
      // 话题自己有班号就听话题的；「教师导学」这类按班分区但没有自己班号的话题退回本次采集班，
      // 而「来源：全部班级」的课程级话题不盖章：它不属于任何一个班，回复里各自带自己的班号。
      if (!normalizeCourseClassId(resolved.classId) && (!classInfo.courseLevel || classInfo.teacherTopic)) resolved.classId = collectedClassId;
    }
    if (classInfo.courseLevel) {
      resolved.courseLevel = true;
      if (!normalizeCourseClassName(resolved.className)) resolved.className = '全部班级';
    }
    return resolved;
  }

  function uniqueCourseTopics(topics) {
    const seen = new Set();
    const result = [];
    for (const topic of topics || []) {
      if (!topic) continue;
      const title = limitText(sanitizeTopicTitleText(topic.title), 180);
      const content = sanitizeCourseTopicContent(topic.content);
      if (!isUsefulCourseTopicText(title) && !isUsefulCourseTopicText(content)) continue;
      if (isRosterLikeAdminContent(`${title}\n${content}`)) continue;
      const key = cleanText(topic.uniqueKey) || compactText(`${title}\n${content}`);
      // 归属只看话题自己的班号（行上的 tags="classId<班号>"）：选了哪几个班就只分析哪几个班的话题，
      // collectedClassId 只表示「这次从哪个班的页面读到」。课程级话题没有自己的班号，
      // 去重键里也不带浏览班，否则同一个课程级话题会被记成好几条。
      const collectedClassId = normalizeCourseClassId(topic.collectedClassId);
      const topicClassId = normalizeCourseClassId(topic.classId);
      const dedupeKey = `${key}@${topicClassId}`;
      if (!key || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      result.push({
        ...topic,
        author: cleanText(topic.author),
        time: '',
        title,
        content,
        classId: topicClassId,
        collectedClassId,
        className: normalizeCourseClassName(topic.className),
        source: cleanText(topic.source) || 'chaoxing-course-topic',
        uuid: cleanText(topic.uuid),
        detailUrl: normalizeCourseTopicDetailUrl(topic.detailUrl),
        uniqueKey: key,
      });
    }
    return result;
  }

  // 列表「翻页进度」要看页面上真实加载出来的行数，不能看班级筛选后的条数：
  // 点了「点击加载更多」后新增的 20 条可能全属于别的班级，筛选后一条都没多——
  // 那是「这一页跟我这个班无关」，不是「列表到底了」。按筛选后的数字判断会提前收工，
  // 采集到的话题数就会远小于平台写的「共 N 条话题」。
  function countCourseTopicRowsInDocs(docs) {
    let rows = 0;
    for (const doc of docs || []) {
      const seenNodes = new Set();
      for (const selector of COURSE_TOPIC_SELECTORS) {
        for (const node of queryAllNodes(doc, selector)) {
          if (!node || seenNodes.has(node)) continue;
          seenNodes.add(node);
          rows += 1;
        }
      }
    }
    return rows;
  }

  function extractCourseStudentTopicsFromDocs(docs, options) {
    const nodes = [];
    const seenNodes = new Set();
    const classIdSet = normalizeCourseClassFilter(options);
    for (const doc of docs || []) {
      for (const selector of COURSE_TOPIC_SELECTORS) {
        for (const node of queryAllNodes(doc, selector)) {
          if (!node || seenNodes.has(node)) continue;
          seenNodes.add(node);
          nodes.push(node);
        }
      }
    }
    return uniqueCourseTopics(nodes.map(node => courseTopicFromNode(node,options)).filter(Boolean))
      .filter((topic) => matchesCourseClassFilter(topic, classIdSet));
  }

  // 课程话题列表接口（getTopicList）是「整个课程」的列表：请求里没有 clazzid，
  // 返回按最后回复时间倒序的话题，每条带 tags="classId<班号>"、reply_count（课程级回复数）
  // 和 quoteInfo.classReplyCount（分班回复数）。
  // 讨论页本身只渲染「当前正在浏览的那个班」的行（客户端按班过滤），所以只要选了不止一个班，
  // DOM 里根本没有别的班的话题——这就是「选了 3 个班却只采到 1 个班」的原因，必须走这个接口。
  function buildCourseTopicListUrl(page, cursor, tag) {
    const context = resolveCourseTopicListContext();
    if (!context.bbsid || !context.courseId) return '';
    const params = new URLSearchParams({
      folder_uuid: '',
      page: String(Math.max(1, Number(page) || 1)),
      pageSize: '20',
      kw: '',
      courseId: context.courseId,
      isSetTop: '',
      selectedStartTime: '',
      selectedEndTime: '',
      selectedType: '0',
      learnSilverStartTime: '',
      learnSilverEndTime: '',
      lastAuxValue: '',
      last_reply_time: cleanText(cursor || ''),
    });
    // tags=classId<班号> 是服务端过滤：不带它的话这个接口按最后回复时间返回整门课的话题，
    // 实测前 200 条全是别的班，翻到所选班级要几百页。课程级「全部班级」话题用 classId0000001 取。
    const suffix = cleanText(tag) ? `&tags=${encodeURIComponent(cleanText(tag))}` : '';
    return `${getCourseTopicBaseUrl()}/course/topic/${encodeURIComponent(context.bbsid)}/getTopicList?${params.toString()}${suffix}`;
  }

  function courseTopicClassReplyCounts(item) {
    const raw = item && item.quoteInfo && item.quoteInfo.classReplyCount;
    if (!raw || typeof raw !== 'object') return null;
    const counts = {};
    for (const [key, value] of Object.entries(raw)) {
      const classId = normalizeCourseClassId(key);
      const count = Number.parseInt(cleanText(value), 10);
      if (classId && Number.isInteger(count) && count >= 0) counts[classId] = count;
    }
    return Object.keys(counts).length ? counts : null;
  }

  function parseCourseTopicListPayload(payload) {
    let data = payload;
    if (typeof payload === 'string') {
      try { data = JSON.parse(payload); } catch (error) { return null; }
    }
    if (!data || typeof data !== 'object' || data.status===false || data.success===false) return null;
    const poff = data.poff && typeof data.poff === 'object' ? data.poff : {};
    // 超星的成功空末页可能不带 datas；只接受明确成功且明确结束的响应。
    const emptyTerminal=data.datas===undefined&&(data.status===true||data.success===true)&&cleanText(poff.lastPage)==='1';
    if(!Array.isArray(data.datas)&&!emptyTerminal)return null;
    const rows=Array.isArray(data.datas)?data.datas:[];
    const topics = rows.map((item) => {
      const mapped = courseTopicFromDetailData(item, 'chaoxing-course-topic-list');
      if (!mapped) return null;
      const replyCount = Number.parseInt(cleanText(item.reply_count || item.s_replycount || ''), 10);
      const lastReply=typeof item.lastReply==='object'?item.lastReply?.time:item.lastReply;
      const lastReplyAt=[lastReply,item.topicReplyTime,item.last_reply_time].find(value=>value&&CaptureScope?.stamp(value)!==null);
      return {
        ...mapped,
        platformId: cleanText(item.id || mapped.platformId),
        ...(Number.isInteger(replyCount) ? { platformReplyCount: replyCount, replyCount } : {}),
        ...(courseTopicClassReplyCounts(item) ? { classReplyCounts: courseTopicClassReplyCounts(item) } : {}),
        ...(lastReplyAt ? { lastReplyAt: cleanText(lastReplyAt) } : {}),
        source: 'chaoxing-course-topic-list',
      };
    }).filter(Boolean);
    return {
      topics,
      lastPage: cleanText(poff.lastPage) === '1',
      cursor: cleanText(poff.lastValue || poff.last_reply_time || ''),
      rawCount: rows.length,
    };
  }

  // 按所选班级翻课程话题列表：只保留「话题自己的班在所选范围内」的话题 + 课程级话题（全部班级可见）。
  async function fetchCourseTopicListTopics(options) {
    const classIdSet = normalizeCourseClassFilter(options);
    const maxTopics = Math.max(0, Number(options && options.maxTopics) || 0);
    const pageCap = Math.max(1, Math.min(400, Number(options && options.maxPages) || 120));
    const collected = new Map();
    let pages = 0;
    let reachedEnd = false;
    let truncatedByLimit = false;
    let reason = '';
    const debug = [];
    const listContext = resolveCourseTopicListContext();
    if (listContext.source) debug.push({ tag: 'context', source: listContext.source });
    // 每个所选班一条游标队列（tags=classId<班号>），课程级「全部班级」话题另起一条。
    const queues = [];
    for (const classId of classIdSet) queues.push({ tag: `classId${classId}`, classId, cursor: '', lastPage: false });
    if(classIdSet.size)queues.push({ tag: 'classId0000001', classId: '', cursor: '', lastPage: false });
    else queues.push({tag:'',classId:'',cursor:'',lastPage:false});
    const limitReached = () => maxTopics > 0 && collected.size >= maxTopics;
    for (let round = 1; round <= pageCap && !reason && queues.some((queue) => !queue.lastPage); round += 1) {
      for (const queue of queues) {
        if (queue.lastPage || limitReached() || reason) continue;
        const url = buildCourseTopicListUrl(1, queue.cursor, queue.tag);
        if (!url) {
          const context = resolveCourseTopicListContext();
          reason = `课程话题列表接口地址没有拼出来（${context.bbsid ? 'bbsid 已读到' : '页面里没有 bbsid'}、${context.courseId ? 'courseId 已读到' : '页面里没有 courseId'}）`;
          break;
        }
        if (!pages) debug.push({ tag: queue.tag, url: url.slice(0, 200) });
        const text = await fetchText(url);
        const payload = parseCourseTopicListPayload(text);
        if (!payload) { reason = `课程话题列表接口第 ${pages + 1} 页没有返回可用数据（响应 ${String(text || '').length} 字节）`; break; }
        pages += 1;
        let kept = 0;
        for (const topic of payload.topics) {
          if (classIdSet.size) {
            const topicClassId = normalizeCourseClassId(topic.classId);
            const visible = topic.courseLevel === true || (topicClassId && classIdSet.has(topicClassId));
            if (!visible) continue;
          }
          if(scopedCapture(options)&&CaptureScope.topicRelevant(topic,options.captureScope)===false)continue;
          const key = cleanText(topic.uniqueKey) || compactText(`${topic.title}\n${topic.content}`);
          if (!key || collected.has(key)) continue;
          // 列表能通过页面资源找到课程讨论区，但单条数据未必再带这个字段。
          // 将同一列表请求的上下文带入详情，全部时段采集也能继续请求回复。
          collected.set(key, {...topic,bbsid:topic.bbsid||listContext.bbsid});
          kept += 1;
        }
        debug.push({ tag: queue.tag, page: round, got: payload.topics.length, raw: payload.rawCount, kept });
        const activity=payload.topics.map(t=>CaptureScope?.stamp(t.lastReplyAt));
        const ordered=activity.length&&activity.every((t,i)=>t!==null&&(!i||t<=activity[i-1]))&&(queue.lastStamp==null||activity[0]<=queue.lastStamp);
        if(ordered)queue.lastStamp=activity[activity.length-1];
        if(scopedCapture(options)&&ordered&&CaptureScope.canStopTopics(payload.topics,options.captureScope)){queue.lastPage=true;queue.timeBoundary=true;}
        else if (payload.lastPage) queue.lastPage = true;
        else if (payload.cursor && payload.cursor !== queue.cursor) queue.cursor = payload.cursor;
        else {reason=payload.cursor?'课程话题列表游标没有推进，未确认读取结束':'课程话题列表未返回分页游标，未确认读取结束';break;}
        await sleep(TEST_MODE ? 0 : 60);
      }
      if (limitReached()) { truncatedByLimit = true; break; }
    }
    if (queues.every((queue) => queue.lastPage)) reachedEnd = true;
    const topics = Array.from(collected.values());
    return {
      topics: maxTopics > 0 ? topics.slice(0, maxTopics) : topics,
      pages,
      reachedEnd,
      truncatedByLimit,
      courseTotal: topics.length,
      reason,
      timeBoundary:queues.some(q=>q.timeBoundary),
      debug: debug.slice(0, 8),
    };
  }

  function sanitizeTopicContextText(value, titleToRemove) {
    const title = cleanText(titleToRemove);
    return sanitizeCommentContent(value)
      .split('\n')
      .map((line) => cleanText(line).replace(/^(标题|题目|老师提问|教师提问|问题|讨论引导)\s*[:：]\s*/, ''))
      .map((line) => {
        if (!title) return line;
        const normalizedLine = line.replace(/\s+/g, '');
        const normalizedTitle = title.replace(/\s+/g, '');
        if (normalizedLine === normalizedTitle || normalizedLine === `${normalizedTitle}精`) return '';
        return line;
      })
      .filter((line) => line && !isMetadataLine(line))
      .join('\n');
  }

  function sanitizeTopicTitleText(value) {
    return sanitizeTopicContextText(value)
      .replace(/\s+(精|置顶|推荐)\s*$/g, '')
      .replace(/(精|置顶|推荐)\s*$/g, '')
      .trim();
  }

  function isMeaningfulTopicContextText(text, kind) {
    const value = cleanText(text);
    if (!value) return false;
    if (/^(无标题|暂无标题|未命名|标题|题目)$/.test(value)) return false;
    if (/^(回复|评论|讨论回复|共\s*\d+\+?\s*条回复|阅读\s*\d+\+?)$/.test(value)) return false;
    if (kind === 'title' && value.length > 160) return false;
    if (isRosterLikeAdminContent(value)) return false;
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(value)) return false;
    return true;
  }

  function normalizeTopicContext(context) {
    const source = context || {};
    const title = sanitizeTopicTitleText(source.title);
    const question = sanitizeTopicContextText(source.question, title);
    return {
      title: isMeaningfulTopicContextText(title, 'title') ? limitText(title, 160) : '',
      question: isMeaningfulTopicContextText(question, 'question') ? limitText(question, 1200) : '',
    };
  }

  function pickTopicText(root, selectors, kind, context) {
    const title = context && context.title ? context.title : '';
    for (const selector of selectors) {
      for (const node of queryAllNodes(root, selector)) {
        const rawText = getContentNodeText(node) || getNodeText(node);
        const text = kind === 'title' ? sanitizeTopicTitleText(rawText) : sanitizeTopicContextText(rawText, title);
        if (isMeaningfulTopicContextText(text, kind)) return text;
      }
    }
    return '';
  }

  function extractTopicContextFromDoc(doc) {
    if (!doc) return { title: '', question: '' };
    const root = queryOne(doc, ['#bbsTopicDetail', '.topicDetail_detail']) || doc;
    const title = pickTopicText(root, [
      '.topicDetail_title_empty',
      '.topicDetail_title',
      '.topicTitle',
      '.topic-title',
      '[class*="topicDetail_title"]',
      '[class*="topicTitle"]',
    ], 'title');
    const question = pickTopicText(root, [
      '.topicDetail_main .richText',
      '.topicDetail_detail .richText',
      '.topicDetail_content',
      '.topicDetail_text',
      '.topicDetail_main',
      '.richText',
      '.richtext',
      '[class*="richText"]',
      '[class*="richtext"]',
      '.topicContent',
      '.topic-content',
      '#topicContent',
      '[id*="topicContent"]',
      '[class*="topicContent"]',
      '[class*="TopicContent"]',
      '[class*="topicDetail_content"]',
      '[class*="detailContent"]',
    ], 'question', { title });
    return normalizeTopicContext({ title, question });
  }

  function mergeTopicContext(current, next) {
    const base = normalizeTopicContext(current);
    const incoming = normalizeTopicContext(next);
    return {
      title: base.title || incoming.title,
      question: base.question || incoming.question,
    };
  }

  function extractTopicContextFromDocs(docs) {
    let context = { title: '', question: '' };
    for (const doc of docs || []) {
      context = mergeTopicContext(context, extractTopicContextFromDoc(doc));
      if (context.title && context.question) break;
    }
    return context;
  }

  function parseReplyCountText(text) {
    const value = cleanText(text);
    const match = value.match(/共\s*(\d+)\s*(\+?)\s*条回复/) || value.match(/(\d+)\s*(\+?)\s*条回复/);
    if (!match) return null;
    return { total: Number(match[1]), exact: match[2] !== '+' };
  }

  function betterReplyInfo(current, next) {
    if (!next || !next.total) return current || { total: 0, exact: false };
    if (!current || !current.total) return next;
    if (next.total > current.total) return next;
    if (next.total === current.total && next.exact && !current.exact) return next;
    return current;
  }

  function getExpectedReplyInfoFromDocs(docs) {
    let best = { total: 0, exact: false };
    for (const doc of docs || []) {
      const nodes = queryAllNodes(doc, '.classReplyCount, [class*="replyTitle"], [class*="ReplyTitle"], [class*="replyCount"], [class*="ReplyCount"]');
      for (const node of nodes) best = betterReplyInfo(best, parseReplyCountText(getNodeText(node)));
    }
    return best;
  }

  function getAllSameOriginDocs(startDocument) {
    const docs = [];
    const seen = new Set();
    function walk(doc) {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      docs.push(doc);
      let frames = [];
      try { frames = Array.from(doc.querySelectorAll('iframe') || []); } catch (error) { return; }
      for (const frame of frames) {
        try { if (frame.contentDocument) walk(frame.contentDocument); } catch (error) { }
      }
    }
    walk(startDocument || document);
    return docs;
  }

  function mergeComments(docs) {
    const sourceDocs = docs || getAllSameOriginDocs(document);
    const rawInfo = getRawLoadedReplyInfoFromDocs(sourceDocs);
    state.rawLoadedCount = rawInfo.count;
    state.topicContext = mergeTopicContext(state.topicContext, extractTopicContextFromDocs(sourceDocs));
    const domComments = extractCommentsFromDocs(sourceDocs);
    const supplementalComments = rawInfo.hasChaoxingStructure ? [] : state.networkComments;
    state.comments = uniqueComments([...state.comments, ...domComments, ...supplementalComments]);
    return state.comments;
  }

  function mergeCourseTopics(docs, options) {
    const sourceDocs = docs || getAllSameOriginDocs(document);
    const domTopics = extractCourseStudentTopicsFromDocs(sourceDocs, options);
    state.comments = uniqueCourseTopics([...state.comments, ...domTopics]);
    state.rawLoadedCount = state.comments.length;
    state.analysisMode = 'courseTopics';
    return state.comments;
  }

  function getCurrentCourseTopicFrameClassId() {
    try {
      const parsed = new URL(currentLocation.href || '');
      return normalizeCourseClassId(parsed.searchParams.get('clazzid'));
    } catch (error) {
      return normalizeCourseClassId(String(currentLocation.href || ''));
    }
  }

  function pickField(object, names) {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(object, name) && object[name] != null) {
        const value = object[name];
        if (typeof value === 'string' || typeof value === 'number') return cleanText(value);
      }
    }
    return '';
  }

  function collectCommentsFromJson(value, sourceUrl, out, depth) {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) collectCommentsFromJson(item, sourceUrl, out, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;

    const content = pickField(value, ['content', 'replyContent', 'commentContent', 'discussContent', 'message', 'msg', 'text', 'body', 'description', 'detail']);
    if (isUsefulCommentText(content) && !isNoiseText(content) && /[\u4e00-\u9fa5A-Za-z0-9]{4,}/.test(content)) {
      out.push({
        author: pickField(value, ['author', 'authorName', 'userName', 'username', 'nickName', 'nickname', 'name', 'createName']),
        time: '',
        content: sanitizeCommentContent(content),
        source: sourceUrl,
      });
    }

    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === 'object') collectCommentsFromJson(child, sourceUrl, out, depth + 1);
    }
  }

  function processNetworkResponse(url, text) {
    if (!text || text.length > 2000000) return;
    const suspicious = /(comment|reply|discuss|topic|bbs|forum|message|group|circle|note)/i.test(String(url || ''))
      || /(comment|reply|discuss|topic|bbs|message)/i.test(String(text).slice(0, 500));
    if (!suspicious) return;
    try {
      const json = JSON.parse(text);
      const found = [];
      collectCommentsFromJson(json, url, found, 0);
      state.networkComments = uniqueComments([...state.networkComments, ...found]).slice(-1000);
    } catch (error) { }
  }

  function installNetworkObservers() {
    try {
      const originalFetch = window.fetch;
      if (typeof originalFetch === 'function' && !originalFetch.__cxDiscussionSummaryWrapped) {
        const wrappedFetch = function (...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          return originalFetch.apply(this, args).then((response) => {
            try { response.clone().text().then((text) => processNetworkResponse(url || response.url, text)).catch(() => {}); } catch (error) { }
            return response;
          });
        };
        wrappedFetch.__cxDiscussionSummaryWrapped = true;
        window.fetch = wrappedFetch;
      }
    } catch (error) { }

    try {
      const XHR = window.XMLHttpRequest;
      if (!XHR || XHR.prototype.__cxDiscussionSummaryWrapped) return;
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__cxDiscussionSummaryUrl = url;
        return originalOpen.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        this.addEventListener('load', () => {
          try { processNetworkResponse(this.__cxDiscussionSummaryUrl || this.responseURL, this.responseText); } catch (error) { }
        });
        return originalSend.apply(this, arguments);
      };
      XHR.prototype.__cxDiscussionSummaryWrapped = true;
    } catch (error) { }
  }

  async function sleep(ms) { await collectionGate();await new Promise((resolve) => setTimeout(resolve, ms));await collectionGate(); }

  function isVisibleElement(node) {
    if (!node) return false;
    try {
      const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
    } catch (error) { }
    return true;
  }

  function findLoadMoreCandidateInDoc(doc) {
    const selectorGroups = ['.loadText', '.prevComment', '.nextPage', '.loadMore p', '.loadMore', 'button', 'a', 'span', 'p', 'div'];
    for (const selector of selectorGroups) {
      let elements = [];
      try { elements = Array.from(doc.querySelectorAll(selector) || []); } catch (error) { continue; }
      for (const node of elements) {
        const text = cleanText(node.innerText || node.textContent || '').toLowerCase();
        if (!text || text.length > 30) continue;
        if (text.includes('已经到底了')) continue;
        if (!LOAD_MORE_TEXTS.some((word) => text.includes(word.toLowerCase()))) continue;
        if (!isVisibleElement(node)) continue;
        return { node, text: cleanText(node.innerText || node.textContent || '') };
      }
    }
    return null;
  }

  function clickLoadMoreInDoc(doc) {
    const candidate = findLoadMoreCandidateInDoc(doc);
    if (!candidate) return false;
    try {
      if (typeof candidate.node.scrollIntoView === 'function') candidate.node.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (error) { }
    try { candidate.node.click(); return true; } catch (error) { }
    try {
      if (candidate.node.parentElement && typeof candidate.node.parentElement.click === 'function') {
        candidate.node.parentElement.click();
        return true;
      }
    } catch (error) { }
    return false;
  }

  function getLoadMoreStateFromDoc(doc) {
    const loadMoreNode = queryOne(doc, ['.loadMore']);
    const loadTextNode = queryOne(doc, ['.loadText']);
    const endTextNode = queryOne(doc, ['.loadEndText']);
    const candidate = findLoadMoreCandidateInDoc(doc);
    const visibleText = cleanText(getNodeText(loadMoreNode) || getNodeText(loadTextNode) || getNodeText(endTextNode) || (candidate && candidate.text) || '');
    const endText = endTextNode && isVisibleElement(endTextNode) ? cleanText(getNodeText(endTextNode)) : '';
    const hasControl = !!(loadMoreNode || loadTextNode || candidate || endTextNode);
    const reachedEnd = /已经到底了|没有更多了|暂无更多|已加载全部/.test(visibleText) || /已经到底了|没有更多了|暂无更多|已加载全部/.test(endText);
    const loading = /正在加载|加载中|请稍候|loading/i.test(visibleText);
    return { hasControl, reachedEnd, loading, text: visibleText || endText };
  }

  function getLoadMoreStateFromDocs(docs) {
    let hasControl = false;
    let reachedEnd = true;
    let loading = false;
    let text = '';
    for (const doc of docs || []) {
      const state = getLoadMoreStateFromDoc(doc);
      if (!state.hasControl) continue;
      hasControl = true;
      reachedEnd = reachedEnd && state.reachedEnd;
      loading = loading || !!state.loading;
      if (!text && state.text) text = state.text;
    }
    return { hasControl, reachedEnd: hasControl && reachedEnd, loading, text };
  }

  async function waitForReplyLoadProgress(previousRawLoadedCount, timeoutMs) {
    const startedAt = Date.now();
    let bestCount = previousRawLoadedCount;
    let stableRounds = 0;
    while (Date.now() - startedAt < (timeoutMs || 6000)) {
      await sleep(350);
      const docs = getAllSameOriginDocs(document);
      const rawInfo = getRawLoadedReplyInfoFromDocs(docs);
      const loadMoreState = getLoadMoreStateFromDocs(docs);
      if (rawInfo.count > bestCount) {
        bestCount = rawInfo.count;
        stableRounds = 0;
        continue;
      }
      if (loadMoreState.reachedEnd) return { docs, rawInfo, loadMoreState };
      if (loadMoreState.loading) {
        stableRounds = 0;
        continue;
      }
      stableRounds += 1;
      if (stableRounds >= 8) return { docs, rawInfo, loadMoreState };
    }
    const docs = getAllSameOriginDocs(document);
    return { docs, rawInfo: getRawLoadedReplyInfoFromDocs(docs), loadMoreState: getLoadMoreStateFromDocs(docs) };
  }

  function getScrollableTargets(doc) {
    const targets = [];
    const root = doc.scrollingElement || doc.documentElement || doc.body;
    if (root) targets.push({ kind: 'root', node: root, doc });
    const candidates = queryAllNodes(doc, 'div,section,main,ul,ol,[class*="list"],[class*="List"],[class*="reply"],[class*="Reply"],[class*="comment"],[class*="Comment"]');
    for (const node of candidates) {
      try {
        const scrollHeight = Number(node.scrollHeight || 0);
        const clientHeight = Number(node.clientHeight || 0);
        if (scrollHeight > clientHeight + 80) targets.push({ kind: 'element', node, doc });
      } catch (error) { }
    }
    return targets;
  }

  function scrollTarget(target) {
    try {
      const node = target.node;
      const maxTop = Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
      const before = Number(node.scrollTop || 0);
      const step = Math.max(700, Math.floor(Number(node.clientHeight || 0) * 0.9));
      const nextTop = maxTop ? Math.min(maxTop, before + step) : before + step;
      if (target.kind === 'root') {
        const win = target.doc.defaultView || window;
        if (win && typeof win.scrollTo === 'function') win.scrollTo(0, nextTop);
        else node.scrollTop = nextTop;
      } else {
        node.scrollTop = nextTop;
      }
      return nextTop > before;
    } catch (error) {
      return false;
    }
  }

  function scrollDoc(doc) {
    let moved = false;
    for (const target of getScrollableTargets(doc)) moved = scrollTarget(target) || moved;
    return moved;
  }

  function shouldStopCollecting({ round, stableRounds, rawLoadedCount, expectedReplyInfo, loadMoreState }) {
    if (loadMoreState && loadMoreState.hasControl) return !!loadMoreState.reachedEnd;
    const info = expectedReplyInfo || { total: 0, exact: false };
    if (info.total > 0 && info.exact) return rawLoadedCount >= info.total;
    if (info.total > 0 && !info.exact && rawLoadedCount < info.total) return false;
    return round + 1 >= MIN_COLLECTION_ROUNDS && stableRounds >= COLLECTION_STABLE_ROUNDS_TO_STOP;
  }

  function shouldStopCourseTopicCollection({ round, stableRounds, loadMoreState }) {
    if (loadMoreState && loadMoreState.hasControl && loadMoreState.reachedEnd) return true;
    return round + 1 >= MIN_COLLECTION_ROUNDS && stableRounds >= COLLECTION_STABLE_ROUNDS_TO_STOP;
  }

  function formatCollectionStatus({ rawLoadedCount, validCount, expectedReplyInfo }) {
    const info = expectedReplyInfo || { total: 0, exact: false };
    const loadedText = info.total ? `${rawLoadedCount}/${info.exact ? info.total : `${info.total}+`}` : String(rawLoadedCount);
    return `正在深度搜索回复...已加载 ${loadedText}，采集正文 ${validCount} 条`;
  }

  function getUrlParam(url, name) {
    try {
      const parsed = new URL(String(url || ''), currentLocation.href || undefined);
      return cleanText(parsed.searchParams.get(name) || '');
    } catch (error) {
      return '';
    }
  }

  function getCourseTopicBaseUrl() {
    return cleanText(rootWindow.$ctx || 'https://groupweb.chaoxing.com') || 'https://groupweb.chaoxing.com';
  }

  function getCourseTopicUuidFromInput(topicOrUuid) {
    const directUrl = typeof topicOrUuid === 'object' ? normalizeCourseTopicDetailUrl(topicOrUuid && topicOrUuid.detailUrl) : '';
    const parts = parseCourseTopicDetailUrlParts(directUrl);
    return stripCourseTopicDiscussSuffix((parts && parts.uuid) || (typeof topicOrUuid === 'object' ? topicOrUuid && topicOrUuid.uuid : topicOrUuid));
  }

  function getCourseTopicDetailContext(topicOrUuid) {
    const directUrl = typeof topicOrUuid === 'object' ? normalizeCourseTopicDetailUrl(topicOrUuid && topicOrUuid.detailUrl) : '';
    const directParts = parseCourseTopicDetailUrlParts(directUrl);
    const discuss = rootWindow.Discuss || {};
    const uuid = getCourseTopicUuidFromInput(topicOrUuid);
    return {
      directUrl,
      bbsid: cleanText((directParts && directParts.bbsid) || (topicOrUuid && topicOrUuid.bbsid) || (discuss.circle && discuss.circle.bbsid) || discuss.bbsid || getUrlParam(currentLocation.href, 'bbsid')),
      uuid,
      // 去后缀的 uuid 用来认同一话题；请求回复必须保留平台地址里的 _topicDiscuss。
      requestUuid: cleanText(directParts?.requestUuid || (typeof topicOrUuid === 'object' ? topicOrUuid?.uuid : topicOrUuid)),
      courseId: cleanText(discuss.courseId || getUrlParam(currentLocation.href, 'courseid') || getUrlParam(currentLocation.href, 'courseId')),
      classId: cleanText(discuss.classId || getUrlParam(currentLocation.href, 'clazzid') || getUrlParam(currentLocation.href, 'classId')),
      cpi: cleanText(discuss.cpi || getUrlParam(currentLocation.href, 'cpi')),
      knowledgeEnc: cleanText((typeof discuss.getUrlParam === 'function' && discuss.getUrlParam(currentLocation.href, 'knowledgeEnc')) || getUrlParam(currentLocation.href, 'knowledgeEnc')),
    };
  }

  // 课程话题列表接口的地址需要 bbsid + courseId。真机上这个采集有时跑在课程页的 iframe 里：
  // 那时 rootWindow.Discuss 读不到，地址栏参数也可能没有（内嵌页面只带 courseid 或什么都不带），
  // 于是接口地址拼不出来、静默退回 DOM 列表（实测就是这样退回去的）。
  // 兜底顺序：页面上下文 → 地址栏参数 → 页面自己发过的请求（performance resource）→ 文档 HTML 里的 bbsid 字面量。
  function resolveCourseTopicListContext() {
    const context = getCourseTopicDetailContext({});
    if (context.bbsid && context.courseId) return { bbsid: context.bbsid, courseId: context.courseId, source: 'page-context' };
    let resourceBbsid = '';
    let resourceCourseId = '';
    try {
      const entries = rootWindow.performance && typeof rootWindow.performance.getEntriesByType === 'function' ? rootWindow.performance.getEntriesByType('resource') : [];
      for (const entry of entries) {
        const url = cleanText(entry && entry.name);
        if (!url) continue;
        if (!resourceBbsid) {
          const bbsidMatch = url.match(/\/course\/topic\/([A-Za-z0-9_-]{6,64})\//);
          if (bbsidMatch) resourceBbsid = bbsidMatch[1];
        }
        if (!resourceCourseId) {
          const courseMatch = url.match(/[?&]courseId=(\d{4,})/i);
          if (courseMatch) resourceCourseId = courseMatch[1];
        }
        if (resourceBbsid && resourceCourseId) break;
      }
    } catch (error) { /* performance 不可用时继续往下兜底 */ }
    let htmlBbsid = '';
    if (!resourceBbsid) {
      try {
        const html = cleanText(rootWindow.document && rootWindow.document.documentElement && rootWindow.document.documentElement.innerHTML);
        const match = html.match(/bbsid["'\s:=]+([A-Za-z0-9_-]{6,64})/i);
        if (match) htmlBbsid = match[1];
      } catch (error) { /* 跨域 iframe 读不到 HTML 时忽略 */ }
    }
    const bbsid = cleanText(context.bbsid || resourceBbsid || htmlBbsid);
    const courseId = cleanText(context.courseId || resourceCourseId);
    return { bbsid, courseId, source: bbsid && courseId ? 'page-fallback' : '' };
  }

  function getCourseTopicUuidVariants(uuid) {
    const strippedUuid = stripCourseTopicDiscussSuffix(uuid);
    return Array.from(new Set([strippedUuid, strippedUuid ? `${strippedUuid}_topicDiscuss` : ''].map(cleanText).filter(Boolean)));
  }

  function buildCourseTopicDetailUrls(topicOrUuid) {
    const context = getCourseTopicDetailContext(topicOrUuid);
    const variants = Array.from(new Set([context.requestUuid,...getCourseTopicUuidVariants(context.uuid)].filter(Boolean)));
    if (!variants.length) return [];
    try {
      if (context.directUrl) {
        const parsed = new URL(context.directUrl, currentLocation.href || undefined);
        const match = parsed.pathname.match(/^(.*\/course\/topic\/v3\/bbs\/[^/]+\/)([^/]+)(\/replysList.*)$/i);
        if (match) {
          return variants.map((topicUuid) => {
            const next = new URL(parsed.href);
            next.pathname = `${match[1]}${encodeURIComponent(topicUuid)}${match[3]}`;
            return normalizeCourseTopicDetailUrl(next.href);
          }).filter(Boolean);
        }
        return [context.directUrl];
      }
      if (!context.bbsid || !context.courseId || !context.classId) return [];
      const params = new URLSearchParams({
        courseId: context.courseId,
        classId: context.classId,
        cpi: context.cpi,
        knowledgeEnc: context.knowledgeEnc,
      });
      const base = getCourseTopicBaseUrl();
      return variants
        .map((topicUuid) => normalizeCourseTopicDetailUrl(`${base}/course/topic/v3/bbs/${encodeURIComponent(context.bbsid)}/${encodeURIComponent(topicUuid)}/replysList?${params.toString()}`))
        .filter(Boolean);
    } catch (error) {
      return context.directUrl ? [context.directUrl] : [];
    }
  }

  function buildCourseTopicDetailUrl(topicOrUuid) {
    return buildCourseTopicDetailUrls(topicOrUuid)[0] || '';
  }

  function buildCourseTopicGetTopicUrl(topicOrUuid) {
    const uuid = getCourseTopicUuidFromInput(topicOrUuid);
    if (!uuid) return '';
    return `${getCourseTopicBaseUrl()}/course/topic/${encodeURIComponent(uuid)}/getTopic`;
  }

  function buildCourseTopicTopReplyListUrl(topicOrUuid) {
    const context = getCourseTopicDetailContext(topicOrUuid);
    if (!context.bbsid || !context.uuid) return '';
    const params = new URLSearchParams({
      bbsid: context.bbsid,
      uuid: context.requestUuid || context.uuid,
      order: '2',
      tag: '',
      kw: '',
    });
    if (context.courseId) params.set('courseId', context.courseId);
    if (context.classId) params.set('classId', context.classId);
    if (context.cpi) params.set('cpi', context.cpi);
    if (context.knowledgeEnc) params.set('enc', context.knowledgeEnc);
    return `${getCourseTopicBaseUrl()}/pc/invitation/getTopReplyList?${params.toString()}`;
  }

  // tag 决定回复的班级范围：'' 是这条话题在所有班下的回复（课程级），
  // 'classId<班号>' 只返回那个班的回复。按班分析必须逐个班取，见 fetchCourseTopicReplies。
  function buildCourseTopicReplyListUrl(topicOrUuid, pageState, tag) {
    const context = getCourseTopicDetailContext(topicOrUuid);
    if (!context.bbsid || !context.uuid) return '';
    const stateForPage = pageState || {};
    const tagClassId = courseTopicTagClassId(tag);
    const params = new URLSearchParams({
      bbsid: context.bbsid,
      uuid: context.requestUuid || context.uuid,
      tag: tag == null ? '' : cleanText(tag),
      order: '2',
      lastValue: cleanText(stateForPage.lastValue || ''),
      lastAuxValue: cleanText(stateForPage.lastAuxValue || ''),
    });
    // tag 是回复的班级范围；classId 也跟着它走，不能留下地址栏里切班前的旧班号。
    const requestClassId = tagClassId || context.classId;
    if (context.courseId) params.set('courseId', context.courseId);
    if (requestClassId) params.set('classId', requestClassId);
    if (context.cpi) params.set('cpi', context.cpi);
    if (context.knowledgeEnc) params.set('enc', context.knowledgeEnc);
    return `${getCourseTopicBaseUrl()}/pc/invitation/getReplyList?${params.toString()}`;
  }

  async function fetchText(url) {
    if (!url || typeof rootWindow.fetch !== 'function') return '';
    for (let attempt=0;attempt<2;attempt++) {
      await collectionGate();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(()=>controller.abort(),12000) : null;const activeControl=collectionControl;if(controller)activeControl?.aborters?.add(controller);
      try {
        const response = await rootWindow.fetch(url, { credentials: 'include', ...(controller ? {signal:controller.signal} : {}) });
        if (response && response.ok) return await response.text();
        if (response && response.status && response.status !== 429 && response.status < 500) return '';
      } catch (error) { if(activeControl?.cancelled)throw error; }
      finally { if(timer!==null)clearTimeout(timer);if(controller)activeControl?.aborters?.delete(controller); }
      if(!attempt)await sleep(150);
    }
    return '';
  }

  const courseTeacherContexts=new Map();
  function parseCourseTeacherContext(html) {
    const match=String(html||'').match(/\bmanagers\s*:\s*(\[[\s\S]*?\])/);
    if(!match)return null;
    try{const entries=JSON.parse(match[1]);if(!Array.isArray(entries)||!entries.every(r=>r&&/^\d+$/.test(String(r.puid))))return null;return new Set(entries.map(r=>String(r.puid)));}catch{return null;}
  }
  async function applyCourseRoles(records,topic) {
    const unknown=records.filter(r=>r&&r.role==='unknown'&&r.authorPuid);if(!unknown.length)return;
    let context=null;
    for(const doc of getAllSameOriginDocs(document))for(const script of queryAllNodes(doc,'script')){const parsed=parseCourseTeacherContext(script.textContent||'');if(parsed!==null){context=parsed;break;}}
    if(context===null){
      const key=getCourseTopicDetailContext(topic).bbsid||buildCourseTopicDetailUrls(topic)[0];
      if(!courseTeacherContexts.has(key))courseTeacherContexts.set(key,(async()=>{const url=buildCourseTopicDetailUrls(topic)[0];return url?parseCourseTeacherContext(await fetchText(url)):null;})());
      try{context=await courseTeacherContexts.get(key);}catch(error){courseTeacherContexts.delete(key);throw error;}
    }
    if(context!==null)for(const r of unknown)r.role=context.has(r.authorPuid)?'teacher':'student';
  }
  async function fetchCourseTopicBaseDetail(topic) {
    if(IS_DISCUSSION_PAGE && getCourseTopicUuidFromInput(topic)===getCourseTopicUuidFromInput({detailUrl:currentLocation.href})) {
      for(const script of queryAllNodes(document,'script')) {
        const inline=parseCourseTopicDetailHtml(script.textContent||'');
        if(inline && stripCourseTopicDiscussSuffix(inline.uuid)===getCourseTopicUuidFromInput(topic)){await applyCourseRoles([inline],topic);return inline;}
      }
    }
    const apiText = await fetchText(buildCourseTopicGetTopicUrl(topic));
    const apiDetail = parseCourseTopicDetailPayload(apiText, 'chaoxing-course-topic-get-topic');
    if (apiDetail){await applyCourseRoles([apiDetail],topic);return apiDetail;}
    const urls = buildCourseTopicDetailUrls(topic);
    for (const url of urls) {
      if(!state.detailCollectionActive)setStatus('正在读取话题原文与元数据…','info');
      const detail = parseCourseTopicDetailHtml(await fetchText(url));
      if (detail){await applyCourseRoles([detail],topic);return detail;}
    }
    return null;
  }

  function courseTopicTagClassId(tag) {
    const match = cleanText(tag).match(/classId(\d{5,})/);
    return match ? match[1] : '';
  }

  // 一条话题的回复按班返回：tag='' 会把这条话题在所有班（甚至别的年级）的回复一起给回来。
  // 选了班级时必须逐班取，否则「我选了 3 个班，怎么别的班全送进来分析了」。
  async function fetchCourseTopicReplies(topic, options) {
    if (typeof rootWindow.fetch !== 'function') return [];
    const tagClassIds = [];
    for (const raw of (options && options.tagClassIds) || []) {
      const classId = normalizeCourseClassId(raw);
      if (classId && !tagClassIds.includes(classId)) tagClassIds.push(classId);
    }
    // 列表接口已经给了分班回复数：明确为 0 的班不用再发 getReplyList，
    // 否则空班会被平台返回的空页误判成“回复未采全”。
    const classReplyCounts = (options && options.classReplyCounts) || (topic && topic.classReplyCounts);
    const requestedTagClassIds = [...tagClassIds];
    if (classReplyCounts && typeof classReplyCounts === 'object' && Object.keys(classReplyCounts).length && tagClassIds.length) {
      const active = tagClassIds.filter((classId) => Number(classReplyCounts[classId] || 0) > 0);
      tagClassIds.splice(0, tagClassIds.length, ...active);
    }
    const tags = tagClassIds.length ? tagClassIds.map((classId) => `classId${classId}`) : [''];
    const replies = [];
    replies.collectionComplete = false;
    replies.missingNested = [];
    replies.pages = 0;
    replies.failureReason = '';
    replies.nestedWarning = '';
    if (requestedTagClassIds.length && !tagClassIds.length) {
      replies.collectionComplete = true;
      replies.rootPagesComplete = true;
      replies.taggedClassIds = requestedTagClassIds;
      await applyCourseRoles(replies, topic);
      return replies;
    }
    const seen = new Set();
    const addReplies = (items) => {
      for (const reply of items || []) {
        const key = cleanText(reply && reply.uniqueKey) || compactText(reply && reply.content);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        replies.push(reply);
      }
    };

    // 置顶回复是平台自己的课程级列表，按班采集时不再单独取，避免把别的班的置顶回复混进来。
    const topUrl = tagClassIds.length ? '' : buildCourseTopicTopReplyListUrl(topic);
    const topRequest = topUrl ? fetchText(topUrl).then(parseCourseTopicReplyListPayload).catch(error=>{if(!replies.failureReason)replies.failureReason=error?.message||'置顶回复读取失败';return {valid:false,replies:[],missingNested:[]};}) : Promise.resolve({replies:[],missingNested:[]});

    let allTagsComplete = true;
    for (const tag of tags) {
      const tagClassId = courseTopicTagClassId(tag);
      let pageState = { lastValue: '', lastAuxValue: '' };
      let tagReachedEnd = false;
      for (let page = 0; page < MAX_COURSE_TOPIC_REPLY_PAGES; page += 1) {
        const listUrl = buildCourseTopicReplyListUrl(topic, pageState, tag);
        if (!listUrl) { if(!replies.failureReason)replies.failureReason='缺少话题分页地址'; break; }
        let payload = parseCourseTopicReplyListPayload(await fetchText(listUrl));
        replies.pages++;
        // 平台偶尔会给一个空页或临时无效页，但游标还没结束；同一游标再要一次通常就恢复。
        if (!payload.valid || (!payload.lastPage && !payload.replies.length)) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          const retried = parseCourseTopicReplyListPayload(await fetchText(listUrl));
          replies.pages++;
          if (retried.valid && (retried.lastPage || retried.replies.length)) payload = retried;
        }
        if (!payload.valid) { if(!replies.failureReason)replies.failureReason='分页请求失败或返回内容无效'; break; }
        // 班级 tag 约束首层回复；楼中楼作者不能直接继承被回复人的班级。
        addReplies(tagClassId ? payload.replies.map((reply) => (reply.classId || reply.collectedClassId || reply.parentId ? reply : { ...reply, classId: tagClassId, collectedClassId: tagClassId })) : payload.replies);
        replies.missingNested.push(...payload.missingNested);
        if (!state.detailCollectionActive) setStatus(`正在采集回复：${replies.length} 条 · ${tagClassId ? `${tagClassId} · ` : ''}第 ${page+1} 页`, 'info');
        if (payload.lastPage) { tagReachedEnd = true; break; }
        // 根回复的排序不等于最后活动时间排序；旧根的后续页仍可能有本时段楼中楼。
        if (!payload.replies.length) { if(!replies.failureReason)replies.failureReason='分页提前返回空页'; break; }
        const nextState = {
          lastValue: payload.lastValue,
          lastAuxValue: payload.lastAuxValue,
        };
        if (!nextState.lastValue || (nextState.lastValue === pageState.lastValue && nextState.lastAuxValue === pageState.lastAuxValue)) { if(!replies.failureReason)replies.failureReason='分页游标没有推进'; break; }
        pageState = nextState;
      }
      if (!tagReachedEnd) allTagsComplete = false;
    }
    if (tagClassIds.length) replies.taggedClassIds = [...tagClassIds];
    const topPayload = await topRequest;
    addReplies(topPayload.replies);
    let topValid = true;
    if(topUrl && !topPayload.valid){topValid=false;if(!replies.failureReason)replies.failureReason='置顶回复接口尚未成功读取';}
    replies.missingNested.push(...(topPayload.missingNested||[]));
    // 按时间段采集时，楼中楼缺口是否相关取决于它所在根回复的最后活动时间：
    // 根回复在时间段开始前就已经没有新活动，未展开的楼中楼不可能落在本时段，不能据此把整条话题判成未采全。
    if (scopedCapture(options) && replies.missingNested.length) {
      const from = CaptureScope && typeof CaptureScope.stamp === 'function' ? CaptureScope.stamp(options.captureScope.from) : Date.parse(options.captureScope.from);
      if (Number.isFinite(from)) {
        replies.missingNested = replies.missingNested.filter((gap) => {
          const at = CaptureScope && typeof CaptureScope.stamp === 'function' ? CaptureScope.stamp(gap.lastReplyAt) : null;
          return at === null || at === undefined || at >= from;
        });
      }
    }
    if (replies.missingNested.length) {
      // 平台详情页的“查看更多回复”只是展开已返回的 .replyReply（invitationEvent.js），
      // 没有单独的楼中楼补拉接口；second_reply_count 与 second_data 不一致时只能提示，
      // 不能据此把整条话题判成未采全、再让评分走缺项折算。
      replies.nestedWarning = `${replies.missingNested.length} 组楼中楼计数不一致（平台也未单独加载）`;
    }
    replies.collectionComplete = allTagsComplete && topValid;
    if (replies.collectionComplete) replies.rootPagesComplete = true;
    if (!replies.collectionComplete && !replies.failureReason) replies.failureReason='达到分页保护上限，请缩小范围后补采';
    const classFiltered=filterDiscussionClasses(replies,tagClassIds);
    replies.splice(0,replies.length,...classFiltered);
    await applyCourseRoles(replies,topic);
    if(scopedCapture(options)){const filtered=CaptureScope.filterReplies(replies,options.captureScope),attrs={...replies};for(const key of Object.keys(attrs))if(/^\d+$/.test(key))delete attrs[key];replies.splice(0,replies.length,...filtered.replies);Object.assign(replies,attrs,{contextIds:filtered.contextIds,unknownTime:filtered.unknownTime});}
    return replies;
  }

  function mergeCourseTopicDetailWithReplies(detail, replies, options) {
    const base = detail || {};
    const body = sanitizeCourseTopicContent(base.content || '');
    const replyItems = Array.isArray(replies) ? replies : [];
    // getTopic 不带班级参数，它返回的 last_reply_content 是这条话题在全部班级里的最后一条回复。
    // 按班采集时这条回复可能属于别的班，不能拿来补成本班正文或回复。
    const classScoped = ((options && options.tagClassIds) || []).some((classId) => normalizeCourseClassId(classId));
    const parts = [];
    if (body) parts.push(body);
    if (replyItems.length) {
      parts.push(['详情页回复：', ...replyItems.map((reply, index) => `${index + 1}. ${sanitizeCourseTopicContent(reply.content)}`)].join('\n'));
    } else if (!classScoped && isUsefulCourseTopicText(base.lastReplyContent)) {
      parts.push(`详情页回复：\n1. ${base.lastReplyContent}`);
    }
    return {
      ...base,
      content: limitText(parts.join('\n\n') || body || (classScoped ? '' : base.lastReplyContent) || '', MAX_COURSE_TOPIC_CONTENT_CHARS),
      bodyContent: body,
      lastReplyContent: classScoped ? '' : (base.lastReplyContent || ''),
      replyCollectionComplete: replies && replies.collectionComplete === true,
      replyCollectionIssue: replies && replies.failureReason || '',
      replyCollectionIssueCode:replies?.failureCode||'',replyPagesComplete:replies?.rootPagesComplete===true,replyExpectedCount:Number.isInteger(replies?.expectedCount)?replies.expectedCount:null,
      replyNestedWarning: replies && replies.nestedWarning || '',
      missingNested: (replies && replies.missingNested) || [],
      replyUnknownTime:replies&&replies.unknownTime||0,
      replyPages: replies && replies.pages || 0,
      replies: replyItems,
    };
  }

  // 「这条话题在本次范围内应该有 N 条回复」：按班采集时优先用接口给的分班回复数
  // （classReplyCounts 只列有回复的班，缺的班就是 0 条）；没有分班数据时不下缺失结论，
  // 否则课程级 reply_count 会把别的班的回复算进来，报出「显示 14 条只采到 9 条」这种假缺口。
  function courseTopicExpectedReplyCount(topic, tagClassIds) {
    const ids = (tagClassIds || []).map((id) => normalizeCourseClassId(id)).filter(Boolean);
    const counts = topic && topic.classReplyCounts;
    if (counts && typeof counts === 'object' && ids.length) {
      let total = 0;
      for (const classId of ids) total += Number(counts[classId]) || 0;
      return total;
    }
    if (ids.length) return null;
    const fallback = Number.parseInt(cleanText(topic && (topic.platformReplyCount != null ? topic.platformReplyCount : topic.replyCount)), 10);
    return Number.isInteger(fallback) ? fallback : null;
  }

  // 这条话题该按哪些班取回复：话题自己的班在所选范围内就只取它自己；
  // 课程级话题（或没有班号）按所选每个班各取一次；话题属于范围外的班时只取它自己的班。
  function resolveCourseTopicTagClassIds(topic, selectedClassIds) {
    const selected = (selectedClassIds || []).map((id) => normalizeCourseClassId(id)).filter(Boolean);
    if (!selected.length) return [];
    const topicClassId = normalizeCourseClassId(topic && topic.classId);
    if (topicClassId && selected.includes(topicClassId)) return [topicClassId];
    if (topic && (topic.courseLevel === true || !topicClassId)) return selected;
    return [topicClassId];
  }

  async function fetchCourseTopicDetail(topic, options) {
    const tagClassIds = (options && options.tagClassIds) || [];
    const classReplyCounts = topic && topic.classReplyCounts;
    const [baseDetail, initialReplies] = await Promise.all([fetchCourseTopicBaseDetail(topic),fetchCourseTopicReplies(topic,{tagClassIds,captureScope:options?.captureScope,classReplyCounts})]);
    const detailForReplies = {
      ...(topic || {}),
      ...(baseDetail || {}),
      uuid: cleanText((topic && topic.uuid) || (baseDetail && baseDetail.uuid)),
      bbsid: cleanText((baseDetail && baseDetail.bbsid) || (topic && topic.bbsid)),
      detailUrl: (topic && topic.detailUrl) || '',
    };
    let replies = initialReplies.failureReason === '缺少话题分页地址' && detailForReplies.bbsid
      ? await fetchCourseTopicReplies(detailForReplies,{tagClassIds,captureScope:options?.captureScope,classReplyCounts}) : initialReplies;
    const expected = courseTopicExpectedReplyCount({...topic,replyCount:topic?.replyCount??baseDetail?.replyCount??baseDetail?.platformReplyCount},tagClassIds);
    const checkCount = rows => {
      rows.expectedCount = expected;
      if (!scopedCapture(options) && Number.isInteger(expected) && expected > rows.length) {
        rows.collectionComplete = false;
        if (rows.rootPagesComplete) {
          rows.failureCode = 'count-mismatch';
          rows.failureReason = `回复分页已读完，但平台显示 ${expected} 条，实际返回 ${rows.length} 条，数量待核对`;
        }
      }
      if (rows.collectionComplete) { rows.failureReason = ''; rows.failureCode = ''; }
      return rows;
    };
    replies = checkCount(replies);
    // “末页”也可能少返回内容：先核对数量再重试，只重读本话题；不同次成功内容合并保留。
    for (let attempt = 0; attempt < 2 && replies.collectionComplete !== true; attempt++) {
      await sleep(TEST_MODE ? 0 : 400 * (attempt + 1));
      const again = await fetchCourseTopicReplies(detailForReplies, {tagClassIds,captureScope:options?.captureScope,classReplyCounts}).catch(error => {
        if (collectionControl?.cancelled) throw error;
        return null;
      });
      if (!again) continue;
      const byId = new Map();
      for (const row of [...replies, ...again]) {
        const id = cleanText(row.uniqueKey) || [row.authorId,row.author,row.createdAt,row.content].join('|');
        const key = (row.classId || row.collectedClassId || '') + '|' + id;
        byId.set(key, {...byId.get(key), ...row});
      }
      const merged = [...byId.values()];
      const attrs = rows => Object.fromEntries(Object.entries(rows).filter(([key]) => !/^\d+$/.test(key)));
      Object.assign(merged, attrs(replies), attrs(again), {
        pages: (replies.pages || 0) + (again.pages || 0),
        rootPagesComplete: replies.rootPagesComplete === true || again.rootPagesComplete === true,
      });
      merged.collectionComplete = merged.rootPagesComplete;
      if (scopedCapture(options)) {
        const filtered = CaptureScope.filterReplies(merged, options.captureScope);
        merged.splice(0, merged.length, ...filtered.replies);
        Object.assign(merged, {contextIds:filtered.contextIds,unknownTime:filtered.unknownTime});
      }
      replies = checkCount(merged);
    }
    if(replies.collectionComplete!==true&&!cleanText(replies.failureReason))replies.failureReason='回复完整性未确认';
    // 一条回复都没有、详情也读不到时曾经直接返回 null：这类话题不会进 details，
    // 采集摘要就查不到「回复读全了没有」，只能显示兜底的「回复完整性未确认」
    //（真机 1638 个话题里有 167 个是这样，其中大多数只是真的没人回复）。
    // 现在只要这次确实问过平台，就把结果带回流程，读全或没读全都如实记下来。
    return mergeCourseTopicDetailWithReplies(baseDetail || detailForReplies, replies, { tagClassIds });
  }

  async function enrichCourseTopicsWithDetails(topics, options) {
    const baseTopics = uniqueCourseTopics((topics || []).map((topic) => {
      const runtimeTopic = courseTopicFromRuntimeData(getRuntimeCourseTopicData(topic && topic.uuid), topic);
      return runtimeTopic || topic;
    }));
    const targets = options && options.includeReplies ? baseTopics : baseTopics.filter(shouldFetchCourseTopicDetail);
    if (!targets.length) return baseTopics;
    const selectedClassIds = (options && options.selectedClassIds) || [];

    const details = new Map();
    // 同一 uuid 的话题可能分属不同班：详情缓存键必须带班号，否则两个班会共用一份详情。
    const detailKey = (topic) => `${cleanText(topic && topic.uniqueKey)}@${normalizeCourseClassId(topic && (topic.collectedClassId || topic.classId))}`;
    let nextIndex = 0;
    let completed = 0;
    state.detailCollectionActive=true;
    let loadedReplies=0;
    const workerCount = Math.min(6, targets.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < targets.length) {
        await collectionGate();
        if(nextIndex>=targets.length)break;
        const target = targets[nextIndex];
        nextIndex += 1;
        let detail = null;
        try { detail = await fetchCourseTopicDetail(target, { tagClassIds: resolveCourseTopicTagClassIds(target, selectedClassIds),captureScope:options?.captureScope }); }
        catch (error) {
          state.collectionWarning = '部分话题详情或回复没有采集完成，可重新采集补取；已保留成功记录';
        }
        completed += 1;
        // 内容为空的详情也要收下：它带着 replyCollectionComplete / replyCollectionIssue，
        // 摘要里「哪些话题的回复没读全」全靠这两个字段。
        if (detail) details.set(detailKey(target), detail);
        loadedReplies += detail?.replies?.length || 0;
        if (completed >= 1) {
          setStatus(`正在读取：话题 ${completed}/${targets.length} 个 · 回复 ${loadedReplies} 条`, 'info');
        }
        await sleep(TEST_MODE ? 0 : 40);
      }
    });
    try { await Promise.all(workers); } finally { state.detailCollectionActive=false; }

    // 话题自己的班号是权威值：详情接口的班号只是参考，不一致时保留话题自己的班并记警告。
    // 课程级话题（平台「全部班级」的话题）没有班号，归属由每条回复自己的班号决定。
    const classMismatch = new Set();
    const merged = uniqueCourseTopics(baseTopics.map((topic) => {
      const detail = details.get(detailKey(topic));
      if (!detail) return topic;
      const ownClassId = normalizeCourseClassId(topic.classId);
      const stampedClassId = normalizeCourseClassId(topic.collectedClassId);
      const detailClassId = normalizeCourseClassId(detail.classId);
      const courseLevel = topic.courseLevel === true || (!ownClassId && !stampedClassId) || isCourseLevelClassId(ownClassId) || isCourseLevelClassId(detailClassId);
      if (!courseLevel && ownClassId && detailClassId && !isCourseLevelClassId(detailClassId) && detailClassId !== ownClassId) {
        classMismatch.add(`${topic.className || ownClassId}(${ownClassId}) → ${detailClassId}`);
      }
      return {
        ...topic,
        ...detail,
        role: detail.role && detail.role !== 'unknown' ? detail.role : topic.role,
        classId: courseLevel ? '' : (ownClassId || detailClassId),
        ...(courseLevel ? { courseLevel: true } : {}),
        collectedClassId: stampedClassId,
        domClassId: normalizeCourseClassId(topic.domClassId),
        className: courseLevel ? (cleanText(topic.className) || '全部班级') : (cleanText(topic.className) || detail.className),
        title: detail.title || topic.title,
        content: detail.content || topic.content,
        source: detail.source || topic.source,
      };
    }));
    if (classMismatch.size) {
      const note = `话题详情接口返回的班级与本次采集班级不一致，已按采集班级归档（${Array.from(classMismatch).join('、')}）`;
      state.collectionWarning = cleanText(state.collectionWarning) ? `${state.collectionWarning}；${note}` : note;
    }
    return merged;
  }

  async function collectAllComments() {
    await expandTruncatedTexts();
    let stableRounds = 0;
    let previousCount = -1;
    const maxRounds = 100;
    let expectedReplyInfo = { total: 0, exact: false };
    let loadMoreState = { hasControl: false, reachedEnd: false, text: '' };
    state.collectionWarning = '';
    for (let round = 0; round < maxRounds; round += 1) {
      const docsBefore = getAllSameOriginDocs(document);
      expectedReplyInfo = betterReplyInfo(expectedReplyInfo, getExpectedReplyInfoFromDocs(docsBefore));
      const rawBefore = getRawLoadedReplyInfoFromDocs(docsBefore);
      const loadMoreBefore = getLoadMoreStateFromDocs(docsBefore);
      let clicked = false;
      let scrolled = false;
      let docsAfter = docsBefore;

      if (loadMoreBefore.reachedEnd || (expectedReplyInfo.exact && expectedReplyInfo.total > 0 && rawBefore.count >= expectedReplyInfo.total)) {
        docsAfter = docsBefore;
      } else if (loadMoreBefore.hasControl && !loadMoreBefore.reachedEnd) {
        clicked = docsBefore.map((doc) => clickLoadMoreInDoc(doc)).some(Boolean);
        const waited = await waitForReplyLoadProgress(rawBefore.count, clicked ? 6500 : 1200);
        docsAfter = waited.docs;
      } else {
        scrolled = docsBefore.map((doc) => scrollDoc(doc)).some(Boolean);
        await sleep(scrolled ? 1000 : 600);
        docsAfter = getAllSameOriginDocs(document);
      }

      expectedReplyInfo = betterReplyInfo(expectedReplyInfo, getExpectedReplyInfoFromDocs(docsAfter));
      mergeComments(docsAfter);
      loadMoreState = getLoadMoreStateFromDocs(docsAfter);
      if (round % 3 === 0 || clicked) {
        setStatus(formatCollectionStatus({ rawLoadedCount: state.rawLoadedCount, validCount: state.comments.length, expectedReplyInfo }), 'info');
      }
      if (state.rawLoadedCount === previousCount && !loadMoreState.loading) stableRounds += 1;
      else stableRounds = 0;
      previousCount = state.rawLoadedCount;
      if (shouldStopCollecting({ round, stableRounds, rawLoadedCount: state.rawLoadedCount, expectedReplyInfo, loadMoreState })) break;
      if(stableRounds>=3){state.collectionWarning='网页回复分页未继续推进，已保留成功记录，请稍后补采';break;}
    }
    const comments = mergeComments();
    if (!loadMoreState.reachedEnd && expectedReplyInfo.total && state.rawLoadedCount < expectedReplyInfo.total) {
      const target = expectedReplyInfo.exact ? expectedReplyInfo.total : `${expectedReplyInfo.total}+`;
      state.collectionWarning = `已加载 ${state.rawLoadedCount}/${target}，可能还有未展开或跨域内容；采集正文 ${comments.length} 条`;
    }
    return comments;
  }

  // 采集上限：默认 0＝不限制（按所选班级全部读完）。设置页可以调小（20/50/150/400），
  // 上限只影响本次采集范围，不影响平台数字的并列显示；被上限截断时面板会给一个「改成不限制」按钮。
  async function readMaxTopicsSetting() {
    if (Number.isInteger(state.maxTopicsOverride)) return state.maxTopicsOverride;
    try {
      const stored = await storageGet([STORAGE_KEYS.maxTopics]);
      return stored[STORAGE_KEYS.maxTopics] !== undefined ? normalizeMaxTopics(stored[STORAGE_KEYS.maxTopics]) : DEFAULTS.maxTopics;
    } catch (_error) {
      return DEFAULTS.maxTopics;
    }
  }

  async function collectAllCourseTopics(options) {
    if(scopedCapture(options)||options?.topicId)return collectScopedCourseTopics(options);
    courseTeacherContexts.clear();
    const startedAt = Date.now();
    const maxTopics = await readMaxTopicsSetting();
    state.collectionComplete = false;
    let reachedTopicLimit = false;
    let stableRounds = 0;
    let previousCount = -1;
    const maxRounds = 80;
    const classIdSet = normalizeCourseClassFilter(options);
    const selectedClassIds = Array.from(classIdSet);
    const currentClassOnly = !!(options && options.currentClassOnly);
    const frameClassId = getCurrentCourseTopicFrameClassId();
    const classCount = classIdSet.size;
    state.comments = [];
    state.collectionWarning = '';
    state.analysisMode = 'courseTopics';
    state.selectedClassIds = selectedClassIds;
    if (currentClassOnly && selectedClassIds.length && !selectedClassIds.includes(frameClassId)) {
      const target = selectedClassIds.join('、');
      const current = frameClassId || '全部班级';
      state.collectionWarning = `当前课程话题页仍停留在 ${current}，未进入所选班级 ${target}，已停止本次班级采集`;
      state.rawLoadedCount = 0;
      return [];
    }
    // 选了班级就先走课程话题列表接口：只有这个接口带「话题自己的班号」，
    // 讨论页 DOM 只渲染当前浏览班的行，靠它永远读不到别的班的话题。
    let apiList = null;
    let apiListError = '';
    if (selectedClassIds.length) {
      setStatus(`正在按所选 ${selectedClassIds.length} 个班级读取课程话题列表...`, 'info');
      apiList = await fetchCourseTopicListTopics({ classIds: selectedClassIds, maxTopics }).catch((error) => {
        apiListError = cleanText(error && error.message) || '课程话题列表接口读取失败';
        return null;
      });
      if (apiList && !apiList.topics.length) apiListError = apiListError || cleanText(apiList.reason);
    }
    const needDomScan = !(apiList && apiList.topics.length);
    // 异步渲染等待：如果尚未探测到话题节点，短轮询等待渲染（最多 1500ms）
    const initialDocs = getAllSameOriginDocs(document);
    if (!initialDocs.some(doc => COURSE_TOPIC_SELECTORS.some(s => queryOne(doc, s)))) {
      const waitStart = Date.now();
      while (Date.now() - waitStart < 1500) {
        await sleep(150);
        const docs = getAllSameOriginDocs(document);
        if (docs.some(doc => COURSE_TOPIC_SELECTORS.some(s => queryOne(doc, s)))) break;
      }
    }
    for (let round = 0; needDomScan && round < maxRounds; round += 1) {
      const docsBefore = getAllSameOriginDocs(document);
      const beforeCount = mergeCourseTopics(docsBefore, { classIds: state.selectedClassIds, includeTeacherTopics:true, collectedClassId: frameClassId }).length;
      const rowsBefore = countCourseTopicRowsInDocs(docsBefore);
      const loadMoreBefore = getLoadMoreStateFromDocs(docsBefore);
      let clicked = false;
      let scrolled = false;
      let docsAfter = docsBefore;

      if (loadMoreBefore.hasControl && loadMoreBefore.reachedEnd) {
        docsAfter = docsBefore;
      } else if (loadMoreBefore.hasControl && !loadMoreBefore.reachedEnd) {
        clicked = docsBefore.map((doc) => clickLoadMoreInDoc(doc)).some(Boolean);
        if (clicked && rowsBefore) await waitForCourseTopicRows(docsBefore, rowsBefore, 8000);
        else await waitForCourseTopicProgress(beforeCount, clicked ? 5000 : 1000);
        docsAfter = getAllSameOriginDocs(document);
      } else {
        scrolled = docsBefore.map((doc) => scrollDoc(doc)).some(Boolean);
        await sleep(scrolled ? 900 : 500);
        docsAfter = getAllSameOriginDocs(document);
      }

      const topics = mergeCourseTopics(docsAfter, { classIds: state.selectedClassIds, includeTeacherTopics:true, collectedClassId: frameClassId });
      state.rawLoadedCount = topics.length;
      if (round % 3 === 0 || clicked) setStatus(classCount
        ? `正在采集已选 ${classCount} 个班级的话题...已识别 ${topics.length} 个`
        : `正在采集课程学生话题...已识别 ${topics.length} 个`, 'info');
      const rowsAfter = countCourseTopicRowsInDocs(docsAfter);
      // 「有没有进展」看页面加载出来的行数：新加载的一页如果都属于别的班级，
      // 筛选后的条数不会变，但列表确实往前走了，这时候不能算停滞。
      if (rowsAfter > rowsBefore) stableRounds = 0;
      else if (topics.length === previousCount && topics.length === beforeCount) stableRounds += 1;
      else stableRounds = 0;
      previousCount = topics.length;
      const loadMoreAfter = getLoadMoreStateFromDocs(docsAfter);
      if(loadMoreAfter.loading)stableRounds=0;
      if (maxTopics > 0 && topics.length >= maxTopics) { reachedTopicLimit = true; break; }
      if (shouldStopCourseTopicCollection({ round, stableRounds, loadMoreState: loadMoreAfter })) break;
      if(stableRounds>=3){state.collectionWarning='话题列表分页未继续推进，已保留成功话题，请稍后补采';break;}
    }
    const domTopics = mergeCourseTopics(undefined, { classIds: state.selectedClassIds, includeTeacherTopics:true, collectedClassId: frameClassId });
    // 接口话题在前：它带着话题自己的班号与分班回复数，同 uuid 撞号时以接口版本为准。
    const scopedTopics = apiList && apiList.topics.length ? uniqueCourseTopics([...apiList.topics, ...domTopics]) : domTopics;
    if (apiList && apiList.topics.length) {
      if (apiList.truncatedByLimit) reachedTopicLimit = true;
      if (!apiList.reachedEnd) state.collectionWarning = [state.collectionWarning, '课程话题列表没有翻到底，已保留读到的话题'].filter(Boolean).join('；');
    }
    // selectedClassIds 必须传下去：课程级话题要按每个所选班各取一次回复，本班话题只取本班。
    const topics = await enrichCourseTopicsWithDetails(scopedTopics, { includeReplies: true, selectedClassIds });
    state.comments = topics;
    state.rawLoadedCount = topics.length;
    state.collectionComplete = !state.collectionWarning && topics.every(t=>t.replyCollectionComplete===true) && (reachedTopicLimit || getLoadMoreStateFromDocs(getAllSameOriginDocs(document)).reachedEnd);
    state.collectionSummary = courseCollectionSummary(topics,startedAt);
    const apiTopicCount = apiList && apiList.topics.length ? apiList.topics.length : 0;
    state.collectionSummary.classScopeSource = apiTopicCount ? 'course-topic-list-api' : 'dom-list';
    // 接口路径出问题时保留取证信息（读了哪一页、返回多少条、被班级筛选留下多少），便于在采集结果里直接定位。
    if (apiList && apiList.debug && apiList.debug.length) state.collectionSummary.classScopeDebug = apiList.debug;
    if (apiTopicCount) {
      // 走接口时页面上的「共 N 条话题」是当前浏览班的历史累计，跟本次口径不同，换成接口口径说明，
      // 并把平台按班累计话题数一起列出来（选 3 个班时 ~500 这个数字的出处），避免把上限当成漏采。
      const classCounts = await fetchCourseTopicClassTopicCounts(selectedClassIds).catch(() => ({}));
      if (Object.keys(classCounts).length) state.collectionSummary.classTopicCounts = classCounts;
      const classCountText = selectedClassIds.map((classId) => {
        const option = (state.classOptions || []).find((item) => item.id === classId);
        const total = classCounts[classId];
        return Number.isInteger(total) ? `${(option && option.name) || classId} ${total}` : '';
      }).filter(Boolean).join('、');
      state.collectionSummary.classScopeNote = `按所选 ${selectedClassIds.length} 个班级从课程话题列表接口筛选：读取 ${apiList.pages} 页、命中 ${apiTopicCount} 个话题（含每班都能看到的课程级「全部班级」话题，按最后回复时间倒序）${classCountText ? `；平台累计话题数（含课程级）：${classCountText}` : ''}${maxTopics > 0 ? `；本次上限 ${maxTopics} 个，设置页可改为「不限制」` : ''}`;
      // 接口路径下 platformReplyCount 是「这条话题在全课程的回复数」，跟按班采集不是一个口径：
      // 有分班回复数时改成「所选班的分班回复数之和」，没有就不给数字、也不报缺口。
      const scopedCounts = topics.map((topic) => courseTopicExpectedReplyCount(topic, selectedClassIds));
      const scopedTotal = scopedCounts.every((value) => Number.isInteger(value)) ? scopedCounts.reduce((sum, value) => sum + value, 0) : null;
      if (Number.isInteger(scopedTotal)) {
        state.collectionSummary.platformReplies = scopedTotal;
        state.collectionSummary.platformReplyScope = 'selected-classes';
        state.collectionSummary.platformReplyNote = scopedTotal > state.collectionSummary.replies
          ? `按所选 ${selectedClassIds.length} 个班级统计，平台这些话题共 ${scopedTotal} 条回复，本次采集到 ${state.collectionSummary.replies} 条，还差 ${scopedTotal - state.collectionSummary.replies} 条（可重新采集补取）`
          : `按所选 ${selectedClassIds.length} 个班级统计，平台这些话题共 ${scopedTotal} 条回复，本次已采集 ${state.collectionSummary.replies} 条`;
      } else {
        delete state.collectionSummary.platformReplies;
        state.collectionSummary.platformReplyScope = 'unknown';
        state.collectionSummary.platformReplyNote = '';
      }
    } else if (selectedClassIds.length) {
      state.collectionSummary.classScopeNote = `课程话题列表接口没有读到内容${apiListError ? `（${apiListError}）` : ''}，本次只按当前浏览页的话题列表采集`;
    }
    if (maxTopics > 0) state.collectionSummary.topicLimit = maxTopics;
    if (reachedTopicLimit) {
      state.collectionSummary.truncatedByLimit = true;
    }
    if (!apiTopicCount) {
      const platform = readPlatformTopicCount(getAllSameOriginDocs(document));
      if (reachedTopicLimit) {
        state.collectionSummary.scopeNote = `本次范围：最新的 ${maxTopics} 个话题${platform ? `（平台累计 ${platform.count} 个）` : ''}；点下面的「改成不限制」可以重新采全部（设置页也能改）`;
      } else if (platform && platform.count > topics.length) {
        state.collectionSummary.platformTopics = platform.count;
        state.collectionSummary.platformScope = platform.scope || '';
        state.collectionSummary.platformNote = `平台显示${platform.scope ? `「${platform.scope}」` : ''}累计 ${platform.count} 个话题；讨论列表只提供最新 20 条 + 置顶，本次采集到 ${topics.length} 个`;
      }
      const platformReplies = state.collectionSummary.platformReplies || 0;
      if (platformReplies > state.collectionSummary.replies) {
        state.collectionSummary.platformReplyNote = `平台列表里这些话题显示 ${platformReplies} 条回复，本次采集到 ${state.collectionSummary.replies} 条；平台按全课程统计、本次按班级采集，差值是其他班级的回复或还没取完的分页`;
      }
    }
    const incomplete = topics.filter(t=>t.replyCollectionComplete!==true);
    if(incomplete.length){const countOnly=incomplete.filter(t=>t.replyCollectionIssueCode==='count-mismatch'&&t.replyPagesComplete).length;state.collectionWarning=[state.collectionWarning,`${incomplete.length}/${topics.length} 个话题需核对：${countOnly?countOnly+' 个已读完回复分页，但平台数量不一致':''}${countOnly&&countOnly<incomplete.length?'；':''}${countOnly<incomplete.length?(incomplete.length-countOnly)+' 个回复分页未确认完整':''}；已保留实际返回内容，可重新采集核对`].filter(Boolean).join('；');}
    return topics;
  }

  // 时段采集先读轻量话题列表；只有活跃或活动时间未知的话题才读详情。
  async function collectScopedCourseTopics(options){
    const startedAt=Date.now(),classIds=Array.from(normalizeCourseClassFilter(options));let base=[],list=null;
    state.collectionWarning='';state.selectedClassIds=classIds;state.analysisMode='courseTopics';
    if(options.topicId){const visible=mergeCourseTopics(undefined,{classIds,includeTeacherTopics:true});const found=visible.find(t=>stripCourseTopicDiscussSuffix(t.uuid)===stripCourseTopicDiscussSuffix(options.topicId));base=[found||{uuid:options.topicId,uniqueKey:'uuid:'+options.topicId,detailUrl:options.topicUrl||'',classId:classIds.length===1?classIds[0]:'',title:'指定话题'}];}
    else{setStatus('正在定位本时段活跃话题，尚未读取历史回复…','info');list=await fetchCourseTopicListTopics({...options,classIds,maxTopics:0});if(list.reason)state.collectionWarning=list.reason;base=list.topics;}
    const context=resolveCourseTopicListContext();
    base=base.map(topic=>{const enriched={...topic,bbsid:topic.bbsid||context.bbsid};return {...enriched,detailUrl:topic.detailUrl||buildCourseTopicDetailUrl(enriched)};});
    const details=await enrichCourseTopicsWithDetails(base,{includeReplies:true,selectedClassIds:classIds,captureScope:options.captureScope});
    state.comments=details;state.rawLoadedCount=details.length;state.collectionComplete=(!list||list.reachedEnd)&&!state.collectionWarning&&details.every(t=>t.replyCollectionComplete===true);
    state.collectionSummary={...courseCollectionSummary(details,startedAt),unknownTime:details.reduce((n,t)=>n+(t.replyUnknownTime||0),0),scopeNote:options.topicId?'只读取指定话题及相关回复':'先定位本时段活动，未读取明确无新活动话题的历史详情',listPages:list?.pages||0,timeBoundary:list?.timeBoundary||false};
    return details;
  }

  // 等「页面加载出来的行数」变多，而不是等「筛选后的条数」变多：
  // 新加载的一页可能整页都属于别的班级，那种情况下筛选条数不动，但分页确实在推进。
  async function waitForCourseTopicRows(previousDocs, previousRows, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(200);
      const docs = getAllSameOriginDocs(document);
      if (countCourseTopicRowsInDocs(docs) > previousRows) return true;
      if (getLoadMoreStateFromDocs(docs).reachedEnd) return false;
    }
    return false;
  }

  async function waitForCourseTopicProgress(previousCount, timeoutMs) {
    const startedAt=Date.now();
    while(Date.now()-startedAt<timeoutMs) {
      await sleep(200);
      const docs=getAllSameOriginDocs(document);
      const count=extractCourseStudentTopicsFromDocs(docs,{classIds:state.selectedClassIds,includeTeacherTopics:true,collectedClassId:getCurrentCourseTopicFrameClassId()}).length;
      const more=getLoadMoreStateFromDocs(docs);
      if(count>previousCount || more.reachedEnd)return;
    }
  }

  // 平台自己写的「共 N 条话题」：选中某个班级后才出现，算的是该班历史累计（含列表里翻不到的老话题）。
  // 讨论列表只渲染最新 20 条 + 置顶，所以它天然大于本次采集到的话题数；读出来是为了把两个口径都告诉老师，
  // 而不是让界面上的数字互相打架。
  // 平台按班累计话题数（getTopicCountByTags?tags=classId<班号>）：classTopicCount + courseTopicCount
  // 就是班级下拉里那个数字。用来把「本次范围内 N 个话题」和「平台累计 M 个」摆在一起，
  // 用户才不会把「最多采集 50 个」当成漏采（实测 22金融学1班 516+21=537、2班 474+21=495）。
  async function fetchCourseTopicClassTopicCounts(classIds) {
    const ids = Array.from(new Set((classIds || []).map(normalizeCourseClassId).filter(Boolean)));
    const counts = {};
    if (!ids.length) return counts;
    const context = resolveCourseTopicListContext();
    if (!context.bbsid || !context.courseId) return counts;
    for (const classId of ids) {
      const url = `${getCourseTopicBaseUrl()}/course/topic/getTopicCountByTags?bbsid=${encodeURIComponent(context.bbsid)}&courseId=${encodeURIComponent(context.courseId)}&tags=${encodeURIComponent(`classId${classId}`)}`;
      try {
        const payload = JSON.parse(String(await fetchText(url)) || 'null');
        const data = payload && payload.data;
        const total = Number((data && data.classTopicCount) || 0) + Number((data && data.courseTopicCount) || 0);
        if (Number.isFinite(total) && total > 0) counts[classId] = total;
      } catch (error) { /* 拿不到计数就不显示，不影响采集本身 */ }
      await sleep(TEST_MODE ? 0 : 60);
    }
    return counts;
  }

  function readPlatformTopicCount(docs) {
    for (const doc of docs || []) {
      for (const node of queryAllNodes(doc, '.dataTotal, .dataTotal_text, .dataTotal .num, .dataTotal_text .num')) {
        const text = getNodeText(node);
        const match = text.match(/共\s*(\d+)\s*条话题/) || (/num/i.test(String(node.className || '')) ? text.match(/^(\d+)$/) : null);
        const count = match ? Number(match[1]) : NaN;
        if (Number.isInteger(count) && count >= 0) {
          return { count, scope: getNodeText(queryOne(doc, ['.selectClass_text span', '.selectClass_text', '.selectClass p span'])) };
        }
      }
    }
    return null;
  }

  function courseCollectionSummary(topics,startedAt) {
    const replies=topics.flatMap(t=>t.replies||[]);
    const platformReplies=topics.reduce((n,t)=>n+Number(t.platformReplyCount||0),0);
    return {topics:topics.length,completedTopics:topics.filter(t=>t.replyCollectionComplete===true).length,
      replies:replies.length,rootReplies:replies.filter(r=>!r.parentId).length,nestedReplies:replies.filter(r=>r.parentId).length,
      ...(platformReplies?{platformReplies}:{}),
      apiPages:topics.reduce((n,t)=>n+(t.replyPages||0),0),elapsedMs:Math.max(0,Date.now()-startedAt),method:'api-with-dom-list',
      nestedWarnings:topics.filter(t=>t.missingNested?.length||t.replyNestedWarning).map(t=>({topicId:t.uuid||t.uniqueKey,reason:t.replyNestedWarning||`${(t.missingNested||[]).length} 组楼中楼计数不一致`,missingNested:(t.missingNested||[]).map(g=>cleanText(g&&g.id)).filter(Boolean)})),
      issues:topics.filter(t=>t.replyCollectionComplete!==true).map(t=>({topicId:t.uuid||t.uniqueKey,title:t.title||'',classId:normalizeCourseClassId(t.classId),reason:t.replyCollectionIssue||'回复完整性未确认',reasonCode:t.replyCollectionIssueCode||'',pagesComplete:t.replyPagesComplete===true,expectedReplies:Number.isInteger(t.replyExpectedCount)?t.replyExpectedCount:null,loadedReplies:(t.replies||[]).length,missingNested:(t.missingNested||[]).map(g=>cleanText(g&&g.id)).filter(Boolean)}))};
  }

  function getCourseTopicIframeElements() {
    if (!IS_TOP_FRAME) return [];
    return Array.from(document.querySelectorAll('iframe') || [])
      .filter((frame) => {
        const src = String(frame.getAttribute('src') || frame.src || '');
        const idName = `${frame.id || ''} ${frame.name || ''} ${frame.className || ''}`;
        return isChaoxingCourseTopicListPageUrl(src) || /topicList|frame_content-tl/i.test(`${src} ${idName}`);
      });
  }

  function getPrimaryCourseTopicIframeElement() {
    const frames = getCourseTopicIframeElements();
    return frames.find((frame) => isChaoxingCourseTopicListPageUrl(frame.getAttribute('src') || frame.src))
      || frames[0]
      || null;
  }

  function getCourseTopicIframeUrl(frame) {
    const raw = String((frame && (frame.getAttribute('src') || frame.src)) || '');
    if (!raw) return '';
    try {
      return new URL(raw, currentLocation.href || undefined).href;
    } catch (error) {
      return raw;
    }
  }

  function getCourseTopicIframeClassId(frame) {
    try {
      const url = new URL(getCourseTopicIframeUrl(frame), currentLocation.href || undefined);
      return normalizeCourseClassId(url.searchParams.get('clazzid'));
    } catch (error) {
      return normalizeCourseClassId(getCourseTopicIframeUrl(frame));
    }
  }

  function buildCourseTopicIframeClassUrl(frame, classId) {
    const url = new URL(getCourseTopicIframeUrl(frame), currentLocation.href || undefined);
    url.searchParams.set('clazzid', classId);
    url.searchParams.set('isInit', '0');
    url.searchParams.set('t', String(Date.now()));
    return url.href;
  }

  function waitForIframeLoad(frame, timeoutMs) {
    return new Promise((resolve) => {
      if (!frame) {
        resolve(false);
        return;
      }
      let done = false;
      const finish = (loaded) => {
        if (done) return;
        done = true;
        try { frame.removeEventListener('load', onLoad); } catch (error) { }
        rootWindow.clearTimeout(timer);
        resolve(!!loaded);
      };
      const onLoad = () => {
        rootWindow.setTimeout(() => finish(true), 400);
      };
      const timer = rootWindow.setTimeout(() => finish(false), timeoutMs || 12000);
      try {
        frame.addEventListener('load', onLoad, { once: true });
      } catch (error) {
        finish(false);
      }
    });
  }

  async function switchCourseTopicIframeToClass(classId) {
    const normalizedClassId = normalizeCourseClassId(classId);
    if (!normalizedClassId) return true;
    const frame = getPrimaryCourseTopicIframeElement();
    if (!frame) throw new Error('当前页面没有找到课程话题 iframe，请重新打开课程“全部话题”页面');
    if (getCourseTopicIframeClassId(frame) === normalizedClassId) {
      await sleep(500);
      return true;
    }
    const targetUrl = buildCourseTopicIframeClassUrl(frame, normalizedClassId);
    const loadPromise = waitForIframeLoad(frame, 15000);
    try {
      frame.src = targetUrl;
    } catch (error) {
      throw new Error('切换班级失败，请刷新课程页面后重试');
    }
    await loadPromise;
    await sleep(900);
    return getCourseTopicIframeClassId(frame) === normalizedClassId;
  }

  async function collectCourseTopicsFromSelectedClassFrames(payload) {
    const startedAt=Date.now();
    const classIds = Array.from(normalizeCourseClassFilter(payload));
    let classOptions = [];
    try {
      const classPayload = await requestDiscussionFrameAction('getCourseClasses', {});
      classOptions = uniqueCourseClassOptions(classPayload && classPayload.classOptions);
    } catch (error) {
      throw new Error('讨论区尚未连接，请刷新讨论区后重试；'+(error?.message||'无法读取课程话题页'));
    }
    if (!classIds.length) {
      const currentFrameClassId = getCourseTopicIframeClassId(getPrimaryCourseTopicIframeElement());
      if (classOptions.length && !currentFrameClassId) {
        throw new Error('请先在“班级范围”选择要统计的班级；如果确实要统计全部班级，请点击“全选班级”后再采集');
      }
      if (currentFrameClassId) {
        return requestDiscussionFrameAction('collectCourseTopics', {
          ...payload,
          classIds: [currentFrameClassId],
          currentClassOnly: true,
        });
      }
      return requestDiscussionFrameAction('collectCourseTopics', payload || {});
    }

    const plan = buildCourseTopicClassCollectionPlan({ classIds }, classOptions);
    const warnings = [];
    const summaries=[];
    let allComplete = true;
    state.comments = [];
    state.collectionWarning = '';
    state.analysisMode = 'courseTopics';
    state.selectedClassIds = classIds;
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      const label = item.className || `班级 ${index + 1}`;
      setStatus(`正在切换到 ${label}...`, 'info');
      const switched = await switchCourseTopicIframeToClass(item.classId);
      if (!switched) {
        allComplete = false;
        warnings.push(`${label} 未能切换成功，已跳过`);
        continue;
      }
      setStatus(`正在采集 ${label} 的话题...`, 'info');
      const result = await requestDiscussionFrameAction('collectCourseTopics', {
        ...payload,
        classIds: item.classIds,
        currentClassOnly: true,
      });
      const topics = Array.isArray(result && result.comments) ? result.comments : [];
      state.comments = uniqueCourseTopics([...state.comments, ...topics]);
      if (result && result.collectionWarning) warnings.push(result.collectionWarning);
      if(result?.collectionSummary)summaries.push(result.collectionSummary);
      if (!result || !result.complete) allComplete = false;
      setStatus(`已采集 ${label}：${topics.length} 个话题，累计 ${state.comments.length} 个`, 'info');
    }
    state.rawLoadedCount = state.comments.length;
    state.collectionWarning = warnings.join('；');
    return {
      comments: state.comments,
      topicContext: { title: '课程学生话题', question: '' },
      analysisMode: 'courseTopics',
      rawLoadedCount: state.rawLoadedCount,
      collectionWarning: state.collectionWarning,
      classOptions,
      selectedClassIds: classIds,
      complete: allComplete && !state.collectionWarning,
      collectionSummary:{...courseCollectionSummary(state.comments,startedAt),issues:summaries.flatMap(s=>s.issues||[]),classesCompleted:summaries.length,classesExpected:plan.length},
    };
  }

  // 详情页切班不会改地址，必须读当前下拉选项，不能优先使用 URL 中的旧班号。
  // 但页面没有班级下拉时，URL 里的班号仍是「从哪个班打开的」唯一线索：
  // 用它兜底，避免直接打开详情时静默退回全部班级、把别班回复拉进来。
  function resolveDiscussionClassIds(options, docs) {
    const explicit=Array.from(normalizeCourseClassFilter(options));
    if(explicit.length)return explicit;
    for(const doc of docs||getAllSameOriginDocs(document)){
      const active=queryAllNodes(doc,'.edit_select_scroll li.active[classid]');
      if(active.length){
        const id=normalizeCourseClassId(getNodeAttribute(active[0],['classid']));
        return id?[id]:[];
      }
      const label=queryAllNodes(doc,'.selectClass_text span')[0];
      if(label){
        const name=normalizeCourseClassName(getNodeText(label));
        if(name==='全部班级')return [];
        const matches=extractCourseClassOptionsFromDocs([doc]).filter(c=>c.name===name);
        if(matches.length===1)return [matches[0].id];
        throw new Error('无法确认当前班级，请重新选择班级后采集');
      }
    }
    const urlClassId=normalizeCourseClassId(getUrlParam(currentLocation.href,'clazzid')||getUrlParam(currentLocation.href,'classId'));
    return urlClassId?[urlClassId]:[];
  }

  function filterDiscussionClasses(records,classIds,docs) {
    const allowed=new Set(classIds||[]);
    const classes=extractCourseClassOptionsFromDocs(docs||getAllSameOriginDocs(document));
    return records.map(r=>{
      const matches=classes.filter(c=>c.name===normalizeCourseClassName(r.className));
      const id=normalizeCourseClassId(r.classId)|| (matches.length===1?matches[0].id:'');
      // 未识别的班级不借用采集班号；后续仍可核对原文补齐。
      return {...r,classId:id,collectedClassId:id?r.collectedClassId:'',...(id?{}:{courseLevel:true})};
    }).filter(r=>!allowed.size||!r.classId||allowed.has(r.classId));
  }

  async function collectDiscussionPayload(options) {
    const classIds=resolveDiscussionClassIds(options);
    state.comments=[]; // 不沿用切班前缓存的网页回复。
    state.networkComments=[];
    if(scopedCapture(options)){
      const topic={detailUrl:String(currentLocation.href||'')},start=Date.now();
      const [replies,original]=await Promise.all([fetchCourseTopicReplies(topic,{captureScope:options.captureScope,tagClassIds:classIds}),fetchCourseTopicBaseDetail(topic)]);
      let comments=filterDiscussionClasses(mergeDiscussionRecords(mergeComments(),replies),classIds);if(original){comments=comments.map(r=>({...r,topicId:original.uuid,parentId:r.parentId||original.uniqueKey,kind:'reply'}));comments.unshift({...original,bodyContent:original.content,kind:'topic'});}
      state.topicContext=mergeTopicContext(state.topicContext,extractTopicContextFromDocs(getAllSameOriginDocs(document)));
      return {comments,topicContext:state.topicContext,analysisMode:'discussionReplies',complete:replies.collectionComplete===true,selectedClassIds:classIds,collectionWarning:replies.failureReason||'',collectionSummary:{topics:1,replies:replies.length,apiPages:replies.pages||0,unknownTime:replies.unknownTime||0,elapsedMs:Date.now()-start,scopeNote:'只保留本时段发言及必要的上文；不自动展开整帖历史回复'}};
    }
    courseTeacherContexts.clear();
    const startedAt=Date.now();
    state.analysisMode = 'discussionReplies';
    state.collectionWarning='';
    let comments = mergeComments();
    let apiComplete = false;
    let originalTopic = null;
    let apiReplies=[];
    if(IS_DISCUSSION_PAGE){
      const topic = {detailUrl:String(currentLocation.href||'')};
      [apiReplies,originalTopic] = await Promise.all([fetchCourseTopicReplies(topic,{tagClassIds:classIds}),fetchCourseTopicBaseDetail(topic)]);
      const domExpected=getExpectedReplyInfoFromDocs(getAllSameOriginDocs(document));
      const expectedBefore=classIds.length?{exact:false,total:0}:domExpected.exact?domExpected:originalTopic?.replyCount>0?{exact:true,total:originalTopic.replyCount}:domExpected;
      apiComplete=apiReplies.collectionComplete===true;
      if(!apiComplete || expectedBefore.exact && apiReplies.length<expectedBefore.total) {
        setStatus('正在补查网页中未展开的回复…','info');
        if(!apiReplies.missingNested?.length)await collectAllComments();
        await expandNestedReplies();
        comments=mergeComments();
      }
      comments=filterDiscussionClasses(mergeDiscussionRecords(comments,apiReplies),classIds);
      if(apiReplies.missingNested?.length) {
        const gaps=apiReplies.missingNested.filter(gap=>{
          const parent=comments.find(r=>r.platformId===gap.id || r.uniqueKey==='reply:'+gap.id);
          return !parent || comments.filter(r=>r.parentId===parent.uniqueKey || r.parentId===parent.platformId).length<gap.expected;
        });
        apiReplies.missingNested=gaps;
        if(!gaps.length && apiReplies.rootPagesComplete)apiComplete=true;
      }
      if(originalTopic){
        const topicKey=originalTopic.uniqueKey;
        comments=comments.map(r=>({...r,parentId:r.parentId||topicKey,topicId:originalTopic.uuid,kind:'reply'}));
        comments.unshift({...originalTopic,bodyContent:originalTopic.content,kind:'topic',source:'chaoxing-topic-original'});
      }
    }
    state.topicContext = mergeTopicContext(state.topicContext, extractTopicContextFromDocs(getAllSameOriginDocs(document)));
    const domExpected=getExpectedReplyInfoFromDocs(getAllSameOriginDocs(document));
    const expected=classIds.length?{exact:false,total:0}:domExpected.exact?domExpected:originalTopic?.replyCount>0?{exact:true,total:originalTopic.replyCount}:domExpected;
    const replyCount=comments.filter(r=>r.kind!=='topic').length;
    state.rawLoadedCount=replyCount;
    const domComplete=expected.exact && expected.total>=0 && replyCount>=expected.total && !apiReplies.missingNested?.length;
    const hasGap=expected.exact && replyCount<expected.total;
    const complete=!hasGap && (apiComplete||domComplete);
    state.collectionWarning=complete?'':hasGap?`已采集 ${replyCount}/${expected.total} 条回复，仍有 ${expected.total-replyCount} 条未采集`:apiReplies.failureReason||'完整性未确认，请核对网页总数后补采';
    const rootReplies=comments.filter(r=>r.kind!=='topic'&&(!r.parentId||r.parentId===originalTopic?.uniqueKey)).length;
    const collectionSummary={topics:1,completedTopics:complete?1:0,replies:replyCount,
      rootReplies,nestedReplies:replyCount-rootReplies,
      expectedReplies:expected.exact?expected.total:null,missingReplies:expected.exact?Math.max(0,expected.total-replyCount):null,
      apiPages:apiReplies.pages||0,elapsedMs:Date.now()-startedAt,method:apiComplete?'api-first':'api-and-dom',
      issues:complete?[]:[{reason:state.collectionWarning}]};
    return {
      comments,
      topicContext: state.topicContext,
      analysisMode: 'discussionReplies',
      selectedClassIds:classIds,
      rawLoadedCount: state.rawLoadedCount,
      collectionWarning: state.collectionWarning,
      complete,
      collectionSummary,
    };
  }

  async function collectCourseTopicsPayload(payload) {
    const classIds = Array.from(normalizeCourseClassFilter(payload));
    if(payload?.listOnly){const list=await fetchCourseTopicListTopics({...payload,classIds,maxTopics:0});return {comments:list.topics,complete:list.reachedEnd,classOptions:extractCourseClassOptionsFromDocs(getAllSameOriginDocs(document)),selectedClassIds:classIds};}
    const topics = await collectAllCourseTopics({ ...payload,classIds });
    const classOptions = extractCourseClassOptionsFromDocs(getAllSameOriginDocs(document));
    return {
      comments: topics,
      topicContext: { title: '课程学生话题', question: '' },
      analysisMode: 'courseTopics',
      rawLoadedCount: state.rawLoadedCount,
      collectionWarning: state.collectionWarning,
      classOptions,
      selectedClassIds: classIds,
      complete: state.collectionComplete === true,
      collectionSummary: state.collectionSummary,
    };
  }

  function mergeDiscussionRecords(domRecords,apiRecords) {
    const byPlatform=new Map(domRecords.filter(r=>r.platformId).map(r=>[r.platformId,r]));
    const byUuid=new Map(domRecords.filter(r=>r.domId).map(r=>[r.domId,r]));
    const byText=new Map(),matched=new Set(),aliases=new Map();
    for(const r of domRecords){const key=r.author+'|'+compactText(r.content);if(!byText.has(key))byText.set(key,[]);byText.get(key).push(r);}
    const merged=apiRecords.map(r=>{
      const bucket=byText.get(r.author+'|'+compactText(r.content))||[];
      const dom=byPlatform.get(r.platformId)||byUuid.get(r.uniqueKey.replace(/^reply:/,''))||bucket.find(c=>!matched.has(c.uniqueKey));
      if(dom){matched.add(dom.uniqueKey);aliases.set(dom.uniqueKey,r.uniqueKey);}
      return {...dom,...r,author:r.author||dom?.author||'',authorId:r.authorId||dom?.authorId||'',role:r.role!=='unknown'?r.role:dom?.role||'unknown',className:r.className||dom?.className||'',classId:(r.collectedClassId&&dom?.classId?dom.classId:r.classId)||dom?.classId||'',createdAt:r.createdAt||dom?.createdAt||''};
    });
    return uniqueComments([...merged,...domRecords.filter(r=>!matched.has(r.uniqueKey)).map(r=>({...r,parentId:aliases.get(r.parentId)||r.parentId}))]);
  }

  async function expandTruncatedTexts() {
    let clicked = false;
    for (const doc of getAllSameOriginDocs(document)) {
      for (const node of queryAllNodes(doc, '.sixFoldExpend')) {
        if (!isVisibleElement(node)) continue;
        try { node.click(); clicked = true; } catch (error) { }
      }
    }
    if (clicked) await sleep(200);
  }

  async function expandNestedReplies() {
    for(let round=0;round<12;round++) {
      let clicked=false;
      const before=extractCommentsFromDocs(getAllSameOriginDocs(document)).length;
      for(const doc of getAllSameOriginDocs(document))for(const node of queryAllNodes(doc,'.replyReplyContainer button, .replyReplyContainer a, .replyReplyList button, .replyReplyList a, .topicDetail_replyItem .prevComment')) {
        if(!/更多|展开|查看.*回复/.test(getNodeText(node)) || !isVisibleElement(node))continue;
        try{node.click();clicked=true;}catch(error){}
      }
      if(!clicked)return;
      for(let wait=0;wait<8;wait++) {await sleep(200);if(extractCommentsFromDocs(getAllSameOriginDocs(document)).length>before)break;}
      if(extractCommentsFromDocs(getAllSameOriginDocs(document)).length<=before)return;
    }
  }

  async function collectCurrentPagePayload(options) {
    // 顶部页面负责把班级传进回复子框架：子框架看不到父页面的班级下拉，
    // 工作台触发的重新采集也不经过面板的 readCaptureOptions。
    if(!IS_DISCUSSION_PAGE&&!shouldUseCourseTopicMode(document)&&IS_CHAOXING_TOPIC_PAGE&&!((options&&options.classIds)||[]).length){
      options={...(options||{}),classIds:resolveDiscussionClassIds({},getAllSameOriginDocs(document))};
    }
    const payload=IS_DISCUSSION_PAGE?await collectDiscussionPayload(options):IS_CHAOXING_COURSE_TOPIC_LIST_PAGE?await collectCourseTopicsPayload(options):shouldUseCourseTopicMode(document)?await collectCourseTopicsFromSelectedClassFrames(options||{}):await requestDiscussionFrameAction('collect',options||{});
    payload.classOptions=uniqueCourseClassOptions([...(payload.classOptions||[]),...extractCourseClassOptionsFromDocs(getAllSameOriginDocs(document))]);
    if(scopedCapture(options)&&typeof DiscussionAnalysis!=='undefined'){
      const canonical=DiscussionAnalysis.createDataset(payload),windowed=CaptureScope.records(canonical.records,options.captureScope),contextIds=new Set(windowed.contextIds);
      payload.comments=windowed.records.map(r=>({...r,captureContext:contextIds.has(r.id)}));payload.analysisMode='scopedRecords';payload.captureScope={...options.captureScope,topicId:options.topicId||''};payload.captureSelectedCount=windowed.records.filter(r=>!contextIds.has(r.id)&&!['teacher','system'].includes(r.role)).length;payload.rawLoadedCount=payload.captureSelectedCount;
      payload.collectionSummary={...(payload.collectionSummary||{}),captureScope:payload.captureScope,contextRecords:contextIds.size,unknownTime:windowed.unknownTime+(payload.collectionSummary?.unknownTime||0)};
      if(payload.collectionSummary.unknownTime){payload.complete=false;payload.collectionWarning=[payload.collectionWarning,`${payload.collectionSummary.unknownTime} 条时间不够准确，未纳入本时段`].filter(Boolean).join('；');}
    }
    else if(options?.topicId){payload.captureScope={mode:'all',topicId:options.topicId};payload.captureSelectedCount=DiscussionAnalysis.calculateMetrics(DiscussionAnalysis.createDataset(payload)).total;}
    return payload;
  }

  function normalizePromptInputLimit(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return MODEL_INPUT_SAFE_CHARS;
    return Math.min(MODEL_INPUT_SAFE_CHARS, Math.max(1000, parsed));
  }

  function formatCommentForPrompt(comment, index, anonymous, maxContentLength) {
    // 限制单条评论长度，减少 prompt 体积和模型生成耗时。
    const limit = Number.isFinite(maxContentLength) ? Math.max(0, Math.floor(maxContentLength)) : DEFAULT_PROMPT_COMMENT_CHARS;
    const content = limitText(comment.content, limit);
    if (anonymous) return `${index + 1}. ${content}`;
    const author = comment.author || '匿名';
    return `${index + 1}. ${author}: ${content}`;
  }

  function formatTopicContextForPrompt(topicContext) {
    const context = normalizeTopicContext(topicContext);
    const lines = [];
    if (context.title) lines.push(`标题：${context.title}`);
    if (context.question) lines.push(`老师提问/讨论引导：${context.question}`);
    return lines.join('\n');
  }

  function formatTopicContextForDisplay(topicContext) {
    return formatTopicContextForPrompt(topicContext);
  }

  function buildSummaryPromptBody(rows, anonymous, topicContext, compressionNote) {
    const contextText = formatTopicContextForPrompt(topicContext);
    const parts = [
      '请总结以下超星课程讨论区评论，输出结构化课堂纪要。',
      '请先根据标题和老师提问/讨论引导理解讨论任务，不要把老师提问当作学生观点统计。',
      anonymous ? '默认匿名处理：不要输出同学姓名、昵称、学号或可识别个人身份的信息。' : '允许保留昵称：可以在必要时引用发言人昵称，但不要输出学号、手机号等敏感信息。',
    ];
    if (compressionNote) parts.push(compressionNote);
    return [
      ...parts,
      '',
      '讨论上下文：',
      contextText || '未识别到明确标题或老师提问。',
      '',
      '请严格按以下小标题输出：',
      '1. 主题概览',
      '2. 高频观点',
      '3. 主要问题',
      '4. 未解决疑问',
      '5. 可反馈给老师的建议',
      '',
      '学生回复：',
      rows,
    ].join('\n');
  }

  function buildCommentRowsForPrompt(comments, anonymous, maxContentLength) {
    return (Array.isArray(comments) ? comments : [])
      .map((comment, index) => formatCommentForPrompt(comment, index, anonymous, maxContentLength))
      .join('\n');
  }

  function formatCourseTopicForPrompt(topic, index, anonymous, maxContentLength) {
    const title = limitText(topic.title || '无标题', 160);
    const limit = Number.isFinite(maxContentLength) ? Math.max(0, Math.floor(maxContentLength)) : DEFAULT_PROMPT_COMMENT_CHARS;
    const content = limitText(topic.content, limit);
    const author = anonymous ? '' : cleanText(topic.author);
    const className = cleanText(topic.className);
    return [
      `${index + 1}. 标题：${title}`,
      className ? `班级：${className}` : '',
      author ? `发言人：${author}` : '',
      `正文：${content}`,
    ].filter(Boolean).join('\n');
  }

  function buildCourseTopicRowsForPrompt(topics, anonymous, maxContentLength) {
    return (Array.isArray(topics) ? topics : [])
      .map((topic, index) => formatCourseTopicForPrompt(topic, index, anonymous, maxContentLength))
      .join('\n');
  }

  function buildIdeologyKeywordPromptBody(rows, anonymous, compressionNote, analysisProfile, localKeywordSummary) {
    const parts = [
      '请对以下超星课程中学生发布的话题标题与正文做深度总结，并结合国家主题与主旋律进行思想政治分析。',
      '只依据学生话题分析；不要补入教师内容；不要把课程通知、教师要求、系统文案当作学生观点。',
      anonymous ? '默认匿名处理：不要输出学生姓名、昵称、学号或可识别个人身份的信息。' : '允许保留昵称：可以在必要时引用发言人昵称，但不要输出学号、手机号等敏感信息。',
      '先保留原来课堂总结的写法：概括讨论主题、主要观点、共识与分歧，再做国家层面的深度思考。',
      '思政分析不要只停留在关键词罗列。请从学生真实表达中提取高频词和关键短语，说明这些词如何相互关联，如何扣回国家治理、公共服务、公平正义、高质量发展、青年责任等国家主题。',
      '如果本地“自动提炼专业概念”仍显得口语化，请主动优化为财政学、公共治理与课程思政中更规范的概念表达，并说明优化后的概念和原文观点之间的对应关系。',
      '可参考但不要机械套用的维度：制度自信、人民性、民生、国家战略、公平性。可根据材料扩展到文化自信、基层治理、国家安全、责任担当等相关维度。',
      '请把学生讨论中体现出的积极价值取向、现实关切和可能需要引导的偏差都说清楚，并尽量落到课程主题与主旋律表达。',
      `教师设定的分析口径：\n${formatAnalysisProfileForPrompt(analysisProfile)}`,
      localKeywordSummary ? formatLocalKeywordSummaryForPrompt(localKeywordSummary) : '',
    ];
    if (compressionNote) parts.push(compressionNote);
    return [
      ...parts,
      '',
      '请严格按以下小标题输出：',
      '1. 讨论总体概括',
      '2. 主要观点与问题意识',
      '3. 国家主题与主旋律关联',
      '4. 思政维度深度分析',
      '5. 高频关键词与关联链路',
      '6. 代表性学生话题摘录',
      '7. 后续讨论引导建议',
      '',
      '学生话题：',
      rows,
    ].join('\n');
  }

  function buildIdeologyKeywordPrompt(topics, anonymous, options) {
    const inputLimit = normalizePromptInputLimit(options && options.maxInputChars);
    const analysisProfile = normalizeAnalysisProfile(options && options.analysisProfile);
    const localKeywordSummary = options && options.localKeywordSummary ? options.localKeywordSummary : buildLocalTeacherAnalysis(topics, analysisProfile);
    let topicLimit = DEFAULT_PROMPT_COMMENT_CHARS;
    let rows = buildCourseTopicRowsForPrompt(topics, anonymous, topicLimit);
    let prompt = buildIdeologyKeywordPromptBody(rows, anonymous, '', analysisProfile, localKeywordSummary);
    if (prompt.length <= inputLimit) return prompt;

    const compressionNote = '输入较长：以下保留全部学生话题序号和标题，但已自动压缩较长正文。请先做整体课堂总结，再做国家主题、主旋律与思政关联分析，不要逐条复述。';
    const emptyRows = buildCourseTopicRowsForPrompt(topics, anonymous, 0);
    const fixedPrompt = buildIdeologyKeywordPromptBody(emptyRows, anonymous, compressionNote, analysisProfile, localKeywordSummary);
    const topicCount = Math.max(1, Array.isArray(topics) ? topics.length : 0);
    const available = Math.max(topicCount, inputLimit - fixedPrompt.length - 32);
    topicLimit = Math.max(MIN_PROMPT_COMMENT_CHARS, Math.min(DEFAULT_PROMPT_COMMENT_CHARS, Math.floor(available / topicCount)));

    rows = buildCourseTopicRowsForPrompt(topics, anonymous, topicLimit);
    prompt = buildIdeologyKeywordPromptBody(rows, anonymous, compressionNote, analysisProfile, localKeywordSummary);
    while (prompt.length > inputLimit && topicLimit > MIN_PROMPT_COMMENT_CHARS) {
      topicLimit = Math.max(MIN_PROMPT_COMMENT_CHARS, Math.floor(topicLimit * 0.8));
      rows = buildCourseTopicRowsForPrompt(topics, anonymous, topicLimit);
      prompt = buildIdeologyKeywordPromptBody(rows, anonymous, compressionNote, analysisProfile, localKeywordSummary);
    }
    if (prompt.length > inputLimit) {
      throw new Error(`学生话题过多，压缩后仍超过模型输入上限（${prompt.length}/${inputLimit} 字符）。请减少话题数量或换用更大上下文模型。`);
    }
    return prompt;
  }

  function buildSummaryPrompt(comments, anonymous, topicContext, options) {
    if (options && options.analysisMode === 'courseTopics') {
      return buildIdeologyKeywordPrompt(comments, anonymous, options);
    }
    const inputLimit = normalizePromptInputLimit(options && options.maxInputChars);
    let commentLimit = DEFAULT_PROMPT_COMMENT_CHARS;
    let rows = buildCommentRowsForPrompt(comments, anonymous, commentLimit);
    let prompt = buildSummaryPromptBody(rows, anonymous, topicContext, '');
    if (prompt.length <= inputLimit) return prompt;

    const compressionNote = '输入较长：以下保留全部回复序号，但已自动压缩较长回复正文，请按整体观点归纳，不要逐条复述。';
    const emptyRows = buildCommentRowsForPrompt(comments, anonymous, 0);
    const fixedPrompt = buildSummaryPromptBody(emptyRows, anonymous, topicContext, compressionNote);
    const commentCount = Math.max(1, Array.isArray(comments) ? comments.length : 0);
    const available = Math.max(commentCount, inputLimit - fixedPrompt.length - 32);
    commentLimit = Math.max(MIN_PROMPT_COMMENT_CHARS, Math.min(DEFAULT_PROMPT_COMMENT_CHARS, Math.floor(available / commentCount)));

    rows = buildCommentRowsForPrompt(comments, anonymous, commentLimit);
    prompt = buildSummaryPromptBody(rows, anonymous, topicContext, compressionNote);
    while (prompt.length > inputLimit && commentLimit > MIN_PROMPT_COMMENT_CHARS) {
      commentLimit = Math.max(MIN_PROMPT_COMMENT_CHARS, Math.floor(commentLimit * 0.8));
      rows = buildCommentRowsForPrompt(comments, anonymous, commentLimit);
      prompt = buildSummaryPromptBody(rows, anonymous, topicContext, compressionNote);
    }
    if (prompt.length > inputLimit) {
      throw new Error(`评论数量过多，压缩后仍超过模型输入上限（${prompt.length}/${inputLimit} 字符）。请减少回复数量或换用更大上下文模型。`);
    }
    return prompt;
  }

  function buildSummarizePrompt(comments, anonymous, topicContext, options) {
    return buildSummaryPrompt(comments, anonymous, topicContext, options);
  }

  async function requestChatCompletion(promptText) {
    const settings = settingsCache || await getSettings().catch(() => null);
    if (!settings) throw new Error('扩展状态已失效，请刷新页面后重试');
    const apiKey = getApiKeyFor(settings, settings.baseUrl);
    if (!apiKey) throw new Error('请先在扩展设置页中配置 API Key');
    const timeoutMs = getRequestTimeoutMs(settings);
    const body = JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: '你是课堂讨论纪要助手，擅长去重、归纳和提炼问题。' },
        { role: 'user', content: promptText },
      ],
      stream: false,
      temperature: 0.2,
    });

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${settings.baseUrl}/chat/completions`, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
      xhr.onload = () => {
        try {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(`AI 请求失败：HTTP ${xhr.status} ${limitText(xhr.responseText, 200)}`));
            return;
          }
          const json = JSON.parse(xhr.responseText);
          const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          if (!content) reject(new Error('AI 未返回有效内容'));
          else resolve(cleanText(content));
        } catch (error) { reject(error); }
      };
      xhr.onerror = () => reject(new Error('AI 请求失败'));
      xhr.ontimeout = () => reject(new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒），请调大超时或减少评论数量`));
      xhr.timeout = timeoutMs;
      xhr.send(body);
    });
  }

  async function summarizeComments(comments, anonymous, topicContext, options) {
    if (!comments.length) throw new Error('没有可总结的评论，请先采集回复');
    const prompt = buildSummarizePrompt(comments, anonymous, topicContext, options);
    const compressed = prompt.includes('输入较长：');
    const unit = options && options.analysisMode === 'courseTopics' ? '个学生话题' : '条回复';
    const verb = options && options.analysisMode === 'courseTopics' ? '深度总结' : '总结';
    setStatus(compressed ? `正在一次性${verb} ${comments.length} ${unit}（已自动压缩超长正文）...` : `正在一次性${verb} ${comments.length} ${unit}...`, 'info');
    return requestChatCompletion(prompt);
  }

  // 被采集上限截断时，面板直接给一个「改成不限制」按钮：写设置 + 清掉本次覆盖值，
  // 用户再点一次「开始分析」就是全量，不用去设置页找下拉框。
  function appendTopicLimitAction() {
    const node = document.getElementById('cx-discussion-summary-status');
    const limit = Number((state.collectionSummary || {}).topicLimit) || 0;
    if (!node || !limit) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `改成不限制（现在只读最新 ${limit} 个话题）`;
    button.style.cssText = 'margin-top:6px;padding:2px 8px;font-size:12px;line-height:1.6;cursor:pointer;border:1px solid currentColor;border-radius:4px;background:transparent;color:inherit;';
    button.onclick = async () => {
      try {
        await storageSet({ [STORAGE_KEYS.maxTopics]: 0 });
        state.maxTopicsOverride = 0;
        setStatus(`已改成不限制：再点一次「开始分析」就会把所选班级的话题全部读完（本次上限 ${limit} 个已取消）`, 'success');
      } catch (error) {
        setStatus(`改成不限制失败：${(error && error.message) || error}`, 'danger');
      }
    };
    node.appendChild(document.createElement('br'));
    node.appendChild(button);
  }

  function setStatus(text, type) {
    text=String(text||'').replace(/^采集已暂停[^\n]*\n/,'');
    if(state.collecting||state.bridgeProgress)state.lastCollectionStatus=text;
    const shown=collectionControl?.paused?'采集已暂停 · 可调整班级、话题和时间后重新采集；不改范围可继续收集。\n'+text:text;
    if(state.bridgeProgress)state.bridgeProgress(shown);
    const node = document.getElementById('cx-discussion-summary-status');
    if (!node) return;
    node.textContent = shown;
    node.dataset.type = type || 'info';
  }

  function updateCount(){const node=document.getElementById('cx-discussion-summary-count');if(node){const p=state.capturePayload;node.textContent=String(p?.captureScope?p.captureSelectedCount:p&&typeof DiscussionAnalysis!=='undefined'?DiscussionAnalysis.createDataset(p).records.length:state.comments.length);}}
  function stripCommentAuthors(comments) {
    return (Array.isArray(comments) ? comments : []).map((comment) => ({ ...comment, author: '' }));
  }
  function commentsForCurrentPrivacy(comments) {
    return currentAnonymousMode() ? stripCommentAuthors(comments) : (Array.isArray(comments) ? comments : []);
  }
  function formatPreviewRows(comments, anonymous) {
    let totalLength = 0;
    const rows = [];
    for (const [index, comment] of (Array.isArray(comments) ? comments : []).entries()) {
      const author = anonymous ? '' : cleanText(comment.author);
      const title = cleanText(comment.title);
      const className = cleanText(comment.className);
      const classLine = className ? `班级：${className}\n` : '';
      const content = title ? `标题：${title}\n${classLine}${comment.content || ''}` : `${classLine}${comment.content || ''}`;
      const row = `${index + 1}. ${author ? `${author}: ` : ''}${content}`;
      totalLength += row.length + 1;
      if (totalLength > MAX_PREVIEW_CHARS) {
        rows.push(`...预览内容较多，已显示前 ${rows.length} 条；完整内容仍会用于分析。`);
        break;
      }
      rows.push(row);
    }
    return rows.join('\n');
  }
  function updatePreview() {
    const node = document.getElementById('cx-discussion-summary-preview');
    if (!node) return;
    node.value = formatPreviewRows(state.comments, currentAnonymousMode());
  }
  function currentAnalysisProfile() {
    const input = typeof document.getElementById === 'function' ? document.getElementById('cx-discussion-summary-analysis-profile') : null;
    if (input && cleanText(input.value)) return parseAnalysisProfileText(input.value);
    return normalizeAnalysisProfile(settingsCache && settingsCache.analysisProfile);
  }
  function refreshLocalAnalysis() {
    state.localAnalysis = buildLocalTeacherAnalysis(state.comments, currentAnalysisProfile());
    return state.localAnalysis;
  }
  function updateKeywords() {
    const section = document.getElementById('cx-discussion-summary-keywords-section');
    const node = document.getElementById('cx-discussion-summary-keywords');
    if (!section || !node) return;
    const isCourseTopicMode = state.analysisMode === 'courseTopics' || shouldUseCourseTopicMode(document);
    section.hidden = !isCourseTopicMode;
    node.innerHTML = '';
    if (!isCourseTopicMode) return;
    const analysis = state.localAnalysis || refreshLocalAnalysis();
    const keywords = analysis.keywords || [];
    const autoKeywords = analysis.autoKeywords || [];
    if (!keywords.length && !autoKeywords.length) {
      const empty = document.createElement('span');
      empty.className = 'cxds-small';
      empty.textContent = '采集后显示关键词';
      node.appendChild(empty);
      return;
    }
    renderKeywordGroup(node, '预设关键词', keywords, '暂无预设命中');
    renderKeywordGroup(node, '自动提炼（专业概念）', autoKeywords, '暂无专业概念');
  }
  function renderKeywordGroup(parent, label, keywords, emptyText) {
    if (!parent) return;
    const group = document.createElement('div');
    group.className = 'cxds-keyword-group';
    const labelNode = document.createElement('div');
    labelNode.className = 'cxds-keyword-label';
    labelNode.textContent = label;
    const chips = document.createElement('div');
    chips.className = 'cxds-keywords';
    (keywords || []).slice(0, 24).forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'cxds-keyword-chip';
      chip.textContent = `${item.term} ${item.count}`;
      chips.appendChild(chip);
    });
    if (!chips.children.length) {
      const empty = document.createElement('span');
      empty.className = 'cxds-small';
      empty.textContent = emptyText || '暂无';
      chips.appendChild(empty);
    }
    group.appendChild(labelNode);
    group.appendChild(chips);
    parent.appendChild(group);
  }
  function renderMetric(parent, label, value) {
    const item = document.createElement('div');
    item.className = 'cxds-metric';
    const valueNode = document.createElement('strong');
    valueNode.textContent = String(value || 0);
    const labelNode = document.createElement('span');
    labelNode.textContent = label;
    item.appendChild(valueNode);
    item.appendChild(labelNode);
    parent.appendChild(item);
  }
  function renderCoverageMetrics(parent, metrics) {
    if (!parent) return;
    const strip = document.createElement('div');
    strip.className = 'cxds-coverage-strip';
    (metrics || []).slice(0, 4).forEach((metric) => {
      const item = document.createElement('div');
      item.className = 'cxds-coverage-card';
      const value = document.createElement('strong');
      value.textContent = `${metric.percent || 0}%`;
      const label = document.createElement('span');
      label.textContent = metric.name || '覆盖率';
      const detail = document.createElement('em');
      detail.textContent = metric.detail || '';
      item.appendChild(value);
      item.appendChild(label);
      item.appendChild(detail);
      strip.appendChild(item);
    });
    parent.appendChild(strip);
  }
  function updateWorkbench(errorText) {
    const workbench = document.getElementById('cx-discussion-summary-workbench');
    if (!workbench) return;
    const analysis = state.localAnalysis || refreshLocalAnalysis();
    const metrics = document.getElementById('cx-discussion-summary-workbench-metrics');
    const contextNode = document.getElementById('cx-discussion-summary-workbench-context');
    const classNode = document.getElementById('cx-discussion-summary-workbench-classes');
    const keywordNode = document.getElementById('cx-discussion-summary-workbench-keywords');
    const dimensionNode = document.getElementById('cx-discussion-summary-workbench-dimensions');
    const summaryNode = document.getElementById('cx-discussion-summary-workbench-summary');
    if (metrics) {
      metrics.innerHTML = '';
      renderMetric(metrics, '学生话题', analysis.topicCount);
      renderMetric(metrics, '班级数', (analysis.classStats || []).length);
      renderMetric(metrics, '预设命中', analysis.totalKeywordHits);
      renderMetric(metrics, '自动关键词', (analysis.autoKeywords || []).length);
      renderMetric(metrics, '主要维度', analysis.topDimension || '暂无');
      renderMetric(metrics, 'AI 状态', state.summary ? '已生成' : (errorText || state.analysisError ? '暂不可用' : '待生成'));
    }
    if (contextNode) contextNode.textContent = formatTopicContextForDisplay(state.topicContext) || '暂无标题或讨论引导';
    if (classNode) {
      classNode.innerHTML = '';
      (analysis.classStats || []).slice(0, 20).forEach((item) => {
        const chip = document.createElement('span');
        chip.className = 'cxds-keyword-chip';
        chip.textContent = item.hits === item.count
          ? `${item.name} ${item.count}个话题`
          : `${item.name} ${item.hits}/${item.count} 个话题有相关表达`;
        classNode.appendChild(chip);
      });
      if (!classNode.children.length) classNode.textContent = '暂未读取到班级信息。';
    }
    if (keywordNode) {
      keywordNode.innerHTML = '';
      renderKeywordGroup(keywordNode, '预设关键词', analysis.keywords || [], '暂未命中教师设定的关键词');
      renderKeywordGroup(keywordNode, '自动提炼（专业概念）', analysis.autoKeywords || [], '暂未提炼出明显专业概念');
    }
    if (dimensionNode) {
      dimensionNode.innerHTML = '';
      renderCoverageMetrics(dimensionNode, analysis.coverageMetrics || []);
      const dimensions = analysis.dimensions || [];
      const maxCount = Math.max(1, ...dimensions.map((item) => item.count));
      const appendDimensionRow = (parent, item) => {
        const row = document.createElement('div');
        row.className = 'cxds-dimension-row';
        const label = document.createElement('span');
        const topicPercent = analysis.topicCount ? Math.round((item.topicCount / analysis.topicCount) * 100) : 0;
        label.textContent = `${item.name} · ${topicPercent}% · ${item.count}次 · ${item.topicCount}个话题`;
        const bar = document.createElement('i');
        bar.style.width = `${Math.max(8, Math.round((item.count / maxCount) * 100))}%`;
        row.appendChild(label);
        row.appendChild(bar);
        parent.appendChild(row);
      };
      dimensions.slice(0, 5).forEach((item) => appendDimensionRow(dimensionNode, item));
      if (dimensions.length > 5) {
        const more = document.createElement('details');
        more.className = 'cxds-dimension-more';
        const summary = document.createElement('summary');
        summary.className = 'cxds-small';
        summary.textContent = `展开其余 ${dimensions.length - 5} 个维度`;
        more.appendChild(summary);
        dimensions.slice(5).forEach((item) => appendDimensionRow(more, item));
        dimensionNode.appendChild(more);
      }
      if (dimensions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cxds-small';
        empty.textContent = '暂未形成明显维度覆盖。';
        dimensionNode.appendChild(empty);
      }
      const uncovered = analysis.uncoveredDimensions || [];
      if (uncovered.length) {
        const gap = document.createElement('div');
        gap.className = 'cxds-dimension-gap cxds-small';
        gap.textContent = `未覆盖维度（0 次）：${uncovered.join('、')}`;
        dimensionNode.appendChild(gap);
      }
      if (analysis.placeholders) {
        const note = document.createElement('div');
        note.className = 'cxds-placeholder-note cxds-small';
        note.textContent = `${analysis.placeholders} 条图片或附件回复只有占位文字，内容没有算进分析。`;
        dimensionNode.appendChild(note);
      }
    }
    if (summaryNode) summaryNode.value = state.summary || `AI 深度总结暂不可用${errorText || state.analysisError ? `：${errorText || state.analysisError}` : '。'}`;
  }
  function updateTopicContext() {
    const node = document.getElementById('cx-discussion-summary-topic-context');
    if (!node) return;
    node.value = formatTopicContextForDisplay(state.topicContext);
  }
  function updateSummary(text) { const node = document.getElementById('cx-discussion-summary-result'); if (node) node.value = text || ''; }

  function getSelectedCourseClassIds() {
    const select = document.getElementById('cx-discussion-summary-class-scope');
    if (!select || !select.options) return [];
    return Array.from(select.options)
      .filter((option) => option.selected)
      .map((option) => normalizeCourseClassId(option.value))
      .filter(Boolean);
  }

  function updateClassScope(options) {
    const section = document.getElementById('cx-discussion-summary-class-section');
    const select = document.getElementById('cx-discussion-summary-class-scope');
    const summary = document.getElementById('cx-discussion-summary-class-summary');
    const isCourseTopicMode = shouldUseCourseTopicMode(document);
    if (section) section.hidden = !isCourseTopicMode;
    if (!select || !isCourseTopicMode) return;
    const selected = new Set(state.selectedClassIds.length ? state.selectedClassIds : getSelectedCourseClassIds());
    const nextOptions = uniqueCourseClassOptions([...(options||[]),...(state.classOptions||[])]);
    state.classOptions = nextOptions;
    select.innerHTML = '';
    nextOptions.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      option.selected = selected.has(item.id);
      select.appendChild(option);
    });
    if (summary) {
      const count = getSelectedCourseClassIds().length;
      summary.textContent = nextOptions.length
        ? `共 ${nextOptions.length} 个班级 · ${count?`已选 ${count} 个`:'未选：采集当前列表范围'}`
        : '暂未读取到班级列表，可先刷新页面或进入“全部话题”。';
    }
    renderClassPicker();
  }
  function renderClassPicker(){
    const list=document.getElementById('cxda-class-list'),search=document.getElementById('cxda-class-search');if(!list)return;
    const query=cleanText(search?.value||'').toLowerCase(),selected=new Set(getSelectedCourseClassIds());list.replaceChildren();
    const visible=state.classOptions.filter(c=>!query||c.name.toLowerCase().includes(query)||c.id.includes(query));
    for(const c of visible){const label=document.createElement('label');label.className='cxda-class-row';const input=document.createElement('input');input.type='checkbox';input.value=c.id;input.checked=selected.has(c.id);input.setAttribute('aria-label',c.name);input.disabled=extensionContextInvalidated||collectionRestarting||collectionPauseChanging||state.loading&&!collectionControl?.paused;const text=document.createElement('span');text.textContent=c.name;label.append(input,text);list.appendChild(label);
      input.onchange=()=>{const option=Array.from(document.getElementById('cx-discussion-summary-class-scope').options).find(o=>o.value===c.id);if(option)option.selected=input.checked;state.selectedClassIds=getSelectedCourseClassIds();updateClassScope(state.classOptions);refreshCaptureTopicChoices();};}
    if(!visible.length){const empty=document.createElement('p');empty.className='cxda-small';empty.textContent=state.classOptions.length?'没有匹配的班级':'班级列表尚未加载';list.appendChild(empty);}
  }

  async function refreshCourseClassOptions() {
    if (!shouldUseCourseTopicMode(document)) return [];
    let options = extractCourseClassOptionsFromDocs(getAllSameOriginDocs(document));
    if (!IS_CHAOXING_COURSE_TOPIC_LIST_PAGE) {
      try {
        const payload = await requestDiscussionFrameAction('getCourseClasses', {});
        options = uniqueCourseClassOptions([...(payload?.classOptions||[]),...options]);
      } catch (error) { }
    }
    updateClassScope(options);
    return options;
  }

  function currentAnonymousMode() {
    const input = document.getElementById('cx-discussion-summary-anonymous');
    if (input) return !!input.checked;
    return DEFAULTS.anonymous;
  }

  function setBusy(isBusy) {
    state.loading = isBusy;
    document.querySelectorAll(`#${PANEL_ID} .cxda-capture-controls input,#${PANEL_ID} .cxda-capture-controls select,#${PANEL_ID} .cxda-capture-controls button,#${PANEL_ID} #cxda-class-list input,#${PANEL_ID} #cxda-class-search,#${PANEL_ID} #cx-discussion-summary-class-scope`).forEach(node=>node.disabled=extensionContextInvalidated||collectionRestarting||collectionPauseChanging||isBusy&&!collectionControl?.paused);
    document.querySelectorAll(`#${PANEL_ID} button`).forEach((button) => { if (button.id !== 'cx-discussion-summary-copy' && button.id !== 'cx-discussion-summary-close') button.disabled = button.id==='cxda-refresh-page'?false:extensionContextInvalidated||collectionRestarting||collectionPauseChanging||isBusy&&!(collectionControl?.paused&&(button.closest('.cxda-capture-controls')||button.hasAttribute('data-capture-scope-button'))); });
    updateCollectionButtons();
    const anonymousInput = document.getElementById('cx-discussion-summary-anonymous');
    if (anonymousInput) anonymousInput.disabled = false;
  }

  function handleCollect(override){return trackCollection(()=>handleCollectRun(override));}
  async function handleCollectRun(override) {
    if (state.loading) return;
    setBusy(true);
    const courseTopicMode = shouldUseCourseTopicMode(document);
    let collectionOptions;try{collectionOptions=override?.captureScope?override:readCaptureOptions(courseTopicMode);}catch(error){setBusy(false);setStatus(error.message,'danger');return;}
    state.collecting=true;beginCollection();captureControlsAtStart=captureControlsStamp();updateCollectionButtons();
    const classCount = collectionOptions.classIds ? collectionOptions.classIds.length : 0;
    setStatus(courseTopicMode
      ? (classCount ? `正在采集已选 ${classCount} 个班级的话题...` : '正在自动滚动并采集学生话题...')
      : '正在自动滚动并采集回复...', 'info');
    try {
      const payload = await collectCurrentPagePayload(collectionOptions);
      await collectionGate();
      if(payload.captureScope&&payload.captureSelectedCount===0&&payload.complete!==true)throw new Error('本时段尚未确认读取完整'+(state.capturePayload?'，上次原记录保留':'')+(payload.collectionWarning?'；'+payload.collectionWarning:''));
      rememberAnalysisPayload(payload);
      if(override?.datasetId)state.datasetId=override.datasetId;
      state.comments = commentsForCurrentPrivacy(payload.comments);
      state.topicContext = normalizeTopicContext(payload.topicContext);
      state.analysisMode = cleanText(payload.analysisMode || (courseTopicMode ? 'courseTopics' : 'discussionReplies'));
      state.rawLoadedCount = Number(payload.rawLoadedCount || 0);
      state.collectionWarning = cleanText(payload.collectionWarning || '');
      state.selectedClassIds = Array.isArray(payload.selectedClassIds)
        ? payload.selectedClassIds.map(normalizeCourseClassId).filter(Boolean)
        : (collectionOptions.classIds || []);
      if (Array.isArray(payload.classOptions)) updateClassScope(payload.classOptions);
      const comments = state.comments;
      if (!document.getElementById("cxda-title")) refreshLocalAnalysis();
      updateCount();
      updateTopicContext();
      if (!document.getElementById("cxda-title")) { updatePreview(); updateKeywords(); updateWorkbench(); }
      // 采集范围说明（按班读取的页数/命中话题数，或「只读了最新 N 个话题，平台累计 M 个」）
      // 必须跟「回复尚未完整」这类提醒一起显示，否则用户只会看到条数变少、看不出是范围限制。
      const scopeNote = (() => {
        const summary = state.collectionSummary || {};
        return cleanText(summary.classScopeNote || summary.scopeNote);
      })();
      if (state.collectionWarning) setStatus(`${state.collectionWarning}${scopeNote ? `\n${scopeNote}` : ''}`, 'warning');
      else if (state.analysisMode === 'courseTopics') { const d=DiscussionAnalysis.createDataset(payload),m=DiscussionAnalysis.calculateMetrics(d),studentTopics=d.records.filter(r=>r.kind==='topic').length;setStatus(`读取完成：${studentTopics} 个学生话题 · ${d.records.filter(r=>r.kind==='reply').length} 条回复 · ${m.participants} 位参与者${scopeNote?` · ${scopeNote}`:''}`,comments.length?'success':'warning'); }
      else if(payload.captureScope)setStatus(`本时段采集完成：${payload.captureSelectedCount} 条发言${payload.collectionSummary?.contextRecords?` · 另有 ${payload.collectionSummary.contextRecords} 条必要背景`:''}${scopeNote?'\n'+scopeNote:''}`,payload.captureSelectedCount?'success':'warning');
      else setStatus(comments.length ? `已加载 ${state.rawLoadedCount} 条回复，采集正文 ${comments.length} 条` : '没有识别到可总结正文，请确认已打开讨论帖', comments.length ? 'success' : 'warning');
      appendTopicLimitAction();
      return payload;
    } catch (error) {
      if(!collectionControl?.cancelled)setStatus(`采集失败：${error.message}`, 'danger');
      return null;
    } finally {
      state.collecting=false;updateCollectionButtons();
      setBusy(false);
    }
  }

  async function handleSummarize() {
    if (state.loading) return;
    setBusy(true);
    setStatus('正在生成总结...', 'info');
    try {
      if (!state.comments.length) {
        const courseTopicMode = shouldUseCourseTopicMode(document);
        const collectionOptions = courseTopicMode ? { classIds: getSelectedCourseClassIds() } : {};
        const payload = await collectCurrentPagePayload(collectionOptions);
        rememberAnalysisPayload(payload);
      state.comments = commentsForCurrentPrivacy(payload.comments);
        state.topicContext = normalizeTopicContext(payload.topicContext);
        state.analysisMode = cleanText(payload.analysisMode || (courseTopicMode ? 'courseTopics' : 'discussionReplies'));
        state.rawLoadedCount = Number(payload.rawLoadedCount || 0);
        state.collectionWarning = cleanText(payload.collectionWarning || '');
        state.selectedClassIds = Array.isArray(payload.selectedClassIds)
          ? payload.selectedClassIds.map(normalizeCourseClassId).filter(Boolean)
          : (collectionOptions.classIds || []);
        if (Array.isArray(payload.classOptions)) updateClassScope(payload.classOptions);
      }
      refreshLocalAnalysis();
      updateCount();
      updateTopicContext();
      updatePreview();
      updateKeywords();
      updateWorkbench();
      const summary = await summarizeComments(state.comments, currentAnonymousMode(), state.topicContext, {
        analysisMode: state.analysisMode,
        analysisProfile: currentAnalysisProfile(),
        localKeywordSummary: state.localAnalysis,
      });
      state.summary = summary;
      state.analysisError = '';
      updateSummary(summary);
      updateWorkbench();
      setStatus('总结完成', 'success');
    } catch (error) {
      setStatus(`总结失败：${error.message}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyze() {
    if (state.loading) return;
    setBusy(true);
    setStatus('正在采集并分析...', 'info');
    try {
      const courseTopicMode = shouldUseCourseTopicMode(document);
      if (!state.comments.length || courseTopicMode) {
        const collectionOptions = courseTopicMode ? { classIds: getSelectedCourseClassIds() } : {};
        const payload = await collectCurrentPagePayload(collectionOptions);
        rememberAnalysisPayload(payload);
      state.comments = commentsForCurrentPrivacy(payload.comments);
        state.topicContext = normalizeTopicContext(payload.topicContext);
        state.analysisMode = cleanText(payload.analysisMode || (courseTopicMode ? 'courseTopics' : 'discussionReplies'));
        state.rawLoadedCount = Number(payload.rawLoadedCount || 0);
        state.collectionWarning = cleanText(payload.collectionWarning || '');
        state.selectedClassIds = Array.isArray(payload.selectedClassIds)
          ? payload.selectedClassIds.map(normalizeCourseClassId).filter(Boolean)
          : (collectionOptions.classIds || []);
        if (Array.isArray(payload.classOptions)) updateClassScope(payload.classOptions);
      }
      refreshLocalAnalysis();
      updateCount();
      updateTopicContext();
      updatePreview();
      updateKeywords();
      openWorkbench();
      try {
        const summary = await summarizeComments(state.comments, currentAnonymousMode(), state.topicContext, {
          analysisMode: state.analysisMode,
          analysisProfile: currentAnalysisProfile(),
          localKeywordSummary: state.localAnalysis,
        });
        state.summary = summary;
        state.analysisError = '';
        updateSummary(summary);
        updateWorkbench();
        setStatus('分析完成，可查看分析报告', 'success');
      } catch (error) {
        state.analysisError = error && error.message ? error.message : String(error);
        updateWorkbench(state.analysisError);
        setStatus(`AI 暂不可用，已保留本地分析：${state.analysisError}`, 'warning');
      }
    } catch (error) {
      setStatus(`分析失败：${error.message}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  function makeBridgeRequestId() {
    return `cxds-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getBridgeFrameInfo() {
    return {
      source: BRIDGE_SOURCE,
      type: 'register',
      href: String(currentLocation.href || ''),
      isTopFrame: IS_TOP_FRAME,
      isDiscussionPage: IS_DISCUSSION_PAGE,
      isCourseTopicListPage: IS_CHAOXING_COURSE_TOPIC_LIST_PAGE,
    };
  }

  async function runBridgeAction(action, payload) {
    if (action === 'collect'||action === 'collectCourseTopics') {beginCollection(false);return trackCollection(async()=>{state.collecting=true;try{const result=await (action==='collect'?collectDiscussionPayload(payload):collectCourseTopicsPayload(payload));await collectionGate();return result;}finally{state.collecting=false;}});}
    if (action === 'getCourseClasses') return { classOptions: extractCourseClassOptionsFromDocs(getAllSameOriginDocs(document)) };
    throw new Error(`未知操作：${action || '空'}`);
  }

  function rejectRuntimePending(errorMessage) {
    for (const [requestId, pending] of Array.from(runtimePending.entries())) {
      runtimePending.delete(requestId);
      rootWindow.clearTimeout(pending.timeout);
      pending.reject(new Error(errorMessage));
    }
  }

  function getBridgeResultPending(requestId, bridgeMap, runtimeMap) {
    const key = String(requestId || '');
    const postMessageMap = bridgeMap || bridgePending;
    const runtimeMapValue = runtimeMap || runtimePending;
    if (postMessageMap && postMessageMap.has(key)) return { map: postMessageMap, pending: postMessageMap.get(key) };
    if (runtimeMapValue && runtimeMapValue.has(key)) return { map: runtimeMapValue, pending: runtimeMapValue.get(key) };
    return { map: null, pending: null };
  }

  function resolveBridgeResultMessage(data) {
    const entry = getBridgeResultPending(data && data.requestId);
    if (!entry.pending || !entry.map) return false;
    entry.map.delete(String(data.requestId || ''));
    rootWindow.clearTimeout(entry.pending.timeout);
    if (data.ok) entry.pending.resolve(data.payload || {});
    else entry.pending.reject(new Error(cleanText(data.error) || '课程话题页返回失败'));
    return true;
  }

  function postRuntimeMessage(message) {
    if (runtimeBridgeSuspended) return false;
    const port = runtimePort;
    if (!port || typeof port.postMessage !== 'function') return false;
    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      return false;
    }
  }

  function postTopBridgeResult(message) {
    if (runtimeBridgeSuspended) return false;
    try {
      if (rootWindow.top && typeof rootWindow.top.postMessage === 'function') {
        rootWindow.top.postMessage(message, '*');
        return true;
      }
    } catch (error) { }
    return false;
  }

  function sendBridgeResult(message) {
    const sentRuntime = postRuntimeMessage(message);
    if (!sentRuntime) postTopBridgeResult(message);
    return sentRuntime;
  }

  async function handleRuntimeBridgeMessage(data) {
    if (!data || data.source !== BRIDGE_SOURCE) return;
    if (data.type === 'result') {
      resolveBridgeResultMessage(data);
      return;
    }
    if(data.type==='progress') {
      const pending=runtimePending.get(String(data.requestId||''));
      if(pending){if(pending.refreshTimeout)pending.refreshTimeout();setStatus(cleanText(data.message),'info');}
      return;
    }

    if (data.type !== 'command' || !runtimePort || runtimeBridgeSuspended) return;
    const commandPort = runtimePort;
    if (data.action === 'collect' && !IS_DISCUSSION_PAGE) return;
    if (data.action === 'collectCourseTopics' && !IS_CHAOXING_COURSE_TOPIC_LIST_PAGE) return;
    if (data.action === 'getCourseClasses' && !IS_CHAOXING_COURSE_TOPIC_LIST_PAGE) return;
    const progress = text => {
      if(runtimePort===commandPort && !runtimeBridgeSuspended)postRuntimeMessage({source:BRIDGE_SOURCE,type:'progress',requestId:data.requestId,message:text});
    };
    if(data.action!=='getCourseClasses')state.bridgeProgress=progress;
    try {
      const payload = await runBridgeAction(data.action, data.payload || {});
      if (runtimeBridgeSuspended || runtimePort !== commandPort) return;
      sendBridgeResult({
        source: BRIDGE_SOURCE,
        type: 'result',
        requestId: data.requestId,
        ok: true,
        payload,
        frameUrl: String(currentLocation.href || ''),
      });
    } catch (error) {
      if (runtimeBridgeSuspended || runtimePort !== commandPort) return;
      sendBridgeResult({
        source: BRIDGE_SOURCE,
        type: 'result',
        requestId: data.requestId,
        ok: false,
        error: error && error.message ? error.message : String(error),
        frameUrl: String(currentLocation.href || ''),
      });
    } finally {
      if(state.bridgeProgress===progress)state.bridgeProgress=null;
    }
  }

  function connectRuntimeBridge() {
    if(extensionContextInvalidated)return false;
    if (runtimeBridgeSuspended) return false;
    if (runtimePort) return true;
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.connect !== 'function') return false;
    let port = null;
    try {
      port = chrome.runtime.connect({ name: BRIDGE_PORT_NAME });
      runtimePort = port;
      port.onMessage.addListener((message) => {
        if (runtimePort === port && !runtimeBridgeSuspended) handleRuntimeBridgeMessage(message);
      });
      port.onDisconnect.addListener(() => {
        // lastError 只在回调内有效；BFCache 关闭端口也会提供这个错误。
        let error;
        try { error = chrome.runtime.lastError; } catch(e) { error=e; }
        if(/Extension context invalidated/i.test(error?.message||''))invalidateExtensionContext();
        if (runtimePort !== port) return;
        runtimePort = null;
        clearRuntimeRegistrationTimer();
        rejectRuntimePending(error && error.message
          ? `讨论页通信已断开：${error.message}。请返回讨论页后重新采集`
          : '讨论页通信已断开，请返回讨论页后重新采集');
      });
      port.postMessage(getBridgeFrameInfo());
      runtimeRegistrationTimer = rootWindow.setTimeout(() => {
        runtimeRegistrationTimer = null;
        try { if (runtimePort === port && !runtimeBridgeSuspended) port.postMessage(getBridgeFrameInfo()); } catch (error) { }
      }, 1200);
      return true;
    } catch (error) {
      if(/Extension context invalidated/i.test(error?.message||''))invalidateExtensionContext();
      if (runtimePort === port) runtimePort = null;
      clearRuntimeRegistrationTimer();
      try { if (port) port.disconnect(); } catch (disconnectError) { }
      return false;
    }
  }

  function clearRuntimeRegistrationTimer() {
    if (runtimeRegistrationTimer !== null) rootWindow.clearTimeout(runtimeRegistrationTimer);
    runtimeRegistrationTimer = null;
  }

  rootWindow.addEventListener('pagehide', () => {
    runtimeBridgeSuspended = true;
    const port = runtimePort;
    runtimePort = null;
    clearRuntimeRegistrationTimer();
    const message = '讨论页面已切换，通信已暂停，请返回讨论页后重新采集';
    rejectRuntimePending(message);
    for (const [requestId, pending] of Array.from(bridgePending.entries())) {
      bridgePending.delete(requestId);
      rootWindow.clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    try { if (port) port.disconnect(); } catch (error) { }
  });

  rootWindow.addEventListener('pageshow', () => {
    runtimeBridgeSuspended = false;
    connectRuntimeBridge();
  });

  async function ensureRuntimeBridgeReady() {
    if (runtimeBridgeSuspended) return false;
    if (runtimePort) return true;
    if (!connectRuntimeBridge()) return false;
    await sleep(60);
    return !!runtimePort;
  }

  function requestRuntimeDiscussionFrameAction(action, payload) {
    if (runtimeBridgeSuspended || !runtimePort) return Promise.reject(new Error('扩展后台通信未就绪'));
    return new Promise((resolve, reject) => {
      const requestId = makeBridgeRequestId();
      const startedAt=Date.now();
      const fail = () => {
        runtimePending.delete(requestId);
        reject(new Error(action === 'collectCourseTopics'
          ? '课程话题页响应超时，请确认“全部话题”页面没有被浏览器冻结'
          : '讨论回复页响应超时，请确认页面没有被浏览器冻结'));
      };
      const timeout = rootWindow.setTimeout(fail, getBridgeResponseTimeoutMs(action));
      const pending={resolve,reject,timeout,refreshTimeout:()=>{
        if(pending.pausedAt)return;
        rootWindow.clearTimeout(pending.timeout);
        pending.timeout=rootWindow.setTimeout(fail,Math.max(1,Math.min(getBridgeResponseTimeoutMs(action),15*60*1000-(Date.now()-startedAt-(pending.pausedMs||0)))));
      }};
      runtimePending.set(requestId, pending);
      try {
        runtimePort.postMessage({
          source: BRIDGE_SOURCE,
          type: 'command',
          action,
          requestId,
          payload: payload || {},
        });
      } catch (error) {
        rootWindow.clearTimeout(timeout);
        runtimePending.delete(requestId);
        reject(new Error('扩展后台通信失败，请刷新页面后重试'));
      }
    });
  }

  function getBridgeResponseTimeoutMs(action) {
    return action === 'collectCourseTopics' ? COURSE_TOPIC_BRIDGE_TIMEOUT_MS : DEFAULT_BRIDGE_TIMEOUT_MS;
  }

  function forwardBridgeCommandToChildFrames(message) {
    const frames = Array.from(document.querySelectorAll('iframe') || []);
    let sent = false;
    for (const frame of frames) {
      try {
        if (frame.contentWindow && typeof frame.contentWindow.postMessage === 'function') {
          frame.contentWindow.postMessage(message, '*');
          sent = true;
        }
      } catch (error) { }
    }
    return sent;
  }

  function requestPostMessageDiscussionFrameAction(action, payload) {
    if (runtimeBridgeSuspended) return Promise.reject(new Error('讨论页面已切换，请返回讨论页后重新采集'));
    return new Promise((resolve, reject) => {
      const requestId = makeBridgeRequestId();
      const fail = () => {
        bridgePending.delete(requestId);
        reject(new Error(action === 'collectCourseTopics'
          ? '没有找到正在运行的课程话题页，请先打开课程“全部话题”后再试'
          : '没有找到正在运行的讨论回复页，请先打开讨论详情后再试'));
      };
      const timeout=rootWindow.setTimeout(fail,getBridgeResponseTimeoutMs(action));
      const pending={resolve,reject,timeout,refreshTimeout:()=>{if(pending.pausedAt)return;rootWindow.clearTimeout(pending.timeout);pending.timeout=rootWindow.setTimeout(fail,getBridgeResponseTimeoutMs(action));}};
      bridgePending.set(requestId,pending);
      const sent = forwardBridgeCommandToChildFrames({
        source: BRIDGE_SOURCE,
        type: 'command',
        action,
        requestId,
        payload: payload || {},
      });
      if (!sent) {
        rootWindow.clearTimeout(timeout);
        bridgePending.delete(requestId);
        reject(new Error(action === 'collectCourseTopics'
          ? '当前页面没有可通信的课程话题框架，请先进入课程“全部话题”页面'
          : '当前页面没有可通信的讨论回复框架，请先进入讨论详情页'));
      }
    });
  }

  function chooseBridgeFailureError(runtimeError, fallbackError, action) {
    const runtimeMessage = runtimeError && runtimeError.message ? runtimeError.message : '';
    const fallbackMessage = fallbackError && fallbackError.message ? fallbackError.message : '';
    if (action === 'collectCourseTopics'
      && runtimeMessage
      && /课程话题框架|topicList|注入失败|通信注册|课程话题页响应超时/.test(runtimeMessage)
      && /没有找到正在运行的课程话题页|当前页面没有可通信的课程话题框架/.test(fallbackMessage)) {
      return runtimeError;
    }
    return fallbackError || runtimeError || new Error('课程话题页通信失败，请刷新页面后重试');
  }

  async function requestDiscussionFrameAction(action, payload) {
    await collectionGate();
    let runtimeError = null;
    await ensureRuntimeBridgeReady();
    await collectionGate();
    if(extensionContextInvalidated)throw new Error('扩展已更新，请刷新当前课程页后重试');
    if (runtimePort) {
      try {
        return await requestRuntimeDiscussionFrameAction(action, payload);
      } catch (error) {
        runtimeError = error;
        if(action==='getCourseClasses'&&/当前页面没有找到 topicList 话题框架/.test(error?.message||''))throw error;
        const message = error && error.message ? error.message : String(error);
        if (!/没有找到|通信|响应超时|后台/.test(message)) throw error;
      }
    }
    try {
      return await requestPostMessageDiscussionFrameAction(action, payload);
    } catch (fallbackError) {
      throw chooseBridgeFailureError(runtimeError, fallbackError, action);
    }
  }

  async function handleBridgeCommandMessage(data) {
    if (!data || data.source !== BRIDGE_SOURCE || data.type !== 'command') return;
    if (IS_DISCUSSION_PAGE || IS_CHAOXING_COURSE_TOPIC_LIST_PAGE) {
      const targetWindow = rootWindow.top || rootWindow.parent || rootWindow;
      const postResult = (message) => {
        if (targetWindow && typeof targetWindow.postMessage === 'function') targetWindow.postMessage(message, '*');
      };
      try {
        const payload = await runBridgeAction(data.action, data.payload || {});
        postResult({
          source: BRIDGE_SOURCE,
          type: 'result',
          requestId: data.requestId,
          ok: true,
          payload,
          frameUrl: String(currentLocation.href || ''),
        });
      } catch (error) {
        postResult({
          source: BRIDGE_SOURCE,
          type: 'result',
          requestId: data.requestId,
          ok: false,
          error: error && error.message ? error.message : String(error),
          frameUrl: String(currentLocation.href || ''),
        });
      }
      return;
    }
    forwardBridgeCommandToChildFrames(data);
  }

  function handleBridgeResultMessage(data) {
    if (!data || data.source !== BRIDGE_SOURCE || data.type !== 'result') return;
    resolveBridgeResultMessage(data);
  }

  rootWindow.addEventListener('message', (event) => {
    const data = event && event.data;
    if (!data || data.source !== BRIDGE_SOURCE) return;
    if (data.type === 'command') handleBridgeCommandMessage(data);
    else if (IS_TOP_FRAME && data.type === 'result') handleBridgeResultMessage(data);
  });

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
    else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
  }

  function openWorkbench() {
    if (typeof DiscussionAnalysis !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return publishAnalysisDataset(true).catch(error => setStatus(error.message, 'danger'));
    }
    const workbench = document.getElementById('cx-discussion-summary-workbench');
    if (!workbench) return;
    refreshLocalAnalysis();
    updateWorkbench();
    workbench.hidden = false;
  }

  function closeWorkbench() {
    const workbench = document.getElementById('cx-discussion-summary-workbench');
    if (workbench) workbench.hidden = true;
  }

  async function handleCopy() {
    const result = state.summary || (document.getElementById('cx-discussion-summary-result') || {}).value || '';
    if (!result) { setStatus('没有可复制的总结', 'warning'); return; }
    try {
      await copyTextToClipboard(result);
      setStatus('已复制总结', 'success');
    } catch (error) { setStatus(`复制失败：${error.message}`, 'danger'); }
  }

  async function handleCopyAnalysisReport() {
    refreshLocalAnalysis();
    const report = buildTeacherAnalysisReport({
      comments: state.comments,
      topicContext: state.topicContext,
      analysis: state.localAnalysis,
      summary: state.summary,
      error: state.analysisError,
      anonymous: currentAnonymousMode(),
    });
    try {
      await copyTextToClipboard(report);
      setStatus('已复制分析报告', 'success');
    } catch (error) {
      setStatus(`复制分析报告失败：${error.message}`, 'danger');
    }
  }

  async function handleSetKey() {
    const settings = settingsCache || await getSettings();
    const current = getApiKeyFor(settings, settings.baseUrl);
    const next = rootWindow.prompt('请输入 API Key', current);
    if (next != null && cleanText(next)) {
      await saveKeyFor(settings.baseUrl, cleanText(next));
      setStatus('API Key 已保存', 'success');
    }
  }

  function injectStyle() {
    if (document.getElementById('cx-discussion-summary-style')) return;
    const style = document.createElement('style');
    style.id = 'cx-discussion-summary-style';
    style.textContent = `
      #${TOGGLE_ID} { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; border: 0; border-radius: 6px; background: #176ae5; color: #fff; padding: 9px 12px; font-size: 13px; line-height: 1; box-shadow: 0 6px 18px rgba(0,0,0,.18); cursor: pointer; }
      #${PANEL_ID} { position: fixed; right: 18px; bottom: 58px; z-index: 2147483000; width: 520px; max-width: calc(100vw - 36px); max-height: calc(100vh - 78px); display: flex; flex-direction: column; overflow: hidden; background: #fff; color: #1f2937; border: 1px solid #d9e2ef; border-radius: 8px; box-shadow: 0 12px 32px rgba(15,23,42,.22); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; }
      #${PANEL_ID}[hidden] { display: none !important; }
      #${PANEL_ID} .cxds-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #e5edf7; background: #f7faff; border-radius: 8px 8px 0 0; }
      #${PANEL_ID} .cxds-title { font-weight: 600; }
      #${PANEL_ID} .cxds-body { padding: 12px; overflow: auto; }
      #${PANEL_ID} .cxds-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
      #${PANEL_ID} .cxds-meta-row { justify-content: space-between; flex-wrap: nowrap; }
      #${PANEL_ID} .cxds-action-hint { margin: -2px 0 10px; color: #64748b; font-size: 12px; line-height: 1.45; }
      #${PANEL_ID} .cxds-section { margin-bottom: 12px; padding: 10px; border: 1px solid #e7edf7; border-radius: 10px; background: #fafcff; }
      #${PANEL_ID} .cxds-section-title { font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 8px; }
      #${PANEL_ID} .cxds-help summary { cursor: pointer; color: #475569; font-size: 12px; font-weight: 650; }
      #${PANEL_ID} .cxds-help ol { margin: 8px 0 0 18px; padding: 0; color: #64748b; font-size: 12px; line-height: 1.55; }
      #${PANEL_ID} .cxds-help li { margin: 3px 0; }
      #${PANEL_ID} .cxds-grid { display: grid; grid-template-columns: 1fr 112px; gap: 8px; width: 100%; }
      #${PANEL_ID} button { border: 1px solid #c7d5e8; background: #fff; color: #1f2937; border-radius: 6px; padding: 6px 9px; cursor: pointer; font-size: 13px; }
      #${PANEL_ID} button.primary { background: #176ae5; border-color: #176ae5; color: #fff; }
      #${PANEL_ID} button:disabled { opacity: .55; cursor: not-allowed; }
      #${PANEL_ID} label { display: inline-flex; align-items: center; gap: 5px; user-select: none; }
      #${PANEL_ID} .cxds-inline-check { flex: 0 0 auto; min-width: max-content; white-space: nowrap; gap: 7px; }
      #${PANEL_ID} textarea, #${PANEL_ID} input, #${PANEL_ID} select { width: 100%; box-sizing: border-box; border: 1px solid #d6dfec; border-radius: 6px; padding: 8px; font-size: 13px; }
      #${PANEL_ID} input[type="checkbox"] { -webkit-appearance: checkbox !important; appearance: auto !important; display: inline-block !important; position: static !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; width: 16px; height: 16px; min-width: 16px; flex: 0 0 16px; margin: 0; padding: 0; accent-color: #176ae5; cursor: pointer; }
      #${PANEL_ID} textarea { resize: vertical; line-height: 1.5; }
      #cx-discussion-summary-class-scope { min-height: 108px; background: #fff; }
      #cx-discussion-summary-class-scope option { padding: 5px 6px; }
      #cx-discussion-summary-topic-context { min-height: 70px; }
      #cx-discussion-summary-preview { min-height: 90px; }
      #cx-discussion-summary-result { min-height: 360px; }
      #${PANEL_ID} .cxds-small { color: #64748b; font-size: 12px; }
      #${PANEL_ID} .cxds-disclaimer { color: #94a3b8; font-size: 11px; line-height: 1.45; padding: 0 2px 2px; text-align: center; }
      #${PANEL_ID} .cxds-chip {
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        background: #eef4ff;
        border-color: #d5e2ff;
      }
      #${PANEL_ID} .cxds-keywords, #cx-discussion-summary-workbench .cxds-keywords { display: flex; flex-wrap: wrap; gap: 6px; }
      #${PANEL_ID} .cxds-keyword-group, #cx-discussion-summary-workbench .cxds-keyword-group { display: grid; gap: 6px; width: 100%; margin-bottom: 10px; }
      #${PANEL_ID} .cxds-keyword-label, #cx-discussion-summary-workbench .cxds-keyword-label { color: #64748b; font-size: 12px; font-weight: 600; }
      #${PANEL_ID} .cxds-keyword-chip, #cx-discussion-summary-workbench .cxds-keyword-chip { display: inline-flex; align-items: center; border: 1px solid #d5e2ff; border-radius: 999px; background: #eef4ff; color: #1f3a68; padding: 4px 8px; font-size: 12px; line-height: 1.2; }
      #cx-discussion-summary-workbench { position: fixed; inset: 5vh 5vw; z-index: 2147483001; display: flex; flex-direction: column; background: #fff; color: #1f2937; border: 1px solid #d9e2ef; border-radius: 8px; box-shadow: 0 18px 48px rgba(15,23,42,.28); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; overflow: hidden; }
      #cx-discussion-summary-workbench[hidden] { display: none !important; }
      #cx-discussion-summary-workbench .cxds-workbench-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #e5edf7; background: #f7faff; }
      #cx-discussion-summary-workbench .cxds-workbench-title { font-weight: 650; font-size: 16px; }
      #cx-discussion-summary-workbench .cxds-workbench-body { padding: 14px 16px; overflow: auto; display: grid; grid-template-columns: minmax(260px, 360px) 1fr; gap: 12px; }
      #cx-discussion-summary-workbench .cxds-workbench-section { border: 1px solid #e7edf7; border-radius: 8px; background: #fafcff; padding: 12px; margin-bottom: 12px; }
      #cx-discussion-summary-workbench .cxds-metrics { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)); gap: 8px; padding: 12px 16px; border-bottom: 1px solid #e5edf7; }
      #cx-discussion-summary-workbench .cxds-metric { border: 1px solid #e7edf7; border-radius: 8px; padding: 8px; background: #fff; }
      #cx-discussion-summary-workbench .cxds-metric strong { display: block; font-size: 18px; color: #174ea6; margin-bottom: 2px; }
      #cx-discussion-summary-workbench .cxds-metric span { color: #64748b; font-size: 12px; }
      #cx-discussion-summary-workbench .cxds-coverage-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
      #cx-discussion-summary-workbench .cxds-coverage-card { border: 1px solid #cfe0ff; border-left: 3px solid #176ae5; border-radius: 8px; background: #f2f7ff; padding: 8px; }
      #cx-discussion-summary-workbench .cxds-coverage-card strong { display: block; color: #174ea6; font-size: 20px; line-height: 1; margin-bottom: 4px; }
      #cx-discussion-summary-workbench .cxds-coverage-card span { display: block; color: #1f3a68; font-size: 12px; font-weight: 650; }
      #cx-discussion-summary-workbench .cxds-coverage-card em { display: block; margin-top: 3px; color: #64748b; font-size: 11px; font-style: normal; line-height: 1.35; }
      #cx-discussion-summary-workbench .cxds-dimension-row { display: grid; gap: 5px; margin-bottom: 9px; }
      #cx-discussion-summary-workbench .cxds-dimension-row span { color: #334155; font-size: 12px; }
      #cx-discussion-summary-workbench .cxds-dimension-row i { display: block; height: 7px; border-radius: 999px; background: #176ae5; }
      #cx-discussion-summary-workbench .cxds-dimension-gap { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #d6dfec; color: #9a5b00; }
      #cx-discussion-summary-workbench .cxds-dimension-more { margin-top: 6px; }
      #cx-discussion-summary-workbench .cxds-dimension-more > summary { cursor: pointer; color: #25545a; }
      #cx-discussion-summary-workbench .cxds-placeholder-note { margin-top: 6px; color: #9a5b00; }
      #cx-discussion-summary-workbench textarea { width: 100%; min-height: 360px; box-sizing: border-box; border: 1px solid #d6dfec; border-radius: 6px; padding: 10px; line-height: 1.55; font-size: 13px; resize: vertical; }
      #cx-discussion-summary-workbench button { border: 1px solid #c7d5e8; background: #fff; color: #1f2937; border-radius: 6px; padding: 6px 9px; cursor: pointer; font-size: 13px; }
      #cx-discussion-summary-workbench button.primary { background: #176ae5; border-color: #176ae5; color: #fff; }
      #cx-discussion-summary-status { margin-top: 8px; color: #64748b; }
      #cx-discussion-summary-status[data-type="success"] { color: #16803c; }
      #cx-discussion-summary-status[data-type="warning"] { color: #9a5b00; }
      #cx-discussion-summary-status[data-type="danger"] { color: #c0262d; }
      @media (max-width: 520px) {
        #${TOGGLE_ID} { right: 10px; bottom: 10px; }
        #${PANEL_ID} { left: 10px; right: 10px; bottom: 48px; width: auto; max-width: none; max-height: calc(100vh - 62px); }
        #${PANEL_ID} .cxds-grid { grid-template-columns: 1fr; }
        #cx-discussion-summary-workbench { inset: 12px; }
        #cx-discussion-summary-workbench .cxds-metrics { grid-template-columns: repeat(2, minmax(110px, 1fr)); }
        #cx-discussion-summary-workbench .cxds-workbench-body { grid-template-columns: 1fr; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  async function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    injectStyle();
    const courseTopicMode = shouldUseCourseTopicMode(document);
    const collectLabel = courseTopicMode ? '只采集话题' : '只采集回复';
    const summarizeLabel = courseTopicMode ? '生成总结' : '生成总结';
    const actionHint = courseTopicMode
      ? '采集并分析：自动采集、提取关键词、生成分析报告。生成总结：只生成 AI 总结。'
      : '生成总结会先采集回复，再生成 AI 总结。';
    const emptyStatus = courseTopicMode ? '打开课程话题页后点击“采集并分析”。' : '打开讨论帖后点击“生成总结”。';
    const usageItems = (courseTopicMode ? [
      '先在“班级范围”勾选要统计的班级；统计全部请点“全选班级”。',
      '点击“采集并分析”会自动采集话题、提取专业概念并生成分析报告。',
      '点击“查看分析”可以看覆盖率、维度条、班级统计并复制分析报告。',
      'API Key 和模型设置在底部，一般首次配置一次即可。',
    ] : [
      '打开讨论详情页后，点击“生成总结”。',
      '插件会尽量自动加载到“已经到底了”，再整理学生回复正文。',
      '默认开启匿名处理，复制或总结时会尽量去掉姓名等可识别信息。',
      'API Key 和模型设置在底部，一般首次配置一次即可。',
    ]).map((item) => `<li>${item}</li>`).join('');

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.type = 'button';
    toggle.textContent = '讨论分析';
    document.body.appendChild(toggle);

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.hidden = true;
    panel.innerHTML = `
      <div class="cxds-header"><div class="cxds-title">课堂讨论分析</div><button type="button" id="cx-discussion-summary-close">收起</button></div>
      <div class="cxds-body">
        <div class="cxds-section">
          <div class="cxds-section-title">开始分析</div>
          <div class="cxds-row"><button type="button" class="primary" id="cx-discussion-summary-analyze"${courseTopicMode ? '' : ' hidden'}>采集并分析</button><button type="button" id="cx-discussion-summary-summarize">${summarizeLabel}</button><button type="button" id="cx-discussion-summary-collect">${collectLabel}</button><button type="button" id="cx-discussion-summary-open-workbench"${courseTopicMode ? '' : ' hidden'}>查看分析</button></div>
          <div class="cxds-action-hint">${actionHint}</div>
          <div class="cxds-row cxds-meta-row"><label class="cxds-inline-check"><input type="checkbox" id="cx-discussion-summary-anonymous"> 匿名处理</label><span class="cxds-small">已采集 <strong id="cx-discussion-summary-count">0</strong> 条</span></div>
        </div>
        <details class="cxds-section cxds-help">
          <summary>使用说明</summary>
          <ol>${usageItems}</ol>
        </details>
        <div class="cxds-section" id="cx-discussion-summary-class-section"${courseTopicMode ? '' : ' hidden'}>
          <div class="cxds-section-title">班级范围</div>
          <select id="cx-discussion-summary-class-scope" multiple size="5" aria-label="班级范围"></select>
          <div class="cxds-row"><button type="button" id="cx-discussion-summary-refresh-classes">刷新班级</button><button type="button" id="cx-discussion-summary-select-all-classes">全选班级</button><span class="cxds-small" id="cx-discussion-summary-class-summary">读取班级中...</span></div>
          <div class="cxds-small">可多选；统计全部班级请点击“全选班级”。</div>
        </div>
        <div class="cxds-section" id="cx-discussion-summary-analysis-profile-section"${courseTopicMode ? '' : ' hidden'}>
          <div class="cxds-section-title">分析维度</div>
          <textarea id="cx-discussion-summary-analysis-profile" rows="5" placeholder="每行一个维度，如：制度自信：制度优势、国家治理"></textarea>
          <div class="cxds-row"><button type="button" id="cx-discussion-summary-save-profile">保存维度</button><button type="button" id="cx-discussion-summary-reset-profile">恢复默认维度</button></div>
        </div>
        <div class="cxds-section">
          <div class="cxds-section-title">题目与引导</div>
          <textarea id="cx-discussion-summary-topic-context" rows="3" readonly placeholder="采集后显示识别到的题目和引导语"></textarea>
        </div>
        <div class="cxds-section">
          <div class="cxds-section-title">采集预览</div>
          <textarea id="cx-discussion-summary-preview" rows="3" readonly placeholder="采集后显示学生讨论内容"></textarea>
        </div>
        <div class="cxds-section" id="cx-discussion-summary-keywords-section"${courseTopicMode ? '' : ' hidden'}>
          <div class="cxds-section-title">关键词</div>
          <div id="cx-discussion-summary-keywords" class="cxds-keywords"><span class="cxds-small">采集后显示关键词</span></div>
        </div>
        <div class="cxds-section">
          <div class="cxds-section-title">AI 总结</div>
          <textarea id="cx-discussion-summary-result" rows="16" placeholder="生成后的总结会显示在这里"></textarea>
          <div class="cxds-row"><button type="button" id="cx-discussion-summary-copy">复制 AI 总结</button></div>
          <div id="cx-discussion-summary-status" data-type="info">${emptyStatus}</div>
        </div>
        <div class="cxds-section">
          <div class="cxds-section-title">常用接口</div>
          <div class="cxds-row" id="cx-discussion-summary-recent"></div>
        </div>
        <div class="cxds-section">
          <div class="cxds-section-title">AI 设置</div>
          <div class="cxds-row"><div style="width:100%"><label class="cxds-small" for="cx-discussion-summary-api-key">API Key</label><input id="cx-discussion-summary-api-key" type="password" placeholder="请输入 API Key"></div></div>
          <div class="cxds-row"><div class="cxds-grid"><div><label class="cxds-small" for="cx-discussion-summary-model">模型</label><input id="cx-discussion-summary-model" type="text" placeholder="例如 qwen3.6-plus"></div><div><label class="cxds-small" for="cx-discussion-summary-timeout">超时(秒)</label><input id="cx-discussion-summary-timeout" type="number" min="30" max="600" step="30"></div></div></div>
          <div class="cxds-row"><div style="width:100%"><label class="cxds-small" for="cx-discussion-summary-base-url">接口地址</label><select id="cx-discussion-summary-base-url-preset" style="width:100%;margin-bottom:6px"></select><input id="cx-discussion-summary-base-url" type="text" placeholder="例如 https://dashscope.aliyuncs.com/compatible-mode/v1"></div></div>
          <div class="cxds-row"><button type="button" id="cx-discussion-summary-save-config">保存设置</button><button type="button" id="cx-discussion-summary-reset-config">恢复默认设置</button><button type="button" id="cx-discussion-summary-set-key">保存 Key</button></div>
        </div>
        <div class="cxds-disclaimer">AI 生成内容仅供教学分析参考，请结合课程实际与学生原文判断。</div>
      </div>
    `;
    document.body.appendChild(panel);

    const workbench = document.createElement('section');
    workbench.id = 'cx-discussion-summary-workbench';
    workbench.hidden = true;
    workbench.innerHTML = `
      <div class="cxds-workbench-header">
        <div class="cxds-workbench-title">教师分析</div>
        <div class="cxds-row"><button type="button" class="primary" id="cx-discussion-summary-copy-report">复制分析报告</button><button type="button" id="cx-discussion-summary-workbench-close">关闭</button></div>
      </div>
      <div class="cxds-metrics" id="cx-discussion-summary-workbench-metrics"></div>
      <div class="cxds-workbench-body">
        <div>
          <div class="cxds-workbench-section">
            <div class="cxds-section-title">题目与引导</div>
            <div id="cx-discussion-summary-workbench-context" class="cxds-small"></div>
          </div>
          <div class="cxds-workbench-section">
            <div class="cxds-section-title">班级统计</div>
            <div id="cx-discussion-summary-workbench-classes" class="cxds-keywords"></div>
          </div>
          <div class="cxds-workbench-section">
            <div class="cxds-section-title">关键词</div>
            <div id="cx-discussion-summary-workbench-keywords" class="cxds-keywords"></div>
          </div>
          <div class="cxds-workbench-section">
            <div class="cxds-section-title">思政维度覆盖</div>
            <div id="cx-discussion-summary-workbench-dimensions"></div>
          </div>
          <div class="cxds-workbench-section">
            <div class="cxds-section-title">后续课堂引导建议</div>
            <div class="cxds-small">可将 AI 总结中的建议整理后用于课堂反馈。</div>
          </div>
        </div>
        <div class="cxds-workbench-section">
          <div class="cxds-section-title">AI 总结</div>
          <textarea id="cx-discussion-summary-workbench-summary" readonly placeholder="采集并分析后显示 AI 总结；AI 不可用时仍会保留本地分析。"></textarea>
        </div>
      </div>
    `;
    document.body.appendChild(workbench);

    const settings = await getSettings();
    settingsCache = settings;
    const anonymousInput = document.getElementById('cx-discussion-summary-anonymous');
    const apiKeyInput = document.getElementById('cx-discussion-summary-api-key');
    const modelInput = document.getElementById('cx-discussion-summary-model');
    const timeoutInput = document.getElementById('cx-discussion-summary-timeout');
    const baseUrlPreset = document.getElementById('cx-discussion-summary-base-url-preset');
    const baseUrlInput = document.getElementById('cx-discussion-summary-base-url');
    const analysisProfileInput = document.getElementById('cx-discussion-summary-analysis-profile');
    const recentContainer = document.getElementById('cx-discussion-summary-recent');
    const classScopeSelect = document.getElementById('cx-discussion-summary-class-scope');
    const refreshClassesButton = document.getElementById('cx-discussion-summary-refresh-classes');
    const selectAllClassesButton = document.getElementById('cx-discussion-summary-select-all-classes');

    baseUrlPreset.innerHTML = URL_PRESETS.map((item) => `<option value="${item.url}">${item.name}</option>`).join('');
    anonymousInput.disabled = false;
    anonymousInput.checked = settings.anonymous;
    apiKeyInput.value = getApiKeyFor(settings, settings.baseUrl);
    modelInput.value = settings.model;
    timeoutInput.value = String(settings.requestTimeoutSeconds);
    baseUrlInput.value = settings.baseUrl;
    baseUrlPreset.value = matchPreset(baseUrlInput.value)?.url || '';
    analysisProfileInput.value = formatAnalysisProfileForDisplay(settings.analysisProfile);

    function renderRecent() {
      const current = settingsCache || settings;
      const list = Array.isArray(current.recent) ? current.recent : [];
      const items = [normalizeUrl(baseUrlInput.value), ...list].filter(Boolean);
      const seen = new Set();
      recentContainer.innerHTML = '';
      items.forEach((url) => {
        const normalized = normalizeUrl(url);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        const preset = matchPreset(normalized);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cxds-chip';
        chip.textContent = preset ? preset.name : normalized;
        chip.title = normalized;
        chip.addEventListener('click', async () => {
          const latest = settingsCache || settings;
          baseUrlInput.value = normalized;
          baseUrlPreset.value = preset ? preset.url : '';
          apiKeyInput.value = getApiKeyFor(latest, normalized);
          await pushRecent(normalized);
          renderRecent();
          setStatus(preset ? `已切换到：${preset.name}` : '已切换到自定义地址', 'success');
        });
        recentContainer.appendChild(chip);
      });
    }
    renderRecent();
    updateTopicContext();
    updateKeywords();
    updateClassScope([]);
    if (courseTopicMode) refreshCourseClassOptions();

    baseUrlPreset.addEventListener('change', async () => {
      if (!baseUrlPreset.value) return;
      const latest = settingsCache || settings;
      baseUrlInput.value = baseUrlPreset.value;
      apiKeyInput.value = getApiKeyFor(latest, baseUrlPreset.value);
      await pushRecent(baseUrlPreset.value);
      renderRecent();
    });
    baseUrlInput.addEventListener('input', () => {
      const latest = settingsCache || settings;
      const normalized = normalizeUrl(baseUrlInput.value);
      baseUrlPreset.value = matchPreset(normalized)?.url || '';
      apiKeyInput.value = getApiKeyFor(latest, normalized);
      renderRecent();
    });
    anonymousInput.addEventListener('change', async () => {
      await saveSettings({ [STORAGE_KEYS.anonymous]: anonymousInput.checked });
      if (anonymousInput.checked) state.comments = stripCommentAuthors(state.comments);
      refreshLocalAnalysis();
      updatePreview();
      updateKeywords();
      updateWorkbench();
    });
    analysisProfileInput.addEventListener('input', () => {
      refreshLocalAnalysis();
      updateKeywords();
      updateWorkbench();
    });
    if (classScopeSelect) {
      classScopeSelect.addEventListener('change', () => {
        state.selectedClassIds = getSelectedCourseClassIds();
        updateClassScope(state.classOptions);
      });
    }
    if (refreshClassesButton) {
      refreshClassesButton.addEventListener('click', async () => {
        setStatus('正在读取班级列表...', 'info');
        const options = await refreshCourseClassOptions();
        setStatus(options.length ? `已读取 ${options.length} 个班级` : '没有读取到班级列表，请确认已进入“全部话题”。', options.length ? 'success' : 'warning');
      });
    }
    if (selectAllClassesButton) {
      selectAllClassesButton.addEventListener('click', () => {
        if (!classScopeSelect) return;
        Array.from(classScopeSelect.options || []).forEach((option) => { option.selected = true; });
        state.selectedClassIds = getSelectedCourseClassIds();
        updateClassScope(state.classOptions);
      });
    }

    toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; });
    document.getElementById('cx-discussion-summary-close').addEventListener('click', () => { panel.hidden = true; });
    document.getElementById('cx-discussion-summary-collect').addEventListener('click', handleCollect);
    document.getElementById('cx-discussion-summary-summarize').addEventListener('click', handleSummarize);
    document.getElementById('cx-discussion-summary-analyze').addEventListener('click', handleAnalyze);
    document.getElementById('cx-discussion-summary-open-workbench').addEventListener('click', openWorkbench);
    document.getElementById('cx-discussion-summary-copy').addEventListener('click', handleCopy);
    document.getElementById('cx-discussion-summary-copy-report').addEventListener('click', handleCopyAnalysisReport);
    document.getElementById('cx-discussion-summary-workbench-close').addEventListener('click', closeWorkbench);
    document.getElementById('cx-discussion-summary-set-key').addEventListener('click', handleSetKey);
    document.getElementById('cx-discussion-summary-save-profile').addEventListener('click', async () => {
      const profile = currentAnalysisProfile();
      await saveSettings({ [STORAGE_KEYS.analysisProfile]: profile });
      settingsCache = { ...(settingsCache || settings), analysisProfile: profile };
      analysisProfileInput.value = formatAnalysisProfileForDisplay(profile);
      refreshLocalAnalysis();
      updateKeywords();
      updateWorkbench();
      setStatus('分析维度已保存', 'success');
    });
    document.getElementById('cx-discussion-summary-reset-profile').addEventListener('click', async () => {
      const profile = normalizeAnalysisProfile(DEFAULT_ANALYSIS_PROFILE);
      await saveSettings({ [STORAGE_KEYS.analysisProfile]: profile });
      settingsCache = { ...(settingsCache || settings), analysisProfile: profile };
      analysisProfileInput.value = formatAnalysisProfileForDisplay(profile);
      refreshLocalAnalysis();
      updateKeywords();
      updateWorkbench();
      setStatus('已恢复默认分析维度', 'success');
    });
    document.getElementById('cx-discussion-summary-save-config').addEventListener('click', async () => {
      const current = settingsCache || await getSettings();
      const apiKey = cleanText(apiKeyInput.value);
      const model = cleanText(modelInput.value);
      const baseUrl = normalizeUrl(baseUrlInput.value) || DEFAULTS.baseUrl;
      const requestTimeoutSeconds = normalizeTimeoutSeconds(timeoutInput.value);
      const nextMap = { ...(current.keyMap || {}) };
      if (apiKey) {
        nextMap[baseUrl] = apiKey;
      }
      const nextSettings = {
        ...(current || {}),
        apiKey: apiKey || current.apiKey || '',
        model: model || DEFAULTS.model,
        baseUrl,
        anonymous: anonymousInput.checked,
        keyMap: nextMap,
        requestTimeoutSeconds,
      };
      await persistSettings(nextSettings);
      settingsCache = nextSettings;
      timeoutInput.value = String(requestTimeoutSeconds);
      await pushRecent(baseUrl);
      renderRecent();
      setStatus('配置已保存', 'success');
    });
    document.getElementById('cx-discussion-summary-reset-config').addEventListener('click', async () => {
      await saveSettings({
        [STORAGE_KEYS.apiKey]: '',
        [STORAGE_KEYS.keyMap]: {},
        [STORAGE_KEYS.model]: DEFAULTS.model,
        [STORAGE_KEYS.baseUrl]: DEFAULTS.baseUrl,
        [STORAGE_KEYS.anonymous]: DEFAULTS.anonymous,
        [STORAGE_KEYS.requestTimeoutSeconds]: DEFAULTS.requestTimeoutSeconds,
        [STORAGE_KEYS.recent]: [],
        [STORAGE_KEYS.analysisProfile]: DEFAULT_ANALYSIS_PROFILE,
      });
      apiKeyInput.value = '';
      modelInput.value = DEFAULTS.model;
      timeoutInput.value = String(DEFAULTS.requestTimeoutSeconds);
      baseUrlInput.value = DEFAULTS.baseUrl;
      baseUrlPreset.value = matchPreset(DEFAULTS.baseUrl)?.url || '';
      analysisProfileInput.value = formatAnalysisProfileForDisplay(DEFAULT_ANALYSIS_PROFILE);
      anonymousInput.checked = DEFAULTS.anonymous;
      recentContainer.innerHTML = '';
      refreshLocalAnalysis();
      updateKeywords();
      updateWorkbench();
      setStatus('已恢复默认配置', 'success');
    });
  }


  const captureToken = `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function rememberAnalysisPayload(payload) {
    state.rawComments = payload.comments || [];
    state.capturePayload = { ...payload, capturedAt: new Date().toISOString(), sourceUrl: String(currentLocation.href || ''), captureToken };
    state.datasetId = null;
  }
  function runtimeMessage(message) {
    return extensionCall(callback=>chrome.runtime.sendMessage(message,callback)).then(response=>{
      if(!response?.ok)throw new Error(response?.error||'扩展通信失败');
      return response.payload;
    });
  }

  function invalidateExtensionContext() {
    extensionContextInvalidated=true;
    runtimeBridgeSuspended=true;
    state.collecting=false;state.loading=false;collectionControl?.resume();updateCollectionButtons();
    const message='扩展已更新或重新加载，请刷新当前课程页后继续。';
    clearRuntimeRegistrationTimer();
    runtimePort=null;
    rejectRuntimePending(message);
    for(const [id,pending] of bridgePending){rootWindow.clearTimeout(pending.timeout);pending.reject(new Error(message));bridgePending.delete(id);}
    setStatus(message,'danger');
    for(const id of ['cx-discussion-summary-collect','cx-discussion-summary-open-workbench','cxda-settings']){const b=document.getElementById(id);if(b)b.disabled=true;}
    const status=document.getElementById('cx-discussion-summary-status');
    if(status && typeof document.createElement==='function' && !document.getElementById('cxda-refresh-page')){
      const b=document.createElement('button');b.id='cxda-refresh-page';b.textContent='刷新课程页';b.onclick=()=>rootWindow.location.reload();status.after(b);
    }
    return new Error(message);
  }

  function extensionCall(invoke) {
    return new Promise((resolve,reject)=>{
      try {
        if(extensionContextInvalidated || !TEST_MODE && (typeof chrome==='undefined' || !chrome.runtime?.id))throw invalidateExtensionContext();
        invoke(value=>{
          try {
            const error=chrome.runtime?.lastError;
            if(error)throw new Error(error.message);
            resolve(value);
          } catch(error){reject(/Extension context invalidated/i.test(error.message)?invalidateExtensionContext():error);}
        });
      } catch(error){reject(/Extension context invalidated/i.test(error.message)?invalidateExtensionContext():error);}
    });
  }
  let publishingDataset=null;
  function publishAnalysisDataset(open,autorun=false){return trackCollection(()=>publishAnalysisDatasetRun(open,autorun));}
  async function publishAnalysisDatasetRun(open, autorun = false) {
    await collectionGate();
    if(publishingDataset)await publishingDataset;
    if (!state.capturePayload) throw new Error('请先采集当前讨论');
    const payload = state.capturePayload;
    const dataset = DiscussionAnalysis.createDataset({ ...payload, datasetId: state.datasetId });
    if(!dataset.records.length&&!(CaptureScope?.bounded(payload.captureScope)&&payload.complete===true))throw new Error('没有采集到可确认的发言，请进入讨论详情或确认所选班级后重试');
    dataset.captureToken = captureToken;
    if(payload.captureScope)dataset.captureScope=payload.captureScope;
    const operation=runtimeMessage({ type: 'discussion-analysis', action: 'publish', dataset, open: !!open, autorun: !!autorun });
    publishingDataset=operation;
    state.collecting=true;setBusy(true);
    try{const result=await operation;await collectionGate();if(state.capturePayload===payload)state.datasetId=result.datasetId;return result;}
    finally{if(publishingDataset===operation)publishingDataset=null;state.collecting=false;setBusy(false);}
  }
  let captureSessionStartedAt='';
  function readCaptureOptions(courseTopicMode){
    const mode=document.getElementById('cxda-capture-window')?.value||'all';
    if(mode==='session'&&!captureSessionStartedAt)throw Error('请先点击“开始本节课”，再收集当场发言');
    const captureScope=CaptureScope?CaptureScope.window({mode,startedAt:captureSessionStartedAt,from:document.getElementById('cxda-capture-from')?.value,to:document.getElementById('cxda-capture-to')?.value}):{mode:'all'};
    const topicId=document.getElementById('cxda-capture-topic')?.value||'',link=document.getElementById('cxda-capture-topic-link')?.value.trim()||'';
    const linked=link?getCourseTopicUuidFromInput({detailUrl:normalizeCourseTopicDetailUrl(link)}):'';
    if(link&&!linked)throw Error('请填写有效的超星话题链接');
    // 讨论详情可能在子框架里采集，子框架读不到课程页的班级下拉：
    // 这里在上层页面先把当前班级解析出来传下去，避免请求退回全部班级。
    const classIds=courseTopicMode?getSelectedCourseClassIds():resolveDiscussionClassIds({},getAllSameOriginDocs(document));
    return {classIds,captureScope,topicId:linked||topicId,topicUrl:link};
  }
  function refreshCaptureTopicChoices(){
    const select=document.getElementById('cxda-capture-topic');if(!select)return;
    const previous=select.value,topics=mergeCourseTopics(undefined,{classIds:getSelectedCourseClassIds(),includeTeacherTopics:true}),seen=new Set();
    select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent=document.getElementById('cxda-capture-window')?.value==='all'?'全部话题':'本时段活跃话题（自动选择）';select.appendChild(all);
    for(const t of topics){const uuid=stripCourseTopicDiscussSuffix(t.uuid||'');if(!uuid||seen.has(uuid))continue;seen.add(uuid);const o=document.createElement('option');o.value=uuid;o.textContent=t.title||t.content.slice(0,38)||'未命名话题';select.appendChild(o);}if(seen.has(previous))select.value=previous;syncCaptureTopicLink();
  }
  function syncCaptureTopicLink(){
    const select=document.getElementById('cxda-capture-topic'),input=document.getElementById('cxda-capture-topic-link');if(!select||!input)return;
    const wasLinked=select.value==='__linked__';for(const option of Array.from(select.options))if(option.value==='__linked__')option.remove();
    const link=input.value.trim();if(!link){if(wasLinked)select.value='';return;}
    const uuid=getCourseTopicUuidFromInput({detailUrl:normalizeCourseTopicDetailUrl(link)});
    if(uuid&&Array.from(select.options).some(o=>o.value===uuid)){select.value=uuid;return;}
    const option=document.createElement('option');option.value='__linked__';option.textContent='按下方链接收集';option.disabled=true;select.appendChild(option);select.value=option.value;
  }
  function installCaptureControls(panel){
    const section=document.createElement('section');section.className='cxda-capture-controls';
    section.innerHTML=`<label for="cxda-capture-window">收集时间</label><select id="cxda-capture-window"><option value="all" selected>全部时段</option><option value="1h">最近 1 小时</option><option value="2h">最近 2 小时</option><option value="session">本节课（从开始记录起）</option><option value="custom">自定义时间</option></select><div id="cxda-capture-custom" hidden><label>开始时间<input type="datetime-local" id="cxda-capture-from"></label><label>结束时间<input type="datetime-local" id="cxda-capture-to"></label></div><button type="button" id="cxda-capture-start">开始本节课</button><p id="cxda-capture-session" class="cxda-small"></p><div id="cxda-capture-topic-box"><label for="cxda-capture-topic">话题范围</label><select id="cxda-capture-topic"><option value="">全部话题</option></select><button type="button" id="cxda-capture-topic-refresh">刷新当前页话题</button><details><summary>指定话题链接</summary><input type="url" id="cxda-capture-topic-link" placeholder="粘贴超星讨论帖链接"></details></div>`;
    panel.querySelector('.cxda-actions').before(section);const mode=document.getElementById('cxda-capture-window'),custom=document.getElementById('cxda-capture-custom');
    const pause=document.createElement('button');pause.id='cxda-pause-collect';pause.type='button';pause.hidden=true;pause.textContent='暂停收集';pause.onclick=()=>toggleCollectionPause();panel.querySelector('.cxda-actions').insertBefore(pause,document.getElementById('cx-discussion-summary-open-workbench'));
    mode.onchange=()=>{
      custom.hidden=mode.value!=='custom';
      const all=document.getElementById('cxda-capture-topic')?.querySelector('option[value=""]');
      if(all)all.textContent=mode.value==='all'?'全部话题':'本时段活跃话题（自动选择）';
      const note=document.getElementById('cxda-capture-session');
      note.textContent=mode.value==='all'?'收集所选班级和话题的全部发言。':mode.value==='custom'?'按北京时间设置起止时间后收集。':mode.value==='session'?(captureSessionStartedAt?'本节课从 '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(captureSessionStartedAt))+' 开始记录，学生讨论后点击收集。':'先点击“开始本节课”，再收集当场发言。'):'只收集所选时段内的发言，保留必要的对话背景。';
      updateCollectionButtons();
    };
    panel.addEventListener('change',updateCollectionButtons);panel.addEventListener('input',updateCollectionButtons);panel.addEventListener('click',e=>{if(e.target.closest('.cxda-capture-controls,[data-capture-scope-button]'))updateCollectionButtons();});
    const localValue=n=>new Date(n+8*3600000).toISOString().slice(0,16);document.getElementById('cxda-capture-from').value=localValue(Date.now()-3600000);document.getElementById('cxda-capture-to').value=localValue(Date.now());
    document.getElementById('cxda-capture-start').onclick=()=>{captureSessionStartedAt=new Date().toISOString();mode.value='session';mode.onchange();};
    document.getElementById('cxda-capture-topic-box').hidden=IS_DISCUSSION_PAGE;
    document.getElementById('cxda-capture-topic').onchange=()=>{document.getElementById('cxda-capture-topic-link').value='';syncCaptureTopicLink();};
    document.getElementById('cxda-capture-topic-link').oninput=syncCaptureTopicLink;
    document.getElementById('cxda-capture-topic-refresh').onclick=refreshCaptureTopicChoices;refreshCaptureTopicChoices();mode.onchange();
  }
  function createAnalysisPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const style = document.createElement('style');
    style.textContent = `
      #${TOGGLE_ID}{position:fixed;right:20px;bottom:28px;z-index:2147483646;border:0;border-radius:14px;background:#087e86;color:white;padding:13px 18px;box-shadow:0 5px 24px #18373822;font:14px system-ui;cursor:pointer}
      #${PANEL_ID}{position:fixed;right:18px;top:36px;bottom:32px;width:380px;max-width:calc(100vw - 24px);box-sizing:border-box;z-index:2147483647;background:#fff;border:1px solid #d8e4e4;border-radius:16px;box-shadow:0 18px 65px #173b3926;overflow:auto;font:14px/1.6 system-ui,'Microsoft YaHei',sans-serif;color:#193a3e}
      #${PANEL_ID}[hidden]{display:none} #${PANEL_ID} *{box-sizing:border-box} #${PANEL_ID} header{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #e4eeee} #${PANEL_ID} h2{font-size:17px;margin:0} #${PANEL_ID} .cxda-body{padding:20px} #${PANEL_ID} h3{font-size:17px;line-height:1.5;margin:0 0 18px}
      #${PANEL_ID} button{font:inherit;border:1px solid #d5e4e4;border-radius:9px;background:white;color:#185d62;padding:9px 12px;cursor:pointer} #${PANEL_ID} button.primary{background:#087e86;color:white;border-color:#087e86} #${PANEL_ID} button:disabled{opacity:.5;cursor:wait} #${PANEL_ID} .cxda-actions{display:grid;gap:10px} #${PANEL_ID} .cxda-capture-controls{padding:14px 0;margin:12px 0;border-top:1px solid #e4eeee;border-bottom:1px solid #e4eeee} #${PANEL_ID} .cxda-capture-controls input{width:100%;max-width:100%;padding:8px;border:1px solid #d5e4e4;border-radius:8px;font:inherit;margin:5px 0 10px} #${PANEL_ID} .cxda-capture-controls button{margin:0 0 8px} #${PANEL_ID} .cxda-info{margin:18px 0;padding:14px;background:#f3f9f8;border-radius:10px} #${PANEL_ID} .cxda-info strong{font-size:26px;margin-right:6px} #${PANEL_ID} .cxda-small{font-size:12px;color:#617b7d} #${PANEL_ID} select{width:100%;border:1px solid #d5e4e4;border-radius:8px;padding:8px;margin-bottom:10px;background:white;font:inherit;color:inherit} #${PANEL_ID} #cxda-class-search{width:100%;margin:8px 0;padding:9px 10px;border:1px solid #d5e4e4;border-radius:8px;font:inherit} #${PANEL_ID} #cxda-class-list{max-height:260px;overflow:auto;display:grid;gap:5px;margin-bottom:10px} #${PANEL_ID} .cxda-class-row{display:flex;align-items:center;gap:9px;min-height:40px;padding:9px 10px;border:1px solid #e0ebeb;border-radius:7px;cursor:pointer} #${PANEL_ID} .cxda-class-row span{overflow-wrap:anywhere} #${PANEL_ID} .cxda-class-row input{flex:0 0 auto;width:16px;height:16px;margin:0} #${PANEL_ID} [hidden]{display:none!important} #${PANEL_ID} #cx-discussion-summary-status{margin:16px 0;white-space:pre-wrap;color:#617b7d} #${PANEL_ID} [data-type=danger]{color:#b4432b} #${PANEL_ID} .cxda-settings{margin-top:22px;padding-top:16px;border-top:1px solid #e4eeee;display:flex;justify-content:space-between}
      @media(max-width:480px){#${PANEL_ID}{top:12px;left:12px;right:12px;bottom:12px;width:auto;max-width:none}}
    `;
    document.head.appendChild(style);
    const toggle = document.createElement('button');toggle.id=TOGGLE_ID;toggle.type='button';toggle.textContent='讨论分析';document.body.appendChild(toggle);
    const panel=document.createElement('section');panel.id=PANEL_ID;panel.hidden=true;panel.setAttribute('aria-label','讨论助手');
    panel.innerHTML=`<header><h2>讨论助手</h2><button type="button" id="cx-discussion-summary-close" aria-label="收起讨论助手">收起</button></header><div class="cxda-body"><h3 id="cxda-title">当前课堂讨论</h3><div id="cx-discussion-summary-class-section" hidden><label for="cx-discussion-summary-class-scope">选择班级</label><select id="cx-discussion-summary-class-scope" multiple size="3"></select><div id="cx-discussion-summary-class-summary" class="cxda-small"></div></div><div class="cxda-actions"><button type="button" class="primary" id="cx-discussion-summary-collect">开始分析</button><button type="button" id="cx-discussion-summary-open-workbench">查看已采集结果 →</button></div><div class="cxda-info"><strong id="cx-discussion-summary-count">0</strong> 条已采集发言<div class="cxda-small">学生话题、回复与楼中楼分别计数</div></div><div id="cx-discussion-summary-status" role="status" aria-live="polite">选择班级，点击开始分析。</div><div class="cxda-settings"><label><input type="checkbox" id="cx-discussion-summary-anonymous" checked> 匿名显示</label><button type="button" id="cxda-settings">设置</button></div></div>`;
    document.body.appendChild(panel);
    installCaptureControls(panel);
    toggle.onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden)document.getElementById('cx-discussion-summary-collect').focus();};
    document.getElementById('cx-discussion-summary-close').onclick=()=>{panel.hidden=true;toggle.focus();};
    document.getElementById('cx-discussion-summary-collect').onclick=()=>collectFromPanel().catch(e=>setStatus(e.message,'danger'));
    document.getElementById('cx-discussion-summary-open-workbench').onclick=openWorkbench;
    document.getElementById('cxda-settings').onclick=()=>runtimeMessage({type:'discussion-analysis',action:'options'}).catch(e=>setStatus(e.message,'danger'));
    const classSelect=document.getElementById('cx-discussion-summary-class-scope');
    const classSummary=document.getElementById('cx-discussion-summary-class-summary');
    classSelect.hidden=true;
    const classSearch=document.createElement('input');classSearch.id='cxda-class-search';classSearch.type='search';classSearch.placeholder='搜索班级';classSearch.setAttribute('aria-label','搜索班级');
    const classList=document.createElement('div');classList.id='cxda-class-list';classList.setAttribute('role','group');classList.setAttribute('aria-label','选择采集班级');
    classSelect.before(classSearch,classList);classSearch.oninput=renderClassPicker;
    const clearClasses=document.createElement('button');clearClasses.type='button';clearClasses.setAttribute('data-capture-scope-button','');clearClasses.textContent='清空选择';clearClasses.onclick=()=>{Array.from(classSelect.options).forEach(o=>o.selected=false);state.selectedClassIds=[];updateClassScope(state.classOptions);};
    const allClasses=document.createElement('button');allClasses.type='button';allClasses.setAttribute('data-capture-scope-button','');allClasses.textContent='全选班级';
    allClasses.onclick=()=>{Array.from(classSelect.options).forEach(o=>o.selected=true);state.selectedClassIds=getSelectedCourseClassIds();updateClassScope(state.classOptions);};
    const refreshClasses=document.createElement('button');refreshClasses.type='button';refreshClasses.textContent='刷新班级';refreshClasses.onclick=()=>refreshCourseClassOptions().catch(e=>setStatus(e.message,'danger'));
    classSummary.after(allClasses,clearClasses,refreshClasses);
    classSelect.onchange=()=>{state.selectedClassIds=getSelectedCourseClassIds();updateClassScope(state.classOptions);refreshCaptureTopicChoices();};
    const anonymous=document.getElementById('cx-discussion-summary-anonymous');anonymous.checked=true;anonymous.disabled=true;anonymous.parentElement.textContent='模型发送与导出使用匿名文本';
    if(shouldUseCourseTopicMode(document)){refreshCourseClassOptions().catch(e=>setStatus(e.message,'danger'));let classRefreshTimer;const observer=new MutationObserver(changes=>{if(changes.every(c=>panel.contains(c.target)))return;clearTimeout(classRefreshTimer);classRefreshTimer=setTimeout(()=>refreshCourseClassOptions().catch(()=>{}),400);});observer.observe(document.body,{childList:true,subtree:true});}
  }
  function collectSingleTopicPayload(message){return trackCollection(()=>collectSingleTopicPayloadRun(message));}
  async function collectSingleTopicPayloadRun(message){
    const topic={...message.topic,uuid:stripCourseTopicDiscussSuffix(cleanText(message.topic?.uuid).replace(/^uuid:/,''))};
    // 刷新单条话题时不能因为调用方没传班级就退回全部班级：
    // 话题自己的班号优先；课程级教师话题再按当前页面选中的班解析。
    let classIds=(message.classIds||[]).map(normalizeCourseClassId).filter(Boolean);
    if(!classIds.length){
      const topicClassId=normalizeCourseClassId(topic.classId);
      classIds=topicClassId&&topic.courseLevel!==true&&!isCourseLevelClassId(topicClassId)
        ?[topicClassId]
        :resolveDiscussionClassIds({},getAllSameOriginDocs(document));
    }
    const detail=await fetchCourseTopicDetail(topic,{tagClassIds:classIds,captureScope:message.captureScope});await collectionGate();
    const dataset=DiscussionAnalysis.createDataset({analysisMode:'courseTopics',comments:[{...detail,uuid:topic.uuid,uniqueKey:topic.uniqueKey,classId:topic.classId||detail.classId}],selectedClassIds:classIds,sourceUrl:String(currentLocation.href||''),complete:detail.replyCollectionComplete===true});
    let unknownTime=detail.replyUnknownTime||0;
    if(CaptureScope?.bounded(message.captureScope)){const filtered=CaptureScope.records(dataset.records,message.captureScope),ids=new Set(filtered.contextIds);unknownTime+=filtered.unknownTime;dataset.records=filtered.records.map(r=>({...r,captureContext:ids.has(r.id)}));}
    return {records:dataset.records,complete:detail.replyCollectionComplete===true&&!unknownTime,warning:[detail.replyCollectionIssue,unknownTime?`${unknownTime} 条时间不够准确，未纳入本时段`:''].filter(Boolean).join('；')};
  }
  if (!TEST_MODE && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type==='discussion-collection-control'){setCollectionPaused(message.paused===true);respond({ok:true});return;}
    if(message?.type==='discussion-collection-reset'){stopLocalCollection().then(()=>respond({ok:true})).catch(error=>respond({ok:false,error:error.message}));return true;}
    if(message && message.type==='discussion-source-check'){respond({token:captureToken,href:String(currentLocation.href||'')});return;}
    if(message && message.type==='discussion-collect-topic'){
      if(state.loading){respond({ok:false,error:'已有采集正在进行，请先继续或等待完成'});return;}
      state.collecting=true;beginCollection();captureControlsAtStart=captureControlsStamp();setBusy(true);
      collectSingleTopicPayload(message).then(payload=>respond({ok:true,payload})).catch(error=>respond({ok:false,error:error.message})).finally(()=>{state.collecting=false;setBusy(false);});return true;
    }
    if(message && message.type==='discussion-recollect'){
      handleCollect(message.options).then(payload=>{if(!payload)throw new Error('采集未完成，请查看课程页提示');return publishAnalysisDataset(false);}).then(result=>respond({ok:true,payload:result})).catch(error=>respond({ok:false,error:error.message}));return true;
    }
  });

  const internals = {
    invalidateExtensionContext,
    updateCollectionButtons,
    collectCourseTopicsFromSelectedClassFrames,
    collectSingleTopicPayload,
    setCollectionPaused,
    collectScopedCourseTopics,
    collectCurrentPagePayload,
    fetchCourseTopicReplies,
    collectDiscussionPayload,
    resolveDiscussionClassIds,
    filterDiscussionClasses,
    runtimeMessage,
    storageGet,
    connectRuntimeBridge,
    ensureRuntimeBridgeReady,
    requestRuntimeDiscussionFrameAction,
    uniqueComments,
    uniqueCourseTopics,
    getRecordMetadata,
    courseTopicReplyFromData,
    parseCourseTopicReplyListPayload,
    normalizeTimeoutSeconds,
    normalizeMaxTopics,
    applyStoragePatchToSettings,
    makeSettingsFromStorage,
    getRequestTimeoutMs,
    isChaoxingTopicPageUrl,
    isDiscussionReplyPageUrl,
    isChaoxingCourseTopicListPageUrl,
    isChaoxingCoursePageUrl,
    hasCourseTopicListFrame,
    shouldUseCourseTopicMode,
    extractCommentsFromDocs,
    extractCourseStudentTopicsFromDocs,
    extractCourseTopicAuthor,
    extractCourseTopicClassInfo,
    isTeacherCourseTopic,
    matchesCourseClassFilter,
    uniqueCourseTopics,
    extractCourseClassOptionsFromDocs,
    countCourseTopicRowsInDocs,
    normalizeCourseClassName,
    readEnrollmentCount,
    readPlatformReplyCount,
    readPlatformTopicCount,
    resolveCourseTopicListContext,
    fetchCourseTopicClassTopicCounts,
    courseTopicFromNode,
    courseCollectionSummary,
    buildCourseTopicClassCollectionPlan,
    parseCourseTopicDetailHtml,
    shouldFetchCourseTopicDetail,
    buildCourseTopicDetailUrls,
    enrichCourseTopicsWithDetails,
    chooseBridgeFailureError,
    getBridgeResultPending,
    extractTopicContextFromDocs,
    formatTopicContextForDisplay,
    formatCommentForPrompt,
    formatPreviewRows,
    normalizeAnalysisProfile,
    formatAnalysisProfileForDisplay,
    parseAnalysisProfileText,
    extractIdeologyKeywords,
    extractAutoKeywords,
    buildLocalTeacherAnalysis,
    buildTeacherAnalysisReport,
    stripCommentAuthors,
    buildSummarizePrompt,
    getRawLoadedReplyInfoFromDocs,
    getExpectedReplyInfoFromDocs,
    clickLoadMoreInDoc,
    getLoadMoreStateFromDoc,
    shouldStopCollecting,
    shouldStopCourseTopicCollection,
    formatCollectionStatus,
    getBridgeResponseTimeoutMs,
    buildCourseTopicListUrl,
    parseCourseTopicListPayload,
    courseTopicClassReplyCounts,
    fetchCourseTopicListTopics,
    courseTopicTagClassId,
    resolveCourseTopicTagClassIds,
    courseTopicExpectedReplyCount,
    buildCourseTopicReplyListUrl,
    fetchCourseTopicReplies,
    DEFAULT_ANALYSIS_PROFILE,
    DEFAULTS,
    STORAGE_KEYS,
  };
  if (TEST_MODE) {
    rootWindow.__cxDiscussionSummaryExtensionInternals = internals;
    return;
  }

  function installPanelWhenReady() {
    if (!IS_TOP_FRAME) return;
    let installed = false;
    let observer = null;
    let pollTimer = null;
    let stopTimer = null;

    const cleanup = () => {
      if (observer && typeof observer.disconnect === 'function') observer.disconnect();
      if (pollTimer) rootWindow.clearInterval(pollTimer);
      if (stopTimer) rootWindow.clearTimeout(stopTimer);
      observer = null;
      pollTimer = null;
      stopTimer = null;
    };

    const tryInstall = () => {
      if (installed || document.getElementById(PANEL_ID)) {
        installed = true;
        cleanup();
        return;
      }
      if (!shouldInstallPanelOnCurrentPage()) return;
      installed = true;
      cleanup();
      createAnalysisPanel();
    };

    const startWatching = () => {
      tryInstall();
      if (installed) return;
      if (typeof MutationObserver === 'function' && document.documentElement) {
        observer = new MutationObserver(tryInstall);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src'],
        });
      } else if (typeof rootWindow.setInterval === 'function') {
        pollTimer = rootWindow.setInterval(tryInstall, 500);
      }
      if (typeof rootWindow.setTimeout === 'function') stopTimer = rootWindow.setTimeout(cleanup, 15000);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatching, { once: true });
    else startWatching();
  }

  connectRuntimeBridge();
  if (IS_DISCUSSION_PAGE) installNetworkObservers();
  installPanelWhenReady();
})();
