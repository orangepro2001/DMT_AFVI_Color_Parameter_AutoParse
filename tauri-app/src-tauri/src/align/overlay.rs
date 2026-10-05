//! Colored Align/ROI overlay: the SR board body rendered green with the metal
//! marks rendered yellow on top (the real machine's Align/ROI Metal view).
//!
//! Full derivation, trade-offs and dead ends: `Plan/ALIGN_OVERLAY_DEV_NOTES.md`.
//! Summary of what the pipeline does and why:
//!
//! 1. Both layers are binarized luma masks on one working grid (bbox-cropped
//!    to their fiducial extremes, then downscaled).
//! 2. Registration anchors are the corner fiducial crosses - the machine's own
//!    align marks, and the only features whose correspondence is certain.
//!    Anchor = component bounding-box center (a window-bounded centroid is
//!    biased by clipped arms). Scale comes from the TL/BR center distance
//!    ratio; translation from the TL/BR per-corner solutions averaged (the SR
//!    cross is clipped at its own canvas edge, biasing its center inward -
//!    opposite at the two corners, so the average cancels), then a tight 卤5 px
//!    Dice-scored polish on the four fiducial windows. Wider IoU searches
//!    wander and force over-dilation; measured on model 25fbo015-15.
//! 3. Idealization ("浜屾澶勭悊", display only): a 1 px dilation compensates
//!    part of the etch shrink. NO closing - it welds the 3-5 px BGA trace gaps.
//!    Raw masks stay untouched for the real alignment stage (M2+).
//!
//! Everything returns `Result`: a model without fiducial crosses or with an
//! empty layer must degrade gracefully, never panic.

use image::{GrayImage, Rgba, RgbaImage};
use std::collections::HashSet;

pub const THRESHOLD: u8 = 128;
const SR_GREEN: [u8; 3] = [26, 158, 40];
const METAL_YELLOW: [u8; 3] = [255, 214, 0];

/// Working grid width for the composite - matched to the MEDIAN preview cap
/// (4096) so the overlay holds up under the same stage zoom. All tuned
/// parameters below are stored at the REFERENCE grid (1400, where they were
/// calibrated) and scaled proportionally at runtime.
pub const WORK_WIDTH: u32 = 4096;
/// Display compensation for the etch shrink (see module doc - why not more),
/// expressed at the WORKING grid, SEPARATE per axis: the GB marks are
/// etched thinner in x than the machine's nominal render (user compare vs
/// real machine - "妯悜澶煭"), while y already matches. Defaults calibrated
/// on model 25fbo015-15 against the machine's own Metal view.
pub const IDEALIZE_DILATE_X_PX: u32 = 4;
pub const IDEALIZE_DILATE_Y_PX: u32 = 1;
/// Parameter calibration grid (see notes 搂6/搂8.1).
const REF_WIDTH: f64 = 1400.0;
const FIDUCIAL_WIN: i64 = 160;

fn scaled_const(width: u32, reference_value: i64) -> i64 {
    (width as f64 / REF_WIDTH * reference_value as f64).round() as i64
}

fn fiducial_windows(width: u32, height: u32) -> [(i64, i64); 4] {
    let win = scaled_const(width, FIDUCIAL_WIN);
    let (w, h) = (width as i64, height as i64);
    [(0, 0), (w - win, 0), (0, h - win), (w - win, h - win)]
}

/// White-pixel bounding box of the mask.
fn bbox_bounds(mask: &GrayImage) -> Result<(i64, i64, i64, i64), String> {
    let mut x0 = i64::MAX;
    let mut y0 = i64::MAX;
    let mut x1 = i64::MIN;
    let mut y1 = i64::MIN;
    for (x, y, luma) in mask.enumerate_pixels() {
        if luma.0[0] >= THRESHOLD {
            x0 = x0.min(x as i64);
            y0 = y0.min(y as i64);
            x1 = x1.max(x as i64);
            y1 = y1.max(y as i64);
        }
    }
    if x1 <= x0 || y1 <= y0 {
        return Err("Layer mask has no white pixels - is this really a Gerber render?".into());
    }
    Ok((x0, y0, x1, y1))
}

fn crop_bounds(mask: &GrayImage, bounds: (i64, i64, i64, i64)) -> GrayImage {
    image::imageops::crop_imm(
        mask,
        bounds.0 as u32,
        bounds.1 as u32,
        (bounds.2 - bounds.0 + 1) as u32,
        (bounds.3 - bounds.1 + 1) as u32,
    )
    .to_image()
}

fn downscale_to_width(mask: &GrayImage, width: u32) -> GrayImage {
    let height = (mask.height() as f64 / mask.width() as f64 * width as f64).round() as u32;
    image::imageops::resize(mask, width, height, image::imageops::FilterType::Triangle)
}

#[derive(Clone, Copy, Debug)]
struct Point {
    x: f64,
    y: f64,
}

/// The fiducial cross nearest the `top_left` (or bottom-right) corner: seed
/// scan in the corner window, then an UNBOUNDED flood fill of that isolated
/// 4-connected component. Anchor = the component's bounding-box center - NOT
/// a window-bounded centroid, whose clipping bias reads as a fake cross
/// offset and tricks the size compensation into over-dilating.
fn cross_anchor(mask: &GrayImage, top_left: bool) -> Result<Point, String> {
    let (w, h) = (mask.width() as i64, mask.height() as i64);
    let win = ((w.min(h) as f64) * 0.18) as i64;
    let (sx, sy, dx, dy): (i64, i64, i64, i64) = if top_left { (0, 0, 1, 1) } else { (w - 1, h - 1, -1, -1) };

    let mut seed = None;
    'outer: for y in 0..win {
        for x in 0..win {
            let px = sx + dx * x;
            let py = sy + dy * y;
            if mask.get_pixel(px as u32, py as u32).0[0] >= THRESHOLD {
                seed = Some((px, py));
                break 'outer;
            }
        }
    }
    let Some((seed_x, seed_y)) = seed else {
        return Err(format!(
            "No fiducial cross found in the {} corner window.",
            if top_left { "top-left" } else { "bottom-right" }
        ));
    };

    let mut min_x = i64::MAX;
    let mut max_x = i64::MIN;
    let mut min_y = i64::MAX;
    let mut max_y = i64::MIN;
    let mut count = 0u64;
    let mut visited = HashSet::new();
    let mut stack = vec![(seed_x, seed_y)];
    while let Some((x, y)) = stack.pop() {
        if x < 0 || y < 0 || x >= w || y >= h {
            continue;
        }
        if !visited.insert((x, y)) {
            continue;
        }
        if mask.get_pixel(x as u32, y as u32).0[0] < THRESHOLD {
            continue;
        }
        count += 1;
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
        stack.push((x + 1, y));
        stack.push((x - 1, y));
        stack.push((x, y + 1));
        stack.push((x, y - 1));
        if count > 200_000 {
            return Err("Fiducial flood fill exploded - the mark is not isolated on this layer.".into());
        }
    }
    if count <= 20 {
        return Err(format!("Fiducial component suspiciously small ({count} px)."));
    }
    Ok(Point { x: (min_x + max_x) as f64 / 2.0, y: (min_y + max_y) as f64 / 2.0 })
}

/// A binary mask on the working grid.
struct CachedMask {
    img: GrayImage,
}

impl CachedMask {
    fn new(img: GrayImage) -> Self {
        Self { img }
    }

    /// The metal mask rescaled so the pattern canvas is covered at `scale`.
    fn scaled(unit: &GrayImage, canvas_width: u32, scale: f64) -> Self {
        let width = (canvas_width as f64 * scale).round() as u32;
        Self::new(downscale_to_width(unit, width))
    }
}

/// Dice = 2|A鈭〣| / (|A|+|B|) inside the four fiducial windows. Unlike IoU,
/// Dice penalizes overshoot symmetrically with shortfall: IoU keeps improving
/// while the fat yellow cross still covers more green and only objects once
/// the green is fully swallowed - which reads as blobby over-dilated marks.
fn dice_score_fiducial(metal: &CachedMask, pattern: &CachedMask, tx: i64, ty: i64) -> f64 {
    let mut both = 0u64;
    let mut m_total = 0u64;
    let mut s_total = 0u64;
    for (cx, cy) in fiducial_windows(pattern.img.width(), pattern.img.height()) {
        let win = scaled_const(pattern.img.width(), FIDUCIAL_WIN);
        for y in cy..(cy + win) {
            for x in cx..(cx + win) {
                let sr_white = pattern.img.get_pixel(x as u32, y as u32).0[0] >= THRESHOLD;
                let mx = x - tx;
                let my = y - ty;
                let in_metal =
                    mx >= 0 && my >= 0 && (mx as u32) < metal.img.width() && (my as u32) < metal.img.height();
                let m_white = in_metal && metal.img.get_pixel(mx as u32, my as u32).0[0] >= THRESHOLD;
                if sr_white {
                    s_total += 1;
                }
                if m_white {
                    m_total += 1;
                }
                if sr_white && m_white {
                    both += 1;
                }
            }
        }
    }
    let denom = m_total + s_total;
    if denom == 0 {
        return 0.0;
    }
    2.0 * both as f64 / denom as f64
}

/// Fiducial transform: scale from the TL/BR cross distance ratio; translation
/// seeded from the TL/BR per-corner solutions averaged, then a tight Dice-
/// scored polish on the fiducial windows (range scales with the working
/// grid). The tight range is deliberate: wide IoU searches measured on model
/// 25fbo015-15 wandered 5+ px away and forced over-dilation to re-cover the
/// gap.
///
/// Degenerate anchors (both metal anchors on the same feature, e.g. a layer
/// without crosses where the only white blob is found twice) are an error -
/// the infinite scale would otherwise try to allocate a terabyte-scale mask.
fn fiducial_transform(metal: &GrayImage, pattern: &CachedMask, tl_m: Point, br_m: Point, tl_p: Point, br_p: Point) -> Result<(f64, i64, i64), String> {
    let dist = |a: Point, b: Point| ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt();
    let scale = dist(tl_p, br_p) / dist(tl_m, br_m);
    let min_span = pattern.img.width().min(pattern.img.height()) as f64 * 0.25;
    if !scale.is_finite() || !(0.25..=4.0).contains(&scale) || dist(tl_m, br_m) < min_span {
        return Err(format!(
            "Fiducial anchors are degenerate (metal span {:.0}px, sr span {:.0}px, scale {scale:.2}) - no usable registration.",
            dist(tl_m, br_m),
            dist(tl_p, br_p)
        ));
    }
    let t_tl = (tl_p.x - tl_m.x * scale, tl_p.y - tl_m.y * scale);
    let t_br = (br_p.x - br_m.x * scale, br_p.y - br_m.y * scale);
    let sx = ((t_tl.0 + t_br.0) / 2.0).round() as i64;
    let sy = ((t_tl.1 + t_br.1) / 2.0).round() as i64;
    let range = scaled_const(pattern.img.width(), 5).max(2);

    let scaled = CachedMask::scaled(metal, pattern.img.width(), scale);
    let mut best = (sx, sy, dice_score_fiducial(&scaled, pattern, sx, sy));
    for ty in (sy - range)..=(sy + range) {
        for tx in (sx - range)..=(sx + range) {
            let score = dice_score_fiducial(&scaled, pattern, tx, ty);
            if score > best.2 {
                best = (tx, ty, score);
            }
        }
    }
    Ok((scale, best.0, best.1))
}

/// Display compensation ("浜屾澶勭悊") for the etch shrink: an ANISOTROPIC
/// dilation (separate x/y radii - the GB marks are etched thinner in x than
/// the machine's nominal render). NO closing - measured on model
/// 25fbo015-15, any closing r1+ welds the 3-5 px BGA trace gaps into a blob,
/// far worse than the wobble it fixes. The fiducial crosses are different
/// nominal designs on the two layers (small symmetric mark vs long thin
/// opening) and can never size-match by growth - "concentric + fuller +
/// gaps intact" is the goal.
fn idealize(metal: &GrayImage, dilate_x: u32, dilate_y: u32) -> GrayImage {
    let mut out = metal.clone();
    if dilate_x > 0 {
        out = dilate_axis(&out, dilate_x as i64, 0);
    }
    if dilate_y > 0 {
        out = dilate_axis(&out, 0, dilate_y as i64);
    }
    out
}

/// Rectangle dilation via separable 1-D max passes (imageproc's morphology is
/// isotropic only). O(w路h路(rx+ry)) - fine at working grid.
fn dilate_axis(mask: &GrayImage, rx: i64, ry: i64) -> GrayImage {
    let (w, h) = (mask.width() as i64, mask.height() as i64);
    let mut out = mask.clone();
    if rx > 0 {
        let src = out.clone();
        for y in 0..h {
            for x in 0..w {
                if src.get_pixel(x as u32, y as u32).0[0] >= THRESHOLD {
                    continue;
                }
                let x0 = (x - rx).max(0);
                let x1 = (x + rx).min(w - 1);
                for xx in x0..=x1 {
                    if src.get_pixel(xx as u32, y as u32).0[0] >= THRESHOLD {
                        out.put_pixel(x as u32, y as u32, image::Luma([255]));
                        break;
                    }
                }
            }
        }
    }
    if ry > 0 {
        let src = out.clone();
        for y in 0..h {
            for x in 0..w {
                if src.get_pixel(x as u32, y as u32).0[0] >= THRESHOLD {
                    continue;
                }
                let y0 = (y - ry).max(0);
                let y1 = (y + ry).min(h - 1);
                for yy in y0..=y1 {
                    if src.get_pixel(x as u32, yy as u32).0[0] >= THRESHOLD {
                        out.put_pixel(x as u32, y as u32, image::Luma([255]));
                        break;
                    }
                }
            }
        }
    }
    out
}

/// Paints the colored render. Yellow is masked to the SR layer's WHITE
/// regions (the user's "鍦ㄧ豢婕嗛潰瀵瑰簲閮ㄥ垎閲屾秱榛?): metal features over Open
/// areas (SR black, e.g. the BGA Open rectangles) must stay black, exactly
/// like the real machine's Metal view.
fn render_composite(pattern: &CachedMask, metal: &CachedMask, tx: i64, ty: i64) -> RgbaImage {
    let (width, height) = (pattern.img.width(), pattern.img.height());
    let mut out = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 255]));
    for y in 0..height {
        for x in 0..width {
            let sr_white = pattern.img.get_pixel(x, y).0[0] >= THRESHOLD;
            if sr_white {
                out.put_pixel(x, y, Rgba([SR_GREEN[0], SR_GREEN[1], SR_GREEN[2], 255]));
            }
            let mx = x as i64 - tx;
            let my = y as i64 - ty;
            let in_metal = mx >= 0 && my >= 0 && (mx as u32) < metal.img.width() && (my as u32) < metal.img.height();
            if sr_white
                && in_metal
                && metal.img.get_pixel(mx as u32, my as u32).0[0] >= THRESHOLD
            {
                out.put_pixel(x, y, Rgba([METAL_YELLOW[0], METAL_YELLOW[1], METAL_YELLOW[2], 255]));
            }
        }
    }
    out
}

/// Whole-board Dice for the placed metal mask. The acceptance metric for any
/// refinement: a candidate placement is only adopted if it beats the current
/// one here - tile votes on the periodic BGA band can lock onto trace-pitch
/// multiples and must not be trusted blindly.
fn dice_board(metal: &CachedMask, pattern: &CachedMask, tx: i64, ty: i64) -> f64 {
    let (pw, ph) = (pattern.img.width() as i64, pattern.img.height() as i64);
    let (uw, uh) = (metal.img.width() as i64, metal.img.height() as i64);
    let x0 = tx.max(0);
    let y0 = ty.max(0);
    let x1 = (tx + uw).min(pw);
    let y1 = (ty + uh).min(ph);
    if x0 >= x1 || y0 >= y1 {
        return 0.0;
    }
    let mut both = 0u64;
    for y in y0..y1 {
        for x in x0..x1 {
            if pattern.img.get_pixel(x as u32, y as u32).0[0] >= THRESHOLD
                && metal.img.get_pixel((x - tx) as u32, (y - ty) as u32).0[0] >= THRESHOLD
            {
                both += 1;
            }
        }
    }
    let denom = metal_white_count(metal) + sr_white_count(pattern);
    if denom == 0 {
        return 0.0;
    }
    2.0 * both as f64 / denom as f64
}

fn metal_white_count(metal: &CachedMask) -> u64 {
    metal.img.pixels().filter(|l| l.0[0] >= THRESHOLD).count() as u64
}

fn sr_white_count(pattern: &CachedMask) -> u64 {
    pattern.img.pixels().filter(|l| l.0[0] >= THRESHOLD).count() as u64
}

/// Multi-region local refinement (the "不同区域增益不一样" fix): the corner
/// crosses are asymmetric designs, so a single transform fitted on them
/// carries a bias that grows toward the board center (half a BGA pitch on
/// model 25fbo015-15). Instead, probe a 3x3 grid of tiles across the board,
/// find each tile's best local offset by Dice, then robustly fit scale +
/// translation from all tile votes (least squares with outlier rejection).
/// Tiles over featureless/Open areas fail the score gate and are dropped -
/// every region thus gets its own locally-correct alignment, and the fit
/// averages out the periodic-trace ambiguity.
fn refine_local(metal: &GrayImage, pattern: &CachedMask, scale: f64, tx: i64, ty: i64) -> (f64, i64, i64) {
    let (w, h) = (pattern.img.width() as i64, pattern.img.height() as i64);
    let tile = (scaled_const(w as u32, 100) as f64).max(40.0) as i64; // half-size
    // tight search: after the fiducial seed the residual is small; a wide
    // range lets tiles on the periodic BGA band lock onto trace-pitch
    // multiples and vote garbage
    let range = scaled_const(w as u32, 12).max(4);

    // quarter-resolution proxies for the coarse per-tile search
    let q_w = (w as f64 / 4.0).round() as u32;
    let pat_q = CachedMask::new(downscale_to_width(&pattern.img, q_w));
    let m_q = downscale_to_width(metal, q_w);
    let q = 4.0f64;

    let mut votes: Vec<((i64, i64), (i64, i64))> = Vec::new(); // (tile center, measured offset)
    for gy in 1..=3 {
        for gx in 1..=3 {
            let cx = w * gx / 4;
            let cy = h * gy / 4;
            // coarse search on the quarter-res pair
            let (qc_x, qc_y) = ((cx as f64 / q).round() as i64, (cy as f64 / q).round() as i64);
            let qr = (range as f64 / q).ceil() as i64;
            let scaled_q = CachedMask::scaled(&m_q, pat_q.img.width(), scale);
            let btx = (tx as f64 * q).round() as i64;
            let bty = (ty as f64 * q).round() as i64;
            let mut best = (0i64, 0i64, f64::MIN);
            for dy in -qr..=qr {
                for dx in -qr..=qr {
                    let score =
                        dice_tile_window(&scaled_q, &pat_q, btx, bty, qc_x, qc_y, dx, dy, tile / 4);
                    if score > best.2 {
                        best = (dx, dy, score);
                    }
                }
            }
            if best.2 < 0.05 {
                continue; // featureless/Open tile - no vote
            }
            // full-res refine around the coarse winner
            let scaled = CachedMask::scaled(metal, w as u32, scale);
            let c_dx = (best.0 as f64 * q).round() as i64;
            let c_dy = (best.1 as f64 * q).round() as i64;
            let mut fine = (c_dx, c_dy, f64::MIN);
            for dy in (c_dy - 3)..=(c_dy + 3) {
                for dx in (c_dx - 3)..=(c_dx + 3) {
                    let score = dice_tile_window(&scaled, pattern, tx, ty, cx, cy, dx, dy, tile);
                    if score > fine.2 {
                        fine = (dx, dy, score);
                    }
                }
            }
            if fine.2 >= 0.05 {
                votes.push(((cx, cy), (fine.0, fine.1)));
            }
        }
    }
    if votes.len() < 2 {
        println!("refine local: only {} usable tiles - keeping fiducial placement", votes.len());
        return (scale, tx, ty);
    }

    // Robust per-axis least squares: o = k*(p - c) + t, outliers rejected once.
    let (kx, tx_new) = fit_axis(&votes, w, 0);
    let (ky, ty_new) = fit_axis(&votes, h, 1);
    let new_scale = scale * (1.0 + (kx + ky) / 2.0);
    let (ntx, nty) = (tx_new, ty_new);
    println!(
        "refine local: {} votes, k=({kx:.4},{ky:.4}) offset ({ntx}, {nty})",
        votes.len()
    );
    let clamped = (new_scale - scale) / scale;
    if clamped.abs() > 0.03 {
        println!("refine local: scale drift {clamped:.3} out of range - keeping fiducial placement");
        return (scale, tx, ty);
    }

    // ACCEPTANCE GATE: the candidate must beat the fiducial placement on the
    // whole-board Dice, not just inside the voting tiles. Tile votes on the
    // periodic BGA band can lock onto trace-pitch multiples and vote a wild
    // translation (measured (21,-80) on the real model) that scores great
    // locally and wrecks the rest of the board.
    let candidate = CachedMask::scaled(metal, pattern.img.width(), new_scale);
    let old_score = dice_board(&CachedMask::scaled(metal, pattern.img.width(), scale), pattern, tx, ty);
    let new_score = dice_board(&candidate, pattern, ntx, nty);
    println!("refine local: board dice old {old_score:.4} vs new {new_score:.4}");
    if new_score > old_score + 0.005 {
        (new_scale, ntx, nty)
    } else {
        println!("refine local: not better on whole board - keeping fiducial placement");
        (scale, tx, ty)
    }
}

/// Dice of the placed metal mask restricted to a square window centered at
/// (cx, cy) (tile center in canvas coords), with the metal layer at extra
/// offset (dx, dy) from the base placement (tx, ty).
fn dice_tile_window(
    metal: &CachedMask,
    pattern: &CachedMask,
    tx: i64,
    ty: i64,
    cx: i64,
    cy: i64,
    dx: i64,
    dy: i64,
    tile: i64,
) -> f64 {
    let (w, h) = (pattern.img.width() as i64, pattern.img.height() as i64);
    let half = tile / 2;
    let x0 = (cx - half).max(0);
    let y0 = (cy - half).max(0);
    let x1 = (cx + half).min(w);
    let y1 = (cy + half).min(h);
    let mut both = 0u64;
    let mut m_total = 0u64;
    let mut s_total = 0u64;
    for y in y0..y1 {
        for x in x0..x1 {
            let s_white = pattern.img.get_pixel(x as u32, y as u32).0[0] >= THRESHOLD;
            let mx = x - tx - dx;
            let my = y - ty - dy;
            let in_metal =
                mx >= 0 && my >= 0 && (mx as u32) < metal.img.width() && (my as u32) < metal.img.height();
            let m_white = in_metal && metal.img.get_pixel(mx as u32, my as u32).0[0] >= THRESHOLD;
            if s_white {
                s_total += 1;
            }
            if m_white {
                m_total += 1;
            }
            if s_white && m_white {
                both += 1;
            }
        }
    }
    let denom = m_total + s_total;
    if denom == 0 {
        return 0.0;
    }
    2.0 * both as f64 / denom as f64
}

/// Robust per-axis fit of o = k*(p - c) + t over the votes (axis = 0 for x,
/// 1 for y). One round of outlier rejection at 2.5x the median |residual|.
fn fit_axis(votes: &[((i64, i64), (i64, i64))], dim: i64, axis: usize) -> (f64, i64) {
    let c = dim as f64 / 2.0;
    let mut pts: Vec<(f64, f64)> = votes
        .iter()
        .map(|((cx, cy), (dx, dy))| {
            let p = if axis == 0 { *cx as f64 } else { *cy as f64 };
            let o = if axis == 0 { *dx as f64 } else { *dy as f64 };
            (p - c, o)
        })
        .collect();
    let lsq = |pts: &[(f64, f64)]| -> (f64, f64) {
        let n = pts.len() as f64;
        let sp: f64 = pts.iter().map(|(p, _)| p).sum();
        let so: f64 = pts.iter().map(|(_, o)| o).sum();
        let spp: f64 = pts.iter().map(|(p, _)| p * p).sum();
        let spo: f64 = pts.iter().map(|(p, o)| p * o).sum();
        let denom = n * spp - sp * sp;
        if denom.abs() < 1e-9 {
            return (0.0, so / n);
        }
        let k = (n * spo - sp * so) / denom;
        let t = (so - k * sp) / n;
        (k, t)
    };
    let (k, t) = lsq(&pts);
    let mut residuals: Vec<f64> = pts.iter().map(|(p, o)| (o - (k * p + t)).abs()).collect();
    residuals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = residuals[residuals.len() / 2];
    let tol = (med * 2.5).max(2.0);
    pts.retain(|(p, o)| (o - (k * p + t)).abs() <= tol);
    let (k, t) = lsq(&pts);
    (k, t.round() as i64)
}

/// Full display pipeline for one side's layer pair (decoded luma8, any
/// resolution): fiducial registration -> whole-board refinement ->
/// idealization -> colored RGBA composite. `dilate_x`/`dilate_y` are the
/// display compensation at the working grid.
///
/// BOTH layers are cropped to their UNION white bounding box and rescaled by
/// the SAME factor. Cropping each to its own bbox would put every layer in a
/// private coordinate frame (different origins AND different scale factors -
/// a 6% size mismatch on model 25fbo015-15), making the anchor math and the
/// render disagree; the union box gives both layers one shared frame.
pub fn compose_overlay_with(
    sr_layer: &GrayImage,
    metal_layer: &GrayImage,
    work_width: u32,
    dilate_x: u32,
    dilate_y: u32,
) -> Result<RgbaImage, String> {
    let sb = bbox_bounds(sr_layer)?;
    let mb = bbox_bounds(metal_layer)?;
    let union = (sb.0.min(mb.0), sb.1.min(mb.1), sb.2.max(mb.2), sb.3.max(mb.3));
    let sr = downscale_to_width(&crop_bounds(sr_layer, union), work_width);
    let metal = downscale_to_width(&crop_bounds(metal_layer, union), work_width);
    let pattern = CachedMask::new(sr);

    let tl_s = cross_anchor(&pattern.img, true)?;
    let br_s = cross_anchor(&pattern.img, false)?;
    let tl_m = cross_anchor(&metal, true)?;
    let br_m = cross_anchor(&metal, false)?;
    #[cfg(test)]
    eprintln!("overlay anchors: sr TL{tl_s:?} BR{br_s:?} | metal TL{tl_m:?} BR{br_m:?}");
    let (scale, tx, ty) = fiducial_transform(&metal, &pattern, tl_m, br_m, tl_s, br_s)?;
    let (scale, tx, ty) = refine_local(&metal, &pattern, scale, tx, ty);
    #[cfg(test)]
    eprintln!("overlay transform: scale {scale:.4} offset ({tx}, {ty})");

    let ideal = idealize(&metal, dilate_x, dilate_y);
    let metal_mask = CachedMask::scaled(&ideal, pattern.img.width(), scale);
    Ok(render_composite(&pattern, &metal_mask, tx, ty))
}

/// The app default: full working resolution + calibrated compensation.
pub fn compose_overlay(sr_layer: &GrayImage, metal_layer: &GrayImage) -> Result<RgbaImage, String> {
    compose_overlay_with(sr_layer, metal_layer, WORK_WIDTH, IDEALIZE_DILATE_X_PX, IDEALIZE_DILATE_Y_PX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Proportional synthetic pair on a `w`-wide canvas (3:4 aspect): board
    /// body + two isolated fiducial crosses (TL/BR, outside the board so the
    /// anchor flood fill cannot leak into it) on the SR layer; smaller offset
    /// crosses + a pad rectangle on the metal layer. Tests run at a small
    /// width to stay fast; the pipeline is fully scale-proportional.
    fn synthetic_pair(w: i64, offset: (i64, i64)) -> (GrayImage, GrayImage) {
        let h = w * 3 / 4;
        let mut sr = GrayImage::from_pixel(w as u32, h as u32, image::Luma([0]));
        let mut m = GrayImage::from_pixel(w as u32, h as u32, image::Luma([0]));

        let board_x0 = w / 8;
        let board_x1 = w * 7 / 8;
        let board_y0 = h / 6;
        let board_y1 = h * 23 / 30;
        for y in board_y0..board_y1 {
            for x in board_x0..board_x1 {
                sr.put_pixel(x as u32, y as u32, image::Luma([255]));
            }
        }

        let arm = (w as f64 * 105.0 / 1400.0).round() as i64;
        let arm_m = (w as f64 * 70.0 / 1400.0).round() as i64;
        let thick = (w as f64 * 21.0 / 1400.0).round() as i64;
        let thick_m = (w as f64 * 17.0 / 1400.0).round() as i64;
        let (tl_x, tl_y) = (w * 1 / 10, h * 2 / 15);
        let (br_x, br_y) = (w * 17 / 20, h * 31 / 35);

        let draw_cross = |mask: &mut GrayImage, cx: i64, cy: i64, arm: i64, thick: i64| {
            let (mw, mh) = (mask.width() as i64, mask.height() as i64);
            for y in (cy - arm)..=(cy + arm) {
                for x in (cx - thick / 2)..=(cx + thick / 2) {
                    if x >= 0 && y >= 0 && x < mw && y < mh {
                        mask.put_pixel(x as u32, y as u32, image::Luma([255]));
                    }
                }
            }
            for x in (cx - arm)..=(cx + arm) {
                for y in (cy - thick / 2)..=(cy + thick / 2) {
                    if x >= 0 && y >= 0 && x < mw && y < mh {
                        mask.put_pixel(x as u32, y as u32, image::Luma([255]));
                    }
                }
            }
        };
        draw_cross(&mut sr, tl_x, tl_y, arm, thick);
        draw_cross(&mut sr, br_x, br_y, arm, thick);
        draw_cross(&mut m, tl_x - offset.0, tl_y - offset.1, arm_m, thick_m);
        draw_cross(&mut m, br_x - offset.0, br_y - offset.1, arm_m, thick_m);

        // metal pad inside the board - drawn at the SAME nominal coordinates
        // as everything else, shifted by the layer offset (a rigid layer
        // shifts as a whole)
        let pad_x0 = w * 3 / 8 - offset.0;
        let pad_x1 = w * 19 / 40 - offset.0;
        let pad_y0 = h * 2 / 5 - offset.1;
        let pad_y1 = h * 7 / 15 - offset.1;
        for y in pad_y0..pad_y1 {
            for x in pad_x0..pad_x1 {
                m.put_pixel(x as u32, y as u32, image::Luma([255]));
            }
        }

        // An Open band (SR black) with thin white lines inside, mirrored on
        // the metal layer at the SAME nominal coordinates (the metal copy
        // rigidly shifted by the layer offset): the fine-stripe structure
        // gives the whole-board Dice polish a sharp peak at the true offset -
        // without it, a pad that is white-on-white everywhere cannot
        // discriminate placements a couple of pixels apart.
        let band_x0 = pad_x1 + w / 20;
        let band_x1 = band_x0 + w / 5;
        for y in pad_y0..pad_y1 {
            for x in band_x0..band_x1 {
                sr.put_pixel(x as u32, y as u32, image::Luma([0]));
            }
        }
        let line = (w as f64 * 6.0 / 1400.0).round() as i64;
        for i in 0..4 {
            let lx = band_x0 + i * (band_x1 - band_x0) / 4;
            for y in pad_y0..pad_y1 {
                for dx in 0..line {
                    let x_nominal = lx + dx;
                    if x_nominal >= 0 && (x_nominal as u32) < sr.width() {
                        sr.put_pixel(x_nominal as u32, y as u32, image::Luma([255]));
                    }
                    let mx = x_nominal - offset.0;
                    let my = y - offset.1;
                    if mx >= 0 && my >= 0 && (mx as u32) < m.width() && (my as u32) < m.height() {
                        m.put_pixel(mx as u32, y as u32, image::Luma([255]));
                    }
                }
            }
        }
        (sr, m)
    }

    fn is_yellow(out: &RgbaImage, x: u32, y: u32) -> bool {
        let p = out.get_pixel(x, y).0;
        p[0] == METAL_YELLOW[0] && p[1] == METAL_YELLOW[1]
    }

    fn is_green(out: &RgbaImage, x: u32, y: u32) -> bool {
        let p = out.get_pixel(x, y).0;
        p[1] == SR_GREEN[1] && p[0] == SR_GREEN[0]
    }

    #[test]
    fn composite_is_green_on_board_yellow_on_marks_black_outside() {
        let (sr, metal) = synthetic_pair(350, (0, 0));
        let out = compose_overlay_with(&sr, &metal, 350, 1, 1).unwrap();
        #[cfg(test)]
        out.save(r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\Plan\debug_composite.png").ok();
        let (w, h) = (350i64, 262i64);
        let (gx, gy) = ((w * 3 / 4) as u32, (h / 2) as u32);
        eprintln!("debug: pixel at ({gx},{gy}) = {:?}", out.get_pixel(gx, gy).0);
        assert!(is_green(&out, gx, gy), "board body must be green");
        assert!(*out.get_pixel(5, 5).0.first().unwrap() == 0, "background stays black");
        assert!(is_yellow(&out, (w * 17 / 40) as u32, (h * 13 / 30) as u32), "metal pad must be yellow");
    }

    #[test]
    fn registration_recovers_the_inter_layer_offset() {
        let (sr, metal) = synthetic_pair(350, (6, 4));
        let out = compose_overlay_with(&sr, &metal, 350, 1, 1).unwrap();
        // at w=350 the (6,4) offset is ~1-2 px; the pad is 35x18 px, so the
        // nominal spot must be yellow after a successful registration
        let (w, h) = (350i64, 262i64);
        let (px, py) = ((w * 17 / 40) as u32, (h * 13 / 30) as u32);
        #[cfg(test)]
        out.save(r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\Plan\debug_reg_fail.png").ok();
        assert!(is_yellow(&out, px, py), "pad must be painted at its nominal spot");
    }

    #[test]
    fn missing_fiducial_cross_is_an_error_not_a_panic() {
        let (sr, _) = synthetic_pair(350, (0, 0));
        // metal with marks but NO corner crosses
        let mut metal = GrayImage::from_pixel(350, 262, image::Luma([0]));
        for y in 104..122 {
            for x in 131..166 {
                metal.put_pixel(x, y, image::Luma([255]));
            }
        }
        let error = compose_overlay_with(&sr, &metal, 350, 1, 1).unwrap_err();
        assert!(error.to_lowercase().contains("fiducial"), "{error}");
    }

    #[test]
    fn empty_layer_is_an_error_not_a_panic() {
        let (sr, _) = synthetic_pair(350, (0, 0));
        let empty = GrayImage::from_pixel(350, 262, image::Luma([0]));
        assert!(compose_overlay_with(&sr, &empty, 350, 1, 1).is_err());
        assert!(compose_overlay_with(&empty, &empty, 350, 1, 1).is_err());
    }

    #[test]
    fn idealize_grows_white_regions_by_the_compensation() {
        let mut metal = GrayImage::from_pixel(50, 50, image::Luma([0]));
        for y in 20..30 {
            for x in 20..30 {
                metal.put_pixel(x, y, image::Luma([255]));
            }
        }
        let grown = idealize(&metal, 1, 1);
        assert!(grown.get_pixel(19, 25).0[0] >= THRESHOLD);
        assert!(grown.get_pixel(25, 19).0[0] >= THRESHOLD);
        assert!(grown.get_pixel(31, 31).0[0] < THRESHOLD, "dilation is exactly 1 px");

        // anisotropic: x-only compensation must leave y margins untouched
        let wide = idealize(&metal, 2, 0);
        assert!(wide.get_pixel(18, 25).0[0] >= THRESHOLD, "x compensation applies");
        assert!(wide.get_pixel(25, 18).0[0] < THRESHOLD, "y stays untouched when dilate_y is 0");
    }

    #[test]
    #[ignore = "slow: runs the full 4096 pipeline in debug; real-data coverage via the align_overlay_check example"]
    fn default_works_at_full_resolution() {
        let (sr, metal) = synthetic_pair(WORK_WIDTH as i64, (14, 9));
        let out = compose_overlay(&sr, &metal).unwrap();
        assert_eq!(out.width(), WORK_WIDTH);
        let (w, h) = (WORK_WIDTH as i64, WORK_WIDTH as i64 * 3 / 4);
        assert!(is_yellow(&out, (w * 21 / 40) as u32, (h * 13 / 30) as u32), "pad painted at nominal spot at full res");
    }
}
