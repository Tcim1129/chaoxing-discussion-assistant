(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./engine.js'):root.DiscussionAnalysis);if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionCollectionScope=api;})(typeof globalThis!=='undefined'?globalThis:this,function(A){
 'use strict';
 const stamp=v=>{const t=A.parseTime(v);return t.iso&&['minute','second'].includes(t.precision)?Date.parse(t.iso):null;};
 function window(options={},now=Date.now()){
  const mode=options.mode||'all';if(mode==='all')return {mode};
  const end=mode==='custom'?stamp(options.to):now,start=mode==='1h'?now-3600000:mode==='2h'?now-7200000:stamp(mode==='session'?options.startedAt:options.from);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw Error('请设置有效时间，开始时间须早于结束时间');
  return {mode,from:new Date(start).toISOString(),to:new Date(end).toISOString(),...(mode==='session'?{startedAt:options.startedAt}:{})};
 }
 const bounded=w=>Boolean(w?.from&&w?.to);
 function topicRelevant(topic,w){if(!bounded(w))return true;const created=stamp(topic.createdAt||topic.time),activity=stamp(topic.lastReplyAt||topic.last_reply_time);if(created!==null&&created>=Date.parse(w.from)&&created<Date.parse(w.to))return true;if(activity!==null)return activity>=Date.parse(w.from);if(Number(topic.replyCount)===0&&created!==null)return false;return null;}
 function canStopTopics(topics,w){if(!bounded(w)||!topics.length)return false;const ts=topics.map(t=>stamp(t.lastReplyAt||t.last_reply_time));return ts.every((n,i)=>n!==null&&n<Date.parse(w.from)&&(!i||n<=ts[i-1]));}
 function records(rows,w){if(!bounded(w))return {records:rows,selected:rows.length,contextIds:[],unknownTime:0};const from=Date.parse(w.from),to=Date.parse(w.to),byId=new Map(rows.map(r=>[r.id,r])),selected=new Set(),keep=new Set();let unknownTime=0;
  for(const r of rows){const t=stamp(r.createdAt||r.time);if(t===null||r.timePrecision&&!['minute','second'].includes(r.timePrecision)){if(r.kind!=='topic')unknownTime++;continue;}if(t>=from&&t<to){selected.add(r.id);keep.add(r.id);}}
  for(const id of selected){let parent=byId.get(byId.get(id)?.parentId),seen=new Set();while(parent&&!seen.has(parent.id)){seen.add(parent.id);keep.add(parent.id);parent=byId.get(parent.parentId);}}
  for(const r of rows)if(r.kind==='topic'&&selected.size)keep.add(r.id);
  return {records:rows.filter(r=>keep.has(r.id)),selected:selected.size,contextIds:rows.filter(r=>keep.has(r.id)&&!selected.has(r.id)).map(r=>r.id),unknownTime};
 }
 function filterReplies(rows,w){if(!bounded(w))return {replies:rows,contextIds:[],unknownTime:0};const canonical=rows.map(r=>({...r,id:r.uniqueKey||r.id,createdAt:r.createdAt||r.time,kind:'reply'})),aliases=new Map();for(const r of canonical){if(r.platformId)aliases.set(String(r.platformId),r.id);aliases.set(r.id,r.id);aliases.set(String(r.id).replace(/^(?:uuid|reply):/,''),r.id);}for(const r of canonical)r.parentId=aliases.get(String(r.parentId))||r.parentId;const out=records(canonical,w),ids=new Set(out.records.map(r=>r.id));return {replies:rows.filter(r=>ids.has(r.uniqueKey||r.id)),contextIds:out.contextIds,unknownTime:out.unknownTime};}
 function createControl(){let paused=false,cancelled=false;const waiters=new Set(),aborters=new Set(),wake=()=>{for(const resolve of waiters)resolve();waiters.clear();};return {aborters,get paused(){return paused;},get cancelled(){return cancelled;},pause(){if(!cancelled)paused=true;},resume(){if(!cancelled){paused=false;wake();}},cancel(){cancelled=true;paused=false;for(const controller of aborters)controller.abort();wake();},async wait(){while(paused&&!cancelled)await new Promise(resolve=>waiters.add(resolve));if(cancelled)throw Object.assign(new Error('已停止旧范围采集'),{code:'COLLECTION_CANCELLED'});}};}
 return {window,bounded,stamp,topicRelevant,canStopTopics,records,filterReplies,createControl};
});
