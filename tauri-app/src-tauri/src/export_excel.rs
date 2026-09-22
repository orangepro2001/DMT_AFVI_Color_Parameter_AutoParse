//! Parameter Excel export (검사기술파라미터 workbook).
//!
//! Opens the blank `Parameter_Template.xlsx`, fills the value cells of the four
//! 조명 sheets (and the GV cells of the DMG sheet) and appends the area blocks
//! the template omitted - everything else in the workbook stays untouched, so
//! the upload server keeps parsing the same layout.
//!
//! Light rule (equipment knowledge, see PARAMETER_TEMPLATE_NOTES.md):
//! - 조명 1번 = LIGHT0: no INSPECTION parameters (AI model light) - GV cells only
//! - 조명 2번 = LIGHT1: only AU (PNODE 2) and OSP (PNODE 3) areas
//! - 조명 3번 = LIGHT2: only NonMetal (PNODE 5) areas

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;

// ---------------------------------------------------------------- report

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub output_path: String,
    #[serde(default)]
    pub sheets: Vec<SheetReport>,
    #[serde(default)]
    pub skipped: Vec<SkippedSheet>,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SheetReport {
    #[serde(default)]
    pub sheet: String,
    #[serde(default)]
    pub filled_cells: usize,
    #[serde(default)]
    pub blanked_cells: usize,
    #[serde(default)]
    pub gv_cells: usize,
    #[serde(default)]
    pub appended_areas: Vec<String>,
    #[serde(default)]
    pub unresolved_labels: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkippedSheet {
    pub sheet: String,
    pub reason: String,
}

// ---------------------------------------------------------------- model record

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecord {
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub hosts: HashMap<String, HostRecord>,
    #[serde(default)]
    pub parameter_dictionary: HashMap<String, String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostRecord {
    #[serde(default)]
    pub parameter_dictionary: HashMap<String, String>,
    #[serde(default)]
    pub inspection_specs: HashMap<String, InspectionSpecFile>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InspectionSpecFile {
    #[serde(default)]
    pub groups: Vec<NodeGroup>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeGroup {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub parents: Vec<NodeParent>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeParent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub children: Vec<ChildNode>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChildNode {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub parameters: Vec<NodeParam>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeParam {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub values: HashMap<String, String>,
}

#[derive(Deserialize, Default)]
pub struct GvSet {
    #[serde(default, rename = "Red")]
    pub red: String,
    #[serde(default, rename = "Green")]
    pub green: String,
    #[serde(default, rename = "Blue")]
    pub blue: String,
}

/// host -> pageIndex -> class (AU/OSP/SR/Space) -> per-camera-colour value
pub type GvStore = HashMap<String, HashMap<String, HashMap<String, GvSet>>>;

// ---------------------------------------------------------------- data blocks

pub struct DataBlock {
    pub gp_id: String,
    pub pn_id: String,
    pub cn_id: String,
    pub area: String,
    /// (ParamKey, dictionary name, [R, G, B]) of the node's INSPECTION elements in key order
    pub params: Vec<(String, String, [Option<f64>; 3])>,
}

fn parse_num(raw: &str) -> Option<f64> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<f64>().ok().filter(|v| v.is_finite())
}

impl DataBlock {
    fn from_node(group: &NodeGroup, parent: &NodeParent, node: &ChildNode) -> Self {
        let mut params: Vec<(String, String, [Option<f64>; 3])> = node
            .parameters
            .iter()
            .filter(|p| p.kind == "INSPECTION" && p.key.parse::<u32>().is_ok())
            .map(|p| {
                (
                    p.key.clone(),
                    p.name.clone(),
                    [
                        parse_num(p.values.get("ValR").map(String::as_str).unwrap_or("")),
                        parse_num(p.values.get("ValG").map(String::as_str).unwrap_or("")),
                        parse_num(p.values.get("ValB").map(String::as_str).unwrap_or("")),
                    ],
                )
            })
            .collect();
        params.sort_by_key(|p| p.0.parse::<u32>().unwrap_or(0));
        // the template spells the first group UNIT, the second stays Dummy
        let gp_label = if group.id == "1" { group.name.to_ascii_uppercase() } else { group.name.clone() };
        DataBlock {
            gp_id: group.id.clone(),
            pn_id: parent.id.clone(),
            cn_id: node.id.clone(),
            area: format!("{} - {} - {}", gp_label, parent.name, node.name),
            params,
        }
    }
}

/// LIGHT0 -> none, LIGHT1 -> AU + OSP (PNODE 2/3), LIGHT2 -> NonMetal (PNODE 5)
pub fn light_area_parents(light_num: u32) -> Option<Vec<String>> {
    match light_num {
        1 => None,
        2 => Some(vec!["2".into(), "3".into()]),
        3 => Some(vec!["5".into()]),
        _ => None,
    }
}

pub fn build_data_blocks(record: &ModelRecord, host: &str, light_num: u32) -> Vec<DataBlock> {
    let Some(rule) = light_area_parents(light_num) else { return vec![] };
    let Some(spec) = record
        .hosts
        .get(host)
        .and_then(|h| h.inspection_specs.get(&format!("LIGHT{}", light_num - 1)))
    else {
        return vec![];
    };
    let mut blocks = Vec::new();
    for group in &spec.groups {
        for parent in &group.parents {
            if !rule.contains(&parent.id) {
                continue;
            }
            for node in &parent.children {
                let block = DataBlock::from_node(group, parent, node);
                if !block.params.is_empty() {
                    blocks.push(block);
                }
            }
        }
    }
    blocks
}

// ---------------------------------------------------------------- label matching

pub fn nrm(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace() && *c != '_').flat_map(char::to_lowercase).collect()
}

/// strip a trailing parenthetical remark: "UNIT - NonMetal - SpaceThick(...)" -> "UNIT - NonMetal - SpaceThick"
pub fn area_base(label: &str) -> String {
    let trimmed = label.trim();
    if trimmed.ends_with(')') {
        if let Some((index, _)) = trimmed.char_indices().rev().find(|&(_, c)| c == '(') {
            return trimmed[..index].trim_end().to_string();
        }
    }
    trimmed.to_string()
}

/// Template label spellings that differ from SpecParameter.xml (see the notes doc §6).
const LABEL_ALIASES: &[(&str, u32)] = &[
    ("brightdefectoffest1(%)", 1003),
    ("brightdefectoffest(%)", 1003),
    ("darkdefectoffest(%)", 1012),
    ("darkdefectoffset1(%)", 1012),
    ("darkdefectoffest2(th)", 1014),
    ("darkdefectoffset2(th)", 1014),
    ("darkdefectpadoffest(th)", 1016),
    ("darkdefectpadoffset(th)", 1016),
    ("in-rangedefectsize(size)", 1036),
    ("in-rangedefectsize(pixel)", 1036),
    ("nickdefectsize(pixel)", 1031),
];

pub struct LabelIndex {
    aliases: HashMap<String, u32>,
    dict: HashMap<String, u32>,
}

impl LabelIndex {
    pub fn new(parameter_dictionary: &HashMap<String, String>) -> Self {
        let mut dict = HashMap::new();
        for (key, text) in parameter_dictionary {
            if let Ok(num) = key.parse::<u32>() {
                dict.insert(nrm(text), num);
            }
        }
        LabelIndex {
            aliases: LABEL_ALIASES.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            dict,
        }
    }

    pub fn resolve(&self, label: &str) -> Option<u32> {
        let n = nrm(label);
        if n.is_empty() {
            return None;
        }
        if let Some(key) = self.aliases.get(&n) {
            return Some(*key);
        }
        self.dict.get(&n).copied()
    }
}

// ---------------------------------------------------------------- sheet xml parsing

#[derive(Clone)]
pub struct Cell {
    pub col: String,
    pub row: u32,
    pub attrs: String,
    /// inner XML between `>` and `</c>` (e.g. `<v>12</v>`), empty for self-closing cells
    pub inner: String,
    pub text: String,
}

pub struct SheetXml {
    pub xml: String,
    pub rows: Vec<(u32, Vec<Cell>)>,
}

pub fn unxml(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

pub fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

pub fn parse_sheet(xml: String, shared_strings: &[String]) -> SheetXml {
    let row_re = regex::Regex::new(r#"<row r="(\d+)"[^>]*?>([\s\S]*?)</row>"#).unwrap();
    let cell_re = regex::Regex::new(r#"<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>([\s\S]*?)</c>)"#).unwrap();
    let type_re = regex::Regex::new(r#"t="(\w+)""#).unwrap();
    let value_re = regex::Regex::new(r"<v>([^<]*)</v>").unwrap();
    let mut rows = Vec::new();
    for rm in row_re.captures_iter(&xml) {
        let row_num: u32 = rm[1].parse().unwrap_or(0);
        let mut cells = Vec::new();
        for cm in cell_re.captures_iter(&rm[2]) {
            let col = cm[1].to_string();
            let row = cm[2].parse().unwrap_or(0);
            let attrs = cm[3].to_string();
            let inner = cm.get(4).map(|m| m.as_str().to_string()).unwrap_or_default();
            let kind = type_re.captures(&attrs).map(|m| m[1].to_string()).unwrap_or_default();
            let raw = value_re.captures(&inner).map(|m| m[1].to_string()).unwrap_or_default();
            let text = if kind == "s" {
                raw.parse::<usize>().ok().and_then(|i| shared_strings.get(i).cloned()).unwrap_or_default()
            } else if kind == "inlineStr" {
                regex::Regex::new(r"<t[^>]*>([\s\S]*?)</t>")
                    .unwrap()
                    .captures(&inner)
                    .map(|m| unxml(&m[1]))
                    .unwrap_or_default()
            } else if kind == "str" {
                unxml(&raw)
            } else {
                raw
            };
            cells.push(Cell { col, row, attrs, inner, text });
        }
        rows.push((row_num, cells));
    }
    SheetXml { xml, rows }
}

fn cell_attr(attrs: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"{name}="([^"]*)""#);
    regex::Regex::new(&pattern).ok()?.captures(attrs).map(|m| m[1].to_string())
}

impl SheetXml {
    pub fn cell_text(&self, row_index: usize, col: &str) -> String {
        self.rows[row_index].1.iter().find(|c| c.col == col).map(|c| c.text.clone()).unwrap_or_default()
    }

    pub fn max_row(&self) -> u32 {
        self.rows.iter().map(|(r, _)| *r).max().unwrap_or(0)
    }

    /// Replace one cell, keeping its style attribute; `None` clears the content.
    /// `text = true` writes an inline string, otherwise a numeric `<v>` value.
    pub fn patch_cell(&mut self, reference: &str, value: Option<&str>, text: bool) -> bool {
        let pattern = format!(r#"<c r="{reference}"([^>]*?)(?:/>|>[\s\S]*?</c>)"#);
        let re = regex::Regex::new(&pattern).unwrap();
        let Some(found) = re.find(&self.xml) else { return false };
        let attrs_src = re.captures(&self.xml).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let attrs = regex::Regex::new(r#"\s*t="[^"]*""#).unwrap().replace_all(&attrs_src, "").to_string();
        let replacement = match (value, text) {
            (Some(v), false) => format!(r#"<c r="{reference}"{attrs}><v>{v}</v></c>"#),
            (Some(v), true) => format!(
                r#"<c r="{reference}"{attrs} t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#,
                xml_escape(v)
            ),
            (None, _) => format!(r#"<c r="{reference}"{attrs}/>"#),
        };
        self.xml.replace_range(found.start()..found.end(), &replacement);
        true
    }

    pub fn append_before_sheet_data_end(&mut self, rows_xml: &str) {
        if let Some(index) = self.xml.rfind("</sheetData>") {
            self.xml.insert_str(index, rows_xml);
        }
    }

    /// The template sheets carry hundreds of pre-formatted but empty husk rows
    /// after the last block. Drop those (content = a value or a string cell) so
    /// appended blocks can follow the last real row without row-number overlaps.
    /// Returns the last row index that holds content.
    pub fn trim_trailing_empty_rows(&mut self) -> u32 {
        let row_re = regex::Regex::new(r#"<row r="(\d+)"[^>]*?(?:/>|>[\s\S]*?</row>)"#).unwrap();
        let last_content = self
            .rows
            .iter()
            .filter(|(_, cells)| cells.iter().any(|c| !c.inner.is_empty()))
            .map(|(r, _)| *r)
            .max()
            .unwrap_or(0);
        let mut removals: Vec<(usize, usize)> = row_re
            .captures_iter(&self.xml)
            .filter_map(|caps| {
                let r: u32 = caps[1].parse().unwrap_or(0);
                let segment = caps[0].to_string();
                let has_content = segment.contains("<v>") || segment.contains("t=\"s\"") || segment.contains("t=\"inlineStr\"");
                let whole = caps.get(0)?;
                (r > last_content && !has_content).then(|| (whole.start(), whole.end()))
            })
            .collect();
        for (start, end) in removals.drain(..).rev() {
            self.xml.replace_range(start..end, "");
        }
        self.rows.retain(|(r, cells)| *r <= last_content || cells.iter().any(|c| !c.inner.is_empty()));
        last_content
    }

    pub fn set_dimension(&mut self, last_row: u32) {
        let re = regex::Regex::new(r#"<dimension ref="([^"]*)"/>"#).unwrap();
        let Some(caps) = re.captures(&self.xml) else { return };
        let old_end = caps[1].split(':').nth(1).unwrap_or("A1").to_string();
        let end_col: String = old_end.chars().take_while(|c| c.is_alphabetic()).collect();
        let end_row: u32 = old_end.chars().skip_while(|c| !c.is_numeric()).collect::<String>().parse().unwrap_or(last_row);
        let new_ref = format!("A1:{end_col}{}", end_row.max(last_row));
        self.xml = re.replace(&self.xml, format!(r#"<dimension ref="{new_ref}"/>"#)).to_string();
    }

    pub fn add_merges(&mut self, merges: &[String]) {
        if merges.is_empty() {
            return;
        }
        let joined = merges.iter().map(|m| format!(r#"<mergeCell ref="{m}"/>"#)).collect::<String>();
        let count_re = regex::Regex::new(r#"<mergeCells count="(\d+)">"#).unwrap();
        if let Some(caps) = count_re.captures(&self.xml) {
            let count: usize = caps[1].parse().unwrap_or(0) + merges.len();
            self.xml = count_re.replace(&self.xml, format!(r#"<mergeCells count="{count}">"#).as_str()).to_string();
            if let Some(index) = self.xml.find("</mergeCells>") {
                self.xml.insert_str(index, &joined);
            }
        } else if let Some(index) = self.xml.find("</sheetData>") {
            let block = format!(r#"<mergeCells count="{}">{joined}</mergeCells>"#, merges.len());
            self.xml.insert_str(index, &block);
        }
    }
}

// ---------------------------------------------------------------- workbook parts

pub struct Workbook {
    pub bytes: HashMap<String, Vec<u8>>,
    pub sheets: Vec<(String, String)>,
    pub shared_strings: Vec<String>,
}

pub fn read_workbook(template_bytes: &[u8]) -> Result<Workbook, String> {
    let cursor = std::io::Cursor::new(template_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Cannot open the template workbook: {e}"))?;
    let mut bytes: HashMap<String, Vec<u8>> = HashMap::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        bytes.insert(name, buf);
    }
    let text = |name: &str| -> Result<String, String> {
        bytes
            .get(name)
            .map(|b| String::from_utf8(b.clone()).map_err(|_| format!("{name} is not UTF-8")))
            .unwrap_or_else(|| Err(format!("missing {name} in the template workbook")))
    };
    let workbook_xml = text("xl/workbook.xml")?;
    let rels_xml = text("xl/_rels/workbook.xml.rels")?;
    let shared_strings = if bytes.contains_key("xl/sharedStrings.xml") {
        parse_shared_strings(&text("xl/sharedStrings.xml")?)
    } else {
        Vec::new()
    };
    let rel_re = regex::Regex::new(r#"<Relationship[^>]*>"#).unwrap();
    let mut rels: HashMap<String, String> = HashMap::new();
    for caps in rel_re.find_iter(&rels_xml) {
        let tag = caps.as_str();
        let id = regex::Regex::new(r#"Id="([^"]+)""#).unwrap().captures(tag).map(|m| m[1].to_string());
        let target = regex::Regex::new(r#"Target="([^"]+)""#).unwrap().captures(tag).map(|m| m[1].to_string());
        if let (Some(id), Some(target)) = (id, target) {
            let target = target.trim_start_matches("/xl/").trim_start_matches("xl/").trim_start_matches('/').to_string();
            rels.insert(id, target);
        }
    }
    let mut sheets = Vec::new();
    for caps in regex::Regex::new(r#"<sheet [^>]*>"#).unwrap().find_iter(&workbook_xml) {
        let tag = caps.as_str();
        let name = regex::Regex::new(r#"name="([^"]*)""#).unwrap().captures(tag).map(|m| unxml(&m[1]));
        let rid = regex::Regex::new(r#"r:id="([^"]+)""#).unwrap().captures(tag).map(|m| m[1].to_string());
        if let (Some(name), Some(rid)) = (name, rid) {
            if let Some(target) = rels.get(&rid) {
                sheets.push((name, format!("xl/{target}")));
            }
        }
    }
    Ok(Workbook { bytes, sheets, shared_strings })
}

fn parse_shared_strings(xml: &str) -> Vec<String> {
    regex::Regex::new(r"<si>([\s\S]*?)</si>")
        .unwrap()
        .captures_iter(xml)
        .map(|si| {
            regex::Regex::new(r"<t[^>]*>([\s\S]*?)</t>")
                .unwrap()
                .captures_iter(&si[1])
                .map(|t| unxml(&t[1]))
                .collect::<String>()
        })
        .collect()
}

/// `Top 조명 2번` -> (Some("TOP"), 2), `DMG 조명 1번` -> (None, 1).
/// None side = the DMG sheet with Top - RED / Bottom - RED GV columns only.
pub fn match_template_sheet(name: &str) -> Option<(Option<String>, u32)> {
    let trimmed = name.trim();
    let light_pos = trimmed.find("조명")?;
    let after = &trimmed[light_pos + "조명".len()..];
    let digits: String = after.chars().skip_while(|c| !c.is_numeric()).take_while(|c| c.is_numeric()).collect();
    let light_num: u32 = digits.parse().ok()?;
    let head = trimmed[..light_pos].trim();
    let side_word: String = head.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    let side = match side_word.to_ascii_uppercase().as_str() {
        "TOP" => Some("TOP".to_string()),
        "BOTTOM" => Some("BOTTOM".to_string()),
        _ => None,
    };
    Some((side, light_num))
}

// ---------------------------------------------------------------- value formatting

pub fn format_number(value: f64) -> String {
    if value == value.trunc() && value.abs() < 1e15 {
        return format!("{}", value as i64);
    }
    let mut out = format!("{value:.6}");
    while out.ends_with('0') {
        out.pop();
    }
    if out.ends_with('.') {
        out.pop();
    }
    out
}

// ---------------------------------------------------------------- export

pub struct ExportArgs<'a> {
    pub record_json: &'a str,
    pub gv_json: &'a str,
    pub template_bytes: &'a [u8],
    pub export_path: &'a str,
    pub machine_name: &'a str,
}

pub fn run_export(args: ExportArgs) -> Result<ExportReport, String> {
    let record: ModelRecord =
        serde_json::from_str(args.record_json).map_err(|e| format!("Stored model record is unreadable: {e}"))?;
    let gv_store: GvStore = serde_json::from_str(args.gv_json).unwrap_or_default();
    let model_name = record.model_name.clone();
    let mut workbook = read_workbook(args.template_bytes)?;

    let host_for = |side: &str| -> String {
        if side == "BOTTOM" {
            "BM".to_string()
        } else {
            ["FM1", "FM2"]
                .iter()
                .find(|h| record.hosts.contains_key(**h))
                .map(|h| h.to_string())
                .unwrap_or_else(|| "FM1".into())
        }
    };
    let dict_for = |host: &str| -> HashMap<String, String> {
        let mut dict = record.hosts.get(host).map(|h| h.parameter_dictionary.clone()).unwrap_or_default();
        for (k, v) in &record.parameter_dictionary {
            dict.entry(k.clone()).or_insert_with(|| v.clone());
        }
        dict
    };

    let mut report = ExportReport {
        file_name: export_file_name(args.machine_name, &model_name),
        output_path: String::new(),
        sheets: Vec::new(),
        skipped: Vec::new(),
    };

    for (sheet_name, part) in workbook.sheets.clone() {
        let Some((side, light_num)) = match_template_sheet(&sheet_name) else {
            report.skipped.push(SkippedSheet { sheet: sheet_name.clone(), reason: "not a 조명 parameter sheet".into() });
            continue;
        };
        let xml = match workbook.bytes.get(&part) {
            Some(bytes) => String::from_utf8(bytes.clone()).map_err(|_| "worksheet part is not UTF-8".to_string())?,
            None => {
                report.skipped.push(SkippedSheet { sheet: sheet_name.clone(), reason: "worksheet part missing".into() });
                continue;
            }
        };
        let mut sheet = parse_sheet(xml, &workbook.shared_strings);
        let mut info = SheetReport { sheet: sheet_name.clone(), ..Default::default() };

        let Some(side) = side else {
            // DMG sheet (조명 1번): C = Top - RED (FM1), E = Bottom - RED (BM); no area blocks.
            fill_gv_rows(&mut sheet, &gv_store, "0", &[("C", "FM1"), ("E", "BM")], &mut info, false);
            workbook.bytes.insert(part, sheet.xml.into_bytes());
            report.sheets.push(info);
            continue;
        };

        let host = host_for(&side);
        let dict = dict_for(&host);
        let label_index = LabelIndex::new(&dict);
        let data_blocks = build_data_blocks(&record, &host, light_num);

        // GV rows: 조명 2번 -> page 0 (AU/OSP), 조명 3번 -> page 2 (SR/Space)
        let gv_page = if light_num == 2 { "0" } else { "2" };
        fill_gv_rows(&mut sheet, &gv_store, gv_page, &[("C", host.as_str()), ("E", host.as_str()), ("G", host.as_str())], &mut info, true);

        // fill the existing 영역 blocks (the area rule decides which ones carry data)
        let mut used: HashSet<String> = HashSet::new();
        for index in 0..sheet.rows.len() {
            if nrm(&sheet.cell_text(index, "A")) != "영역" {
                continue;
            }
            let label = area_base(&sheet.cell_text(index, "B"));
            let Some(block) = data_blocks.iter().find(|b| nrm(&b.area) == nrm(&label)) else { continue };
            used.insert(nrm(&label));
            fill_existing_block(&mut sheet, index, block, &label_index, &mut info);
        }

        // complete the node tree: append the in-rule blocks the template omitted
        let missing: Vec<&DataBlock> = data_blocks.iter().filter(|b| !used.contains(&nrm(&b.area))).collect();
        if !missing.is_empty() {
            append_blocks(&mut sheet, &missing, &label_index, &mut info);
        }

        workbook.bytes.insert(part, sheet.xml.into_bytes());
        report.sheets.push(info);
    }

    let export_dir = Path::new(args.export_path);
    std::fs::create_dir_all(export_dir).map_err(|e| format!("Cannot create {}: {e}", export_dir.display()))?;
    let out_path = export_dir.join(&report.file_name);
    write_workbook(&workbook, &out_path)?;
    report.output_path = out_path.display().to_string();
    Ok(report)
}

pub fn export_file_name(machine_name: &str, model_name: &str) -> String {
    let machine: String = machine_name.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    let model: String = model_name.trim().to_ascii_uppercase().trim_end_matches("-00").to_string();
    format!("{machine}_{model}.xlsx")
}

pub fn write_workbook(workbook: &Workbook, out_path: &Path) -> Result<(), String> {
    let file = std::fs::File::create(out_path).map_err(|e| format!("Cannot create {}: {e}", out_path.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut names: Vec<&String> = workbook.bytes.keys().collect();
    names.sort();
    for name in names {
        writer.start_file(name.as_str(), options).map_err(|e| format!("Cannot write {name} into the workbook: {e}"))?;
        std::io::Write::write_all(&mut writer, &workbook.bytes[name]).map_err(|e| e.to_string())?;
    }
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// GV rows: the `GV 밝기` header row, then rows with a class label in B (AU / OSP / SR / SPACE...).
/// `columns` pairs each value column with the host whose GV applies (DMG: Top/Bottom RED).
fn fill_gv_rows(
    sheet: &mut SheetXml,
    gv_store: &GvStore,
    page: &str,
    columns: &[(&str, &str)],
    info: &mut SheetReport,
    three_colour: bool,
) {
    let Some(header_index) = sheet
        .rows
        .iter()
        .position(|(_, cells)| cells.iter().any(|c| c.col == "A" && nrm(&c.text) == "gv밝기"))
    else {
        return;
    };
    let stop = ["영역", "파라미터", "채널", "조명축"];
    let mut class_rows: Vec<usize> = Vec::new();
    for index in header_index..sheet.rows.len() {
        let a = nrm(&sheet.cell_text(index, "A"));
        if index > header_index && stop.contains(&a.as_str()) {
            break;
        }
        let class = sheet.cell_text(index, "B").trim().to_string();
        if class.is_empty() {
            break;
        }
        class_rows.push(index);
    }
    for &index in &class_rows {
        let class_key = area_base(&sheet.cell_text(index, "B"));
        for (position, (col, host)) in columns.iter().enumerate() {
            let channel = if three_colour { ["Red", "Green", "Blue"].get(position).copied().unwrap_or("Red") } else { "Red" };
            let value = gv_store
                .get(*host)
                .and_then(|pages| pages.get(page))
                .and_then(|classes| classes.iter().find(|(k, _)| nrm(k) == nrm(&class_key)))
                .map(|(_, set)| match channel {
                    "Red" => set.red.clone(),
                    "Green" => set.green.clone(),
                    _ => set.blue.clone(),
                })
                .unwrap_or_default();
            let reference = format!("{col}{}", sheet.rows[index].0);
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                if sheet.patch_cell(&reference, None, false) {
                    info.blanked_cells += 1;
                }
            } else if sheet.patch_cell(&reference, Some(&trimmed), true) {
                info.gv_cells += 1;
            }
        }
    }
}

const VALUE_COLUMNS: [(&str, usize); 3] = [("C", 0), ("E", 1), ("G", 2)];

fn fill_existing_block(sheet: &mut SheetXml, area_row_index: usize, block: &DataBlock, label_index: &LabelIndex, info: &mut SheetReport) {
    let mut row_index = area_row_index + 2; // skip the 검출 불량 row
    while row_index < sheet.rows.len() {
        let a = nrm(&sheet.cell_text(row_index, "A"));
        if ["영역", "채널", "조명축", "gv밝기"].contains(&a.as_str()) {
            break;
        }
        let label = sheet.cell_text(row_index, "B");
        if label.trim().is_empty() {
            break;
        }
        let key = label_index.resolve(&label);
        let values: [Option<f64>; 3] = key
            .and_then(|k| block.params.iter().find(|p| p.0 == k.to_string()))
            .map(|p| p.2)
            .unwrap_or([None, None, None]);
        for (col, channel) in VALUE_COLUMNS {
            let reference = format!("{col}{}", sheet.rows[row_index].0);
            match values[channel].map(format_number) {
                Some(v) => {
                    if sheet.patch_cell(&reference, Some(&v), false) {
                        info.filled_cells += 1;
                    }
                }
                None => {
                    if sheet.patch_cell(&reference, None, false) {
                        info.blanked_cells += 1;
                    }
                }
            }
        }
        if key.is_none() {
            info.unresolved_labels.push(format!("{} / {}", block.area, label));
        }
        row_index += 1;
    }
}

// ---- node-tree completion: append the missing area blocks -------------------

fn style_of(cell: &Cell) -> String {
    cell_attr(&cell.attrs, "s").map(|s| format!(r#" s="{s}""#)).unwrap_or_default()
}

fn styled_empty(col: &str, row: u32, style: &str) -> String {
    format!(r#"<c r="{col}{row}"{style}/>"#)
}

fn inline_text_cell(col: &str, row: u32, style: &str, text: &str) -> String {
    format!(r#"<c r="{col}{row}"{style} t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#, xml_escape(text))
}

fn numeric_cell(col: &str, row: u32, style: &str, value: Option<f64>) -> String {
    match value {
        Some(v) => format!(r#"<c r="{col}{row}"{style}><v>{v}</v></c>"#),
        None => format!(r#"<c r="{col}{row}"{style}/>"#),
    }
}

/// Clone a reference cell verbatim (keeps shared-string label text like 검출 불량 / 파라미터).
fn clone_cell(cell: &Cell, col: &str, row: u32) -> String {
    if cell.inner.is_empty() {
        styled_empty(col, row, &style_of(cell))
    } else {
        let kind = cell_attr(&cell.attrs, "t").map(|t| format!(r#" t="{t}""#)).unwrap_or_default();
        format!(r#"<c r="{col}{row}"{}{}>{}</c>"#, style_of(cell), kind, cell.inner)
    }
}

fn block_row_span(sheet: &SheetXml, area_row_index: usize) -> (usize, usize) {
    let mut end = area_row_index + 1;
    while end < sheet.rows.len() {
        let a = nrm(&sheet.cell_text(end, "A"));
        if ["영역", "채널", "조명축", "gv밝기"].contains(&a.as_str()) {
            break;
        }
        end += 1;
    }
    (area_row_index, end) // exclusive end over sheet.rows indices
}

fn append_blocks(sheet: &mut SheetXml, blocks: &[&DataBlock], label_index: &LabelIndex, info: &mut SheetReport) {
    let Some(first_area_index) = sheet
        .rows
        .iter()
        .enumerate()
        .find(|(_, (_, cells))| cells.iter().any(|c| c.col == "A" && nrm(&c.text) == "영역"))
        .map(|(i, _)| i)
    else {
        return append_plain_blocks(sheet, blocks, info);
    };
    let content_end = sheet.trim_trailing_empty_rows();
    let mut next_row = content_end;
    let (ref_start, ref_end) = block_row_span(sheet, first_area_index);
    if ref_end - ref_start < 3 {
        return append_plain_blocks(sheet, blocks, info);
    }
    let reference: Vec<(u32, Vec<Cell>)> = (ref_start..ref_end).map(|i| (sheet.rows[i].0, sheet.rows[i].1.clone())).collect();
    let area_styles: Vec<(String, String)> = reference[0].1.iter().map(|c| (c.col.clone(), style_of(&c))).collect();
    let defect_styles: Vec<(String, String)> = reference[1].1.iter().map(|c| (c.col.clone(), style_of(&c))).collect();
    let param_styles: Vec<Vec<(String, String)>> = reference.iter().skip(2).map(|(_, cells)| cells.iter().map(|c| (c.col.clone(), style_of(&c))).collect()).collect();
    let family_rows = reference.len() - 2;

    let style_for = |styles: &[(String, String)], col: &str| -> String {
        styles.iter().find(|(c, _)| c == col).map(|(_, s)| s.clone()).unwrap_or_default()
    };

    let mut merges: Vec<String> = Vec::new();
    let mut xml_out = String::new();

    for block in blocks {
        next_row += 2; // one blank row between blocks
        // 영역 row: keep the reference styles, swap the area label
        let row = next_row;
        xml_out.push_str(&format!(r#"<row r="{row}" spans="1:7">"#));
        for col in ["A", "B", "C", "D", "E", "F", "G"] {
            let style = style_for(&area_styles, col);
            if col == "A" {
                if let Some(cell) = reference[0].1.iter().find(|c| c.col == "A") {
                    xml_out.push_str(&clone_cell(cell, col, row));
                } else {
                    xml_out.push_str(&inline_text_cell(col, row, &style, "영역"));
                }
            } else if col == "B" {
                xml_out.push_str(&inline_text_cell(col, row, &style, &block.area));
            } else {
                xml_out.push_str(&styled_empty(col, row, &style));
            }
        }
        xml_out.push_str("</row>");
        merges.push(format!("B{row}:G{row}"));
        next_row += 1;
        // 검출 불량 row: header cell cloned, texts left empty (engineering knowledge, not in data)
        let row = next_row;
        xml_out.push_str(&format!(r#"<row r="{row}" spans="1:7">"#));
        for col in ["A", "B", "C", "D", "E", "F", "G"] {
            let style = style_for(&defect_styles, col);
            if col == "A" {
                if let Some(cell) = reference[1].1.iter().find(|c| c.col == "A") {
                    xml_out.push_str(&clone_cell(cell, col, row));
                } else {
                    xml_out.push_str(&inline_text_cell(col, row, &style, "검출 불량"));
                }
            } else {
                xml_out.push_str(&styled_empty(col, row, &style));
            }
        }
        xml_out.push_str("</row>");
        merges.push(format!("B{row}:C{row}"));
        merges.push(format!("D{row}:E{row}"));
        merges.push(format!("F{row}:G{row}"));
        next_row += 1;
        // parameter rows: family labels cloned verbatim from the reference block,
        // values resolved through the label -> ParamKey match
        let total_params = family_rows.max(block.params.len());
        let first_param_row = next_row;
        let mut last_param_slot: i64 = -1;
        for slot in 0..total_params {
            let is_extra = slot >= family_rows;
            let row = next_row;
            let mut a_cell: Option<&Cell> = None;
            let mut label_cell: Option<&Cell> = None;
            if !is_extra {
                let (_, cells) = &reference[slot + 2];
                a_cell = cells.iter().find(|c| c.col == "A");
                label_cell = cells.iter().find(|c| c.col == "B");
            }
            let label_text = if is_extra {
                block.params[slot - family_rows].1.clone()
            } else {
                label_cell.map(|c| c.text.clone()).unwrap_or_default()
            };
            let key = if is_extra {
                block.params[slot - family_rows].0.parse::<u32>().ok()
            } else {
                label_index.resolve(&label_text)
            };
            let values: [Option<f64>; 3] = key
                .and_then(|k| block.params.iter().find(|p| p.0 == k.to_string()))
                .map(|p| p.2)
                .unwrap_or([None, None, None]);
            xml_out.push_str(&format!(r#"<row r="{row}" spans="1:7">"#));
            for col in ["A", "B", "C", "D", "E", "F", "G"] {
                let style = style_for(param_styles.get(slot.min(param_styles.len() - 1)).unwrap_or(&param_styles[0]), col);
                match col {
                    "A" => match (slot, a_cell) {
                        (0, Some(cell)) => xml_out.push_str(&clone_cell(cell, col, row)),
                        _ => xml_out.push_str(&styled_empty(col, row, &style)),
                    },
                    "B" | "D" | "F" => {
                        if is_extra || label_cell.is_none() {
                            xml_out.push_str(&inline_text_cell(col, row, &style, &label_text));
                        } else if col == "B" {
                            xml_out.push_str(&clone_cell(label_cell.unwrap(), col, row));
                        } else {
                            // D/F carry the same family label as their own shared string in the template
                            let (_, cells) = &reference[slot + 2];
                            match cells.iter().find(|c| c.col == col) {
                                Some(cell) => xml_out.push_str(&clone_cell(cell, col, row)),
                                None => xml_out.push_str(&inline_text_cell(col, row, &style, &label_text)),
                            }
                        }
                    }
                    "C" | "E" | "G" => {
                        let channel = if col == "C" { 0 } else if col == "E" { 1 } else { 2 };
                        xml_out.push_str(&numeric_cell(col, row, &style, values[channel]));
                    }
                    _ => xml_out.push_str(&styled_empty(col, row, &style)),
                }
            }
            xml_out.push_str("</row>");
            // a family span may swallow the separator row after the reference block
            // (empty label) - clone it as decoration but keep it out of the merge
            if is_extra {
                last_param_slot = slot as i64;
            } else if !label_text.trim().is_empty() {
                last_param_slot = slot as i64;
                if key.is_none() {
                    info.unresolved_labels.push(format!("{} / {}", block.area, label_text));
                }
            }
            next_row += 1;
        }
        if last_param_slot >= 1 {
            merges.push(format!("A{first_param_row}:A{}", first_param_row + last_param_slot as u32));
        }
        info.appended_areas.push(block.area.clone());
    }
    sheet.append_before_sheet_data_end(&xml_out);
    sheet.add_merges(&merges);
    sheet.set_dimension(next_row);
}

fn append_plain_blocks(sheet: &mut SheetXml, blocks: &[&DataBlock], info: &mut SheetReport) {
    let mut next_row = sheet.max_row();
    for block in blocks {
        next_row += 2;
        let mut xml = format!(
            r#"<row r="{next_row}" spans="1:7"><c r="A{next_row}" t="inlineStr"><is><t>영역</t></is></c><c r="B{next_row}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c></row>"#,
            xml_escape(&block.area)
        );
        next_row += 1;
        let first_param_row = next_row;
        for param in &block.params {
            xml.push_str(&format!(
                r#"<row r="{next_row}" spans="1:7"><c r="B{next_row}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c><c r="C{next_row}"/><c r="D{next_row}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c><c r="E{next_row}"/><c r="F{next_row}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c><c r="G{next_row}"/></row>"#,
                xml_escape(&param.1),
                xml_escape(&param.1),
                xml_escape(&param.1)
            ));
            next_row += 1;
        }
        sheet.append_before_sheet_data_end(&xml);
        if first_param_row < next_row - 1 {
            sheet.add_merges(&[format!("A{first_param_row}:A{}", next_row - 1)]);
        }
        info.appended_areas.push(block.area.clone());
        next_row += 1;
    }
    sheet.set_dimension(next_row);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_record() -> String {
        let node = |id: &str, name: &str, keys: &[u32], vals: &[f64]| {
            serde_json::json!({
                "id": id, "name": name, "color": "255,201,14", "checked": true,
                "parameters": keys.iter().enumerate().map(|(i, k)| serde_json::json!({
                    "kind": "INSPECTION", "key": k.to_string(), "name": format!("P{k}"),
                    "controlType": 0, "specGroup": 1,
                    "values": {"ValR": format!("{}", vals[i]), "ValG": "0", "ValB": "0"}
                })).collect::<Vec<_>>()
            })
        };
        serde_json::json!({
            "schemaVersion": 2, "modelName": "6ST2001Q01",
            "parameterDictionary": {"1000": "Bright Defect(TH)", "1009": "Dark Defect(TH)", "1034": "In-Range Defect Min(TH)"},
            "hosts": {
                "FM1": {
                    "parameterDictionary": {"1000": "Bright Defect(TH)", "1009": "Dark Defect(TH)"},
                    "inspectionSpecs": {
                        "LIGHT0": {"groups": [{"id": "1", "name": "Unit", "parents": []}]},
                        "LIGHT1": {"groups": [{"id": "1", "name": "Unit", "parents": [
                            {"id": "2", "name": "AU", "children": [
                                node("20", "C-Pad", &[1000, 1009], &[230.0, 100.0])
                            ]},
                            {"id": "3", "name": "OSP", "children": [
                                node("20", "C-Pad", &[1000, 1009], &[235.0, 110.0]),
                                node("21", "B-Pad", &[1000, 1009], &[240.0, 120.0])
                            ]}
                        ]}]},
                        "LIGHT2": {"groups": [{"id": "1", "name": "Unit", "parents": [
                            {"id": "5", "name": "NonMetal", "children": [
                                node("51", "Pattern1", &[1000, 1009], &[90.0, 20.0]),
                                node("52", "Pattern2", &[1000, 1009], &[95.0, 25.0])
                            ]}
                        ]}]}
                    }
                },
                "BM": {
                    "parameterDictionary": {},
                    "inspectionSpecs": {
                        "LIGHT1": {"groups": [{"id": "1", "name": "Unit", "parents": [
                            {"id": "2", "name": "AU", "children": [node("20", "C-Pad", &[1000, 1009], &[231.0, 101.0])]}
                        ]}]}
                    }
                }
            }
        })
        .to_string()
    }

    fn sample_gv() -> String {
        serde_json::json!({
            "FM1": {"0": {"AU": {"Red": "180", "Green": "10", "Blue": "5"}, "OSP": {"Red": "140", "Green": "12", "Blue": "6"}},
                     "2": {"SR": {"Red": "75", "Green": "50", "Blue": "110"}, "Space": {"Red": "65", "Green": "45", "Blue": "100"}}},
            "BM": {"0": {"AU": {"Red": "181", "Green": "11", "Blue": "7"}, "OSP": {"Red": "141", "Green": "13", "Blue": "8"}}}
        })
        .to_string()
    }

    #[test]
    fn fills_and_completes_the_real_template() {
        let template = std::path::Path::new("D:\\검사기술파라미터\\Parameter_Template.xlsx");
        if !template.exists() {
            return; // template only lives on the station machine
        }
        let template_bytes = std::fs::read(template).unwrap();
        let out_dir = std::env::temp_dir().join("dmt-afvi-export-test");
        let report = run_export(ExportArgs {
            record_json: &sample_record(),
            gv_json: &sample_gv(),
            template_bytes: &template_bytes,
            export_path: out_dir.to_str().unwrap(),
            machine_name: "AFVI 14",
        })
        .unwrap();
        assert_eq!(report.file_name, "AFVI14_6ST2001Q01.xlsx");
        // Top 조명 2번: existing AU/OSP C-Pad blocks filled + missing B-Pad appended
        let top2 = report.sheets.iter().find(|s| s.sheet.contains("Top")).unwrap();
        assert!(top2.appended_areas.iter().any(|a| a.contains("OSP - B-Pad")), "B-Pad should be appended: {:?}", top2.appended_areas);
        assert_eq!(top2.appended_areas.len(), 1);
        assert!(top2.filled_cells > 0);
        // the written workbook is a valid zip with the patched sheet
        let bytes = std::fs::read(&out_dir.join(&report.file_name)).unwrap();
        let mut wb = read_workbook(&bytes).unwrap();
        assert!(!wb.sheets.is_empty());
        let (_, part) = wb.sheets.iter().find(|(n, _)| n.contains("Top 조명 2번")).unwrap().clone();
        let sheet = parse_sheet(String::from_utf8(wb.bytes.remove(&part).unwrap()).unwrap(), &wb.shared_strings);
        let texts: Vec<String> = sheet
            .rows
            .iter()
            .flat_map(|(_, cells)| cells.iter().map(|c| c.text.clone()).collect::<Vec<_>>())
            .collect();
        assert!(texts.iter().any(|t| t == "UNIT - OSP - B-Pad"), "appended area label missing");
        // Bottom 조명 2번: the template lacks AU C-Pad -> appended with the BM values (231/101)
        let bot2 = report.sheets.iter().find(|s| s.sheet.contains("Bottom")).unwrap();
        assert!(bot2.appended_areas.iter().any(|a| a == "UNIT - AU - C-Pad"), "{bot2:?}");
        let (_, bot2_part) = wb.sheets.iter().find(|(n, _)| n.contains("Bottom 조명 2번")).unwrap().clone();
        let bot2_xml = String::from_utf8(wb.bytes.get(&bot2_part).cloned().unwrap_or_default()).unwrap();
        assert!(bot2_xml.contains("<v>231</v>") && bot2_xml.contains("<v>101</v>"), "BM values missing");
        // DMG sheet: GV cells only
        let dmg = report.sheets.iter().find(|s| s.sheet.contains("DMG")).unwrap();
        assert!(dmg.gv_cells >= 4, "{dmg:?}");
    }

    #[test]
    fn normalizes_labels() {
        assert_eq!(area_base("UNIT - NonMetal - SpaceThick(목단선 GV와 평균 GV가 다를경우...)"), "UNIT - NonMetal - SpaceThick");
        assert_eq!(format_number(230.0), "230");
        assert_eq!(format_number(25127.80078), "25127.80078");
        assert_eq!(match_template_sheet("Bottom 조명 3번"), Some((Some("BOTTOM".into()), 3)));
        assert_eq!(match_template_sheet("DMG 조명 1번"), Some((None, 1)));
        assert_eq!(match_template_sheet("조명지침"), None);
    }
}
