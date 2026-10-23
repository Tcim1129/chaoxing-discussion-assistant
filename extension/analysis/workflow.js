(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./engine.js'):root.DiscussionAnalysis,typeof module==='object'&&module.exports?require('./classroom.js'):root.DiscussionClassroom,typeof module==='object'&&module.exports?require('./agent.js'):root.DiscussionAgent);if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionWorkflow=api;})(globalThis,function(A,C,G){
 'use strict';
 const VERSION='classroom-workflow-1',clone=v=>JSON.parse(JSON.stringify(v));
 function source(dataset,scope,brief){const doc=C.material(dataset,{...scope,classroom:true},brief),chosen=C.select(dataset,{...scope,classroom:true}),targets=new Set(chosen.records.map(r=>r.id)),ids=new Set([...targets,...doc.rows.map(r=>r.id)]);return {...dataset,activeScope:clone(scope),records:dataset.records.filter(r=>ids.has(r.id)).map(r=>({...r,captureContext:!targets.has(r.id)}))};}
 function stamps(dataset,profile,modelKey){const byId=new Map(dataset.records.map(r=>[r.id,r])),base=JSON.stringify([A.MODEL_POLICY,A.MENTION_POLICY,A.dimensions(profile),modelKey]);return Object.fromEntries(dataset.records.filter(r=>!r.captureContext&&!['teacher','system'].includes(r.role)).map(r=>{const chain=[],seen=new Set();let p=r;while(p&&!seen.has(p.id)){seen.add(p.id);chain.push([p.id,p.parentId,p.content,p.title,p.role,p.classId,p.authorKey,p.createdAt,p.hasImages,p.images]);p=byId.get(p.parentId);}return [r.id,A.hash(base+JSON.stringify(chain))];}));}
 function report(dataset,analysis,minutes,roster){const m=A.calculateMetrics(dataset,{roster}),a=A.summarizeAnalysis(dataset,analysis.results||{},{}),doc=A.analysisDocument(dataset,analysis.results||{},{anonymous:true,roster}),codes=new Map(doc.rows.map(r=>[r.id,r.code]));
  const claims=(items=[])=>items.map(item=>({text:item.teacherText||item.text,evidence:C.refs(item).filter(e=>!e.context).map(e=>codes.get(e.id)).filter(Boolean)})).filter(x=>x.evidence.length);
  const r=minutes?.result||{},focuses=claims(r.focuses),questions=claims(r.questions),disagreements=claims(r.disagreements),consensus=claims(r.consensus);
  const overview=`本次范围采集到 ${m.total} 条学生发言（其中 ${a.total} 条计入有效分析），${m.participants} 位参与者。`+(minutes?.status==='complete'?'课堂纪要已整理。':'纪要尚未完整，当前结论仅依据已经核对的部分。');
  const depth=`有效发言已处理 ${a.completed}/${a.total} 条，其中概念复述 ${a.depth.basic} 条、案例关联 ${a.depth.case} 条、对比思辨 ${a.depth.critical} 条、待补分类 ${a.depth.pending} 条。个人评分另行启动，未生成学期成绩。`;
  return A.validateCourseReport({overview,depth,summary:{conclusions:focuses.slice(0,3),suggestions:[]},strengths:[],gaps:questions,questions,disagreements,sections:[{title:'集中观点',items:focuses},{title:'局部共识',items:consensus},{title:'待继续讨论的分歧',items:disagreements},{title:'待解问题',items:questions}],keywords:[]},new Set(codes.values()));
 }
 async function run({dataset,scope={},brief='',profile,roster=[],modelKey='',previous={},request,save=async()=>{},onProgress=()=>{},control={},maxChars=24000,maxRecords=80,maxConcurrentBatches=2,repairPending=false}){
  const scoped=source(dataset,scope,brief),current=stamps(scoped,profile,modelKey),signature=G.analysisSignature(scoped,profile)+':document-whole-v2:classroom-content-v1',key=A.hash(JSON.stringify([VERSION,C.key(dataset,{...scope,classroom:true},brief),A.dimensions(profile),modelKey]));
  const same=previous.state?.key===key,state={...(same?clone(previous.state):{}),version:VERSION,key,modelKey,scope:clone(scope),status:'running',phase:'prepare',personalScoring:false,total:A.calculateMetrics(scoped,{roster}).total,contentDone:0,contentTotal:0,received:0,trace:same?clone(previous.state.trace||[]):[],errors:[]};
  // 纪要必须标明真正生成它的模型：只有同一模型的旧纪要才能复用，换模型就重新整理，避免把 A 的纪要记成 B 生成。
  let minutes=previous.minutes?.workflowModelKey===modelKey?clone(previous.minutes):null;
  const prior=previous.analysis,matching=prior?.workflowModelKey===modelKey;
  const kept=matching?Object.fromEntries(Object.entries(prior.results||{}).filter(([id])=>current[id]&&prior.workflowStamps?.[id]===current[id])):{};
  // 人工修改始终由教师维护，切换到课堂流程不能被 AI 覆盖。
  if(prior?.datasetId===dataset.id)for(const [id,value] of Object.entries(prior.results||{}))if(current[id]&&value.reviewStatus==='teacher')kept[id]=value;
  let analysis={scoreArchive:G.scoreArchive(prior,dataset),datasetId:dataset.id,signature,mode:'document',analysisPolicy:A.MODEL_POLICY,status:'partial',phase:'prepare',results:{...A.initialAnalysis(scoped),...kept},done:[],doneRecords:Object.fromEntries(Object.entries(kept).filter(([,v])=>v.modelAnalyzed||v.reviewStatus==='teacher').map(([id])=>[id,true])),failures:[],trace:[],analyzed:0,threads:{},notes:[],workflowStamps:current,workflowModelKey:modelKey};
  if(same&&prior?.signature===signature)analysis={...clone(prior),results:{...A.initialAnalysis(scoped),...kept},doneRecords:Object.fromEntries(Object.entries(kept).filter(([,v])=>v.modelAnalyzed||v.reviewStatus==='teacher').map(([id])=>[id,true])),workflowStamps:current,workflowModelKey:modelKey};
  if(repairPending){analysis.status='partial';analysis.done=[];}
  const snapshot=()=>({state:clone(state),minutes:minutes?clone(minutes):null,analysis:clone(analysis)});
  const publish=async()=>{onProgress({state:clone(state)});await save(snapshot());};
  const step=async(phase,text)=>{state.phase=phase;state.trace.push({at:new Date().toISOString(),phase,message:text});state.trace=state.trace.slice(-30);await publish();};
  try{
   await step('minutes','正在整理课堂纪要');
   const doc=C.material(dataset,{...scope,classroom:true},brief);
   if(doc.selected){minutes=await C.runMinutes({dataset,scope:{...scope,classroom:true},brief,previous:minutes,control,maxChars:48000,request:(body,options)=>request({phase:'minutes',body},options),onProgress:next=>{state.minutesCovered=next.covered||0;state.minutesTotal=next.total||0;state.received=next.received||0;onProgress({state:clone(state)});},save:async next=>{minutes={...clone(next),workflowModelKey:modelKey};await publish();}});minutes.workflowModelKey=modelKey;}
   else minutes={status:'complete',covered:0,total:0,result:{focuses:[],consensus:[],disagreements:[],questions:[],paths:[]},scope:clone(scope),workflowModelKey:modelKey,empty:true};
   state.minutesStatus=minutes.status;state.minutesCovered=minutes.covered||0;state.minutesTotal=minutes.total||0;await step('content','纪要结果已保存，正在补齐内容分析');
   if(control.paused)throw Object.assign(Error('分析已暂停'),{name:'AbortError'});
   analysis=await G.runDocument({dataset:scoped,profile,roster,previous:analysis,control,maxChars,maxRecords,maxConcurrentBatches,courseReport:false,includeScores:false,includeBackground:true,repairPendingIds:repairPending?Object.keys(kept).filter(id=>kept[id].level==='pending'):[],save:async next=>{analysis={...clone(next),workflowStamps:current,workflowModelKey:modelKey};state.contentDone=next.confirmed||0;state.contentTotal=next.document?.records||0;await publish();},onProgress:next=>{state.contentDone=next.confirmed||0;state.contentTotal=next.document?.records||0;state.contentRequests=next.requestCount||0;onProgress({state:clone(state)});},request:args=>request({...args,phase:'classify',prompt:A.redact(args.prompt,dataset.records.map(r=>r.author).filter(Boolean))},{onChunk:args.onChunk,onStatus:args.onStatus})});
   analysis.workflowStamps=current;analysis.workflowModelKey=modelKey;
   if(control.paused||analysis.status==='paused')throw Object.assign(Error('分析已暂停'),{name:'AbortError'});
   await step('report','正在汇总教学报告');
   analysis.courseReport=report(scoped,analysis,minutes,roster);analysis.workflowReportSource='classroom-minutes';
   state.status=minutes.status==='complete'&&analysis.status==='complete'?'complete':'partial';state.phase='done';state.contentDone=analysis.confirmed||0;state.contentTotal=analysis.document?.records||0;
   state.trace.push({at:new Date().toISOString(),phase:'done',message:state.status==='complete'?'课堂分析已完成；个人评分单独启动':'部分内容待补，已完成结果保留'});
  }catch(error){state.status=control.paused||error.name==='AbortError'?'paused':'partial';state.errors.push(error.message);state.trace.push({at:new Date().toISOString(),phase:state.status,message:state.status==='paused'?'课堂分析已暂停，已完成结果保留':error.message});}
  state.updatedAt=new Date().toISOString();await publish();return snapshot();
 }
 return {VERSION,source,stamps,report,run};
});
