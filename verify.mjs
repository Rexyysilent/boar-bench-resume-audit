import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2] ?? join(root, '../source/boar-bench-b41a25acfabf89f1d015103ca1329554f985a257'));
const original = join(source, 'harness/judge-v2.mjs');
const fixed = join(root, 'judge-v2.fixed.mjs');
const hash = text => createHash('sha256').update(text).digest('hex');
const upstream = readFileSync(original, 'utf8');
assert.equal(hash(upstream),'9dc669c6ba8d5410c6347ad38b9eb041e6c0f0317dbdd7664ef32602fc692f37','Pinned upstream source bytes');
const lib = join(root, 'no-model-lib');
mkdirSync(lib, { recursive: true });
writeFileSync(join(lib, 'claude-cli.mjs'), 'export async function runClaude(){ throw new Error("MODEL_CALL_FORBIDDEN_IN_THIS_REPRO"); }\nexport const isRateLimited=()=>false; export const sleep=async()=>{};\n');
writeFileSync(join(lib, 'judge-core.mjs'), `export {blind,rng} from ${JSON.stringify(pathToFileURL(join(source, 'scorers/vendor/eval-lib/judge-core.mjs')).href)};\n`);
const env = {...process.env, BOAR_EVAL_LIB: lib};
const loader=join(root,'windows-path-loader.mjs');
writeFileSync(loader,'import {pathToFileURL} from "node:url"; export function resolve(specifier,context,nextResolve){return nextResolve(/^[A-Za-z]:[\\\\/]/.test(specifier)?pathToFileURL(specifier).href:specifier,context);}\n');
const lines = (path, rows) => writeFileSync(path, rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
const readRows = path => readFileSync(path,'utf8').trim().split('\n').map(x=>JSON.parse(x));
function run(script, args) {
  const r=spawnSync(process.execPath,['--no-warnings','--experimental-loader',pathToFileURL(loader).href,script,...args],{env,encoding:'utf8',timeout:10000});
  if(r.error) throw r.error;
  assert.ok(!`${r.stdout}\n${r.stderr}`.includes('MODEL_CALL_FORBIDDEN'), 'No model invocation is permitted');
  return {status:r.status,stdout:r.stdout.trim().replaceAll(root,'<audit-dir>'),stderr:r.stderr.trim().replaceAll(root,'<audit-dir>')};
}

// Add a content identity covering inputs that reach the judge or its refusal override.
const anchor='  const prev = readJsonl(out).filter((r) => r.ok);\n  const stale = prev.filter((r) => r.promptSha !== JUDGE_PROMPT_SHA || r.model !== model || r.effort !== effort || r.repeat !== repeat || r.side !== side);';
const replacement=`  const inputSha = (id) => sha(JSON.stringify({
    item: items[id], keyPoints: kp[id], answer: answers[id],
    noOverride: has("--no-override"), refusalString: get("--refusal-string", null),
  }));
  const prev = readJsonl(out).filter((r) => r.ok);
  const stale = prev.filter((r) => r.promptSha !== JUDGE_PROMPT_SHA || r.model !== model || r.effort !== effort || r.repeat !== repeat || r.side !== side ||
    !answers[r.id] || !items[r.id] || !kp[r.id] || r.inputSha !== inputSha(r.id));`;
assert.equal(upstream.split(anchor).length,2,'Unique upstream resume anchor');
let patched=upstream.replace(anchor,replacement);
const rowAnchor='                   answerSha: sha(String(ans.text ?? "")), createdAt: new Date().toISOString() };';
assert.equal(patched.split(rowAnchor).length,2,'Unique row construction anchor');
patched=patched.replace(rowAnchor,'                   inputSha: inputSha(id), answerSha: sha(String(ans.text ?? "")), createdAt: new Date().toISOString() };');
patched=patched.replace('differ in prompt/model/effort/repeat/side; use a new --out','differ in inputs/prompt/model/effort/repeat/side; use a new --out');
writeFileSync(fixed,patched);

const mutations={
  answer_text:x=>{x.answers[0].text='Paris is the capital of France.';},
  decline_flag:x=>{x.answers[0].declined=false;},
  question:x=>{x.items[0].question='What is the capital of Germany?';},
  context:x=>{x.items[0].context={city:'Berlin'};},
  key_points:x=>{x.kp[0].points=['The capital of Germany is Berlin.'];},
  conversation_history:x=>{x.answers[0].turns=[{user:'Where am I?',answer:'France',declined:false},{user:'What is its capital?',answer:'I decline',declined:true}];},
  override_option:x=>{x.extra=['--no-override'];},
  refusal_string:x=>{x.extra=['--refusal-string','Paris is the capital of France.'];},
};
const results=[];
for(const [variant,mutate] of Object.entries(mutations)) {
  for(const [label,script] of [['original',original],['fixed',fixed]]) {
    const dir=join(root,'runs',variant,label); mkdirSync(dir,{recursive:true});
    const x={items:[{id:'q1',question:'What is the capital of France?'}],kp:[{id:'q1',ok:true,source:'item',points:['The capital of France is Paris.']}],answers:[{id:'q1',text:'I decline',declined:true}],extra:[]};
    const paths={items:join(dir,'items.jsonl'),kp:join(dir,'kp.jsonl'),answers:join(dir,'answers.jsonl'),out:join(dir,'judgments.jsonl')};
    // Each test starts with a fresh, naturally generated cache row.
    writeFileSync(paths.out,'');
    const save=()=>{for(const key of ['items','kp','answers'])lines(paths[key],x[key]);};
    const args=()=>['judge','--items',paths.items,'--kp',paths.kp,'--answers',paths.answers,'--repeat','1','--out',paths.out,...x.extra];
    save(); const first=run(script,args()); assert.equal(first.status,0,JSON.stringify(first));
    const before=readFileSync(paths.out,'utf8');
    const stable=run(script,args()); assert.equal(stable.status,0); assert.equal(readFileSync(paths.out,'utf8'),before);
    mutate(x); save(); const changed=run(script,args());
    assert.equal(changed.status,label==='original'?0:7,`${variant} ${label}`);
    assert.equal(readFileSync(paths.out,'utf8'),before,'Do not overwrite existing evidence');
    let scored=null;
    if(label==='original') {
      const scoreOut=join(dir,'scores.json');
      assert.equal(run(script,['score','--judgments',paths.out,'--out',scoreOut]).status,0);
      scored=JSON.parse(readFileSync(scoreOut,'utf8')).items.q1.app.aggregate;
      assert.equal(scored.s,0); assert.equal(readRows(paths.out)[0].overridden,true);
    }
    results.push({variant,implementation:label,firstRun:first,unchangedResume:stable,changedResume:changed,cacheUnchanged:true,staleScore:scored});
  }
}
// A cache produced by the old implementation cannot silently acquire new provenance.
const legacy=join(root,'runs/answer_text/original');
const legacyResult=run(fixed,['judge','--items',join(legacy,'items.jsonl'),'--kp',join(legacy,'kp.jsonl'),'--answers',join(legacy,'answers.jsonl'),'--repeat','1','--out',join(legacy,'judgments.jsonl')]);
assert.equal(legacyResult.status,7);
const evidence={sourceCommit:'b41a25acfabf89f1d015103ca1329554f985a257',sourceSha256:hash(upstream),fixedSha256:hash(patched),modelCalls:0,networkCalls:0,mutations:8,checks:results.length,legacyCacheRejected:true,results};
writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({mutations:8,implementations:2,unchangedResumesPassed:16,originalStaleAccepted:8,fixedStaleRejected:8,legacyCacheRejected:true,modelCalls:0,sourceSha256:evidence.sourceSha256},null,2));
