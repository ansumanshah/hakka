---
title: Phone page debugger
description: Inspect a live web page, make explicitly approved reversible edits, and understand the remote-debugging boundary.
---

Hakka's browser overlay includes a **Page** tab and a **Run** view in **Logs** for diagnosing a page when desktop browser tools are not available.

Open the overlay, then choose **Page** to:

- find up to 20 elements with a CSS selector;
- browse a bounded page outline;
- tap **Pick**, then tap a page element to inspect it;
- view its selector, text, attributes, and a small set of useful computed styles.

The picker listens only while it is active. It ignores Hakka's own overlay and removes its listener when the tab is closed or unmounted.

Choose **Logs → Run** to evaluate a command in the current page. Commands run only after you tap **Run** (or press Cmd/Ctrl+Enter); the prompt never evaluates saved input on page load. Results, thrown errors, awaited promises, and the current prompt's command history stay in the inspector only.

```js
document.querySelector('#checkout')?.textContent
await fetch('/health').then((response) => response.json())
```

## Remote MCP inspection and edits

When the overlay is connected to Hakka's bridge, MCP clients can use `inspect_page` to retrieve a bounded selector or DOM outline. Configure the bridge's optional shared token when the connection is exposed beyond a trusted local environment. Inspection does not evaluate supplied JavaScript.

`edit_page` can change one text value, attribute, or inline CSS property, and returns a `changeId` for `undo_page`. Remote edits start **disabled**. A person using the overlay must enable **Allow remote page edits for this session** before an MCP client can change the page. Turning the option off restores outstanding edits; reloading the page also clears them. Hakka rejects script-text edits, event-handler attributes, `srcdoc`, and `javascript:` URL attributes.

This works for an in-page Hakka browser runtime, including a phone WebView that has Hakka installed. It does not turn Safari, an arbitrary native screen, or an unrelated phone browser into a source debugger.

## Source debugging

Script sources, line breakpoints, pause, resume, and stepping require an explicitly attached Chromium CDP target. Set `HAKKA_CDP_URL` to that target's `ws://.../devtools/page/...` URL before exposing the MCP debugger tools. A phone needs a Chromium-compatible remote-debugging engine and an attached target; Safari/WebKit and plain in-page capture do not provide this CDP surface.

## Local programmatic inspection

Local integrations can use the same read-only inspection operations without opening the overlay. They return serializable page facts and never evaluate supplied JavaScript:

```ts
import { getPageInfo, inspectPage } from 'hakka-browser'

const page = getPageInfo()
const checkout = inspectPage('#checkout')
```

`inspectPage()` returns `null` when the selector has no page match. Hakka's own inspector host is excluded from results.
