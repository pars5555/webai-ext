# Chrome Web Store Deployment

## Build the Package

```bash
cd webai-ext

# Update version in manifest.json first
# Then create zip (exclude dev files)
powershell -Command "Compress-Archive -Path manifest.json, background, content, icons, options, popup, sidepanel -DestinationPath webai-ext-v$(node -e "console.log(require('./manifest.json').version)").zip -Force"
```

## First-Time Setup

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Pay one-time **$5 registration fee**
3. Click **New Item** → upload the `.zip` file
4. Fill in the listing:
   - **Name:** AI Web Assistant
   - **Description:** AI-powered browser assistant with Claude and Gemini. Automate web tasks, analyze pages, and interact with any website using natural language.
   - **Category:** Productivity
   - **Language:** English
5. Upload assets:
   - **Icon:** 128x128 PNG (use `icons/icon128.png`)
   - **Screenshots:** at least 1, size 1280x800 or 640x400
   - **Promo tile (optional):** 440x280
6. **Privacy policy URL** — required for extensions with `<all_urls>` permission
7. Submit for review

## Update Existing Extension

1. Go to [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Find **AI Web Assistant** → click **Package** tab
3. Click **Upload new package** → select the new `.zip`
4. Update **version notes** with changelog
5. Click **Submit for review**

## Review Notes

The extension uses these sensitive permissions that may trigger extra review:

| Permission | Reason |
|---|---|
| `debugger` | Chrome DevTools Protocol — AI uses CDP to click, type, navigate pages |
| `<all_urls>` | AI needs to interact with any website the user is on |
| `cookies` | Read page cookies as context for AI automation |
| `webRequest` | Monitor network for AI-driven testing/automation |
| `scripting` | Execute JavaScript in page context for AI commands |

**Justification for reviewers:** This is a browser automation assistant. The AI analyzes the current page and sends CDP/JS commands to interact with it (click buttons, fill forms, navigate). All actions are user-initiated through the chat interface.

## Review Timeline

- **New extension:** 1-3 business days
- **Updates:** Usually minutes to hours, sometimes 1-2 days
- **Rejected?** Check email for reasons, fix, resubmit

## Checklist Before Submitting

- [ ] Version bumped in `manifest.json`
- [ ] All changes committed and pushed
- [ ] Tested on Chrome and at least one other Chromium browser (Edge, Vivaldi)
- [ ] No hardcoded localhost URLs (dev mode handles this via settings)
- [ ] No API keys or secrets in the code
- [ ] Screenshots updated if UI changed significantly
- [ ] Privacy policy URL is valid and accessible
