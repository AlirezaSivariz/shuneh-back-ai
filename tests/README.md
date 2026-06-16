# Backend automated tests

API integration tests (Jest + Supertest) running against an **in-memory MongoDB**
(`mongodb-memory-server`). No real database, SMS gateway, or storage is touched —
the SMS provider and request logger are mocked in `tests/setup.ts`, and OTP uses
the fixed dev code (`123456`) since `NODE_ENV=test` keeps `isDev` true.

## Run

```bash
npm test              # run the whole suite (in-band)
npm run test:coverage # with a coverage report
npx jest tests/reservation.test.ts   # a single file
```

The first run downloads a small MongoDB binary (cached afterwards).

## Layout

- `tests/setup.ts` — starts/stops the in-memory Mongo, resets every collection
  between tests (each test is isolated & repeatable), mocks SMS + morgan.
- `tests/helpers.ts` — shared factories & utilities: `login`, `createCustomer`,
  `createStylist` (a fully active stylist + own salon + all-day hours),
  `createAdmin`, `futureDate`, `validNationalCode`, `markCompleted`, etc.
- Test files by area:
  - `auth.test.ts` — OTP, refresh rotation/reuse, logout revoke, roles &
    `authorize`, admin not self-assignable.
  - `onboarding.test.ts` — step progression, custom service (private + excluded
    from public catalogue), "only-custom" continue, ownership.
  - `workingHours.test.ts` — inside/outside opening hours, overlap, adjacency,
    unlinked salon, freelance, `SALON_HOURS_NOT_SET`.
  - `owner.test.ts` — invite token + masking, accept (phone match), owner role,
    approve/reject, `requireSalonOwner`.
  - `reservation.test.ts` — availability, multi-service booking, snapshot,
    self-booking, **double-booking (sequential + concurrent)**.
  - `reservationLifecycle.test.ts` — cancel (customer 2h rule / stylist / admin),
    reschedule (+ `excludeReservationId`), auto-complete, leave-salon effects.
  - `features.test.ts` — reviews, quick-rebook, discount codes, tips,
    accept-reservations toggle, verification/blue-tick, promotion & search order.
  - `admin.test.ts` — `requireAdmin` leak guard, global reads, audit log, user
    block (`ACCOUNT_DISABLED`), promote, stylist/customer reports values.

## Coverage

~78% statements / ~81% lines across the service layer (run `npm run test:coverage`).
Routes/seed/server bootstrap are excluded from coverage.
