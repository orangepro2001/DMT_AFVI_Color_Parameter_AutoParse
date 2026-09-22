/* ============================================================
   6. View layer (display)
   ------------------------------------------------------------
   Everything the user sees goes through this module. The rule is:
   renderers are PURE - they take a view model + a context object and
   return an HTML string. They never read application state, never
   touch the DOM, never attach listeners.

     parse (02)            -> parsed model
     model (03, 04)        -> view models            <-- the only thing shown
     render (06)           -> HTML string
     app (08)              -> puts the string in the DOM, delegates events
                              through data-* attributes, calls the exporters

   Two kinds of view models exist:

   1) table view            { kind:"table", name, header:[], rows:[[]], cols:[] }
      Round-trip listings of the source files (InspectionSpec / LightSpec /
      Comparison / dictionaries). Rendered by `table()`, filtering + row limit
      applied here so preview and export stay in sync.

   2) parameter sheet view  { kind:"parameter-sheet", name, sheet: <param sheet> }
      The "needed parameters" view built in 04: the Parameter_Template.xlsx
      layout (채널 / 조명 축 / GV 밝기 / 영역 / 검출 불량 / 파라미터 × RED,GREEN,BLUE).
      Rendered by `parameterSheet()`; GV cells are editable inputs keyed by
      data-gvkey so the app layer can collect them (they are user-measured and
      never present in the XML).

   Context: { search, limit, gv:{ "TOP|LIGHT2|AU":{R,G,B} }, gvEditable }
   ============================================================ */

const Render=(function(){
  const ESCMAP={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"};
  function esc(s){ return String(s===null||s===undefined?"":s).replace(/[&<>"]/g,c=>ESCMAP[c]); }
  function val(c){
    if(c===null||c===undefined||c==="") return '<span class="nil">–</span>';
    if(typeof c==="number") return esc(c);
    return esc(c);
  }
  function hit(row,header,q){
    if(!q) return true;
    if(!Array.isArray(row)) return String(row).toLowerCase().indexOf(q)>=0;
    for(let i=0;i<row.length;i++) if(String(row[i]===undefined?"":row[i]).toLowerCase().indexOf(q)>=0) return true;
    return false;
  }

  /* ---------- 1) table view ---------- */
  function table(view,ctx){
    const q=(ctx.search||"").trim().toLowerCase();
    let rows=view.rows||[];
    if(q) rows=rows.filter(r=>hit(r,view.header,q));
    const limit=ctx.limit||800, shown=rows.slice(0,limit);
    const ciDiff=view.header?view.header.indexOf("Consistent"):-1;
    let html='<table>';
    if(view.header) html+="<tr>"+view.header.map(h=>"<th>"+esc(h)+"</th>").join("")+"</tr>";
    shown.forEach(r=>{
      const diff=ciDiff>=0&&String(r[ciDiff])==="Diff";
      html+="<tr"+(diff?' class="rowdiff"':"")+">"+r.map(c=>{
        const num=typeof c==="number";
        const isDiffCell=typeof c==="string"&&(c==="Diff");
        return "<td"+(num?' class="num"':(isDiffCell?' class="diff"':""))+'>'+val(c)+"</td>";
      }).join("")+"</tr>";
    });
    html+="</table>";
    return {html:html,shown:shown.length,total:rows.length,limit:limit};
  }

  /* ---------- 2) parameter sheet view ---------- */
  const STATE_INFO={
    ok:{cls:"ok",    tag:"XML",  tip:"read from this file: INSPECTION ValR / ValG / ValB"},
    master:{cls:"alt",tag:"M",  tip:"the node stores this as MASTER / SUBMASTER (single value) - shown in the RED column"},
    missing:{cls:"miss",tag:"-",tip:"this ParamKey is not present at this node in the loaded file"},
    unmapped:{cls:"tbd",tag:"?",tip:"template family C: the ParamKey behind this label is not confirmed yet (see PARAMETER_TEMPLATE_NOTES.md)"}
  };
  function badge(p){
    const i=STATE_INFO[p.state]||STATE_INFO.missing;
    const key=p.key?("ParamKey "+p.key):"no ParamKey yet";
    return '<span class="bdg '+i.cls+'" title="'+esc(key+" · "+i.tip)+'">'+i.tag+'</span>';
  }
  function numCell(x){
    if(x===""||x===null||x===undefined) return '<td class="pv nil">–</td>';
    return '<td class="pv">'+esc(x)+'</td>';
  }
  /* 조명 축 cell: one group per LED colour, channel number kept (1-based, as the equipment) */
  function axisCell(cam,axis,ctx){
    const groups=axis&&axis.cols?axis.cols[cam]:null;
    const cls="ax "+cam.toLowerCase();
    if(!groups||!groups.length) return '<td colspan="2" class="'+cls+'">'+val(axis?axis[cam]:"")+'</td>';
    const inner=groups.map(g=>'<span class="ag"><i class="c'+esc(g.color)+'">'+esc(g.color)+'</i>'
      +g.items.map(i=>'<span class="ach" title="'+esc("Channel "+channelNo(i.ch)+" (XML @Index "+i.ch+") · value "+i.value+" · angle "+i.angle+"°")+'">'
        +esc(channelName(i.ch))+' <b>'+esc(num(i.value,ctx.digits))+'</b><span class="ao">('+esc(i.angle)+'°)</span></span>').join(" ")
      +'</span>').join(" ");
    return '<td colspan="2" class="'+cls+'">'+inner+'</td>';
  }
  function gvInput(key,ch,gv,pair){    const v=(gv&&gv[ch]!==undefined&&gv[ch]!=="")?esc(gv[ch]):"";
    return '<td class="pgv"><input class="gv" inputmode="decimal" data-gvkey="'+esc(key)+'" data-ch="'+ch+'"'
      +' value="'+v+'" placeholder="'+esc(pair)+'" title="measured GV for '+esc(pair)+'"></td>';
  }
  function parameterSheet(sheet,ctx){
    const q=(ctx.search||"").trim().toLowerCase();
    const gv=(ctx.gv&&ctx.gv)||{};
    const key=sheet.key;
    const matchArea=b=>!q||nrm(b.area).indexOf(q)>=0||String(b.family).toLowerCase()===q
      ||b.params.some(p=>nrm(p.label).indexOf(q)>=0||String(p.key||"").indexOf(q)>=0);
    const blocks=(sheet.blocks||[]).filter(matchArea);
    const visible=blocks.filter(b=>!q||nrm(b.area).indexOf(q)>=0
      ||b.params.some(p=>nrm(p.label).indexOf(q)>=0||String(p.key||"").indexOf(q)>=0
        ||String(p.r).indexOf(q)>=0||String(p.g).indexOf(q)>=0||String(p.b).indexOf(q)>=0));

    let html='<div class="ps">';
    html+='<div class="ps-head"><b>'+esc(sheet.name)+'</b>'
      +'<span class="ps-src">'+esc((sheet.files||[]).join(" | "))+'</span>'
      +'<span class="ps-note">'+esc((sheet.axis&&sheet.axis.note)||"")+'</span></div>';

    html+='<table class="pstbl"><colgroup><col class="cA"><col class="cB"><col class="cC"><col class="cB"><col class="cC"><col class="cB"><col class="cC"></colgroup><tbody>';
    html+='<tr class="hdr"><th>채널</th><th class="r">RED</th><th class="r"></th><th class="g">GREEN</th><th class="g"></th><th class="b">BLUE</th><th class="b"></th></tr>';
    html+='<tr><th>조명 축</th>'+axisCell("R",sheet.axis,ctx)+axisCell("G",sheet.axis,ctx)+axisCell("B",sheet.axis,ctx)+'</tr>';
    (sheet.gvClasses||[]).forEach((cls,i)=>{
      html+='<tr class="gvrow">'+(i===0?'<th rowspan="'+sheet.gvClasses.length+'">GV 밝기</th>':"")
        +'<td class="pcls">'+esc(cls)+'</td>'+gvInput(key,"R",gv[key+"|"+cls],cls+" / RED")
        +'<td class="pcls">'+esc(cls)+'</td>'+gvInput(key,"G",gv[key+"|"+cls],cls+" / GREEN")
        +'<td class="pcls">'+esc(cls)+'</td>'+gvInput(key,"B",gv[key+"|"+cls],cls+" / BLUE")+'</tr>';
    });
    visible.forEach(b=>{
      const stats=paramsStats(b);
      html+='<tr class="arearow"><th>영역</th><td colspan="6">'+esc(b.area)
        +' <span class="fam">family '+esc(b.family)+' · '+esc(b.familyInfo)+'</span>'
        +' <span class="nodepath" title="node path">G'+esc(b.g)+' ▸ P'+esc(b.p)+' ▸ C'+esc(b.c)
        +(b.pnCheck!==null&&b.pnCheck!==undefined?' · NodeCheck '+esc(b.pnCheck)+'/'+esc(b.cnCheck):"")+'</span>'
        +(stats.missing?' <span class="warnmini">'+stats.missing+' param(s) missing in XML</span>':"")
        +(stats.unmapped?' <span class="warnmini">'+stats.unmapped+' unconfirmed key(s)</span>':"")
        +'</td></tr>';
      html+='<tr class="defrow"><th>검출 불량</th><td colspan="2"></td><td colspan="2"></td><td colspan="2"></td></tr>';
      b.params.forEach((p,i)=>{
        const shown=q?true:true;
        html+='<tr class="'+(p.state==="missing"||p.state==="unmapped"?"odd":"")+'">'
          +(i===0?'<th>파라미터</th>':"<td></td>")
          +'<td class="pn">'+badge(p)+esc(p.label)+(p.key?'':' <span class="nokey">no key</span>')+'</td>'
          +numCell(p.r)
          +'<td class="pn">'+esc(p.label)+'</td>'+numCell(p.g)
          +'<td class="pn">'+esc(p.label)+'</td>'+numCell(p.b)+'</tr>';
      });
    });
    html+='</tbody></table>';
    if(!visible.length) html+='<div class="empty">no area or parameter matches the filter</div>';

    const tot=allParams(sheet);
    html+='<div class="ps-foot">'
      +'<span class="pill">'+visible.length+'/'+(sheet.blocks||[]).length+' areas shown</span>'
      +'<span class="pill">'+tot.total+' parameter rows</span>'
      +'<span class="pill ok">'+tot.ok+' from XML</span>'
      +(tot.master?'<span class="pill alt">'+tot.master+' single value (MASTER)</span>':"")
      +(tot.missing?'<span class="pill miss">'+tot.missing+' missing in XML</span>':"")
      +(tot.unmapped?'<span class="pill tbd">'+tot.unmapped+' unconfirmed key</span>':"")
      +'</div>';
    if((sheet.notes||[]).length)
      html+='<div class="ps-notes">'+sheet.notes.map(n=>"• "+esc(n)).join("<br>")+'</div>';
    if((sheet.templateMissing||[]).length)
      html+='<details class="ps-extra"><summary>'+sheet.templateMissing.length
        +' template area(s) have no data in these files (left out)</summary><div>'
        +sheet.templateMissing.map(a=>"<code>"+esc(a)+"</code>").join(" ")+'</div></details>';
    if((sheet.extras||[]).length)
      html+='<details class="ps-extra"><summary>'+sheet.extras.length
        +' node(s) exist in the XML but are NOT covered by the parameter template (candidate template additions)</summary><div>'
        +sheet.extras.map(x=>"<div><code>"+esc(x.path)+"</code> — "+x.count+" param(s): "+esc(x.keys)+"</div>").join("")
        +'</div></details>';
    html+='</div>';
    return {html:html,shown:visible.length,total:(sheet.blocks||[]).length,limit:0};
  }
  function paramsStats(b){
    let ok=0,master=0,missing=0,unmapped=0;
    b.params.forEach(p=>{
      if(p.state==="ok") ok++; else if(p.state==="master") master++;
      else if(p.state==="unmapped") unmapped++; else missing++;
    });
    return {ok:ok,master:master,missing:missing,unmapped:unmapped,total:b.params.length};
  }
  function allParams(sheet){
    const t={ok:0,master:0,missing:0,unmapped:0,total:0};
    (sheet.blocks||[]).forEach(b=>{
      const s=paramsStats(b);
      t.ok+=s.ok; t.master+=s.master; t.missing+=s.missing; t.unmapped+=s.unmapped; t.total+=s.total;
    });
    return t;
  }

  /* ---------- 3) light view: channels grouped by LED colour ---------- */
  function chip(item,ctx){
    const on=item.chEnable==="1";
    const tip="Channel "+channelNo(item.ch)+" (XML @Index "+item.ch+") · "
      +(CHANNEL_COLORS[item.color]||item.color)+" · value "+item.value
      +" · angle "+item.angle+"° · "+(on?"on":"off");
    return '<span class="chip'+(on?"":" off")+'" title="'+esc(tip)+'">'
      +'<b>'+esc(channelName(item.ch))+'</b>'
      +'<span class="cv">'+esc(num(item.value,ctx.digits))+'</span>'
      +'<span class="ca">'+esc(item.angle)+'°</span></span>';
  }
  function groupRow(g,ctx){
    return '<div class="grp"><div class="grp-lbl">'
      +'<span class="dot c'+esc(g.color)+'"></span>'+esc(g.name)+' <em>'+g.items.length+'</em></div>'
      +'<div class="chips">'+g.items.map(i=>chip(i,ctx)).join("")+'</div></div>';
  }
  function lightView(sheet,ctx){
    const q=(ctx.search||"").trim().toLowerCase();
    const keep=g=>!q||nrm(g.name).indexOf(q)>=0||nrm(g.color).indexOf(q)>=0
      ||g.items.some(i=>String(i.ch).indexOf(q)>=0||String(i.value).indexOf(q)>=0||String(i.angle).indexOf(q)>=0);
    let html='<div class="lv"><div class="lv-head"><b>'+esc(sheet.name)+'</b>'
      +'<span class="lv-file">'+esc(sheet.file)+' · '+sheet.totalChannels+' channels</span></div>';
    const sets=(sheet.sets||[]).map(s=>Object.assign({},s,{
      pages:(s.pages||[]).map(p=>Object.assign({},p,{groups:(p.groups||[]).filter(keep)})).filter(p=>p.groups.length)
    })).filter(s=>s.pages.length);
    sets.forEach(s=>{
      html+='<div class="lv-set"><div class="lv-set-h">LightSet '+esc(s.setIdx)
        +'<span>'+esc(CAMERA_TYPES[s.camera]!==undefined?CAMERA_TYPES[s.camera]:(s.camera||""))+'</span>'
        +'<span>pages '+esc(s.pageCount)+'</span><span>selected page '+esc(s.selPage)+'</span>'
        +'<span>'+(String(s.enable)==="1"?"set enabled":"set disabled")+'</span></div>';
      s.pages.forEach(p=>{
        html+='<div class="lv-page"><div class="lv-page-h">Page '+esc(p.page)
          +' — '+p.on+' / '+esc(p.count)+' channels on · '+p.colors+' colour group(s)'
          +(String(p.enable)==="1"?"":" · page disabled")+'</div>';
        p.groups.forEach(g=>{ html+=groupRow(g,ctx); });
        html+='</div>';
      });
      html+='</div>';
    });
    if(!sets.length) html+='<div class="empty">no light channel matches the filter</div>';
    html+='<div class="lv-note">'+esc(sheet.note||"")+'</div></div>';
    return {html:html,shown:sets.length,total:(sheet.sets||[]).length,limit:0};
  }

  /* ---------- dispatch ---------- */
  function body(view,ctx){
    if(!view) return '<div class="empty">Not parsed yet</div>';
    if(view.kind==="parameter-sheet") return parameterSheet(view.sheet,ctx).html;
    if(view.kind==="light") return lightView(view.sheet,ctx).html;
    return table(view,ctx).html;
  }

  /* ---------- tab strip: the views are what the user navigates ---------- */
  function tabs(views,active){
    return (views||[]).map((v,i)=>{
      const kind=v.kind==="parameter-sheet"?"ps":(v.kind==="light"?"lv":"tb");
      const cnt=v.kind==="parameter-sheet"?(v.sheet.blocks||[]).length+" areas"
        :(v.kind==="light"?(v.sheet.sets||[]).length+" sets":(v.rows||[]).length);
      return '<div class="tab '+(i===active?"active":"")+' k-'+kind+'" data-tab="'+i+'">'
        +'<b>'+esc(v.label||v.name)+'</b><span class="cnt">'+cnt+'</span></div>';
    }).join("");
  }
  function legend(view,ctx,info){
    if(!view) return "";
    if(view.kind==="parameter-sheet"){
      const s=view.sheet;
      return 'Parameter sheet <b>'+esc(s.name)+'</b> in the layout of <code>Parameter_Template.xlsx</code>'
        +' — values are read from <code>InspectionSpec.xml</code>, the <b>GV row stays for manual measurement</b>'
        +' (type it here and it will be written on export).';
    }
    if(view.kind==="light"){
      return 'Light channels of <b>'+esc(view.sheet.file)+'</b>, grouped by LED colour — the channel '
        +'number follows the equipment (1-based, CH1…CH'+esc(channelNo(19))+'); '
        +'<code>LightSpec @Index</code> is 0-based, so CH1 = @Index 0 (hover a chip for the raw index). '
        +'Dimmed chips are disabled channels.';
    }
    let x='Sheet <b>'+esc(view.name)+'</b> — '+info.total+' row(s)';
    if(info.total>info.limit) x+=' (showing first '+info.limit+', the export contains all)';
    if(view.diffCount!==undefined) x+=' · '+view.diffCount+' difference(s)';
    x+=' · '+((view.header||[]).length)+' column(s)';
    return x;
  }

  /* ---------- export report: what was written and what needs manual work ---------- */
  function report(info){
    if(!info) return "";
    const parts=[];
    parts.push('<div class="rep"><div class="rep-h">'+esc(info.title||"Export")+'</div>');
    parts.push('<div class="rep-line">'+esc(info.line||"")+'</div>');
    if((info.sheets||[]).length){
      parts.push('<table class="reptbl"><tr><th>Sheet</th><th>Source</th><th>Areas</th><th>Cells written</th><th>Blanked</th><th>Unresolved rows</th></tr>');
      info.sheets.forEach(s=>parts.push('<tr><td>'+esc(s.sheet)+'</td><td class="dim">'+esc(s.source||"")+'</td>'
        +'<td class="num">'+s.blocks+'</td><td class="num">'+s.cells+'</td><td class="num">'+s.blanked+'</td>'
        +'<td class="num'+(s.unresolved&&s.unresolved.length?" warn":"")+'">'+((s.unresolved||[]).length)+'</td></tr>'));
      parts.push('</table>');
    }
    const manual=[];
    (info.skipped||[]).forEach(s=>manual.push('sheet <code>'+esc(s.sheet)+'</code> was not filled — '+esc(s.reason)));
    (info.sheets||[]).forEach(s=>{
      if(s.ambiguous&&s.ambiguous.length) manual.push('several loaded folders match <code>'+esc(s.sheet)
        +'</code> ('+esc(s.ambiguous.join(" / "))+') — only <b>'+esc(s.source.split(" | ")[0])+'</b> was written');
      (s.unresolved||[]).forEach(u=>manual.push('row not matched in <code>'+esc(s.sheet)+'</code>: '+esc(u)));
      (s.notInTemplate||[]).forEach(a=>manual.push('area <code>'+esc(a)+'</code> has data in the XML but no block in this template sheet'));
      (s.templateMissing||[]).forEach(a=>manual.push('template area <code>'+esc(a)+'</code> has no data in the loaded files'));
      (s.extras||[]).forEach(e=>manual.push('node <code>'+esc(e.path)+'</code> is not covered by the template ('+e.count+' params)'));
      if(s.gvBlank) manual.push('GV cells in <code>'+esc(s.sheet)+'</code> are blank — fill them after measuring');
    });
    (info.notes||[]).forEach(n=>manual.push(esc(n)));
    if(manual.length){
      parts.push('<div class="rep-h2">Manual work / template changes to review ('+manual.length+')</div>');
      parts.push('<ul class="rep-list">'+manual.map(m=>"<li>"+m+"</li>").join("")+'</ul>');
    }else{
      parts.push('<div class="rep-line ok">Nothing left to fix automatically flagged.</div>');
    }
    parts.push('</div>');
    return parts.join("");
  }

  return {esc:esc,val:val,table:table,parameterSheet:parameterSheet,body:body,tabs:tabs,
    legend:legend,report:report,paramsStats:paramsStats};
})();
