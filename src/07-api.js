/* ============================================================
   7. View assembly + public API
   ------------------------------------------------------------
   One place that turns the parsed model into the list of views the UI
   shows, in the order the user should look at them:

     Summary -> one "Param: <SIDE> - <LIGHT>" sheet per side+light
             -> InspectionSpec -> LightSpec -> Comparison -> dictionaries

   The same objects are handed to the exporters, so preview and export can
   never drift apart. Also exported on globalThis for the Node test harness
   (`globalThis.SpecTool`), which cannot run the UI part (src/08-app.js).
   ============================================================ */
function buildViews(parsed,dict,opts){
  const analysis=buildAllTables(parsed,dict,opts);
  const dictIndex=dictKeyIndex(dict);
  const paramSheets=buildParamSheets(parsed,dict,opts,dictIndex);
  const lightViews=buildLightViews(parsed,dict,opts);
  const byName={};
  analysis.tables.forEach(t=>{ byName[t.name]=t; });
  const views=[];
  const addTable=n=>{ if(byName[n]) views.push(Object.assign({kind:"table",label:byName[n].name},byName[n])); };
  addTable("Summary");
  paramSheets.forEach(s=>views.push({kind:"parameter-sheet",name:"Param: "+s.name,label:"Param: "+s.name,sheet:s}));
  lightViews.forEach(v=>views.push(v));
  ["InspectionSpec","LightSpec","LightSpec Grouped","Comparison","Param Dict","Node Dict"].forEach(addTable);
  return {analysis:analysis,paramSheets:paramSheets,lightViews:lightViews,views:views,
    dictIndex:dictIndex,stats:analysis.stats};
}

globalThis.SpecTool={
  VERSION:VERSION,PARAM_NAMES:PARAM_NAMES,NODE_NAMES:NODE_NAMES,
  SPEC_GROUPS:SPEC_GROUPS,CONTROL_TYPES:CONTROL_TYPES,CAMERA_TYPES:CAMERA_TYPES,CHANNEL_COLORS:CHANNEL_COLORS,
  TEMPLATE_AREAS:TEMPLATE_AREAS,TEMPLATE_FAMILIES:TEMPLATE_FAMILIES,
  makeDict:makeDict,loadParamDict:loadParamDict,loadNodeDict:loadNodeDict,
  parseXml:parseXml,parseInspectionSpec:parseInspectionSpec,parseLightSpec:parseLightSpec,
  classify:classify,parseAll:parseAll,
  buildInspectionTable:buildInspectionTable,buildLightTable:buildLightTable,buildComparison:buildComparison,
  buildDictTable:buildDictTable,buildSummary:buildSummary,buildAllTables:buildAllTables,
  dictKeyIndex:dictKeyIndex,labelToKey:labelToKey,groupInspects:groupInspects,
  groupChannels:groupChannels,colorGroupTable:colorGroupTable,lightSheetTable:lightSheetTable,
  buildLightViews:buildLightViews,
  buildParamSheets:buildParamSheets,buildParamSheet:buildParamSheet,paramSheetLayout:paramSheetLayout,
  paramTables:paramTables,buildViews:buildViews,
  buildXlsx:buildXlsx,fillTemplateXlsx:fillTemplateXlsx,toCsv:toCsv,safeSheetName:safeSheetName,
  zipEntries:zipEntries,sheetRowMap:sheetRowMap,inflateRaw:inflateRaw,
  Render:Render
};
