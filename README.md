# iMessage Wrapped (beta)

Spotify Wrapped for your iMessage group chats. It runs on your Mac.

![A group chat's wrap: story slides with awards and the chat's greatest hits](docs/images/wrap.png)

Pick a group chat and get story slides: who talks the most, who ghosts, who starts every conversation, the chat's greatest hits (ranked by the reactions you all already gave), and awards like The Ghost, Night Owl and Double Texter. Then send the group a link. They tap through it on any phone, with no app to install.

**Install on a Mac** (paste into Terminal):

```bash
curl -fsSL https://wrapped.smitpatel.xyz | sh
```

**Just looking?** [Try the demo](https://wrapped.smitpatel.xyz/#demo). It uses a made-up group chat.

This is a beta. Expect rough edges, and please [open an issue](https://github.com/smitsp11/wrapped/issues) when something feels off.

## What you need

- A Mac (Apple Silicon or Intel) that's signed in to Messages. Turn on Messages in iCloud so your full history is on the Mac.
- About two minutes, and one switch in System Settings (Full Disk Access, explained below).

You don't need Node or anything else installed. Your friends only need a phone or browser to watch.

## What happens when you run it

1. The install line downloads one program into `~/.imessage-wrapped/bin`, checks its SHA-256 checksum, and adds one line to your shell's startup file so you can type `wrapped` next time. Then it starts.
2. The first time, it says what it reads and asks if you want to continue.
3. If your terminal app doesn't have Full Disk Access yet, it opens the right page in System Settings and tells you what to switch on.
4. It tells you how far back your messages go, then lets you pick: **My year** (you and your top 5 people across all your chats) or one or more **group chats**.
5. Your wraps open in your browser, on a page served by the program on your own Mac (`127.0.0.1`). For each one you can play it, see exactly what goes into the link, untick any quote or signature word, copy a cover image, copy the link, or press **Open Messages** to start a new message with the link filled in. You choose who it goes to and press send yourself. It never sends anything for you.

Run `wrapped` again any time to make new wraps or reopen saved ones.

## Privacy

- **Everything runs on your Mac.** The program reads a temporary copy of your Messages database and your Contacts, works out the numbers, and deletes the copy when it's done (also if you press Ctrl-C or close the window).
- **The wrap lives in the link.** A link looks like `https://wrapped.smitpatel.xyz/#…`. The wrap is packed into the part after `#`, and browsers never send that part to any server. The website is plain static files: it stores nothing and never sees the wrap. (Like any website, its host sees the ordinary request for the page.)
- **No AI, no analytics, no account.** Every slide is a number counted from your messages. The program makes no network requests of its own; the only download is the install.
- **No phone numbers or emails in a link.** People are stored as short ids with the names from your Contacts. Anyone who isn't in your Contacts shows up masked, like `+1 ••• ••• 4821`.
- **You see what's in the link before you share.** Besides the stats, awards and top words, the page lists every quote and signature word that goes in, and you can untick any of them. Quotes that look like they contain a phone number or email start unticked. Links are capped at 8 KB; if a wrap is too big, the least-reacted quotes are left out.
- **My year stays about you.** It names only you and the 5 people who sent the most messages in your chats. Everyone else is grouped as "Everyone else", and only your own words and quotes are used.
- **Saved wraps stay on your Mac**, in `~/.imessage-wrapped/wraps`, readable only by your user account.

### Why Full Disk Access?

macOS keeps the Messages database (`~/Library/Messages/chat.db`) and the Contacts database behind Full Disk Access, and no program can give itself that permission. So you turn it on for your terminal app (Terminal, iTerm, Warp, VS Code…) in **System Settings → Privacy & Security → Full Disk Access**.

Be aware that this lets anything you run in that terminal read those files, not just `wrapped`. You can switch it off again when you're done making wraps.

### Uninstall

```bash
rm -rf ~/.imessage-wrapped
sed -i '' '/# added by iMessage Wrapped/d' ~/.zshrc
```

That deletes the program, your saved wraps and the consent note, then removes the one `PATH` line the installer added. If you use bash, the line is in `~/.bash_profile` (or `~/.bash_login` or `~/.profile`, whichever existed first), so run the `sed` line on that file instead. If you set `ZDOTDIR`, it's in `$ZDOTDIR/.zshrc`. Then turn off Full Disk Access for your terminal app if you no longer need it. Links you already sent keep working, because the wrap is inside the link.

## The awards

Each award comes from one number. To keep it fair:

- Someone needs at least 50 messages to win anything.
- If two people tie for the top, nobody gets that award.
- The winner has to clear a minimum, so nobody becomes "The Ghost" for replying in 3 minutes.

| Award | Goes to | Minimum |
|---|---|---|
| Main Character | the biggest share of messages | none |
| The Ghost | the slowest typical reply | 1 hour, over at least 10 replies |
| The Starter | the most conversations started | 3 |
| The Comedian | the most laughs received per message | 1 laugh per 100 messages |
| Hype Man | the most reactions given | 3 |
| Night Owl | the biggest share of messages sent 12–5 AM | 10% |
| Double Texter | the most double texts | 3 |
| The Lurker | the smallest share of messages | under half of an even share, in a group of 3 or more |

My year wraps don't give Main Character or The Lurker.

## Limits

- You need a Mac to make a wrap. Anyone can watch one.
- If Messages on this Mac only has part of your history (a new Mac, or "Keep messages" set to 30 days or 1 year), the wrap only covers that part. The program warns you when it looks thin.
- If a chat moved between iMessage and SMS, each part counts as its own chat.
- In group chats with Android members, some carriers may cut very long links.
- In languages written without spaces (Chinese, Japanese, Thai), whole phrases count as one word.
- The program isn't signed with an Apple Developer ID or notarized yet. The installer's checksum catches broken downloads, not a compromised host. You can [read the installer](https://wrapped.smitpatel.xyz/install.sh) before running it.

## How it works

The `wrapped` program is TypeScript compiled with `bun build --compile` into one file per Mac architecture, with the web pages embedded. Each release's builds and their checksums are attached to a [GitHub release](https://github.com/smitsp11/wrapped/releases), and the installer on the website names the exact release it downloads.

| Folder | What it does |
|---|---|
| `src/extract` | copies `chat.db` and reads chats, messages and contact names from the copy |
| `src/stats` | the numbers: volume, timing, replies, conversation starters, reactions, greatest hits, words |
| `src/awards` | the award rules |
| `src/wrap` | puts everything into one wrap and replaces phone numbers and emails with short ids |
| `src/share` | packs a wrap into a link, and checks links before showing them |
| `src/app` | the `wrapped` program: the terminal steps, the local server on `127.0.0.1`, saved wraps |
| `src/cli.ts` | an older developer CLI (`npm run wrapped`) |
| `web` | the slide viewer, the landing page and the local "your wraps" page |
| `site` | `install.sh` and the website's routing (`vercel.json`) |
| `fixtures` | the fake Messages and Contacts databases used by the tests and the demo |
| `scripts` | the release build and test helpers |

The local server listens only on `127.0.0.1`, rejects requests addressed to any other host name, and its API needs a random token that's new each run.

## Build from source

You need [Node.js](https://nodejs.org) 22 or newer, and [Bun](https://bun.sh) to build the program.

```bash
git clone https://github.com/smitsp11/wrapped.git
cd wrapped
npm ci
npm run web:dev          # the viewer at http://localhost:5173/#demo (fake data)
```

To build and run the real program from source (it reads your own Messages, so it needs Full Disk Access like above):

```bash
npm run app:build        # makes release/wrapped
./release/wrapped
```

`npm run release` builds both Mac architectures with checksums into `release/` and the website into `deploy/`.

## Run the tests

```bash
npm test                          # unit and integration tests, including the installer
npm run typecheck
npx playwright install chromium   # once
npm run e2e                       # browser tests, desktop and phone sizes
npm run test:bun                  # builds the program and runs it against the fake database (needs Bun)
```

The tests use a generated fake Messages database with a scripted group chat whose answers are known in advance (for example, Jordan's typical reply is exactly 5 hours). No real messages or contacts are in this repo. The installer tests run against a local server with a temporary `HOME`, so they never touch your shell settings.

## License

MIT. See [`LICENSE`](LICENSE).
