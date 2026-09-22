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

/* ------------------------------------------------------------
   Light -> parameter-area rule
   ------------------------------------------------------------
   Which areas carry data is a property of the light, not of the XML: every
   InspectionSpec.xml lists the same 27 nodes with values everywhere, so the
   rule cannot be derived from the files and is stated explicitly here
   (confirmed with the equipment engineer):

     LIGHT0  AI-model inspection, not RuleBase  ->  no parameters at all
     LIGHT1  metal areas only                   ->  PNODE 2 (AU) + 3 (OSP)
     LIGHT2  SR / non-metal area only           ->  PNODE 5 (NonMetal)

   One LightSpec file holds all three lights, so the light in use comes from the
   UI (opts.lightIndex); when it is unknown nothing is filtered. Applied to the
   parameter sheet, the InspectionSpec sheet and the comparison - the LightSpec
   listings describe the light hardware and stay complete.
   ------------------------------------------------------------ */
const LIGHT_AREA_RULES={
  "0":{pn:[],note:"LIGHT0 is the AI-model inspection light - it has no RuleBase parameters"},
  "1":{pn:["2","3"],note:"LIGHT1 covers the metal areas only (AU + OSP)"},
  "2":{pn:["5"],note:"LIGHT2 covers the SR / non-metal area only (NonMetal)"}
};
function lightAreaRule(lightIndex){
  if(lightIndex===undefined||lightIndex===null||lightIndex==="") return null;
  const k=String(Number(lightIndex));
  return Object.prototype.hasOwnProperty.call(LIGHT_AREA_RULES,k)?LIGHT_AREA_RULES[k]:null;
}
/* null = no rule (light unknown) -> the model is returned untouched */
function filterInspectsByLight(parsed,opts){
  const rule=lightAreaRule(opts&&opts.lightIndex);
  if(!rule) return parsed;
  const inspects=(parsed.inspects||[]).map(s=>Object.assign({},s,{
    rows:s.rows.filter(r=>rule.pn.indexOf(String(r.pnId))>=0)}));
  return Object.assign({},parsed,{inspects:inspects,lightRule:rule});
}

/* ------------------------------------------------------------
   Which InspectionSpec file belongs to the selected Side / Light
   ------------------------------------------------------------
   Every loaded file stays in the model - dropping the whole INSPECT_SPEC folder
   is the normal case - and the Side / Light select picks the ones to use, so the
   other sides/lights are no longer ignored. A file whose label carries no folder
   is kept, because the UI declares its side/light (see applyUiOverrides).

   A copied tree ("TOP - 복사본") is a backup of the same side/light, so when a
   real folder covers the same side+light the copy is left out - otherwise the
   same template sheet would be written twice. The copies are reported back in
   `selection.copies`.
   ------------------------------------------------------------ */
function isCopyFolder(label){
  const side=sideOf(label), folder=sideFolderOf(label).toUpperCase();
  return !!(folder&&side&&folder!==side);
}
function selectInspectsBySideLight(parsed,opts){
  const all=parsed.inspects||[];
  const side=opts&&opts.side?String(opts.side).toUpperCase():"";
  const sideNorm=side==="BTM"?"BOTTOM":side;
  const hasLight=opts&&opts.lightIndex!==undefined&&opts.lightIndex!==null&&opts.lightIndex!=="";
  const light=hasLight?("LIGHT"+Number(opts.lightIndex)):"";
  if(!sideNorm&&!hasLight) return parsed;
  const matched=all.filter(spec=>{
    const s=sideOf(spec.label), l=lightOf(spec.label);
    if(!s&&!l) return true;                     /* no folder: the UI decides */
    if(sideNorm&&s&&s!==sideNorm) return false;
    if(light&&l&&l!==light) return false;
    return true;
  });
  const realKeys=new Set(matched.filter(s=>!isCopyFolder(s.label))
    .map(s=>sideOf(s.label)+"|"+lightOf(s.label)));
  const keep=matched.filter(s=>!isCopyFolder(s.label)||!realKeys.has(sideOf(s.label)+"|"+lightOf(s.label)));
  return Object.assign({},parsed,{inspects:keep,
    selection:{side:sideNorm,light:light,kept:keep.length,of:all.length,
      files:keep.map(s=>s.label),copies:matched.filter(s=>keep.indexOf(s)<0).map(s=>s.label)}});
}

/* ------------------------------------------------------------
   InspectionSpec input sheet (file 2)
   ------------------------------------------------------------
   The equipment screen shows, per light, the areas as sections and inside each
   one a numbered list of parameter names with the values to type. This builder
   reproduces that shape so the workbook can be filled straight from the machine
   UI:

     Unit / Dummy  ->  area (PNODE)  ->  sub-area (CNODE)
                   ->  "No. | Name | Red | Green | Blue"

   Only the INSPECTION (R/G/B) parameters are listed - the MASTER/SUBMASTER node
   settings (Common, Mask Inspection, Chain Align, Adjust Mask, ...) are not part
   of what has to be typed in, and a section left without any INSPECTION
   parameter disappears with its headers. Parameters are ordered by ParamKey,
   the same order the machine lists them. Minimum / maximum values, node ids,
   descriptions and control types are dropped. Several elements of one node
   collapse onto a single row (an INSPECTION element wins over a MASTER one).
   ------------------------------------------------------------ */
const INSPECTION_INPUT_COLS=[7,52,14,14,14];
const INPUT_COL_LETTERS=["A","B","C","D","E"];
/* one row per ParamKey, INSPECTION preferred, listed in ParamKey order */
function inputParamsOf(list){
  const byKey=new Map();
  list.forEach(r=>{
    const k=String(r.paramKey), cur=byKey.get(k);
    if(!cur||(cur.kind!=="INSPECTION"&&r.kind==="INSPECTION")) byKey.set(k,r);
  });
  return [...byKey.values()].sort((a,b)=>Number(a.paramKey)-Number(b.paramKey));
}
function buildInspectionInputTable(parsed,dict,opts){
  const rows=[], merges=[];
  const span=(r,c1,c2)=>merges.push(INPUT_COL_LETTERS[c1-1]+r+(c2>c1?":"+INPUT_COL_LETTERS[c2-1]+r:""));
  const files=(parsed.inspects||[]).map(s=>s.label);
  rows.push(["source: "+files.join(" | ")+"  ·  generated by Spec Param Tool v"+VERSION]);
  span(1,1,5);
  (parsed.inspects||[]).forEach(spec=>{
    const byG=new Map();
    spec.rows.forEach(r=>{
      if(!byG.has(r.gpId)) byG.set(r.gpId,new Map());
      const byP=byG.get(r.gpId);
      if(!byP.has(r.pnId)) byP.set(r.pnId,new Map());
      const byC=byP.get(r.pnId);
      if(!byC.has(r.cnId)) byC.set(r.cnId,[]);
      byC.get(r.cnId).push(r);
    });
    /* the UI declares the side/light when a file label has no folder (opts wins) */
    const uiSide=(opts&&opts.side)?String(opts.side).toUpperCase():"";
    const side=(uiSide==="BTM"?"BOTTOM":uiSide)||sideOf(spec.label)||"?";
    const hasLight=opts&&opts.lightIndex!==undefined&&opts.lightIndex!==null&&opts.lightIndex!=="";
    const light=hasLight?("LIGHT"+Number(opts.lightIndex)):(lightOf(spec.label)||"?");
    /* only the INSPECTION (R/G/B) parameters are kept - the MASTER/SUBMASTER
       node settings (Common, Mask Inspection, Chain Align, Adjust Mask, ...) are
       not part of what has to be typed in. A section that ends up without any
       INSPECTION parameter disappears together with its headers. */
    const inspOf=list=>inputParamsOf(list).filter(r=>r.kind==="INSPECTION");
    const gKeys=[...byG.keys()].sort((a,b)=>Number(a)-Number(b)).filter(g=>{
      const byP=byG.get(g);
      return [...byP.values()].some(byC=>[...byC.values()].some(list=>inspOf(list).length));
    });
    gKeys.forEach(g=>{
      const byP=byG.get(g);
      const pKeys=[...byP.keys()].sort((a,b)=>Number(a)-Number(b))
        .filter(p=>[...byP.get(p).values()].some(list=>inspOf(list).length));
      rows.push([gpName(dict,g)+"   ("+side+" · "+light+")"]);
      span(rows.length,1,5);
      pKeys.forEach(p=>{
        const byC=byP.get(p);
        const cKeys=[...byC.keys()].sort((a,b)=>Number(a)-Number(b)).filter(c=>inspOf(byC.get(c)).length);
        rows.push(["","▸ "+pnName(dict,p)]);
        span(rows.length,2,5);
        cKeys.forEach(c=>{
          rows.push(["","","· "+cnName(dict,c)]);
          span(rows.length,3,5);
          rows.push(["No.","Name","Red","Green","Blue"]);
          inspOf(byC.get(c)).forEach((r,i)=>rows.push([i+1,paramName(dict,r.paramKey,opts.nameMode),
            num(r.v[0],opts.digits),num(r.v[1],opts.digits),num(r.v[2],opts.digits)]));
        });
      });
    });
  });
  if(rows.length===1){
    const rule=lightAreaRule(opts&&opts.lightIndex);
    rows.push([rule?rule.note:"no parameter rows in the loaded file(s)"]);
    span(rows.length,1,5);
  }
  return {name:"InspectionSpec",header:null,rows:rows,cols:INSPECTION_INPUT_COLS,merges:merges,
    noFilter:true,freeze:false,sparse:true};
}

function buildLightTable(parsed,dict,opts){
  const header=["No","File","Camera","LightSet","Set En","Pages","Sel Page","Light","Page","Page En","Ch Count","Channel","XML Index","Color","Color Name","Angle","Value","Ch En"];
  const rows=[]; let i=0;
  parsed.lights.forEach(spec=>{
    spec.rows.forEach(r=>{
      if(!opts.keepZero&&String(r.chEnable)==="0") return;
      i++;
      rows.push([i,spec.label,CAMERA_TYPES[r.camera]!==undefined?CAMERA_TYPES[r.camera]:(r.camera||""),
        r.setIdx,r.setEnable,r.pageCount,r.selPage,"LIGHT"+r.page,r.page,r.pageEnable,r.chCount,
        channelNo(r.ch),r.ch,r.color,CHANNEL_COLORS[r.color]||"",num(r.angle,opts.digits),num(r.value,opts.digits),r.chEnable]);
    });
  });
  return {name:"LightSpec",header:header,rows:rows,cols:[6,26,11,9,8,7,8,10,7,9,8,8,10,7,9,7,9,9]};
}

/* ------------------------------------------------------------
   Light channels grouped by LED colour
   ------------------------------------------------------------
   A channel list such as CH1(W,0°) CH2(B,0°) CH5(W,30°) CH9(W,30°) is easier to
   read grouped by LED colour, while the channel number must stay visible
   ("CH1 CH5 CH9 are all White, only the angle differs"). Both the axis row of the
   parameter sheet, the light view and the export use this one helper.

   Numbering: LightSpec stores Channel/@Index **0-based** (0…19) but the equipment
   UI and Parameter_Template.xlsx count **1-based** (CH 1 … CH 20). Everything the
   user sees is therefore shifted by CHANNEL_BASE; the raw XML index stays available
   in tooltips and as its own export column.
   ------------------------------------------------------------ */
const CHANNEL_BASE=1;                          /* 1 = show CH1…CH20 (equipment), 0 = raw XML index */
function channelNo(ch){ return Number(ch)+CHANNEL_BASE; }
function channelName(ch){ return "CH"+channelNo(ch); }
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
        r.selPage,"LIGHT"+r.page,r.page,g.name,g.color,channelNo(r.ch),num(r.value,opts.digits),
        num(r.angle,opts.digits),r.chEnable==="1"?"on":"off",i+1,r.ch]);
    }));
  });
  return out;
}
const LIGHT_GROUP_HEADER=["File","LightSet","Camera","Sel Page","Light","Page","Group","Color","Channel","Value","Angle","On","Index in group","XML Index (0-based)"];
const LIGHT_GROUP_COLS=[26,9,11,8,10,7,9,7,8,9,7,6,12,17];
function colorGroupTable(parsed,opts){
  const rows=[];
  (parsed.lights||[]).forEach(spec=>{ Array.prototype.push.apply(rows,colorGroupRows(spec.rows,spec.label,opts)); });
  return {name:"LightSpec Grouped",header:LIGHT_GROUP_HEADER,rows:rows,cols:LIGHT_GROUP_COLS};
}
/* flat export of a single light view (used by "Export Sheet CSV" on a light tab) */
function lightSheetTable(sheet,opts){
  return {name:sheet.name,header:LIGHT_GROUP_HEADER,rows:colorGroupRows(sheet.rows||[],sheet.file,opts),
    cols:LIGHT_GROUP_COLS};
}
/* ------------------------------------------------------------
   Lights inside one LightSpec file
   ------------------------------------------------------------
   A LightSpec.xml holds **every light of the model**: one <Light_Setting>, one
   <LightSet> (the hardware setup) and one <Page> per light with 20 channels each
   (LIGHT0 = Page 0, LIGHT1 = Page 1, LIGHT2 = Page 2). `SelectPage` is only the
   page currently selected on the machine. The INSPECT_SPEC folders
   (…/TOP/LIGHT<n>/InspectionSpec.xml) are per light, so the axis/GV data of a
   parameter sheet must come from the matching Page, never from SelectPage.
   ------------------------------------------------------------ */
function lightsOfSpec(spec){
  const sets=new Map();
  (spec.rows||[]).forEach(r=>{
    const sk=String(r.setIdx);
    if(!sets.has(sk)) sets.set(sk,{setIdx:r.setIdx,rows:[]});
    sets.get(sk).rows.push(r);
  });
  const setKeys=[...sets.keys()];
  const out=[];
  setKeys.forEach(sk=>{
    const s=sets.get(sk), byPage=new Map();
    s.rows.forEach(r=>{
      const pk=String(r.page);
      if(!byPage.has(pk)) byPage.set(pk,{page:r.page,enable:r.pageEnable,count:r.chCount,rows:[]});
      byPage.get(pk).rows.push(r);
    });
    [...byPage.values()].forEach(p=>{
      const head=p.rows[0];
      const groups=groupChannels(p.rows);
      out.push({
        setIdx:s.setIdx, multiSet:setKeys.length>1, page:p.page, pageIndex:Number(p.page),
        lightName:"LIGHT"+p.page, pageCount:head.pageCount, selPage:head.selPage,
        camera:head.camera, enable:p.enable, count:p.count, rows:p.rows, groups:groups,
        colors:groups.length,
        on:groups.reduce((n,g)=>n+g.items.filter(i=>i.chEnable==="1").length,0),
        off:groups.reduce((n,g)=>n+g.items.filter(i=>i.chEnable!=="1").length,0)
      });
    });
  });
  return out.sort((a,b)=>a.pageIndex-b.pageIndex);
}
function specModel(spec){
  const parts=String(spec.label).split("/");
  return parts.length>1?parts[parts.length-2]:"";
}
/* one view per light (= one <Page>) of every LightSpec file */
function buildLightViews(parsed,dict,opts){
  const used=new Set(), out=[];
  (parsed.lights||[]).forEach(spec=>{
    const model=specModel(spec);
    lightsOfSpec(spec).forEach(lt=>{
      let label="Light: "+(model||spec.label.replace(/\.xml$/i,""))+" · "+lt.lightName;
      if(used.has(label)) label+=" · set "+lt.setIdx;
      used.add(label);
      out.push({kind:"light",name:label,label:label,sheet:{
        file:spec.label,model:model,light:lt.lightName,lightIndex:lt.pageIndex,
        setIdx:lt.setIdx,multiSet:lt.multiSet,page:lt.page,pageCount:lt.pageCount,selPage:lt.selPage,
        camera:lt.camera,enable:lt.enable,count:lt.count,on:lt.on,off:lt.off,colors:lt.colors,
        groups:lt.groups,rows:lt.rows,
        note:"one <Page> per light in LightSpec.xml — "+lt.lightName+" = Page "+lt.page
          +" of "+lt.pageCount+" ("+lt.count+" channels). Grouped by LED colour; numbers are the "
          +"equipment's 1-based channel numbers (LightSpec @Index is 0-based, so CH1 = @Index 0)"
      }});
    });
  });
  return out;
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
  if(parsed.selection||parsed.lightRule){
    const extra=[];
    if(parsed.selection){
      extra.push(["InspectionSpec used",parsed.selection.kept+" of "+parsed.selection.of
        +" loaded file(s) match "+(parsed.selection.side||"?")+" / "+(parsed.selection.light||"?")]);
      if((parsed.selection.copies||[]).length)
        extra.push(["Backup folders skipped",parsed.selection.copies.join(" | ")]);
    }
    if(parsed.lightRule) extra.push(["Light filter",parsed.lightRule.note
      +(parsed.lightRule.pn.length?" - kept PNODE "+parsed.lightRule.pn.join(", "):"")]);
    const di=rows.findIndex(r=>r[0]==="Comparison differences");
    if(di>=0) rows.splice.apply(rows,[di+1,0].concat(extra));
  }
  parsed.lights.forEach(s=>rows.push([s.label,"LightSpec",s.rows.length+" rows · "
    +lightsOfSpec(s).map(l=>l.lightName).join(", ")+" · machine selection: page "+lightsOfSpec(s)[0].selPage]));
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
  const insp=buildInspectionInputTable(parsed,dict,opts);
  const light=buildLightTable(parsed,dict,opts);
  const lightGrouped=colorGroupTable(parsed,opts);
  const cmp=buildComparison(parsed,dict,opts);
  stats.diffCount=cmp.diffCount||0;
  const dic=buildDictTable(dict,opts);
  const summary=buildSummary(parsed,dict,opts,Object.assign({time:new Date().toLocaleString()},stats));
  if(parsed.inspects.length) tables.push(insp);
  if(light.rows.length) tables.push(light);
  if(lightGrouped.rows.length) tables.push(lightGrouped);
  if(cmp.rows.length) tables.push(cmp);
  tables.push(dic.param);
  tables.push(dic.node);
  tables.unshift(summary);
  return {tables:tables,stats:stats,cmp:cmp};
}
