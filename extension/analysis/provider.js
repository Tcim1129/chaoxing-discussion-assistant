(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionProvider=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // workbench 用这份白名单一次性读设置，所以「本地先筛」这个开关也必须列在这里，
  // 否则 storageGet(SETTING_KEYS) 永远读不到它，开关就是摆设（1.0.24 实测踩到）。
  const SETTING_KEYS=Object.freeze(['cx_discussion_base_url','cx_discussion_api_key','cx_discussion_api_key_map','cx_discussion_model','cx_discussion_only_uncertain','cx_discussion_request_timeout_seconds']);
  const choiceOf=data=>data?.choices?.[0]||data?.output?.choices?.[0]||data?.data?.choices?.[0]||data?.result?.choices?.[0]||(data?.message?{message:data.message,finish_reason:data.finish_reason}:null);
  const contentText=value=>typeof value==='string'?value:Array.isArray(value)?value.map(contentText).join(''):value&&typeof value==='object'?contentText(value.text??value.content??value.value??value.output_text??''):'';
  const apiError=data=>data?.error?String(data.error.message||data.error):null;
  async function completion(body,{getSettings,fetchImpl=globalThis.fetch,control={},onStatus=()=>{},onChunk=()=>{},signal,firstContentTimeoutMs,idleTimeoutMs,allowReasoningRetry=true}={}) {
    if(control.paused)throw Object.assign(new Error('分析已暂停'),{name:'AbortError'});
    const s=await getSettings();const base=String(s.cx_discussion_base_url||'https://dashscope.aliyuncs.com/compatible-mode/v1').trim().replace(/\/+$/,'');
    if(control.paused)throw Object.assign(new Error('分析已暂停'),{name:'AbortError'});
    const url=new URL(base);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('接口地址请使用 HTTPS 或本机地址');
    const map=s.cx_discussion_api_key_map||{};const key=s.cx_discussion_api_key||map[base];
    if(!key)throw new Error('请先在设置中保存模型 API Key');
    const timeout=Math.max(30,Math.min(600,Number(s.cx_discussion_request_timeout_seconds)||500))*1000;
    const controller=new AbortController();const abortFromCaller=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abortFromCaller,{once:true});if(!control.aborters)control.aborters=new Set();control.aborters.add(controller);
    let timedOut=false,timer,armedWait=0;const armTimeout=(waitMs=idleTimeoutMs||timeout)=>{armedWait=waitMs;clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},waitMs);};armTimeout(firstContentTimeoutMs||timeout);
    const payload={model:s.cx_discussion_model||'qwen3.6-plus',temperature:0,...body};
    if(/^qwen/i.test(payload.model))payload.enable_thinking=false;
    if(payload.stream&&/^qwen3\.6-plus(?:-|$)/i.test(payload.model)&&!Object.hasOwn(payload,'max_tokens'))payload.max_tokens=65536;
    const readDetail=async(response)=>{try{return typeof response.text==='function'?String(await response.text()).replace(/\s+/g,' ').trim().slice(0,200):'';}catch(_error){return '';}};
    const attempt=async(value)=>{
      if(control.paused)throw Object.assign(new Error('分析已暂停'),{name:'AbortError'});
      const response=await fetchImpl(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(value),signal:controller.signal,redirect:'error'});
      // 只有失败时才读响应体：成功响应体的内容要留给 response.json()。
      return {response,detail:response.ok?'':await readDetail(response)};
    };
    const parameterProblem=/response_format|json_object|enable_thinking|thinking|max_tokens|stream|unsupported|not support|unknown|invalid|unrecognized/i;
    let partialContent='';
    const ordinaryRetry=async()=>{if(control.paused)throw Object.assign(new Error('分析已暂停'),{name:'AbortError'});clearTimeout(timer);onStatus('流式响应未返回正文，改用普通返回重试一次');return completion({...body,stream:false},{getSettings:async()=>s,fetchImpl,control,onStatus,onChunk,signal,firstContentTimeoutMs,idleTimeoutMs,allowReasoningRetry});};
    // 推理模型把输出预算耗在 reasoning_content 上时 content 为空：关闭思考并没有正文上限再试一次，
    // 比直接报“只返回思考过程”更可能拿到结构化结果。
    const reasoningRetry=async(choice)=>{
      if(!allowReasoningRetry||body.enable_thinking===false||body.thinking===false)return null;
      clearTimeout(timer);onStatus('模型只返回了思考过程，关闭思考后重试一次');
      const retried=await completion({...body,stream:false,enable_thinking:false,max_tokens:Math.min(65536,Math.max((Number(body.max_tokens)||8192)*2,16384))},{getSettings:async()=>s,fetchImpl,control,onStatus,onChunk,signal,firstContentTimeoutMs,idleTimeoutMs,allowReasoningRetry:false});
      return {...retried,reasoningRetry:true,finish_reason:retried.finish_reason||choice?.finish_reason};
    };
    onStatus('等待模型返回');
    try{
      let {response,detail}=await attempt(payload);
      // 部分兼容网关不认识 response_format / enable_thinking：只在参数被拒（400/422）时逐级去掉重发。
      // 模型名写错、额度或权限问题不重发，直接把上游原文报给用户。
      if(!response.ok&&[400,422].includes(response.status)&&parameterProblem.test(detail)){
        const compat={...payload};
        for(const field of ['response_format','enable_thinking','max_tokens','stream']){
          if(response.ok||![400,422].includes(response.status)||!parameterProblem.test(detail))break;
          if(!Object.hasOwn(compat,field))continue;
          if(['max_tokens','stream'].includes(field)&&!new RegExp(field,'i').test(detail))continue;
          delete compat[field];({response,detail}=await attempt(compat));
        }
      }
      if(!response.ok)throw new Error(response.status===429?'模型限流，请稍后重试':`模型请求失败（HTTP ${response.status}）${detail?'：'+detail:''}`);
      if(/text\/event-stream/i.test(response.headers?.get?.('content-type')||'')&&response.body?.getReader){
        onStatus('正在流式接收并保存');
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',finishReason=null,done=false,refusal='';
        const packet=async block=>{
          const raw=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(!raw)return;if(raw.trim()==='[DONE]'){done=true;return;}
          const data=JSON.parse(raw);if(apiError(data))throw new Error(apiError(data));
          const choice=choiceOf(data);if(!choice)return;
          // 连接还活着就重置等待：推理模型可能先长时间只发 reasoning_content，
          // 不能因为正文还没出现就判超时。
          armTimeout();
          if(choice.finish_reason)finishReason=choice.finish_reason;
          if(choice.delta?.refusal||choice.message?.refusal)refusal=String(choice.delta?.refusal||choice.message?.refusal);
          const delta=contentText(choice.delta?.content),full=contentText(choice.message?.content);if(delta||full){partialContent=full||partialContent+delta;await onChunk({content:partialContent,chars:partialContent.length,finish_reason:finishReason});}
        };
        try{
          while(!done){
            if(control.paused)throw Object.assign(new Error('分析已暂停'),{name:'AbortError'});
            const next=await reader.read();buffer+=next.done?decoder.decode():decoder.decode(next.value,{stream:true});
            let match;while((match=/\r?\n\r?\n/.exec(buffer))){await packet(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);if(done)break;}
            if(next.done){if(buffer.trim())await packet(buffer);break;}
          }
        }finally{reader.releaseLock();}
        if(!partialContent){if(refusal||finishReason==='content_filter')throw new Error('模型未生成正文'+(refusal?'：'+refusal:'（接口内容过滤）'));if(body.stream)return await ordinaryRetry();throw new Error('模型没有返回最终正文，请检查模型或接口设置');}
        return {role:'assistant',content:partialContent,finish_reason:finishReason};
      }
      if(body.stream)onStatus('接口采用普通返回，完成后统一接收');
      if(/text\/html/i.test(response.headers?.get?.('content-type')||''))throw new Error('模型接口返回了网页，请检查接口地址和登录状态');
      let json;try{json=await response.json();}catch(error){if(body.stream&&error instanceof SyntaxError)return await ordinaryRetry();throw new Error('模型响应不是有效 JSON，请检查接口地址或重试');}
      if(apiError(json))throw new Error(apiError(json));const choice=choiceOf(json),message=choice?.message,content=contentText(message?.content||choice?.text);
      if(!content&&body.tools?.length&&message?.tool_calls?.length)return {...message,finish_reason:choice.finish_reason};
      if(!content){if(message?.refusal||choice?.finish_reason==='content_filter')throw new Error('模型未生成正文'+(message?.refusal?'：'+message.refusal:'（接口内容过滤）'));if(message?.reasoning_content){const retried=await reasoningRetry(choice);if(retried)return retried;const fields=message&&typeof message==='object'?Object.keys(message).join('/'):'无';throw new Error(`模型只返回了思考过程${choice?.finish_reason==='length'?'（输出上限被思考占满）':''}，没有最终正文；请关闭思考模式或换用非思考模型后重试（finish_reason: ${choice?.finish_reason||'unknown'}；message 字段: ${fields}）`);}if(body.stream)return await ordinaryRetry();throw new Error('模型没有返回有效内容（缺少 choices.message 正文），请检查接口是否兼容 Chat Completions');}
      partialContent=content;await onChunk({content,chars:content.length,finish_reason:choice.finish_reason});return {...message,content,finish_reason:choice.finish_reason};
    }catch(error){const failure=timedOut?Object.assign(new Error(`模型等待超时（${Math.max(1,Math.round(armedWait/1000))} 秒${partialContent?'未收到新内容':'未返回正文'}），可重试未完成条目`),{timeout:true}):error;if(partialContent)failure.partialContent=partialContent;throw failure;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abortFromCaller);control.aborters.delete(controller);}
  }
  function pause(control){control.paused=true;for(const controller of control.aborters||[])controller.abort();}
  return {completion,pause,SETTING_KEYS};
});
