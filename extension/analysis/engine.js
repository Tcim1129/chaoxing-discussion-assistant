(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const MODEL_POLICY = 'model-broad-v2';
  const LOCAL_POLICY = 'local-fast-v1';
  const LEVELS = {basic:'概念复述',case:'案例关联',critical:'对比思辨',pending:'未分类',na:'简单回应 / 其他表达'};
  // 话题串（一个话题连同它的全部回复与楼中楼）是交给模型的打包单位；
  // 阶段按探究社区（CoI）认知临场感四阶段标注，用于整场报告，不替代逐条深度判断。
  const THREAD_STAGES = ['trigger','exploration','integration','resolution','unclear'];
  const STAGE_LABELS = {trigger:'触发问题',exploration:'探索信息',integration:'整合观点',resolution:'形成结论',unclear:'阶段未定'};
  const KNOWLEDGE_STAGES = ['','共享比较','发现分歧','协商共建','检验修正','达成应用'];
  const SCORE_AXES = ['概念准确','案例关联','证据支撑','回应他人','反思修正'];
  const SCORE_MAX = 5;
  const SCORE_RUBRIC = 'argument-ai-5-uniform-v2';
  const DEFAULT_DIMENSIONS = [
    {name:'民生保障',aliases:['民生','医保','报销','医疗保障','社会保障','养老金','看病','养老','补助','减轻家庭负担']},
    {name:'教育公平',aliases:['教育公平','义务教育','免费教育','免费上学','教育资源','助学','学费','上学']},
    {name:'财政机制',aliases:['财政','预算','税收','转移支付','政府补助','公共支出','公共服务','国债','公共资金']},
    {name:'分配与公平',aliases:['公平','分配','贫富','地区差异','均等化','不同地区','城乡差距','保障水平']},
  ];
  const MENTION_POLICY = 'mentions-common-v2';
  const COMMON_THEME_TERMS = {
    '民生保障':['惠民','惠农','民生政策','人民生活','人民利益','人民群众','以人民为中心','为人民服务','老百姓','百姓','生活保障','社会福利','基本生活','幸福生活','便民','惠民政策','乡村振兴','扶贫','脱贫','困难群众','医疗','健康','养老保障','就业','社会救助','三农','粮食安全','耕地保护','地力保护','农业补贴','种粮','惠农资金','农户','农民','生态保护','绿色发展','环保','环境保护','可持续发展','防灾','救灾','减灾','应急救助'],
    '教育公平':['教育','教育发展','教育机会','平等受教育','立德树人','育人','劳动教育','德育','思政教育','助学金','奖学金','教育普惠','教育均衡','学校','高校','大学','学前教育','高等教育','职业教育','助学贷款'],
    '财政机制':['国家','政府','制度','国家政策','政策','公共政策','公共利益','国家治理','社会治理','基层治理','制度保障','政府责任','公共责任','公共资源','惠民政策','惠农政策','国家投入','政府投入','税费','纳税','公共财政','补贴','补助','拨款','公共产品','公共物品','专项资金','专项补助','资金直达','支农'],
    '分配与公平':['公平正义','公正','正义','共同富裕','共享发展','共享','平等','公平分配','收入差距','区域协调','协调发展','均衡发展','均等','机会公平','公平公正','富裕','城乡发展','普惠','资源配置','城乡','东西部','民族地区','弱势群体','财政平衡','共同发展']
  };
  const clean = v => String(v == null ? '' : v).trim();
  // 讨论正文是富文本。只去掉格式，不把比较号、公式、代码运算符当乱码删除。
  function discussionContent(value,options={}) {
    const entities={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",ensp:' ',emsp:' ',thinsp:' ',zwsp:'',ndash:'–',mdash:'—',hellip:'…',middot:'·',bull:'•',times:'×',divide:'÷',le:'≤',ge:'≥',ne:'≠',plusmn:'±',copy:'©',reg:'®'};
    const decode=v=>String(v).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,k)=>{if(k[0]!=='#')return entities[k.toLowerCase()]??all;const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):Number(k.slice(1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';});
    let text=String(value??'');
    // 部分接口又对整段 HTML 做了一次实体转义，限制层数避免无限解码。
    for(let i=0;i<3;i++){const next=decode(text);if(next===text)break;text=next;}
    const images=[],seen=new Set();let hasImages=/<img\b/i.test(text);
    const add=entry=>{const raw=typeof entry==='string'?entry:entry?.url||entry?.src||entry?.originalUrl||entry?.original||entry?.imageUrl||entry?.imgUrl||'';if(!raw)return;try{const url=new URL(decode(raw),options.baseUrl||undefined);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;if(!seen.has(url.href)){seen.add(url.href);images.push({url:url.href});}}catch(_){}};
    let supplied=options.images||[];if(typeof supplied==='string'){try{supplied=JSON.parse(supplied);}catch(_){supplied=[supplied];}}
    if(!Array.isArray(supplied))supplied=[supplied];if(supplied.length)hasImages=true;supplied.forEach(add);
    text=text.replace(/<!--[\s\S]*?-->|<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
    const attr=(tag,name)=>{const m=tag.match(new RegExp('\\b'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));return m?m[1]??m[2]??m[3]:'';};
    text=text.replace(/<img\b[^>]*>/gi,tag=>{add(attr(tag,'data-original')||attr(tag,'data-src')||attr(tag,'src'));return '';});
    text=text.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,(_all,_alt,url)=>{hasImages=true;add(url);return '';});
    text=text.replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|li|h[1-6]|tr|blockquote|pre)\s*>/gi,'\n')
      .replace(/<\/?(?:p|div|span|a|b|strong|i|em|u|s|del|sup|sub|ul|ol|li|h[1-6]|table|tbody|thead|tr|td|th|blockquote|pre|code|font|section|article|figure|figcaption|video|audio|source|iframe)\b[^>]*>/gi,'')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\ufeff]/g,'')
      .replace(/\r\n?/g,'\n').replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    return {text,images,hasImages};
  }
  function recordImages(record) {return discussionContent(record.originalContent||record.content,{images:record.images||record.img_data,baseUrl:record.sourceUrl||record.detailUrl}).images;}
  const hash = value => {let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);};
  function isTrivialComment(text) {
    const t = clean(text).replace(/[!！。.~～,，、\s\-_/\\?？:：\[\]]+/g, '');
    if (!t) return true;
    if (!/[\p{L}]/u.test(t) || /^https?:\/\/\S+$/i.test(clean(text)) || /^(?:哈+|呵+|嘿+|啊+|嗯+|test|测试|无效信息|图片回复尚未读取图片内容|附件回复尚未读取附件内容)$/i.test(t)) return true;
    if (/^(?:(?:收到|已收到|签到|打卡|好的|谢谢|感谢|老师|您好|谢谢老师|感谢老师|老师好|明白|已阅|学习了|ok))+$/i.test(t)) return true;
    if (/^(收到|已收到|签到|已签到|打卡|已打卡|打卡学习|已学习|打卡签到|每日打卡|打卡成功|老师好|谢谢老师|感谢老师|收到谢谢老师|好的|好|行|ok|OK|明白|已阅|知晓|赞|顶|支持|占楼|占位|无|无意见|暂无|1+|2+|6+|同意|非常同意|支持老师)$/i.test(t)) return true;
    if (/^(收到|打卡|签到|好的)(老师|您好|啦|哈|呗)?$/i.test(t)) return true;
    return false;
  }
  function parseTime(value, capturedAt) {
    const v=clean(value), missing={iso:null,precision:'missing',raw:v};
    if(!v)return missing;
    if(/^\d{10,13}$/.test(v)){const n=Number(v)*(v.length===10?1000:1);return Number.isFinite(n)&&n>0?{iso:new Date(n).toISOString(),precision:'second',raw:v}:missing;}
    if(/T.*(?:Z|[+-]\d\d:\d\d)$/i.test(v)){const n=Date.parse(v);return Number.isFinite(n)?{iso:new Date(n).toISOString(),precision:'second',raw:v}:missing;}
    const baseline=Date.parse(capturedAt || '');
    const relative=v.match(/^(\d+)\s*(分钟|小时|天)前$/);
    if(relative&&Number.isFinite(baseline)){const factor={'分钟':60000,'小时':3600000,'天':86400000}[relative[2]];return {iso:new Date(baseline-Number(relative[1])*factor).toISOString(),precision:'relative',raw:v};}
    if(v==='刚刚'&&Number.isFinite(baseline))return {iso:new Date(baseline).toISOString(),precision:'relative',raw:v};
    let m=v.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const day=v.match(/^(今天|昨天)\s*(\d{1,2}):(\d{2})$/);
    if(day&&Number.isFinite(baseline)){const z=new Date(baseline+8*3600000-(day[1]==='昨天'?86400000:0));m=[v,z.getUTCFullYear(),z.getUTCMonth()+1,z.getUTCDate(),day[2],day[3]];}
    if(!m)return missing;
    const [year,month,date,hour,minute,second]=[m[1],m[2],m[3],m[4]||0,m[5]||0,m[6]||0].map(Number);
    const check=new Date(Date.UTC(year,month-1,date,hour,minute,second));
    if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==date||hour>23||minute>59||second>59)return missing;
    return {iso:new Date(check.getTime()-8*3600000).toISOString(),precision:m[4]==null?'day':m[6]==null?'minute':'second',raw:v};
  }
  function cleanAuthorName(value) {
    let s = clean(value).split(/\s*回复\s*/)[0].replace(/\s*[:：]\s*$/,'');
    s = s.replace(/^(?:置顶|精华|推荐|精|【[^】]+】|\[[^\]]+\])\s*/g, '');
    const parts = s.split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    let candidate = parts[0];
    candidate = candidate.replace(/\d+[-/.年]\d+.*$/, '').replace(/[:：\d].*$/, '').trim();
    return candidate || parts[0];
  }
  function createDataset(payload={}) {
    const capturedAt=payload.capturedAt||new Date().toISOString();
    const sourceUrl=clean(payload.sourceUrl), records=[], seen=new Set(),rawAliases=new Map(),classAliases=new Map();
    function append(item,index,context={}) {
      const topicId=clean(context.topicId||item.topicId||item.uuid);
      const rawId=clean(item.commentId||item.uniqueKey||item.id||item.uuid);
      const authorId=clean(item.authorId||item.userId||item.uid||item.createrId||item.creater_id||(item.authorPuid||item.createrPuid||item.create_puid?'puid:'+(item.authorPuid||item.createrPuid||item.create_puid):''));
      const author=cleanAuthorName([item.author,item.createrName,item.creater_name,item.creatorName,item.createName,item.userName,item.realName,item.creator?.name,item.user?.name].find(v=>typeof v==='string'&&v.trim())||'');
      const rawContent=item.bodyContent != null?item.bodyContent:item.content,rich=discussionContent(rawContent,{images:item.images||item.img_data,baseUrl:item.sourceUrl||item.detailUrl||sourceUrl});
      const content=rich.text||(rich.hasImages||item.hasImages?'[图片回复，尚未读取图片内容]':''),title=discussionContent(item.title).text;
      if(!content&&!title)return null;
      // 归属看话题自己的班号；collectedClassId 只是「这次从哪个班的页面读到」，
      // 拿它覆盖真实班号就会把别的班的话题算进本班（用户反馈的串班根源）。
      // 课程级话题（来源：全部班级）不属于任何一个班，两者都不盖章，它的回复各自带班号。
      const classId=item.courseLevel?clean(item.classId):clean(item.classId||item.collectedClassId||context.classId);
      let id=rawId?(/^[A-Za-z0-9:_@.-]{1,200}$/.test(rawId)?rawId:'local:'+hash(rawId)):(context.parentId?'reply:':'local:')+hash([topicId,authorId,author,item.time,content,index].join('|'));
      // 同一个 uuid 的话题可能出现在多个班：撞号时记录 ID 带上班号，否则第二个班的同名话题会被当成重复项丢掉，
      // 它的回复也会挂到第一个班的记录上，形成串班。只在真的撞号时才带班号，已有数据的 ID 保持不变。
      if(classId&&seen.has(id)&&records.find(r=>r.id===id)?.classId!==classId)id=`${id}@${classId}`;
      if(rawId){rawAliases.set(rawId,id);classAliases.set(classId+'|'+rawId,id);}
      if(seen.has(id))return records.find(r=>r.id===id);
      seen.add(id);
      const time=parseTime(item.createdAt||item.time||item.createTime||item.create_time,capturedAt);
      const record={id,platformId:clean(item.platformId||item.id),topicId:topicId||id,kind:context.kind||item.kind||'contribution',parentId:clean(item.parentId||item.replyToId||context.parentId),
        authorKey:authorId?'id:'+authorId:author?'name:'+hash(author):'',authorId,author,_puid:clean(item.authorPuid||item.createrPuid||item.create_puid),role:['student','teacher','system'].includes(item.role)?item.role:'unknown',
        ...(item.roleReview==='teacher'?{roleReview:'teacher'}:{}),
        ...(item.captureContext===true?{captureContext:true}:{}),
        ...(typeof item.replyCollectionComplete==='boolean'?{replyCollectionComplete:item.replyCollectionComplete}:{}),
        classId,collectedClassId:clean(item.collectedClassId),className:clean(item.className||context.className),title,content,
        ...(item.originalContent||String(rawContent??'')!==content?{originalContent:item.originalContent||String(rawContent??'')}:{}),
        ...(rich.hasImages||item.hasImages?{images:rich.images,hasImages:true}:{}),
        createdAt:time.iso,timePrecision:time.precision,timeRaw:time.raw,capturedAt,sourceUrl:clean(item.sourceUrl||item.detailUrl||sourceUrl),
        qualityFlags:[...(item.qualityFlags||[]),...(!authorId?['identity_unverified']:[]),...(!time.iso?['time_missing']:[])]};
      records.push(record);return record;
    }
    (payload.comments||[]).forEach((item,index)=>{
      const isTopic=payload.analysisMode==='courseTopics'||Array.isArray(item.replies);
      const body=item.bodyContent != null?item.bodyContent:isTopic&&item.content?.includes('\n\n详情页回复：')?item.content.split('\n\n详情页回复：')[0]:item.content;
      const base=append({...item,bodyContent:body},index,{kind:isTopic?'topic':item.kind,topicId:item.uuid||item.topicId||item.uniqueKey});
      (item.replies||[]).forEach((reply,i)=>append(reply,i,{parentId:base?.id||clean(item.commentId||item.uniqueKey||item.id||item.uuid),topicId:base?.topicId||clean(item.uuid||item.topicId||item.uniqueKey),kind:'reply',classId:base?.classId||clean(reply.collectedClassId||item.collectedClassId)||item.classId,className:base?.className||item.className}));
    });
    const ids=new Set(records.map(r=>r.id)),aliases=new Map(records.filter(r=>r.platformId).map(r=>[r.platformId,r.id]));
    for(const r of records)if(r.parentId){
      const scoped=classAliases.get((r.classId||'')+'|'+r.parentId);if(scoped&&scoped!==r.id){r.parentId=scoped;continue;}
      if(ids.has(r.parentId))continue;
      const match=[r.parentId,'reply:'+r.parentId,'uuid:'+r.parentId,'id:topicId_'+r.parentId].find(id=>ids.has(id));
      if(match||aliases.has(r.parentId)||rawAliases.has(r.parentId))r.parentId=match||aliases.get(r.parentId)||rawAliases.get(r.parentId);
    }
    const puidAccounts=new Map();for(const r of records)if(r._puid&&r.authorId&&!r.authorId.startsWith('puid:')){if(!puidAccounts.has(r._puid))puidAccounts.set(r._puid,new Set());puidAccounts.get(r._puid).add(r.authorId);}
    for(const r of records){const account=puidAccounts.get(r._puid||r.authorId.replace(/^puid:/,''));if(r.authorId.startsWith('puid:')&&account?.size===1){r.authorId=[...account][0];r.authorKey='id:'+r.authorId;}delete r._puid;}
    // 同一班级内如果某个姓名唯一对应一个已知的 authorId，安全补全该记录的 authorId 与 authorKey 实现同人合并
    const classAuthorAccounts=new Map();
    for(const r of records){
      if(r.authorId&&r.author&&!r.authorId.startsWith('puid:')){
        const k=(r.classId||'__all__')+':'+r.author;
        if(!classAuthorAccounts.has(k))classAuthorAccounts.set(k,new Set());
        classAuthorAccounts.get(k).add(r.authorId);
      }
    }
    for(const r of records){
      if((!r.authorId||r.authorId.startsWith('puid:'))&&r.author){
        const k=(r.classId||'__all__')+':'+r.author;
        const matched=classAuthorAccounts.get(k);
        if(matched&&matched.size===1){
          r.authorId=[...matched][0];
          r.authorKey='id:'+r.authorId;
        }
      }
      r.trivial=isTrivialComment(r.content);
    }
    // 同一稳定 ID 的明确角色可补全它的其他发言
    const knownRoles=new Map();
    for(const r of records)if(r.authorId&&r.role!=='unknown'){if(!knownRoles.has(r.authorId))knownRoles.set(r.authorId,new Set());knownRoles.get(r.authorId).add(r.role);}
    for(const r of records)if(r.role==='unknown'&&knownRoles.get(r.authorId)?.size===1)r.role=[...knownRoles.get(r.authorId)][0];
    const names=new Map();for(const r of records)if(r.authorId&&r.author){if(!names.has(r.authorId))names.set(r.authorId,new Set());names.get(r.authorId).add(r.author);}
    for(const r of records)if(!r.author&&names.get(r.authorId)?.size===1)r.author=[...names.get(r.authorId)][0];
    mergeDuplicateIdentities({records});
    const classNames=new Map((payload.classOptions||payload.classes||[]).filter(c=>!clean(c.name).includes('、')).map(c=>[clean(c.id),clean(c.name)]));
    for(const r of records)if(classNames.get(r.classId))r.className=classNames.get(r.classId);
    return {schemaVersion:VERSION,id:payload.datasetId||'d-'+hash(sourceUrl+capturedAt),createdAt:capturedAt,title:payload.topicContext?.title||payload.title||'课堂讨论',question:clean(payload.topicContext?.question||payload.question),
      sourceUrl,sourceTabId:payload.sourceTabId??null,scope:{classIds:payload.selectedClassIds||[],sourceUrl},classes:(payload.classOptions||payload.classes||[]).map(c=>({id:clean(c.id),name:clean(c.name),studentCount:Number.isInteger(c.studentCount)&&c.studentCount>=0?c.studentCount:null,studentCountSource:clean(c.studentCountSource||'课程页面')})),collection:{complete:payload.complete===true,warning:clean(payload.collectionWarning),rawLoadedCount:Number(payload.rawLoadedCount||records.length),summary:payload.collectionSummary||payload.collection?.summary||null},records};
  }
  // 超星对同一个学生给两套 ID：话题接口一套（如 170541624）、回复接口另一套（如 1198100874）。
  // 不合并时同一个人在报告里被算成两个人（老师看到的「一个班 90 多人发言」就是这么来的）。
  // 合并条件（宁可少合也不错合）：同一个姓名恰好对应两个 ID、每个 ID 只对应这一个姓名、
  // 两套 ID 分别只出现在「话题」和「回复」一侧（平台两套 ID 的特征），且两个 ID 出现过的班级集合相容
  // （相同，或其中一个只出现在课程级话题里）。三个以上 ID 或条件不符时保守跳过。
  function mergeDuplicateIdentities(dataset) {
    const records=dataset.records||[];
    const nameIds=new Map(),idNames=new Map(),idKinds=new Map(),idClasses=new Map(),idCount=new Map();
    for(const r of records){
      const id=clean(r.authorId);
      if(!id||id.startsWith('puid:'))continue;
      if(!idCount.has(id))idCount.set(id,0);
      idCount.set(id,idCount.get(id)+1);
      if(!idKinds.has(id))idKinds.set(id,new Set());
      idKinds.get(id).add(r.kind||'contribution');
      if(!idClasses.has(id))idClasses.set(id,new Set());
      if(r.classId)idClasses.get(id).add(r.classId);
      if(r.author){
        if(!nameIds.has(r.author))nameIds.set(r.author,new Set());
        nameIds.get(r.author).add(id);
        if(!idNames.has(id))idNames.set(id,new Set());
        idNames.get(id).add(r.author);
      }
    }
    const remap=new Map(),merged=[];
    for(const [name,ids] of nameIds){
      if(ids.size!==2)continue;
      const list=[...ids];
      if(list.some(id=>idNames.get(id)?.size!==1))continue;
      const [a,b]=list,ka=idKinds.get(a)||new Set(),kb=idKinds.get(b)||new Set();
      if(![...ka].every(kind=>!kb.has(kind)))continue;
      const ca=idClasses.get(a)||new Set(),cb=idClasses.get(b)||new Set();
      const compatible=[...ca].every(id=>cb.has(id))||[...cb].every(id=>ca.has(id))||!ca.size||!cb.size;
      if(!compatible)continue;
      const main=(idCount.get(a)||0)>=(idCount.get(b)||0)?a:b,other=main===a?b:a;
      remap.set(other,main);merged.push({name,other,main,kept:idCount.get(main),absorbed:idCount.get(other)});
    }
    if(!remap.size)return {merged:0,people:new Set(records.map(r=>clean(r.authorId)).filter(Boolean)).size};
    const resolve=id=>{let out=id,guard=0;while(remap.has(out)&&guard++<8)out=remap.get(out);return out;};
    for(const r of records){
      const id=clean(r.authorId);
      if(!id||!remap.has(id))continue;
      r.authorId=resolve(id);
      r.authorKey='id:'+r.authorId;
      r.identityMerged=true;
    }
    // 合并后重新补一遍角色与姓名（主 ID 若缺角色/姓名，可用被合并记录的值）
    const roles=new Map();for(const r of records)if(r.authorId&&r.role!=='unknown'){if(!roles.has(r.authorId))roles.set(r.authorId,new Set());roles.get(r.authorId).add(r.role);}
    for(const r of records)if(r.role==='unknown'&&roles.get(r.authorId)?.size===1)r.role=[...roles.get(r.authorId)][0];
    const named=new Map();for(const r of records)if(r.authorId&&r.author){if(!named.has(r.authorId))named.set(r.authorId,new Set());named.get(r.authorId).add(r.author);}
    for(const r of records)if(!r.author&&named.get(r.authorId)?.size===1)r.author=[...named.get(r.authorId)][0];
    return {merged:merged.length,details:merged,people:new Set(records.map(r=>clean(r.authorId)).filter(Boolean)).size};
  }
  function automaticEnrollment(dataset) {
    const classes=new Map((dataset.classes||[]).map(c=>[c.id,c]));
    const recordIds=[...new Set(dataset.records.map(r=>clean(r.classId)).filter(Boolean))];
    // 人数按教师选择的班级范围确定；没读到某班的发言不等于该班不在本次范围。
    const selected=[...new Set((dataset.scope?.classIds||[]).map(clean).filter(Boolean))];
    const ids=dataset.activeScope?.classId?[clean(dataset.activeScope.classId)]:selected.length?selected:recordIds;
    if(!ids.length&&classes.size===1)ids.push([...classes.keys()][0]);
    if(!ids.length||ids.some(id=>!Number.isInteger(classes.get(id)?.studentCount)))return null;
    return {count:ids.reduce((n,id)=>n+classes.get(id).studentCount,0),classes:ids.map(id=>classes.get(id)),source:[...new Set(ids.map(id=>classes.get(id).studentCountSource))].join('、')};
  }
  // 仅合并稳定平台ID的重复视图；同文不同ID仍是独立发言。读取时不改写原备份。
  function uniqueDiscussionRecords(records){
    const byKey=new Map(),byId=new Map(records.map(r=>[r.id,r])),aliases=new Map(),out=[];
    for(const r of records){
      const suffix=r.classId?'@'+r.classId:'',baseId=suffix&&r.id.endsWith(suffix)?r.id.slice(0,-suffix.length):'',base=byId.get(baseId);
      const stable=r.platformId||(base&&base.classId===r.classId&&base.authorKey===r.authorKey&&base.topicId===r.topicId&&base.kind===r.kind&&base.content===r.content?baseId:r.id);
      const key=JSON.stringify([r.classId||'',r.topicId||'',r.kind||'',r.authorKey||'',stable]);
      const prior=byKey.get(key);if(prior){aliases.set(r.id,prior.id);continue;}byKey.set(key,r);out.push(r);
    }
    if(!aliases.size)return out;
    return out.map(r=>{let parent=r.parentId,seen=new Set();while(aliases.has(parent)&&!seen.has(parent)){seen.add(parent);parent=aliases.get(parent);}return parent!==r.parentId?{...r,parentId:parent}:r;});
  }
  function filterDataset(dataset,scope={}) {
    const within=r=>(!scope.classId||r.classId===scope.classId)&&(!scope.unassigned||!r.classId)&&(!scope.topicId||r.topicId===scope.topicId)&&
      (!scope.from||(r.createdAt&&r.createdAt>=scope.from))&&(!scope.to||(r.createdAt&&r.createdAt<=scope.to));
    const rawScoped=dataset.records.filter(within),records=uniqueDiscussionRecords(dataset.records).filter(within),duplicateExcluded=(dataset.duplicateExcluded||0)+rawScoped.length-records.length;
    // 没有任何班级标记的记录（话题页拿不到班号时留下的历史数据）单独计数，供界面显示，不再静默消失。
    const unscopedCount=dataset.records.filter(r=>!clean(r.classId)).length;
    return {...dataset,records,duplicateExcluded,activeScope:scope,unscopedCount,scopeCaptured:!scope.classId||records.some(r=>!['teacher','system'].includes(r.role))};
  }
  function calculateMetrics(dataset,options={}) {
    const roster=(options.roster||[]).filter(r=>!dataset.activeScope?.classId||r.classId===dataset.activeScope.classId);
    const rosterIds=new Set(roster.map(r=>clean(r.id)).filter(Boolean));
    const roles=options.roles||{};
    const roleOf=r=>roles[r.authorKey]||r.role;
    const unique=uniqueDiscussionRecords(dataset.records),records=unique.filter(r=>!r.captureContext&&!['teacher','system'].includes(roleOf(r)));
    const participants=new Set(records.map(r=>r.authorKey).filter(Boolean));
    const stable=records.every(r=>r.authorKey.startsWith('id:'));
    const allNamed=records.every(r=>!!r.authorKey);
    const rolesConfirmed=records.every(r=>roleOf(r)==='student'||rosterIds.has(r.authorId));
    const identityCoverage=records.length?records.filter(r=>r.authorKey.startsWith('id:')).length/records.length:0;
    const rosterComplete=roster.length>0&&rosterIds.size===roster.length&&roster.every(r=>clean(r.id));
    const inRoster=records.every(r=>rosterIds.has(r.authorId));
    const declared=Number(options.expectedStudents),declaredValid=Number.isInteger(declared)&&declared>0&&declared>=participants.size;
    const enrollment=automaticEnrollment(dataset),automaticValid=enrollment&&enrollment.count>0&&enrollment.count>=participants.size;
    const expectedSize=rosterComplete?roster.length:declaredValid?declared:automaticValid?enrollment.count:null;
    const participationBasis=rosterComplete?'roster':declaredValid?'declared':automaticValid?'automatic':'missing';
    const byId=new Map(dataset.records.map(r=>[r.id,r]));let interactionCount=0,selfReplies=0,resolved=0,unresolved=0;
    for(const r of records){
      if(!r.parentId){if(r.kind==='reply')unresolved++;continue;}
      const p=byId.get(r.parentId);
      const rRole=rosterIds.has(r.authorId)?'student':roleOf(r);
      const pRole=p&&(rosterIds.has(p.authorId)?'student':roleOf(p));
      if(!p||!r.authorKey||!p.authorKey||rRole==='unknown'||pRole==='unknown'){unresolved++;continue;}
      resolved++;if(r.authorKey===p.authorKey){selfReplies++;continue;}if(pRole==='student'&&rRole==='student')interactionCount++;
    }
    const timed=records.filter(r=>r.createdAt&&['minute','second'].includes(r.timePrecision));
    const times=timed.map(r=>Date.parse(r.createdAt));
    // 参与率曾经要求「回复采集 100% 完整」才给，遇到个别话题没读全就整场显示“数据不足”。
    // 现在改成：人数与名册对得上就算，同时标出这是下限（还有话题没读全时可能漏人）。
    const collectionComplete=dataset.collection?.complete===true;
    const rateReady=dataset.scopeCaptured!==false&&stable&&rolesConfirmed&&Boolean(expectedSize)&&(rosterComplete?inRoster:true);
    return {total:records.length,participants:participants.size,identityCoverage,identityStable:stable,unknownIdentity:records.filter(r=>!r.authorKey).length,
      unknownRole:records.filter(r=>roleOf(r)==='unknown'&&!rosterIds.has(r.authorId)).length,
      average:stable&&rolesConfirmed&&participants.size?records.length/participants.size:null,estimatedAverage:allNamed&&rolesConfirmed&&participants.size?records.length/participants.size:null,
      rosterSize:expectedSize,participationBasis,enrollment,collectionComplete,
      participationRate:rateReady?participants.size/expectedSize:null,
      participationRateLowerBound:rateReady&&!collectionComplete,
      allClassAverage:dataset.scopeCaptured!==false&&rolesConfirmed&&expectedSize&&(rosterComplete?inRoster:true)?records.length/expectedSize:null,
      interactionCount,interactionRate:records.length&&!unresolved?interactionCount/records.length:null,relationCoverage:resolved+unresolved?resolved/(resolved+unresolved):1,
      interactionLowerBound:records.length?interactionCount/records.length:null,interactionUpperBound:records.length?(interactionCount+unresolved)/records.length:null,
      unresolvedRelations:unresolved,selfReplies,timedCount:timed.length,spanMinutes:times.length>=2?(Math.max(...times)-Math.min(...times))/60000:null,
      excluded:unique.length-records.length,duplicateExcluded:(dataset.duplicateExcluded||0)+dataset.records.length-unique.length,records};
  }
  function dimensions(profile) {
    const input=profile?.dimensions?.length?profile.dimensions:DEFAULT_DIMENSIONS;
    return input.map(d=>({name:clean(d.name),aliases:[...new Set([d.name,...(d.aliases||[]),...(COMMON_THEME_TERMS[clean(d.name)]||[])].map(clean).filter(s=>s.length>=2))]})).filter(d=>d.name);
  }
  // 1.0.29：模型读完讨论后自己提出几个“大方向”，这里把它收成可用的口径（名字自动进 aliases）。
  function validateDirections(value) {
    const data=typeof value==='string'?parseJson(value):value;
    const list=Array.isArray(data?.directions)?data.directions:[];
    const seen=new Set(),out=[];
    for(const entry of list){
      const source=entry&&typeof entry==='object'?entry:{name:entry};
      const name=plainText(source.name||source.direction||source.title).slice(0,12);
      if(!name||seen.has(name))continue;
      const aliases=(Array.isArray(source.aliases)?source.aliases:[source.aliases]).map(item=>plainText(String(item||'')).slice(0,12));
      seen.add(name);
      // 别名里出现过纯数字、年份、编号（模型爱把“202512”“3000”当词），这类一律丢掉。
      out.push({name,aliases:[name,...aliases].filter((item,index,arr)=>item.length>=2&&/[\u4e00-\u9fa5A-Za-z]/.test(item)&&arr.indexOf(item)===index).slice(0,14),reason:plainText(source.reason||source.note||'').slice(0,80)});
    }
    return out.slice(0,10);
  }
  // 只按新的方向重算「主题提及」：深度、评分、专业判断、教师改动都不动。
  function recomputeMentions(dataset,profile,previous={}) {
    const ds=dimensions(profile),rows=calculateMetrics(dataset).records,own={},texts=new Map();
    for(const r of rows)texts.set(r.id,[r.title,r.content].filter(Boolean).join('\n'));
    const usable=ds;
    for(const r of rows){
      const text=texts.get(r.id),hits=[];
      for(const d of usable){const hit=mentionHit(text,d.aliases);if(hit)hits.push({dimension:d.name,evidence:hit.sentence,contextId:'',methods:['direct'],reason:'原文提到「'+hit.term+'」'});}
      own[r.id]=hits;
    }
    const byId=new Map(dataset.records.map(r=>[r.id,r])),allowed=new Set(ds.map(d=>d.name)),mentions={};
    const direct=record=>{if(own[record.id])return own[record.id];const text=[record.title,record.content].filter(Boolean).join('\n');return ds.flatMap(d=>{const hit=mentionHit(text,d.aliases);return hit?[{dimension:d.name,evidence:hit.sentence,contextId:'',methods:['direct'],reason:'原文提到「'+hit.term+'」'}]:[];});};
    for(const r of rows){
      if(previous[r.id]?.reviewStatus==='teacher'){mentions[r.id]=previous[r.id].mentions||[];continue;}
      const hits=[...own[r.id]];
      // 保留模型已经给出且仍能在原文核对的主题，补词不会把语义识别结果抹掉。
      const previousValue=effectiveResult(previous[r.id]),confirmed=previousValue?.modelAnalyzed?previousValue.mentions:previousValue?.confirmedThemeMentions;
      for(const hit of Array.isArray(confirmed)?confirmed:[]){const source=hit.contextId?(hit.contextId===r.parentId?byId.get(hit.contextId):null):r;const text=source&&[source.title,source.content].filter(Boolean).join('\n');if(allowed.has(hit.dimension)&&clean(hit.evidence)&&text?.includes(hit.evidence)&&!hits.some(m=>m.dimension===hit.dimension))hits.push(hit);}
      if(!hits.length&&/(?:这个|这项|这条|该)(?:政策|方案|做法|措施|观点|说法)|^(?:我也)?(?:同意|不同意|赞同|不赞同|确实|是的|有道理)|^这个确实有帮助/.test(clean(r.content))){
        const seen=new Set([r.id]);let parent=byId.get(r.parentId);
        while(parent&&!seen.has(parent.id)&&seen.size<=16){seen.add(parent.id);const found=direct(parent);if(found.length){hits.push(...found.map(hit=>({...hit,contextId:parent.id,methods:['context'],reason:'明确回应父发言'})));break;}if(!/(?:这个|这项|这条|该)(?:政策|方案|做法|措施|观点|说法)|^(?:我也)?(?:同意|不同意|赞同|不赞同|确实|是的|有道理)/.test(clean(parent.content)))break;parent=byId.get(parent.parentId);}
      }
      mentions[r.id]=hits;
    }
    Object.defineProperty(mentions,'ignored',{value:[],enumerable:false});
    return mentions;
  }
  function detectMentions(dataset,profile) {
    const ds=dimensions(profile),results={};
    const records=dataset.records.filter(r=>!['teacher','system'].includes(r.role));
    for(const r of records){const text=[r.title,r.content].filter(Boolean).join('\n');const mentions=[];
      for(const d of ds){const terms=d.aliases.filter(t=>text.includes(t));if(terms.length)mentions.push({dimension:d.name,methods:['direct'],evidence:terms[0],contextId:'',reason:'原文直接提及'});}
      results[r.id]={commentId:r.id,mentions,level:'pending',evidence:'',reason:'尚未完成内容深度分析',scores:{},reviewStatus:'unreviewed'};
    }
    for(const r of records){if(!r.parentId||! /^(同意|赞同|确实|是的|这个确实有帮助|有道理)[。！!\s]*$/.test(r.content))continue;
      const p=records.find(x=>x.id===r.parentId);if(!p)continue;
      for(const m of results[p.id]?.mentions||[])if(!results[r.id].mentions.some(x=>x.dimension===m.dimension))results[r.id].mentions.push({...m,methods:['context'],contextId:p.id,reason:'明确回应父回复'});
    }
    return results;
  }
  // 1.0.23：本地检测信号表。深度判据改成可观察的学术标准（SOLO 结构层级 / ICAP 参与方式 / Toulmin 论证要素的通俗表述），
  // 每条发言按命中信号定档、把命中句留作依据；不再按字数判断，也不再“出现因为就升级成案例”。
  const DEPTH_SIGNALS=[
    {key:'case',label:'案例',re:/例如|比如|打个比方|举个例子|以.{1,12}为例|拿.{1,12}来说|身边|我们(?:学校|班|学院|系|专业|年级|家|社区|小区|村|县|市|区|镇|乡|单位|公司|企业|医院|那边|这里|那儿|本地|当地|家乡)|我在.{0,8}(?:社区|学校|村|县|公司|单位|医院|街道|乡镇|实习)|亲身|亲眼|调研|问卷|访谈|走访|去年|今年|上个月|上学期|上次/},
    {key:'data',label:'数据',re:/\d+(?:\.\d+)?\s*(?:%|％|个百分点|万元|亿元|元|人|次|倍|年|岁|所|个|份)|数据显示|统计(?:数据|结果|显示)|调查(?:显示|表明|发现)|根据.{0,12}(?:数据|报告|统计|调查)|研究报告|报告(?:显示|指出)/},
    {key:'policy',label:'政策工具',re:/医保|报销|统筹|转移支付|专项债|补贴|补助|低保|社保|养老金|养老保险|义务教育|学费|助学|减免|退税|税率|税收|预算|拨款|财政(?:支出|投入|补贴|转移|资金|政策)|公共服务/},
    {key:'mechanism',label:'机制',re:/因为|由于|所以|因此|导致|使得|取决于|从而|进而|意味着|关键在于|原因(?:是|在于)|作用机制|机制|原理|传导|渠道|路径|激励|约束|分担|再分配|乘数|通过.{0,16}(?:保障|支持|促进|实现|缓解|减轻|提高|降低|解决|发挥)|起到.{0,8}作用|发挥.{0,8}作用|有助于|有利于|不利于|造成|带来|还要(?:看|考虑)|不仅要|不只是|不能只看|可持续|承受能力|财政能力/},
    {key:'effect',label:'作用',re:/减轻|缓解|改善|提高|降低|促进|推动|保障|支持|帮助|增加|减少|解决|补齐|覆盖|受益/},
    {key:'contrast',label:'对比',re:/比较|相比|对比|相对于|不同(?:地区|班级|群体|年份|城市|省份)|而(?:东部|西部|城市|农村|有些|其他)|差异|一方面|另一方面|前者|后者|但是|然而|不过|但/},
    {key:'tradeoff',label:'权衡',re:/权衡|利弊|取舍|各有(?:优劣|利弊)|不能只|不只看|不能仅仅|既要|也要|兼顾|短期|长期|代价|风险|成本|前提|条件|平衡/},
    {key:'rebuttal',label:'反驳',re:/不同意|不赞同|不完全同意|不敢苟同|虽有道理|虽然有道理|有人(?:可能)?认为|反驳|修正|推翻|质疑|不成立|过于绝对|未必|不能一概而论/},
    {key:'question',label:'新问题',re:/值得(?:追问|思考|讨论)|可以进一步|需要进一步|还有待|尚需|有待|建议(?:验证|调查|了解|尝试)|如果.{0,20}(?:会怎样|怎么办|是否会|会不会|是否能|是否应该|怎么样)|怎样才|如何(?:保证|避免|衡量|判断)/},
    {key:'reflect',label:'反思',re:/反思|重新(?:考虑|审视|认识)|我(?:之前|原来|以前).{0,8}(?:以为|认为|觉得)|其实|深(?:层|入)(?:次)?(?:原因|问题|逻辑)|本质上/}
  ];
  const SIGNAL_LABELS=Object.fromEntries(DEPTH_SIGNALS.map(signal=>[signal.key,signal.label]));
  function sentencesOf(text) {return String(text||'').split(/(?<=[。！？!?；;\n])/).map(sentence=>sentence.trim()).filter(Boolean);}
  function detectDepthSignals(text) {
    const sentences=sentencesOf(text),hits={};
    for(const signal of DEPTH_SIGNALS){for(const sentence of sentences){const found=sentence.match(signal.re);if(found){hits[signal.key]={label:signal.label,term:found[0],sentence:sentence.slice(0,80)};break;}}}
    return hits;
  }
  // 三档判据：只有结论或态度=概念复述；举出案例数据、或把政策工具与作用机制连起来=案例关联；
  // 出现对比、权衡、反驳，或提出可追问的新问题=对比思辨。判据都取自表达本身，不看字数。
  function localDepthFrom(text,hits) {
    const value=clean(text),has=key=>!!hits[key],keys=Object.keys(hits);
    const pick=(...order)=>{for(const key of order)if(hits[key])return hits[key].sentence;return value.slice(0,60);};
    if(/^(同意|赞同|确实|是的|有道理|谢谢|支持|学习了|好的|收到|明白了|打卡|签到)[。！!~\s]*$/.test(value))
      return {level:'na',reason:'仅作简短回应',evidence:value.slice(0,40),signals:[]};
    // 老师要求「靠边的都算」：出现对比/权衡/反驳/追问任意一个就算对比思辨；举出案例、数据、政策工具、
    // 作用机制、实际作用任意一个就算案例关联。纯应声仍然单独算一类。
    if(has('rebuttal')||has('contrast')||has('tradeoff')||has('question'))
      return {level:'critical',reason:'出现'+['rebuttal','contrast','tradeoff','question'].filter(has).map(key=>hits[key].label).join('、'),evidence:pick('rebuttal','tradeoff','contrast','question','mechanism','data'),signals:keys};
    if(has('case')||has('data')||has('policy')||has('mechanism')||has('effect'))
      return {level:'case',reason:'结合'+[has('case')?'案例':null,has('data')?'数据':null,has('policy')?'政策工具':null,has('mechanism')?'作用机制':null,has('effect')?'实际作用':null].filter(Boolean).join('、')+'展开说明',evidence:pick('case','data','policy','mechanism','effect'),signals:keys};
    return {level:'basic',reason:keys.length?'只作了'+keys.map(key=>hits[key].label).join('、')+'的陈述，没有展开理由':'表达观点，参与基础讨论',evidence:keys.length?pick(...keys):value.slice(0,60),signals:keys};
  }
  // 论证五轴也改成按命中计数给分，并保留命中句；没有依据的维度仍然不打分，避免雷达图出现常数形状。
  function localScores(text,hits) {
    const value=clean(text),scores={},pick=(...order)=>{for(const key of order)if(hits[key])return hits[key].sentence;return '';};
    const terms=value.match(/财政|预算|税收|医保|报销|公共服务|民生|分配|公平|效率|政策|机制|制度|市场|政府|补贴|转移支付|经济|金融|成本|收益|资源|供给|需求|债务|投资|保障/g)||[];
    const concept=terms.length>=4?4:terms.length>=2?3:terms.length?2:/是指|定义|指的是|包括|分为|核心|属于|原则|特征|概念|机制|制度/.test(value)?2:0;
    if(concept)scores['概念准确']={value:concept,evidence:pick('policy','mechanism')||value.slice(0,40)};
    const caseKeys=['case','policy','data'].filter(key=>hits[key]);
    if(caseKeys.length)scores['案例关联']={value:Math.min(4,1+caseKeys.length+(hits.case&&hits.data?1:0)),evidence:pick(...caseKeys)};
    if(hits.data)scores['证据支撑']={value:/%|％|数据显示|统计|调查|研究|报告/.test(hits.data.sentence)?4:3,evidence:hits.data.sentence};
    else if(hits.mechanism&&hits.policy)scores['证据支撑']={value:2,evidence:hits.mechanism.sentence};
    const reply=(value.match(/你(?:提到|说得|说的)|楼上|有同学|同意|不同意|回应|针对.{0,10}(?:观点|说法|意见)|补充(?:一点|一下)|接着|顺着/)||[])[0];
    if(reply)scores['回应他人']={value:(hits.mechanism||hits.data)?4:3,evidence:reply};
    if(hits.rebuttal||hits.tradeoff||hits.reflect)scores['反思修正']={value:hits.rebuttal?4:3,evidence:pick('rebuttal','tradeoff','reflect')};
    else if(hits.contrast)scores['反思修正']={value:2,evidence:hits.contrast.sentence};
    return scores;
  }
  // 本地判断的可信度：信号清楚才自己定稿，模棱两可的留给模型复核（配合“本地先判、模型只补漏”）。
  function localConfidence(level,hits,text) {
    const count=Object.keys(hits).length;
    if(level==='na')return 'high';
    if(level==='critical'&&count>=3)return 'high';
    if(level==='case'&&count>=3)return 'high';
    if(level==='basic'&&clean(text).length<=32&&!hits.mechanism)return 'high';
    return 'low';
  }
  // 提及按原文是否出现统计；否定、疑问和比较仍属于提及，不代表认同。
  function mentionHit(text,aliases) {
    for(const sentence of sentencesOf(text))for(const term of aliases)if(sentence.includes(term)){
      const at=sentence.indexOf(term),start=Math.max(0,at-24);
      return {term,sentence:sentence.slice(start,Math.max(start+80,at+term.length))};
    }
    return null;
  }
  function analyzeLocal(dataset,profile,previous={}) {
    const ds=dimensions(profile),results={},rows=calculateMetrics(dataset).records;let validCount=0,excludedCount=0;
    for(const r of rows){
      if(previous[r.id]?.reviewStatus==='teacher'){validCount++;results[r.id]=previous[r.id];continue;}
      validCount++;const text=[r.title,r.content].filter(Boolean).join('\n'),mentions=[];
      for(const d of ds){const hit=mentionHit(text,d.aliases);if(hit)mentions.push({dimension:d.name,evidence:hit.sentence,contextId:'',methods:['direct'],reason:'原文提到「'+hit.term+'」'});}
      const signals=detectDepthSignals(text),depth=localDepthFrom(text,signals),scores=localScores(text,signals);
      const confidence=localConfidence(depth.level,signals,text);
      const proTerm=text.match(/财政|预算|税收|公共服务|医保|报销|义务教育|学费|养老金|补贴|转移支付|民生|分配|均等化|经济|金融|政策|市场|货币|国债|投资|赤字|收入|调控|资本|产业|宏观|微观|债务|供给|需求|利率|汇率|社会保障|公共产品/)?.[0]||'',professional=!!proTerm;
      // 没有依据的维度不打分（旧版给每条长发言补齐 3 分，雷达图恒为正五边形，看着像测量结果其实是常数）。
      results[r.id]={commentId:r.id,...depth,mentions,scores,confidence,needsModel:confidence!=='high',professional:{related:professional,evidence:proTerm,reason:'本地规则识别'},analysisSource:'local',analysisPolicy:LOCAL_POLICY,reviewStatus:'unreviewed'};
      if(previous[r.id]?.reviewStatus==='teacher')results[r.id]={...results[r.id],...previous[r.id]};
    }
    const fresh=recomputeMentions(dataset,profile,previous);
    for(const [id,hits] of Object.entries(fresh))if(results[id]&&!results[id].isTrivial&&results[id].reviewStatus!=='teacher'){results[id].mentions=hits;const prior=effectiveResult(previous[id]),known=prior?.modelAnalyzed?prior.mentions:prior?.confirmedThemeMentions;const confirmed=hits.filter(hit=>(Array.isArray(known)?known:[]).some(m=>m.dimension===hit.dimension&&m.evidence===hit.evidence&&(m.contextId||'')===(hit.contextId||'')));if(confirmed.length)results[id].confirmedThemeMentions=confirmed;}
    return {results,validCount,excludedCount};
  }
  function redact(text,names=[]) {
    let s=String(text||'');for(const name of [...new Set(names)].filter(n=>n?.length>=2).sort((a,b)=>b.length-a.length))s=s.split(name).join('[姓名]');
    return s.replace(/\b1[3-9]\d{9}\b/g,'[手机号]').replace(/(?:学号|学生编号)\s*[:：]?\s*[A-Za-z0-9-]{5,}/g,'学号[已隐藏]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[邮箱]');
  }
  function initialAnalysis(dataset) {return Object.fromEntries(calculateMetrics(dataset).records.map(r=>[r.id,{commentId:r.id,mentions:[],level:'pending',evidence:'',reason:'尚未完成模型分析',scores:{},reviewStatus:'unreviewed'}]));}
  function effectiveResult(result) {return result?.reviewStatus==='teacher'||result?.modelAnalyzed&&result.analysisPolicy===MODEL_POLICY||result?.analysisSource==='local'&&result.analysisPolicy===LOCAL_POLICY?result:null;}
  function modelRecords(records) {
    const names=records.map(r=>r.author).filter(Boolean);
    return records.map(r=>({commentId:r.id,parentId:r.parentId,className:clean(r.className),title:redact(r.title,names),content:redact(r.content,names)}));
  }
  function parseJson(value) {
    if(typeof value==='object')return value;
    const text=String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    try{return JSON.parse(text);}catch(_error){throw new Error(`模型返回的内容不是有效 JSON：${text.slice(0,120)}`);}
  }
  // 只回收截断 JSON 中已经完整结束的顶层字段与 items 行；不猜测未结束的值。
  function parseDocumentResponse(value,arrayKey='items') {
    try{return parseJson(value);}catch(error){
      const text=String(value||'').trim().replace(/^```(?:json)?\s*/i,'');
      const skip=i=>{while(/\s/.test(text[i]||'')&&i<text.length)i++;return i;};
      const endOf=start=>{
        let quoted=false,escaped=false;const stack=[];
        for(let i=start;i<text.length;i++){
          const c=text[i];
          if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"'){quoted=false;if(!stack.length)return i+1;}continue;}
          if(c==='"'){quoted=true;continue;}
          if(c==='{'||c==='['){stack.push(c);continue;}
          if(c==='}'||c===']'){if(!stack.length)return i;if(stack.pop()!==(c==='}'?'{':'['))return -1;if(!stack.length)return i+1;}
          if(!stack.length&&(c===','||/\s/.test(c)))return i;
        }
        return -1;
      };
      let i=skip(0);if(text[i++]!=='{')throw error;const recovered={};
      while(i<text.length){
        i=skip(i);if(text[i]!== '"')break;const keyEnd=endOf(i);if(keyEnd<0)break;
        let key;try{key=JSON.parse(text.slice(i,keyEnd));}catch(_){break;}
        i=skip(keyEnd);if(text[i++]!==':')break;i=skip(i);
        if(key===arrayKey&&text[i]==='['){
          const items=[];let cursor=skip(i+1);
          while(cursor<text.length&&text[cursor]!==']'){
            const end=endOf(cursor);if(end<0)break;
            try{items.push(JSON.parse(text.slice(cursor,end)));}catch(_){break;}
            cursor=skip(end);if(text[cursor]===',')cursor=skip(cursor+1);else break;
          }
          recovered[arrayKey]=items;
        }
        const end=endOf(i);if(end<0)break;
        if(['report','directions','notes','summary',arrayKey].includes(key))try{recovered[key]=JSON.parse(text.slice(i,end));}catch(_){}
        i=skip(end);if(text[i]!==',')break;i++;
      }
      if(Array.isArray(recovered[arrayKey])&&recovered[arrayKey].length)return recovered;
      throw error;
    }
  }
  function validateBatch(value,records,contextRecords=records,allowedDimensions,options={}) {
    const data=parseJson(value);if(!Array.isArray(data?.items))throw new Error('模型没有返回逐条 items');
    const map=new Map(records.map(r=>[r.id||r.commentId,r]));const context=new Map(contextRecords.map(r=>[r.id||r.commentId,r]));const seen=new Set();
    const allowed=allowedDimensions?new Set(allowedDimensions):null;
    // 1.0.24：模型摘引偶尔会漏掉换行/空格，或用省略号把两段原文接起来，或把「回复 S12」这类结构说明当成证据。
    // 证据必须能在这一条原文里找到才算数：允许空白差异、允许省略号分段（只保留最长的那段真实原文）；
    // 找不到就不拿它下判断（层级退回待确认、丢掉该维度或那个评分），而不是让整批重试失败。
    const groundQuote=(source,quote)=>{
      const raw=clean(quote);if(!raw)return '';
      const text=String(source==null?'':source);
      if(text.includes(raw))return raw;
      const flat=text.replace(/\s+/g,''),flatRaw=raw.replace(/\s+/g,'');
      if(flatRaw&&flat.includes(flatRaw))return raw;
      const parts=raw.split(/\.{2,}|…+/).map(part=>clean(part)).filter(part=>part.length>=4);
      const valid=parts.filter(part=>flat.includes(part.replace(/\s+/g,''))).sort((a,b)=>b.length-a.length);
      return valid[0]||'';
    };
    let dropped=0;
    // 现场分析（模型输出）容忍摘引瑕疵；导入的文件是既成事实，必须严格核对，不能悄悄改掉别人的证据。
    const strict=options.strictEvidence===true;
    const reject=message=>{if(strict)throw new Error(message);dropped++;};
    const items=data.items.map(item=>{
      const id=clean(item.commentId)||clean(item.id)||clean(item.code),r=map.get(id);if(!r)throw new Error('模型返回了范围外的发言');if(seen.has(id))throw new Error('模型返回重复发言');seen.add(id);
      let level=Object.hasOwn(LEVELS,item.level)?item.level:'pending';if(level!==item.level)level='pending',dropped++;
      const source=[r.title,r.content].filter(Boolean).join('\n'),evidence=groundQuote(source,item.evidence);
      if(!['pending','na'].includes(level)&&!evidence){reject('深度判断缺少原文证据');level='pending';}
      const mentions=(Array.isArray(item.mentions)?item.mentions:item.mentions?[item.mentions]:[]).map(raw=>{
        const m=typeof raw==='string'?{dimension:raw}:raw||{};
        const dimension=clean(m.dimension),contextId=clean(m.contextId);
        if(!dimension||allowed&&!allowed.has(dimension)){reject('主题超出教师选择的维度');return null;}
        const p=contextId?context.get(contextId):r;
        // 模型有时会把「上一层话题」或别人写的编号填成 contextId。填错时不当场作废：如果证据确实在
        // 这条回复真正引用的父发言里，就按父发言记一条上下文命中并改回真实父编号，否则退回本条原文。
        // 一个填错的编号不该让整段材料重发（真机跑测里一次重发要 1~2 分钟）。
        const parentRow=r.parentId?context.get(r.parentId):null;
        const knownParent=Boolean(contextId&&parentRow&&contextId===r.parentId);
        if(contextId&&!knownParent)reject('主题上下文不是可查的父回复');
        const quoteOwn=groundQuote([r.title,r.content].filter(Boolean).join('\n'),m.evidence);
        const quoteParent=!quoteOwn&&contextId&&parentRow?groundQuote([parentRow.title,parentRow.content].filter(Boolean).join('\n'),m.evidence):'';
        if(!quoteOwn&&!quoteParent){reject('主题证据不在原文中');return null;}
        const usedParent=!quoteOwn;
        return {dimension,evidence:usedParent?quoteParent:quoteOwn,contextId:usedParent?r.parentId:'',methods:usedParent?['context']:['semantic'],reason:clean(m.reason)};
      }).filter(Boolean);
      const scores={};for(const axis of SCORE_AXES){const v=item.scores?.[axis];if(v==null)continue;
        const value=v.value!=null?v.value:v.score;
        if(typeof v!=='object'||!Number.isInteger(value)||value<0||value>(options.scoreMax||SCORE_MAX)){reject('论证维度分数格式无效');continue;}
        const quote=groundQuote(source,v.evidence);
        if(!quote||options.scoreMax!==4&&quote.replace(/\s/g,'').length<4){reject('论证维度分数缺少有效原文依据');continue;}
        scores[axis]={value,evidence:quote};
      }
      let professional=null;
      if(item.professional!=null){const p=item.professional,quote=groundQuote(source,p.evidence);
        if(typeof p.related!=='boolean'){reject('专业概念判断格式无效');}
        else {if(p.related&&!quote)reject('专业概念判断缺少有效原文依据');professional={related:p.related&&!!quote,evidence:p.related?quote:'',reason:clean(p.reason)};}
      }
      if(options.requireProfessional&&professional===null)throw new Error('模型遗漏专业概念判断，请重试该批次');
      return {commentId:id,level,evidence,mentions,reason:clean(item.reason),scores,scoreMax:options.scoreMax||SCORE_MAX,scoreSource:'ai',scoreRubric:SCORE_RUBRIC,professional,reviewStatus:'unreviewed',modelAnalyzed:true,analysisPolicy:MODEL_POLICY,droppedFields:dropped};
    });
    if(!options.partial&&seen.size!==map.size)throw new Error('模型遗漏发言，请重试该批次');return items;
  }
  function argumentScores(result) {
    if(!effectiveResult(result)||!result.modelAnalyzed||result.scoreSource!=='ai'||result.scoreMax!==SCORE_MAX||result.scoreRubric!==SCORE_RUBRIC)return {};
    return Object.fromEntries(SCORE_AXES.filter(axis=>{
      const score=result.scores?.[axis];
      return Number.isInteger(score?.value)&&score.value>=0&&score.value<=SCORE_MAX&&clean(score.evidence).replace(/\s/g,'').length>=4;
    }).map(axis=>[axis,result.scores[axis]]));
  }
  function scoreStatus(result){
    if(Object.keys(argumentScores(result)).length)return 'current';
    if((result?.modelAnalyzed||result?.scoreSource==='ai')&&Object.keys(result?.scores||{}).length&&(result.scoreRubric!==SCORE_RUBRIC||result.scoreMax!==SCORE_MAX))return 'legacy';
    return 'missing';
  }
  function summarizeAnalysis(dataset,results={},options={}) {
    const allRecords=calculateMetrics(dataset,options).records,records=allRecords;const depth=Object.fromEntries(Object.keys(LEVELS).map(k=>[k,0]));const themes=new Map();let matched=0,analyzed=0,reviewed=0,completed=0,professionalKnown=0,local=0;const professionalIds=[];
    const radar=Object.fromEntries(SCORE_AXES.map(k=>[k,{sum:0,count:0,mean:null}]));
    for(const r of records){const a=effectiveResult(results[r.id]);if(a){completed++;if(a.professional){professionalKnown++;if(a.professional.related)professionalIds.push(r.id);}}depth[a?.level&&LEVELS[a.level]?a.level:'pending']++;if(a?.modelAnalyzed)analyzed++;if(a?.analysisSource==='local')local++;if(a?.reviewStatus==='teacher')reviewed++;
      if(a?.mentions?.length)matched++;for(const dimension of new Set((a?.mentions||[]).map(m=>m.dimension))){if(!themes.has(dimension))themes.set(dimension,[]);themes.get(dimension).push(r.id);}
      const grades=argumentScores(a);for(const axis of SCORE_AXES){const v=grades[axis];if(v){radar[axis].sum+=v.value;radar[axis].count++;}}
    }
    for(const axis of SCORE_AXES){const v=radar[axis];v.mean=v.count?v.sum/v.count:null;}
    const classified=records.length-depth.pending,unprocessed=records.length-completed,processedPending=depth.pending-unprocessed;
    return {classified,unprocessed,processedPending,classificationCoverage:records.length?classified/records.length:null,advancedClassifiedRate:classified?(depth.case+depth.critical)/classified:null,total:records.length,excludedTrivial:allRecords.length-records.length,local,depth,matched,coverage:records.length&&completed?matched/records.length:null,completed,professionalKnown,professionalIds,analyzed,reviewed,themes:[...themes].map(([name,ids])=>({name,count:ids.length,ids})),radar};
  }
  function cohortYear(name) {
    const text=clean(name);
    const explicit=text.match(/(?:^|[^0-9])(?:20)?(24|22)\s*[级届]/);
    if(explicit)return Number(explicit[1]);
    const prefix=text.match(/^(?:20)?(24|22)\s*(?=[\u4e00-\u9fffA-Za-z])/);
    return prefix&&!/^(?:20)?(?:24|22)\s*班/.test(text)?Number(prefix[1]):null;
  }
  function cohortComparison(dataset,results={},options={}) {
    const classes=new Map((dataset.classes||[]).map(c=>[c.id,c]));
    const selected=dataset.activeScope?.classId?[dataset.activeScope.classId]:dataset.scope?.classIds?.length?dataset.scope.classIds:[...new Set(dataset.records.map(r=>r.classId).filter(Boolean))];
    const scopeIds=new Set(selected);
    const yearOf=r=>cohortYear(classes.get(r.classId)?.name||r.className);
    const cohorts=[24,22].map(year=>{
      const ids=selected.filter(id=>cohortYear(classes.get(id)?.name||dataset.records.find(r=>r.classId===id)?.className)===year);
      const records=dataset.activeScope?.unassigned?[]:dataset.records.filter(r=>(!r.classId||scopeIds.has(r.classId))&&yearOf(r)===year);
      const sub={...dataset,records,classes:ids.map(id=>classes.get(id)).filter(Boolean),scope:{...dataset.scope,classIds:ids},activeScope:{...dataset.activeScope,classId:''},scopeCaptured:records.some(r=>!['teacher','system'].includes(r.role))};
      const declared=ids.map(id=>Number(options.expectedCounts?.[id]));
      const perClass=ids.length&&declared.every(n=>Number.isInteger(n)&&n>0)?declared.reduce((a,b)=>a+b,0):null;
      const scopedOptions={...options,expectedStudents:perClass,roster:(options.roster||[]).filter(r=>ids.includes(r.classId))};
      const m=calculateMetrics(sub,scopedOptions),a=summarizeAnalysis(sub,results,scopedOptions);
      const valid=m.records;
      const judged=valid.filter(r=>{const v=effectiveResult(results[r.id]);return v?.modelAnalyzed&&v.scoreRubric===SCORE_RUBRIC&&['basic','case','critical','na'].includes(v.level);});
      const scored=valid.filter(r=>Object.keys(argumentScores(results[r.id])).length);
      const advanced=judged.filter(r=>['case','critical'].includes(results[r.id].level)).length;
      return {year,classIds:ids,classNames:ids.map(id=>classes.get(id)?.name||dataset.records.find(r=>r.classId===id)?.className||id),total:m.total,participants:m.participants,enrollment:m.rosterSize,participationRate:m.participationRate,participationRateLowerBound:m.participationRateLowerBound,average:m.average,interactionRate:m.interactionRate,validTotal:a.total,scoredRecords:scored.length,judgedRecords:judged.length,advancedRate:judged.length?advanced/judged.length:null,radar:a.radar,records:valid.map(r=>r.id)};
    });
    const axes=SCORE_AXES.map(name=>{const young=cohorts[0].radar[name],older=cohorts[1].radar[name];return {name,young:young.mean,older:older.mean,youngCount:young.count,olderCount:older.count,delta:young.mean!=null&&older.mean!=null?young.mean-older.mean:null,ids:cohorts.flatMap(c=>c.records.filter(id=>argumentScores(results[id])[name]))};});
    return {cohorts,axes,unknown:dataset.records.filter(r=>!['teacher','system'].includes(r.role)&&yearOf(r)==null).length};
  }
  function preliminaryDepth(record) {
    // 1.0.23 起判据来自信号表（localDepthFrom），不再按字数或“出现因为就升级”。保留 evidence 字段供预览使用。
    const text=[record.title,record.content].filter(Boolean).join('\n')||clean(record.content);
    const signals=detectDepthSignals(text),depth=localDepthFrom(text,signals);
    return {...depth,confidence:localConfidence(depth.level,signals,text)};
  }

  // 名单里谁没有发言：有名单时按学号比对（名单里的姓名、或这个数据集里出现过的姓名都会补上），
  // 只有人数没有名单时只能给出人数。绝不猜姓名。
  function absentFromRoster(dataset,metrics,roster=[]) {
    const scopeClass=clean(dataset.activeScope?.classId);
    const entries=(Array.isArray(roster)?roster:[]).map(r=>({id:clean(r.id),classId:clean(r.classId),group:clean(r.group),name:clean(r.name)}))
      .filter(r=>r.id&&(!scopeClass||!r.classId||r.classId===scopeClass));
    const present=new Set(metrics.records.map(r=>clean(r.authorId)).filter(Boolean));
    const knownNames=new Map();
    for(const r of dataset.records||[]){const id=clean(r.authorId);if(id&&clean(r.author)&&!knownNames.has(id))knownNames.set(id,clean(r.author));}
    const absent=entries.filter(r=>!present.has(r.id)).map(r=>({id:r.id,classId:r.classId,group:r.group,name:r.name||knownNames.get(r.id)||''}));
    const spoke=entries.filter(r=>present.has(r.id)).length;
    return {basis:metrics.participationBasis,listed:entries.length,present:spoke,rosterSize:metrics.rosterSize||0,
      absentCount:absent.length,absent,named:absent.filter(r=>r.name).length,
      idsMatch:entries.length?metrics.records.every(r=>!clean(r.authorId)||entries.some(e=>e.id===clean(r.authorId))):null};
  }
  function discussionIndicators(dataset,results={},options={}) {
    const metrics=calculateMetrics(dataset,options),content=summarizeAnalysis(dataset,results,options),ds=dimensions(options.profile);
    const themes=ds.map(d=>{const found=content.themes.find(t=>t.name===d.name);return {name:d.name,count:found?.count||0,ids:found?.ids||[],rate:content.total&&content.completed?(found?.count||0)/content.total:null};});
    const covered=themes.filter(t=>t.count>0).length;
    const preliminary=content.completed===0;
    const depth=Object.fromEntries(Object.keys(LEVELS).map(k=>[k,0]));
    const levels={},levelSources={},byId=new Map(dataset.records.map(r=>[r.id,r])),people=new Map(),topics=new Map();let maxReplyDepth=0,localCount=0;
    const signalCounts={},uncertainIds=[];let signalSample=0,signalLabeled=0;
    for(const r of metrics.records){
      const result=effectiveResult(results[r.id]);
      levels[r.id]=result?.level||'pending';levelSources[r.id]=!result?'unprocessed':result.reviewStatus==='teacher'?'teacher':result.analysisSource==='local'?'local':'model';
      const countable=true;
      if(countable)depth[levels[r.id]]++;
      if(result?.analysisSource==='local')localCount++;
      if(countable){
        // 信号是本地规则对原文的计算，与“谁判的深度”无关：模型判过的发言也照样有信号，卡片才不会因为跑过模型而空掉。
        const rawSignals=Array.isArray(result?.signals)&&result.signals.length?result.signals:Object.keys(detectDepthSignals([r.title,r.content].filter(Boolean).join('\n')));
        const detected=[...new Set(rawSignals)];
        for(const key of detected)signalCounts[key]=(signalCounts[key]||0)+1;
        signalSample++;
        if(detected.length)signalLabeled++;
      }
      if(result?.analysisSource==='local'&&result.confidence==='low')uncertainIds.push(r.id);
      if(r.authorKey)people.set(r.authorKey,(people.get(r.authorKey)||0)+1);
      if(!topics.has(r.topicId)){
        // 学生发起的话题多数没有标题，用正文开头当标题；老师发起的提问单独标出来，
        // 统计里它不算学生的话题（见 courseDigest 的「老师提问」）。
        const root=dataset.records.find(t=>t.id===r.topicId)||dataset.records.find(t=>clean(t.topicId)===clean(r.topicId)&&t.kind==='topic')||null;
        const title=clean(byId.get(r.topicId)?.title)||clean(root&&root.title)||clean(root&&root.content).replace(/\s+/g,' ').slice(0,24)||'';
        topics.set(r.topicId,{topicId:r.topicId,title,teacher:Boolean(root&&root.role==='teacher'),author:clean(root&&root.author),ids:[],people:new Set()});
      }
      const t=topics.get(r.topicId);t.ids.push(r.id);if(r.authorKey)t.people.add(r.authorKey);
      let current=r,seen=new Set([r.id]),chain=0;
      while(current.parentId&&byId.has(current.parentId)&&!seen.has(current.parentId)){seen.add(current.parentId);chain++;current=byId.get(current.parentId);}
      maxReplyDepth=Math.max(maxReplyDepth,chain);
    }
    const repeatParticipants=[...people.values()].filter(n=>n>=2).length;
    const issues=[];
    if(!dataset.collection.complete)issues.push({key:'collection',label:dataset.collection.warning||'采集分页或回复完整性未确认',action:'recollect',button:'重新采集补取'});
    if(!metrics.rosterSize)issues.push({key:'roster',label:'尚未提供应参与人数或名单，参与率缺少分母',action:'data',button:'填写应参与人数'});
    if(metrics.unknownRole)issues.push({key:'roles',label:`${metrics.unknownRole} 条发言的角色待确认`,action:'data',button:'确认角色'});
    if(metrics.total&&metrics.identityCoverage<1)issues.push({key:'identity',label:`${metrics.total-Math.round(metrics.identityCoverage*metrics.total)} 条发言缺少稳定身份`,action:'data',button:'查看身份字段'});
    if(content.completed===0 && content.total)issues.push({key:'analysis',label:'尚未分析有效发言',action:'analyze',button:'分析全部发言'});
    else if(content.completed<content.total)issues.push({key:'depth',label:`${content.total-content.completed} 条尚未分析`,action:'analyze',button:'继续模型分析'});
    else if(depth.pending)issues.push({key:'depth',label:`${depth.pending} 条模型结果缺少分类依据`,action:'depth',button:'查看原文依据'});
    const missingAxes=SCORE_AXES.filter(axis=>!content.radar[axis].count);
    if(content.completed>0 && metrics.total && missingAxes.length)issues.push({key:'scores',label:`${missingAxes.length} 个论证维度缺少可用评分依据`,action:'depth',button:'查看评分依据'});
    if(metrics.unresolvedRelations)issues.push({key:'relations',label:`${metrics.unresolvedRelations} 条回复的关系待确认；可查看已确认比例下限`,action:'activity',button:'查看回复关系'});
    if(metrics.timedCount<metrics.total)issues.push({key:'time',label:`${metrics.total-metrics.timedCount} 条发言缺少准确时间`,action:'data',button:'查看时间字段'});
    const placeholderIds=metrics.records.filter(r=>/^\[(图片|附件)回复，尚未读取(?:图片|附件)内容\]$/.test(clean(r.content))).map(r=>r.id);
    if(placeholderIds.length)issues.push({key:'placeholder',label:`${placeholderIds.length} 条图片或附件回复只读到占位文字，内容没有进入分析`,action:'activity',button:'查看这些发言'});
    const matchedIds=new Set(themes.flatMap(t=>t.ids)),matchedRecords=metrics.records.filter(r=>matchedIds.has(r.id));
    const topicIds=new Set(metrics.records.map(r=>r.topicId)),classIds=new Set(dataset.activeScope?.classId?[dataset.activeScope.classId]:dataset.scope?.classIds?.length?dataset.scope.classIds:metrics.records.map(r=>r.classId).filter(Boolean));
    const occurrences=ds.reduce((n,d)=>n+metrics.records.reduce((sum,r)=>sum+[...new Set(d.aliases||[])].filter(Boolean).reduce((hits,term)=>hits+(r.title+'\n'+r.content).split(term).length-1,0),0),0);
    const professional=metrics.records.filter(r=>content.professionalIds.includes(r.id));
    const legacy={studentTopics:metrics.records.filter(r=>r.kind==='topic'&&r.role==='student').length,replies:metrics.records.filter(r=>r.kind==='reply').length,classes:classIds.size,keywordOccurrences:occurrences,
      topicCoverage:topicIds.size&&content.completed?new Set(matchedRecords.map(r=>r.topicId)).size/topicIds.size:null,classCoverage:classIds.size&&content.completed?new Set(matchedRecords.map(r=>r.classId).filter(id=>classIds.has(id))).size/classIds.size:null,
      professionalCoverage:content.total&&content.professionalKnown?professional.length/content.total:null,professionalIds:professional.map(r=>r.id),topTheme:themes.slice().sort((a,b)=>b.count-a.count).find(t=>t.count)?.name||'暂无命中'};
    const topicRecords=metrics.records.filter(r=>r.kind==='topic');
    const replyRecords=metrics.records.filter(r=>r.kind==='reply');
    const topicMatched=topicRecords.filter(r=>matchedIds.has(r.id)).length;
    const replyMatched=replyRecords.filter(r=>matchedIds.has(r.id)).length;
    const topicAdvanced=topicRecords.filter(r=>['case','critical'].includes(levels[r.id])).length;
    const replyAdvanced=replyRecords.filter(r=>['case','critical'].includes(levels[r.id])).length;
    const topicStats={total:topicRecords.length,matched:topicMatched,coverage:topicRecords.length?topicMatched/topicRecords.length:1,advanced:topicAdvanced,advancedRate:topicRecords.length?topicAdvanced/topicRecords.length:0,professional:topicRecords.filter(r=>content.professionalIds.includes(r.id)).length,professionalRate:topicRecords.length?topicRecords.filter(r=>content.professionalIds.includes(r.id)).length/topicRecords.length:0};
    const replyStats={total:replyRecords.length,matched:replyMatched,coverage:replyRecords.length?replyMatched/replyRecords.length:1,advanced:replyAdvanced,advancedRate:replyRecords.length?replyAdvanced/replyRecords.length:0,interactionCount:metrics.interactionCount,interactionRate:replyRecords.length?Math.min(1,(metrics.interactionCount+(metrics.unresolvedRelations||0))/replyRecords.length):1};
    return {metrics,content,legacy,breadth:{covered,total:ds.length,rate:ds.length&&content.completed?covered/ds.length:null,themes},depth,levels,levelSources,localCount,depthBasis:preliminary?'unprocessed':content.completed<content.total?'partial':'analyzed',
      advancedRate:content.total&&content.completed?(depth.case+depth.critical)/content.total:null,criticalRate:content.total&&content.completed?depth.critical/content.total:null,
      classifiedRate:content.total?(content.total-content.depth.pending)/content.total:null,
      conversation:{maxReplyDepth,repeatParticipants,repeatParticipationRate:people.size?repeatParticipants/people.size:null},issues,
      signals:{counts:signalCounts,labels:SIGNAL_LABELS,total:signalSample,labeled:signalLabeled,hits:Object.values(signalCounts).reduce((n,count)=>n+count,0)},
      uncertain:{count:uncertainIds.length,ids:uncertainIds,rate:localCount?uncertainIds.length/localCount:null},
      placeholders:{count:placeholderIds.length,ids:placeholderIds},
      absence:absentFromRoster(dataset,metrics,options.roster||[]),
      topicStats,replyStats,
      topics:[...topics.values()].map(t=>({topicId:t.topicId,title:t.title,teacher:Boolean(t.teacher),author:t.author||'',ids:t.ids,total:t.ids.length,participants:t.people.size,observedParticipationRate:people.size?t.people.size/people.size:null}))};
  }

  function extractKeywords(dataset,results,mode='raw',stopWords=[]) {
    const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'word'}):null,termCache=new Map();
    const records=calculateMetrics(dataset).records,stop=new Set(stopWords.map(clean)),map=new Map();
    for(const r of records){const text=[r.title,r.content].join('\n');let terms=[];
      if(mode==='concept')terms=[...new Set((effectiveResult(results[r.id])?.mentions||[]).map(m=>m.dimension))];
      else {
        terms=DEFAULT_DIMENSIONS.flatMap(d=>d.aliases).filter(t=>text.includes(t));
        if(termCache.has(text))terms=termCache.get(text);else{if(segmenter)for(let offset=0;offset<text.length;offset+=4096)for(const s of segmenter.segment(text.slice(Math.max(0,offset-12),offset+4108)))if(s.isWordLike&&s.segment.length>=2&&s.segment.length<=12)terms.push(s.segment);terms=[...new Set(terms)];if(termCache.size<2000)termCache.set(text,terms);}
        terms=[...new Set(terms)];
      }
      for(const term of terms){if(stop.has(term)||['这个','那个','我们','他们','因为','所以','可以','应该','同意','一个','没有','不是','进行','学生','问题','认为','影响','方面','相关','需要','比如','能够','这种','这些','通过','比较','不同','作用','有助于','一些','以及','情况','来说','还是','非常','更加','一定','很多','主要','首先','其次','最后','这样','那样','对于'].includes(term))continue;
        if(!map.has(term))map.set(term,{term,count:0,occurrences:0,ids:[]});const v=map.get(term);v.count++;v.ids.push(r.id);v.occurrences+=text.split(term).length-1;}
    }
    return [...map.values()].sort((a,b)=>b.count-a.count||b.term.length-a.term.length).slice(0,50);
  }
  function buildHeatmap(dataset,minutes=1440,options={}) {
    const rows=new Map(),valid=calculateMetrics(dataset).records.filter(r=>r.createdAt&&['day','minute','second'].includes(r.timePrecision));
    const group=options.group==='class'?'class':(options.group==='all'?'all':'person');
    const rowKey=r=>group==='class'?(clean(r.className)||'未标注班级'):(group==='all'?'all':(r.authorKey||'unknown'));
    const offset = 8 * 3600000;
    const epochOffset = 4 * 86400000; // 1970-01-01 was Thursday. To start week on Monday, shift by 4 days.
    const getSlot = (iso) => {
      const ms = minutes * 60000;
      const t = Date.parse(iso);
      if (minutes >= 43200) {const d=new Date(t+offset);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)-offset;}
      if (minutes >= 10080) return Math.floor((t + offset - epochOffset) / ms) * ms + epochOffset - offset;
      if (minutes >= 1440) return Math.floor((t + offset) / ms) * ms - offset;
      return Math.floor(t / ms) * ms;
    };
    for(const r of valid){const slot=getSlot(r.createdAt);const key=rowKey(r);
      if(!rows.has(key))rows.set(key,{key,ids:[],cells:new Map()});const row=rows.get(key);if(!row.cells.has(slot))row.cells.set(slot,[]);row.cells.get(slot).push(r.id);row.ids.push(r.id);}
    return {rows:[...rows.values()].map(r=>({...r,cells:[...r.cells].map(([time,ids])=>({time,ids,count:ids.length}))})),slots:[...new Set(valid.map(r=>getSlot(r.createdAt)))].sort((a,b)=>a-b),missing:calculateMetrics(dataset).records.length-valid.length};
  }
  function reportMarkdown(dataset,results,options={}) {
    const m=calculateMetrics(dataset,options),a=summarizeAnalysis(dataset,results,options),fmt=v=>v==null?'数据不足':(v*100).toFixed(1)+'%';
    const indicators=discussionIndicators(dataset,results,options);
    const lines=['# '+redact(dataset.title,dataset.records.map(r=>r.author)), '', '范围：'+(options.scopeLabel||'当前筛选范围'),'采集：'+(dataset.collection.complete?'完整':'完整性未确认'),
      '', '## 参与情况', `学生发言：${m.total} 条（未知角色 ${m.unknownRole} 条）`, `已识别参与者：${m.participants} 人；身份字段覆盖：${fmt(m.identityCoverage)}`,
      `参与率：${fmt(m.participationRate)}`, `人均发言（参与学生）：${m.average==null?'数据不足':m.average.toFixed(2)}`,`互动回复率：${fmt(m.interactionRate)}；已确认互动 ${m.interactionCount} 条；关系未确认 ${m.unresolvedRelations} 条`,
      `讨论跨度：${m.spanMinutes==null?'时间不足':m.spanMinutes.toFixed(1)+' 分钟'}；有准确时间 ${m.timedCount}/${m.total} 条`, '', '## 内容分析',
      `课程与思政主题涉及率（宽口径）：${fmt(a.coverage)}（${a.matched}/${a.total} 条，提及即计入）`,`本地识别 ${a.local} 条；模型分析 ${a.analyzed} 条；教师修改 ${a.reviewed} 条`,
      `内容已处理 ${a.completed}/${a.total} 条；未完成时相关主题、专业概念和深度比例表示已确认下限，不是最终结果`,
      `主题广度：${indicators.breadth.covered}/${indicators.breadth.total} 个主题（${fmt(indicators.breadth.rate)}）`,
      `分类覆盖 ${a.classified}/${a.total} 条（${fmt(a.classificationCoverage)}）；尚未分析 ${a.unprocessed} 条，已处理待补分类 ${a.processedPending} 条；已分类中案例与思辨 ${fmt(a.advancedClassifiedRate)}`,
      `案例关联与对比思辨占比：${fmt(indicators.advancedRate)}（本地识别 ${a.local} 条，模型分析 ${a.analyzed} 条，教师修改 ${a.reviewed} 条；完成 ${a.completed}/${a.total}）`,
      `重复参与比例：${fmt(indicators.conversation.repeatParticipationRate)}；最长可查回复链：${indicators.conversation.maxReplyDepth} 层`,
      ...Object.entries(indicators.depth).filter(([k,n])=>k!=='pending'||n).map(([k,n])=>`${LEVELS[k]}：${n} 条（${fmt(a.total?n/a.total:null)}）`),
      `学生发起话题 ${indicators.legacy.studentTopics} 个；回复 ${indicators.legacy.replies} 条；关键词直接出现 ${indicators.legacy.keywordOccurrences} 次`,
      `相关话题覆盖 ${fmt(indicators.legacy.topicCoverage)}；相关班级覆盖 ${fmt(indicators.legacy.classCoverage)}；专业概念表达覆盖 ${fmt(indicators.legacy.professionalCoverage)}`,'', '## 数据缺口',
      ...indicators.issues.map(i=>'- '+i.label),'', '## 原文依据'];
    const names=dataset.records.map(r=>r.author);for(const [index,r] of m.records.entries()){const v=effectiveResult(results[r.id]);if(!v)continue;
      lines.push('',`### 发言 ${index+1}`,`主题：${(v.mentions||[]).map(x=>x.dimension).join('、')||'未命中'}`,`深度：${LEVELS[indicators.levels[r.id]]||LEVELS.pending}`,`> ${redact(v.evidence||r.content,names).replace(/\n/g,'\n> ')}`,redact(v.reason,names));}
    lines.push('', '## 统计口径', `班级人数：${m.rosterSize??'未读取'}；来源：${m.participationBasis==='automatic'?m.enrollment?.source:m.participationBasis==='declared'?'教师填写':'名单或未知'}`,'参与行为按范围内全部学生发言统计；内容比例以全部学生发言为分母，未分类保留。关键词次数按主题配置中的不同关键词逐项统计；专业概念覆盖按本地规则、模型或教师修改的逐条判断统计。主题提及不等于认同或理解深度。缺失身份、角色、时间或回复关系时保留未知，不推断为零。');return lines.join('\n');
  }
  function groupSummary(dataset,results,roster=[]) {
    const groups=[...new Set(roster.map(r=>r.group).filter(Boolean))];
    return groups.map(name=>{const members=roster.filter(r=>r.group===name&&(!dataset.activeScope?.classId||r.classId===dataset.activeScope.classId)),ids=new Set(members.map(r=>r.id));
      const d={...dataset,records:dataset.records.filter(r=>ids.has(r.authorId))},m=calculateMetrics(d,{roster:members}),a=summarizeAnalysis(d,results);
      return {name,n:members.length,participants:m.participants,total:m.total,average:m.allClassAverage,depth:a.depth,coverage:a.coverage,ids:d.records.map(r=>r.id)};
    }).filter(g=>g.n);
  }
  function compareBaseline(dataset,results,baseline,options={}) {
    const b=baseline||{};for(const key of ['expectedStudents','participants','statements','minutes'])if(!Number.isFinite(b[key])||b[key]<0)throw new Error('课堂基线需要非负数值');
    if(!b.expectedStudents||b.participants>b.expectedStudents||b.statements<b.participants)throw new Error('课堂基线人数或发言条数不一致');
    if(b.replies!=null&&(!Number.isFinite(b.replies)||b.replies<0||b.replies>b.statements))throw new Error('课堂基线回复条数不一致');
    const m=calculateMetrics(dataset,options);return [
      {name:'参与率',current:m.participationRate,baseline:b.participants/b.expectedStudents,unit:'percent'},
      {name:'人均发言（参与学生）',current:m.average,baseline:b.participants?b.statements/b.participants:null,unit:'number'},
      {name:'互动回复率',current:m.interactionRate,baseline:b.replies!=null&&b.statements?b.replies/b.statements:null,unit:'percent'},
    ].map(r=>({...r,delta:r.current!=null&&r.baseline!=null?r.current-r.baseline:null}));
  }
  function exportSnapshot(dataset,results,profile,identities) {
    const names=dataset.records.map(r=>r.author);const identity=id=>{if(!identities||!Object.hasOwn(identities,id))throw new Error('匿名编号尚未准备完成');return identities[id];};
    const sanitize=value=>typeof value==='string'?redact(value,names):Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitize(v)])):value;
    return {version:1,rubricVersion:VERSION,analysisPolicy:MODEL_POLICY,profile,dataset:{schemaVersion:1,id:'snapshot-'+hash(dataset.id),createdAt:dataset.createdAt,title:redact(dataset.title,names),imported:true,collection:sanitize(dataset.collection),scope:{classIds:[...(dataset.scope?.classIds||[])]},classes:sanitize(dataset.classes||[]),
      records:dataset.records.map(r=>({...sanitize(r),author:'',authorId:r.authorId?identity(r.authorId):'',authorKey:r.authorId?'id:'+identity(r.authorId):r.authorKey?'name:'+identity(r.authorKey):'',sourceUrl:'',content:redact(r.content,names),title:redact(r.title,names)}))},results:sanitize(results)};
  }
  function importAnalysis(value,datasetId='import-'+Date.now()) {
    const data=parseJson(value),source=data.dataset||data,records=source.records||source.comments;
    if(!Array.isArray(records)||!records.length||!records.every(r=>r&&typeof r.content==='string'))throw new Error('记录必须包含正文，且不能为空');
    if(source.records&&(!records.every(r=>r.id)||new Set(records.map(r=>String(r.id))).size!==records.length))throw new Error('标准记录必须包含不重复的 id');
    const dataset=createDataset({...source,comments:records,selectedClassIds:source.scope?.classIds||source.selectedClassIds||[],capturedAt:source.createdAt,complete:source.collection?.complete===true||source.complete===true,collectionWarning:source.collection?.warning||'',datasetId});
    dataset.imported=true;
    dataset.classes=dataset.classes.map(c=>({...c,studentCountReadAt:clean(source.classes?.find(x=>clean(x.id)===c.id)?.studentCountReadAt),studentCountWarning:clean(source.classes?.find(x=>clean(x.id)===c.id)?.studentCountWarning)}));
    for(const c of dataset.classes){if(!c.studentCountReadAt)delete c.studentCountReadAt;if(!c.studentCountWarning)delete c.studentCountWarning;}
    const profile=data.profile||data.meta?.profile||null,results=initialAnalysis(dataset),byId=new Map(dataset.records.map(r=>[r.id,r]));
    const safe=dataset.records.map(r=>({commentId:r.id,parentId:r.parentId,title:r.title,content:r.content})),safeById=new Map(safe.map(r=>[r.commentId,r]));
    for(const [id,result] of Object.entries(data.results||data.task?.results||{})) {
      if(!byId.has(id))throw new Error('分析结果包含范围外的发言');
      if(!effectiveResult(result))continue;
      // 旧的四分制快照允许短引用，新的五分制必须至少 4 个字：快照没写 scoreMax 时按它自己声明的量表判断，
      // 不能一律当四分制（那样五分制快照会被整份拒绝），也不能一律当五分制（那样旧成绩会被判无效）。
      const inferredMax=result.scoreSource==='ai'||result.scoreRubric===SCORE_RUBRIC?SCORE_MAX:4;
      const validated=validateBatch({items:[{...result,commentId:id}]},[safeById.get(id)],safe,dimensions(profile).map(d=>d.name),{strictEvidence:true,scoreMax:result.scoreMax||inferredMax})[0];
      results[id]={...result,commentId:id};
    }
    return {dataset,results,profile};
  }
  function evaluateAnnotations(dataset,results,labels,profile) {
    if(!Array.isArray(labels))throw new Error('人工标注应为数组');
    const ids=new Set(dataset.records.map(r=>r.id)),seen=new Set(),names=dimensions(profile).map(d=>d.name);
    const themes=Object.fromEntries(names.map(n=>[n,{tp:0,fp:0,fn:0,fpIds:[],fnIds:[]}]));let themeSamples=0,depthSamples=0,depthCorrect=0;const confusion={};
    for(const label of labels){if(!label||!ids.has(label.commentId)||seen.has(label.commentId))throw new Error('人工标注包含范围外或重复发言ID');seen.add(label.commentId);
      const result=results[label.commentId]||{},prediction=result.reviewedOriginal||result;
      if(label.themes!=null){if(!Array.isArray(label.themes)||label.themes.some(n=>!names.includes(n)))throw new Error('人工标注主题不在当前口径内');themeSamples++;
        for(const n of names){const expected=label.themes.includes(n),actual=(prediction.mentions||[]).some(m=>m.dimension===n);if(expected&&actual)themes[n].tp++;else if(actual){themes[n].fp++;themes[n].fpIds.push(label.commentId);}else if(expected){themes[n].fn++;themes[n].fnIds.push(label.commentId);}}}
      if(label.level!=null){if(!Object.hasOwn(LEVELS,label.level)||label.level==='pending')throw new Error('人工标注层级须为已确认分类');depthSamples++;const actual=prediction.level||'pending';if(actual===label.level)depthCorrect++;const key=label.level+' → '+actual;confusion[key]=(confusion[key]||0)+1;}
    }
    return {sampleSize:seen.size,themeSamples,depthSamples,depthAccuracy:depthSamples?depthCorrect/depthSamples:null,confusion,
      themes:Object.entries(themes).map(([name,v])=>({...v,name,precision:v.tp+v.fp?v.tp/(v.tp+v.fp):null,recall:v.tp+v.fn?v.tp/(v.tp+v.fn):null}))};
  }
  // ===== 话题打包（1.0.18）：一个话题连同它的全部回复、楼中楼作为一个请求单位 =====
  // 目的：让模型看到完整讨论串，而不是被切碎的 8~12 条；请求数从数百降到数十。
  function threadPacks(dataset,options={}) {
    const roster=Array.isArray(options.roster)?options.roster:[];
    const records=options.records||calculateMetrics(dataset,options).records;
    const order=new Map(dataset.records.map((r,index)=>[r.id,index]));
    const classes=new Map((dataset.classes||[]).map(c=>[clean(c.id),c]));
    const groups=new Map();
    for(const r of records){const key=clean(r.topicId)||r.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
    const packs=[];
    for(const [topicId,rows] of groups) {
      rows.sort((a,b)=>{const ka=a.id===topicId?0:a.kind==='topic'?1:2,kb=b.id===topicId?0:b.kind==='topic'?1:2;
        return ka-kb||((order.get(a.id)??0)-(order.get(b.id)??0));});
      const topic=rows.find(r=>r.id===topicId)||rows.find(r=>r.kind==='topic')||rows[0];
      const classId=clean(topic.classId||(rows.find(r=>r.classId)||{}).classId);
      const declared=classId?classes.get(classId):null;
      const rosterSize=roster.length?(classId?roster.filter(r=>clean(r.classId)===classId).length:roster.length):0;
      const declaredSize=declared&&Number.isInteger(Number(declared.studentCount))?Number(declared.studentCount):null;
      // 话题根要按 dataset.records 查：上面判断用的 records 已经过滤掉老师与系统，
      // 老师发起的提问本来就在里面查不到，标题和“谁发的”都必须回原始记录里找。
      const root=dataset.records.find(r=>r.id===topicId)||dataset.records.find(r=>clean(r.topicId)===topicId&&r.kind==='topic')||null;
      // 学生发起的话题大多没有标题（平台把正文放在内容里），
      // 用正文开头当标题，免得报告里出现“话题 6FD7F9AD”这种看不出是什么的编号。
      const title=clean(topic.title)||clean(root&&root.title)||clean(root&&root.content).replace(/\s+/g,' ').slice(0,24);
      packs.push({topicId,classId,className:clean(topic.className||(declared&&declared.name)),title:title||'话题 '+String(topicId).slice(-8),
        teacher:Boolean(root&&root.role==='teacher'),authorName:clean(root&&root.author),
        classSize:rosterSize||declaredSize,
        participants:new Set(rows.map(r=>r.authorKey||r.authorId||r.author).filter(Boolean)).size,
        nested:rows.filter(r=>r.kind==='reply'&&rows.some(x=>x.id===r.parentId&&x.kind==='reply')).length,
        records:rows,recordIds:rows.map(r=>r.id)});
    }
    // 大话题先派发，整体等待时间更短；同体积按 topicId 稳定排序，保证重试时键不变。
    packs.sort((a,b)=>b.records.length-a.records.length||String(a.topicId).localeCompare(String(b.topicId)));
    return packs;
  }
  function threadList(value,limit=8) {
    const items=Array.isArray(value)?value:value==null?[]:[value];
    return items.map(x=>clean(x).slice(0,160)).filter(Boolean).slice(0,limit);
  }
  function validateThreadBatch(value,records,contextRecords=records,allowedDimensions,options={}) {
    const items=validateBatch(value,records,contextRecords,allowedDimensions,options);
    const data=parseJson(value),raw=data.thread&&typeof data.thread==='object'?data.thread:{};
    const ids=new Set(records.map(r=>r.id||r.commentId));
    return {items,thread:{
      stage:THREAD_STAGES.includes(clean(raw.stage))?clean(raw.stage):'unclear',
      summary:clean(raw.summary).slice(0,600),
      quality:clean(raw.quality).slice(0,400),
      consensus:clean(raw.consensus).slice(0,400),
      issues:threadList(raw.issues),
      gaps:threadList(raw.gaps),
      highlights:threadList(raw.highlights).filter(id=>ids.has(id)),
    }};
  }
  // 1.0.27：报告是给任课老师看的，正文里不能出现 S 编号、「（依据 S12）」「无引用」这类内部标记。
  // 模型仍然把出处填在 evidence 字段里（程序用来核对有没有编造），但所有显示出来的文字统一过一遍 cleaner，
  // 就算模型没听话在正文里写了编号，页面上也不会露出来。
  function plainText(value) {
    return clean(String(value==null?'':value)
      .replace(/[（(]?\s*(?:依据|见|参见|参考|出处|引用)\s*[:：]?\s*S\d+[0-9A-Za-z]{0,12}(?:\s*[、,，和及]\s*S\d+[0-9A-Za-z]{0,12})*\s*[)）]?/g,'')
      .replace(/S\d+[0-9A-Za-z]{0,12}/g,'')
      .replace(/[（(]\s*无引用\s*[)）]|无引用/g,'')
      .replace(/[（(]\s*[)）]/g,'')
      // 分析口径里的三个层次名与几个学术词是内部的，老师看不懂，统一换成大白话（模型有时仍会写出来）。
      .replace(/概念复述/g,'照搬课件的话')
      .replace(/案例关联/g,'举自己的例子')
      .replace(/对比思辨/g,'提出不同看法')
      .replace(/知识建构阶段|知识建构/g,'学生讨论的深浅')
      .replace(/认知深度/g,'讨论的深浅')
      .replace(/社会存在/g,'学生之间的互动')
      // 老师反馈报告里限定词、套话太多，看着像 AI 写的：这里做确定性的删减（只删虚词，不改意思）。
      .replace(/^[ \t]*(?:综上所述|总的来说|总体来说|总体来看|整体来看|整体而言|由此可见|不难看出|值得一提的是|需要注意的是|需要指出的是|换句话说|简单来说|本报告|本次分析|本份报告)[，,：:、]?[ \t]*/gm,'')
      .replace(/在一定程度上|某种程度上|在某种意义上|相对而言|总体而言|从总体上看/g,'')
      .replace(/[，,]\s*(?=[。；;])/g,'')
      .replace(/[，,、；;]\s*(?=[。；;，,）)])/g,'')
      // 引用被删掉后常留下空括号（真机里出现过「部分学生（如）能…」「购房补贴（）和税收监管（）」），一并清掉。
      .replace(/[（(]\s*(?:如|例如|比如|譬如|见|详见)?\s*[）)]/g,'')
      .replace(/\s{2,}/g,' ')
      .trim());
  }
  // 1.0.23：整场报告的每条结论都可以带引用（材料里的 S 编号或原文短句），没有引用的结论会被标出来，
  // 由教师决定是否采信；模型只给空话、不给依据时不再直接当成结论展示。
  function reportClaims(value,limit=5,codes) {
    const items=Array.isArray(value)?value:value==null?[]:[value];
    return items.map(item=>{
      const text=plainText(typeof item==='string'?item:item&&typeof item==='object'?item.text||item.label||item.summary||'':'').slice(0,300);
      const raw=typeof item==='string'?[]:(Array.isArray(item?.evidence)?item.evidence:[item?.evidence]);
      const evidence=[...new Set(raw.map(clean).filter(Boolean))].map(entry=>{
        // 1.0.25：先按前缀取编号。模型偶尔写成“S96cb43e9”这种带尾巴的形式，旧版要求整串等于 ^S\d+$，
        // 于是这种畸形编号被当成原文短句原样显示在报告里。现在只认前面的编号，材料里没有的就丢掉。
        const matched=entry.match(/^S(\d+)/);
        if(matched){const code='S'+matched[1];return codes?(codes.has(code)?code:''):code;}
        return entry.slice(0,40);
      }).filter(Boolean).slice(0,4);
      return {text,evidence};
    }).filter(item=>item.text).slice(0,limit);
  }
  function validateCourseReport(value,codes) {
    const data=parseJson(value),raw=data.report&&typeof data.report==='object'?data.report:data;
    const kb=raw.knowledgeBuilding&&typeof raw.knowledgeBuilding==='object'?raw.knowledgeBuilding:{};
    const stage=Number(kb.stage);
    const allowed=codes instanceof Set?codes:codes?new Set(codes):null;
    const strengths=reportClaims(raw.strengths,8,allowed),gaps=reportClaims(raw.gaps,8,allowed);
    const disagreements=reportClaims(raw.disagreements,6,allowed),questions=reportClaims(raw.questions,5,allowed);
    const recommendations=reportClaims(raw.recommendations,6,null);
    // 1.0.25：报告要按班分别说、要按主题说，这两节也允许带引用（跟优势/缺口一样可核对）。
    const named=(list,limit,keys)=>(Array.isArray(list)?list:[]).map(item=>{
      const claim=reportClaims(item&&typeof item==='object'?{text:item.text||item.summary||'',evidence:item.evidence}:item,1,allowed)[0];
      if(!claim)return null;
      const source=item&&typeof item==='object'?item:{};
      const name=plainText(keys.map(key=>source[key]).find(Boolean)).slice(0,40);
      return {...claim,name};
    }).filter(Boolean).slice(0,limit);
    const classes=named(raw.classes,12,['name','class','班级']),themes=named(raw.themes,8,['name','theme','主题']);
    // 1.0.26：报告结构改成“先给一页结论，再分节展开”（参考公开的学情报告与教学督导报告写法）。
    // summary 是给老师看的摘要，sections 是自由分节（数据说明与口径、参与情况、话题分布、发言质量、谁还没来、教师团队表现…）。
    const rawSummary=raw.summary&&typeof raw.summary==='object'?raw.summary:{};
    const summary={conclusions:reportClaims(rawSummary.conclusions,3,allowed),suggestions:reportClaims(rawSummary.suggestions,3,null)};
    const sections=(Array.isArray(raw.sections)?raw.sections:[]).map(section=>{
      const source=section&&typeof section==='object'?section:{};
      const title=plainText(source.title||source.name).slice(0,30);
      const text=plainText(source.text||source.summary).slice(0,900);
      const items=(Array.isArray(source.items)?source.items:[]).map(item=>{
        const claim=reportClaims(item&&typeof item==='object'?{text:item.text||item.summary||'',evidence:item.evidence}:item,1,allowed)[0];
        if(!claim)return null;
        const name=plainText(item&&typeof item==='object'?item.name||item.label:'').slice(0,30);
        return {...claim,name};
      }).filter(Boolean).slice(0,6);
      if(!title&&!text&&!items.length)return null;
      return {title,text,items};
    }).filter(Boolean).slice(0,8);
    const sectionClaims=sections.reduce((list,section)=>list.concat(section.items),[]);
    // 1.0.29：关键词与词云改成模型提取（本地词频只知道“哪个词出现得多”，说不出“这场讨论在讲什么”）。
    // 关键词只做清洗与去重，不参与引用率统计（模型没法给每个词配一条原文依据）。
    const seenWord=new Set();
    const keywords=(Array.isArray(raw.keywords)?raw.keywords:[]).map(entry=>{
      const source=entry&&typeof entry==='object'?entry:{word:entry};
      const word=plainText(source.word||source.term||source.name).replace(/[「」“”'"（）()《》，,。；;：:、!！?？\s]/g,'').slice(0,12);
      const weight=Number(source.weight??source.value??source.score);
      return word?{word,weight:Number.isFinite(weight)?Math.max(1,Math.min(5,Math.round(weight))):3}:null;
    }).filter(item=>item&&!seenWord.has(item.word)&&(seenWord.add(item.word),true)).slice(0,30);
    const claims=[...summary.conclusions,...strengths,...gaps,...disagreements,...classes,...themes,...sectionClaims];
    const report={summary,overview:plainText(raw.overview).slice(0,1800),depth:plainText(raw.depth).slice(0,1200),
      knowledgeBuilding:{stage:Number.isInteger(stage)&&stage>=1&&stage<=5?stage:null,label:plainText(kb.label).slice(0,40),reason:plainText(kb.reason).slice(0,500)},
      strengths,gaps,recommendations,disagreements,questions,classes,themes,sections,keywords,
      citations:{total:claims.length,cited:claims.filter(item=>item.evidence.length).length,rate:claims.length?claims.filter(item=>item.evidence.length).length/claims.length:null},
      generatedAt:new Date().toISOString()};
    if(!report.overview&&!strengths.length&&!gaps.length&&!recommendations.length&&!sections.length)throw new Error('模型没有返回整场分析内容');
    return report;
  }
  // 整场报告的输入：本地统计 + 每个话题的摘要与阶段 + 逐班统计 + 代表发言（不含全文，原文仍可在“原文依据”里核对）。
  // 1.0.25 起口径只看本次采集到的内容：班级数、发言学生数、话题数全部从记录里算。
  // 旧版用 (dataset.classes||[]).length 当“班级数”，把只采了 3 个班的分析写成“30 个班级”，是用户投诉的那处错误。
  function courseDigest(dataset,results,threads={},packs=[],options={}) {
    const m=calculateMetrics(dataset,options),a=summarizeAnalysis(dataset,results,options),v=discussionIndicators(dataset,results,options);
    const codeOf=options.codes instanceof Map?options.codes:new Map();
    const round=n=>n==null?null:Number(Number(n).toFixed(3));
    const byId=new Map(dataset.records.map(r=>[r.id,r]));
    // 名册（班级管理 · 全部学生）按班号取，逐班算参与率与“还没发言的人”。
    const rosterOf=new Map((dataset.classes||[]).filter(c=>Number.isInteger(c.studentCount)).map(c=>[clean(c.id),c]));
    const classOrder=[],classMap=new Map();
    for(const r of m.records){
      const key=clean(r.classId)||clean(r.className);
      if(!key)continue;
      if(!classMap.has(key)){classMap.set(key,{name:clean(r.className)||'未标注班级',records:0,people:new Set(),names:new Set(),topics:new Set(),levels:{},replies:0,rootTopics:0});classOrder.push(key);}
      const bucket=classMap.get(key);
      if(!bucket.name||bucket.name==='未标注班级')bucket.name=clean(r.className)||bucket.name;
      bucket.records+=1;
      if(r.authorKey)bucket.people.add(r.authorKey);
      if(clean(r.author))bucket.names.add(clean(r.author));
      if(r.topicId)bucket.topics.add(r.topicId);
      // 1.0.29：把“学生自己发起的话题”和“跟帖回复”分开记。有的班话题多但没人跟帖（每话题回复 0.3 条），
      // 有的班话题少但每条下面都有好几条回复。只看总条数会以为采集漏了，报告要能自己解释这件事。
      if(clean(r.parentId))bucket.replies+=1;else bucket.rootTopics+=1;
      const level=results[r.id]?.level||'pending';
      bucket.levels[level]=(bucket.levels[level]||0)+1;
    }
    const classes=classOrder.map(key=>{const bucket=classMap.get(key),entry=rosterOf.get(key)||{};
      const rosterNames=[...new Set((entry.rosterNames||[]).map(clean).filter(Boolean))];
      const absent=rosterNames.filter(name=>!bucket.names.has(name));
      const rosterSize=Number.isInteger(entry.studentCount)?entry.studentCount:null;
      return {班级:bucket.name,班号:key,发言:bucket.records,发言学生:bucket.people.size,话题:bucket.topics.size,
        发起话题:bucket.rootTopics,回复:bucket.replies,每话题回复:bucket.rootTopics?round(bucket.replies/bucket.rootTopics):null,
        名册人数:rosterSize,名册来源:rosterSize?(clean(entry.studentCountSource)||'班级名册'):'',
        参与率:rosterSize?round(bucket.people.size/rosterSize):null,
        未发言:rosterNames.length?absent.length:null,未发言名单:absent.slice(0,20),
        对比思辨:bucket.levels.critical||0,案例关联:bucket.levels.case||0,概念复述:bucket.levels.basic||0};});
    const classNames=classes.map(item=>item.班级);
    // 老师发起的提问：学生回复的是它，但它不算学生发起的话题，单独统计。
    const teacherTopics=(dataset.records||[]).filter(r=>r.role==='teacher'&&r.kind==='topic');
    const teacherByClass=new Map();
    let teacherCourseLevel=0;
    for(const t of teacherTopics){
      const key=clean(t.classId)||clean(t.className);
      if(!key){teacherCourseLevel+=1;continue;}
      teacherByClass.set(key,(teacherByClass.get(key)||0)+1);
    }
    for(const item of classes)item.老师提问=teacherByClass.get(item.班号)||0;
    const teacherTotal=teacherTopics.length;
    const topicCount=new Set(m.records.map(r=>clean(r.topicId)).filter(Boolean)).size;
    const themes=a.themes.filter(t=>t.count>0).sort((x,y)=>y.count-x.count).slice(0,12).map(t=>({主题:t.name,提及:t.count,
      涉及班级:[...new Set(t.ids.map(id=>clean(byId.get(id)?.className)).filter(Boolean))].slice(0,6)}));
    // 代表发言：优先取“对比思辨/案例关联”的原文短句，给模型可以核对和引用的具体材料（每条截 60 字）。
    const wanted=(options.docRows||[]).filter(row=>{
      const level=results[row.id]?.level;
      return level==='critical'||level==='case';
    });
    const picked=[],seenTopic=new Set();
    for(const row of wanted){
      const topicKey=clean(row.groupTitle)||row.topicId;
      if(seenTopic.has(topicKey)&&picked.length>=6)continue;
      seenTopic.add(topicKey);
      const quote=clean(row.content)||clean(row.title);
      picked.push({编号:row.code,班级:clean(row.className),时间:clean(row.stamp),话题:clean(row.groupTitle).slice(0,36),
        层次:results[row.id]?.level==='critical'?'对比思辨':'案例关联',原话:quote.slice(0,60)});
      if(picked.length>=16)break;
    }
    const rosterTotal=classes.reduce((n,c)=>n+(c.名册人数||0),0);
    const absentTotal=classes.reduce((n,c)=>n+(c.未发言||0),0);
    const hasRoster=classes.some(c=>c.名册人数!=null);
    const rosterKnown=classes.length>0&&classes.every(c=>Number.isInteger(c.名册人数));
    // 报告第一节要讲清“这些数字是怎么来的”，口径由引擎给出，避免模型自己编。
    const 口径=[
      `班级范围：本次只采集了 ${classes.length} 个班（${classNames.join('、')||'未标注班级'}）。课程页里还有别的班没有采集，报告里不要提它们，也不要用课程总人数。`,
      `发言条数 ${m.total} 条：其中话题 ${topicCount} 个，其余是回复（含回复的回复）。`,
      `话题按谁发起的分开算：逐班的「发起话题」只算学生自己发起的；老师发起的提问共 ${teacherTotal} 个${teacherCourseLevel?`（其中 ${teacherCourseLevel} 个是课程级、所有班都看得到）`:''}，单独列在「老师提问」里，不计入学生话题。学生回复的是老师的提问，这类回复照样算学生发言。`,
      `发言学生 ${m.participants} 人：本次采集里出现过的学号去重后的数量。同一个人在话题接口和回复接口有两套平台 ID，已经合并，不会重复计算。`,
      hasRoster?`名册人数：${classes.map(c=>`${c.班级} ${c.名册人数 ?? '未读取'} 人`).join('、')}，合计 ${rosterTotal} 人，来源是各班「班级管理 · 全部学生」页。`:'这次没有读到班级名册，不要推算参与率。',
      ...(hasRoster?[`参与率＝发言学生数 ÷ 名册人数${m.participationRateLowerBound?'（有个别话题的回复没读全，按“至少这么多”写）':''}。`]:[]),
      ...(rosterKnown?[absentTotal?`名册里有 ${absentTotal} 人这次没有在讨论区发言。`:'名册里的学生这次都发过言（零发言 0 人），不要编“还有同学没参与”。']:[]),
      '内容层次（概念复述／案例关联／对比思辨）由本地规则加模型逐条判断，三类互斥；主题提及次数不等于认同或理解深度。'
    ];
    return {title:redact(dataset.title,dataset.records.map(r=>r.author)),
      scope:options.scopeLabel||`本次采集范围：${classes.length} 个班（${classNames.join('、')||'未标注班级'}）、${topicCount} 个话题、${m.total} 条发言。报告只能写这个范围里的内容，不要出现范围外的班级或其他班级。`,
      participation:{发言条数:m.total,发言学生数:m.participants,
        发言学生数说明:'本次采集里出现过的学号去重（同一学生的两套平台 ID 已合并），写报告时就说“本次采集到的发言学生 N 人”',
        名册人数:m.rosterSize,
        名册说明:m.rosterSize?`名册来自各班「班级管理 · 全部学生」页：${classes.map(c=>`${c.班级} ${c.名册人数 ?? '未读取'} 人`).join('、')}`:'没有名册，不要推算参与率',
        参与率:round(m.participationRate),参与率说明:m.participationRateLowerBound?'个别话题的回复没读全，这是“至少”的下限':'',
        未发言:rosterKnown?absentTotal:null,人均发言:round(m.average),
        互动率:round(m.interactionRate),回复数:m.interactionCount,班级数:classes.length,班名:classNames},
      口径,
      逐班:classes,
      老师提问:{总数:teacherTotal,课程级:teacherCourseLevel,
        逐班:classes.map(c=>({班级:c.班级,数量:c.老师提问||0})).filter(item=>item.数量),
        说明:'老师发起的提问单独统计，不计入学生发起的话题；学生对这些提问的回复仍算学生发言。'},
      depth:{概念复述:a.depth.basic,案例关联:a.depth.case,对比思辨:a.depth.critical,简单回应:a.depth.na,未分类:a.depth.pending,已确认:a.completed,总数:a.total},
      themes,professional:{related:v.legacy.professionalIds.length,coverage:round(v.legacy.professionalCoverage)},
      detection:Object.fromEntries(Object.entries(v.signals.counts).map(([key,count])=>[v.signals.labels[key]||key,count])),
      uncertain:{count:v.uncertain.count,rate:round(v.uncertain.rate),codes:v.uncertain.ids.map(id=>codeOf.get(id)).filter(Boolean).slice(0,40)},
      代表发言:picked,
      threads:packs.map(p=>{const t=threads[p.topicId]||{},levels={};for(const id of p.recordIds){const level=results[id]?.level||'pending';levels[level]=(levels[level]||0)+1;}
        return {topicId:p.topicId,title:p.title,class:clean(p.className||p.classId),
        records:p.recordIds.length,participants:p.participants,classSize:p.classSize,stage:t.stage||null,summary:t.summary||'',issues:t.issues||[],gaps:t.gaps||[],
        levels:{概念复述:levels.basic||0,案例关联:levels.case||0,对比思辨:levels.critical||0,未分类:levels.pending||0}};})};
  }
  // 1.0.21：把所有发言整理成“一份文档”直接交给模型，不再一个话题发一次请求。
  // 文档只保留分析用得上的信息（班级、时间、发言人、正文与回复关系），不写内部编号、链接、账号标识；
  // 每行开头的 S 编号是给模型回填判断用的，分析结果按编号映射回真实记录。
  const DOC_PLACEHOLDER=/^\[(图片|附件)回复，尚未读取(?:图片|附件)内容\]$/;
  function documentStamp(r) {
    const raw=clean(r.timeRaw);
    // 平台的 timeRaw 是毫秒时间戳（如 1750322226179），直接写进材料模型读不懂，也会让引用对照变成一串数字。
    if(raw&&/^\d{10,13}$/.test(raw)){const ms=raw.length===13?Number(raw):Number(raw)*1000;const d=new Date(ms+8*3600*1000);if(!Number.isNaN(d.getTime()))return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;}
    if(raw)return raw.slice(0,24);
    const iso=clean(r.createdAt);return iso?iso.slice(5,16).replace('T',' '):'';
  }
  function analysisDocument(dataset,results={},options={}) {
    const metrics=calculateMetrics(dataset,options);
    const roster=options.roster||[];
    // 匿名：发给模型的材料和导出的材料都不带学生姓名（按人给一个稳定代号，模型仍分得清是谁在说）。
    const anonymous=options.anonymous===true;
    const aliasIndex=new Map([...new Set(dataset.records.filter(r=>r.role!=='teacher').map(r=>r.authorKey||r.authorId||r.author).filter(Boolean))].map((key,i)=>[key,i+1]));
    const alias=r=>r.role==='teacher'?'老师':'学生 '+String(aliasIndex.get(r.authorKey||r.authorId||r.author)||0).padStart(2,'0');
    const useful=metrics.records;
    const order=new Map(useful.map((r,i)=>[r.id,i]));
    const packs=threadPacks(dataset,{roster,records:useful}).slice().sort((a,b)=>(order.get(a.recordIds[0])??0)-(order.get(b.recordIds[0])??0));
    const rows=[],byId=new Map();
    packs.forEach((pack,groupIndex)=>{
      for(const r of pack.records){
        const body=clean(r.content);
        const content=DOC_PLACEHOLDER.test(body)?(body.startsWith('[图片')?'【图片回复，内容未读取】':'【附件回复，内容未读取】'):body;
        const row={code:'S'+(rows.length+1),id:r.id,kind:r.kind==='topic'?'topic':'reply',parentId:clean(r.parentId),groupIndex,
          groupTitle:(pack.teacher?'老师提问：':'')+(pack.title||''),className:clean(r.className)||clean(pack.className)||'',author:anonymous?alias(r):clean(r.author),
          title:clean(r.title),content,stamp:documentStamp(r),topicId:pack.topicId};
        rows.push(row);byId.set(r.id,row);
      }
    });
    const depthOf=row=>{let d=0,cur=row;const seen=new Set();while(cur&&cur.parentId&&byId.has(cur.parentId)&&!seen.has(cur.parentId)){seen.add(cur.parentId);d+=1;cur=byId.get(cur.parentId);}return Math.min(d,3);};
    for(const row of rows){
      const parent=row.parentId?byId.get(row.parentId):null;
      const who=[row.author,row.className,row.stamp].filter(Boolean).join('，');
      const head=row.kind==='topic'?(who?`${row.code}（${who}）`:row.code):`${row.code} ↳回复 ${parent?parent.code:'上文'}${who?`（${who}）`:''}`;
      row.parentCode=parent?parent.code:'';
      // 话题的标题常常就是正文本身：只写一遍，避免出现“标题｜标题”这种重复且带分隔符的行。
      const bodyOf=row=>{const title=clean(row.title),content=clean(row.content);if(!title)return content;if(!content)return title;return content.includes(title)?content:title+'｜'+content;};
      row.line='  '.repeat(row.kind==='topic'?0:depthOf(row))+head+'：'+bodyOf(row);
    }
    const stats={title:clean(dataset.title)||'课堂讨论',classes:[...new Set(rows.map(r=>r.className).filter(Boolean))],records:rows.length,
      topics:packs.length,participants:metrics.participants,rosterSize:metrics.rosterSize||0,participationRate:metrics.participationRate,
      placeholders:metrics.records.filter(r=>DOC_PLACEHOLDER.test(clean(r.content))).length,spanMinutes:metrics.spanMinutes,
      chars:0};
    const header=[
      `# 课堂讨论材料：${stats.title}`,
      `范围：${stats.classes.join('、')||'全部班级'}　参与：${stats.participants} 人${stats.rosterSize?`（名册 ${stats.rosterSize} 人）`:''}　发言：${stats.records} 条（话题 ${stats.topics} 个）${stats.spanMinutes?`　时间跨度：约 ${stats.spanMinutes} 分钟`:''}${stats.placeholders?`　另有 ${stats.placeholders} 条图片或附件回复没有文字内容`:''}`,
      `说明：已去掉打卡、纯表情等没有内容的发言${stats.placeholders?`，图片或附件回复只有占位文字、没有放进材料`:''}。每行开头的 S 编号用于回填逐条判断，请按编号引用，不要改动或增删编号。`,
    ];
    const text=()=>header.join('\n')+'\n\n'+renderDocumentRows(rows)+'\n';
    stats.chars=text().length;
    return {header,stats,rows,text:text(),docRecords:rows.map(r=>({id:r.code,commentId:r.code,parentId:r.parentCode,title:r.title,content:r.content,kind:r.kind}))};
  }
  function renderDocumentRows(rows) {
    const out=[];let group=-1,topicNo=0;
    for(const row of rows){
      if(row.groupIndex!==group){group=row.groupIndex;topicNo+=1;out.push(`### 话题 ${topicNo}｜${row.groupTitle||'独立发言'}`);}
      out.push(row.line);
    }
    return out.join('\n');
  }
  // 按字符数和条数把文档切成尽量少的几段；每段都带上表头与说明。
  function documentParts(doc,options={}) {
    const maxChars=Math.max(4000,Number(options.maxChars)||120000),maxRecords=Math.max(10,Number(options.maxRecords)||150);
    const chunks=[];let rows=[],chars=0;
    for(const row of doc.rows){const size=row.line.length+1;if(rows.length&&(rows.length>=maxRecords||chars+size>maxChars)){chunks.push(rows);rows=[];chars=0;}rows.push(row);chars+=size;}
    if(rows.length)chunks.push(rows);
    if(!chunks.length)chunks.push([]);
    return chunks.map((rows,index)=>({part:index+1,parts:chunks.length,rows,recordIds:rows.map(r=>r.id),
      codes:rows.map(r=>r.code),chars:doc.header.join('\n').length+rows.reduce((sum,r)=>sum+r.line.length+1,0),
      text:doc.header.join('\n')+'\n\n'+(rows.length?renderDocumentRows(rows):'（这个范围没有可分析的发言）')+'\n'}));
  }
  function validateDocumentBatch(value,records,allowedDimensions,options={}) {
    const parsed=parseJson(value),data={...parsed};
    // 紧凑行只减少 JSON 字段名；展开后仍用同一套编号、原文证据与维度校验。
    if(Array.isArray(data.items))data.items=data.items.map(row=>{
      if(!Array.isArray(row))return row;
      const [commentId,level,evidence,reason,rawMentions=[],rawScores=[],rawProfessional,quotes]=row;
      if(quotes!=null&&(!Array.isArray(quotes)||quotes.some(q=>typeof q!=='string')))throw new Error('原文引用表格式无效');
      const quoteOf=value=>{if(Number.isInteger(value)){if(!quotes||value<0||value>=quotes.length)throw new Error('原文引用编号无效');return quotes[value];}return value;};
      if(!Array.isArray(rawMentions)||!Array.isArray(rawScores))throw new Error('紧凑分析结果格式无效');
      const mentions=rawMentions.map(m=>{
        if(!Array.isArray(m))throw new Error('主题分析格式无效');
        const [key,quote,contextId='']=m;
        return {dimension:Number.isInteger(key)?allowedDimensions?.[key]:key,evidence:quoteOf(quote),contextId};
      });
      const scores={};for(const item of rawScores){
        if(!Array.isArray(item))continue;
        const index=typeof item[0]==='string'&&/^[0-4]$/.test(item[0])?Number(item[0]):item[0];
        const axis=Number.isInteger(index)?SCORE_AXES[index]:SCORE_AXES.includes(index)?index:null;
        if(!axis)continue;
        scores[axis]={value:item[1],evidence:quoteOf(item[2])};
      }
      let professional;
      if(rawProfessional!=null){
        if(!Array.isArray(rawProfessional)||![true,false,0,1].includes(rawProfessional[0]))throw new Error('专业概念判断格式无效');
        professional={related:Boolean(rawProfessional[0]),evidence:quoteOf(rawProfessional[1])||''};
      }
      return {commentId,level,evidence:quoteOf(evidence),reason,mentions,scores,professional};
    });
    const items=validateBatch(data,records,options.contextRecords||records,allowedDimensions,{requireProfessional:options.requireProfessional!==false,partial:Boolean(options.partial)});
    return {items,notes:clean(data?.notes).slice(0,1500)};
  }
  return {discussionContent,recordImages,VERSION,MODEL_POLICY,LOCAL_POLICY,analyzeLocal,initialAnalysis,effectiveResult,LEVELS,THREAD_STAGES,STAGE_LABELS,KNOWLEDGE_STAGES,SCORE_AXES,SCORE_MAX,SCORE_RUBRIC,MENTION_POLICY,argumentScores,scoreStatus,cohortYear,cohortComparison,DEFAULT_DIMENSIONS,DEPTH_SIGNALS,SIGNAL_LABELS,detectDepthSignals,localDepthFrom,localScores,localConfidence,mentionHit,hash,parseTime,documentStamp,createDataset,mergeDuplicateIdentities,filterDataset,calculateMetrics,dimensions,validateDirections,recomputeMentions,detectMentions,redact,modelRecords,parseJson,parseDocumentResponse,validateBatch,validateThreadBatch,validateCourseReport,validateDocumentBatch,summarizeAnalysis,preliminaryDepth,discussionIndicators,absentFromRoster,extractKeywords,buildHeatmap,reportMarkdown,groupSummary,compareBaseline,exportSnapshot,importAnalysis,evaluateAnnotations,isTrivialComment,threadPacks,courseDigest,analysisDocument,documentParts};
});
