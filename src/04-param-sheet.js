/* ============================================================
   4. Parameter sheets (parsed model -> Parameter_Template.xlsx layout)
   The "needed parameters" view: the curated parameter families of
   Parameter_Template.xlsx, arranged per area (GPNODE-PNODE-CNODE)
   with the RED/GREEN/BLUE value columns. GV rows are measured by
   hand and are never present in the XML, so they stay editable.
   Produces a "parameter sheet view model" consumed by the renderer
   and by both export paths (generated sheet / real template fill).
   ============================================================ */

const TEMPLATE_FAMILIES={
  A:[["Bright Defect(TH)",1000],["Bright Defect Margine(TH)",1001],["Bright Defect Size(Pixel)",1002],
     ["Bright Defect Offest(%)",1003],["Bright Defect Offset1 Size(Pixel)",1004],["Bright Defect Offest2(TH)",1005],
     ["Bright Defect Offset2 Size(Pixel)",1006],["Bright Defect Pad Offest(TH)",1007],["Bright Defect Pad Offset Size(Pixel)",1008],
     ["Dark Defect(TH)",1009],["Dark Defect Margine(TH)",1010],["Dark Defect Size(Pixel)",1011],
     ["Dark Defect Offest(%)",1012],["Dark Defect Offset1 Size(Pixel)",1013],["Dark Defect Offest2(TH)",1014],
     ["Dark Defect Offset2 Size(Pixel)",1015],["Dark Defect Pad Offest(TH)",1016],["Dark Defect Pad Offset Size(Pixel)",1017],
     ["Nick Defect GV",1030],["Nick Defect Size(Pixel)",1031],["Protrusion Defect GV",1032],["Protrusion Defect Size(Pixel)",1033]],
  B:[["Bright Defect(TH)",1000],["Bright Defect Size(Pixel)",1002],["Bright Defect Offest(%)",1003],
     ["Bright Defect Offset1 Size(Pixel)",1004],["Bright Defect Offest2(TH)",1005],["Bright Defect Offset2 Size(Pixel)",1006],
     ["Dark Defect(TH)",1009],["Dark Defect Size(Pixel)",1011],["Dark Defect Offest(%)",1012],
     ["Dark Defect Offset1 Size(Pixel)",1013],["Dark Defect Offest2(TH)",1014],["Dark Defect Offset2 Size(Pixel)",1015],
     ["In-Range Defect Min(TH)",1034],["In-Range Defect Max(TH)",1035],["In-Range Defect Size(Size)",1036]],
  C:[["Bright Threshold",0],["Bright Threshold(Pixel)",0],["Bright Offset2(TH)",0],["Bright Offset2(Pixel)",0],
     ["Dark Threshold",0],["Dark Threshold(Pixel)",0],["Dark Offset2(TH)",0],["Dark Offset2(Pixel)",0]],
  LASER:[["밝은불량(절대값)",1000],["밝은불량 크기(%)",1018],["어두운불량(절대값)",1009],["어두운불량 크기(%)",1019]]
};
const TEMPLATE_FAMILY_INFO={
  A:"pad / defect (22 params)",
  B:"structure (15 params)",
  C:"Dummy threshold (8 params - ParamKey still unconfirmed, see PARAMETER_TEMPLATE_NOTES.md)",
  LASER:"Laser Marking (4 params)"
};
const TEMPLATE_AREAS=[
  {area:"UNIT - AU - C-Pad",           g:"1",p:"2",c:"20",family:"A"},
  {area:"UNIT - AU - B-Pad",           g:"1",p:"2",c:"21",family:"A"},
  {area:"UNIT - AU - L-Pad",           g:"1",p:"2",c:"22",family:"A"},
  {area:"UNIT - OSP - C-Pad",          g:"1",p:"3",c:"20",family:"A"},
  {area:"UNIT - OSP - B-Pad",          g:"1",p:"3",c:"21",family:"A"},
  {area:"UNIT - OSP - L-Pad",          g:"1",p:"3",c:"22",family:"A"},
  {area:"UNIT - NonMetal - Pattern1",  g:"1",p:"5",c:"51",family:"B"},
  {area:"UNIT - NonMetal - PatternThick",g:"1",p:"5",c:"54",family:"B"},
  {area:"UNIT - NonMetal - Space1",    g:"1",p:"5",c:"55",family:"B"},
  {area:"UNIT - NonMetal - SpaceThick",g:"1",p:"5",c:"61",family:"B"},
  {area:"UNIT - NonMetal - Open1",     g:"1",p:"5",c:"62",family:"B"},
  {area:"UNIT - NonMetal - Laser Marking",g:"1",p:"5",c:"80",family:"LASER"},
  {area:"Dummy - AU - L-Pad",          g:"2",p:"2",c:"22",family:"A"},
  {area:"Dummy - NonMetal - Pattern1", g:"2",p:"5",c:"51",family:"C"},
  {area:"Dummy - NonMetal - Space1",   g:"2",p:"5",c:"55",family:"C"},
  {area:"Dummy - NonMetal - Open1",    g:"2",p:"5",c:"62",family:"C"}
];
/* spelling variants between the template labels and SpecParameter.xml (see the notes doc) */
const LABEL_ALIASES={
  "brightdefectoffest1(%)":1003,"brightdefectoffest(%)":1003,
  "darkdefectoffest(%)":1012,"darkdefectoffset1(%)":1012,
  "darkdefectoffest2(th)":1014,"darkdefectoffset2(th)":1014,
  "darkdefectpadoffest(th)":1016,"darkdefectpadoffset(th)":1016,
  "in-rangedefectsize(size)":1036,"in-rangedefectsize(pixel)":1036,
  "nickdefectsize(pixel)":1031
};
function nrm(s){ return String(s===null||s===undefined?"":s).replace(/[\s_]/g,"").toLowerCase(); }
const TEMPLATE_LABEL_KEY=(function(){
  const m={};
  Object.keys(LABEL_ALIASES).forEach(k=>{ m[k]=LABEL_ALIASES[k]; });
  Object.keys(TEMPLATE_FAMILIES).forEach(f=>TEMPLATE_FAMILIES[f].forEach(pair=>{
    const k=nrm(pair[0]); if(m[k]===undefined&&pair[1]) m[k]=pair[1];
  }));
  return m;
})();
function dictKeyIndex(dict){
  const m={};
  Object.keys(dict.param).forEach(k=>{
    const e=dict.param[k]||{};
    if(e.en) m[nrm(e.en)]=Number(k);
    if(e.kr) m[nrm(e.kr)]=Number(k);
  });
  return m;
}
function labelToKey(label,dictIndex){
  const n=nrm(label);
  if(!n) return null;
  if(TEMPLATE_LABEL_KEY[n]!==undefined) return TEMPLATE_LABEL_KEY[n];
  if(dictIndex && dictIndex[n]!==undefined) return dictIndex[n];
  return null;
}

function dirOf(label){
  const s=String(label);
  const i=s.lastIndexOf("/");
  return i>=0?s.slice(0,i):"";
}
function pathParts(dir){ return String(dir).split("/").filter(Boolean); }
function modelOf(dir){
  const parts=pathParts(dir);
  const i=parts.findIndex(p=>/^(TOP|BOTTOM)\b/i.test(p));
  return i>0?parts[i-1]:"";
}
function variantOf(dir){
  const parts=pathParts(dir);
  const p=parts.find(x=>/^(TOP|BOTTOM)\b/i.test(x));
  return p||"";
}
/* one group = one folder (INSPECT_SPEC/<model>/<SIDE>/<LIGHT>); files of the
   same model+side+light are kept together, different models never merge */
function groupInspects(parsed){
  const map=new Map();
  (parsed.inspects||[]).forEach(spec=>{
    const dir=dirOf(spec.label), side=sideOf(spec.label), light=lightOf(spec.label);
    const key=dir||((side||"?")+"|"+(light||"?"));
    if(!map.has(key)) map.set(key,{key:key,dir:dir,side:side,light:light,
      model:modelOf(dir),variant:variantOf(dir),specs:[]});
    map.get(key).specs.push(spec);
  });
  return [...map.values()].sort((a,b)=>{
    const s=(a.side===b.side)?0:(a.side==="TOP"?-1:1);
    return s||String(a.light).localeCompare(String(b.light))||String(a.model).localeCompare(String(b.model));
  });
}
function inspectNodeIndex(spec){
  const nodes=new Map();
  spec.rows.forEach(r=>{
    const k=r.gpId+"|"+r.pnId+"|"+r.cnId;
    let e=nodes.get(k);
    if(!e){ e={g:r.gpId,p:r.pnId,c:r.cnId,rows:[],pnCheck:r.pnCheck,cnCheck:r.cnCheck}; nodes.set(k,e); }
    e.rows.push(r);
  });
  return nodes;
}
function nodeValue(node,key){
  if(!node||!key) return {r:"",g:"",b:"",kind:"",found:false};
  const rs=node.rows.filter(r=>String(r.paramKey)===String(key));
  if(!rs.length) return {r:"",g:"",b:"",kind:"",found:false};
  const insp=rs.find(r=>r.kind==="INSPECTION");
  if(insp) return {r:insp.v[0],g:insp.v[1],b:insp.v[2],kind:"INSPECTION",found:true};
  return {r:rs[0].v[0],g:"",b:"",kind:rs[0].kind,found:true};
}
/* illumination axis (조명 축) - derived from LightSpec channels, not stored in any config verbatim.
   Channels are grouped by LED colour (CH1 CH5 CH9 are all White, only the angle differs) and shown
   with the equipment's 1-based channel number (LightSpec @Index is 0-based, see CHANNEL_BASE).
   `axis.R/G/B` is the flattened text used by the xlsx export, `axis.cols[<R|G|B>]` keeps the groups
   for the on-screen chips. */
function axisFor(parsed,lightNum,model){
  const out={R:"",G:"",B:"",cols:{},note:"",lightSet:"",file:"",page:""};
  const all=parsed.lights||[];
  const short=String(model||"").replace(/-\d+$/,"");           /* 6AN0921I01-00 -> 6AN0921I01 */
  let pool=all.filter(ls=>short&&String(ls.label).indexOf(short)>=0);
  let note="";
  if(!pool.length){
    pool=all;
    if(short&&all.length) note="no LightSpec for "+short+"; used "+all[0].label;
  }
  if(!pool.length){ out.note="no LightSpec source available"; return out; }
  const spec=pool[0];                                          /* one LightSpec per model */
  let rows=spec.rows.filter(r=>Number(r.setIdx)===lightNum);
  if(!rows.length){
    rows=spec.rows.filter(r=>Number(r.setIdx)===1);
    if(rows.length) note=(note?note+" · ":"")+"no LightSet "+lightNum+" in the file; LightSet 1 used as the reference";
  }
  if(!rows.length){ out.note=note||"no LightSet data in "+spec.label; return out; }
  const sel=String(rows[0].selPage);
  const enabled=rows.filter(r=>String(r.page)===sel&&r.chEnable==="1"&&Number(r.value)>0);
  ["R","G","B"].forEach(cam=>{
    const groups=groupChannels(enabled.filter(x=>String(x.color).toUpperCase()===cam));
    out.cols[cam]=groups;
    out[cam]=groups.map(g=>g.name.toUpperCase()+" "
        +g.items.map(i=>channelName(i.ch)+":"+num(i.value,"")+"("+i.angle+"°)").join(" "))
      .join(" | ");
  });
  out.lightSet=rows[0].setIdx;
  out.file=spec.label;
  out.page=sel;
  out.note=(note?note+" · ":"")+out.file+" · LightSet "+out.lightSet+" · selected page "+sel
    +" · grouped by LED colour, 1-based channel numbers (XML @Index 0-based)"
    +(enabled.length?"":" · no enabled channel with value > 0");
  return out;
}
function paramBlock(areaDef,node,dict){
  const fam=TEMPLATE_FAMILIES[areaDef.family]||[];
  const params=fam.map(pair=>{
    const label=pair[0], key=pair[1]||null;
    if(!key) return {label:label,key:null,r:"",g:"",b:"",state:"unmapped"};
    const v=nodeValue(node,key);
    if(!v.found) return {label:label,key:key,r:"",g:"",b:"",state:"missing",kind:v.kind};
    return {label:label,key:key,r:v.r,g:v.g,b:v.b,state:(v.kind==="INSPECTION"?"ok":"master"),kind:v.kind};
  });
  return {area:areaDef.area,g:areaDef.g,p:areaDef.p,c:areaDef.c,family:areaDef.family,
    familyInfo:TEMPLATE_FAMILY_INFO[areaDef.family]||"",params:params,
    present:[...new Set(node.rows.map(r=>r.paramKey))].map(Number).filter(n=>!isNaN(n)).sort((a,b)=>a-b),
    pnCheck:node.pnCheck,cnCheck:node.cnCheck};
}
function buildParamSheet(parsed,group,dict,opts,dictIndex,name){
  const spec=group.specs[0];
  const nodes=inspectNodeIndex(spec);
  const blocks=[], used=new Set(), templateMissing=[];
  TEMPLATE_AREAS.forEach(a=>{
    const k=a.g+"|"+a.p+"|"+a.c;
    const node=nodes.get(k);
    if(!node||!node.rows.length){ templateMissing.push(a.area); return; }
    used.add(k); blocks.push(paramBlock(a,node,dict));
  });
  const extras=[];
  nodes.forEach((node,k)=>{
    if(used.has(k)||!node.rows.length) return;
    extras.push({
      path:"G"+node.g+" "+gpName(dict,node.g)+" ▸ P"+node.p+" "+pnName(dict,node.p)+" ▸ C"+node.c+" "+cnName(dict,node.c),
      count:node.rows.length,
      keys:[...new Set(node.rows.map(r=>r.paramKey))].map(Number).filter(n=>!isNaN(n)).sort((a,b)=>a-b).join(", ")
    });
  });
  const gvClasses=[];
  if(blocks.some(b=>b.p==="2"||b.p==="3")) gvClasses.push("AU","OSP");
  if(blocks.some(b=>b.p==="5")) gvClasses.push("SR","SPACE");
  const lightNum=Number(String(group.light||"").replace(/\D/g,""));
  const sheet={kind:"param",key:group.key,name:name||((group.side||"?")+" - "+(group.light||"?")),
    side:group.side,light:group.light,model:group.model,variant:group.variant,dir:group.dir,
    files:group.specs.map(s=>s.label),
    axis:axisFor(parsed,lightNum,group.model),gvClasses:gvClasses,blocks:blocks,extras:extras,
    templateMissing:templateMissing,notes:[]};
  if(group.specs.length>1) sheet.notes.push("several InspectionSpec files carry the same folder; the first is used: "+spec.label);
  if(!group.side||!group.light) sheet.notes.push("side/light are missing in the file label — rename it (double-click) to something like "
    +"\"TOP/LIGHT2\" or drop the whole INSPECT_SPEC folder, otherwise this sheet cannot be matched to the template.");
  if(group.variant&&/복사본|copy|bk|backup/i.test(group.variant))
    sheet.notes.push("this folder looks like a copy/backup ("+group.variant+") - delete it from the drop list if it should not be exported");
  const unassigned=blocks.filter(b=>b.family==="C"&&b.g==="2").map(b=>b.area);
  if(unassigned.length) sheet.notes.push("Dummy areas use the unconfirmed family C (values left blank): "+unassigned.join(", "));
  return sheet;
}
function buildParamSheets(parsed,dict,opts,dictIndex){
  const groups=groupInspects(parsed);
  const taken=new Set(), names=[];
  groups.forEach(g=>{
    const base=(g.side||"?")+" - "+(g.light||"?");
    const cands=[base, base+" · "+g.model, base+" · "+(g.variant||"?"), base+" · "+(g.dir||"?")];
    let name=cands.find(c=>c&&!taken.has(c));
    if(!name){ let i=2; while(taken.has(base+" ("+i+")")) i++; name=base+" ("+i+")"; }
    taken.add(name); names.push(name);
  });
  return groups.map((g,i)=>buildParamSheet(parsed,g,dict,opts,dictIndex,names[i]));
}

/* ---------- export layout of one parameter sheet (template shape) ---------- */
function paramSheetLayout(sheet,opts){
  const rows=[], merges=[], cols=[28,30,10,30,10,30,10];
  const pad=(arr,n)=>arr.concat(new Array(Math.max(0,n-arr.length)).fill(""));
  rows.push(["","source: "+sheet.files.join(" | ")+"  ·  generated by Spec Param Tool v"+VERSION]); merges.push("B1:G1");
  rows.push(["채널","RED","","GREEN","","BLUE",""]); merges.push("B2:C2","D2:E2","F2:G2");
  rows.push(["조명 축",sheet.axis.R,"",sheet.axis.G,"",sheet.axis.B,""]); merges.push("B3:C3","D3:E3","F3:G3");
  const gvStart=4, gvList=sheet.gvClasses.length?sheet.gvClasses:["AU"];
  gvList.forEach((cls,i)=>{
    const gv=(opts.gv&&opts.gv[sheet.key+"|"+cls])||{};
    rows.push([i===0?"GV 밝기":"",cls,num(gv.R,opts.digits),cls,num(gv.G,opts.digits),cls,num(gv.B,opts.digits)]);
  });
  if(gvList.length>1) merges.push("A"+gvStart+":A"+(gvStart+gvList.length-1));
  rows.push(new Array(7).fill(""));
  sheet.blocks.forEach(b=>{
    const r=rows.length+1;
    rows.push(["영역",b.area,"","","","",""]); merges.push("B"+r+":G"+r);
    rows.push(["검출 불량","","","","","",""]); merges.push("B"+(r+1)+":C"+(r+1),"D"+(r+1)+":E"+(r+1),"F"+(r+1)+":G"+(r+1));
    b.params.forEach((p,i)=>{
      rows.push([i===0?"파라미터":"",p.label,num(p.r,opts.digits),p.label,num(p.g,opts.digits),p.label,num(p.b,opts.digits)]);
    });
    rows.push(new Array(7).fill(""));
  });
  if(sheet.extras.length){
    const r=rows.length+1;
    rows.push(["영역","(not covered by the parameter template)","","","","",""]); merges.push("B"+r+":G"+r);
    sheet.extras.forEach(x=>rows.push(["",x.path+"  ["+x.count+" params: "+x.keys+"]","","","","",""]));
    rows.push(new Array(7).fill(""));
  }
  return {name:safeSheetName(sheet.name,{}),header:null,rows:rows,cols:cols,merges:merges,noFilter:true,freeze:false};
}
function paramTables(paramSheets,opts){
  return (paramSheets||[]).map(s=>paramSheetLayout(s,opts));
}
