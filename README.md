# Salon Reservation Backend — Phase 1 (Stylist Onboarding)

Backend for an online salon reservation system (hair, nails, skin/face). **Phase 1**
covers only **authentication + stylist onboarding**. The data model is designed to be
extended with the customer booking flow in a later phase.

## Stack

- Node.js + Express + TypeScript
- MongoDB + Mongoose
- Zod for input validation (generic `validate(schema)` middleware)
- JWT (access + revocable refresh tokens), OTP-only login
- Multer for image uploads behind an abstract `StorageProvider`

## Project structure

```
src/
  config/        env (typed) + db connection
  models/        Mongoose schemas + TS interfaces
  modules/
    auth/        OTP request/verify, refresh, logout
    onboarding/  role selection, onboarding state, personal info
    stylist/     services, workplace, freelance, join salon, working hours
    salon/       search, create, invite, approve/reject stylists
    service/     category & service catalogue
    invite/      owner claims a salon via invite link
    media/       profile photo + portfolio upload
  middlewares/   auth, validate, errorHandler, upload
  utils/         jwt, otp, sms, geo, time, storage, AppError, response, ...
  seed/          default categories & services
  app.ts
  server.ts
```

## Setup

```bash
cp .env.example .env        # adjust values
npm install
npm run seed                # load default categories & services (idempotent)
npm run dev                 # start with hot reload
```

Scripts: `dev`, `build`, `start`, `seed`.

### Environment variables

`PORT, BASE_URL, MONGO_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ACCESS_TTL,
REFRESH_TTL, OTP_TTL, UPLOAD_DIR, NODE_ENV`

> In **development** the OTP code is fixed (`123456`) and echoed back in the
> `/auth/otp/request` response as `devCode`. Replace `ConsoleSmsProvider` with a
> real SMS gateway in production — it sits behind the `SmsProvider` interface.

## Response format

Every endpoint returns a uniform envelope:

```jsonc
{ "success": true,  "data": { /* ... */ } }
{ "success": false, "error": { "message": "...", "code": "...", "details": [] } }
```

## Endpoints

### Auth (public)
| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/auth/otp/request` | `{ phone }` | creates OTP (returns `devCode` in dev) |
| POST | `/auth/otp/verify`  | `{ phone, code }` | creates user if new, returns `{ user, tokens }` |
| POST | `/auth/refresh`     | `{ refreshToken }` | rotates & returns a new token pair |
| POST | `/auth/logout`      | `{ refreshToken }` | revokes the refresh token |

### Onboarding (auth required)
| Method | Path | Body |
| --- | --- | --- |
| POST  | `/onboarding/role`  | `{ roles: ['stylist', ...] }` (idempotent) |
| GET   | `/onboarding/state` | resumable onboarding state |
| PATCH | `/me/personal`      | `{ firstName, lastName, nationalCode, birthDate }` |

### Services (catalogue)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/services` | categories with their services |

### Stylist onboarding (auth + `stylist` role)
| Method | Path | Body |
| --- | --- | --- |
| POST | `/stylist/services`            | `{ items: [{ serviceId, price?, durationMin? }] }` |
| POST | `/stylist/workplace`           | `{ type: 'freelance' \| 'salon' }` |
| POST | `/stylist/workplace/freelance` | `{ address, lng, lat }` |
| POST | `/stylist/salons`              | `{ salonId }` (join existing, membership `pending`) |
| POST | `/stylist/working-hours`       | `{ entries: [{ salonId\|null, dayOfWeek, start, end }] }` |
| POST | `/stylist/media`               | multipart: `profilePhoto`, `portfolio[]` → completes onboarding |

### Salons
| Method | Path | Notes |
| --- | --- | --- |
| GET  | `/salons/search?name=&lng=&lat=&radius=` | geo (2dsphere) + name search |
| POST | `/salons`        | stylist creates a salon they own (active) |
| POST | `/salons/invite` | `{ salonDraft, targetPhone }` → pending salon + invite SMS |
| POST | `/salons/:salonId/stylists/:stylistId/approve` | owner approves membership |
| POST | `/salons/:salonId/stylists/:stylistId/reject`  | owner rejects membership |

### Invite (salon claim by real owner)
| Method | Path | Notes |
| --- | --- | --- |
| GET  | `/invite/:token`        | public — view draft + pending salon |
| POST | `/invite/:token/accept` | owner confirms/edits → salon `active` |

### Misc
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health`        | health check |
| GET | `/uploads/...`   | static uploaded files |

## Onboarding flow (stylist)

`role → personal → services → workplace → workingHours → media → completed`

`StylistProfile.onboardingStep` advances as each step completes and never
regresses, so a stylist can resume from where they left off via
`GET /onboarding/state`.

## Working-hours validation rules

- `HH:mm` format, `start < end`.
- A stylist may only set hours for salons they are linked to (`StylistSalon`).
- Salon-bound intervals must fit fully inside that salon's opening hours for the day.
- No two intervals on the same `dayOfWeek` may overlap (even across different salons).

## Indexes

- `User.phone` (unique)
- `Salon.location` (2dsphere)
- `StylistService(stylistId, serviceId)` (unique)
- `StylistSalon(stylistId, salonId)` (unique)
- `SalonInvite.token` (unique)

## Extensibility notes

- `StorageProvider` abstracts file storage — swap `LocalStorageProvider` for MinIO/S3
  without touching business logic.
- `SmsProvider` abstracts the SMS gateway.
- Junction collections (`StylistService`, `StylistSalon`, `WorkingHour`) keep the
  schema ready for the upcoming customer booking phase.
```

## Testing

Automated API integration tests run against an in-memory MongoDB (Jest + Supertest):

```bash
npm test               # full suite
npm run test:coverage  # with coverage
```

See [`tests/README.md`](tests/README.md) for the layout and what each file covers.
