# Single hospital, attendance terminals, no leave

**Status:** Built (migrations `20260922090000`–`20260922090200`).
**Supersedes** these parts of [01 — Database & authorization design](01-database-and-authorization-design.md): D1 (multi-tenant), §5.9 `attendance_qr_codes`, the position columns in §5.8, §5.11 and §5.2, §5.13–5.14 (leave), §6.2–6.3 (scan signatures), §6.7 (leave side effects), §7 (QR design), and the leave rows of §8.

## 1. What changed

| Before | Now |
|---|---|
| Many hospitals; super admins switch between them. | One hospital. A super admin sets it up once (`/setup`) and edits it in Settings. |
| Staff scan a location QR code with their phone. | Staff clock in at a **terminal**: a computer registered at an attendance location. They sign in there with their own staff ID (or email) and password. |
| Phone position recorded or enforced (geofence). | Removed. A terminal does not move. |
| Leave types, leave requests, leave approval, "on leave" absences. | Removed. Absences are recorded as absences; corrections remain. |

`hospital_id` stays on every table. It costs nothing, keeps every RLS rule and test unchanged, and the single-hospital rule is enforced where a hospital is created: the `hospitals_insert` policy only lets a super admin insert when `private.hospital_exists()` is false.

## 2. Terminals

```
attendance_locations 1 ──< attendance_terminals (id, location_id, name, key_hash, revoked_at, …)
attendance_events.terminal_id ──> attendance_terminals
```

### Registering

1. An administrator opens a location's page **on the computer that will be the terminal** and chooses *Register this computer*.
2. `public.register_attendance_terminal(location_id, name)` checks the caller administers that hospital and the location is active, generates `t1.` + 32 random bytes (base64url), stores **only** `sha256(key)` and returns the key once.
3. The server action puts the key in an HTTP-only, `SameSite=Strict`, `Secure` (in production) cookie, `hsa_terminal`, for 400 days. A browser holds one key, so registering again switches off the terminal it replaces.
4. *Sign out and start the terminal* signs the administrator out of that browser only (`scope: "local"`) and opens `/terminal`.

`attendance_terminals` is readable by the hospital's administrators, **except `key_hash`** (column-level grant), and never writable by a client role. `attendance_terminals_overview` adds the location name, who registered it and when it was last used.

### Clocking in

`/terminal` is a public route. It works only when the cookie holds the key of an active terminal (`public.terminal_context(key)`, callable by `anon`).

```
browser ──(staff ID or email, password, action)──> clockAtTerminal (server action)
  1. read the key from the cookie
  2. staff ID → email: public.terminal_sign_in_email(key, staff_id)      [anon; needs an active key]
  3. isolated supabase-js client, persistSession: false: signInWithPassword(email, password)
  4. as that user: public.check_in(key) / public.check_out(key)
  5. signOut({ scope: "local" }) — revokes this session's refresh token
```

The isolated client never reads or writes cookies, so a staff member's session exists only for the duration of the request and never replaces whatever session the terminal's browser holds.

`check_in` / `check_out` keep every rule from Phase 5: identity from `auth.uid()`, time from the server clock, shift matching, late / half day / overtime / early leave, the one-open-session index, and a row in `attendance_events` for every attempt, accepted or rejected. What changed is only where the location comes from: `private.resolve_clock_request(key)` hashes the key and resolves the terminal, rejecting with `TERMINAL_NOT_REGISTERED`, `TERMINAL_REVOKED`, `WRONG_HOSPITAL` or `LOCATION_NOT_ACTIVE`.

### What a terminal proves

A clock-in needs **both** a valid account sign-in and a terminal key. A staff member at home has a session but no key; someone at the terminal has the key but can only clock in the person whose password they typed. The key is in an HTTP-only cookie, so page scripts cannot read it, but anyone with access to the browser's developer tools on the terminal could copy it. Terminals should therefore run a locked-down browser profile (see the README). If a key may have leaked, switch the terminal off and register it again.

Buddy punching (one person typing a colleague's password) is not prevented by any password-based system; the scan log records the terminal and time of every attempt for review.

### Operational note: sign-in rate limits

Every clock-in is a Supabase Auth password sign-in made **from the application server**, so they all count against one IP address. Raise *Authentication → Rate Limits → sign-ups and sign-ins* to cover the busiest shift change (for example 300 per 5 minutes).

## 3. Leave removal

`20260922090100_remove_leave.sql` replaces every function that touched leave (`review_attendance_correction`, `private.finalize_elapsed_shifts`, both report functions), then drops `leave_requests`, `leave_types`, `leave_requests_overview`, `attendance_records.leave_request_id`, the leave RPCs and `half_day_period`. `notification_type` is rebuilt with only the correction values, and leave notifications are deleted. The `on_leave` status and `leave_conflict` flag remain in their enums so older records still load; nothing sets them any more.

**These migrations delete data:** leave types, leave requests, leave notifications, QR codes, and the recorded phone positions on past scans.
