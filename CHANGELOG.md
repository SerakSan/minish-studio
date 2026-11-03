# Minish Studio changelog

## 1.2: your pictures, more frames, easier text

- Bring your own pictures into a scene, or turn a batch into a carousel with one picture per slide. Resize, rotate, flip and layer them with the game sprites.
- Pick from 17 pixel-art frames for the canvas or an individual picture. Search Zelda themes like fairies, the Triforce, the Great Sea, Twilight, masks, hearts and rupees. These borders are designed for the editor.
- Resize dialogue boxes with eight handles and watch the words rewrap. Fit text to box adapts larger lettering, and Fit box to text makes room for all your words.
- Double-click a selected text box with Select to edit right on the canvas. Done or Ctrl/Command+Enter applies the edit, Enter adds a line, and Esc cancels. Clicking outside also applies your changes.
- Pictures stay on your device and travel with saved project files. Large picture projects can reopen from browser autosave, and private imports stay out of the shared game-art library.

## 1.1: more Hyrule, better fights, smoother controls

- Explore the whole Hyrule terrain map or the illustrated game map. Fill them with Easter eggs, reroll in one click, or try Random Hyrule animation.
- More stories, familiar faces and boss battles in Surprise me. Link and enemies now use weapons and tools, with throws, impacts and reactions.
- Added 42 weapon and item actions. Bombs fly and explode, boomerangs come back, and moving a character keeps its effects together.
- Turn sprites left or right in 45° steps in Scene and Animate. Saving, Undo and exports keep the angle.
- Pinch zoom feels more responsive. Two-finger scrolling pans, Hand is right in the Tools menu, and the zoom box accepts any percentage.
- Dragging into Animate now keeps the action, speed and movement you picked, just like Add to canvas.
- Cleaned up sprite backgrounds, fixed Minish Link and Farore pieces, and made similar-sized collection previews more consistent.
- Random scenes open centered. The Hand symbol matches the other tools, and the Scene/Animate slider is easier to read.
- The offline app now starts with **Open Minish Studio.html**. Everything is bundled, and your projects stay in your own browser unless you choose to export them.
- Added clearer Windows, Mac and Linux controls, stronger checks for private files, and a note about AI help with parts of the code, especially debugging.

## 1.0: initial public release

The first public release of Minish Studio, a free scene and animation editor for The Legend of Zelda: The Minish Cap, created by **SerakSan**.

### Scene creation

- Separate collections for environments, characters, objects, enemies, boss parts, and complete boss editor assemblies, with source and pose choices.
- Layered compositions with game-style dialogue, integer scaling, flips, ordering, duplication, and editable piece lists.
- Precise native-pixel X/Y coordinates, centered collection drags, one-pixel nudging, grid snapping, temporary snap bypass, and placement outside the export frame.
- Square, portrait, story, game-screen, and custom Free format canvases, plus multi-scene carousels.
- Setting-aware random scenes with 1,388 named setting and story combinations across 99 genuine game environments. Game-inspired and imaginative Wild modes support fresh seeds, editable results, and one-click reroll with Undo.

### Animation

- Separate Scene and Animate workspaces, connected by an Ezlo switch using seven genuine cap poses and a reduced-motion alternative.
- Simple animation: choose an action, set speed and movement, place each piece, and play without manually editing timeline frames.
- Timeline animation: editable pose sequences, movement, visibility, dialogue, frame timing, playback styles, track locks, and previous-frame preview.
- Whole-path placement in Simple, including exact coordinates and off-frame editing. Simple and Timeline share the same clip and preserve custom animation when switching modes.
- 66 reviewed ready actions across 21 sources. This includes 38 editor assembly actions across all nine boss families, using 202 of the 206 supplied complete-boss poses.
- Calibrated boss body anchors across variable pose crops, scale, and flips. One-shot transformations extend short clips and hold their final supplied pose.
- Dialogue reveal with an editable full message, speed choices, clip extension, and a reading pause.
- Independent animation clips, scene import, and editable walking examples.

Ready-action order and timing are authored for the editor. Multipart boss poses and loops are labeled **editor assemblies**, rather than extracted game-engine animation frames.

### Editing and controls

- Windows and Mac control guides with locally detected or manually selected shortcut labels.
- Copy, cut, paste, duplicate, Delete and Backspace, layer ordering, Undo/Redo, Open, and Save shortcuts, with protections for native text editing, IME/AltGr input, and dialog focus.
- Visible whole-scene and whole-animation deletion with complete Undo. Deleting the last scene or clip leaves a blank canvas in the same format.
- Pointer-anchored trackpad pinch and Ctrl+wheel zoom, plus actual-size and Fit controls. Ordinary wheel and two-finger scrolling pan the workspace.
- Focus view, responsive Art and Settings drawers, compact toolbars, contextual editing actions, and game-derived lettering and frames.

### Files and exports

- Local browser autosave and portable editable scene and animation JSON files.
- PNG scenes, transparent piece PNGs, and carousel ZIP exports.
- Lossless RGBA PNG animation frames, paged sprite sheets with timing data, animated GIF, and browser-supported MP4/WebM recording.
- Export progress and cancellation, with GIF palette/timing limits and video compression explained in the interface.
- Guides, editable examples, source credits, and publishing instructions included with the app. The SerakSan software credit is excluded from finished exports.

### Artwork, offline use, and privacy

- Included game artwork is bundled with the app. The extracted offline folder opens through `index.html` without an account, asset import, build step, or server.
- A GitHub Pages website and installable browser-app support provide another way to launch the editor. Native EXE and DMG installers are not included.
- Preserved provenance for 134 original source downloads, including contributor credits, original source URLs, checksums, and source mappings.
- Curated galleries exclude reviewed community labels, presentation material, and ambiguous edited variants. The advanced Source archive retains contributed sheets and their annotations for inspection and manual cropping.
- The collection covers its supplied manifest. It does not certify every sprite, pose, scene, hidden layer, or original animation timing in the game. Regular grid cuts do not establish internal ROM tile boundaries.
- Editing and exports run in the browser, with no editor account, analytics, or project upload service. Browser autosave is local; Save project provides a portable backup. Hosting providers still receive ordinary app-download requests.
- The original editor code is MIT-licensed to SerakSan. Game artwork and source-derived materials retain separate rights and contributor attribution.

See [README.md](README.md) for the quick start, [GUIDE.md](GUIDE.md) for editing details, [CREDITS.md](CREDITS.md) for contributors, [ASSET_RIGHTS.md](ASSET_RIGHTS.md) for artwork rights, and [PRIVACY.md](PRIVACY.md) for storage and hosting details.
