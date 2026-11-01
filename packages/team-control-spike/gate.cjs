'use strict';
// Synthetic reference model, not a native gate or an authorization boundary.
const failure=(code,cause)=>Object.assign(new Error(code,{cause}),{code});
function createGate(adapter,memberId){
  if(!adapter || typeof adapter.setArchived!=='function'||typeof adapter.getArchived!=='function'||typeof adapter.send!=='function'||typeof memberId!=='string'||!memberId) throw failure('INVALID_INPUT');
  let current='uncertain',tail=Promise.resolve();
  const queue=(operation)=>{
    const running=tail.then(operation);
    tail=running.then(()=>undefined,()=>undefined);
    return running;
  };
  const change=(target)=>queue(async()=>{
    if(current==='uncertain')throw failure('UNCERTAIN');
    if(current===target)return;
    try {await adapter.setArchived(target==='archived',memberId);}
    catch(error){current='uncertain';throw failure('UNCERTAIN',error);}
    current=target;
  });
  const send=(message)=>queue(async()=>{
    if(current==='uncertain')throw failure('UNCERTAIN');
    if(current==='archived')throw failure('ARCHIVED');
    return adapter.send(message,memberId);
  });
  const reconcile=()=>queue(async()=>{
    if(current!=='uncertain')return;
    let archived;
    try {archived=await adapter.getArchived(memberId);} catch(error){throw failure('UNCERTAIN',error);}
    if(typeof archived!=='boolean')throw failure('UNCERTAIN');
    current=archived?'archived':'active';
  });
  return Object.freeze({archive:()=>change('archived'),wake:()=>change('active'),send,reconcile,state:()=>current});
}
module.exports={createGate};
