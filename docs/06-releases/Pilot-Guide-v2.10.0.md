# TAM OS v2.10.0 — Controlled Pilot Guide

**Audience:** the named internal TAM operators running the v2.10.0 pilot.
**Status:** v2.10.0 is **published** (tag `v2.10.0`, marked Latest) so the verified artifact can be
obtained and checksum-verified. It is **not general-use software**, and **the pilot has not launched** —
it begins only when the artifact is actually handed to you. This is an internal working document, not
marketing material.

> **Read section 1 before you open the application.** It tells you what this software is and, just as
> importantly, what it is not.

---

## 1. What TAM OS is — and what it is not

TAM OS is a single-file HTML application. It runs entirely inside your browser on your own device.
There is no server, no account, and no network sync — **your data never leaves the device**.

One precision, because it matters for how you use it: single-file packaging is **not** the same as
fully offline. The application's own code is all in the one file, but the web fonts and the
spreadsheet parser are still fetched from the internet. See "Keep internet access available" below.

**"Acting as" is not a login.** At the top of the sidebar you choose a principal — *Executive (CEO)*
or *Employee*. This selects the **workspace context** you are working in. It is a local,
trust-based application context:

- It is **not authentication**. There is no password and nothing is verified.
- It is **not a security boundary**. Anyone who can open the application on this device can select
  any principal, including CEO.
- What it *does* do is keep the product behaving correctly for the role you are working in — an
  Employee context sees only their own records and cannot perform company-wide actions.

Treat the **device and browser profile** as the real security boundary. Lock your computer.

**Your data lives in one browser profile on one device.** It is not backed up anywhere
automatically. There is **no cloud backup and no sync**. If that browser profile is cleared, reset,
or lost, the data is gone unless you have exported a backup file. Section 5 is therefore not
optional.

---

## 2. Who should use it — and who should not

**Should use it (pilot participants):**
- 1–3 named internal TAM operators.
- Working on a desktop or laptop browser.
- Ideally one controlled device / browser profile per operator.
- Comfortable exporting a backup file and reporting problems.

**Should not use it yet:**
- Anyone outside the named pilot group.
- Anyone on a shared, public, or kiosk machine.
- Anyone on a phone or tablet — the pilot is **desktop-only** (see the known limitations).
- Anyone expecting multi-user access, permissions enforced against other people, or an audit trail
  that proves *who* did something. The activity log records *what* happened, not *who* authenticated.

---

## 3. Opening TAM OS

**Browser:** a current Chrome or Edge on Windows is the pilot's supported configuration. Firefox and
Safari are expected to work but are not part of the pilot's tested set.

**To open it:** double-click the file `tam-os-v2.10.0.html`. It opens as a normal web page. There is
nothing to install.

**Keep internet access available.** All of TAM OS's own code is inside the one file, but two things
are still loaded from the internet: the web fonts, and the spreadsheet parser used for `.xlsx`
import. Offline, TAM OS still opens, and everything except `.xlsx` import works normally —
your data is local either way — but **`.xlsx` import will not run** (see section 8). `.csv` import
is unaffected.

**First thing you will see:** an essentially empty workspace, and in the sidebar:

> *No principal selected — choose who you are acting as above to see your data and actions.*

This is expected and correct. **The application deliberately does not guess who you are.** Until you
choose, it shows nothing sensitive and allows no actions.

**So: pick your principal from the "Acting as" dropdown first.** Then the workspace fills in.

Your choice is **not remembered** between sessions — you will choose again each time you open the
file. That is intentional for the pilot: it keeps the fail-closed behaviour honest.

---

## 4. What each principal can do

### Executive (CEO)
The full company workspace:
- See all employees, contracts, payroll plans and transactions.
- Generate, review, approve and post payroll; execute transactions.
- Import spreadsheets (Smart Import), and undo the last import.
- Change company settings, export and restore backups, and reset the application.

### Employee
Their own workspace only:
- See **their own** employee record, contract, payroll and overtime — and nobody else's.
- Submit and manage their own draft records where the workflow allows it.
- **Cannot** see other employees' identities, salaries or details — not through the employee lists,
  not through search, and not by opening a link to another person's record directly.
- **Cannot** manage payroll, commit imports, change settings, or reset data.

**Navigation stays fully visible in both contexts.** Nothing is hidden from the menu. If a button is
greyed out, that is deliberate — see section 7.

---

## 5. Backups — the most important section

The Complete Backup file is your **only** recovery mechanism. Please follow this cadence.

**Where to save backups.** A folder on a drive that is itself backed up — your OneDrive/company
network folder, not the browser's Downloads folder. Keep the filename the app gives you; it contains
the date. Keep **at least the last 5**, and never delete the last known-good one.

### Backup cadence

| When | What to do |
|---|---|
| **Before you start the pilot** (before entering anything) | Export a Complete Backup. This is your baseline. |
| **At the end of every working session** in which you changed anything | Export a Complete Backup. |
| **Before any destructive action** — Start Fresh, Reset All Data, restoring a backup, undoing an import | Export a Complete Backup first. The app also takes its own safety copy, but take your own. |
| **Before replacing the application file** with a newer build | Export a Complete Backup. Always. |
| **At minimum, daily** on any day you used the app | Export a Complete Backup. |

If in doubt: export. The file is small and there is no downside to having too many.

### How to export a backup
1. Go to **Settings**.
2. Under **Data Portability**, click **Export Complete Backup (JSON)**.
3. Save the downloaded `.json` file to your backup folder.

The file contains everything: transactions, employees, contracts, payroll, overtime, settings and
prior backups. It records `schemaVersion 6`.

### How to restore a backup
1. Go to **Settings** → **Data Portability**.
2. Click **Import Complete Backup…** and choose your `.json` file.
3. TAM OS shows a **preview** first — the filename, the transaction count, the company name, the
   schema version, and when it was exported. **Check this is the file you meant.**
4. Click **Restore This Backup** and confirm.

Restoring **replaces all current data**. The app takes a safety backup of the current data first.

---

## 6. Importing a spreadsheet

1. Acting as **CEO**, go to **Import**.
2. Choose the **Import Purpose** (Initial Company Setup, Historical Payroll Migration, Finance
   Transactions Only, or Review Without Commit).
3. Click the drop zone and pick your `.xlsx` or `.csv` file.
4. TAM OS parses it and shows you what it found **before** anything is saved. Review it.
5. Select the rows you want and click **Commit Selected**, then confirm.
6. A safety backup is taken automatically before the commit.

**If it went wrong:** on the results page, click **Undo Last Smart Import**.

The undo tells you exactly what it will and will not remove, and you should read it. In particular:
**a transaction that has already been executed or edited is never removed by an undo.** If that
happens, the employee, contract and payroll plan it depends on are kept too, and the confirmation
message will say so explicitly. This is deliberate — rollback never destroys executed financial
records. If you need those gone, restore a backup from before the import instead.

---

## 7. Why a button is greyed out

A greyed-out button means the principal you are acting as may not perform that action.

**Hover your mouse over it and a tooltip explains why.**

Two honest caveats for the pilot:
- The tooltip needs a **mouse hover**. It is not reachable by keyboard, and it does not appear on a
  touchscreen. This is why the pilot is desktop-and-mouse only.
- "Greyed out" can also mean an ordinary operational reason (for example, payroll actions are
  disabled while a period is locked) rather than a permissions one. The tooltip tells you which.

If a control is greyed out and you believe it should not be, check your **Acting as** selection
first — it is the most common cause.

---

## 8. Known limitations

| Limitation | What it means for you |
|---|---|
| **Acting-as is not authentication** | Anyone with access to the device can act as CEO. Protect the device. |
| **`.xlsx` import needs internet** | The spreadsheet parser is loaded from a CDN. Offline, `.xlsx` import will not run; `.csv` import is unaffected. |
| **Greyed-out reasons need a mouse** | Tooltips are hover-only — not keyboard- or touch-accessible. Desktop-only pilot. |
| **One device, one browser profile** | No sync, no cloud backup. The exported backup file is the only copy that survives losing the profile. |
| **Principal is not remembered** | You choose your principal each time you open the file. |
| **Not multi-user** | Two people using it are two independent datasets, not one shared one. |

---

## 9. If something goes wrong

**Stop using the application.** Do not try to "fix it forward" by entering more data.

1. **Do not clear your browser data.** Whatever is still there may be recoverable.
2. **Export a Complete Backup right now if you still can** — even a broken-looking state is useful
   evidence, and it may be more current than your last good backup.
3. **Restore your last known-good backup** (section 5) if you need to keep working.
4. **Report it** (section 10).

The full rollback procedure — including going back to the previous v2.9.0 application file — is in
[Rollback-Plan-v2.10.0.md](Rollback-Plan-v2.10.0.md).

---

## 10. Reporting a problem

Report to the pilot maintainer directly. Please include:

- **What you were doing** — the page, the principal you were acting as, and the step.
- **What you expected** and **what actually happened**.
- **When** it happened (date and approximate time).
- Whether you can **reproduce** it.
- The **application version** — Settings → About should read **TAM OS v2.10.0**.

**Do not** paste real employee, salary, or payroll data into a bug report, a chat message, or a
screenshot. Describe the shape of the problem ("a payroll row for one employee showed a blank
amount"), not the confidential content. If the data itself is essential to diagnosing it, say so and
the maintainer will arrange a private channel.

Security concerns follow [`SECURITY.md`](../../SECURITY.md) and are reported privately, never as a
public issue.

---

## 11. What not to do during the pilot

- **Do not** use it on a shared or public computer.
- **Do not** skip the backup cadence in section 5.
- **Do not** clear browser data, use private/incognito windows, or "clean up" browser storage.
- **Do not** move the data to another device by copying browser files — use Export/Import backup.
- **Do not** replace the application file without exporting a backup first.
- **Do not** treat the Acting-as selector as an access control for other people.
- **Do not** commit or share real company data outside the application.

---

## Related documents

- [Rollback-Plan-v2.10.0.md](Rollback-Plan-v2.10.0.md) — recovery and rollback procedure
- [Release-Checklist-v2.10.0.md](Release-Checklist-v2.10.0.md) — the pilot readiness gate
- [`RELEASE_NOTES.md`](../../RELEASE_NOTES.md) — what changed in v2.10.0
- [`docs/DATA-SAFETY.md`](../DATA-SAFETY.md) — the data-safety model in detail
