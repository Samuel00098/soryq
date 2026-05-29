# Soryq — Going Mainstream: The Full Playbook

> A step-by-step guide to taking Soryq from a GitHub project to a globally distributed developer tool used by millions.

---

## The 6 Phases

```
Phase 1: Polish & Prepare   →   Phase 2: Distribution Channels
Phase 3: Marketing Engine   →   Phase 4: Launch Event
Phase 5: Post-Launch Growth →   Phase 6: Monetization
```

---

## Phase 1: Polish & Prepare (4–6 Weeks Before Launch)

Before you tell the world, make sure the world is ready to receive you.

### 1.1 Code Signing — The #1 Trust Signal

Without code signing, Windows shows a **red SmartScreen warning** ("Windows protected your PC") when users try to run your installer. This kills conversion rates. macOS shows a similar Gatekeeper warning ("app is from an unidentified developer"). These warnings are dealbreakers for mainstream users.

#### Windows Code Signing
| Option | Cost | Notes |
|--------|------|-------|
| **Extended Validation (EV) Certificate** | ~$300–500/year | Instant SmartScreen reputation. Required to avoid the warning immediately. Providers: DigiCert, Sectigo, GlobalSign |
| **Standard OV Certificate** | ~$70–200/year | Still shows warning until you build SmartScreen reputation (hundreds of downloads). Not recommended for launch. |
| **SignPath.io** | Free tier available | Open source friendly signing service. Good option to start. |

> [!IMPORTANT]
> For Windows, get an **EV certificate** before public launch. Without it, most mainstream users will hit the SmartScreen warning and abandon the install. This is non-negotiable for reaching millions.

Add to your GitHub Actions workflow:
```yaml
- name: Sign Windows binary
  env:
    WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
    WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
```

Then in `tauri.conf.json`:
```json
"bundle": {
  "windows": {
    "certificateThumbprint": "YOUR_CERT_THUMBPRINT",
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

#### macOS Code Signing & Notarization
Requires an **Apple Developer account** ($99/year). Tauri handles most of this automatically if you set the right environment variables in CI:

```yaml
APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
APPLE_ID: ${{ secrets.APPLE_ID }}
APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Without notarization, macOS users get a quarantine warning and have to right-click → Open — a terrible first impression.

---

### 1.2 Landing Page Website

This is your **#1 marketing asset**. Before any press or social post, you need a website. Users Google your app name — what they find in the first 3 seconds determines whether they download or leave.

**Domain:** Register `soryq.dev` or `soryq.app` (~$12–20/year on Namecheap or Cloudflare Registrar)

**What the page must have:**

| Section | Purpose |
|---------|---------|
| **Hero** | One-line value prop + animated demo/screenshot + Download button |
| **Feature highlights** | 3–4 key features with short descriptions and visuals |
| **Platform download buttons** | Windows / macOS / Linux clearly labeled with version |
| **Why Soryq?** | Comparison table vs VS Code, Warp, or Cursor |
| **Screenshots / Video demo** | The most important conversion driver after the hero |
| **Quick start** | `winget install soryq` or a 30-second GIF walkthrough |
| **Footer** | GitHub link, Twitter/X, Discord, changelog |

**Hosting (free options):**
- **Vercel** — Deploy with `git push`. Free tier covers millions of page views.
- **Cloudflare Pages** — Also free, excellent performance globally.
- **GitHub Pages** — Simplest setup, but less flexible.

**Tech stack suggestion:** Build it as a static HTML/CSS/JS site or use Astro. No need for a full framework for a marketing page.

---

### 1.3 App Icon & Visual Identity

Before going public, your visual identity should be polished:
- [ ] App icon looks great at 16px, 32px, and 512px (test all sizes)
- [ ] Consistent color palette used across website, screenshots, and social
- [ ] App screenshots taken at 1440p or higher, with clean sample projects open
- [ ] A short (60–90 second) screen recording showing the "wow" moments
- [ ] A social card (1200×630px OG image) for link previews on Twitter/Slack/Discord

---

### 1.4 Pre-Launch Checklist

- [ ] Version bumped to `1.0.0` (signals stability to users)
- [ ] `README.md` has screenshots, a GIF demo, and a direct download link
- [ ] `CHANGELOG.md` is up to date
- [ ] All GitHub Issues labeled and triaged
- [ ] Bug bash: test the installer on a clean Windows 10, Windows 11, macOS 13, and Ubuntu 22.04 VM
- [ ] Privacy policy page (required for app stores and many enterprise users)
- [ ] Support channel ready (GitHub Discussions, Discord, or email)

---

## Phase 2: Distribution Channels

Get Soryq into every place developers look for tools.

### 2.1 Direct Download (Day 1)

Your website's download buttons should link directly to GitHub Release assets. This is zero infrastructure cost and works immediately.

```html
<!-- Example download button links -->
<a href="https://github.com/Samuel00098/soryq/releases/latest/download/Soryq_x64-setup.exe">
  Download for Windows
</a>
<a href="https://github.com/Samuel00098/soryq/releases/latest/download/Soryq_aarch64.dmg">
  Download for macOS (Apple Silicon)
</a>
```

Use GitHub's `/releases/latest/download/` URL pattern — it always redirects to the newest release automatically.

---

### 2.2 Windows Package Managers

#### winget (Windows Package Manager) — Free, ~1–2 weeks to get approved
winget is built into Windows 11 and available on Windows 10. Millions of developers use it.

```bash
winget install Samuel00098.Soryq
```

**How to submit:**
1. Fork `https://github.com/microsoft/winget-pkgs`
2. Create the folder: `manifests/s/Samuel00098/Soryq/1.0.0/`
3. Add three YAML files: `Samuel00098.Soryq.yaml`, `Samuel00098.Soryq.installer.yaml`, `Samuel00098.Soryq.locale.en-US.yaml`
4. Open a pull request — a bot validates the manifest automatically
5. Approval usually takes 1–5 business days

**Example installer manifest:**
```yaml
PackageIdentifier: Samuel00098.Soryq
PackageVersion: 1.0.0
Platform:
  - Windows.Desktop
MinimumOSVersion: 10.0.17763.0
InstallerType: nullsoft
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/Samuel00098/soryq/releases/download/v1.0.0/Soryq_x64-setup.exe
    InstallerSha256: <SHA256_OF_YOUR_EXE>
ManifestType: installer
ManifestVersion: 1.6.0
```

#### Chocolatey — Popular in enterprise Windows environments
Submit at `https://push.chocolatey.org/`. Takes a bit more setup but reaches a different corporate audience.

---

### 2.3 macOS Package Managers

#### Homebrew Cask — The standard for macOS developer tools
```bash
brew install --cask soryq
```

**How to submit:**
1. Fork `https://github.com/Homebrew/homebrew-cask`
2. Create `Casks/s/soryq.rb`
3. Open a pull request

**Example cask:**
```ruby
cask "soryq" do
  version "1.0.0"
  sha256 "SHA256_OF_YOUR_DMG"

  url "https://github.com/Samuel00098/soryq/releases/download/v#{version}/Soryq_aarch64.dmg"
  name "Soryq"
  desc "Lightweight AI-native developer workspace"
  homepage "https://soryq.dev"

  app "Soryq.app"
end
```

Approval typically takes 1–2 weeks. The Homebrew team is thorough but fair.

---

### 2.4 Linux Package Managers

#### Snap Store
```bash
snap install soryq
```
- Create an account at `snapcraft.io`
- Add a `snap/snapcraft.yaml` to your repo
- Build and publish: `snapcraft && snapcraft upload soryq_1.0.0_amd64.snap`
- Snap is pre-installed on Ubuntu (the most popular Linux distro)

#### Flatpak / Flathub
The preferred format for GNOME/modern Linux desktops.
- Submit to `https://github.com/flathub/flathub`
- Requires a `com.samue.Soryq.yaml` manifest
- Flathub has 2+ million monthly active users

#### AUR (Arch User Repository)
Arch Linux users. Publish a `PKGBUILD` at `aur.archlinux.org`. Arch/Manjaro users adopt developer tools early — great for word of mouth.

---

### 2.5 App Stores

#### Microsoft Store
Tauri has first-class Microsoft Store support. This is the best way to reach non-developer Windows users.

**How:**
1. Register as a Microsoft Developer ($19 one-time fee)
2. In `tauri.conf.json`, add:
```json
"bundle": {
  "targets": ["nsis", "msi", "app"],
  "windows": {
    "allowDowngrades": false
  }
}
```
3. Build with `cargo tauri build --target app`
4. Submit the `.msix` package to Partner Center at `partner.microsoft.com`

Benefits: Auto-updates handled by the Store, no SmartScreen warning, visible to millions of Windows users browsing the Store.

#### Mac App Store
Requires Apple Developer account ($99/year) and **sandboxing** your app. Tauri's PTY terminal makes full sandboxing tricky — you'd need to request entitlements for shell execution. Still achievable but requires more work. Consider this Phase 3.

---

## Phase 3: Marketing Engine

Distribution gets you *available*. Marketing gets you *discovered*.

### 3.1 Social Media Presence

#### Twitter/X — The developer community's home
- Create `@SoryqApp` or `@SoryqDev`
- Post frequency: 3–5 times/week
- Content that works:
  - Short screen recordings of features (< 30 seconds)
  - "Did you know Soryq can..." tips
  - Behind-the-scenes: "Building feature X — here's how it works"
  - Milestone posts: "10k downloads! 🎉"
  - Honest dev logs: "Spent 3 days fixing this bug. Here's what I learned."

#### Reddit — Where developers discover tools
Key subreddits to engage with:
| Subreddit | Subscribers | Best for |
|-----------|-------------|----------|
| r/programming | 6M | General developer audience |
| r/webdev | 2.5M | Web developers |
| r/rust | 350k | Your Rust backend is a talking point |
| r/svelte | 60k | Your Svelte frontend |
| r/devops | 400k | Terminal/workflow angle |
| r/opensource | 200k | OSS launches |

**Rule:** Don't just post your launch. Participate genuinely for weeks before. Answer questions. Help people. Then share Soryq naturally.

#### GitHub — Where developers live
- Star your own repo to seed the count
- Write excellent GitHub Discussions to build community
- Use GitHub Sponsors to enable sponsorship early
- Add topics to your repo: `tauri`, `svelte`, `terminal`, `developer-tools`, `ide`, `rust`

---

### 3.2 Content Marketing

#### A Dev Blog
Write technical posts about how you built Soryq. These perform exceptionally well on:
- **Hacker News** (via "Show HN" posts)
- **dev.to** — Free, huge developer audience
- **Medium** — Works well for broader tech audience
- **Hashnode** — Developer-focused blogging platform

**Post ideas that get traction:**
1. *"How I built a cross-platform terminal in Rust with Tauri"*
2. *"Why I chose Svelte 5 over React for a desktop app"*
3. *"Building a PTY terminal from scratch: what I learned"*
4. *"Soryq vs VS Code: the performance numbers"*
5. *"From 0 to 10k users: what worked and what didn't"*

#### YouTube / Short-form Video
A 2–3 minute product demo video is essential. Post it to:
- YouTube (evergreen, shows up in search)
- Twitter/X (native video gets more reach than links)
- LinkedIn (reaches a professional developer audience)

For short-form: TikTok and YouTube Shorts with 30-second feature demos are surprisingly effective for developer tools.

---

### 3.3 Developer Influencers / YouTubers

Reach out to developers who review tools. A single video from the right creator can drive tens of thousands of downloads.

**Target channels:**
- Fireship (4.5M subs) — short, fast-paced tech videos
- Theo (t3.gg) — Web dev, very engaged audience
- The Primeagen — Systems programming, Rust/terminal crowd (perfect for Soryq)
- Melkey — Go/Neovim crowd, crossover with terminal tools
- typecraft — Terminal tools, tmux, developer workflow

**How to approach:** Send a genuine, short email. Offer a personal walkthrough. Don't send a generic press release.

---

### 3.4 Communities & Forums

- **Hacker News**: Post "Show HN: Soryq – a lightweight developer workspace built with Tauri and Rust"
- **Product Hunt**: Schedule a launch day (more on this in Phase 4)
- **Discord servers**: Share in developer tool channels in servers like Tauri's official Discord, Svelte's Discord, Theo's Discord
- **Dev.to**: Cross-post your blog content
- **Lobsters**: Tech-focused link aggregator, good for the Rust/systems angle

---

## Phase 4: Launch Event

A coordinated launch day creates momentum. Momentum creates press coverage. Press coverage creates more downloads.

### 4.1 Product Hunt Launch

Product Hunt is the single best place to launch a developer tool. A good launch can get you:
- 500–2000 upvotes (top product of the day)
- Featured in their newsletter (50k+ subscribers)
- TechCrunch/The Verge pickup (top products get covered)
- 5,000–50,000 website visits in 24 hours

**How to maximize your Product Hunt launch:**

1. **Schedule it**: Launches go live at 12:01 AM Pacific. Schedule for a Tuesday or Wednesday (highest traffic days).
2. **Get a hunter**: Ask a well-known Product Hunt user to "hunt" your product. This gives it more visibility.
3. **Prepare assets**: Logo, tagline, screenshots, a 60-second demo video, first comment explaining your story.
4. **Build a notify list**: Before launch, collect emails of people who want to be notified. Tools like `betapage.co` or a simple email form work.
5. **Day-of coordination**: Message your network at launch time asking them to upvote *if they genuinely like it*. Don't beg or use fake accounts — Product Hunt bans this.
6. **Engage all day**: Reply to every comment on launch day. The algorithm rewards engagement.

**Your tagline ideas:**
- *"A lightweight terminal-first workspace. No Electron, no bloat."*
- *"Terminal + Editor + Git + Preview in one window. Built with Rust."*
- *"The developer workspace that doesn't slow you down."*

---

### 4.2 Hacker News "Show HN"

Post on the same day or one day after Product Hunt. HN's developer audience overlaps with but is distinct from Product Hunt.

**Format:**
> **Show HN: Soryq – a Tauri+Rust developer workspace with terminal, editor, git, and live preview**
>
> I've been building Soryq for the past [X] months. It combines a real PTY terminal (xterm.js + portable-pty), CodeMirror editor, git integration, and a live preview proxy into a single app — no Electron, just a ~[X]MB binary.
>
> What's different from VS Code: [X]. What's different from Warp: [X].
>
> Repo: [link] | Download: [link]

HN readers love technical details. Be ready to answer deep questions about your Rust backend, PTY implementation, and architecture decisions.

---

### 4.3 Reddit Launch Posts

Post on the same week (not same day) as PH/HN:
- r/rust: Focus on the Tauri + portable-pty architecture
- r/programming: Broad appeal post
- r/webdev: Focus on the live preview and CodeMirror editor
- r/svelte: Focus on the Svelte 5 runes frontend

**Each post should be different** — tailor the angle to each community.

---

### 4.4 Press Outreach

Send a short, personal pitch to tech journalists who cover developer tools:
- **The Verge** (tech/consumer angle)
- **Ars Technica** (technical depth angle)
- **InfoQ** (developer-focused)
- **TechCrunch** (startup angle — works if you frame it as "open source alternative to X")
- **Console.dev** (newsletter specifically about open source tools — perfect fit)

**Pitch template:**
> Subject: Open source developer workspace built with Rust (no Electron)
>
> Hi [Name], I've built Soryq — a cross-platform developer workspace that combines a real terminal, code editor, git, and live preview in a single lightweight app. It's built with Tauri 2 (Rust) instead of Electron, so it's ~[X]x smaller and faster.
>
> Just launched today: [website] | [GitHub]
>
> Happy to do a quick demo or answer any questions. — [Your name]

Keep it under 100 words. Journalists get hundreds of pitches. Short and specific wins.

---

## Phase 5: Post-Launch Growth

The launch is just day one. Sustained growth comes from what you do in the weeks and months after.

### 5.1 Telemetry & Analytics (Opt-In)

You need data to improve the product. Set up:
- **Crash reporting**: Sentry (free tier covers small apps) or a self-hosted Glitchtip
- **Anonymous usage analytics**: PostHog (open source, self-hostable) — which panels are used most, what terminal layouts, which languages in the editor
- **Download analytics**: GitHub releases API gives you download counts per asset

Always make telemetry **opt-in**, be transparent about what you collect, and include a privacy policy.

### 5.2 Community Building

- **Discord server**: Create an official Soryq Discord. Categories: #announcements, #help, #feature-requests, #showcase, #dev-chat
- **GitHub Discussions**: Enable and actively participate. Answer every question in the first month.
- **Monthly changelog**: Post a short update every month. Even "not much changed but here's what I'm working on" keeps people engaged.
- **Public roadmap**: Use GitHub Projects or a simple public Notion page showing what's coming. This builds anticipation.

### 5.3 Feedback Loops

- Add a "Send Feedback" button in the app (opens a GitHub issue template or a simple form)
- Do user interviews: DM 10 users and offer 20 minutes on a call. What you learn is invaluable.
- Monitor Twitter/X for mentions — reply to everyone who posts about Soryq

### 5.4 SEO

Your website should rank for searches like:
- "lightweight VS Code alternative"
- "Tauri desktop app developer tools"
- "terminal and code editor in one app"
- "Warp terminal alternative"
- "Electron alternative developer workspace"

Create dedicated pages for each comparison: `/vs-vscode`, `/vs-warp`, `/vs-cursor`. These comparison pages are high-intent — people searching "Soryq vs VS Code" are already considering switching.

---

## Phase 6: Monetization

If you want to sustain development (and eventually go full-time), you need a revenue model. Here are the most viable options for an open source developer tool:

### Option A: Open Core (Recommended)
| Tier | Price | Features |
|------|-------|----------|
| **Free / Community** | $0 | Everything that exists today |
| **Pro** | $8–12/month | AI integration (BYOK), cloud workspace sync, extra themes, priority support |
| **Team** | $15–20/user/month | Shared workspaces, team settings, usage analytics |

### Option B: GitHub Sponsors + Donations
Simpler to start. Add a Sponsor button to your GitHub. Won't make you rich but covers server costs. Works well combined with Option A.

### Option C: Sponsorware
Develop premium features in private for sponsors first, then open source them after reaching a threshold. Made popular by Caleb Porzio (creator of Livewire/Alpine.js).

### Option D: One-Time Purchase
Sold as a one-time license ($25–50). Simpler than subscriptions. Works well for tools with high perceived value. Examples: Retcon, Pastel, Proxyman.

> [!TIP]
> Start with **GitHub Sponsors** immediately (zero effort, signals the project is maintained). Add **Pro features** once you have enough users to validate what people will pay for. Don't guess — ask your users.

---

## Timeline Overview

```
Week 1–2:   Code signing setup, domain purchase, website v1
Week 3–4:   winget + Homebrew submission, Snap Store submission
Week 5:     Screenshot/video production, social accounts created
Week 6:     Soft launch — share with close network, fix bugs
Week 7:     Product Hunt launch day + Hacker News + Reddit posts
Week 8:     Press outreach, influencer DMs
Week 9–12:  Community building, blog posts, respond to feedback
Month 3+:   App Store submissions, plugin ecosystem, monetization
```

---

## Cost Summary

| Item | Cost |
|------|------|
| Domain (`soryq.dev`) | ~$15/year |
| Apple Developer Account | $99/year |
| Microsoft Store Registration | $19 one-time |
| EV Code Signing Certificate | $300–500/year |
| Hosting (Vercel/Cloudflare) | Free |
| Sentry crash reporting | Free (small scale) |
| **Total Year 1** | **~$430–630** |

> [!NOTE]
> You can skip the EV certificate at first and use a standard OV certificate or SignPath's free tier. But budget for EV before you do any serious marketing push — the SmartScreen warning is a conversion killer.

---

## The Single Most Important Thing

**Ship, then market. Don't market, then ship.**

Every successful developer tool launch follows the same pattern: the product is genuinely good first, then the creator shares it honestly with their community, and word of mouth does the rest. No amount of marketing will save a product with a bad first-run experience.

Before you go public:
1. Install Soryq on a **brand new machine** you've never used
2. Time how long it takes from download to productive use
3. Fix every friction point you encounter

If that experience is smooth and impressive, you're ready to launch.
