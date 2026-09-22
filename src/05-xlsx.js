/* ============================================================
   5. Excel I/O: xlsx writer, zip reader, template filling
   No external library: raw ZIP (store/deflate) + CRC32 + sheet XML.
   - buildXlsx(tables)      : write a workbook from view models
   - fillTemplateXlsx(bytes): open Parameter_Template.xlsx, patch only the
                              value cells, leave every other part untouched
   Both paths report what could not be filled, so the app layer can tell
   the user exactly which cells need manual attention.
   ============================================================ */

const CRC_TABLE=(function(){const t=new Uint32Array(256);
  for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c>>>0;}
  return t;})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC_TABLE[(c^u8[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function strU8(s){
  if(typeof TextEncoder!=="undefined") return new TextEncoder().encode(s);
  const b=Buffer.from(s,"utf8"); return new Uint8Array(b.buffer,b.byteOffset,b.length);
}
async function deflateRaw(u8){
  if(typeof CompressionStream==="undefined"||!u8.length) return null;
  try{
    const cs=new CompressionStream("deflate-raw");
    const w=cs.writable.getWriter();
    w.write(u8); w.close();
    const buf=await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  }catch(e){ return null; }
}
async function zipPack(files){
  const parts=[],central=[]; let offset=0;
  const now=new Date();
  const time=(((now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1))&0xFFFF);
  const date=((((now.getFullYear()-1980)&0x7F)<<9)|(((now.getMonth()+1)&0xF)<<5)|(now.getDate()&0x1F))&0xFFFF;
  for(const f of files){
    let body,method,crc,usize;
    if(f.rawData){ body=f.rawData; method=f.method|0; crc=f.crc|0; usize=f.usize|0; }
    else{
      const raw=f.data;
      const compressed=await deflateRaw(raw);
      const useDeflate=!!compressed&&compressed.length<raw.length;
      body=useDeflate?compressed:raw; method=useDeflate?8:0; crc=crc32(raw); usize=raw.length;
    }
    const name=strU8(f.name), csize=body.length;
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);
    lh.setUint16(8,method,true); lh.setUint16(10,time,true); lh.setUint16(12,date,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,csize,true); lh.setUint32(22,usize,true);
    lh.setUint16(26,name.length,true); lh.setUint16(28,0,true);
    parts.push(new Uint8Array(lh.buffer),name,body);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true);
    ch.setUint16(8,0x0800,true); ch.setUint16(10,method,true); ch.setUint16(12,time,true); ch.setUint16(14,date,true);
    ch.setUint32(16,crc,true); ch.setUint32(20,csize,true); ch.setUint32(24,usize,true);
    ch.setUint16(28,name.length,true); ch.setUint16(30,0,true); ch.setUint16(32,0,true);
    ch.setUint16(34,0,true); ch.setUint16(36,0,true); ch.setUint32(38,0,true); ch.setUint32(42,offset,true);
    central.push(new Uint8Array(ch.buffer),name);
    offset+=30+name.length+csize;
  }
  const cdSize=central.reduce((a,b)=>a+b.length,0);
  const eo=new DataView(new ArrayBuffer(22));
  eo.setUint32(0,0x06054b50,true); eo.setUint16(4,0,true); eo.setUint16(6,0,true);
  eo.setUint16(8,files.length,true); eo.setUint16(10,files.length,true);
  eo.setUint32(12,cdSize,true); eo.setUint32(16,offset,true); eo.setUint16(20,0,true);
  const all=parts.concat(central,[new Uint8Array(eo.buffer)]);
  let total=0; all.forEach(a=>total+=a.length);
  const out=new Uint8Array(total); let p=0;
  all.forEach(a=>{out.set(a,p);p+=a.length;});
  return out;
}
function colName(n){let s="";while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=(n-m-1)/26;}return s;}
function xesc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function xescA(s){return xesc(s).replace(/'/g,"&apos;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"");}

function sheetXml(sheet){
  const rows=sheet.rows||[];
  const nCols=Math.max(sheet.header?sheet.header.length:0,...rows.map(r=>r.length),1);
  let xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    +'<sheetViews><sheetView workbookViewId="0">'
    +(sheet.freeze===false?"":'<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    +'</sheetView></sheetViews>';
  if(sheet.cols && sheet.cols.length){
    xml+="<cols>";
    for(let i=0;i<nCols;i++) xml+='<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+(sheet.cols[i]||14)+'" customWidth="1"/>';
    xml+="</cols>";
  }
  xml+="<sheetData>";
  const put=(cells,rIdx)=>{
    const r=rIdx+1; let s='<row r="'+r+'">';
    cells.forEach((cell,ci)=>{
      if(cell===null||cell===undefined||cell==="") return;
      const ref=colName(ci+1)+r;
      const style=rIdx===0?' s="1"':"";
      if(typeof cell==="number"&&isFinite(cell)) s+='<c r="'+ref+'"'+style+'><v>'+cell+"</v></c>";
      else s+='<c r="'+ref+'" t="inlineStr"'+style+'><is><t xml:space="preserve">'+xescA(cell)+"</t></is></c>";
    });
    xml+=s+"</row>";
  };
  if(sheet.header) put(sheet.header,0);
  const start=sheet.header?1:0;
  rows.forEach((r,i)=>put(r,start+i));
  xml+="</sheetData>";
  const lastRow=rows.length+start;
  if(sheet.header&&!sheet.noFilter&&rows.length&&nCols>0) xml+='<autoFilter ref="A1:'+colName(nCols)+lastRow+'"/>';
  if(sheet.merges&&sheet.merges.length)
    xml+='<mergeCells count="'+sheet.merges.length+'">'+sheet.merges.map(r=>'<mergeCell ref="'+r+'"/>').join("")+"</mergeCells>";
  xml+="</worksheet>";
  return xml;
}

const STYLES_XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 +'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
 +'<fonts count="2"><font><sz val="10"/><name val="Malgun Gothic"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Malgun Gothic"/></font></fonts>'
 +'<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
 +'<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill></fills>'
 +'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
 +'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
 +'<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
 +'<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
 +'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
 +'</styleSheet>';

function safeSheetName(name,used){
  let n=String(name).replace(/[\\\/\?\*\[\]:]/g,"-").slice(0,31)||"Sheet";
  let base=n,i=2;
  while(used[n]){ n=(base.slice(0,28)+"_"+i); i++; }
  used[n]=true;
  return n;
}
async function buildXlsx(tables){
  const used={};
  const sheets=tables.map(t=>({name:safeSheetName(t.name,used),header:t.header||null,rows:t.rows||[],
    cols:t.cols,merges:t.merges,noFilter:t.noFilter,freeze:t.freeze}));
  const files=[];
  files.push({name:"[Content_Types].xml",data:strU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    +'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    +'<Default Extension="xml" ContentType="application/xml"/>'
    +'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    +'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    +sheets.map((s,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("")
    +"</Types>")});
  files.push({name:"_rels/.rels",data:strU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    +"</Relationships>")});
  files.push({name:"xl/workbook.xml",data:strU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    +"<sheets>"+sheets.map((s,i)=>'<sheet name="'+xescA(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join("")+"</sheets></workbook>")});
  files.push({name:"xl/_rels/workbook.xml.rels",data:strU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    +sheets.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join("")
    +'<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    +"</Relationships>")});
  files.push({name:"xl/styles.xml",data:strU8(STYLES_XML)});
  sheets.forEach((s,i)=>files.push({name:"xl/worksheets/sheet"+(i+1)+".xml",data:strU8(sheetXml(s))}));
  return await zipPack(files);
}

function toCsv(table,sep){
  sep=sep||",";
  const q=v=>{
    const s=(v===null||v===undefined)?"":String(v);
    return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  };
  const lines=[];
  if(table.header) lines.push(table.header.map(q).join(sep));
  table.rows.forEach(r=>lines.push(r.map(q).join(sep)));
  return "\ufeff"+lines.join("\r\n");
}

/* ------------------------------------------------------------
   5b. Reading an existing workbook (to fill the real template)
   ------------------------------------------------------------ */
function strFromU8(u8){
  if(typeof TextDecoder!=="undefined") return new TextDecoder("utf-8").decode(u8);
  return Buffer.from(u8).toString("utf8");
}
async function inflateRaw(u8){
  if(typeof DecompressionStream==="undefined")
    throw new Error("this browser cannot read an xlsx file (DecompressionStream missing)");
  const ds=new DecompressionStream("deflate-raw");
  const w=ds.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
/* accept ArrayBuffer | Uint8Array | Buffer anywhere a byte view is needed */
function asU8(x){
  if(x instanceof Uint8Array) return x;
  if(typeof Buffer!=="undefined"&&Buffer.isBuffer(x)) return new Uint8Array(x.buffer,x.byteOffset,x.byteLength);
  return new Uint8Array(x);
}
function zipEntries(bytes){
  const u8=asU8(bytes);
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.length);
  let eocd=-1;
  const min=Math.max(0,u8.length-65558);
  for(let i=u8.length-22;i>=min;i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error("not a zip/xlsx container");
  const count=dv.getUint16(eocd+10,true); let p=dv.getUint32(eocd+16,true);
  const out=[];
  for(let i=0;i<count;i++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method=dv.getUint16(p+10,true), crc=dv.getUint32(p+16,true);
    const csize=dv.getUint32(p+20,true), usize=dv.getUint32(p+24,true);
    const nlen=dv.getUint16(p+28,true), elen=dv.getUint16(p+30,true), clen=dv.getUint16(p+32,true);
    const lho=dv.getUint32(p+42,true);
    out.push({name:strFromU8(u8.subarray(p+46,p+46+nlen)),method:method,crc:crc,
      csize:csize,usize:usize,lho:lho});
    p+=46+nlen+elen+clen;
  }
  return out;
}
function zipEntryBytes(bytes,e){
  const u8=asU8(bytes);
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.length);
  const nlen=dv.getUint16(e.lho+26,true), elen=dv.getUint16(e.lho+28,true);
  const start=e.lho+30+nlen+elen;
  return u8.subarray(start,start+e.csize);
}
async function zipEntryText(bytes,e){
  const raw=zipEntryBytes(bytes,e);
  return strFromU8(e.method===0?raw:await inflateRaw(raw));
}
function unxml(s){
  return String(s).replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&#(\d+);/g,(m,d)=>String.fromCharCode(Number(d))).replace(/&amp;/g,"&");
}
function parseSst(xml){
  const out=[], re=/<si>([\s\S]*?)<\/si>/g; let m;
  while((m=re.exec(xml))){
    const parts=[], tre=/<t[^>]*>([\s\S]*?)<\/t>/g; let t;
    while((t=tre.exec(m[1]))) parts.push(unxml(t[1]));
    out.push(parts.join(""));
  }
  return out;
}
/* compact read of a worksheet: [{r, cells:{A:{ref,text,type,...}}}] */
function sheetRowMap(xml,sst){
  const rows=[], rowRe=/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let m;
  while((m=rowRe.exec(xml))){
    const cells={}, cellRe=/<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g; let c;
    while((c=cellRe.exec(m[2]))){
      const attrs=c[3]||"", inner=c[5]||"";
      const tm=/t="([^"]+)"/.exec(attrs), type=tm?tm[1]:"";
      let raw="", text="";
      const vm=/<v>([\s\S]*?)<\/v>/.exec(inner);
      if(vm) raw=vm[1];
      const im=/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      if(im) text=unxml(im[1]);
      else if(type==="s"){ const idx=Number(raw); text=(idx>=0&&idx<sst.length)?sst[idx]:""; }
      else if(type==="str"||type==="inlineStr") text=unxml(raw);
      else text=raw;
      cells[c[1]]={ref:c[1]+c[2],attrs:attrs,type:type,raw:raw,text:text};
    }
    rows.push({r:Number(m[1]),cells:cells});
  }
  return rows;
}
function cellText(row,col){ const c=row&&row.cells[col]; return c?c.text:""; }
/* replace the whole <c> element of one reference, keeping its style attribute */
function patchCell(xml,ref,value){
  const re=new RegExp('<c r="'+ref+'"([^>]*?)(/>|>[\\s\\S]*?</c>)');
  const m=re.exec(xml);
  if(!m) return null;
  const attrs=(m[1]||"").replace(/\s+t="[^"]*"/g,"");
  const rep=(value===""||value===null||value===undefined)
    ? '<c r="'+ref+'"'+attrs+'/>'
    : '<c r="'+ref+'"'+attrs+'><v>'+value+'</v></c>';
  return xml.slice(0,m.index)+rep+xml.slice(m.index+m[0].length);
}
/* template sheet name -> parameter sheet model. Accepts "Top 조명 2번" and "TOP - LIGHT2".
   opts.lightOffset = template light number minus folder light number (0 = LIGHT2 <-> 조명 2번). */
function matchTemplateSheet(name,paramSheets,opts){
  const m=/^\s*(Top|Bottom)\s*조명\s*(\d+)\s*번/i.exec(name)
        ||/(TOP|BOTTOM)\s*[-–·:]?\s*LIGHT\s*_?(\d+)/i.exec(name);
  if(!m) return null;
  const side=m[1].toUpperCase();
  const num=Number(m[2])-Number((opts&&opts.lightOffset)||0);
  const cands=(paramSheets||[]).filter(s=>String(s.side).toUpperCase()===side
    && Number(String(s.light||"").replace(/\D/g,""))===num);
  if(!cands.length) return null;
  const exact=cands.filter(s=>!s.variant||String(s.variant).toUpperCase()===side);
  const pick=(exact.length?exact:cands)[0];
  return {sheet:pick,ambiguous:cands.length>1?cands.map(s=>s.name):null};
}
/* the GV block: first row labelled "GV 밝기" plus the following rows that keep column B filled */
function findGvRows(rows,startIdx){
  const out=[];
  for(let i=startIdx;i<rows.length;i++){
    const a=nrm(cellText(rows[i],"A")), b=cellText(rows[i],"B");
    if(i===startIdx&&a!=="gv밝기") break;
    if(i>startIdx&&(a==="영역"||a==="파라미터"||a==="채널"||a==="조명축")) break;
    if(!b){ if(out.length) break; continue; }
    out.push(rows[i]);
  }
  return out;
}
const PARAM_COLS=[["C","r"],["E","g"],["G","b"]];
/* fill Parameter_Template.xlsx: patch value cells only, leave everything else untouched */
async function fillTemplateXlsx(zipBytes,paramSheets,opts){
  opts=opts||{};
  const entries=zipEntries(zipBytes);
  const byName={}; entries.forEach(e=>{ byName[e.name]=e; });
  const need=n=>{ if(!byName[n]) throw new Error("not an xlsx workbook (missing "+n+")"); return byName[n]; };
  const wbText=await zipEntryText(zipBytes,need("xl/workbook.xml"));
  const relsText=await zipEntryText(zipBytes,need("xl/_rels/workbook.xml.rels"));
  const sst=byName["xl/sharedStrings.xml"]?parseSst(await zipEntryText(zipBytes,byName["xl/sharedStrings.xml"])):[];
  const rels={};
  (relsText.match(/<Relationship[^>]*>/g)||[]).forEach(tag=>{
    const id=/Id="([^"]+)"/.exec(tag), tg=/Target="([^"]+)"/.exec(tag);
    if(id&&tg) rels[id[1]]=tg[1].replace(/^\/?xl\//,"").replace(/^\//,"");
  });
  const sheetList=[];
  (wbText.match(/<sheet[^>]*>/g)||[]).forEach(tag=>{
    const nm=/name="([^"]*)"/.exec(tag), rid=/r:id="([^"]+)"/.exec(tag);
    if(nm&&rid) sheetList.push({name:unxml(nm[1]),path:"xl/"+(rels[rid[1]]||"")});
  });
  const report={mode:"template",sheets:[],skipped:[],cells:0,blanked:0};
  const patched={};
  for(const sh of sheetList){
    const match=matchTemplateSheet(sh.name,paramSheets,opts);
    if(!match){
      report.skipped.push({sheet:sh.name,reason:"no TOP/BOTTOM + light number in the loaded source files"});
      continue;
    }
    const target=match.sheet;
    const entry=byName[sh.path];
    if(!entry){ report.skipped.push({sheet:sh.name,reason:"worksheet part missing ("+sh.path+")"}); continue; }
    let xml=await zipEntryText(zipBytes,entry);
    const rows=sheetRowMap(xml,sst);
    const info={sheet:sh.name,target:target.name,source:target.files.join(" | "),
      blocks:0,cells:0,blanked:0,gvCells:0,unresolved:[],notInTemplate:[]};
    if(match.ambiguous) info.ambiguous=match.ambiguous;
    const write=(ref,value,kind)=>{
      const out=patchCell(xml,ref,value);
      if(!out) return false;
      xml=out; info.cells++;
      if(kind==="gv") info.gvCells++;
      if(value==="") info.blanked++;
      return true;
    };
    /* GV rows: typed values win, otherwise blank them so old numbers never mislead */
    const gvIdx=rows.findIndex(r=>nrm(cellText(r,"A"))==="gv밝기");
    if(gvIdx>=0){
      findGvRows(rows,gvIdx).forEach(row=>{
        const cls=cellText(row,"B").replace(/\s*\(.*?\)\s*/g,"").trim();
        const gv=(opts.gv&&opts.gv[target.key+"|"+cls])||null;
        PARAM_COLS.forEach(pair=>{
          const cell=row.cells[pair[0]];
          const ref=cell?cell.ref:pair[0]+row.r;
          const ch=pair[1].toUpperCase();
          const typed=(gv&&gv[ch]!==undefined&&gv[ch]!=="")?gv[ch]:null;
          if(typed!==null) write(ref,Number(typed),"gv");
          else if(opts.blankEmpty!==false) write(ref,"","gv");
        });
      });
    }
    /* parameter rows inside each area block */
    const used=new Set();
    for(let i=0;i<rows.length;i++){
      if(nrm(cellText(rows[i],"A"))!=="영역") continue;
      const areaLabel=cellText(rows[i],"B").replace(/\(.*\)\s*$/,"").trim();
      const block=target.blocks.find(b=>nrm(b.area)===nrm(areaLabel));
      if(!block) continue;
      used.add(block.area); info.blocks++;
      for(let j=i+2;j<rows.length;j++){
        const rowA=nrm(cellText(rows[j],"A"));
        if(rowA==="영역"||rowA==="채널"||rowA==="조명축"||rowA==="gv밝기") break;
        const label=cellText(rows[j],"B");
        if(!label) break;
        let param=block.params.find(p=>nrm(p.label)===nrm(label));
        if(!param){
          const k=labelToKey(label,opts.dictIndex);
          if(k) param=block.params.find(p=>p.key===k);
        }
        if(!param){
          info.unresolved.push(areaLabel+" / "+label);
          if(opts.blankEmpty!==false) PARAM_COLS.forEach(pair=>{
            const cell=rows[j].cells[pair[0]];
            write(cell?cell.ref:pair[0]+rows[j].r,"");
          });
          continue;
        }
        PARAM_COLS.forEach(pair=>{
          const src=param[pair[1]];
          const val=(src===""||src===null||src===undefined)?"":num(src,opts.digits);
          const cell=rows[j].cells[pair[0]];
          const ref=cell?cell.ref:pair[0]+rows[j].r;
          if(val!=="") write(ref,val);
          else if(opts.blankEmpty!==false) write(ref,"");
        });
      }
    }
    target.blocks.forEach(b=>{ if(!used.has(b.area)) info.notInTemplate.push(b.area); });
    patched[sh.path]=xml;
    report.cells+=info.cells; report.blanked+=info.blanked;
    report.sheets.push(info);
  }
  const files=entries.map(e=>patched[e.name]!==undefined
    ? {name:e.name,data:strU8(patched[e.name])}
    : {name:e.name,rawData:zipEntryBytes(zipBytes,e),method:e.method,crc:e.crc,usize:e.usize});
  return {bytes:await zipPack(files),report:report};
}
