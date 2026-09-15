# The robot

One cycle of the Summer Soccer tool's automatic work, every ten minutes,
with nobody's browser open. This folder is a complete GitHub repository:
push it as-is to a **public** repository and add the secrets below.

## What a cycle does

The page decides (see `robotRun()` in the site's `index.html`); this folder
only opens the live page in a simulated browser, signed in as "Robot", and
waits for it to finish. A cycle is exactly what every open browser already
does on its own timers, and nothing else:

1. **Forms** — the nominations form is pulled and reconciled (new teams,
   changed squads, teams gone from the form, the loose-player pass); the
   referee form every 30 minutes and the dual registration form every 10,
   when their turn comes.
2. **Dribl** — the mirror is read: empty team codes filled (unless Dribl
   disagrees with itself, one code would land on two teams, or the tool
   holds a different code), referees matched, player registrations matched
   (exact matches only; "Looks like" suggestions and "Add to team" stay a
   person's job; a flag set by hand is never touched).
3. **The Sheet** — published, read-back included, on the cadence set under
   Import / Export → Overview. "By hand only" is honoured.

Not done, on purpose: placing, approving, sending any e-mail, answering any
review item, the Inbox.

The robot's report goes into the tool (`nom:robot`) and shows on
Import / Export → Overview as the **Robot** row, which turns red when the
robot has been quiet for 45 minutes during the day.

## Setting it up (once)

1. Create a new repository on github.com — **Public** (private repositories
   get 2,000 free minutes a month, which every-ten-minutes exceeds; public
   ones are unlimited). Nothing sensitive is in the repository; the two
   secrets are stored by GitHub and masked in logs, and `run.js` prints
   counts only.
2. Put the four files in it: `run.js`, `package.json`, `README.md`, and
   `workflow/robot.yml` saved in the repository as `.github/workflows/robot.yml`
   (the folder on disk keeps it under `workflow/` because `.github` folders
   cannot be written there). Not `node_modules`.
3. Settings → Secrets and variables → Actions:
   - **Secrets**: `SS_PASSWORD` (the tool's password), `JOTFORM_KEY` (the
     Jotform API key — the same one pasted into the tool).
   - **Variables**: `SS_SITE_URL` = `https://mvfc-summer-soccer-tool.netlify.app/`,
     `SS_WORKER_URL` = `https://summer-fixtures-sync.mossvalefc.workers.dev`,
     `SS_SEASON_ID` = the season id from the tool's Sync box,
     `JOTFORM_FORM_ID` = the nominations form's id (the long number in its URL).
4. Actions tab → **robot** → Run workflow (force on). Watch it go green, then
   open the tool: Import / Export → Overview should say "Robot · Last ran
   just now".
5. Settings → Notifications on your GitHub account: make sure "Actions —
   failed workflows" e-mails you. A run that fails goes red and e-mails; the
   tool's Robot row goes red on its own if runs stop arriving.

## Things worth knowing

- **GitHub's schedule is best effort.** Runs are often 5–15 minutes late and
  are dropped, not queued, when GitHub is busy. Nothing is lost: the next
  run picks up whatever the last one missed.
- **Hours.** 6am–11pm Sydney. The two cron lines cover both daylight-saving
  offsets; `run.js` checks the exact Sydney hour and exits at once outside
  the window.
- **60-day rule.** GitHub switches schedules off in a public repository
  after 60 days with no push. The `keepalive` job makes an empty commit once
  a day so that never happens. If the schedule ever shows as disabled on
  the Actions tab, enable it there.
- **Deploying the site changes the robot.** It fetches the live page every
  run, so there is no second copy of the tool to keep in step.
- **Changing the password or the Jotform key** means updating the secret
  here too; the robot will go red until you do.
- **Running it by hand** (from this folder, with Node 20+):

      npm install
      SS_WORKER_URL=… SS_SEASON_ID=… SS_PASSWORD=… JOTFORM_KEY=… JOTFORM_FORM_ID=… ROBOT_FORCE=1 node run.js

  Prints one line of JSON and exits 0 (good), 1 (failed) or 2 (timed out).
