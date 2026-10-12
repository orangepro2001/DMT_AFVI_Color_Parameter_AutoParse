# AFVI UI Prototype

A 1:1, interaction-only replica of the AFVI operator screen (the reference
screenshot of the `Chromium - 4:20` window). **No functionality is wired** —
this is a pure UI/interaction prototype.

Open [index.html](index.html) directly in any Chromium browser (Edge/Chrome).
No build step, no server, no dependencies.

## What it reproduces

Layout, colours and geometry were sampled pixel-by-pixel from the reference
screenshot (2408×1190):

| Region | Details |
|---|---|
| Top nav | `HOME · TEACH · REVIEW · CALIBRATE · SETTINGS` + green `Ready` pill; TEACH active `#0079ca` |
| Icon rail | 13 tool icons, single-active highlight |
| Info bar | `MODEL / LOT / STRIP` with green accent bars; 11-button icon toolbar + colour-swatch cluster (shape, colour chip, 3 light bulbs, 4 colour rings) |
| Left thumbs | procedural blue PCB strip + red 8×15 live grid |
| Stage | empty image view (`#36353a`) |
| Log | KeepAlive console lines |
| Right panel | `Specification` / `Image Analysis` headers; **Spec** = Unit/Dummy tabs, Global/SR Align block, Overlay checkboxes, DMG selector, colour-coded overlay tree; **Analysis** = Light-1/2/3 tabs + tables, Red/Green/Blue tabs + table |

## Interactions (all client-side only)

- Nav tabs, rail icons, Unit/Dummy, Light-1/2/3, Red/Green/Blue — switch active state
- Toolbar buttons: icon buttons toggle; **bulbs** and **colour rings** are single-active
- Overlay checkboxes (MK / AC / LC / SK) and every tree checkbox — toggle
- Tree rows — click to select (white outline); parent bars colour-coded (AU/DSP/Drill = gold, NonMetal = green, ETC = violet)
- `DMG` selector — opens a mock drop list
- Tree area and log scroll

## Palette (sampled)

```
page/nav/rail   #2d2d2f      panels        #36353a     analysis col  #303030
nav active      #0079ca      ready         #9bcd32     specification #da7092
image analysis  #ffe4e2      unit tab      #6495ec     dummy tab     #add8e7
light active    #9470db      light idle    #e7e6fb     red tab       #c13635
gold bar        #ffc910      green bar     #00b050     violet bar    #6633fe
```

## Notes

- The bright red rectangles that appear around the toolbar groups in the
  reference screenshot are **annotations**, not UI, and are intentionally
  omitted.
- The layout is fluid (flex) but keeps the reference proportions
  (rail ≈ 2%, thumbs ≈ 8%, right panel ≈ 29%, nav `Ready` pill ≈ 29.5%).
- Porting target: this mirrors the existing `tauri-app` Svelte shell
  (`src/app/App.svelte`), so it can be lifted into Svelte components directly.
