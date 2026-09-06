---
title: Phone page debugger
description: Inspect a live web page and run a small, explicit JavaScript command from Hakka.
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

This is a focused in-page diagnostic surface. It does not provide DOM editing, script sources, breakpoints, or a full browser debugging protocol.

## Local programmatic inspection

Local integrations can use the same read-only inspection operations without opening the overlay. They return serializable page facts and never evaluate supplied JavaScript:

```ts
import { getPageInfo, inspectPage } from 'hakka-browser'

const page = getPageInfo()
const checkout = inspectPage('#checkout')
```

`inspectPage()` returns `null` when the selector has no page match. Hakka's own inspector host is excluded from results.
