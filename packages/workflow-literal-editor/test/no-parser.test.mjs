import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {inspectScript,previewEdit}=require('../index.cjs')

test('parser absence refuses instead of evaluating scripts',()=>{
 const script="globalThis.__editorUntrusted=true; await agent('x');"
 delete globalThis.__editorUntrusted
 assert.equal(inspectScript(script,{parse:null}).ok,false)
 assert.equal(previewEdit({script,target:{},field:'prompt',value:'x'},{parse:null}).ok,false)
 assert.equal(globalThis.__editorUntrusted,undefined)
})
