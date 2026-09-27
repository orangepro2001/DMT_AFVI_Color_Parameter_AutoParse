//! One-off template repair: the user's new workbook has `Top2-Light3` as a raw
//! copy of `Top2-Light2` (GV rows AU/OSP, 영역 "UNIT - AU - C-Pad") while every
//! Light3 sheet must carry SR/SPACE rows and the NonMetal blocks. Copy the
//! finished `Top1-Light3` sheet content over `Top2-Light3` (same shared strings
//! and styles, sheet name and 조명 축 notes stay editable afterwards). Idempotent.

use afvi_parse_lib::export_excel::{read_workbook, write_workbook, Workbook};

#[test]
fn fix_top2_light3_from_top1_light3() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../reference/Parameter_Template.xlsx");
    if !path.exists() {
        return; // template not in the repo checkout
    }
    let bytes = std::fs::read(&path).unwrap();
    let workbook = read_workbook(&bytes).unwrap();
    let part_of = |name: &str| -> Option<String> {
        workbook.sheets.iter().find(|(n, _)| n.trim() == name).map(|(_, p)| p.clone())
    };
    let (Some(top1_part), Some(top2_part)) = (part_of("Top1-Light3"), part_of("Top2-Light3")) else {
        println!("no Top1/Top2-Light3 sheets - legacy template, nothing to fix");
        return;
    };
    if workbook.bytes.get(&top2_part) == workbook.bytes.get(&top1_part) {
        println!("Top2-Light3 is already identical to Top1-Light3 - nothing to fix");
        return;
    }
    let mut fixed = Workbook { bytes: workbook.bytes.clone(), sheets: workbook.sheets.clone(), shared_strings: workbook.shared_strings.clone() };
    let content = fixed.bytes.get(&top1_part).cloned().expect("Top1-Light3 part missing");
    fixed.bytes.insert(top2_part.clone(), content);
    write_workbook(&fixed, &path).expect("cannot write the repaired template");
    println!("Top2-Light3 rewritten from Top1-Light3 ({} bytes)", fixed.bytes[&top2_part].len());

    // reload and verify the repair took
    let reloaded = read_workbook(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(reloaded.bytes.get(&top2_part), reloaded.bytes.get(&top1_part), "repair did not stick");
}
