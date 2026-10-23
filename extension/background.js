const BRIDGE_SOURCE = 'cx-discussion-summary';
const BRIDGE_PORT_NAME = 'cx-discussion-summary';

if (typeof importScripts === 'function') importScripts('analysis/engine.js','analysis/collection-scope.js');

const tabPorts = new Map();
const pendingRequests = new Map();
const collectionControls=new Map();
function collectionControlFor(tabId){if(tabId==null||typeof DiscussionCollectionScope==='undefined')return null;if(!collectionControls.has(tabId))collectionControls.set(tabId,DiscussionCollectionScope.createControl());return collectionControls.get(tabId);}

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

function isDiscussionReplyUrl(url) {
  return isChaoxingTopicPageUrl(url) && /(?:topicDiscuss\/)?replysList/i.test(String(url || ''));
}

function isCourseTopicListUrl(url) {
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPortSet(tabId) {
  if (!tabPorts.has(tabId)) tabPorts.set(tabId, new Set());
  return tabPorts.get(tabId);
}

function removeRecord(record, disconnectError) {
  if (!record || record.tabId == null) return;
  const ports = tabPorts.get(record.tabId);
  if (!ports) return;
  ports.delete(record);
  if (!ports.size) tabPorts.delete(record.tabId);

  for (const [requestId, pending] of Array.from(pendingRequests.entries())) {
    if (pending.source === record || pending.target === record) {
      pendingRequests.delete(requestId);
      try {
        pending.source.port.postMessage({
          source: BRIDGE_SOURCE,
          type: 'result',
          requestId,
          ok: false,
          error: disconnectError && disconnectError.message
            ? `讨论页通信已断开：${disconnectError.message}。请返回讨论页后重新采集`
            : '讨论回复页通信已断开，请返回讨论页后重新采集',
        });
      } catch (error) { }
    }
  }
}

function findDiscussionFrame(tabId) {
  const ports = Array.from(tabPorts.get(tabId) || []);
  return ports.find((record) => record.isDiscussionPage)
    || ports.find((record) => isDiscussionReplyUrl(record.href))
    || null;
}

function findCourseTopicListFrame(tabId) {
  const ports = Array.from(tabPorts.get(tabId) || []);
  return ports.find((record) => record.isCourseTopicListPage)
    || ports.find((record) => isCourseTopicListUrl(record.href))
    || null;
}

function getAllFrames(tabId) {
  if (!chrome.webNavigation || typeof chrome.webNavigation.getAllFrames !== 'function') {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    try {
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        const error = chrome.runtime.lastError;
        resolve(!error && Array.isArray(frames) ? frames : []);
      });
    } catch (error) {
      resolve([]);
    }
  });
}

function injectContentScript(tabId, frameId) {
  if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['analysis/engine.js', 'analysis/collection-scope.js', 'content-script.js'],
      }, () => {
        resolve(!(chrome.runtime && chrome.runtime.lastError));
      });
    } catch (error) {
      resolve(false);
    }
  });
}

async function waitForDiscussionFrame(tabId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < (timeoutMs || 2500)) {
    const target = findDiscussionFrame(tabId);
    if (target) return target;
    await delay(100);
  }
  return findDiscussionFrame(tabId);
}

async function waitForCourseTopicListFrame(tabId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < (timeoutMs || 2500)) {
    const target = findCourseTopicListFrame(tabId);
    if (target) return target;
    await delay(100);
  }
  return findCourseTopicListFrame(tabId);
}

async function ensureDiscussionFrame(tabId) {
  const existing = findDiscussionFrame(tabId);
  if (existing) return { target: existing, reason: '' };

  const frames = await getAllFrames(tabId);
  const replyFrame = frames.find((frame) => isDiscussionReplyUrl(frame.url));
  if (!replyFrame) {
    return { target: null, reason: '当前页面没有找到 replysList 评论框架，请先进入讨论详情页并等待页面加载完成' };
  }

  const injected = await injectContentScript(tabId, replyFrame.frameId);
  if (!injected) {
    return { target: null, reason: '找到了讨论回复框架，但扩展脚本注入失败，请在扩展管理页重新加载插件后刷新页面' };
  }

  const target = await waitForDiscussionFrame(tabId, 3000);
  return {
    target,
    reason: target ? '' : '找到了讨论回复框架，但它没有完成扩展通信注册，请刷新页面后重试',
  };
}

async function ensureCourseTopicListFrame(tabId) {
  const existing = findCourseTopicListFrame(tabId);
  if (existing) return { target: existing, reason: '' };

  const frames = await getAllFrames(tabId);
  const topicFrame = frames.find((frame) => isCourseTopicListUrl(frame.url));
  if (!topicFrame) {
    return { target: null, reason: '当前页面没有找到 topicList 话题框架，请先进入课程讨论页并等待页面加载完成' };
  }

  const injected = await injectContentScript(tabId, topicFrame.frameId);
  if (!injected) {
    return { target: null, reason: '找到了课程话题框架，但扩展脚本注入失败，请在扩展管理页重新加载插件后刷新页面' };
  }

  const target = await waitForCourseTopicListFrame(tabId, 3000);
  return {
    target,
    reason: target ? '' : '找到了课程话题框架，但它没有完成扩展通信注册，请刷新页面后重试',
  };
}

function sendFailure(record, requestId, error) {
  try {
    record.port.postMessage({
      source: BRIDGE_SOURCE,
      type: 'result',
      requestId,
      ok: false,
      error,
    });
  } catch (err) { }
}

function handleRegister(record, message) {
  record.href = String(message.href || '');
  record.isTopFrame = !!message.isTopFrame;
  record.isDiscussionPage = !!message.isDiscussionPage;
  record.isCourseTopicListPage = !!message.isCourseTopicListPage;
}

async function handleCommand(record, message) {
  const requestId = String(message.requestId || '');
  if (!requestId) return;
  const captureControl=message.action==='getCourseClasses'?null:collectionControlFor(record.tabId);
  await captureControl?.wait();
  const isCourseTopicsAction = message.action === 'collectCourseTopics' || message.action === 'getCourseClasses';
  const { target, reason } = isCourseTopicsAction
    ? await ensureCourseTopicListFrame(record.tabId)
    : await ensureDiscussionFrame(record.tabId);
  if (!target) {
    sendFailure(record, requestId, reason || (isCourseTopicsAction ? '没有找到正在运行的课程话题页，请先打开课程讨论页后再试' : '没有找到正在运行的讨论回复页，请先打开讨论详情后再试'));
    return;
  }
  await captureControl?.wait();

  pendingRequests.set(requestId, { source: record, target });
  try {
    target.port.postMessage({
      source: BRIDGE_SOURCE,
      type: 'command',
      requestId,
      action: message.action,
      payload: message.payload || {},
    });
  } catch (error) {
    pendingRequests.delete(requestId);
    sendFailure(record, requestId, '讨论回复页通信失败，请刷新页面后重试');
  }
}

function handleResult(message) {
  const requestId = String(message.requestId || '');
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  pendingRequests.delete(requestId);
  try {
    pending.source.port.postMessage({
      source: BRIDGE_SOURCE,
      type: 'result',
      requestId,
      ok: !!message.ok,
      payload: message.payload || {},
      error: message.error || '',
      frameUrl: message.frameUrl || '',
    });
  } catch (error) { }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== BRIDGE_PORT_NAME) return;
  const sender = port.sender || {};
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;

  const record = {
    port,
    tabId,
    frameId: sender.frameId,
    href: '',
    isTopFrame: sender.frameId === 0,
    isDiscussionPage: false,
    isCourseTopicListPage: false,
  };
  getPortSet(tabId).add(record);

  port.onMessage.addListener((message) => {
    if (!message || message.source !== BRIDGE_SOURCE) return;
    if (message.type === 'register') handleRegister(record, message);
    else if (message.type === 'command') {
      handleCommand(record, message).catch((error) => {
        sendFailure(record, String(message.requestId || ''), error && error.message ? error.message : String(error));
      });
    }
    else if (message.type === 'result') handleResult(message);
    else if (message.type === 'progress') {
      const pending=pendingRequests.get(String(message.requestId||''));
      if(pending && pending.target===record)try{pending.source.port.postMessage(message);}catch(error){}
    }
  });

  port.onDisconnect.addListener(() => {
    // 包括 BFCache 引起的正常生命周期断开，必须在回调内读取 lastError。
    const error = chrome.runtime.lastError;
    removeRecord(record, error);
  });
});

chrome.action.onClicked.addListener(async () => {
  if (chrome.tabs && chrome.tabs.create) await chrome.tabs.create({url:chrome.runtime.getURL('workbench.html')});
  else if (chrome.runtime.openOptionsPage) await chrome.runtime.openOptionsPage();
});

// 模型网络请求由扩展分析页持有；后台只做页面通信、快照和运行互斥。
let analysisLeaseQueue = Promise.resolve();
const localGet = keys => new Promise((resolve,reject)=>chrome.storage.local.get(keys,value=>chrome.runtime.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve(value)));
const localSet = value => new Promise((resolve,reject)=>chrome.storage.local.set(value,()=>{const error=chrome.runtime.lastError;if(error)reject(new Error(/quota.*exceeded|kQuotaBytes/i.test(error.message)?'本地存储额度不足，采集尚未保存。请在扩展管理页重新加载新版扩展，再刷新课程页重试；不要卸载扩展。':error.message));else resolve();}));
function isAnalysisPage(sender) { return String(sender.url||'').startsWith(chrome.runtime.getURL('workbench.html')); }
function sourceCheck(dataset) {
  if(dataset.imported)return Promise.resolve(true);
  return new Promise((resolve,reject)=>{
    if(dataset.sourceTabId==null)return reject(new Error('原讨论页已关闭，请重新采集'));
    chrome.tabs.sendMessage(dataset.sourceTabId,{type:'discussion-source-check'},{frameId:0},result=>{
      if(chrome.runtime.lastError||!result||result.token!==dataset.captureToken||result.href!==dataset.sourceUrl)reject(new Error('原讨论页已刷新、退出或切换，请重新采集以确认当前账号'));
      else resolve(true);
    });
  });
}
// 只读班级名单页的总人数，不采集名单，也不调用切换班级接口。
function parseEnrollmentTotal(html) {
  const header=String(html||'').match(/<div\b[^>]*class=["'][^"']*total-num[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["']clear["']/i)?.[1];
  if(!header||!header.includes('全部学生'))return null;
  const text=header.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;|&#xA0;/gi,' ');
  const match=text.match(/共\s*(\d+)\s*人/);const n=match?Number(match[1]):null;
  return Number.isInteger(n)&&n>=0&&n<=100000?n:null;
}
// 班级名单表格每行＝姓名｜学号/工号｜院系｜专业｜班级｜加入时间（每页 30 行）。
// 只取姓名和学号，用来算“名册里有哪些人这次没发言”，不做任何写操作。
function parseEnrollmentRows(html) {
  const text=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;|&#xA0;/gi,' ').replace(/\s+/g,' ').trim();
  const rows=[];
  for(const block of String(html||'').split(/<tr\b/i).slice(1)){
    const cell=block.split(/<\/tr>/i)[0];
    const name=text((cell.match(/<span\b[^>]*class=["'][^"']*\bphoto-txt\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1]);
    const code=text((cell.match(/<div\b[^>]*class=["'][^"']*\bstu-txt\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)||[])[1]);
    const personId=(cell.match(/\bpersonid=["']?(\d+)/i)||[])[1]||'';
    if(!name&&!code)continue;
    rows.push({name,code,personId});
  }
  return rows;
}
async function enrichEnrollment(dataset,sourceUrl) {
  const collectionControl=collectionControlFor(dataset.sourceTabId);
  let context;try{context=new URL(sourceUrl);}catch{return;}
  const courseId=context.searchParams.get('courseId')||context.searchParams.get('courseid'),cpi=context.searchParams.get('cpi');
  if(!/^\d+$/.test(courseId||'')||!/^\d+$/.test(cpi||'')||typeof fetch!=='function')return;
  const classes=new Map((dataset.classes||[]).map(c=>[c.id,{...c}]));
  for(const r of dataset.records)if(!r.classId&&r.className){const matches=[...classes.values()].filter(c=>c.name===r.className);if(matches.length===1)r.classId=matches[0].id;}
  for(const r of dataset.records){if(r.classId&&!classes.has(r.classId))classes.set(r.classId,{id:r.classId,name:r.className||r.classId,studentCount:null});}
  const scopeIds=(dataset.scope?.classIds||[]).map(String).filter(id=>/^\d{5,}$/.test(id));
  const recordIds=[...new Set(dataset.records.map(r=>String(r.classId||'')).filter(id=>/^\d{5,}$/.test(id)))];
  // 课程级话题的回复可能来自其它班级，分母要把这些班一起算进来，否则参与率会显示“数据不足”。
  const ids=scopeIds.length?[...new Set([...scopeIds,...recordIds])]:recordIds;
  // 页面上猜出来的人数只当兜底：范围内的班级一律去班级名单页取权威人数（「全部学生 … 共 N 人」），
  // 取到就覆盖页面里读到的数字，避免把别的班、别的表格里的人数当成本班人数。
  const queue=[...new Set(ids)].filter(id=>/^\d{5,}$/.test(id))
    .sort((a,b)=>Number(Number.isInteger(classes.get(a)?.studentCount))-Number(Number.isInteger(classes.get(b)?.studentCount)));
  await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{
    while(queue.length){await collectionControl?.wait();if(!queue.length)break;const id=queue.shift(),entry=classes.get(id)||{id,name:id},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);collectionControl?.aborters?.add(controller);
      try{
        const url=new URL('https://mooc2-ans.chaoxing.com/mooc2-ans/tcm/clazz-student');
        url.search=new URLSearchParams({courseid:courseId,clazzid:id,requireStu:'',cpi,pageNum:'1',orderContent:'ID',schoolStatus:'0',v:'0',order:'up'}).toString();
        const response=await fetch(url.href,{credentials:'include',signal:controller.signal});
        const html=response.ok?await response.text():'';
        const n=html?parseEnrollmentTotal(html):null;
        if(n!==null){
          entry.studentCount=n;entry.studentCountSource='班级管理 · 全部学生';entry.studentCountReadAt=new Date().toISOString();delete entry.studentCountWarning;delete entry.studentCountConflict;
          // 顺手读名单（每页 30 行，最多 8 页），用来算“还没发言的同学”。读不全只记提醒，不影响人数。
          const people=parseEnrollmentRows(html);
          const pageSize=Math.max(people.length,1);
          const lastPage=Math.min(8,Math.ceil(n/pageSize)+1);
          for(let page=2;page<=lastPage&&people.length<n;page+=1){
            await collectionControl?.wait();
            const inner=new AbortController(),innerTimer=setTimeout(()=>inner.abort(),5000);collectionControl?.aborters?.add(inner);
            try{
              const next=new URL(url.href);next.searchParams.set('pageNum',String(page));
              const more=await fetch(next.href,{credentials:'include',signal:inner.signal});
              if(!more.ok)break;
              const rows=parseEnrollmentRows(await more.text());
              if(!rows.length)break;
              people.push(...rows);
            }catch(error){if(collectionControl?.cancelled)throw error;break;}finally{clearTimeout(innerTimer);collectionControl?.aborters?.delete(inner);}
          }
          const names=[...new Set(people.map(p=>p.name).filter(Boolean))];
          if(names.length){
            entry.rosterNames=names.slice(0,400);
            entry.rosterCodes=[...new Set(people.map(p=>p.code).filter(Boolean))].slice(0,400);
          }
          if(names.length&&names.length<n)entry.rosterNamesWarning=`名单只读到 ${names.length}/${n} 人，未发言人数可能偏少`;
          else if(names.length>=n)delete entry.rosterNamesWarning;
        }
        else if(!Number.isInteger(entry.studentCount))entry.studentCountWarning='班级人数未读取，请确认班级管理权限与登录状态';
      }catch(error){if(collectionControl?.cancelled)throw error;if(!Number.isInteger(entry.studentCount))entry.studentCountWarning='班级人数读取未完成，可重新采集补查';}finally{clearTimeout(timer);collectionControl?.aborters?.delete(controller);}
      classes.set(id,entry);
    }
  }));
  dataset.classes=[...classes.values()];
  for(const r of dataset.records){if(!r.classId&&r.className){const matches=dataset.classes.filter(c=>c.name===r.className);if(matches.length===1)r.classId=matches[0].id;}if(!r.className&&r.classId)r.className=classes.get(r.classId)?.name||'';}
}
async function analysisMessage(message,sender) {
  const action=message.action;
  if(action==='options'){await chrome.runtime.openOptionsPage();return {};}
  if(action==='collection-control'||action==='collection-reset'){
    let tabId;
    if(isAnalysisPage(sender)){const d=(await localGet('cx_analysis_dataset_'+message.datasetId))['cx_analysis_dataset_'+message.datasetId];if(!d)throw new Error('没有找到采集记录');await sourceCheck(d);tabId=d.sourceTabId;}
    else if(sender.tab&&sender.frameId===0&&/^https?:\/\/[^/]*chaoxing\.com\//i.test(sender.url||''))tabId=sender.tab.id;
    else throw new Error('只能暂停当前课程的采集');
    const frames=new Set([0,...Array.from(getPortSet(tabId)).map(record=>record.frameId).filter(Number.isInteger)]);
    const control=collectionControlFor(tabId),previous=control?.paused;
    if(action==='collection-reset'){
      control?.cancel();
      for(const [id,pending] of pendingRequests)if(pending.source?.tabId===tabId||pending.target?.tabId===tabId){
        pendingRequests.delete(id);clearTimeout(pending.timeout);
        try{pending.source.port.postMessage({source:BRIDGE_SOURCE,type:'result',requestId:id,ok:false,error:'已停止旧范围采集'});}catch(_error){}
      }
      const stopped=await Promise.allSettled([...frames].map(frameId=>new Promise((resolve,reject)=>chrome.tabs.sendMessage(tabId,{type:'discussion-collection-reset'},{frameId},result=>{if(chrome.runtime.lastError||!result?.ok)reject(new Error('旧采集未完全停止，请刷新课程页后重试'));else resolve();}))));
      if(stopped.some(r=>r.status==='rejected'))throw new Error('旧采集未完全停止，请刷新课程页后重试');
      collectionControls.delete(tabId);collectionControlFor(tabId);
      return {stopped:true};
    }
    if(message.paused)control?.pause();else control?.resume();
    const send=(frameId,paused)=>new Promise((resolve,reject)=>chrome.tabs.sendMessage(tabId,{type:'discussion-collection-control',paused},{frameId},result=>{if(chrome.runtime.lastError||!result?.ok)reject(new Error('采集页面通信失败，请刷新课程页后重试'));else resolve();}));
    const results=await Promise.allSettled([...frames].map(frameId=>send(frameId,message.paused===true)));
    if(results.some(r=>r.status==='rejected')){if(previous)control?.pause();else control?.resume();await Promise.allSettled([...frames].map(frameId=>send(frameId,Boolean(previous))));throw new Error('采集页面通信失败，已撤回本次暂停切换，请重试');}
    return {paused:message.paused===true};
  }
  if(action==='publish'){
    if(!sender.tab||sender.frameId!==0||!/^https?:\/\/[^/]*chaoxing\.com\//i.test(sender.url||''))throw new Error('只能从当前超星课程页采集');
    const d=message.dataset;if(!d||d.schemaVersion!==1||!Array.isArray(d.records)||!d.captureToken)throw new Error('采集记录格式不完整');
    d.sourceTabId=sender.tab.id;d.imported=false;
    const existing=(await localGet('cx_analysis_dataset_'+d.id))['cx_analysis_dataset_'+d.id];
    if(message.open&&d.createdAt&&existing?.createdAt===d.createdAt&&existing.captureToken===d.captureToken&&existing.sourceUrl===d.sourceUrl&&existing.sourceTabId===d.sourceTabId){
      await sourceCheck(existing);await chrome.tabs.create({url:chrome.runtime.getURL('workbench.html')+'?dataset='+encodeURIComponent(d.id)+(message.autorun?'&autorun=1':'')});return {datasetId:d.id};
    }
    const publishingControl=collectionControlFor(d.sourceTabId);
    await enrichEnrollment(d,sender.url);
    await publishingControl?.wait();
    await sourceCheck(d);
    await publishingControl?.wait();
    await localSet({['cx_analysis_dataset_'+d.id]:d});
    if(message.open)await chrome.tabs.create({url:chrome.runtime.getURL('workbench.html')+'?dataset='+encodeURIComponent(d.id)+(message.autorun?'&autorun=1':'')});
    return {datasetId:d.id};
  }
  if(!isAnalysisPage(sender))throw new Error('操作只能在扩展分析页执行');
  if(action==='check'){
    const d=(await localGet('cx_analysis_dataset_'+message.datasetId))['cx_analysis_dataset_'+message.datasetId];if(!d)throw new Error('没有找到采集记录');await sourceCheck(d);return {valid:true};
  }
  if(action==='recollect'){
    const d=(await localGet('cx_analysis_dataset_'+message.datasetId))['cx_analysis_dataset_'+message.datasetId];if(!d)throw new Error('没有找到采集记录');await sourceCheck(d);
    const raw=message.captureScope||d.captureScope||{mode:'all'},scope=typeof DiscussionCollectionScope!=='undefined'?DiscussionCollectionScope.window(raw):raw;
    const options={...(message.restart?{}:{datasetId:d.id}),classIds:message.classId?[message.classId]:(d.scope?.classIds||[]),captureScope:scope,topicId:message.topicId||scope.topicId||raw.topicId||''};
    return new Promise((resolve,reject)=>chrome.tabs.sendMessage(d.sourceTabId,{type:'discussion-recollect',options},{frameId:0},result=>{
      if(chrome.runtime.lastError||!result?.ok)reject(new Error(result?.error||'重新采集失败'));else resolve(result.payload);
    }));
  }
  if(action==='recollect-topic'){
    const d=(await localGet('cx_analysis_dataset_'+message.datasetId))['cx_analysis_dataset_'+message.datasetId];if(!d)throw new Error('没有找到采集记录');await sourceCheck(d);
    const refreshControl=collectionControlFor(d.sourceTabId);await refreshControl?.wait();
    const topicId=String(message.topicId||''),classId=String(message.classId||'');
    const old=d.records.filter(r=>r.topicId===topicId&&(!classId||r.classId===classId||r.role==='teacher'&&!r.classId));
    if(!old.length)throw new Error('该话题不在已采集范围内');
    const root=old.find(r=>r.kind==='topic')||old[0];
    const raw=message.captureScope||d.captureScope,captureScope=raw&&typeof DiscussionCollectionScope!=='undefined'?DiscussionCollectionScope.window(raw):raw;
    const result=await new Promise((resolve,reject)=>chrome.tabs.sendMessage(d.sourceTabId,{type:'discussion-collect-topic',captureScope,topic:{uuid:topicId,uniqueKey:root.id,detailUrl:root.sourceUrl||'',title:root.title||'',classId:root.classId||''},classIds:classId?[classId]:(d.scope?.classIds||[])},{frameId:0},r=>{if(chrome.runtime.lastError||!r?.ok)reject(new Error(r?.error||'话题更新失败'));else resolve(r.payload);}));
    await sourceCheck(d);
    if(!Array.isArray(result.records)||!result.records.length&&!(result.complete===true&&captureScope?.from))throw new Error('话题未返回可确认的原文，原记录已保留');
    const fresh=result.records.map(r=>({...r,topicId})),alias=new Map();
    for(const r of fresh){const prior=old.find(p=>p.kind===r.kind&&(p.id===r.id||p.platformId&&p.platformId===r.platformId));if(prior&&prior.id!==r.id)alias.set(r.id,prior.id);}
    for(const r of fresh){r.id=alias.get(r.id)||r.id;r.parentId=alias.get(r.parentId)||r.parentId;const prior=old.find(p=>p.id===r.id);if(prior){if(!r.authorId){r.authorId=prior.authorId;r.authorKey=prior.authorKey;}if(!r.author)r.author=prior.author;if(r.role==='unknown'&&prior.authorId===r.authorId)r.role=prior.role;}}
    const within=r=>r.topicId===topicId&&(!classId||r.classId===classId||r.role==='teacher'&&!r.classId),replace=r=>within(r)&&(!captureScope?.from||d.captureScope?.from||r.createdAt>=captureScope.from&&r.createdAt<captureScope.to),byId=new Map(d.records.filter(r=>!(result.complete&&replace(r))).map(r=>[r.id,r]));
    for(const r of fresh)if(!classId||r.classId===classId||r.role==='teacher'&&!r.classId)byId.set(r.id,r);
    if(!fresh.length&&root.kind==='topic')byId.set(root.id,d.captureScope?.from?{...root,captureContext:true}:root);
    d.records=[...byId.values()];d.createdAt=new Date().toISOString();d.collection=d.collection||{};
    if(captureScope)d.captureScope={...captureScope,topicId};
    if(!result.complete){d.collection.complete=false;d.collection.warning=result.warning||'指定话题尚未完整读取，保留此前记录';}
    d.collection.lastTopicRefresh={topicId,classId,at:d.createdAt,complete:result.complete===true};
    await refreshControl?.wait();
    await localSet({['cx_analysis_dataset_'+d.id]:d});return {datasetId:d.id};
  }
  if(action==='lease'||action==='release'){
    const operation=analysisLeaseQueue.catch(()=>{}).then(async()=>{
      const key='cx_analysis_lease_'+String(message.datasetId),owner=String(message.owner||'');
      if(!owner)throw new Error('缺少任务标识');
      const lease=(await localGet(key))[key],now=Date.now();
      if(action==='release'){if(lease?.owner===owner)await localSet({[key]:null});return {};}
      const d=(await localGet('cx_analysis_dataset_'+message.datasetId))['cx_analysis_dataset_'+message.datasetId];
      if(!d)throw new Error('没有找到采集记录');await sourceCheck(d);
      if(lease&&lease.expires>now&&lease.owner!==owner)throw new Error('另一个分析页正在处理这批数据');
      await localSet({[key]:{owner,expires:now+45000}});return {};
    });analysisLeaseQueue=operation;return operation;
  }
  if(action==='export-identities'){
    const operation=analysisLeaseQueue.catch(()=>{}).then(async()=>{
      if(!Array.isArray(message.identities)||message.identities.length>100000)throw new Error('匿名编号范围无效');
      const map=(await localGet('cx_analysis_export_identities')).cx_analysis_export_identities||{};
      const selected={};for(const raw of message.identities){const key=String(raw);if(!key)continue;if(!Object.hasOwn(map,key))Object.defineProperty(map,key,{value:'anon-'+crypto.randomUUID(),enumerable:true,writable:true,configurable:true});Object.defineProperty(selected,key,{value:map[key],enumerable:true,writable:true,configurable:true});}
      await localSet({cx_analysis_export_identities:map});return {identities:selected};
    });analysisLeaseQueue=operation;return operation;
  }
  if(action==='ping')return {};
  throw new Error('未知分析操作');
}
if(chrome.runtime.onMessage)chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='discussion-analysis')return;
  analysisMessage(message,sender).then(payload=>respond({ok:true,payload})).catch(error=>respond({ok:false,error:error.message}));return true;
});
