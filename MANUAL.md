# Sephral’s Performance Doctor: Manual

## Opening the doctor

* The stethoscope in the token controls on the left.
* The small stethoscope next to latency and frame rate in the players list. A click on the frame rate or the latency opens it too.
* A key you set in Foundry's controls.
* *Game Settings → Configure Settings → Sephral’s Performance Doctor → Open the Performance Doctor*.
* GMs: right click a scene in the scene directory → *Check performance*.

On top the window shows how the game runs right now: a colored dot, the frame rate (FPS), the delay to the server, the download speed and a graph of the last minute.

## For players

### Overview

The hints sorted by importance. Each says what is wrong in plain words and offers what helps:

* **A button that changes a setting** (for example *Turn off resolution scaling*). The doctor notes the old value first.
* **Show me how**: step by step instructions for things outside Foundry, such as hardware acceleration in your browser, the graphics card Windows gives the browser, the energy saver, the network. Addresses like `chrome://settings/system` can be copied with a click, because browsers do not open them from a web page.
* **Tell the GM**: for things only the GM can change, such as a scene that is too heavy.

**Make my game faster** measures ten seconds, proposes the settings that help most (you can untick them) and measures again after applying them: *before → now*. If a change needs a reload, the doctor asks, reloads and measures afterwards. *Undo my changes* puts everything back. When the cause lies outside Foundry's settings (no hardware acceleration), the assistant shows it first.

When your frame rate stays very low for about 45 seconds, a small window offers help. *Later* keeps it quiet for 30 minutes, *Don't ask again* switches it off (setting).

### This computer

* Graphics chip as the browser reports it, with its kind: graphics card, built-in graphics, Apple, or **software** (no hardware acceleration). Also the largest image the chip can show, browser, system, screen and scaling, size of the canvas in megapixels, processor cores, browser memory and the images in graphics memory.
* Foundry's graphics settings of this computer: quality, frames per second at most, resolution scaling, light and vision animation, mipmaps. Changed here they can be undone.
* Three sets: *Balanced*, *Light*, *Minimal*.
* **Graphics test**: switches each of these off for about three seconds and counts the frames: light and vision animation, videos, weather and particles, effects of modules (filters such as glows and outlines), lighting and vision effects. Everything comes back on after each step. The fog of war is never touched.
* **Connection test**: downloads a 1.5 MB image of Foundry three times without the cache and measures the speed.

### Scene

How large the viewed scene is to download, the largest image in pixels, the graphics memory its images need, and how many walls, lights, tokens, tiles and videos it has. Players see no file names.

### Modules

**Measure for 15 seconds**: for 15 seconds every hook callback, canvas ticker listener, timer and animation frame of a package runs inside a stopwatch. The table shows the time per second for each module, the system, Foundry (which includes drawing the map) and the doctor itself. A click on a row shows where the time goes (hook names and functions). Long frames of more than 50 ms that the browser reports (Chrome and Edge) count too, so event handlers of modules show up. After the measurement every callback gets its original function back.

**Measure the next start**: Foundry reloads and the doctor measures the start: loading the scripts, loading the world, preparing, drawing the scene, modules getting ready, and the time each package needs in these steps.

**Downloads by package**: what the browser downloaded outside the canvas. Images on the canvas are loaded by Foundry in a separate worker and count in the scene check instead.

## For the GM

### Players

One line per connected user: frame rate, delay, download speed, graphics chip, the biggest problem and the last scene load (*loading Dragon Lair for 25 s*, *Dragon Lair in 12 s*). *Live* asks everyone for fresh numbers every 5 seconds for 2 minutes. The stethoscope of a line, or *Ask all to check*, opens the doctor on the player's computer with the line *Gamemaster asked you to check your game*.

Below the table: findings for the whole table (all players download slowly, which points to the server's upload, or all players are delayed, which points to the server), messages players sent with *Tell the GM*, and the last scene loads.

Alerts (setting): the GM is told when a player still loads a scene after the time set (20 seconds by default), how long a slow load took, when images could not be loaded, and once per player when a player has a serious problem with the computer or the line (no hardware acceleration, a very slow game, a very slow connection).

### Scene check and smaller copies

Pick any scene. Besides the numbers players see, the GM gets the list of files with size, pixels and use, the loading time at 6, 16, 50 and 100 Mbit/s and for the slowest connected player, and the loads of this scene.

Findings: the download of the scene (25 MB and more), single images of 15 MB and more, images longer than 8192 pixels, images too large for the graphics chip of a connected player, PNG maps that would be much smaller as WebP, large videos, the graphics memory, images stored inside the scene data, and crowded scenes (walls, lights, animated lights, tokens, tokens with vision, tiles, videos, drawings, ambient sounds).

**Make smaller** (backgrounds, foregrounds, fog overlays and tiles): the browser decodes the image, scales it to the longest side chosen (keep, 8192, 6144 or 4096 pixels) and saves it as WebP (quality high, normal or small). The dialog shows original and copy before anything changes. *Use the copy* uploads it into the world's folder (`worlds/<world>/sephrals-performance-doctor/`, on The Forge into the Assets Library) and points the scene at it, optionally also every other scene with this image. Foundry stretches the image over the scene, so walls and tokens stay in place. The original is not deleted (Foundry cannot delete files from the browser). *Original* in the file list brings it back.

When the GM activates a heavy scene or puts a very large image into a scene, a notification says how large it is and how long the slowest player waits (setting).

### World

*Check the world* measures the data every player downloads when joining (from what this client received when it joined), by part: actors, items, scenes, journals, chat messages, compendium indexes and more, next to the size on the server's disk. It lists the largest documents and the ones that carry images inside their text, and offers *Export chat log* and *Clear chat log* for a large chat.

## How the doctor decides

* **Frame rate:** good from 80 % of the target (60, or the limit set), noticeably slow below, seriously slow under 15 frames or under 45 %.
* **Processor or graphics chip:** the doctor measures how long the scripts of each frame take. When they take most of the frame time, the processor is the bottleneck (often a module). When they are quick but frames are still slow, the graphics chip is (or the browser waits for it).
* **No hardware acceleration:** the graphics driver is a software stand-in (SwiftShader, llvmpipe, Microsoft Basic Render Driver and similar).
* **Delay:** round trip to the server, measured every 20 seconds with the same request Foundry uses. From 300 ms noticeable, from 1000 ms serious.
* **Download speed:** from the connection test, or estimated from what the browser downloaded and from the load times of large scenes. Below 12 Mbit/s slow, below 5 Mbit/s very slow.
* **Module time:** from 10 % of the computer's time noticeable, from 25 % serious, a single call of more than 100 ms blocks the picture.

## Settings

The gear in the title bar of the doctor opens these settings.

| Setting | Scope | What it does |
| --- | --- | --- |
| Module language | you | Follow Foundry, German or English |
| Look | you | Warm paper colors (Signature) or the dark colors of Foundry |
| Offer help when the game is slow | you | The small window when the frame rate stays very low |
| Share my numbers with the GM | you | Sends frame rate, delay, speed, graphics chip and load times to the GMs |
| Note which module registers what | you | Needed for the module measurement, see below. Needs a reload |
| Alerts for the GM | world | Notifications about slow loads, missing images and serious problems |
| Slow scene load after | world | Seconds (10 to 120, default 20) |
| Warn about heavy scenes | world | When the GM activates a scene or adds a very large image |
| Open the Performance Doctor | | Menu button |
| Self-test | GM | Checks socket, attribution, meter, browser reports, texts and upload right |
| Save debug file | GM | One file about all of Sephral’s modules for bug reports, see [Debug file](#debug-file) |

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For the Performance Doctor it holds:

* on how many of the last 30 days the module was used
* how often the module measurement, the startup measurement, the graphics test, the assistant and the world size check run, fixes are applied or undone and WebP copies of maps are made
* the settings *Look*, *Offer help when the game is slow* and *Alerts for the GM* (only the chosen option)
* where errors occur in the module code: file, line and error type, never the error message

No names, chat messages, notes, dice results or other content of the world are sent.

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message. It holds the versions of Foundry, the system and the active modules, the settings of the modules and what they recorded, for the Performance Doctor the numbers and findings of this computer, the last tests, the graphics settings it changed and what the GM knows about the players (by user ID, without names). Macros call `game.modules.get("sephrals-performance-doctor").api.saveDebugFile()`.

The file contains chat text and whispers. Check it before you share it.

## How the measuring works

* The module loads as a **library**, before the system and the other modules. From then on it notes, for every hook callback, canvas ticker listener and repeating timer, which package registered it (from the call stack at that moment). Nothing is wrapped for this, except repeating timers of packages, which get a thin wrapper that only measures during a measurement.
* The meter adds two small listeners to the canvas ticker (the first and the last of every frame). That gives the frame rate and the script time per frame at no noticeable cost.
* During a module measurement, hook callbacks get a stopwatch in place of their function, `Hooks.off` with the original function still works, and new callbacks are measured too. Afterwards everything gets its original back. Time a callback spends in callbacks it triggers counts for the inner one.
* The doctor checks the size of files with HEAD requests and reads the pixel size from the first 128 KB of an image (PNG, JPEG, GIF, WebP, AVIF). It never downloads a whole map for a check.
* Reports to the GM are small (under 1 KB) and go to the GMs only, every 30 seconds, every 5 seconds while the GM watches live.

## Limits

* Time that modules spend in libWrapper patches of Foundry's methods counts for Foundry. The graphics test and switching modules off show such costs.
* The graphics chip's own time cannot be measured from a web page. The doctor infers it from slow frames with quick scripts.
* Long frames with their scripts are reported by Chrome, Edge and the Foundry app, not by Firefox and Safari.
* Callbacks registered before the module loads (by other library modules that load first) are listed as *Not assigned*.
* Safari cannot save WebP, so smaller copies need Chrome, Edge or Firefox.

## Storage

* Client settings in each browser: the settings the module changed (for undo), the assistant's state across a reload, the snooze of the hint and the last startup measurement.
* Scene flag `optimized`: the copies a scene uses with their originals.
* Smaller copies: `worlds/<world>/sephrals-performance-doctor/` (The Forge: `sephrals-performance-doctor/<world>/` in the Assets Library).

## API

`game.modules.get("sephrals-performance-doctor").api`:

| Function | Returns |
| --- | --- |
| `open({tab, sceneId, banner})` | Opens the window |
| `snapshot()`, `findings()` | The numbers of this client and its findings |
| `frames(seconds)`, `latency()`, `bandwidth()`, `environment()`, `downloads()` | Single measurements |
| `profile({seconds})` | Module measurement, rows by owner |
| `runExperiments()` | Graphics test |
| `runSpeedTest()` | Connection test |
| `checkScene(scene)`, `diagnoseScene(summary)` | Scene check and its findings for the GM |
| `checkWorld()` | World check (GM) |
| `applySettings(values)`, `applyPreset(id)`, `undoChanges()` | Foundry's graphics settings with undo |
| `tableRows()`, `recentLoads(sceneId)` | What the GM knows about the players |
| `ownerOf(fn)` | The package that registered a callback |
| `phases()` | Moments of the start of the page |
| `runSelfTest()` | Self-test (GM) |
| `saveDebugFile()` | Debug file of Sephral’s modules (GM) |
