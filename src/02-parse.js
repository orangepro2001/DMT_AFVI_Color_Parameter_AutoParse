/* ============================================================
   2. Parsing: XML text -> parsed model
   Input : file text (LightSpec / InspectionSpec / dictionaries).
   Output: the "parsed model" - flat row objects that keep the raw
   attribute values, without any presentation concerns:
     { kind:"inspection", label, rows:[{gpId,pnId,cnId,kind,paramKey,
                                        v:[R,G,B], mn:[...], mx:[...], ...}] }
     { kind:"light",      label, rows:[{setIdx,page,ch,color,value,...}] }
   Everything downstream (models, views, exports) consumes only this.
   ============================================================ */

const VERSION = "1.1.0";

function elemChildren(el){
  const out=[];
  if(!el||!el.childNodes) return out;
  for(let i=0;i<el.childNodes.length;i++){
    const n=el.childNodes[i];
    if(n.nodeType===1) out.push(n);
  }
  return out;
}
function tagName(el){ return (el.tagName||el.nodeName||"").replace(/^.*:/,""); }
function kids(el,name){ return elemChildren(el).filter(e=>tagName(e)===name); }

function parseXml(text){
  let doc;
  try{ doc = new DOMParser().parseFromString(text,"application/xml"); }
  catch(e){ throw new Error("XML parse error: "+e.message); }
  const perr = doc.getElementsByTagName("parsererror");
  if(perr && perr.length) throw new Error("malformed XML (parsererror)");
  const root = doc.documentElement;
  if(!root || tagName(root)!=="pixel") throw new Error("not a spec file (root element must be <pixel>)");
  return doc;
}

function makeDict(){
  return {
    param:Object.assign({},PARAM_NAMES),
    node:{g:Object.assign({},NODE_NAMES.g),p:Object.assign({},NODE_NAMES.p),c:Object.assign({},NODE_NAMES.c)},
    paramCount:Object.keys(PARAM_NAMES).length,
    custom:false
  };
}

function loadParamDict(text,dict){
  const doc=parseXml(text);
  const keys=new Set();
  kids(doc.documentElement,"stringpack").forEach(pack=>{
    const lang=(pack.getAttribute("LangName")||"").toLowerCase();
    const key=lang.indexOf("korea")>=0?"kr":(lang.indexOf("eng")>=0?"en":null);
    if(!key) return;
    kids(pack,"string").forEach(s=>{
      const pk=s.getAttribute("ParamKey"); if(!pk) return;
      dict.param[pk]=dict.param[pk]||{};
      dict.param[pk][key]=s.getAttribute("Text")||"";
      keys.add(pk);
    });
  });
  dict.custom=true;
  return keys.size;
}
function loadNodeDict(text,dict){
  const doc=parseXml(text), root=doc.documentElement;
  const map={gpnode:"g",pnode:"p",cnode:"c"};
  let n=0;
  elemChildren(root).forEach(grp=>{
    const bucket=map[tagName(grp).toLowerCase()];
    if(!bucket) return;
    kids(grp,"node").forEach(nd=>{
      const id=nd.getAttribute("ID"); if(id===null) return;
      dict.node[bucket][id]=nd.getAttribute("Name")||"";
      n++;
    });
  });
  dict.custom=true;
  return n;
}

/* ---------- InspectionSpec ---------- */
function parseInspectionSpec(text,label){
  const doc=parseXml(text), root=doc.documentElement;
  const rows=[], warnings=[];
  kids(root,"GPNODE").forEach(gp=>{
    const gpId=gp.getAttribute("ID")||"";
    kids(gp,"PNODE").forEach(pn=>{
      const pnId=pn.getAttribute("ID")||"", pnCheck=pn.getAttribute("NodeCheck");
      kids(pn,"CNODE").forEach(cn=>{
        const cnId=cn.getAttribute("ID")||"", cnCheck=cn.getAttribute("NodeCheck");
        elemChildren(cn).forEach(p=>{
          const kind=tagName(p);
          if(kind!=="MASTER"&&kind!=="SUBMASTER"&&kind!=="INSPECTION") return;
          const pk=p.getAttribute("ParamKey")||"";
          rows.push({
            file:label, side:sideOf(label), light:lightOf(label),
            gpId:gpId, pnId:pnId, cnId:cnId,
            pnCheck:pnCheck, cnCheck:cnCheck,
            kind:kind, specGroup:p.getAttribute("SpecGroup")||"",
            paramKey:pk, controlType:p.getAttribute("ControlType")||"",
            desc:p.getAttribute("Description")||"",
            v:kind==="INSPECTION"
              ?[p.getAttribute("ValR"),p.getAttribute("ValG"),p.getAttribute("ValB")]
              :[p.getAttribute("Val"),null,null],
            mn:kind==="INSPECTION"
              ?[p.getAttribute("MinValR"),p.getAttribute("MinValG"),p.getAttribute("MinValB")]
              :[p.getAttribute("MinVal"),null,null],
            mx:kind==="INSPECTION"
              ?[p.getAttribute("MaxValR"),p.getAttribute("MaxValG"),p.getAttribute("MaxValB")]
              :[p.getAttribute("MaxVal"),null,null]
          });
        });
      });
    });
  });
  if(!rows.length) warnings.push(label+" : no MASTER/SUBMASTER/INSPECTION parameters found");
  return {kind:"inspection",label:label,rows:rows,warnings:warnings};
}

/* ---------- LightSpec ---------- */
function parseLightSpec(text,label){
  const doc=parseXml(text), root=doc.documentElement;
  const rows=[], warnings=[];
  const setting=kids(root,"Light_Setting")[0]||root;
  kids(setting,"LightSet").forEach(ls=>{
    const setIdx=ls.getAttribute("Index")||"";
    const cam=ls.getAttribute("CameraType")||"";
    const pageCount=ls.getAttribute("PageCount")||"";
    const selPage=ls.getAttribute("SelectPage")||"";
    kids(ls,"Page").forEach(pg=>{
      const pgIdx=pg.getAttribute("Index")||"", chCount=pg.getAttribute("ChannelCount")||"";
      kids(pg,"Channel").forEach(ch=>{
        rows.push({
          file:label, camera:cam, setIdx:setIdx, setEnable:ls.getAttribute("Enable")||"",
          pageCount:pageCount, selPage:selPage,
          page:pgIdx, pageEnable:pg.getAttribute("Enable")||"", chCount:chCount,
          ch:ch.getAttribute("Index")||"", color:ch.getAttribute("Color")||"",
          angle:ch.getAttribute("Angle")||"", value:ch.getAttribute("Value")||"",
          chEnable:ch.getAttribute("Enable")||""
        });
      });
    });
  });
  if(!rows.length) warnings.push(label+" : no Light_Setting/LightSet channels found");
  return {kind:"light",label:label,rows:rows,warnings:warnings};
}

function sideOf(label){ const m=String(label).match(/(TOP|BOTTOM)/i); return m?m[1].toUpperCase():""; }
function lightOf(label){ const m=String(label).match(/LIGHT\s*_?(\d+)/i); return m?"LIGHT"+m[1]:""; }
/* the folder that holds the side, verbatim: "TOP", "BOTTOM" - or "TOP - 복사본"
   when the tree was copied. Lets a caller tell a real folder from a backup. */
function sideFolderOf(label){
  const parts=String(label).split(/[\\\/]/).filter(Boolean);
  return parts.find(p=>/^(TOP|BOTTOM)\b/i.test(p))||"";
}

/* ---------- dispatch ---------- */
/* Only the equipment file names, spelled exactly, are read. A dropped folder
   easily contains look-alikes ("InspectionSpec - 복사본.xml", Application.xml,
   SystemList.xml, UserList.csv) - those must not be parsed as spec files. */
const SPEC_FILE_NAMES={
  "lightspec.xml":"light",
  "inspectionspec.xml":"inspection",
  "specparameter.xml":"param",
  "spectreenode.xml":"tree",
  "spectreenodelist.xml":"treelist"
};
function basenameOf(name){
  return String(name===null||name===undefined?"":name).split(/[\\\/]/).pop().toLowerCase();
}
function classify(name){
  const base=basenameOf(name);
  if(/\.xls[xmb]?$/.test(base)) return "template";
  return SPEC_FILE_NAMES[base]||"other";
}
function parseAll(files,dict){
  const out={lights:[],inspects:[],warnings:[],unknownKeys:{},unknownNodes:{},
    paramOverride:null,treeOverride:null,skipped:[],templates:[]};
  files.forEach(f=>{
    const cls=classify(f.name||f.label);
    if(cls==="other"){ out.skipped.push(f.label); return; }
    if(cls==="template"){ out.templates.push(f.label); return; }
    let doc;
    try{ doc=parseXml(f.text); }catch(e){ out.warnings.push(f.label+" : parse failed - "+e.message); return; }
    try{
      if(cls==="param"){ const n=loadParamDict(f.text,dict); out.paramOverride={label:f.label,count:n}; }
      else if(cls==="tree"){ const n=loadNodeDict(f.text,dict); out.treeOverride={label:f.label,count:n}; }
      else if(cls==="treelist"){ /* node enable list, recorded only */ out.treeList=out.treeList||[]; out.treeList.push(f.label); }
      else if(cls==="light"){ const r=parseLightSpec(f.text,f.label); out.lights.push(r); out.warnings=out.warnings.concat(r.warnings); }
      else { const r=parseInspectionSpec(f.text,f.label); out.inspects.push(r); out.warnings=out.warnings.concat(r.warnings); }
    }catch(e){ out.warnings.push(f.label+" : parse failed - "+e.message); }
  });
  out.inspects.forEach(s=>s.rows.forEach(r=>{
    if(!dict.param[r.paramKey]) out.unknownKeys[r.paramKey]=(out.unknownKeys[r.paramKey]||0)+1;
    if(dict.node.c[r.cnId]===undefined) out.unknownNodes["C"+r.cnId]=(out.unknownNodes["C"+r.cnId]||0)+1;
    if(dict.node.p[r.pnId]===undefined) out.unknownNodes["P"+r.pnId]=(out.unknownNodes["P"+r.pnId]||0)+1;
    if(dict.node.g[r.gpId]===undefined) out.unknownNodes["G"+r.gpId]=(out.unknownNodes["G"+r.gpId]||0)+1;
  }));
  return out;
}
