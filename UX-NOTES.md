# Minish Studio v6: usability decisions

The primary tasks are arranging scenes and animating genuine game artwork. Simple offers a short choose, place, play workflow. Timeline keeps direct control of poses and timing. Both use the same animation clip and preserve the scene maker as a separate workspace. The notes below record the decisions behind each revision.

## Scene workflow foundation, version 4.0

The v3 interface made source labels look like assets, hid too much pose context, and gave a small canvas most of the remaining space. Version 4 addressed these problems while retaining the game's visual style.

| Finding | Change | Purpose |
| --- | --- | --- |
| A mode change was easy to miss | Persistent Paint, Select, and Erase controls with a plain-language instruction | Make the next canvas action predictable |
| A large source sheet mixed art with community presentation | Curated gallery and clean region tile views; raw sheets moved to Source archive | Make the safe choice the normal choice |
| Hundreds of anonymous boss parts resembled complete poses | Complete boss state/direction filters and a separate parts collection | Show recognizable choices and their scope |
| An assembled boss was difficult to customize | Edit boss parts, plus one-step Undo | Expose power without requiring manual assembly first |
| Old boss images could survive an update | Contextual Update older boss action | Preserve saved work while offering a clear correction |
| The canvas was crowded by panels | Focus view and return-to-panels control | Give the main editing task more room |
| A new scene required several setup steps | Setting-aware Random scene with an optional repeat seed | Provide an editable starting point without overwriting work |
| Automatic seeds could silently repeat the next scene | Fresh random seed unless a repeat seed is explicitly entered | Keep Random scene consistent with its label |
| Pixel art could blur at half-pixel canvas positions | Integer zoom, nearest-neighbor rendering, and whole-pixel canvas alignment | Preserve crisp display and export |

Open, Save, and Export remain visible. Less frequent file/help/credit actions use More. Advanced crop and seed controls use progressive disclosure. Picture choices reduce the need to remember source row numbers. The source archive retains all provenance without treating every contributed pixel as a verified game asset.

These are heuristic design decisions informed by Nielsen Norman Group's [usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) and [recognition rather than recall guidance](https://www.nngroup.com/articles/recognition-and-recall/). They are not a claim of a formal user study or universal accessibility certification.

Validation covers responsive layouts, semantic controls, keyboard shortcuts, Undo safety, saved-project compatibility, deterministic generation, and PNG exports. Boss and environment authenticity use separate source mapping and visual review reports.

## Precise placement and Surprise me, version 4.1

Library cards and the chosen-piece preview now support a real centered drag. A live preview shows the snapped result before release. One-pixel mode, Alt snap bypass, explicit X/Y inputs, and visible nudge controls cover both quick tile building and exact adjustments. Existing pieces move by snapped displacement, preserving their initial grid offset.

The scene frame and editor pasteboard are separate. Off-frame artwork appears faintly, can be selected and moved, and is excluded from the exported frame. The pasteboard uses surrounding workspace without moving the frame during a drag. Fit accounts for the editor margins. Browser checks confirmed a centered 18 × 23 sprite drop, negative coordinates, complete off-frame placement and reselection, one-pixel nudging, and a fully transparent 960 × 640 export when the only piece was outside the frame.

Surprise me now offers story mood and cast size alongside the setting. Twenty-two story setups vary compatible cast groups, genuine poses, formations, and safe camera framing. A focused test checks 2,700 deterministic compositions, including collision-free placement, valid source crops, peaceful settings, all story setups, and more than 2,000 distinct arrangements. This is a technical and visual review, not a user study. The 390 px mobile view keeps the new controls and random-scene dialog within the page width.

## Windows, Mac, and one-click surprises, version 4.2

Controls now has one comparison table for Windows and Mac, mouse and trackpad instructions, and plain-language descriptions of the scene, collection, file, and editing controls. Labels detect the platform locally and can be overridden. Shortcut handling shares one definition, protects native field editing and composition, respects handled widget events, and keeps Mac Control-click as a secondary click. Browser checks confirmed platform label switching, Mac Duplicate/Undo, Ctrl+Y Redo, and collection-tab arrow navigation without moving the selected piece. Native Windows keyboard mappings are covered by automated event tests; the available browser preview runs on Mac.

Random generation now has 1,388 named setting/story/style choices, including 200 Game-inspired and 1,188 Wild combinations across 99 genuine game environments. These are counted setting/story pairs, separate from seed, pose, density, and formation variations. Game-inspired interiors use reviewed foot zones. Wild mode explicitly invents unlikely encounters and does not claim game collision accuracy. All 1,388 choices were constructed with three seeds, in addition to the original-setting density tests; all nine boss families are reachable and two-boss summit stories contain two complete editor boss assemblies. Native contact sheets were reviewed for indoor placement and creative composition.

Surprise me again rerolls a generated scene in the same carousel slot, preserving its requested options and using a fresh seed. One Undo restores all prior pieces. Scenes started from scratch are preserved and receive a new neighboring scene. A shared busy guard prevents overlapping generation requests, and scene changes or edits during image loading cancel a pending replacement. The settings dialog shows the available combination count and disables setting choices that are unavailable for its current style.

## Animation workspace, version 5.0

Scene and Animate are independent workspaces. The mode switch sits between the maker name and game logo. The scene editor keeps its projects and focus choice. Animation has separate clips, saves, and Undo, with a copy-based import from the current scene.

The first-use choices are Animate my current scene and a walking demo. The demo uses ten visually reviewed, genuine back-facing Link walking poses. Its two clips demonstrate movement through a real Hyrule Town region and a transparent repeating pose cycle. Pose groups remain source groupings, since a source row can mix directions or actions. Variable crop sizes preserve actor feet or object centers rather than making sprites wobble.

The timeline combines a playhead, exact frame field, scrubber, track list, and editable keys. Position uses integer interpolation; pose, visibility, and other piece properties hold until their next key. Auto Key records edits at the playhead. Motion, pose sequences, and text reveal are atomic Undo actions. Draft fields commit before Save, Export, typewriter creation, or workspace switching, including a blur fallback. A browser regression confirmed that one Undo after text reveal restores the complete typed dialogue.

Keyboard focus is limited to the current timeline cell on each track rather than every empty cell. Focused timeline arrows navigate frames and tracks; canvas arrows nudge pieces. Windows and Mac shortcuts have native text-field and IME protections. On smaller screens, Art and Settings use drawers. Focus hides panels and reduces the timeline to transport and scrubbing, allowing a larger pixel preview.

Browser export verification checked every one of the 48 walking-demo GIF frames against its corresponding lossless PNG: all RGBA pixels matched, 37 rendered frames were distinct, and GIF duration was 4,000 ms. The real MP4 export decoded at 240 × 160 with a 3.95-second duration and no media error. Export tests also verify GIF dictionary growth/reset, transparency, palette reduction notices, atlas reconstruction, cancellation, memory limits, and video cleanup. PNG retains exact RGBA; GIF palette/timing constraints and browser video compression are explained in the export interface.

## Simple animation and Ezlo switch, version 6.0.0

Simple is the default for new animation work. It hides the timeline, key controls, frame counts, and recording options. The main workflow is choosing artwork and an action, placing the piece, and pressing Play. Settings presents Action, Speed, Movement, and Distance together with one Apply animation button. Clip length is shown in seconds. Art offers separate Animations and Still poses views, so a newcomer can choose a recognizable action while exact pose choices remain available.

Dragging or nudging in Simple moves the entire path. Exact X/Y controls and off-frame placement remain available, including while paused midway through a loop. Custom position keys translate with the piece without changing their timing or pose choices. This makes placement behave consistently with arranging a scene. Variable poses keep actor feet or object centers anchored, and motion stays on whole native pixels.

Simple and Timeline share one clip rather than making separate copies. A ready action becomes editable keys in Timeline. Returning to Simple preserves custom keys and shows a clear notice when they differ from the ready recipe. Replacing that piece's action and movement requires the explicit Replace this piece’s animation control; visibility and visual settings remain intact. Undo covers the recipe and its generated keys as one action. Moving or duplicating a piece does not require replacing its custom animation.

The ready catalog contains 32 visually reviewed loops across 15 sources. Each action lists specific source poses instead of cycling a row that might contain loose parts, different directions, or contributor text. Link, Zelda, animals, enemies, effects, and three assembled boss sources have ready choices. Sources without a reviewed loop retain still-pose selection, placement, movement, and Timeline authoring. These are genuine game pixels with editor-authored order and timing. Boss loops are labeled editor assemblies; neither the source collection nor this catalog claims all ROM animations.

Dialogue has a Simple Text reveal action. The editable field retains the full phrase while the preview shows partial text. Slow, Normal, and Fast control the reveal. A short clip extends to fit the message and a reading pause, with the existing 600-frame limit. Existing unmodified ready loops extend with it. A message that cannot fit is rejected without truncating its text or changing the project.

The workspace switch uses seven genuine Ezlo cap poses from source 6372. Ezlo faces and travels toward Animate on the right or Scene on the left. Source pixels use integer enlargement and nearest-neighbor rendering; the short travel and pose timing are authored for the interface. Reduced motion shows the destination without travel. The two labeled buttons remain keyboard controls, and rapid mode changes can reverse the transition without delaying access to the workspace.

The layout uses the existing stone, parchment, and game dialogue framing with a clearer hierarchy: artwork at left, canvas in the center, selected-piece settings at right. Advanced canvas settings are collapsible, playback has visible buttons, and Focus retains a compact transport. Responsive drawers preserve the canvas on narrow screens. These are design and implementation decisions, not a claim of a formal user study or accessibility certification.

Automated checks cover reviewed source references, stable pose anchors, FPS-aware pose cadence, whole-path placement, custom-key protection, duplication, duration changes, Unicode text reveal, atomic Undo, failed-action rollback, and saved-project round trips. Source-art verification remains separate from authored timing and UI behavior.

The final interface review checked the common choose, place, play, and export workflow at desktop and mobile widths. It caught clipped action labels, a saved-project mode inference issue, and appearance controls overridden by existing Timeline keys. Action cards now reserve space for their names, mode inference follows each keyed piece, and affected appearance controls explain how to edit them in Timeline. Mobile keeps Open, Save project, Export animation, and Controls visible, with Art and Settings in drawers. No horizontal page overflow was found at 390 px.

Browser checks confirmed a ready walking demo, negative X placement, valid recipe duplication, full-phrase dialogue reveal and Undo, preserved custom keys, explicit replacement, and one Undo restoring the original custom animation. A Simple-mode export contained 48 frames at 240 × 160 pixels: every GIF RGBA pixel matched the corresponding lossless PNG frame, with 34 distinct rendered frames and 4,000 ms total playback. The asset verifier passed all 134 source sheets and 319,918 unique grid PNGs, with 64 sampled mapping cells per sheet and tile size. Ezlo's seven derived crops separately passed exact RGBA, source-color, and provenance checks. These checks do not certify the completeness of game animation coverage.


## Editing workflow and assembly coverage, version 7.0.0

The review prioritized canvas space, visible editing actions, and predictable keyboard behavior. The Scene inspector now starts with the piece list and selected-piece controls. Canvas setup is collapsible. Narrower side panels, shorter toolbars and carousel, lighter borders, and readable form text give the actual artwork more room while retaining game lettering, Ezlo, pixel colors, and the original logo. The title is Minish Studio with SerakSan retained; decorative studio subtitles are removed.

Copy, Paste, Duplicate, and Delete sit beside the canvas. Delete and Backspace work from the placed-piece lists as well as the canvas; native text editing, list arrows, IME, and dialog focus remain protected. Copying uses an internal editor clipboard. Animation copying includes every key and the ready-action recipe. A first cut/paste keeps its exact origin; repeated pastes offset copies. Layer ordering, zoom, actual size, fit, open/save, Undo/Redo, and duplication are listed for Windows and Mac in Controls.

Delete scene and Delete animation remain beside their respective tabs. Deleting the last canvas leaves a blank one in the same format. A single Undo restores the complete removed composition, including all animation keys. These are editing actions within the active project rather than permanent file deletion.

Trackpad pinch and Ctrl+wheel zoom around the pointer, with ordinary wheel and two-finger scrolling left for panning. Safari gesture events are supported and do not double-apply alongside wheel events. Queued wheel events use the displayed canvas geometry. Manual zoom provides scrollable space around the frame, and the final canvas origin and enlarged pixels align to whole CSS pixels. Fit uses the compact centered layout.

Browser layout checks at 1280, 805, and 390 px found no horizontal page overflow. The mobile animation header omits the unused Scene file-toolbar row. Art and Settings use drawers, while playback, export, and whole-animation deletion stay available. Actual browser checks verified piece-list Backspace, visible copy/paste controls, last-canvas deletion and complete Undo, boss placement/playback, and the anchored wheel handler. Synthetic pinch checks left ordinary scroll events untouched and settled both canvases at integer enlargement. Automated event tests cover Windows and Mac mappings and Safari gesture behavior; this is not a hardware certification for every trackpad.

The ready catalog now contains 66 actions across 21 sources, including 38 editor assembly actions for all nine boss families. It animates 202 of the 206 existing complete-boss poses. Exact pose order, hashes, credits, calibrated fixed body parts, and still-only limitations are recorded in assets/bosses/animation-coverage.json. One-shot transformations extend short clips to finish and hold their last supplied pose. No original or derivative game image was changed. Source artwork and timing coverage are not claims of complete ROM animation extraction.

An actual browser export of the calibrated Gleerok sweep contained 48 frames at 240 × 160 pixels. All GIF RGBA pixels matched the corresponding lossless PNG frames; the three supplied sweep poses remained distinct and playback lasted 4,000 ms. All 134 original downloaded files retained their recorded checksums. The editor, control, animation UI, assembly, engine, export, random-scene, and Ezlo regression suites passed. These checks are implementation and design review, not a user study or a formal accessibility certification.
