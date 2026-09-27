//! End-to-end export against the real Parameter_Template.xlsx and a record built
//! from the reference XML trees. Skips silently when the inputs are not present
//! (template lives in the repo reference/ dir and on the station machine).

use afvi_parse_lib::export_excel::{run_export, ExportArgs};

#[test]
fn exports_with_the_real_model_record() {
    let record_path = std::env::temp_dir().join("gencode").join("real-record.json");
    let gv_path = std::env::temp_dir().join("gencode").join("real-gv.json");
    let candidates = [
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../reference/Parameter_Template.xlsx"),
        std::path::PathBuf::from("D:\\검사기술파라미터\\Parameter_Template.xlsx"),
    ];
    let Some(template) = candidates.iter().find(|p| p.exists()) else { return };
    if !record_path.exists() || !gv_path.exists() {
        return;
    }
    let record_json = std::fs::read_to_string(&record_path).unwrap();
    let gv_json = std::fs::read_to_string(&gv_path).unwrap();
    let template_bytes = std::fs::read(template).unwrap();
    let out_dir = std::env::temp_dir().join("dmt-afvi-export-real");
    let report = run_export(ExportArgs {
        record_json: &record_json,
        gv_json: &gv_json,
        template_bytes: &template_bytes,
        export_path: out_dir.to_str().unwrap(),
        machine_name: "AFVI 14",
    })
    .unwrap();
    println!("{}", serde_json::to_string_pretty(&report).unwrap());

    assert_eq!(report.file_name, "AFVI14_6ST2001Q01.xlsx");
    assert_eq!(report.skipped.len(), 2, "조명지침 + 영역 Convention are skipped: {:?}", report.skipped);

    // new template: FM1/FM2 sheets are separate (7 parameter sheets); legacy: 5
    let new_naming = report.sheets.iter().any(|s| s.sheet.trim_start().starts_with("Top1"));
    assert_eq!(report.sheets.len(), if new_naming { 7 } else { 5 }, "sheets: {:?}", report.sheets);

    // LIGHT0 (DMG sheet): 2 classes x 2 RED columns (Top / Bottom) = 4 GV cells, no area work
    let dmg = report.sheets.iter().find(|s| s.sheet.contains("DMG")).unwrap();
    assert!(dmg.gv_cells >= 4, "{dmg:?}");
    assert!(dmg.appended_areas.is_empty());

    // LIGHT1 (Top1-Light2 / legacy Top 조명 2번): AU + OSP filled; missing blocks appended
    let top2 = report
        .sheets
        .iter()
        .find(|s| s.sheet.trim_start().starts_with("Top1-Light2") || s.sheet == "Top 조명 2번")
        .unwrap();
    assert!(top2.filled_cells > 0, "expected real values in the FM1 Light2 sheet");
    assert!(top2.appended_areas.iter().any(|a| a.contains("B-Pad")), "{:?}", top2.appended_areas);

    // LIGHT2 (Top1-Light3 / legacy Top 조명 3번): the missing NonMetal areas completed
    let top3 = report
        .sheets
        .iter()
        .find(|s| s.sheet.trim_start().starts_with("Top1-Light3") || s.sheet == "Top 조명 3번")
        .unwrap();
    assert!(top3.appended_areas.iter().any(|a| a.contains("SR All")), "{:?}", top3.appended_areas);
    assert!(top3.appended_areas.len() >= 4, "{:?}", top3.appended_areas);

    // FM2 gets its own sheets and its own values
    if new_naming {
        let top2_fm2 = report.sheets.iter().find(|s| s.sheet.trim_start().starts_with("Top2-Light2")).unwrap();
        assert!(top2_fm2.filled_cells > 0, "expected real FM2 values in Top2-Light2: {top2_fm2:?}");
        let top3_fm2 = report.sheets.iter().find(|s| s.sheet.trim_start().starts_with("Top2-Light3")).unwrap();
        assert!(top3_fm2.filled_cells > 0, "expected real FM2 values in Top2-Light3: {top3_fm2:?}");
    }

    // the output workbook opens again as a valid zip
    let bytes = std::fs::read(out_dir.join(&report.file_name)).unwrap();
    afvi_parse_lib::export_excel::read_workbook(&bytes).unwrap();
}
