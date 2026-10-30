# Publish Minish Studio on GitHub

GitHub can distribute the source code and an offline download while people run the editor entirely on their own computers. The publishing kit also supports an optional GitHub Pages website. Neither route needs a paid application server, user accounts, a database, or an API key. Keep the asset rights notice and source credits with any copy you publish.

## Set your public identity before the first commit

1. Use a GitHub username and public profile that you are comfortable linking to SerakSan. The package cannot hide identifying information already present on your GitHub account or other repositories.
2. On GitHub, open your profile picture → Settings → Emails. Enable Keep my email addresses private and Block command line pushes that expose my email. Copy the exact GitHub no-reply address displayed there; do not invent one.
3. In GitHub Desktop, open GitHub Desktop → Settings → Git on Mac, or File → Options → Git on Windows. Set Name to SerakSan and Email to the copied GitHub no-reply address. Do this before creating the repository, since an initial commit may be created automatically. These global settings affect new repositories; individual repositories can use Repository Settings → Git Config instead.
4. Protect the publishing account with two-factor authentication. Keep tokens and signing credentials outside the repository.

Changing the name or email later does not remove it from existing commits. Start with a fresh repository from the clean publishing ZIP rather than importing unrelated Git history.

## Publish the prepared project with GitHub Desktop

1. Extract Minish-Studio-GitHub.zip and open the minish-studio folder inside. Use this clean publishing package, not the complete working-project ZIP.
2. In GitHub Desktop, choose File → New repository. Name it minish-studio, use main as the default branch, and choose a separate empty location. The app creates a new folder with that repository name. The project already supplies its README, license and ignore file, so additional generated versions are unnecessary.
3. Copy the contents of the extracted minish-studio folder into that new repository folder. Copy index.html, assets, tools, tests, the docs, and the hidden .github, .gitignore and .nojekyll entries. On Mac, Command+Shift+Period shows hidden files. On Windows, use View → Show → Hidden items. Do not put an extra minish-studio folder between the repository root and index.html. Preserve the new repository's own .git directory.
4. Return to GitHub Desktop. Review Changes, enter Initial public release as the summary, and choose Commit to main. In Repository Settings → Git Config, double-check the author name and no-reply email. In History, confirm the commit author is SerakSan before publishing.
5. Choose Publish repository. Leave Keep this code private unchecked to publish a public repository, then choose Publish Repository. Repository → View on GitHub opens the result.

## Set the repository description and discovery topics

On the repository's main page, choose the gear beside **About**. Paste this into **Description**:

> Free, offline-capable scene and animation editor for The Legend of Zelda: The Minish Cap, with bundled game sprites. By SerakSan.

After GitHub Pages is deployed, put the actual published site address in **Website**. Users can then launch the app from the repository's About section. Do not use the repository address as the app's website address.

Add these suggested topics individually, then save:

```text
minish-studio
zelda
the-minish-cap
scene-editor
sprite-animation
animation-editor
pixel-art
sprite-editor
offline-first
browser-app
javascript
pwa
```

These topics describe the project and help people browse related repositories. The README introduces the Minish Cap scene maker and animation tools in plain language. The app also supplies a descriptive browser title, search description, and social-preview text. Search engines may choose their own result text; these changes do not guarantee indexing or a search position. See [GitHub's topic guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics) and [Google's snippet guidance](https://developers.google.com/search/docs/appearance/snippet).

## Offer an offline download, recommended for fully local use

The separate Minish-Studio-Offline.zip contains the runnable app and artwork without developer tools, test files, or original-download archives. It works without a server or a native installer.

On GitHub, open Releases → Draft a new release. Create tag v1.0 from main, title it Minish Studio 1.0, attach Minish-Studio-Offline.zip, and publish the release. This is the first public release. Users download that attachment, extract the entire ZIP, and open index.html. On Windows they should use Extract All before opening the app. START-HERE.txt contains the short usage instructions. Do not attach the private working-project ZIP.

## Optional: publish an installable website

Skip this section if you want to distribute downloads only. The offline app does not need a GitHub Pages website.

1. On GitHub, open the repository's Settings → Pages. Under Build and deployment → Source, choose GitHub Actions. The project already has a deployment workflow; do not replace it with a suggested template.
2. Open Actions → Publish Minish Studio → Run workflow, select main, and run it. If the first automatic run failed before Pages was enabled, run it again after step 1.
3. Wait for the checks and deployment to finish successfully. Settings → Pages shows the public website address. Share that address with users. Future pushes to main run the same checks and update the site.

The published address uses your GitHub username and repository name. GitHub Desktop handles the thousands of PNGs more conveniently than the website upload form.

## What belongs in the public release

The publishing kit contains the editor, embedded offline artwork, source sheets, the curated game sprite PNG ZIP, clean environment regions, full boss assemblies and editable parts, original source files for reproducibility, credits, editor source code, checks, and the deployment workflow. It omits the old uncurated individual PNG folders and sprite ZIP, large raw grid-cut archives, development environments, local backups, local filesystem paths, saved browser state, and personal scene exports. Normal environment tile views cut only audited game regions. Full contributed sheets remain in the explicitly labeled advanced archive.

The creator is credited only as **SerakSan**. Names in the artwork credit list belong to the published source contributors and are deliberately preserved.

The editor code is MIT-licensed. The third-party game artwork has separate rights, described in [ASSET_RIGHTS.md](ASSET_RIGHTS.md). A technically ready deployment does not grant permission to redistribute that artwork.

## Install and use offline

The editor runs locally in the user's browser. Publishing it on Pages distributes the application; it does not create an upload service for scenes or animations. Browser autosave is local to that browser and website origin. Save project downloads a portable file for backups or transfer.

For an app icon and its own window:

- Windows: open the hosted site in Edge, then use the install icon or Settings and more → More tools → Apps → Install this site as an app. Chrome also supports installation when offered.
- Mac: on macOS Sonoma 14 or later, open the hosted site in Safari and choose File → Add to Dock. Chrome or Edge installation is another option.
- In supported browsers, the editor's Scene → More → Install app button appears when browser installation is available.

Open the installed app once online and let it finish loading. Its core files and embedded artwork can then be cached for offline editing. Optional artwork ZIP downloads and some archive thumbnails are loaded separately; the complete extracted offline ZIP is the most predictable option for having every supplied local file available offline.

A hosted visit makes normal requests to the host, which may record IP addresses. The editor itself has no accounts, analytics, project upload endpoint, or server processing. Public source code does not grant visitors access to the creator's computer. A compromised publishing account could replace future hosted code, so a clean privacy scan is not a guarantee against every attack.

## Native Windows EXE and Mac DMG

Both are possible by packaging this existing web editor in a desktop wrapper such as Tauri. The wrapper must bundle the artwork and app locally, keep project files on the user's device, and provide only the native permissions it needs. This is a separate build and testing step. No native installer is included in the current release, and changing a ZIP's extension does not create an installer.

Windows can use a setup.exe installer. Mac can use a DMG containing a drag-to-Applications app. Public downloads are smoother with appropriate code signing, and a normal Mac distribution also needs notarization. Signing identifies a publisher and can reveal a legal person or organization through the certificate. Review that identity before signing if SerakSan must be the only public creator identity. Credentials used for signing belong in protected build secrets, not Git files.

For free distribution with the least installation friction and no code-signing identity, start with the installable website plus the offline ZIP. Native installers can be added as future GitHub Release attachments after packaging, platform testing and publisher-identity decisions.

## Maintain a release

The runtime needs only a browser. The checks and release builder use Node and Python without additional packages:

```sh
node tests/editor-smoke.mjs
node tests/controls.mjs
node tests/random-scenes-variation.mjs
node tests/animation-engine.mjs
node tests/animation-ui-controls.mjs
node tests/animation-export.mjs
node tests/simple-animation.mjs
node tests/ezlo-switch.mjs
python3 tools/build_public_release.py --output release/minish-studio-github --archive release/Minish-Studio-GitHub.zip
python3 tools/build_public_release.py --site-only --output release/minish-studio-offline --archive release/Minish-Studio-Offline.zip
```

After editing the animation HTML snippets, run `python3 tools/sync_animation_markup.py` to update the offline page. Scene and animation browser projects stay local and are omitted from the public kit. Animation project formats, PNG/GIF export, and browser-supported video require no server.

On Windows, use `py -3` in place of `python3` for optional local commands. Opening `index.html` requires no command line.

Image rebuilding tools use the packages listed in `requirements.txt`. Update the cache version in `service-worker.js` and run `python3 tools/version_runtime_assets.py` whenever publishing a changed app. An installed app picks up a new service worker after the previous version's open tabs are closed.

This kit prepares publication. It does not create a GitHub repository or publish anything to your account automatically.

## Official publishing and installer instructions

- [What GitHub Pages is and which plans support it](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Choose GitHub Actions as your publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Deploy with a custom workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Pages storage and bandwidth limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Keep your Git commit email address private](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)

- [Git author name and email in GitHub Desktop](https://docs.github.com/en/desktop/configuring-and-customizing-github-desktop/configuring-git-for-github-desktop)
- [Manage GitHub Releases and downloadable attachments](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [Install a web app with Microsoft Edge](https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge)
- [Use Safari web apps on Mac](https://support.apple.com/en-us/104996)
- [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri Mac DMG distribution](https://v2.tauri.app/distribute/dmg/)
- [Mac code signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Apple signing certificates and publisher identity](https://developer.apple.com/help/account/certificates/certificates-overview/)
