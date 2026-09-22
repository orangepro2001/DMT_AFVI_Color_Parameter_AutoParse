/* ============================================================
   8. App layer (browser only)
   ------------------------------------------------------------
   Owns state and the DOM. It never builds HTML itself - it asks the view
   layer (06) for strings and only:
     - intake:  drop / pick files, classify them, keep the template xlsx
     - options: read the option controls
     - parse:   files -> parsed model (02) -> views (07)
     - events:  delegated through data-* attributes (data-tab, data-gvkey)
     - export:  views -> xlsx / csv (05), with a report of manual work
   ============================================================ */
function initUI(){
  const $=id=>document.getElementById(id);
  const state={
    dict:makeDict(), parsed:null, built:null, views:[], active:0,
    gv:{}, template:null, templateBytes:null, report:""
  };
  const filesMeta={lights:[],inspects:[],others:[],tpl:null};

  /* ---------- intake ---------- */
  function allRecs(){ return filesMeta.lights.concat(filesMeta.inspects,filesMeta.others); }
  function addFiles(list){
    let added=0, dup=0, unknown=[];
    Array.from(list).forEach(f=>{
      const raw=f._label||f.webkitRelativePath||f._path||f.name;
      const cls=classify(raw);
      if(cls==="other"){ unknown.push(raw); return; }
      if(cls==="template"){
        filesMeta.tpl={name:f.name,label:raw,file:f,size:f.size,bytes:null};
        added++; return;
      }
      const bucket=cls==="light"?filesMeta.lights:(cls==="inspection"?filesMeta.inspects:filesMeta.others);
      const key=raw+"|"+f.name+"|"+f.size+"|"+(f.lastModified||0);
      const withPath=raw.indexOf("/")>=0;
      if(withPath && allRecs().some(r=>r.key===key)){ dup++; return; }
      let label=raw, i=2;
      while(allRecs().some(r=>r.label===label)) label=raw+" ("+(i++)+")";
      bucket.push({name:f.name,label:label,key:key,text:null,file:f,size:f.size});
      added++;
    });
    renderFiles(); refreshButtons();
    if(unknown.length) note("Ignored "+unknown.length+" non-target file(s) (e.g. AISpec / 3DSpec)");
    if(dup) note("Skipped "+dup+" duplicate file(s)");
  }
  function fileRow(rec,onRemove,rename){
    const d=document.createElement("div"); d.className="file";
    const noPath=rec.label.indexOf("/")<0;
    d.innerHTML='<span title="'+(rename?"Double-click to rename":"")+'"'+(rename?' style="cursor:text"':"")+'>'
      +rec.label.replace(/</g,"&lt;")
      +(noPath?' <i class="nopath" title="no folder in the label: Side/Light cannot be read">no path</i>':"")
      +'</span><span>'+(rec.size/1024).toFixed(1)+' KB<span class="rm">×</span></span>';
    d.querySelector(".rm").onclick=onRemove;
    if(rename) d.querySelector("span").ondblclick=()=>{
      const v=prompt("Rename (used in exports and comparison columns)",rec.label);
      if(v&&v.trim()){ rec.label=v.trim(); renderFiles(); }
    };
    return d;
  }
  function renderFiles(){
    const mkFiles=(recs,box)=>{
      box.innerHTML="";
      recs.forEach(r=>box.appendChild(fileRow(r,()=>{ recs.splice(recs.indexOf(r),1); renderFiles(); refreshButtons(); },true)));
      if(!recs.length) box.innerHTML='<div class="file" style="opacity:.5"><span>(empty)</span><span></span></div>';
    };
    mkFiles(filesMeta.lights,$("listLight"));
    mkFiles(filesMeta.inspects,$("listInsp"));
    const tplBox=$("listTpl");
    tplBox.innerHTML="";
    if(filesMeta.tpl){
      tplBox.appendChild(fileRow(filesMeta.tpl,()=>{ filesMeta.tpl=null; state.templateBytes=null; renderFiles(); refreshButtons(); },false));
    }else{
      tplBox.innerHTML='<div class="file" style="opacity:.55"><span>no template loaded — a template-shaped sheet will be generated instead</span><span></span></div>';
    }
    $("status").innerHTML="Selected: LightSpec <b>"+filesMeta.lights.length+"</b>, InspectionSpec <b>"
      +filesMeta.inspects.length+"</b>"+(filesMeta.others.length?", dict/other <b>"+filesMeta.others.length+"</b>":"")
      +(filesMeta.tpl?", template <b>"+filesMeta.tpl.name+"</b>":"")
      +" · dictionary: "+Object.keys(state.dict.param).length+" param keys.";
  }
  function note(msg){
    const s=$("status");
    s.innerHTML+=(s.innerHTML?"<br>":"")+'<span class="warn">'+msg+"</span>";
  }
  function refreshButtons(){
    const any=filesMeta.lights.length+filesMeta.inspects.length>0;
    $("btnParse").disabled=!any;
    const ready=!!state.built;
    $("btnExcel").disabled=!ready;
    $("btnParam").disabled=!ready;
    $("btnCsv").disabled=!ready;
    $("btnParam").title=filesMeta.tpl
      ? "Fill "+filesMeta.tpl.name+" with the parsed values"
      : "Generate a workbook in the Parameter_Template.xlsx layout (drop the real template to fill it instead)";
  }
  async function readXmlFiles(){
    for(const r of allRecs()) if(r.text===null){ try{ r.text=await r.file.text(); }catch(e){ r.text=""; } }
  }
  async function readTemplate(){
    if(!filesMeta.tpl) return null;
    if(!filesMeta.tpl.bytes){ filesMeta.tpl.bytes=await filesMeta.tpl.file.arrayBuffer(); }
    return filesMeta.tpl.bytes;
  }

  /* ---------- options ---------- */
  function readOpts(){
    return {
      nameMode:$("optName").value,
      digits:$("optDigits").value,
      keepZero:$("optZero").checked,
      diffOnly:$("optDiffOnly").checked,
      blankEmpty:$("optBlank").checked,
      lightOffset:Number($("optLightOff").value)||0,
      gv:state.gv
    };
  }
  let search="";

  /* ---------- parse -> views -> render ---------- */
  async function parseAllFiles(){
    state.dict=makeDict();
    await readXmlFiles();
    const parsed=parseAll(allRecs(),state.dict);
    state.parsed=parsed;
    rebuild(true);
    const stats=state.built.stats;
    const warn=parsed.warnings.length?'<span class="warn"> ('+parsed.warnings.length+" warning(s))</span>":"";
    $("status").innerHTML='<span class="ok">Parsed</span>: InspectionSpec '+parsed.inspects.length+" file(s) / "
      +stats.inspRows+" param rows, LightSpec "+parsed.lights.length+" file(s) / "+stats.lightRows+" channel rows, "
      +stats.diffCount+" comparison difference(s)"+warn
      +" · parameter sheets: "+(state.built.paramSheets.length||0);
    const noPath=parsed.inspects.filter(s=>!sideOf(s.label)||!lightOf(s.label)).length;
    if(noPath) note(noPath+" InspectionSpec file(s) have no folder in their label: the Side/Light columns and the "
      +"parameter sheets stay empty. Drop the whole INSPECT_SPEC folder, or double-click a file name and rename it "
      +"like \"TOP/LIGHT2\".");
    refreshButtons();
  }
  function rebuild(moveToFirst){
    const opts=readOpts();
    state.built=buildViews(state.parsed,state.dict,opts);
    state.views=state.built.views;
    if(moveToFirst) state.active=Math.min(state.active,Math.max(0,state.views.length-1));
    if(state.active>=state.views.length) state.active=Math.max(0,state.views.length-1);
    renderTabs(); renderBody();
  }
  function renderTabs(){
    $("tabs").innerHTML=Render.tabs(state.views,state.active);
  }
  function renderBody(){
    const view=state.views[state.active];
    const ctx={search:search,limit:800,gv:state.gv,gvEditable:true,digits:readOpts().digits};
    const box=$("tblbox");
    if(view&&(view.kind==="parameter-sheet"||view.kind==="light")){
      box.innerHTML=Render.body(view,ctx);
      $("legend").innerHTML=Render.legend(view,ctx,{});
    }else if(view){
      box.innerHTML='<div class="tbwrap">'+Render.body(view,ctx)+'</div>';
      const r=Render.table(view,ctx);
      $("legend").innerHTML=Render.legend(view,ctx,{total:r.total,limit:r.limit});
    }else{
      box.innerHTML='<div class="empty">Not parsed yet</div>';
      $("legend").textContent="";
    }
    $("report").innerHTML=state.report||"";
  }

  /* ---------- events ---------- */
  $("tabs").addEventListener("click",e=>{
    const t=e.target.closest(".tab"); if(!t) return;
    state.active=Number(t.dataset.tab); renderTabs(); renderBody();
  });
  $("tblbox").addEventListener("input",e=>{
    const el=e.target;
    if(!el.classList||!el.classList.contains("gv")) return;
    const key=el.dataset.gvkey, ch=el.dataset.ch;
    if(!state.gv[key]) state.gv[key]={};
    state.gv[key][ch]=el.value;
  });
  $("search").addEventListener("input",e=>{ search=e.target.value; renderBody(); });
  ["optName","optDigits","optZero","optDiffOnly","optBlank","optLightOff"].forEach(id=>{
    $(id).addEventListener("change",()=>{ if(state.parsed) rebuild(false); });
  });

  /* ---------- export ---------- */
  function stamp(){
    const d=new Date(),p=n=>String(n).padStart(2,"0");
    return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+"_"+p(d.getHours())+p(d.getMinutes());
  }
  function download(data,name,mime){
    const blob=new Blob([data],{type:mime});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=name;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500);
    return "download";
  }
  /* native "save as" dialog first, browser download as fallback */
  async function save(data,name,mime){
    if(typeof window!=="undefined"&&window.showSaveFilePicker&&window.isSecureContext){
      const ext=(name.split(".").pop()||"bin").toLowerCase();
      try{
        const h=await window.showSaveFilePicker({suggestedName:name,
          types:[{description:ext.toUpperCase()+" file",accept:{[mime]:["."+ext]}}]});
        const w=await h.createWritable(); await w.write(data); await w.close();
        return "saved";
      }catch(e){ if(e&&e.name==="AbortError") return "cancel"; }
    }
    return download(data,name,mime);
  }
  const XLSX_MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  async function withBusy(btn,label,fn){
    const old=btn.textContent; btn.disabled=true; btn.textContent=label;
    try{ await fn(); }
    catch(e){ $("status").innerHTML='<span class="err">'+Render.esc(e.message)+"</span>"; }
    finally{ btn.textContent=old; btn.disabled=false; }
  }

  $("btnParse").onclick=()=>withBusy($("btnParse"),"Parsing…",parseAllFiles);

  $("btnExcel").onclick=()=>withBusy($("btnExcel"),"Building…",async()=>{
    const tables=state.built.analysis.tables;
    const bytes=await buildXlsx(tables);
    const res=await save(bytes,"SpecExport_"+stamp()+".xlsx",XLSX_MIME);
    state.report=Render.report({title:"Analysis workbook exported",
      line:(res==="download"?"Saved through the browser download; allow downloads if it was blocked.":"Saved to the chosen location.")
        +" Sheets: "+tables.map(t=>t.name).join(", "),
      sheets:[],skipped:[],notes:["The parameter-sheet layout is exported by \"Export Parameter Sheet\"."]});
    renderBody();
  });

  $("btnParam").onclick=()=>withBusy($("btnParam"),"Building…",async()=>{
    const opts=readOpts();
    const sheets=state.built.paramSheets;
    if(!sheets.length) throw new Error("no InspectionSpec with a side/light folder was loaded");
    const bytes=await readTemplate();
    let result, report;
    if(bytes){
      const filled=await fillTemplateXlsx(bytes,sheets,Object.assign({},opts,{dictIndex:state.built.dictIndex}));
      const rep=filled.report;
      rep.sheets.forEach(s=>{
        const m=sheets.find(x=>x.name===s.target);
        if(!m) return;
        s.templateMissing=m.templateMissing; s.extras=m.extras;
        s.gvBlank=!Object.keys(state.gv).some(k=>k.indexOf(s.target+"|")===0);
      });
      rep.skipped.forEach(s=>{
        if(/조명\s*1\s*번|DMG/i.test(s.sheet)) s.reason="this sheet covers the DMG light of both sides - the loaded files do not identify a DMG light set, so map it by hand";
      });
      result=await save(filled.bytes,filesMeta.tpl.name.replace(/\.xlsx$/i,"")+"_filled_"+stamp()+".xlsx",XLSX_MIME);
      report=Render.report({title:"Parameter template filled",
        line:(result==="download"?"Saved through the browser download.":"Saved to the chosen location.")
          +" Filled from "+sheets.length+" side/light sheet(s); every other cell of the template is untouched.",
        sheets:rep.sheets,skipped:rep.skipped,notes:[
          "Light numbering used: "+(opts.lightOffset?"LIGHT n <-> 조명 (n+1)번":"LIGHT n <-> 조명 n번")
            +" (change it with the \"Template light numbering\" option if a sheet was filled from the wrong folder).",
          Object.keys(state.gv).length?"Typed GV values were written; other GV cells were blanked.":"GV cells were blanked - measure and fill them.",
          "The analysis sheets (InspectionSpec / LightSpec / Comparison) come from \"Export Excel (analysis)\"."
        ]});
    }else{
      const tables=paramTables(sheets,Object.assign({},opts,{gv:state.gv}));
      const out=await buildXlsx(tables);
      result=await save(out,"ParameterSheet_"+stamp()+".xlsx",XLSX_MIME);
      const stats=tables.map((t,i)=>({sheet:sheets[i].name,source:sheets[i].files.join(" | "),
        blocks:sheets[i].blocks.length,cells:countCells(sheets[i]),blanked:countBlank(sheets[i]),
        unresolved:[],notInTemplate:[],templateMissing:sheets[i].templateMissing,extras:sheets[i].extras,
        gvBlank:!Object.keys(state.gv).some(k=>k.indexOf(sheets[i].key+"|")===0)}));
      report=Render.report({title:"Parameter sheet generated (template layout)",
        line:(result==="download"?"Saved through the browser download.":"Saved to the chosen location.")
          +" No Parameter_Template.xlsx was loaded, so a workbook with the same layout was generated. "
          +"Drop the real template onto the tool to fill it instead (keeps its formatting and merged cells).",
        sheets:stats,skipped:[],notes:[
          "GV rows are blank: they are measured by hand and are not part of any config file.",
          "The 검출 불량 row is not filled: the defect text lives in the template only, not in the XML."]});
    }
    state.report=report; renderBody();
    $("status").innerHTML='<span class="ok">Parameter sheet exported</span> ('+sheets.length+" sheet(s)) — see the report below the preview.";
  });

  $("btnCsv").onclick=async()=>{
    const view=state.views[state.active];
    if(!view) return;
    if(view.kind==="parameter-sheet"){
      const t=paramTables([view.sheet],readOpts())[0];
      await save(toCsv({header:t.rows[0],rows:t.rows.slice(1)}),view.sheet.name+"_"+stamp()+".csv","text/csv");
    }else if(view.kind==="light"){
      await save(toCsv(lightSheetTable(view.sheet,readOpts())),view.sheet.model+"_light_"+stamp()+".csv","text/csv");
    }else{
      await save(toCsv(view),view.name+"_"+stamp()+".csv","text/csv");
    }
  };

  function countCells(sheet){
    let n=0;
    sheet.blocks.forEach(b=>b.params.forEach(p=>{ if(p.r!==""&&p.r!==undefined) n++; }));
    return n;
  }
  function countBlank(sheet){
    let n=0;
    sheet.blocks.forEach(b=>b.params.forEach(p=>{ if(p.r===""||p.r===undefined) n++; }));
    return n;
  }

  /* ---------- clear ---------- */
  $("btnClear").onclick=()=>{
    filesMeta.lights=[]; filesMeta.inspects=[]; filesMeta.others=[]; filesMeta.tpl=null;
    state.parsed=null; state.built=null; state.views=[]; state.active=0; state.gv={}; state.report="";
    state.dict=makeDict();
    renderFiles(); refreshButtons(); renderTabs(); renderBody();
    $("status").innerHTML="Waiting for files… (dictionaries: built-in SpecParameter / SpecTreeNode)";
  };

  /* ---------- theme (light by default, dark optional, remembered) ---------- */
  const THEME_KEY="specParamTool.theme";
  function applyTheme(theme,btn){
    document.documentElement.setAttribute("data-theme",theme);
    if(btn) btn.textContent="Theme: "+(theme==="dark"?"Dark":"Light");
    try{ localStorage.setItem(THEME_KEY,theme); }catch(e){ /* file:// may block storage */ }
  }
  (function initTheme(){
    const btn=$("btnTheme");
    let theme="light";
    try{ const saved=localStorage.getItem(THEME_KEY); if(saved==="dark"||saved==="light") theme=saved; }catch(e){}
    applyTheme(theme,btn);
    btn.onclick=()=>applyTheme(document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark",btn);
  })();

  /* ---------- file pickers + drag & drop ---------- */
  $("pickLight").onclick=e=>{ e.stopPropagation(); $("fileLight").click(); };
  $("pickInsp").onclick=e=>{ e.stopPropagation(); $("fileInsp").click(); };
  $("pickTpl").onclick=e=>{ e.stopPropagation(); $("fileTpl").click(); };
  $("pickDir").onclick=()=>$("fileDir").click();
  $("fileLight").onchange=e=>{ addFiles(e.target.files); e.target.value=""; };
  $("fileInsp").onchange=e=>{ addFiles(e.target.files); e.target.value=""; };
  $("fileTpl").onchange=e=>{ addFiles(e.target.files); e.target.value=""; };
  $("fileDir").onchange=e=>{ addFiles(e.target.files); e.target.value=""; };

  function zone(el,hotClass){
    el.addEventListener("dragover",e=>{ e.preventDefault(); el.classList.add(hotClass||"hot"); });
    el.addEventListener("dragleave",()=>el.classList.remove(hotClass||"hot"));
    el.addEventListener("drop",async e=>{
      e.preventDefault(); e.stopPropagation(); el.classList.remove(hotClass||"hot");
      addFiles(await fromDataTransfer(e.dataTransfer));
    });
  }
  zone($("dropLight")); zone($("dropInsp")); zone($("dropTpl")); zone(document.body);

  async function fromDataTransfer(dt){
    const out=[];
    const items=dt.items?Array.from(dt.items):[];
    const entries=items.map(i=>i.webkitGetAsEntry&&i.webkitGetAsEntry()).filter(Boolean);
    if(!entries.length) return Array.from(dt.files||[]);
    const walk=async(entry,prefix)=>{
      if(entry.isFile){
        const f=await new Promise((res,rej)=>entry.file(res,rej));
        f._label=prefix+entry.name; out.push(f);
      }else if(entry.isDirectory){
        const rd=entry.createReader();
        const read=()=>new Promise((res,rej)=>rd.readEntries(res,rej));
        let batch;
        do{ batch=await read(); for(const en of batch) await walk(en,prefix+entry.name+"/"); }while(batch.length);
      }
    };
    for(const en of entries) await walk(en,"");
    return out;
  }

  renderFiles(); refreshButtons(); renderBody();
}

if(typeof document!=="undefined"&&document.getElementById){
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",initUI);
  else initUI();
}
