# ScribeFlow Changelog

All notable changes are documented here. Version increments by tenths.

---

## Version 0.5 — Current Release

### New Features

**Document Style — Research template**
- Added a "Research" document style (🔬) to the style picker on new project creation
- Research projects get folders: Topics, Sources, Notes, References
- Research style unlocks a new "Research Type" settings tab

**Research Type tab**
- Appears in Settings only for Research-style projects
- Two options: **Academics** (standard outline/sources layout) and **Pastoral Sermons**

**Pastoral Sermons layout**
- When Pastoral Sermons is selected and saved, the editor pane splits horizontally
- Top pane: live **Bible scripture viewer** with:
  - Translation picker: KJV, WEB, BBE, ASV, Darby, YLT
  - Reference input (e.g. `John 3:16`, `Psalm 23`, `Romans 8:1-8`)
  - Verse-numbered display pulled from bible-api.com (no account required)
  - Vertically resizable divider between scripture and writing panes
- Bottom pane: standard writing editor
- Layout applies immediately after saving settings and persists across sessions

**Version tracking**
- Version number now shown in the toolbar (`v0.5`)
- Version displayed in server startup log and `/api/health` endpoint
- This CHANGELOG tracks all future increments

### Improvements

**Hot-Links auto-registration**
- Creating character or place pages from the Characters/Places settings tabs now automatically registers those documents as Hot-Links with the correct type badge
- No duplicate entries — documents already linked are skipped
- Hot-Links panel and document picker refresh immediately after creation

**Status bar always visible**
- The goal progress bar at the bottom of the editor now appears as soon as any project is open, even when no goals are set
- Shows placeholder text ("no daily goal" / "no final goal") until goals are configured in Settings → Goals

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.5 | 2026-03 | Research/Pastoral Sermons, Bible pane, version tracking, HL auto-register |

---

*ScribeFlow is self-hosted. Deploy via Docker (`docker compose up -d`) or Proxmox LXC (`bash lxc/install.sh`). Data persists in the `scribeflow_data` volume across all updates.*
