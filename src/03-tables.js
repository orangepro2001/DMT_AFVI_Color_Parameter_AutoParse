/* ============================================================
   3. Analysis tables (parsed model -> sheet-style view models)
   Round-trip views of the source files: one row per XML element or
   channel, plus the multi-file comparison matrix and the dictionary
   listing. Each builder returns a "table view model":
     { name, header:[...], rows:[[...]], cols:[widths] }
   which both the renderer (src/06-render.js) and the xlsx writer
   (src/05-xlsx.js) understand.
   ============================================================ */

const PKEY=(r)=>r.paramKey;

function paramName(dict,key,lang){
  const p=dict.param[key]||{};
  if(lang==="en") return p.en||key;
  if(lang==="kr") return p.kr||p.en||key;
  const en=p.en||"", kr=p.kr||"";
  if(en&&kr&&en!==kr) return en+" / "+kr;
  return en||kr||key;
}
function gpName(dict,id){ return dict.node.g[id]!==undefined?dict.node.g[id]:("?G"+id); }
function pnName(dict,id){ return dict.node.p[id]!==undefined?dict.node.p[id]:("?P"+id); }
function cnName(dict,id){ return dict.node.c[id]!==undefined?dict.node.c[id]:("?C"+id); }
function pathOf(dict,r){
  return "G"+r.gpId+" "+gpName(dict,r.gpId)+" ▸ P"+r.pnId+" "+pnName(dict,r.pnId)+" ▸ C"+r.cnId+" "+cnName(dict,r.cnId);
}
function groupName(r){
  const g=r.specGroup;
  return (SPEC_GROUPS[g]!==undefined?SPEC_GROUPS[g]:"")+(g!==""?" ("+g+")":"");
}
function num(v,digits){
  if(v===null||v===undefined||v==="") return "";
  const n=Number(v);
  if(!isFinite(n)) return String(v);
  if(digits===""||digits===null||digits===undefined) return n;
  const f=Math.pow(10,Number(digits));
  return Math.round(n*f)/f;
}
function fmt(v,d){
  const x=num(v,d);
  if(x==="") return "";
  return typeof x==="number"?String(x):x;
}
function usedRows(spec,keepZero){
  if(keepZero) return spec.rows;
  return spec.rows.filter(r=>{
    const vals=(r.kind==="INSPECTION"?r.v:[r.v[0]]).filter(v=>v!==null&&v!=="");
    if(!vals.length) return true;
    return vals.some(v=>Number(v)!==0);
  });
}

function buildInspectionTable(parsed,dict,opts){
  const header=["No","File","Side","Light","GPNODE","PNODE","CNODE","Node Path","NodeCheck P/C","Element","Spec Group","Group ID","ParamKey","Name (EN)","Name (KR)","Description",
                "Val/ValR","ValG","ValB","MinR","MaxR","MinG","MaxG","MinB","MaxB","ControlType"];
  const rows=[]; let i=0;
  parsed.inspects.forEach(spec=>{
    usedRows(spec,opts.keepZero).forEach(r=>{
      i++;
      rows.push([i,spec.label,r.side,r.light,r.gpId,gpName(dict,r.gpId),r.cnId,pathOf(dict,r),
        (r.pnCheck||"")+"/"+(r.cnCheck||""),r.kind,groupName(r),r.specGroup,r.paramKey,
        (dict.param[r.paramKey]||{}).en||"",(dict.param[r.paramKey]||{}).kr||"",r.desc,
        num(r.v[0],opts.digits),num(r.v[1],opts.digits),num(r.v[2],opts.digits),
        num(r.mn[0],opts.digits),num(r.mx[0],opts.digits),
        num(r.mn[1],opts.digits),num(r.mx[1],opts.digits),
        num(r.mn[2],opts.digits),num(r.mx[2],opts.digits),
        CONTROL_TYPES[r.controlType]!==undefined?CONTROL_TYPES[r.controlType]:(r.controlType||"")]);
    });
  });
  const cols=[6,26,8,12,8,16,8,46,16,12,20,7,10,34,34,16,12,12,12,10,12,10,12,10,12,12];
  const drop=opts.nameMode==="en"?"Name (KR)":(opts.nameMode==="kr"?"Name (EN)":null);
  if(drop){
    const di=header.indexOf(drop);
    if(di>=0){ header.splice(di,1); cols.splice(di,1); rows.forEach(r=>r.splice(di,1)); }
  }
  return {name:"InspectionSpec",header:header,rows:rows,cols:cols};
}

function buildLightTable(parsed,dict,opts){
  const header=["No","File","Camera","LightSet","Set En","Pages","Sel Page","Page","Page En","Ch Count","Channel","Color","Color Name","Angle","Value","Ch En"];
  const rows=[]; let i=0;
  parsed.lights.forEach(spec=>{
    spec.rows.forEach(r=>{
      if(!opts.keepZero&&String(r.chEnable)==="0") return;
      i++;
      rows.push([i,spec.label,CAMERA_TYPES[r.camera]!==undefined?CAMERA_TYPES[r.camera]:(r.camera||""),
        r.setIdx,r.setEnable,r.pageCount,r.selPage,r.page,r.pageEnable,r.chCount,
        r.ch,r.color,CHANNEL_COLORS[r.color]||"",num(r.angle,opts.digits),num(r.value,opts.digits),r.chEnable]);
    });
  });
  return {name:"LightSpec",header:header,rows:rows,cols:[6,26,11,9,8,7,8,7,9,8,7,7,9,7,9,9]};
}

/* ------------------------------------------------------------
   Light channels grouped by LED colour
   ------------------------------------------------------------
   A channel list such as CH1(W,0°) CH2(B,0°) CH5(W,30°) CH9(W,30°) is easier to
   read grouped by LED colour, while the original Channel/@Index must stay visible
   ("CH1 CH5 CH9 are all White, only the angle differs"). Both the axis row of the
   parameter sheet, the light view and the export use this one helper.
   ------------------------------------------------------------ */
const COLOR_ORDER=["W","B","G","R"];
function groupChannels(rows){
  const byColor=new Map();
  rows.forEach(r=>{
    const c=String(r.color||"").toUpperCase()||"?";
    if(!byColor.has(c)) byColor.set(c,[]);
    byColor.get(c).push(r);
  });
  const keys=COLOR_ORDER.filter(c=>byColor.has(c))
    .concat([...byColor.keys()].filter(c=>COLOR_ORDER.indexOf(c)<0));
  return keys.map(c=>({
    color:c, name:CHANNEL_COLORS[c]||c,
    items:byColor.get(c).slice().sort((a,b)=>Number(a.ch)-Number(b.ch))
  }));
}
function colorGroupRows(rows,fileLabel,opts){
  const out=[];
  const bySet=new Map();
  rows.forEach(r=>{
    const k=r.setIdx+"|"+r.page;
    if(!bySet.has(k)) bySet.set(k,[]);
    bySet.get(k).push(r);
  });
  [...bySet.keys()].sort().forEach(k=>{
    const list=bySet.get(k);
    groupChannels(list).forEach(g=>g.items.forEach((r,i)=>{
      out.push([fileLabel,r.setIdx,CAMERA_TYPES[r.camera]!==undefined?CAMERA_TYPES[r.camera]:(r.camera||""),
        r.selPage,r.page,g.name,g.color,r.ch,num(r.value,opts.digits),num(r.angle,opts.digits),
        r.chEnable==="1"?"on":"off",i+1]);
    }));
  });
  return out;
}
const LIGHT_GROUP_HEADER=["File","LightSet","Camera","Sel Page","Page","Group","Color","Channel","Value","Angle","On","Index in group"];
function colorGroupTable(parsed,opts){
  const rows=[];
  (parsed.lights||[]).forEach(spec=>{ Array.prototype.push.apply(rows,colorGroupRows(spec.rows,spec.label,opts)); });
  return {name:"LightSpec Grouped",header:LIGHT_GROUP_HEADER,rows:rows,cols:[26,9,11,8,7,9,7,8,9,7,6,12]};
}
/* flat export of a single light view (used by "Export Sheet CSV" on a light tab) */
function lightSheetTable(sheet,opts){
  return {name:sheet.name,header:LIGHT_GROUP_HEADER,rows:colorGroupRows(sheet.rows||[],sheet.file,opts),
    cols:[26,9,11,8,7,9,7,8,9,7,6,12]};
}
/* light view model: one tab per LightSpec file, channels grouped by colour */
function buildLightViews(parsed,dict,opts){
  const used=new Set();
  return (parsed.lights||[]).map(spec=>{
    const sets=new Map();
    spec.rows.forEach(r=>{
      const sk=String(r.setIdx);
      if(!sets.has(sk)) sets.set(sk,{setIdx:r.setIdx,camera:r.camera,pageCount:r.pageCount,
        selPage:r.selPage,enable:r.setEnable,pages:new Map()});
      const set=sets.get(sk);
      const pk=String(r.page);
      if(!set.pages.has(pk)) set.pages.set(pk,{page:r.page,enable:r.pageEnable,count:r.chCount,rows:[]});
      set.pages.get(pk).rows.push(r);
    });
    const setList=[...sets.values()].map(s=>Object.assign({},s,{
      pages:[...s.pages.values()].map(p=>{
        const groups=groupChannels(p.rows);
        return {page:p.page,enable:p.enable,count:p.count,groups:groups,
          colors:groups.length,
          on:groups.reduce((n,g)=>n+g.items.filter(i=>i.chEnable==="1").length,0),
          off:groups.reduce((n,g)=>n+g.items.filter(i=>i.chEnable!=="1").length,0)};
      })
    }));
    const parts=String(spec.label).split("/");
    const model=parts.length>1?parts[parts.length-2]:"";
    let name="Light: "+(model||spec.label.replace(/\.xml$/i,""));
    if(used.has(name)) name+=" · "+spec.label;
    used.add(name);
    return {kind:"light",name:name,label:name,
      sheet:{file:spec.label,model:model,sets:setList,totalChannels:spec.rows.length,rows:spec.rows,
        note:"channels grouped by LED colour; the original Channel/@Index is kept (CH1, CH5, CH9 …)"}};
  });
}

function buildComparison(parsed,dict,opts){
  const specs=parsed.inspects;
  if(!specs.length) return {name:"Comparison",header:[],rows:[],cols:[]};
  const labels=[...new Set(specs.map(s=>s.label))].sort();
  const map=new Map();
  specs.forEach(spec=>{
    usedRows(spec,opts.keepZero).forEach(r=>{
      const path=pathOf(dict,r);
      const rk=(r.kind==="INSPECTION"?r.v:[r.v[0]]);
      const chans=r.kind==="INSPECTION"?["R","G","B"]:["V"];
      chans.forEach((ch,ci)=>{
        const key=r.kind+"|"+r.gpId+"|"+r.pnId+"|"+r.cnId+"|"+r.paramKey+"|"+ch;
        let e=map.get(key);
        if(!e){
          e={path:path,kind:r.kind,paramKey:r.paramKey,ch:ch,desc:r.desc,
             group:groupName(r),vals:{}};
          map.set(key,e);
        }
        const val=String(rk[ci]===null||rk[ci]===undefined?"":rk[ci]);
        if(val!=="") e.vals[spec.label]=num(val,opts.digits);
        if((r.desc||"")&&!e.desc) e.desc=r.desc;
      });
    });
  });
  const header=["Node Path","Element","Spec Group","ParamKey","Name (EN)","Name (KR)","Channel","Description"].concat(labels).concat(["Consistent","Distinct"]);
  const rows=[]; let diffCount=0;
  [...map.values()].sort((a,b)=>
      a.path.localeCompare(b.path)||(Number(a.paramKey)-Number(b.paramKey))||a.ch.localeCompare(b.ch)
    ).forEach(e=>{
    const distinct=[...new Set(labels.map(l=>e.vals[l]).filter(v=>v!==undefined&&v!==""))];
    const isDiff=distinct.length>1;
    if(isDiff) diffCount++;
    if(opts.diffOnly&&!isDiff) return;
    const row=[e.path,e.kind==="INSPECTION"?"INSPECTION":"MASTER",e.group,e.paramKey,
      (dict.param[e.paramKey]||{}).en||"",(dict.param[e.paramKey]||{}).kr||"",e.ch,e.desc];
    labels.forEach(l=>row.push(e.vals[l]!==undefined?e.vals[l]:""));
    row.push(isDiff?"Diff":"Same",isDiff?distinct.length:0);
    rows.push(row);
  });
  const cols=[52,12,20,10,34,34,6,14].concat(labels.map(()=>14)).concat([9,8]);
  if(opts.nameMode==="en"||opts.nameMode==="kr"){
    const ni=opts.nameMode==="en"?5:4;
    header.splice(ni,1); cols.splice(ni,1); rows.forEach(r=>r.splice(ni,1));
  }
  return {name:"Comparison",header:header,rows:rows,cols:cols,diffCount:diffCount,labels:labels};
}

function buildDictTable(dict,opts){
  const header=["ParamKey","Name (EN)","Name (KR)"];
  const keys=Object.keys(dict.param).map(Number).filter(n=>!isNaN(n)).sort((a,b)=>a-b)
    .concat(Object.keys(dict.param).filter(k=>isNaN(Number(k))).sort());
  const rows=keys.map(k=>[k,(dict.param[k]||{}).en||"",(dict.param[k]||{}).kr||""]);
  const nheader=["Node Type","ID","Name"];
  const nrows=[];
  ["g","p","c"].forEach(b=>{
    const label={g:"GPNODE",p:"PNODE",c:"CNODE"}[b];
    Object.keys(dict.node[b]).map(Number).sort((a,b2)=>a-b2).forEach(id=>nrows.push([label,id,dict.node[b][id]]));
  });
  return {
    param:{name:"Param Dict",header:header,rows:rows,cols:[11,42,42]},
    node:{name:"Node Dict",header:nheader,rows:nrows,cols:[11,8,34]}
  };
}

function buildSummary(parsed,dict,opts,stats){
  const rows=[
    ["Generated",stats.time],
    ["Tool","Spec Param Tool v"+VERSION],
    ["Param dictionary",(dict.custom?"built-in + override, ":"built-in, ")+Object.keys(dict.param).length+" ParamKeys"],
    ["Node dictionary","GPNODE "+Object.keys(dict.node.g).length+" / PNODE "+Object.keys(dict.node.p).length+" / CNODE "+Object.keys(dict.node.c).length],
    ["LightSpec files",parsed.lights.length],
    ["LightSpec channel rows",stats.lightRows],
    ["InspectionSpec files",parsed.inspects.length],
    ["InspectionSpec param rows",stats.inspRows],
    ["Comparison differences",stats.diffCount],
    ["",""],
    ["-- Per file --","File | Type | Rows"]
  ];
  parsed.lights.forEach(s=>rows.push([s.label,"LightSpec",s.rows.length]));
  parsed.inspects.forEach(s=>rows.push([s.label,"InspectionSpec",s.rows.length]));
  if(parsed.paramOverride) rows.push(["","parameter dictionary override: "+parsed.paramOverride.label,parsed.paramOverride.count+" keys"]);
  if(parsed.treeOverride) rows.push(["","node dictionary override: "+parsed.treeOverride.label,parsed.treeOverride.count+" nodes"]);
  if(parsed.treeList) parsed.treeList.forEach(l=>rows.push(["","SpecTreeNodeList (recorded only)",l]));
  rows.push(["",""]);
  rows.push(["-- Per element --","Element | Count"]);
  Object.keys(stats.byKind).sort().forEach(k=>rows.push([k,"",stats.byKind[k]]));
  rows.push(["",""]);
  rows.push(["-- Per SpecGroup --","Group | Count"]);
  Object.keys(stats.byGroup).map(Number).sort((a,b)=>a-b).forEach(k=>rows.push([(SPEC_GROUPS[k]||"?")+" ("+k+")","",stats.byGroup[k]]));
  if(Object.keys(parsed.unknownKeys).length){
    rows.push(["",""]);
    rows.push(["-- ParamKeys missing from the dictionary --","ParamKey | Occurrences"]);
    Object.keys(parsed.unknownKeys).sort((a,b)=>Number(a)-Number(b)).forEach(k=>rows.push([k,"",parsed.unknownKeys[k]]));
  }
  if(Object.keys(parsed.unknownNodes).length){
    rows.push(["",""]);
    rows.push(["-- Node IDs missing from the dictionary --","ID | Occurrences"]);
    Object.keys(parsed.unknownNodes).forEach(k=>rows.push([k,"",parsed.unknownNodes[k]]));
  }
  if(parsed.warnings.length){
    rows.push(["",""]);
    rows.push(["-- Warnings --",""]);
    parsed.warnings.forEach(w=>rows.push([w,""]));
  }
  return {name:"Summary",header:["Item","Value","Detail"],rows:rows,cols:[30,60,18]};
}

function computeStats(parsed){
  const byKind={}, byGroup={}; let inspRows=0, lightRows=0;
  parsed.inspects.forEach(s=>{ inspRows+=s.rows.length;
    s.rows.forEach(r=>{ byKind[r.kind]=(byKind[r.kind]||0)+1;
      byGroup[r.specGroup]=(byGroup[r.specGroup]||0)+1; }); });
  parsed.lights.forEach(s=>{ lightRows+=s.rows.length; });
  return {byKind:byKind,byGroup:byGroup,inspRows:inspRows,lightRows:lightRows};
}

function buildAllTables(parsed,dict,opts){
  const stats=computeStats(parsed);
  const tables=[];
  const insp=buildInspectionTable(parsed,dict,opts);
  const light=buildLightTable(parsed,dict,opts);
  const lightGrouped=colorGroupTable(parsed,opts);
  const cmp=buildComparison(parsed,dict,opts);
  stats.diffCount=cmp.diffCount||0;
  const dic=buildDictTable(dict,opts);
  const summary=buildSummary(parsed,dict,opts,Object.assign({time:new Date().toLocaleString()},stats));
  if(insp.rows.length) tables.push(insp);
  if(light.rows.length) tables.push(light);
  if(lightGrouped.rows.length) tables.push(lightGrouped);
  if(cmp.rows.length) tables.push(cmp);
  tables.push(dic.param);
  tables.push(dic.node);
  tables.unshift(summary);
  return {tables:tables,stats:stats,cmp:cmp};
}
