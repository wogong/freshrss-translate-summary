# FreshRSS Translate & Summary

A FreshRSS user extension that translates article content into Chinese or generates Chinese summaries via OpenAI-compatible APIs.

## Features

- One-click immersive article translation: the Chinese translation is inserted below each original paragraph
- One-click Chinese summary generation
- Multiple OpenAI-compatible API endpoints and model profiles
- Quick switching between API profiles and models from the article toolbar
- Customizable request timeout, connect timeout, translate prompt, and summary prompt
- Works with FreshRSS light and dark themes

## Installation

Requires FreshRSS 1.25.0 or later.

1. Download the extension archive from Releases.
2. Extract it and make sure the directory is named `freshrss-translate-summary`.
3. Move the directory into the FreshRSS extensions directory:

   ```text
   /var/www/FreshRSS/extensions/
   ```

4. In FreshRSS, go to "Settings → Extensions" and enable `freshrss-translate-summary`.

## Configuration

On the extension settings page you can add one or more API profiles. Each profile contains:

- Profile name
- API base URL, e.g. `https://api.openai.com/v1`
- API key
- Model name, e.g. `gpt-4o`

To use several models with the same API endpoint, add multiple profiles reusing the same base URL and key.

The extension also supports:

- Request timeout, default 180 seconds
- Connect timeout, default 30 seconds
- Translate prompt
- Summary prompt

After saving, open any article, pick the API profile from the toolbar dropdown, then click "Translate" or "Summary". "Translate" renders bilingually: each paragraph is followed by its Chinese translation (paragraphs are sent to the API separated by `%%`, so a custom translate prompt must keep the `%%` separator convention). Long articles are split into batches translated concurrently, so translations appear progressively while the rest of the article is still being processed. Clicking "Translate" again toggles the translations. The last selected profile is remembered in the current browser.

The single API base URL, key, and model saved by old versions (0.1.x) are automatically migrated into the first profile.

Note: v0.3.3 temporarily changed the extension identifier to a Chinese name. FreshRSS stores the enabled state and configuration by identifier, so upgrading from v0.3.3 to v0.3.4 or later requires re-enabling the extension and re-entering its settings.

## Privacy & security

The frontend only receives profile names, model names, and profile indexes. API base URLs and API keys stay in the FreshRSS user configuration and are never sent to the browser toolbar.

## Credits

This extension was originally inspired by [xExtension-ArticleSummary](https://github.com/LiangWei88/xExtension-ArticleSummary).
