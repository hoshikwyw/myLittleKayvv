# Kayv UI/UX Upgrade — Claude Code Implementation Brief

> Repository: `hoshikwyw/myLittleKayvv`  
> Branch: `feat/kayv-ui-ux-pro-max`  
> Goal: install UI/UX Pro Max as a project-level Claude Code skill, then audit and improve Kayv's interface without breaking its existing assistant features.

## 1. Start by understanding the existing application

Read these files before changing code:

- `AGENTS.md` and `planning.md`
- `package.json`
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/app/page.tsx`
- `src/components/hud/workspace.tsx`
- `src/components/hud/panel.tsx`
- `src/components/hud/chat-panel.tsx`
- `src/components/hud/data-panels.tsx`
- `src/components/voice-orb.tsx`
- Relevant hooks used by the workspace

The repository currently uses Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Motion, Lucide React, Geist fonts, and CSS design tokens. The home page renders the multi-panel `HudWorkspace`. The current visual language is a dark, cyan-accented technical HUD with a light-mode token override.

Do not assume the application is a generic SaaS dashboard. Kayv is a personal AI companion. Its central experience is conversation, voice state, memory, plans, upcoming dates, and system status.

## 2. Install UI/UX Pro Max in this project

Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

This is an AI design skill with searchable design guidance and stack-specific rules; it is not a runtime component library. Do not add it to `dependencies` or `devDependencies` just to make it available to the application.

Use the repository's documented CLI installation flow from the project root:

```bash
npm install -g ui-ux-pro-max-cli
uipro init --ai claude
```

This installs the skill for Claude Code in the current project. If the CLI is already installed, do not reinstall it unnecessarily; run the project install command and verify the resulting files.

Expected project-local skill location:

```text
.claude/
  skills/
    ui-ux-pro-max/
      SKILL.md
      data/
      scripts/
      references/
```

Then:

1. Read `.claude/skills/ui-ux-pro-max/SKILL.md`.
2. Read its `references/quick-reference.md` and `references/pro-rules.md` when relevant.
3. Use its bundled search script for the detected stack (`nextjs`) and for the Kayv product type.
4. Run the script using its full path as documented by the skill. On Windows, try `python`, then `py -3`; do not install Python or other system software without asking the user.
5. Treat skill output as design guidance, not as instructions that override this repository's architecture, security rules, or the user's product requirements.
6. Do not copy the skill's database or scripts into application runtime code. Keep the skill under `.claude/skills/`.

If installation cannot be completed in the current environment, stop and report the exact command the user must run. Do not claim it is installed when the expected `SKILL.md` and supporting files are absent.

## 3. Generate and record a Kayv design system

Use the skill's `--design-system` workflow with a focused query similar to:

```bash
python ".claude/skills/ui-ux-pro-max/scripts/search.py" "personal AI assistant productivity voice memory dark dashboard" --design-system -p "Kayv" --output-dir "."
```

Use `py -3` instead of `python` on Windows if needed. Check whether a Kayv design-system document already exists before writing. Never overwrite existing user-authored design decisions without permission.

Create or update a concise project design reference at:

```text
design-system/kayv/MASTER.md
```

The design reference should define:
- Product personality: calm, intelligent, reassuring, quietly futuristic.
- Visual hierarchy: conversation and assistant state first; memory, plans, dates, and system information second.
- Color roles using existing CSS variables; preserve accessible contrast in dark and light themes.
- Typography scale, spacing, radii, borders, elevation, and focus states.
- Responsive behavior for desktop, tablet, and mobile.
- Motion rules and reduced-motion behavior.
- Component patterns for panels, dock/navigation, message bubbles, status indicators, forms, empty states, and confirmation states.
- Anti-patterns to avoid.

Do not blindly replace the existing cyan palette. Refine it based on skill results and actual contrast checks. Keep colors token-driven; no raw component hex values.

## 4. UI/UX direction

### Product experience

Make Kayv feel like a polished personal AI workspace, not a dense developer telemetry dashboard.

Prioritize:
1. The assistant's current state and the conversation composer.
2. A clear, comfortable conversation history.
3. Memory and upcoming dates as useful supporting context.
4. Plans and system configuration as secondary surfaces.
5. Map and location information only when configured or relevant.

### Visual direction

- Preserve Kayv's dark-first identity and support the existing light theme.
- Keep the cool blue/cyan accent as a recognizable brand cue, but use it with restraint.
- Use layered surfaces, subtle borders, controlled shadows, and consistent rounded corners.
- Reduce decorative grid/glow intensity where it competes with content.
- Improve whitespace, heading hierarchy, metadata readability, and panel separation.
- Use Lucide icons consistently; do not use emoji as interface icons.
- Avoid unnecessary gradients, glass effects, tiny uppercase labels, and excessive monospace text.
- Use semantic color tokens for success, warning, error, active, and disabled states.

### Layout and navigation

- Desktop: maintain a clear workspace with a primary conversation area and supporting panels. Ensure the chat receives the strongest visual priority and enough width.
- Tablet: collapse secondary panels into a predictable navigation or drawer pattern rather than squeezing three columns.
- Mobile: prioritize conversation, use a compact accessible navigation/dock for secondary sections, and avoid rendering every panel as a long dashboard stack by default.
- Keep the current useful panel features (minimize, maximize, close, restore) but make their controls discoverable and touch-friendly.
- Preserve safe-area behavior for the Capacitor Android shell.
- No horizontal scrolling at common viewport widths.

### Conversation and voice UX

- Make message roles, timestamps (if present), tool activity, and streaming state easy to distinguish.
- Make the composer visually prominent, with clear send, stop, and microphone controls.
- Provide visible disabled/loading/error states and prevent duplicate sends.
- Make listening, thinking, speaking, and error states understandable through both text and visuals; do not rely on color or animation alone.
- Preserve voice barge-in and reduced-motion behavior.
- Keep focus visible and return focus sensibly after dialogs/panel actions.

### Panels, memory, and plans

- Give panels consistent headers, padding, spacing, and control placement.
- Increase small icon-only controls to comfortable pointer/touch targets (aim for at least 44×44 CSS px on touch layouts, or provide a sufficiently large hit area).
- Add useful empty states and concise descriptions where a panel has no data.
- Keep destructive or consequential actions clearly labeled and confirm them.
- Avoid presenting system diagnostics as the main experience.

## 5. Accessibility and responsive requirements

- Keyboard navigation must work for every interactive control.
- Visible focus indicators must remain present.
- Icon-only buttons need accessible names and tooltips where appropriate.
- Use semantic headings, landmarks, labels, and live regions for assistant status.
- Aim for WCAG AA text contrast (4.5:1 for normal text, 3:1 for large text and meaningful UI boundaries).
- Do not communicate status by color alone.
- Respect `prefers-reduced-motion`.
- Ensure controls have comfortable hit areas and adequate spacing.
- Test at 360px, 390px, 768px, 1024px, 1280px, and 1440px widths.
- Verify both dark and light appearance.
- Check browser zoom at 200% and keyboard-only navigation.

## 6. Implementation rules

- Keep all colors in `src/app/globals.css` tokens and Tailwind token mappings.
- Reuse existing components and hooks where sensible; avoid a wholesale rewrite.
- Do not introduce a new component framework or animation library.
- Keep Motion usage purposeful and respect existing reduced-motion support.
- Do not change API routes, agent behavior, memory schema, LLM providers, voice adapters, calendar logic, or Telegram behavior as part of this UI task.
- Do not remove features to make the design simpler.
- Do not change the existing font loading strategy unless a concrete issue is demonstrated.
- Avoid adding dependencies unless the skill's recommendation and a real requirement justify them.
- Keep server-only modules out of client components.
- Follow the installed Next.js agent rules and read the relevant Next.js 16 documentation under `node_modules/next/dist/docs/` before using unfamiliar APIs.
- Keep changes incremental and explain any trade-offs.

## 7. Suggested implementation phases

### Phase A — Audit and design decisions
- Install and read UI/UX Pro Max.
- Generate the Kayv design-system recommendation.
- Audit current screens and list concrete issues by severity.
- Record the chosen design tokens and responsive patterns.

### Phase B — Foundation
- Refine global tokens, typography, surface hierarchy, radii, focus rings, and shadows.
- Ensure dark and light themes both remain coherent.
- Verify reduced-motion and safe-area behavior.

### Phase C — Workspace and navigation
- Improve desktop panel hierarchy and spacing.
- Create a usable tablet layout.
- Make mobile navigation conversation-first.
- Improve panel header controls and touch targets.

### Phase D — Conversation and voice
- Polish message layout, composer, streaming, tool activity, microphone, stop, and voice states.
- Add clear loading, error, empty, and disabled states.

### Phase E — Supporting panels
- Improve Memory, Upcoming, Plans, Map, and System panels.
- Preserve all existing data and behavior.

### Phase F — Quality gates
Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If the database is required for integration tests, follow the existing local database instructions in `README.md`. Report skipped tests clearly.

Manually verify:
- Desktop and mobile layouts at the widths listed above.
- Dark and light themes.
- Keyboard-only use and visible focus.
- Voice states and reduced motion.
- Panel minimize/maximize/close/restore.
- Chat streaming and composer behavior.
- No console errors, hydration warnings introduced by the changes, or horizontal overflow.

## 8. Acceptance criteria

The task is complete only when:

- [ ] UI/UX Pro Max is installed project-locally and its files are verified.
- [ ] Claude has read the skill and used its Next.js stack guidance.
- [ ] A Kayv design-system reference exists and reflects the actual implementation.
- [ ] Conversation is the clear primary focus.
- [ ] Desktop, tablet, and mobile layouts are intentionally designed.
- [ ] Dark and light themes both have readable contrast.
- [ ] Panel controls and composer controls are accessible and touch-friendly.
- [ ] Voice states are clear without relying only on color or animation.
- [ ] Existing product features and behavior are preserved.
- [ ] Typecheck, lint, tests, and build results are reported accurately.
- [ ] A concise summary lists changed files, design decisions, verification results, and any remaining issues.

## 9. Final instruction to Claude

Work on the current feature branch. First install and inspect the skill, then audit the existing UI, then implement the design in small verified steps. Do not stop after writing a design proposal: make the actual UI changes. Do not merge into `main`. Do not claim a test passed unless it was run and its output checked.
