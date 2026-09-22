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
    gv:{}, template:null, templateBytes:null, report:"",
    dirHandle:null, cfgTouched:{model:false,side:false,light:false}
  };
  const filesMeta={lights:[],inspects:[],others:[],tpl:null};

  /* Only the FIRST InspectionSpec is parsed (one file at a time). The others
     stay in the list so the user can see them / remove them to switch. */
  function usedInspects(){ return filesMeta.inspects.slice(0,1); }
  function usedRecs(){ return filesMeta.lights.concat(usedInspects(),filesMeta.others); }
  function allRecsList(){ return filesMeta.lights.concat(filesMeta.inspects,filesMeta.others); }
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
      if(withPath && allRecsList().some(r=>r.key===key)){ dup++; return; }
      let label=raw, i=2;
      while(allRecsList().some(r=>r.label===label)) label=raw+" ("+(i++)+")";
      bucket.push({name:f.name,label:label,key:key,text:null,file:f,size:f.size});
      added++;
    });
    syncConfigFromInsp();
    renderFiles(); refreshButtons();
    if(unknown.length) note("Ignored "+unknown.length+" non-target file(s) (e.g. AISpec / 3DSpec)");
    if(dup) note("Skipped "+dup+" duplicate file(s)");
    if(filesMeta.inspects.length>1) note("InspectionSpec: only the first file is used ("
      +usedInspects()[0].label+" ) — remove it from the list to switch to another one.");
  }
  /* The Side / Light / Model inputs are authoritative for the export name and the
     parameter sheet. Fill them from the first InspectionSpec label when it carries
     a folder; a value the user typed by hand is never overwritten. */
  function syncConfigFromInsp(){
    const rec=usedInspects()[0]; if(!rec) return;
    const dir=rec.label.indexOf("/")>=0?rec.label.slice(0,rec.label.lastIndexOf("/")):"";
    const parts=dir.split("/").filter(Boolean);
    const side=sideOf(rec.label), light=lightOf(rec.label);
    const si=parts.findIndex(p=>/^(TOP|BOTTOM)\b/i.test(p));
    const model=si>0?parts[si-1]:"";
    if(!state.cfgTouched.model&&model) $("cfgModel").value=model;
    if(!state.cfgTouched.side&&side) $("cfgSide").value=side==="BOTTOM"?"BTM":"TOP";
    if(!state.cfgTouched.light&&light) $("cfgLight").value=String(Number(String(light).replace(/\D/g,""))+1);
    updateLightRuleNote();
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
    const mkFiles=(recs,box,markFirst)=>{
      box.innerHTML="";
      recs.forEach((r,i)=>{
        const row=fileRow(r,()=>{ recs.splice(recs.indexOf(r),1); syncConfigFromInsp(); renderFiles(); refreshButtons(); },true);
        if(markFirst&&i===0){
          const tag=document.createElement("i");
          tag.className="used"; tag.textContent="used"; tag.title="only this InspectionSpec is parsed";
          row.querySelector("span").appendChild(tag);
        }else if(markFirst){
          const tag=document.createElement("i");
          tag.className="unused"; tag.textContent="ignored"; tag.title="only the first InspectionSpec is parsed";
          row.querySelector("span").appendChild(tag);
        }
        box.appendChild(row);
      });
      if(!recs.length) box.innerHTML='<div class="file" style="opacity:.5"><span>(empty)</span><span></span></div>';
    };
    mkFiles(filesMeta.lights,$("listLight"),false);
    mkFiles(filesMeta.inspects,$("listInsp"),true);
    const tplBox=$("listTpl");
    tplBox.innerHTML="";
    if(filesMeta.tpl){
      tplBox.appendChild(fileRow(filesMeta.tpl,()=>{ filesMeta.tpl=null; state.templateBytes=null; renderFiles(); refreshButtons(); },false));
    }else{
      tplBox.innerHTML='<div class="file" style="opacity:.55"><span>no template loaded — a template-shaped sheet will be generated instead</span><span></span></div>';
    }
    $("status").innerHTML="Selected: LightSpec <b>"+filesMeta.lights.length+"</b>, InspectionSpec <b>"
      +usedInspects().length+"</b>"+(filesMeta.inspects.length>1?" of "+filesMeta.inspects.length:"")
      +(filesMeta.others.length?", dict/other <b>"+filesMeta.others.length+"</b>":"")
      +(filesMeta.tpl?", template <b>"+filesMeta.tpl.name+"</b>":"")
      +" · dictionary: "+Object.keys(state.dict.param).length+" param keys.";
  }
  function note(msg){
    const s=$("status");
    s.innerHTML+=(s.innerHTML?"<br>":"")+'<span class="warn">'+msg+"</span>";
  }
  function refreshButtons(){
    const any=filesMeta.lights.length+usedInspects().length>0;
    $("btnParse").disabled=!any;
    const ready=!!state.built;
    ["btnLightXlsx","btnInspXlsx","btnRef","btnCsv"].forEach(id=>{ $(id).disabled=!ready; });
    $("btnLightXlsx").title=filesMeta.tpl
      ? "Fill "+filesMeta.tpl.name+" with the parsed values, then append the LightSpec listings"
      : "Generate a workbook in the Parameter_Template.xlsx layout (drop the real template to fill it instead)";
  }
  async function readXmlFiles(){
    for(const r of usedRecs()) if(r.text===null){ try{ r.text=await r.file.text(); }catch(e){ r.text=""; } }
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
      model:($("cfgModel").value||"").trim(),
      side:$("cfgSide").value,
      lightIndex:Number($("cfgLight").value)-1,
      basePath:($("cfgBase").value||"").trim(),
      gv:state.gv
    };
  }
  let search="";

  /* ---------- export name: <Model>_<SIDE>_LIGHT<n>_<kind>.xlsx ---------- */
  function exportName(kind){
    const model=(($("cfgModel").value||"").trim()||"Model").replace(/[\\\/:*?"<>|]/g,"-");
    const side=$("cfgSide").value||"TOP";
    const light=$("cfgLight").value||"1";
    return model+"_"+side+"_LIGHT"+light+"_"+kind+".xlsx";
  }
  /* live rule note next to the Light select: which areas the selected light keeps */
  function updateLightRuleNote(){
    const el=$("lightRuleNote"); if(!el) return;
    const rule=lightAreaRule(Number($("cfgLight").value)-1);
    el.textContent=rule?rule.note:"";
  }

  /* ---------- parse -> views -> render ---------- */
  async function parseAllFiles(){
    state.dict=makeDict();
    await readXmlFiles();
    const parsed=parseAll(usedRecs(),state.dict);
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
  /* Export config: Model Name / Side / Light. A value typed by hand is remembered
     so the auto-fill from the dropped file never overwrites it. Side and Light
     also drive the parameter sheet, so changing them rebuilds the views. */
  [["cfgModel","model"],["cfgSide","side"],["cfgLight","light"]].forEach(pair=>{
    const el=$(pair[0]);
    el.addEventListener("input",()=>{ state.cfgTouched[pair[1]]=true; if(pair[1]==="light") updateLightRuleNote(); });
    el.addEventListener("change",()=>{ state.cfgTouched[pair[1]]=true;
      if(pair[1]==="light") updateLightRuleNote(); if(state.parsed) rebuild(false); });
  });
  $("cfgBase").addEventListener("input",()=>{ state.dirHandle=null; });

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

  /* Base path = the export folder. A directory handle (Chrome's showDirectoryPicker)
     writes straight into it; the typed path alone is recorded and shown in the report. */
  async function saveOut(data,name,mime){
    const handle=state.dirHandle;
    if(handle){
      try{
        const fh=await handle.getFileHandle(name,{create:true});
        const w=await fh.createWritable(); await w.write(data); await w.close();
        return "dir";
      }catch(e){
        if(e&&e.name==="AbortError") return "cancel";
        note("could not write to the base path ("+Render.esc(e.message)+") — falling back to the save dialog");
      }
    }
    return save(data,name,mime);
  }
  function saveXlsx(data,name){ return saveOut(data,name,XLSX_MIME); }
  function savedLine(res){
    if(res==="dir") return "Saved to the base path folder";
    if(res==="saved") return "Saved to the chosen location";
    if(res==="cancel") return "Cancelled";
    return "Saved through the browser download; allow downloads if it was blocked";
  }

  async function withBusy(btn,label,fn){
    const old=btn.textContent; btn.disabled=true; btn.textContent=label;
    try{ await fn(); }
    catch(e){ $("status").innerHTML='<span class="err">'+Render.esc(e.message)+"</span>"; }
    finally{ btn.textContent=old; btn.disabled=false; }
  }

  $("btnParse").onclick=()=>withBusy($("btnParse"),"Parsing…",parseAllFiles);

  /* File 1: Light values + GV. With the real Parameter_Template.xlsx loaded we
     fill it (formatting kept) and append the LightSpec listings; otherwise a
     workbook in the same layout is generated. */
  $("btnLightXlsx").onclick=()=>withBusy($("btnLightXlsx"),"Building…",async()=>{
    const opts=readOpts();
    const sheets=state.built.paramSheets;
    if(!sheets.length) throw new Error("no InspectionSpec was parsed");
    const groups=exportGroups(state.built.analysis,sheets,Object.assign({},opts,{gv:state.gv}));
    const bytes=await readTemplate();
    const name=exportName("LightSpec");
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
      const out=await appendTablesToXlsx(filled.bytes,groups.light);
      result=await saveXlsx(out,name);
      report=Render.report({title:"LightSpec + GV workbook exported (filled template)",
        line:savedLine(result)+". "+filesMeta.tpl.name+" was filled from "+sheets.length+" sheet(s) and the "
          +groups.light.length+" LightSpec listing sheet(s) were appended.",
        sheets:rep.sheets,skipped:rep.skipped,notes:[
          "Light numbering used: "+(opts.lightOffset?"LIGHT n <-> 조명 (n+1)번":"LIGHT n <-> 조명 n번")
            +" (change it with the \"Template light numbering\" option if a sheet was filled from the wrong folder).",
          Object.keys(state.gv).length?"Typed GV values were written; other GV cells were blanked.":"GV cells were blanked - measure and fill them.",
          "The InspectionSpec listing and the comparison are in \""+exportName("InspectSpec")+"\"."
        ]});
    }else{
      const tables=groups.param.concat(groups.light);
      const out=await buildXlsx(tables);
      result=await saveXlsx(out,name);
      const stats=groups.param.map((t,i)=>({sheet:sheets[i].name,source:sheets[i].files.join(" | "),
        blocks:sheets[i].blocks.length,cells:countCells(sheets[i]),blanked:countBlank(sheets[i]),
        unresolved:[],notInTemplate:[],templateMissing:sheets[i].templateMissing,extras:sheets[i].extras,
        gvBlank:!Object.keys(state.gv).some(k=>k.indexOf(sheets[i].key+"|")===0)}));
      report=Render.report({title:"LightSpec + GV workbook exported (generated layout)",
        line:savedLine(result)+" — no Parameter_Template.xlsx was loaded, so a workbook with the same layout was "
          +"generated and the "+groups.light.length+" LightSpec listing sheet(s) appended. Drop the real template "
          +"onto the tool to fill it instead (keeps its formatting and merged cells).",
        sheets:stats,skipped:[],notes:[
          "Sheets: "+tables.map(t=>t.name).join(", "),
          "GV rows are blank: they are measured by hand and are not part of any config file.",
          "The 검출 불량 row is not filled: the defect text lives in the template only, not in the XML.",
          "The InspectionSpec listing and the comparison are in \""+exportName("InspectSpec")+"\"."
        ]});
    }
    state.report=report; renderBody();
    $("status").innerHTML='<span class="ok">LightSpec + GV exported</span> → <b>'+Render.esc(name)+"</b> ("+savedLine(result)+")";
  });

  /* File 2: the InspectionSpec listing + the multi-file comparison. */
  $("btnInspXlsx").onclick=()=>withBusy($("btnInspXlsx"),"Building…",async()=>{
    const opts=readOpts();
    const groups=exportGroups(state.built.analysis,state.built.paramSheets,Object.assign({},opts,{gv:state.gv}));
    if(!groups.inspect.length) throw new Error("nothing to export (no InspectionSpec rows were parsed)");
    const out=await buildXlsx(groups.inspect);
    const name=exportName("InspectSpec");
    const result=await saveXlsx(out,name);
    state.report=Render.report({title:"InspectionSpec workbook exported",
      line:savedLine(result)+". Sheets: "+groups.inspect.map(t=>t.name).join(", "),
      sheets:[],skipped:[],notes:["The Light values and the GV sheet are in \""+exportName("LightSpec")+"\"."]});
    renderBody();
    $("status").innerHTML='<span class="ok">InspectionSpec exported</span> → <b>'+Render.esc(name)+"</b> ("+savedLine(result)+")";
  });

  /* Optional reference export: Summary + the two dictionaries. */
  $("btnRef").onclick=()=>withBusy($("btnRef"),"Building…",async()=>{
    const opts=readOpts();
    const groups=exportGroups(state.built.analysis,state.built.paramSheets,Object.assign({},opts,{gv:state.gv}));
    if(!groups.reference.length) throw new Error("nothing to export");
    const out=await buildXlsx(groups.reference);
    const name=exportName("Reference");
    const result=await saveXlsx(out,name);
    state.report=Render.report({title:"Reference workbook exported (dictionaries)",
      line:savedLine(result)+". Sheets: "+groups.reference.map(t=>t.name).join(", "),
      sheets:[],skipped:[],notes:["Reference only — not part of the LightSpec / InspectionSpec pair."]});
    renderBody();
    $("status").innerHTML='<span class="ok">Reference exported</span> → <b>'+Render.esc(name)+"</b> ("+savedLine(result)+")";
  });

  $("btnCsv").onclick=async()=>{
    const view=state.views[state.active];
    if(!view) return;
    if(view.kind==="parameter-sheet"){
      const t=paramTables([view.sheet],readOpts())[0];
      await saveOut(toCsv({header:t.rows[0],rows:t.rows.slice(1)}),view.sheet.name+"_"+stamp()+".csv","text/csv");
    }else if(view.kind==="light"){
      await saveOut(toCsv(lightSheetTable(view.sheet,readOpts())),
        view.sheet.model+"_"+view.sheet.light+"_"+stamp()+".csv","text/csv");
    }else{
      await saveOut(toCsv(view),view.name+"_"+stamp()+".csv","text/csv");
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
  /* Base path: a real folder handle so exports are written there without a dialog. */
  $("pickBase").onclick=async()=>{
    if(!(typeof window!=="undefined"&&window.showDirectoryPicker&&window.isSecureContext)){
      note("this browser cannot open a folder picker — type the base path (it is recorded and shown in the report only)");
      return;
    }
    try{
      const h=await window.showDirectoryPicker({mode:"readwrite"});
      state.dirHandle=h;
      $("cfgBase").value=h.name;
    }catch(e){ /* cancelled */ }
  };
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

  updateLightRuleNote();
  renderFiles(); refreshButtons(); renderBody();
}

if(typeof document!=="undefined"&&document.getElementById){
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",initUI);
  else initUI();
}
