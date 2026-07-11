# Adding an event

`events.html`'s "Upcoming Events & Programs" grid (`#eventGallery`) auto-sorts
soonest-first and moves anything past its date into the "Previous Events"
section at the bottom — see the script near the end of `events.html`. This
only works if every dated card carries the right attribute:

- One-off or multi-day event: `data-event-date="2026-07-11"`, or
  `data-event-date="2026-07-10,2026-07-11"` for multi-day (comma-separated,
  no spaces). The card is archived once the **last** listed date passes.
- Ongoing/ranged event (e.g. a summer camp): `data-event-until="2026-07-23"`
  — the card stays in "Upcoming" until that end date passes.
- Recurring items with a specific next occurrence (e.g. "Next: Jul 18"
  workshops, "every 3rd Saturday" potlucks): use `data-event-date` with that
  next date, and **bump it manually each cycle** — there's no recurrence
  engine, just a single next-occurrence date.

Cards with none of these attributes are left alone and never archived — that's
intentional for the "Weekly Programs" section below the grid (Seerah, Youth
Hangouts, Fajr Breakfast), since those are perpetual, not one-off events.
Don't add date attributes there.

If the new event should also appear in the homepage's "Upcoming Events
Preview" (`index.html`, `.events-preview-scroll`), add a matching card there
too with the same `data-event-date` — that page only uses it to add a
`today-event` highlight glow, not sorting/archiving.

`data-event-day="N"` (0=Sun…6=Sat) is a separate convention used on
`index.html` for purely weekly recurring cards with no specific date.
