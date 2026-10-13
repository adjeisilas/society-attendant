# Staff Attendance

A clock-in and clock-out system for one hospital. Staff clock in and out at **attendance terminals**: computers registered at a location, where each person signs in with their own staff ID (or email) and password. Every rule is checked on the server.

**Stack:** Next.js (App Router) · TypeScript · Supabase (PostgreSQL, Auth, Storage) · Zod

## Documentation

- [Database & authorization design](docs/01-database-and-authorization-design.md) (the original design)
- [Single hospital, attendance terminals, no leave](docs/02-single-hospital-and-terminals.md) (what changed since, and why)

## Project status

| Phase | Scope | Status |
|---|---|---|
| 1 | Database and authorization design | Done |
| 2 | Scaffold, core migrations (tenancy, identity, organization, scheduling), RLS, audit, database tests | Done |
| 3 | Authentication (invite-only), app shell, role-aware navigation | Done |
| 4 | Departments, staff (with account invitations), shift templates, roster | Done |
| 5 | Attendance locations, check-in/out engine, attendance views | Done |
| 6 | Attendance corrections, notifications | Done |
| 7 | Reports and CSV export, audit log viewer, settings, attachments | Done |
| 8 | Single hospital, attendance terminals (replacing QR codes), leave removed, new interface | Done |

## Prerequisites

- Node.js 22.18+ (tests run TypeScript directly with Node's type stripping)
- A Supabase project (for running the app; not needed for database tests)

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
```

### Supabase project settings

In the Supabase dashboard:

1. **Authentication → Sign In / Providers:** disable "Allow new users to sign up". Accounts are created by invitation only.
2. **Authentication → URL Configuration:** set the Site URL to the application URL (for example `https://attendance.example.org`).
3. **Authentication → Email Templates:** point links at the confirmation page, which verifies the token only after the user clicks *Continue*. Email security scanners that open links automatically cannot use up the token.
   - *Invite user:* `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
   - *Reset password:* `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
4. **Authentication → Passwords:** set the minimum length to 12 and enable leaked password protection where your plan allows it.
5. **Authentication → Rate Limits:** raise *sign-ups and sign-ins* to cover your busiest shift change (for example 300 per 5 minutes). Every clock-in is a password sign-in made from the application server, so all terminals share one limit.
6. **API settings:** keep only the `public` schema exposed. The `private` schema must never be exposed.
7. **Database → Extensions:** enable `pg_cron`, then schedule the attendance job. The migration schedules it automatically when the extension is already installed; otherwise run once:

   ```sql
   select cron.schedule('finalize-attendance', '*/10 * * * *', $$select private.finalize_elapsed_shifts()$$);
   ```

   The job marks elapsed shifts with no clock-in as absent and closes sessions whose clock-out window has passed. Without it, absences are never recorded.

### Applying migrations

Migrations live in [`supabase/migrations`](supabase/migrations). Set `SUPABASE_DB_URL` in `.env.local` to the **session pooler** connection string (Dashboard → Connect → Session pooler, port 5432), then:

```bash
npm run db:migrate:status  # list applied and pending migrations
npm run db:migrate         # apply pending migrations, each in its own transaction
```

The script needs `psql` on `PATH` (or `PSQL_PATH`). The direct connection host (`db.<project-ref>.supabase.co`) is IPv6-only, so use the pooler on networks without IPv6. Applied migrations are recorded where the Supabase CLI looks for them, so `npx supabase db push` also works later.

> **Upgrading an existing database:** the three `20260922…` migrations **delete** leave types, leave requests, leave notifications, QR codes and the phone positions recorded with past scans. Back up the database first if any of that matters.

### Bootstrapping

The database rejects any account that was not authorized in advance: staff and hospital admins through an invitation, super admins through a short-lived grant that only the secret key can create.

1. Create the first super admin from a trusted machine. The script prompts for the password without echoing it:

   ```bash
   npm run admin:create -- admin@example.org Platform Administrator
   ```

   It calls `authorize_super_admin_signup` (service role only; the grant expires after 15 minutes) and then `auth.admin.createUser`. Setting `app_metadata.role` in `createUser` is not enough: Supabase Auth writes `app_metadata` after inserting the user, so the provisioning trigger never sees it.

2. Sign in as that super admin. With no hospital yet, the app asks you to **set up the hospital** (name, code, time zone). This works once: the database refuses a second hospital.
3. Add departments, shift templates and staff, then create a location and register its terminals (see below).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type checking |
| `npm test` | Unit tests, then database tests |
| `npm run test:unit` | Unit tests for pure application logic (permissions, navigation, redirects, validation) |
| `npm run test:db` | Apply all migrations to an in-memory PostgreSQL (PGlite) and run the database tests |
| `npm run db:types` | Regenerate `src/types/database.ts` from the migrations |
| `npm run db:types:check` | Fail if `src/types/database.ts` is out of date |
| `npm run db:migrate` / `db:migrate:status` | Apply / list migrations on the database in `SUPABASE_DB_URL` |
| `npm run admin:create -- <email> ["Name"]` | Create a super admin account |
| `npm run admin:password -- <email>` | Set the password of an existing account |

### Database types

`src/types/database.ts` is generated from the migrations by [`scripts/generate-database-types.ts`](scripts/generate-database-types.ts), in the same format as `supabase gen types typescript`. Run `npm run db:types` after every migration change. Once a project is linked, the official generator (`npx supabase gen types typescript --linked --schema public`) produces an equivalent file.

### Database tests

`npm run test:db` needs no Docker or database server. Each test file:

1. starts an in-memory PostgreSQL ([PGlite](https://pglite.dev)),
2. loads [`tests/db/supabase-shim.sql`](tests/db/supabase-shim.sql), which reproduces the Supabase roles, `auth.uid()` and default grants,
3. applies every migration in order,
4. runs each test as a specific role and user inside a rolled-back transaction.

The tests cover row-level security for every role, account provisioning, audit logging, terminals, the clock-in engine and the scheduling rules. The fixtures still seed two hospitals: every table keeps its `hospital_id`, and the tests prove one hospital's data never leaks into another's.

## Project structure

```
docs/                   Design documents
scripts/                Tooling (migrations, database types, admin accounts)
supabase/migrations/    Database schema, RLS policies, functions (source of truth)
tests/db/               Database tests (RLS, constraints, triggers)
tests/unit/             Unit tests for pure application logic
src/app/                Next.js routes: (auth) public pages, (app) signed-in pages, terminal/ the clock-in screen
src/components/         Shared UI components and the application shell
src/features/<module>/  Module schemas, server actions and components
src/lib/                Auth (session, permissions, routes), Supabase clients, navigation
src/proxy.ts            Session refresh and sign-in redirect for every request
src/types/database.ts   Generated database types
```

### Authorization in the application

- `src/lib/auth/session.ts` is the only way pages and actions obtain the current user. It reads the profile, staff record and headed departments **under RLS**, so deactivation takes effect on the next request.
- `requireUser()` and `requireCapability()` guard pages and server actions. The proxy's redirect is only a convenience.
- `requireHospitalScope()` (`src/lib/hospital-context.ts`) resolves the hospital: the user's own, or for a super admin (whose account is not tied to one) the hospital that has been set up. `hospital_id` is always taken from the server, never from the browser.
- Capabilities (`src/lib/auth/permissions.ts`) shape the interface. The database remains the enforcement point.

## Clocking in and out

### Setting up a terminal

1. An administrator creates a **location** (for example *Main Staff Entrance*) under **Terminals**.
2. On the computer that will be the terminal, the administrator signs in, opens that location and chooses **Register this computer**, giving it a name such as *Front desk PC*.
3. **Sign out and start the terminal** signs the administrator out of that browser and opens the clock-in screen at `/terminal`.

The terminal keeps a random key in an HTTP-only cookie; the database stores only its hash. Registering the same browser again switches off the terminal it replaces. An administrator can switch off any terminal from the Terminals page, and it stops working immediately.

**Recommended terminal setup:**

- Serve the app over HTTPS. The terminal cookie is `Secure` in production.
- Use a dedicated operating-system account that opens the browser full-screen on the terminal page, for example `chrome --kiosk https://attendance.example.org/terminal`.
- Turn off the browser's password manager for that profile (Chrome policy `PasswordManagerEnabled = false`) so staff passwords are never offered for saving, and do not clear site data on exit, or the terminal forgets its key.
- Restrict access to the browser's developer tools (Chrome policy `DeveloperToolsAvailability = 2`). The key is readable there, and someone who copies it could clock in with their own password from elsewhere.

### What happens at the terminal

1. A staff member enters their **staff ID or email** and **password**, then chooses **Clock in** or **Clock out**.
2. The server signs them in on a throw-away client that never touches the browser's cookies, calls `check_in` / `check_out` as that person with the terminal key, and revokes the session straight away.
3. In the database, `check_in` / `check_out` identify the person from the session, take the time from the server clock, resolve the key to a terminal and location, find the matching rostered shift, and decide Present, Late, Half day, overtime and early leave.
4. Every attempt is written to `attendance_events`, including rejected ones, with the terminal it came from. Those rows never change afterwards.
5. The screen shows the result for a few seconds, then clears for the next person. A half-typed sign-in is cleared after 45 seconds without input.

Staff can still sign in to the staff portal on their own device to see their attendance history and ask for corrections; they cannot clock in there.

**What a terminal proves.** A clock-in needs both a valid password sign-in and a registered terminal's key: a staff member at home has no key, and a terminal can only clock in the person whose password was typed. Like any password-based system, it cannot stop someone typing a colleague's password; the scan log records the terminal and time of every attempt.

**No roster, no clock-in.** By default a clock-in must match a rostered shift. To let staff clock in without one (flagged for review), turn on *Allow clock-in without a rostered shift* in Settings.

### Reports, the audit log and settings

- **Reports** summarise attendance for a date range: present, late, absent, half days, time worked and overtime per staff member, with a daily chart and a CSV export. The reporting functions run **as the caller**, so a hospital administrator sees the hospital, a department head sees their departments, and a staff member sees only themselves. The CSV route checks access itself rather than trusting the page that linked to it.
- **The audit log** shows every recorded change with who made it, why (when a reason was required) and which fields changed. Entries can never be edited or deleted, by anyone.
- **Settings** hold the hospital's details (editable by a super admin) and the attendance rules: the minimum gap between clock-in and clock-out, how long clock-out stays open, the half-day threshold, and whether unscheduled clock-in is allowed.

### Corrections

Staff ask for wrong clock-in or clock-out times to be fixed from a record's page, optionally attaching a photo or PDF (up to 6 MB). Only hospital administrators decide them, because the times feed payroll. A correction proposes **times, never a status**: on approval the engine recalculates present/late/half-day, worked minutes, overtime and early leave with the same rules used at clock-out, clears a "no clock-out" flag, and links the record to the correction that changed it. The original times remain in the untouched scan log.

No client role writes corrections directly: every step goes through a database function that re-checks who is asking, refuses self-review, requires a reason, and records the change in the audit log. Submitting a correction notifies the reviewers; a decision notifies the requester. The bell in the top bar shows the unread count.

Evidence files go to the private `request-attachments` bucket under `{hospital_id}/{staff_id}/`, are uploaded through a server action with the user's own session, and are read back through short-lived signed links. The browser's file name is never used as a path, and storage policies enforce the same access rules as the database.

### How staff accounts are created

Supabase's invite API can only attach `user_metadata`, which users can edit themselves, so it can never carry authorization. Instead:

1. An admin invites a staff member. `prepare_account_invitation` checks in the database that the caller administers that hospital, that the staff record is active, has an email and no account, and records a short-lived row in `account_invitations`.
2. The server then asks Supabase Auth to send the invitation email. The secret key is used **only** for that call (`src/lib/supabase/admin.ts` exposes the Auth admin API and nothing else).
3. When Supabase creates the user, the `auth.users` trigger consumes the matching invitation, creates the profile with the invited role and links the staff record. Without a valid invitation (or trusted `app_metadata` for the first super admin) the account creation is rejected.
4. `profiles.activated_at` is set when the invitee confirms, which is what the staff list shows as *Invited* versus *Active*.

An admin can instead create the account with a password (generated or typed) and hand it over. The same `prepare_account_invitation` call authorizes it, with `p_with_password`, and the server calls `auth.admin.createUser`, so no email is sent. The invitation carries `requires_password_change` onto `profiles.must_change_password`, and every signed-in page redirects such an account to **/set-password** until it calls `complete_password_change` by choosing its own password. Such an account can already clock in at a terminal; the terminal reminds the person to choose their own password.

The same panel resets a password an account has forgotten: `prepare_password_reset` authorizes it (never for the caller's own account), the server calls `auth.admin.updateUserById`, and `finish_password_reset` marks the account as having to choose its own password again.

### Known gaps

- Staff photos are designed but not built.
- A terminal cannot be restricted to a network address; its protection is the key held in the browser.
