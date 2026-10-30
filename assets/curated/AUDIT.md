# Curated game artwork

The normal scene library uses reviewed artwork regions. Complete downloaded sheets remain available separately as source archives; they are not clean scene-ready sprites or proof that every pixel is an original game asset.

## What was checked

- Every original source file retains its recorded SHA-256 checksum.
- Each of the 103 environment regions uses explicit source bounds. Cropped RGB values match the downloaded sheet exactly. Only reviewed exterior presentation colors and annotation-only areas have transparent alpha.
- Community headings, contributor banners, credit blocks, palette demonstrations, diagrams, unused examples, and non-scene interface sheets were removed from the normal gallery.
- The 360 recovered house tiles are intact 16 by 16 source cells. The inserted source grid is omitted. Two uncertain source rows remain in the archive.
- Every foreground PNG has a transparent border, a source rectangle, sheet attribution, and a checksum in `sprite-manifest.json`. The exported crop must match its current cleaned sprite sheet exactly. The download archive is checked against that manifest.
- Six random-scene backgrounds have reviewed camera bounds and walkable foot-placement areas. The forest object is a real closed chest, rather than an inventory icon. The Vaati encounter uses a real Wrath arena floor; other Vaati forms are optional creative arrangements in that setting.
- The trusted Wrath floor is only the 240 by 160 interior at source rectangle `(312, 483, 240, 160)`. The larger sheet image contains presentation matte outside the floor and stays in the source archive.

## Limits

These checks establish source-pixel preservation and exclude reviewed presentation material. They do not establish a ROM-level comparison, a complete inventory of every pose, or every source contributor's claims. A captured-gameplay comparison of Smith's exterior is recorded in `gameplayCrossChecks`; it must not be generalized into a claim that every map has been compared with gameplay.

The mixed edited Deku Scrub source, alternate tree recolors, alternate mushroom palette examples, Wrath's alternate palette, and authored Wrath composition examples remain outside the normal gallery. Original source sheets remain available for advanced inspection with their original attribution.

Opaque artwork inside a PNG can be intentional game content, for example a solid body part, a beam, or a floor tile. Transparent padding does not erase genuine solid artwork.

Run `tools/build_curated_library.py --verify-only` to check the generated library. `verification.json` contains the current counts and scope. `source-asset-verification.json` checks the separate original source archive and tile packs.

Game artwork belongs to its respective rights holders. The editor's software license does not grant a license to Nintendo or Capcom artwork. Source URLs and contributor credits accompany the artwork manifest and archive.
