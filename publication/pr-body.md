## Summary

Four-card boards become 3+1 in landscape, leaving a stranded card and unused space. This change fits cards into balanced rows using the measured board area: four cards remain 2×2 on tablets, other counts adapt to the available space, and the editor shares the same ordered geometry.

Cards retain their touch targets and accessible names. Dense play cards fit pictures beside two-line labels; windows too small for usable targets show a resize/rotate message.

Closes #31. Geometry checkpoint for #30; navigation transitions and playback recovery #28 remain separate.

## Test plan and behavior evidence

| Scenario | Expected and observed result |
| --- | --- |
| Four-card tablet rotation; counts 1–24 | Four cards stay 2×2 in both tablet orientations. Rows are balanced, ordered, within bounds and at least 44 units per side. The browser matrix also covers phone portrait/landscape without forcing two columns. |
| Rotate during queued speech or a contact/parent hold | Active and pending synthetic speech survive; stale contacts and holds cancel. Keyboard activation still selects the intended card. |
| Dense labels, pictures and editor | English/Russian/Spanish accessible names remain complete; emoji fit their frames. Existing photo crop/offline checks pass. Seven- and 24-card previews retain reachable editing controls. |
| Infeasible 320×320 window | A clear message replaces undersized cards; resizing restores the board. |

### Before / After UI evidence

**Four cards, landscape:** 3+1 becomes 2+2, using both rows. The good portrait layout is pixel-identical in the [additional matched comparisons](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/README.md).

| Before | After |
| --- | --- |
| ![Before: four cards in landscape](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/ui-final2/before-four-landscape.png?raw=true) | ![After: four cards in landscape](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/ui-final2/after-four-landscape.png?raw=true) |

**Editor preview:** seven cards form compact 4+3 rows while the existing actions stay visible.

| Before | After |
| --- | --- |
| ![Before: seven-card editor](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/ui-final2/before-seven-editor.png?raw=true) | ![After: seven-card editor](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/ui-final2/after-seven-editor.png?raw=true) |

**Dense phone board:** pictures remain whole beside deliberately ellipsized labels; accessible names keep the full wording.

| Before | After |
| --- | --- |
| ![Before: 24-card phone board](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/ui-final2/before-twenty-four-phone.png?raw=true) | ![After: 24-card phone board](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/ui-final2/after-twenty-four-phone.png?raw=true) |

Before source: `1f0329052bd46b1e953c5adb5ad7e59ba2f2dcc4` (actual master). After/current head: `b21d3ba7370c08468b868385ce9df3d875eee799`. These are actual app captures from isolated clean builds in Edge 154, with matched synthetic data, viewport, scale, theme and settled layout. [Exact source/build/fixture/image provenance](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/ui-final2/manifest.json) and [retained harness](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/capture-grid.mjs) bind the running bundles and image bytes. Service workers, speech synthesis and fullscreen behavior are normalized identically.

## Supporting checks and limitations

222 unit tests, type/release/build checks, all 92 browser tests, and Android/iOS bundle exports pass. [Validation details and complete scope](https://github.com/MChartier/little-say/blob/b3f3aa5a79d8cdb8f7b8db4a9aa98ebc009cc15f/validation.json) distinguish observed browser behavior from unexecuted native rotation, OS text scaling and screen-reader checks; no native device/emulator was available. [Current-head CI](https://github.com/MChartier/little-say/actions/runs/37562895456) passes. Independent QA is pending. The GitHub review bot [declined solely for quota](https://github.com/MChartier/little-say/pull/34#issuecomment-6029732188); no bot review completion is claimed.

Authenticated evidence access and image pixels were checked. Actual GitHub-page image rendering uses the explicit human waiver in [the workflow amendment](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6022754087).