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

/* ------------------------------------------------------------
   Export grouping
   ------------------------------------------------------------
   The tool writes two workbooks (plus an optional reference one):

     light    : the parameter sheets in the Parameter_Template.xlsx layout
                (조명 축 + GV 밝기 rows + values) followed by the LightSpec
                listings  -> "<Model>_<SIDE>_LIGHT<n>_LightSpec.xlsx"
     inspect  : the InspectionSpec listing + the multi-file comparison
                -> "<Model>_<SIDE>_LIGHT<n>_InspectSpec.xlsx"
     reference: Summary + the two dictionaries (optional, not part of the two)

   Kept here (not in the app layer) so the Node test harness can assert the
   grouping without a DOM. opts.gv/digits are read at call time.
   ------------------------------------------------------------ */
function exportGroups(analysis,paramSheets,opts){
  const byName={};
  ((analysis&&analysis.tables)||[]).forEach(t=>{ byName[t.name]=t; });
  const pick=n=>byName[n]||null;
  return {
    param:paramTables(paramSheets||[],opts||{}),
    light:["LightSpec","LightSpec Grouped"].map(pick).filter(Boolean),
    inspect:["InspectionSpec","Comparison"].map(pick).filter(Boolean),
    reference:["Summary","Param Dict","Node Dict"].map(pick).filter(Boolean)
  };
}

globalThis.SpecTool={
  VERSION:VERSION,PARAM_NAMES:PARAM_NAMES,NODE_NAMES:NODE_NAMES,
  SPEC_GROUPS:SPEC_GROUPS,CONTROL_TYPES:CONTROL_TYPES,CAMERA_TYPES:CAMERA_TYPES,CHANNEL_COLORS:CHANNEL_COLORS,
  TEMPLATE_AREAS:TEMPLATE_AREAS,TEMPLATE_FAMILIES:TEMPLATE_FAMILIES,
  makeDict:makeDict,loadParamDict:loadParamDict,loadNodeDict:loadNodeDict,
  parseXml:parseXml,parseInspectionSpec:parseInspectionSpec,parseLightSpec:parseLightSpec,
  classify:classify,parseAll:parseAll,
  buildInspectionInputTable:buildInspectionInputTable,buildLightTable:buildLightTable,buildComparison:buildComparison,
  buildDictTable:buildDictTable,buildSummary:buildSummary,buildAllTables:buildAllTables,
  dictKeyIndex:dictKeyIndex,labelToKey:labelToKey,groupInspects:groupInspects,
  groupChannels:groupChannels,colorGroupTable:colorGroupTable,lightSheetTable:lightSheetTable,
  CHANNEL_BASE:CHANNEL_BASE,channelNo:channelNo,channelName:channelName,
  buildLightViews:buildLightViews,specModel:specModel,lightsOfSpec:lightsOfSpec,
  buildParamSheets:buildParamSheets,buildParamSheet:buildParamSheet,paramSheetLayout:paramSheetLayout,
  paramTables:paramTables,buildViews:buildViews,exportGroups:exportGroups,
  buildXlsx:buildXlsx,fillTemplateXlsx:fillTemplateXlsx,appendTablesToXlsx:appendTablesToXlsx,
  toCsv:toCsv,safeSheetName:safeSheetName,
  zipEntries:zipEntries,sheetRowMap:sheetRowMap,inflateRaw:inflateRaw,
  Render:Render
};
