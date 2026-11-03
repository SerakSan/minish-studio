# Privacy

## Your workspace stays in your browser

Your scenes and animations are not shared with other people who open Minish Studio, including people visiting the same GitHub Pages link. The editor saves them in your current browser profile on your device. When you reopen it in that profile at the same app address, it restores your local work.

Other visitors get the bundled public examples or their own local autosave. They do not load your scene names, dialogue, layouts, animation clips, or saved crops. There is no shared project gallery, account sync, or project upload service. Opening a project file reads it on your device; it does not send the file to GitHub.

Pictures you add to a scene are processed on your device and kept in the same browser profile as your project. They are never added to the shared game-art catalog. Imported pictures are converted to PNG; original file metadata such as camera location is not copied. Saved project files include the pictures used in that project so they can be reopened elsewhere. Only share these files when you also want to share their pictures.

Someone using the same browser profile on your computer can see that profile's autosave. Use separate browser profiles or device accounts if you share the computer. The editor does not encrypt autosave or require a password to open it.

Choose **Save project** for a portable backup. A file you deliberately share, add to a public repository, or attach to a public issue can be seen by its recipients. Exported files include your scene names, dialogue, and crop names, so check them before sharing.

## App files and hosting

Minish Studio is credited to **SerakSan**. The public release does not include its creator's legal name, home directory, private project backups, browser profile, credentials, or development environment.

The editor has no account system, analytics, advertising, tracking pixels, or application server. Editing, image rendering, and exports run in your browser. The public build copies the editor, game artwork, and explicitly included public examples. It does not read browser autosave or automatically add your personal project downloads to the package.

The installable website can store editor files in the browser's cache for offline use. Clear this site's storage in your browser settings to remove the cached app, autosave, imported pictures, and saved crop bookmarks. Export your project before clearing storage.

Autosave is not encrypted by the editor and is not a cloud backup. It belongs to the current browser and website origin. Other applications served from the same origin can share that origin's storage privileges. Download a project file before changing browsers, moving the downloaded app folder, or changing its hosted address. A downloaded offline folder avoids depending on a host for future app code; use a copy from a publisher you trust.

The main artwork catalogs, game font, interface artwork, and Ezlo switch contain embedded images. Once the installable website has completely cached its app files, core editing and rendering can work offline. Some source-archive thumbnails load separately and optional artwork ZIPs are not automatically cached. The complete extracted download is the more predictable option when all supplied local files must remain available offline.

Loading the hosted site makes ordinary requests to its hosting provider. A GitHub Pages host can log visitor IP addresses for security. This happens at the hosting layer, outside the editor. See [GitHub's Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection) and [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

Source and credit links open external websites only when you select them. Their own privacy policies apply. Game contributor names are included as public attribution, not as creator identity information.

The publishing package is separate from GitHub account metadata. A public profile, commit author name and email, previous commit history, or future native-app signing certificate can identify a publisher independently of these app files. Use SerakSan and GitHub's private no-reply email before creating any public commits. The app does not make a GitHub account anonymous or guarantee protection against every attack.
