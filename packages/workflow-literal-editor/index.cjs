'use strict';
const {createHash} = require('node:crypto');
const {types:{isProxy}} = require('node:util');
const {extractTopology,layoutTopology} = require('../workflow-topology/index.cjs');

const FIELDS = ['prompt','provider','model','label'];
const fail = (code) => ({ok:false,code});
const safeRecord = (value) => {
  if (!value || typeof value !== 'object' || isProxy(value) || Array.isArray(value)) return false;
  const proto=Object.getPrototypeOf(value);
  if (proto!==Object.prototype && proto!==null) return false;
  return Reflect.ownKeys(value).every((key)=>typeof key==='string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
};
const own = (object,key) => Object.getOwnPropertyDescriptor(object,key)?.value;
const hash = (script) => createHash('sha256').update(script,'utf16le').digest('hex');
const strLiteral = (node) => node?.type==='Literal' && typeof node.value==='string' && !node.regex && typeof node.start==='number' && typeof node.end==='number';

// This intentionally accepts only direct top-level awaited calls; every omitted case fails closed.
function analyze(script,options) {
  if(typeof script!=='string' || script.length>100_000) return fail('INVALID_SCRIPT');
  if(options!==undefined && (!safeRecord(options) || Reflect.ownKeys(options).some((key)=>key!=='parse'))) return fail('INVALID_OPTIONS');
  let parse=options===undefined?undefined:own(options,'parse');
  if(parse===undefined){try{parse=require('acorn').parse;}catch{return fail('PARSER_UNAVAILABLE');}}
  if(typeof parse!=='function') return fail('PARSER_UNAVAILABLE');
  let graph;
  try { graph=extractTopology(script,{}, {parse}); } catch { return fail('PARSE_ERROR'); }
  if(graph.complete!==true) return fail('UNSAFE_TOPOLOGY');
  const prefix='(async () => {\n';
  const suffix='\n})()';
  let body;
  try {
    const ast=parse(prefix+script+suffix,{ecmaVersion:'latest',sourceType:'script'});
    const end=prefix.length+script.length+suffix.length;
    const statement=ast?.body?.[0];const call=statement?.expression;const arrow=call?.callee;
    body=arrow?.body;
    if(ast?.type!=='Program'||ast.start!==0||ast.end!==end||ast.body.length!==1||
       statement?.type!=='ExpressionStatement'||statement.start!==0||statement.end!==end||
       call?.type!=='CallExpression'||call.start!==0||call.end!==end||call.optional||call.arguments?.length!==0||
       arrow?.type!=='ArrowFunctionExpression'||!arrow.async||arrow.generator||arrow.params?.length!==0||arrow.start!==1||arrow.end!==end-3||
       body?.type!=='BlockStatement'||!Array.isArray(body.body)||body.start!==prefix.length-2||body.end!==end-3) return fail('PARSE_ERROR');
  } catch {return fail('PARSE_ERROR');}
  const ranges=new Map();
  const labels=new Set();
  for(const statement of body.body){
    if(statement.type==='EmptyStatement') continue;
    if(statement.type!=='ExpressionStatement') return fail('UNSUPPORTED_STATEMENT');
    const expr=statement.expression;
    if(expr.type==='CallExpression' && expr.callee?.type==='Identifier' && expr.callee.name==='phase' && expr.arguments.length===1 && strLiteral(expr.arguments[0]) && expr.arguments[0].value.length>0) continue;
    if(expr.type!=='AwaitExpression') return fail('UNSUPPORTED_STATEMENT');
    const call=expr.argument;
    if(call?.type!=='CallExpression'||call.optional||call.callee?.type!=='Identifier'||call.callee.name!=='agent'||call.arguments.length<1||call.arguments.length>2||!strLiteral(call.arguments[0])||call.arguments[0].value.length===0) return fail('UNSUPPORTED_CALL');
    const opts=call.arguments[1];
    const found={prompt:call.arguments[0]};
    if(opts!==undefined){
      if(opts.type!=='ObjectExpression') return fail('UNSAFE_OPTIONS');
      const seen=new Set();
      for(const property of opts.properties){
        const key=property.key?.type==='Identifier'?property.key.name:property.key?.type==='Literal' && typeof property.key.value==='string'?property.key.value:null;
        if(property.type!=='Property'||property.kind!=='init'||property.computed||property.method||property.shorthand||!['label','provider','model'].includes(key)||seen.has(key)||!strLiteral(property.value)) return fail('UNSAFE_OPTIONS');
        if((key==='provider'||key==='model') && (!property.value.value || property.value.value!==property.value.value.trim())) return fail('UNSAFE_OPTIONS');
        seen.add(key);found[key]=property.value;
      }
    }
    const start=call.start-prefix.length,end=call.end-prefix.length;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>script.length||end<=start) return fail('INVALID_RANGE');
    const matching=graph.nodes.filter((node)=>node.source?.start===start && node.source?.end===end);
    if(matching.length!==1 || matching[0].occurrence!=='single' || typeof matching[0].label!=='string' || labels.has(matching[0].label)) return fail('AMBIGUOUS_NODE');
    labels.add(matching[0].label);
    ranges.set(matching[0].id,found);
  }
  if(ranges.size!==graph.nodes.length) return fail('UNSUPPORTED_STRUCTURE');
  const sourceHash=hash(script);
  const targets=graph.nodes.map((node)=>({sourceHash,nodeId:node.id,start:node.source.start,end:node.source.end,fields:FIELDS.filter((field)=>ranges.get(node.id)[field] && (field!=='prompt'||ranges.get(node.id).label))}));
  return {ok:true,sourceHash,targets,topology:graph,layout:layoutTopology(graph),ranges,prefix};
}
function inspectScript(script,options) {
  const result=analyze(script,options);
  if(!result.ok)return result;
  const {ranges,prefix,...publicResult}=result;
  return publicResult;
}
function geometry(layout){return layout.nodes.map(({column,row,x,y,width,height})=>({column,row,x,y,width,height}));}
function previewEdit(input,options) {
  if(!safeRecord(input)||Reflect.ownKeys(input).some((key)=>!['script','target','field','value'].includes(key))) return fail('INVALID_INPUT');
  const script=own(input,'script'),target=own(input,'target'),field=own(input,'field'),value=own(input,'value');
  if(!safeRecord(target)||!FIELDS.includes(field)||typeof value!=='string'||value.length>100_000||(field==='prompt' && value.length===0)) return fail('INVALID_INPUT');
  const before=analyze(script,options);
  if(!before.ok)return before;
  const match=before.targets.find((item)=>item.nodeId===own(target,'nodeId') && item.start===own(target,'start') && item.end===own(target,'end') && item.sourceHash===own(target,'sourceHash'));
  if(!match)return fail('STALE_TARGET');
  const fields=before.ranges.get(match.nodeId);
  const literal=fields[field];
  if(!literal)return fail('NOT_LITERAL');
  if(field==='prompt' && !fields.label) return fail('IMPLICIT_LABEL');
  const start=literal.start-before.prefix.length,end=literal.end-before.prefix.length;
  if(start<match.start||end>match.end||end<=start) return fail('INVALID_RANGE');
  if(literal.value===value) return fail('NO_CHANGE');
  const replacement=JSON.stringify(value);
  const edited=script.slice(0,start)+replacement+script.slice(end);
  const after=analyze(edited,options);
  if(!after.ok)return fail('UNSAFE_RESULT');
  if(before.topology.nodes.length!==after.topology.nodes.length || before.topology.edges.length!==after.topology.edges.length ||
      JSON.stringify(geometry(before.layout))!==JSON.stringify(geometry(after.layout))) return fail('STRUCTURE_CHANGED');
  const nodeMapping=before.topology.nodes.map((node,index)=>({before:node.id,after:after.topology.nodes[index].id}));
  const beforeIndex=new Map(before.topology.nodes.map((node,index)=>[node.id,index]));
  const afterIndex=new Map(after.topology.nodes.map((node,index)=>[node.id,index]));
  const edges=(graph,index)=>graph.edges.map(({from,to})=>[index.get(from),index.get(to)]);
  if(JSON.stringify(edges(before.topology,beforeIndex))!==JSON.stringify(edges(after.topology,afterIndex))) return fail('STRUCTURE_CHANGED');
  return {ok:true,script:edited,diff:{range:{start,end},before:script.slice(start,end),after:replacement},nodeMapping,topology:after.topology,layout:after.layout};
}
module.exports={inspectScript,previewEdit};
