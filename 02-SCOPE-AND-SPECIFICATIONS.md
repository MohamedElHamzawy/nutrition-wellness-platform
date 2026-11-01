# Scope & Technical Specifications
## Nutrition & Wellness Community Platform — Version 1

| | |
|---|---|
| **Document version** | 1.0 — 1 November 2026 |
| **Status** | For client review and sign-off |
| **Companion document** | [`01-PROPOSAL.md`](01-PROPOSAL.md) — commercial summary |
| **Binding status** | **This document is the contract scope.** Where this document and the proposal disagree, this document wins. |
| **Market** | Kuwait / GCC · Arabic-first with English · full RTL |
| **Platforms** | iOS and Android (member app) · iOS and Android (admin app) · admin web portal *(priced add-on)* |

---

## How to read this document

| You want… | Go to |
|---|---|
| What the product is and the rules that shape it | §1 Product definition |
| Who the users are and what they can do | §2 Users & access model |
| How communities, content targeting and visibility work | §3 Taxonomy |
| How money and access entitlements work | §4 Subscriptions |
| How points and tiers work | §5 Points & tiers engine |
| Feature-by-feature specifications | §6 Feature specifications (F1–F13) |
| How the system is built | §7 System architecture |
| Performance, security, compliance | §8–§10 |
| Exactly what you receive | §11 Deliverables |
| What gets built when | §12 Phased implementation plan |
| How we prove it works | §13 Testing & acceptance |
| What could go wrong and what we do about it | §14 Risk register |
| What we assume and need from you | §15 Assumptions & dependencies |
| What is explicitly not included | §16 Out of scope |
| What still needs answering | §17 Open questions |

Every significant design choice carries a **decision reference (`D-nn`)** so that later changes can be traced to a reason rather than re-argued.

---

## 1. Product definition

### 1.1 What the platform is

A subscription membership platform through which a single nutrition and healthcare practitioner (**the Doctor**) delivers structured video programmes, live broadcasts, moderated peer communities, group chat and paid one-to-one consultations to a segmented audience of paying members.

### 1.2 The three principles that shape every design decision

**P1 — Relevance through segmentation.** The audience is divided into communities by gender and life stage. Every piece of content is published to specific communities. A member sees only content targeted at a community they belong to. This is not a filter applied at display time; it is enforced server-side on every request, because the content is paid for.

**P2 — Earned participation.** Membership grants consumption, not contribution. Members accumulate points through engagement and unlock capabilities — commenting, posting, chat access, premium content — as they cross configurable tier thresholds. This protects community quality and creates a retention loop.

**P3 — The Doctor configures, never codes.** Communities, prices, point values, tier thresholds, tier unlocks, trial length, booking policies and moderation rules are all data, editable from the admin interface at runtime. No release is required to change a business rule. (`D-01`)

### 1.3 What V1 deliberately does not attempt

V1 is a content, community and consultation platform. It is **not** a clinical tool. It does not generate nutrition plans, track calories or macros, read wearables or lab results, store diagnoses, or make recommendations tailored to an individual's medical data. This boundary is a product decision *and* a regulatory one — see §10.3. (`D-02`)

---

## 2. Users & access model

### 2.1 Populations

| Population | Realm | Authenticates with | Reaches |
|---|---|---|---|
| **Member** | `member` | Phone number + SMS one-time code | Member app only |
| **Doctor / Owner** | `admin` | Phone number + SMS code, `super` capability | Admin app + web portal |
| **Admin staff** (moderator, content assistant, support) | `admin` | Phone + SMS code, scoped capabilities | Admin app + web portal |

**Two realms, never mixed** (`D-03`). The admin and member realms have separate JWT signing secrets, separate session tables, separate route prefixes and separate guards. A member token presented to an admin route is rejected before any business logic runs, and vice versa. This is the single most important security boundary in the system.

Route prefixes:
- `/v1/auth/member/*` · `/v1/auth/admin/*`
- `/v1/me/*` — member self-service
- `/v1/admin/*` — admin, capability-gated

### 2.2 Member identity & onboarding

**Sign-up flow:**
1. Enter phone number (E.164) → receive 6-digit SMS code → verify. Code TTL 5 minutes, 3 attempts, resend throttled, per-phone and per-IP rate limits. (`D-04`)
2. Accept **Terms of Service, Privacy Policy and Medical Disclaimer** — versioned, recorded in an append-only consent table with version, timestamp and IP. A new version re-prompts on next launch. (`D-05`)
3. Profile: display name, gender, date of birth, optional photo, language preference (ar/en).
4. **Select communities.** The member sees the communities available to their gender and picks one or more.
5. The **14-day free trial** begins. Full access to everything selected, no payment method required.

**Gender is set once at sign-up** and changes only via support, because it determines which communities are reachable at all. (`D-06`)

**Sessions:** rotating refresh tokens with reuse detection. Member access token 30 minutes, refresh rolling 1 year. Admin access token 15 minutes, refresh 30 days. Reuse of a rotated refresh token revokes the whole session family. (`D-07`)

**Member rights:** export their data, delete their account. Deletion is a soft delete plus PII scrub — personal fields are overwritten, the phone number is replaced with a sentinel so the number can be reused, sessions are revoked, and authored content is either removed or anonymised at the member's choice. Point ledger rows and subscription records are retained in anonymised form for financial integrity. (`D-08`)

### 2.3 Admin capabilities

Admin authorisation is a **capability catalog** of `module.action` slugs plus a `super` capability that implies all. Capabilities group into roles; roles are assigned to admin users. **Default-deny: an admin route without a declared capability requirement is refused**, so a forgotten annotation fails closed rather than open. (`D-09`)

Capability catalog (V1):

| Module | Capabilities |
|---|---|
| `community` | `read`, `create`, `update`, `archive`, `pricing` |
| `content` | `read`, `upload`, `publish`, `update`, `delete`, `target` |
| `live` | `read`, `broadcast`, `schedule`, `end` |
| `points` | `read`, `rules.update`, `tiers.update`, `adjust` |
| `moderation` | `queue.read`, `content.remove`, `member.warn`, `member.suspend`, `member.ban` |
| `chat` | `read`, `moderate` |
| `member` | `read`, `update`, `subscription.read` |
| `booking` | `availability.manage`, `read`, `cancel`, `refund`, `notes` |
| `analytics` | `read`, `revenue.read` |
| `admin` | `user.read`, `user.create`, `role.manage` |
| — | `super` |

`live.broadcast` is held **only by the Doctor** and cannot be granted to staff roles — enforced in code, not only by configuration. (`D-10`)

### 2.4 The member access model — the central architectural problem

The brief asks for authorisation beyond roles and capabilities: access must also depend on **what the member has paid for** and **what their points have earned them**. These are three independent questions, and conflating them is how this kind of system becomes unmaintainable.

We resolve it as **three composed layers**, each answering exactly one question:

| Layer | Question | Source of truth |
|---|---|---|
| **L1 — Realm** | Is this caller a member at all? | JWT realm claim + guard |
| **L2 — Entitlement** | Has this member paid for (or is trialing) the community that owns this resource? | `subscriptions` + `member_trials` |
| **L3 — Tier capability** | Does this member's current tier permit this action? | `member_points.tierId` → `tier_capabilities` |

**An action is permitted only if all three pass.** Reading a post requires L1 + L2 (entitled to that community) + L3 (`content.read`). Creating a post requires L1 + L2 + L3 (`community.post.create`). Watching a premium video requires L1 + L2 + L3 (`content.premium.view`).

**Implementation.** One `AccessGuard`, driven by declarative decorators on each route:

```ts
@Realm('member')
@RequiresEntitlement({ community: 'param:communityId' })
@RequiresCapability('community.post.create')
@Post('/v1/me/communities/:communityId/posts')
```

For resources whose community is not in the URL (a video targeted at several communities), the guard resolves the resource's target communities and requires a non-empty intersection with the member's entitled set.

**The `AccessContext`.** Built once per request and attached to the request object: `{ memberId, entitledCommunityIds[], pointsBalance, tierId, tierRank, capabilities[] }`. Business code reads it and never re-queries entitlements. (`D-11`)

**Caching and invalidation** — this is where designs of this kind usually break. The context is cached in Redis under `access:v{configVersion}:{memberId}` with a 300-second TTL, and invalidated explicitly on:
- a points change that crosses a tier boundary,
- any subscription state transition,
- account suspension or ban.

When the Doctor edits tier thresholds or tier unlocks, a **global `configVersion` counter is incremented**, which invalidates every member's cached context at once without enumerating members. This is what makes "editable at any time" safe rather than eventually-consistent-and-confusing. (`D-12`)

**Why not a policy engine (OPA, Casbin, CASL)?** At this scale the rules are few, stable in shape and performance-critical on every request. A declarative guard over indexed tables is faster, far easier to debug, and needs no second runtime. Should the rule set grow combinatorially in a later version, L3 is the only layer that would change. (`D-13`)

---

## 3. Taxonomy: communities & content targeting

### 3.1 Community structure

**14 communities**: 7 life stages × 2 genders. (`D-14`)

The taxonomy is **data, not schema** — the Doctor can add, rename, re-price, reorder or archive a community from the admin interface without a release. Archiving hides a community from new sign-ups while existing members keep access until their period ends. (`D-15`)

`communities`: `id`, `slug`, `nameAr`, `nameEn`, `descriptionAr`, `descriptionEn`, `gender`, `lifeStageKey`, `sortOrder`, `coverImageId`, `appleProductId`, `googleProductId`, `isActive`, `archivedAt`.

**Hard rule:** a member's gender determines which communities they may ever join or see. A male member cannot subscribe to, view, post in or be targeted by a female community under any circumstances. Enforced in the entitlement layer, not the UI. (`D-16`)

> *Awaiting the definitive seven life-stage keys per gender from the client — see §17.1. The examples given were single, student, married, father, sportsman.*

### 3.2 Content targeting and visibility

| Content type | Targeting | Visibility rule |
|---|---|---|
| **Playlist / programme** | Many communities | Visible if `target ∩ entitled ≠ ∅` |
| **Video** | Inherits its playlist's targeting | As playlist, plus `content.premium.view` if flagged premium |
| **Live session** | Many communities | Visible if `target ∩ entitled ≠ ∅` |
| **Post** | Exactly one community | Visible if that community ∈ entitled, and tier grants `content.read` |
| **Chat room** | Exactly one community | Joinable if community ∈ entitled, and tier grants `chat.read` |

A member entitled to three communities sees one merged "Programmes" library (deduplicated where a playlist targets more than one of their communities) but **separate feeds and separate chat rooms** per community, because a feed is a place and a library is a catalogue. (`D-17`)

---

## 4. Subscriptions, trial & entitlements

### 4.1 Commercial model

- **One subscription per community.** A member in three communities holds three active subscriptions. (`D-18`)
- **Monthly billing** through Apple In-App Purchase and Google Play Billing. Mandatory: the content is one-to-many digital content, which both stores require to be sold through their billing systems.
- Price per community is set by the Doctor and mirrored as store products.

### 4.2 Store configuration — a material constraint

Apple permits a single Apple ID to hold concurrent subscriptions **only when each is in a different subscription group**. Therefore the platform requires **14 subscription products across 14 subscription groups**, one per community. (`D-19`)

Two consequences the client must know:
1. **Each product is reviewed by Apple separately.** This is a real calendar cost at launch and whenever a community is added.
2. Apple has been known to query products with identical duration and price. Each product therefore gets a distinct name and description matched to its community. Should Apple reject the 14-group approach, the **documented fallback** is bundle tiers (1 community / 3 communities / all-access) — fewer products, same member-visible behaviour, implemented behind the same entitlement interface so only the billing module changes. (`D-20`, see risk R2)

Google Play supports concurrent subscriptions natively; 14 products, no grouping constraint.

### 4.3 Free trial

**14 days, full access, no payment method required, once per member** (not once per community — otherwise a member trials all 14 sequentially for seven months). (`D-21`)

The trial is **server-owned**, deliberately not implemented as a store introductory offer, for three reasons: it requires no payment card (maximising sign-up conversion), the Doctor can change its length from the admin panel, and it works identically on both platforms. `member_trials`: `memberId`, `startedAt`, `endsAt`, `communityIds[]`, `consumedAt`. (`D-22`)

During the trial the member has full entitlement to their selected communities. At expiry, entitlement drops and the app shows a paywall; authored content and point balance are retained, so returning members resume rather than restart.

### 4.4 Subscription lifecycle

`subscriptions`: `id`, `memberId`, `communityId`, `platform`, `storeTransactionId`, `originalTransactionId`, `state`, `currentPeriodEnd`, `autoRenew`, `cancelledAt`, `rawPayload`.

State machine: `TRIALING → ACTIVE → GRACE → EXPIRED`, with `CANCELLED` (auto-renew off, access to period end) and `REVOKED` (refund or chargeback, access ends immediately).

**Entitlement is derived, never stored as a flag**: active if `state ∈ {TRIALING, ACTIVE, GRACE}` and `currentPeriodEnd > now`. A derived entitlement cannot drift out of sync with billing reality. (`D-23`)

**Joining and leaving** (`D-24`): a member may join a new community at any time — purchase completes, entitlement is immediate. Leaving turns off auto-renew; **access continues until the end of the paid period**, matching how store subscriptions actually behave and avoiding pro-rata refund logic entirely.

**Server-to-server notifications.** Apple App Store Server Notifications V2 and Google Real-Time Developer Notifications drive all state changes, verified against the App Store Server API and Play Developer API respectively. Because webhooks are lost in practice, a **nightly reconciliation job** re-polls any subscription not updated in 48 hours. (`D-25`)

---

## 5. Points & tiers engine

### 5.1 Model

**One global balance per member**, not per community. A member's standing is a single number and their tier applies everywhere. (`D-26`)

**Every award is an immutable ledger row; the balance is derived and materialised.** (`D-27`)

- `point_events` — **append-only**: `id`, `memberId`, `ruleKey`, `amount`, `sourceType`, `sourceId`, `dedupeKey`, `note`, `actorAdminId?`, `createdAt`. Unique index on `(memberId, dedupeKey)`.
- `member_points` — materialised: `memberId`, `balance`, `lifetimeEarned`, `tierId`, `tierEnteredAt`, `updatedAt`. Written in the **same transaction** as the ledger row.

Append-only is not ceremony. It makes every balance explainable ("why am I tier 2?"), makes abuse reversible without arithmetic guesswork, and makes a corrupted balance recomputable from history.

### 5.2 Earning rules — admin-editable

`point_rules`: `key`, `labelAr`, `labelEn`, `amount`, `dailyCap`, `oncePerSource`, `isEnabled`.

Proposed opening values — **the Doctor sets the final numbers** (§17.4):

| Rule key | Event | Points | Daily cap | Once per source |
|---|---|---|---|---|
| `member.onboarded` | Completes sign-up | 50 | — | yes |
| `app.opened` | First open of the day | 2 | 1× | — |
| `video.completed` | Watches ≥ 90% of a video | 10 | — | yes |
| `playlist.completed` | Finishes every video in a programme | 50 | — | yes |
| `live.attended` | Watches ≥ 5 min of a live session | 15 | — | yes |
| `reaction.given` | Likes a post or video | 1 | 10 | yes |
| `comment.created` | Comments | 3 | 15 | — |
| `post.created` | Creates a post | 10 | 3 | — |
| `post.reaction.received` | Own post is liked | 1 | 20 | yes |
| `consultation.completed` | Attends a booked consultation | 25 | — | yes |
| `admin.adjustment` | Manual grant or deduction | any | — | — |

**Anti-abuse** (`D-28`): daily caps per rule; `oncePerSource` dedupe via `dedupeKey`; **reversal** — if content is deleted by its author or removed by a moderator, the points it earned are reversed by a compensating negative ledger row, never by editing history; all award paths idempotent.

### 5.3 Tiers — admin-editable

`tiers`: `id`, `nameAr`, `nameEn`, `minPoints`, `maxPoints`, `rank`, `badgeImageId`.
`tier_capabilities`: `tierId`, `capabilityKey`.

Validation on save: ranges must be **contiguous and non-overlapping**, the lowest tier must start at 0, and the highest must be open-ended. A member's tier is derived from their balance; crossing a boundary triggers a push notification and a celebratory in-app moment, because the unlock is the product.

**Gateable member capabilities (V1):**

| Capability | Gates |
|---|---|
| `content.read` | Seeing the community feed at all |
| `content.react` | Likes and dislikes |
| `content.comment` | Commenting and replying |
| `content.share` | Sharing outside the app |
| `community.post.create` | Creating posts |
| `community.post.media` | Attaching images or video to a post |
| `chat.read` | Entering the community group chat |
| `chat.write` | Sending messages in group chat |
| `content.premium.view` | Playlists or videos flagged premium |

Proposed opening configuration — **the Doctor sets the final mapping** (§17.4):

| Tier | Points | Unlocks (cumulative) |
|---|---|---|
| **1 — Newcomer** | 0–99 | `content.read`, `content.react` |
| **2 — Engaged** | 100–299 | + `content.comment`, `content.share` |
| **3 — Contributor** | 300–699 | + `community.post.create`, `chat.read` |
| **4 — Trusted** | 700–1,499 | + `community.post.media`, `chat.write` |
| **5 — Ambassador** | 1,500+ | + `content.premium.view` |

**Demotion:** V1 has no point decay. A tier once earned is kept unless points are reversed through moderation. Decay was considered and rejected for V1 — it generates support load and resentment disproportionate to its retention benefit, and it is additive to add later. (`D-29`)

---

## 6. Feature specifications

Each specification states its **purpose**, **rules (`R-n`)**, **deliverables** and **acceptance criteria (`AC-n`)**.

---

### F1 — Foundation, identity & authentication · *Phase 1*

**Purpose.** The platform's skeleton: repository, environments, API scaffold, design system, authentication, authorisation, localisation and observability.

**Rules**
- `R-1` Monorepo: `apps/api` (NestJS), `apps/member` (Flutter), `apps/admin` (Flutter), `apps/portal` (web, Phase 3), `packages/*` shared Flutter and TypeScript.
- `R-2` Every 2xx response with a body uses the envelope `{ success: true, message, data }`; `message` is localised from `Accept-Language` (ar/en). 204 has no body.
- `R-3` Errors return `{ success: false, code, message, details? }` where `code` is a stable `UPPER_SNAKE` string. Clients branch on `code` and display `message`.
- `R-4` Pagination: admin tables use offset (`page`, `pageSize` ≤ 100); member feeds use cursor (`cursor`, `limit` ≤ 50).
- `R-5` Wire types: IDs are UUIDv7; money is a decimal string with an ISO currency code, never a float; instants are ISO-8601 UTC; dates `YYYY-MM-DD`; phones E.164.
- `R-6` Two realms per §2.1, separate secrets and guards. Default-deny route authorisation.
- `R-7` Full Arabic and English with RTL mirroring across every screen. All strings are i18n keys; no literal text in widgets.
- `R-8` Display timezone `Asia/Kuwait`; all instants stored and transmitted in UTC.
- `R-9` Clients tolerate unknown fields and map unknown enum values to a safe default — this is what makes additive API changes safe after a store release.
- `R-10` Vendor SDKs sit behind interfaces (`MediaProvider`, `PushProvider`, `SmsProvider`, `PaymentProvider`, `CallProvider`). Domain code never imports a vendor SDK.

**Deliverables.** Monorepo with CI (lint, type-check, test, build) · NestJS API with envelope, error filter, i18n, Swagger at `/docs` · PostgreSQL schema with migrations · Redis · BullMQ worker · Sentry (no PII) · Flutter design system package: colour and type tokens, spacing scale, components, RTL support, light and dark · phone+OTP auth for both realms · capability catalog, roles, seed admin · `AccessGuard` with all three layers · member onboarding and consent · Docker Compose for local development.

**Acceptance**
- `AC-1` A member token on any `/v1/admin/*` route returns 401 before business logic executes.
- `AC-2` A route with no declared capability requirement is refused for every admin including `super`, proving default-deny.
- `AC-3` Every screen renders correctly in Arabic RTL and English LTR; no clipped or mirrored-wrongly layouts on a 4.7″ device.
- `AC-4` OTP brute force is blocked: 3 wrong codes locks the attempt, rate limits return 429.
- `AC-5` Refresh-token reuse revokes the session family and forces re-authentication.

---

### F2 — Taxonomy & communities · *Phase 1*

**Purpose.** The 14 communities and the targeting model everything else depends on.

**Rules**
- `R-1` Communities are runtime data: create, update, reorder, re-price, archive from admin. (`D-15`)
- `R-2` A community has a gender. A member sees and joins only communities matching their gender. (`D-16`)
- `R-3` Archiving removes a community from new sign-ups; existing members retain access to period end.
- `R-4` A community cannot be hard-deleted once it has ever had a subscription — archive only. Financial history must remain intelligible.
- `R-5` Each community maps to one Apple product and one Google product ID.

**Deliverables.** `communities` table and module · admin CRUD, ordering, cover image, bilingual copy, price and store product mapping · member-facing community catalogue filtered by gender · community selection in onboarding and a "join another community" flow · the targeting join tables used by F5, F6, F7, F8.

**Acceptance**
- `AC-1` A male member's community catalogue never contains a female community, including via a direct API call with a known ID (404, not 403 — existence is not confirmed).
- `AC-2` Adding a 15th community requires no code change and no release.
- `AC-3` Archiving a community removes it from onboarding immediately while a subscribed member retains access until `currentPeriodEnd`.

---

### F3 — Subscriptions, trial & entitlements · *Phase 1*

**Purpose.** Everything in §4.

**Rules.** §4.1–§4.4 in full, plus:
- `R-1` Purchases are verified **server-side**. A client-reported purchase is never trusted.
- `R-2` Entitlement is derived from subscription state, never cached as a boolean on the member row. (`D-23`)
- `R-3` Restore purchases must reattach entitlements on a new device.
- `R-4` A refund or chargeback (`REVOKED`) ends access immediately and reverses any consultation discount granted by tier.
- `R-5` Trial is once per member and server-owned. (`D-21`, `D-22`)
- `R-6` All webhook handlers are idempotent by store transaction ID and safe to replay.

**Deliverables.** `subscriptions`, `member_trials` tables and state machine · Apple App Store Server Notifications V2 webhook + App Store Server API verification · Google RTDN webhook + Play Developer API verification · StoreKit 2 and Play Billing integration in the member app · paywall and purchase flows, restore purchases, upgrade and manage-subscription deep links · nightly reconciliation job · trial expiry sweep · admin subscription views and revenue reporting feed · **store product configuration for all 14 products in both stores, including 14 Apple subscription groups**.

**Acceptance**
- `AC-1` A sandbox purchase on iOS grants entitlement within 5 seconds and survives app reinstall via restore.
- `AC-2` One sandbox Apple ID holds three concurrent community subscriptions simultaneously.
- `AC-3` A cancelled subscription keeps access until `currentPeriodEnd` and loses it the minute after.
- `AC-4` A refunded transaction revokes access immediately.
- `AC-5` Replaying a stored webhook payload twice produces no duplicate state change.
- `AC-6` A member whose trial expires overnight sees the paywall on next launch with content and points intact.

---

### F4 — Points & tiers engine · *Phase 1*

**Purpose.** Everything in §5.

**Rules.** §5.1–§5.3 in full, plus:
- `R-1` A points award and the balance update occur in one transaction. A crash leaves no divergence.
- `R-2` `member_points.balance` must always equal the sum of that member's ledger rows. A nightly integrity check reports any drift.
- `R-3` Awards are enqueued **after** the originating transaction commits, never inside it.
- `R-4` Editing tier configuration increments the global `configVersion` and invalidates all cached access contexts. (`D-12`)
- `R-5` Tier range validation (contiguous, non-overlapping, zero-based, open-ended top) is enforced on save and rejected with a clear error.
- `R-6` A capability removed from a member's tier takes effect on their next request, not on next login.

**Deliverables.** `point_events`, `member_points`, `point_rules`, `tiers`, `tier_capabilities` · points service with idempotent award, cap enforcement and reversal · tier resolution and transition detection with push notification on promotion · admin screens for rules, tiers, tier-capability mapping and manual adjustment with mandatory reason · member screens: current tier, balance, progress to next tier, "how to earn points", and a locked-feature explanation that names the tier required · nightly integrity check · daily cap reset job (Kuwait midnight).

**Acceptance**
- `AC-1` Awarding the same `dedupeKey` twice creates one ledger row and one balance change.
- `AC-2` A member at the daily cap for `reaction.given` earns nothing further that day and the cap resets at Kuwait midnight.
- `AC-3` Deleting a post reverses its `post.created` points via a negative row; the original row is unchanged.
- `AC-4` Crossing a tier boundary unlocks the capability on the **very next** request, with no logout required.
- `AC-5` Changing a tier threshold in admin changes what every affected member can do within one request cycle.
- `AC-6` An attempt to save overlapping tier ranges is rejected with a specific error code.

---

### F5 — Video programmes & playlists · *Phase 1*

**Purpose.** The content library: structured programmes of videos, targeted at communities, protected from extraction, with progress tracking that feeds points and analytics.

**Rules**
- `R-1` Hierarchy: **Playlist (programme) → ordered Videos**. A video belongs to exactly one playlist. Targeting is set on the playlist.
- `R-2` Upload is **direct to the media provider** via a one-time signed upload URL. The video never transits our API, so large files on weak connections do not depend on our server. (`D-30`)
- `R-3` Every asset is created with `requireSignedURLs: true`. Playback requires a token minted per request **after** the entitlement and tier check. Token TTL 2 hours. (`D-31`)
- `R-4` Encoding completion arrives by webhook, with a polling job as backup. A video is not publishable until `ready`.
- `R-5` Progress is reported by the client every 15 seconds and on pause/exit, stored as furthest position reached. ≥ 90% marks the video complete; all videos complete marks the playlist complete.
- `R-6` A playlist or video may be flagged **premium**, requiring `content.premium.view`.
- `R-7` Playlists can be draft or published, reordered, and unpublished (which hides them without deleting member progress).
- `R-8` Member actions on a video: like, dislike, comment, share — each gated by the corresponding tier capability. Comments are one level of reply deep.

**Deliverables.** `playlists`, `videos`, `playlist_communities`, `video_progress`, `video_reactions`, `video_comments` · media provider abstraction over Cloudflare Stream · direct-upload URL endpoint, webhook handler, polling backup · signed playback endpoint with entitlement check · admin: upload from phone and portal, metadata, thumbnail selection, ordering by drag, targeting, premium flag, publish/unpublish, per-video stats · member: library grouped by programme, programme detail with progress ring, player with resume, speed, quality and subtitles where provided, background audio, likes, comments, share · progress → points integration.

**Acceptance**
- `AC-1` A playback request from a member not entitled to any of the playlist's target communities returns 404 and no token is minted.
- `AC-2` A playback URL captured from one member's session does not play after its token expires, and never plays for a non-entitled member.
- `AC-3` A 500 MB upload from a phone on 4G completes and resumes correctly after a deliberate network drop.
- `AC-4` Watching to 90% awards `video.completed` exactly once, including if the member rewatches.
- `AC-5` Completing the final video of a programme awards `playlist.completed` once.
- `AC-6` A premium playlist is invisible in the library to a member below the required tier and returns 404 by direct ID.

---

### F6 — Live broadcasting · *Phase 1*

**Purpose.** The Doctor broadcasts live from the admin app to selected communities, with reactions, a viewer count, scheduling, and automatic publication of the recording.

**Rules**
- `R-1` `live.broadcast` is the Doctor's alone and cannot be delegated. (`D-10`)
- `R-2` A session targets one or more communities. Non-targeted members receive no notification and cannot discover or join the session by any route.
- `R-3` Ingest is **RTMPS from the admin app**. This is a deliberate choice: the media provider cannot record sub-second WebRTC broadcasts, and automatic replay publishing is a required feature. (`D-32`)
- `R-4` A **desktop stream key** is also issued for every session, so a planned broadcast can originate from professional software. This is the designed fallback for the broadcast risk in R1 of the risk register, not an afterthought. (`D-33`)
- `R-5` Session state machine: `SCHEDULED → LIVE → ENDED → PUBLISHED`, driven by provider webhooks (`connected` / `disconnected`), not by the app reporting success.
- `R-6` A scheduled session notifies targeted members at a configurable lead time and again at start.
- `R-7` Reactions are ephemeral and not persisted individually. Viewer count is maintained in Redis via heartbeat with TTL and **broadcast as an aggregate every 3 seconds** — never one message per join or per reaction, which is how live features cause outages. (`D-34`)
- `R-8` On `ENDED`, the recording becomes a VOD asset and is attached as a **draft** video to a playlist chosen before going live. The Doctor publishes it with one tap. Drafts, not auto-publish, because not every live session should become permanent.
- `R-9` An unexpected disconnect holds the session in a reconnect window (90 seconds) before ending it, so a lift or a tunnel does not end a broadcast.

**Deliverables.** `live_sessions`, `live_session_communities` · live input provisioning, webhook handling, state machine · RTMPS broadcast in the admin app: camera and microphone selection, front/rear, bitrate adaptation, network quality indicator, reconnect, elapsed timer, live viewer count, incoming reactions · desktop stream key display with copy · scheduling with lead-time notification · member: "Live now" banner, upcoming schedule with countdown, player with reactions and viewer count, "you missed it" replay link · automatic replay draft creation · `live.attended` points integration.

**Acceptance**
- `AC-1` A member not entitled to a target community sees no banner, no notification, and receives 404 on the session by ID.
- `AC-2` Broadcasting from a mid-range Android phone and an iPhone over 4G sustains 15 minutes without the app being killed; both are verified on physical devices.
- `AC-3` Killing the network for 30 seconds mid-broadcast reconnects and the viewer's stream resumes without a new session.
- `AC-4` 100 simulated concurrent viewers receive viewer-count updates without the API exceeding its latency budget.
- `AC-5` Ending a session produces a draft video in the chosen playlist within 5 minutes, playable with signed URLs.
- `AC-6` A scheduled session delivers its reminder push only to targeted, entitled members.

---

### F7 — Community social feed · *Phase 2*

**Purpose.** A moderated peer feed per community.

**Rules**
- `R-1` A post belongs to exactly one community. Cross-posting is not supported in V1.
- `R-2` Creating a post requires `community.post.create`; attaching media requires `community.post.media`; commenting requires `content.comment`; reacting `content.react`; sharing `content.share`.
- `R-3` Post body ≤ 3,000 characters; up to 4 images or 1 video per post; video ≤ 2 minutes, processed through the same media pipeline with signed playback.
- `R-4` Feed is cursor-paginated, newest first, fan-out on read. At V1 scale a correctly indexed query is strictly better than a materialised timeline. (`D-35`)
- `R-5` Comments are one level of reply deep. Unbounded nesting is a moderation and UI liability with no demonstrated benefit here.
- `R-6` Authors may edit within 15 minutes and delete at any time. Deletion is soft, reverses earned points, and leaves a tombstone so reply threads stay coherent.
- `R-7` The Doctor may pin one post per community.
- `R-8` Every post, comment and author carries report and block affordances (F9).

**Deliverables.** `posts`, `post_media`, `post_reactions`, `comments`, `comment_reactions`, `post_reports` · feed, composer with media picker and upload progress, post detail, comment thread, reactions, share sheet · pin, edit, delete · blocked-member filtering applied server-side · points integration for post, comment, reaction given and received · empty and locked states that name the tier required to participate.

**Acceptance**
- `AC-1` A member at a tier without `community.post.create` sees the composer in a locked state naming the tier required, and a direct API POST returns 403 with a specific code.
- `AC-2` Feed first page returns in under 400 ms p95 with 50,000 posts in the table.
- `AC-3` A blocked member's posts and comments are absent from the blocker's feed, enforced server-side.
- `AC-4` Deleting a post removes it from every feed, reverses its points, and leaves existing replies readable.
- `AC-5` A member entitled to three communities sees three separate feeds with no content leakage between them.

---

### F8 — Community group chat · *Phase 2*

**Purpose.** One live group chat per community, entry gated by tier — the platform's primary retention mechanism.

**Rules**
- `R-1` One room per community, created with the community. Entry requires entitlement **and** `chat.read`; sending requires `chat.write`.
- `R-2` Transport is a WebSocket gateway inside the API with a Redis adapter for horizontal scale. **PostgreSQL is the source of truth; sockets are transport only.** On reconnect the client fetches history rather than replaying socket events. (`D-36`)
- `R-3` Message kinds: text (≤ 2,000 chars), image, voice note (≤ 2 minutes), reply-to. No editing; deletion by author or moderator leaves a tombstone.
- `R-4` History is cursor-paginated backwards. Clients keep a local cache and fetch only the delta.
- `R-5` Rate limits: 5 messages per 10 seconds per member, 20 media uploads per hour. Exceeding returns a throttle event, not a disconnect.
- `R-6` Unread state per member per room (`lastReadMessageId`), with mute until a timestamp.
- `R-7` Push notification on mention or on the Doctor posting; otherwise batched to at most one "activity in your community" push per room per hour, because a chat room that pushes every message gets muted or uninstalled. (`D-37`)
- `R-8` Moderators can delete any message, mute a member in a room for a duration, or remove them from the room. Every action is audited.
- `R-9` Presence is **not** implemented in V1 beyond typing indicators scoped to the active room — per-member online status in a 2,000-member room is an expensive feature nobody asked for.

**Deliverables.** `chat_rooms`, `chat_messages`, `chat_memberships`, `chat_mutes` · Socket.IO gateway with JWT handshake auth, room authorisation from `AccessContext`, Redis adapter · message send, media upload, reply, delete, history pagination, unread counts, typing indicator, mute · reconnection with gap-fill · member chat UI with locked state naming the required tier · moderator controls in the admin app · rate limiting and abuse protection.

**Acceptance**
- `AC-1` A member below the chat tier cannot join the socket room: the handshake is accepted but the join is refused with a specific code, and no message is ever delivered to them.
- `AC-2` A member losing their subscription is removed from the room within one access-cache cycle and receives no further messages.
- `AC-3` 500 concurrent sockets across rooms exchange messages with p95 delivery under 500 ms on the launch infrastructure.
- `AC-4` Killing the network for 60 seconds and returning restores the conversation with no duplicated and no missing messages.
- `AC-5` Sending 20 messages in 10 seconds throttles after 5 without disconnecting the socket.
- `AC-6` A moderator deleting a message removes it for every connected client within 2 seconds.

---

### F9 — Moderation & safety · *Phase 2*

**Purpose.** Keep the community safe, and satisfy Apple Guideline 1.2 and Google's UGC policy — **without which the app is not approved**. (`D-38`)

**Rules**
- `R-1` Every post, comment, chat message and member profile is reportable, with a reason from a fixed list plus optional free text.
- `R-2` Any member can block any other member. Blocking is bidirectional in effect — neither sees the other's content — and is enforced server-side in every query.
- `R-3` Reports land in an admin queue with the reported content, its context, the reporter, and the reported member's history.
- `R-4` Moderator actions: dismiss · remove content · warn member · suspend member (duration) · ban member. Every action is written to an append-only audit log with actor, reason and timestamp.
- `R-5` **A documented 24-hour response commitment** on reports, with an SLA alert job that flags any report older than 20 hours. Apple asks specifically how reports are acted upon; a queue nobody works is a rejection.
- `R-6` A suspended member can read but not write; a banned member cannot authenticate and their content is hidden.
- `R-7` Removing content reverses its points.
- `R-8` Terms of Service prohibiting objectionable content, with in-app contact details for abuse reports, are required at submission.
- `R-9` Three accepted reports against one member within 30 days auto-escalates to the top of the queue.

**Deliverables.** `reports`, `blocks`, `moderation_actions`, `member_sanctions` · report flows on every surface · block and unblock with a managed block list · admin moderation queue with filters, bulk actions and member history · sanction application and expiry job · SLA alert job · audit log and viewer · Terms, Privacy Policy and Medical Disclaimer screens with versioned consent · App Review submission notes documenting the whole mechanism.

**Acceptance**
- `AC-1` A reported post appears in the admin queue within 5 seconds with full context.
- `AC-2` Blocking a member removes their content from feeds, comment threads and chat for the blocker, verified server-side not just in UI.
- `AC-3` A banned member cannot obtain a token and their content is invisible platform-wide.
- `AC-4` A suspension expires automatically and write access returns without manual intervention.
- `AC-5` Every moderator action is retrievable from the audit log with actor, target, reason and timestamp.

---

### F10 — Paid 1-to-1 consultations · *Phase 3*

**Purpose.** Monetise the Doctor's time: published availability, booking, payment through a Kuwaiti gateway, and a video call inside the app.

**Rules**
- `R-1` The Doctor publishes recurring weekly availability plus dated exceptions. Slots are generated from availability minus existing bookings. (`D-39`)
- `R-2` Consultation types define duration and price (e.g. 30 and 60 minutes). Multiple types may be active.
- `R-3` Booking: the member selects a slot → the slot is **held for 10 minutes** via a Redis lock → payment → confirmation. A unique constraint on the confirmed start time is the final guard against double-booking; the lock is an optimisation, not the guarantee. (`D-40`)
- `R-4` Payment uses a **Kuwaiti payment gateway**, not store billing. Apple Guideline 3.1.3(d) permits payment methods other than in-app purchase for real-time one-to-one professional services, which this is. One-to-many content remains on store billing (F3). (`D-41`)
- `R-5` Booking state machine: `HELD → PENDING_PAYMENT → CONFIRMED → IN_PROGRESS → COMPLETED`, with `CANCELLED_BY_MEMBER`, `CANCELLED_BY_DOCTOR`, `NO_SHOW`, `REFUNDED`, `EXPIRED`.
- `R-6` Policy is configurable: cancellation cut-off hours, refund percentage inside and outside the cut-off, one reschedule permitted, and minutes after start before a no-show is marked. A Doctor cancellation always refunds in full.
- `R-7` Refunds are issued through the gateway API and recorded against the booking. Gateway webhooks are idempotent and authenticated by signature.
- `R-8` The call runs on a WebRTC provider, one room per booking. **Tokens are minted only inside the join window** (start − 10 min to end + 15 min) and only for the two participants. (`D-42`)
- `R-9` **Calls are not recorded in V1.** Recording a medical consultation raises consent and retention obligations the client has not asked for and should not acquire by accident. (`D-43`)
- `R-10` Reminders at 24 hours and 1 hour before. A pre-call check verifies camera, microphone and connection before joining.
- `R-11` Consultation notes are written by the Doctor, stored against the booking, and **never visible to the member**.

**Deliverables.** `availability_rules`, `availability_exceptions`, `consultation_types`, `bookings`, `booking_payments`, `consultation_notes`, `booking_policy` · slot generation engine (pure, unit-tested) · payment provider abstraction with Kuwaiti gateway implementation, hosted checkout, webhook, refund API · call provider abstraction with windowed token minting · member: consultation catalogue, slot picker in Kuwait time, checkout, my bookings, reschedule, cancel with policy shown before confirming, pre-call check, in-call UI with mute, camera switch and end · admin: availability editor, calendar, booking list, cancel with refund, no-show marking, notes, consultation revenue report · reminder and no-show jobs.

**Acceptance**
- `AC-1` Two members attempting the same slot simultaneously produce exactly one confirmed booking; the other is told the slot is gone before payment.
- `AC-2` An abandoned checkout releases the slot after 10 minutes and the booking expires.
- `AC-3` A cancellation inside the cut-off refunds per policy automatically and the gateway confirms it.
- `AC-4` A call token requested 2 hours before the slot is refused; requested 5 minutes before, it works.
- `AC-5` A third party with a valid member token cannot obtain a token for someone else's booking room.
- `AC-6` A member who does not join within the no-show window is marked `NO_SHOW` by the job and the policy's refund rule is applied.
- `AC-7` An end-to-end call between a physical iPhone and a physical Android device sustains 10 minutes with audio and video.

---

### F11 — Notifications · *Phase 1 (extended in 2 and 3)*

**Purpose.** Reach the right members without training them to mute the app.

**Rules**
- `R-1` Firebase Cloud Messaging behind a `PushProvider` interface. Payloads carry `{ type, route, ids }` for deterministic deep-linking.
- `R-2` Every notification is filtered by **entitlement and tier at send time**, not at compose time. A member who lapsed yesterday does not receive today's community push. (`D-44`)
- `R-3` Member-controlled categories: live sessions, new content, community activity, chat, bookings, points and tiers. Each independently toggleable.
- `R-4` Fan-out runs through a batched BullMQ job with deduplication keys; invalid tokens are pruned on failure.
- `R-5` Delivery failure never fails the business request that triggered it.
- `R-6` Quiet hours (Kuwait time) are respected for non-urgent categories.

**Deliverables.** `devices`, `notifications`, `notification_preferences` · FCM integration both platforms, permission flows · fan-out job with targeting by community and tier · deep-link routing in both apps · preference screen · in-app notification centre · admin broadcast composer with audience preview showing the recipient count before sending.

**Acceptance**
- `AC-1` A push targeted at one community is received only by entitled members of that community; a lapsed member receives nothing.
- `AC-2` Tapping any notification opens the exact target screen from a cold start.
- `AC-3` Disabling a category stops those notifications within one send cycle.
- `AC-4` An uninstalled device's token is pruned after its first failed send.

---

### F12 — Analytics & reporting · *Phase 3*

**Purpose.** Let the Doctor run the business on evidence.

**Rules**
- `R-1` Nightly rollups into summary tables. Dashboards read rollups, never scan raw event tables. (`D-45`)
- `R-2` Revenue figures are **net of store commission** and clearly labelled gross and net, because a dashboard showing gross revenue is a dashboard that misleads its owner.
- `R-3` Every metric is filterable by community and by date range, and exportable to CSV.
- `R-4` `analytics.revenue.read` is a separate capability from `analytics.read`.

**Deliverables.** Rollup jobs and summary tables · dashboard in the admin app and portal: active members (DAU/WAU/MAU) and retention cohorts by community · subscriptions started, cancelled, churn rate, trial conversion · gross and net revenue by community and by month · watch time, completion rate and drop-off point per video and per programme · live session attendance and peak concurrency · points distribution and member count per tier · post, comment and chat volume per community · bookings, completion rate, no-show rate and consultation revenue · moderation volume and median response time · CSV export.

**Acceptance**
- `AC-1` Every dashboard panel loads in under 2 seconds with 12 months of simulated data.
- `AC-2` Revenue reconciles to within 1% of App Store Connect and Play Console for the same period.
- `AC-3` Trial conversion rate is independently verifiable from the raw tables.

---

### F13 — Admin web portal · *Priced add-on, built in parallel with Phase 3*

**Purpose.** Desktop administration for the Doctor and staff. §3 of the proposal states the case.

**Rules**
- `R-1` The portal consumes **the same `/v1/admin/*` API** as the admin app. No portal-only endpoints, no duplicated business logic. (`D-46`)
- `R-2` Same capability model, same default-deny, same audit logging.
- `R-3` Arabic and English with RTL.
- `R-4` Responsive to tablet width; it is a desktop tool and will not pretend to be a phone app.

**Deliverables.** Web application (React + TypeScript, same design tokens) · admin authentication with phone+OTP · community management · content: bulk upload, library table, playlist builder with drag ordering, targeting, publishing · live session scheduling and stream key · points rules, tiers and tier-capability matrix editors · moderation queue optimised for desktop review, with keyboard shortcuts · member and subscription management with search · booking calendar and availability editor · full analytics dashboards with CSV export · admin user and role management · audit log viewer · deployment and CI.

**Acceptance**
- `AC-1` Every admin capability exercisable in the mobile app is exercisable in the portal.
- `AC-2` No endpoint exists that only the portal can call.
- `AC-3` A moderator can process 50 queued reports in under 10 minutes using keyboard shortcuts.

---

## 7. System architecture

### 7.1 Stack

| Layer | Technology | Why |
|---|---|---|
| Mobile | **Flutter** (member app, admin app) | One codebase, two platforms, two apps; consistent with existing in-house projects |
| State / routing / DI | `flutter_bloc`, `go_router`, `get_it`, `dio` | House standard; no code generation, which keeps builds fast and diffs readable |
| API | **NestJS 11** (TypeScript, strict) | Module boundaries, dependency injection and Swagger generation out of the box |
| ORM | **Prisma 6** | Typed queries, reviewable forward-only migrations |
| Database | **PostgreSQL 16** | Relational integrity for billing, entitlement and ledger data |
| Cache / sockets / locks | **Redis 7** | Access-context cache, Socket.IO adapter, slot locks, rate limits, viewer counts |
| Jobs | **BullMQ** | Scheduled and retryable background work on Redis |
| Media (VOD + live) | **Cloudflare Stream** | Free ingest and encoding, live-to-VOD recording, signed URLs, lowest cost at this scale |
| Push | **Firebase Cloud Messaging** | Free, reliable, both platforms |
| SMS | Gulf provider (Unifonic / Twilio) | OTP delivery with regional sender IDs |
| Payments (consultations) | Kuwaiti gateway (Tap / MyFatoorah) | Local cards and KNET; ~2–3% vs store commission |
| Payments (subscriptions) | Apple IAP · Google Play Billing | Mandatory for this content type |
| 1:1 calls | WebRTC provider (LiveKit Cloud) | Sub-second two-party calls, usage-priced, Flutter SDK |
| Web portal | React + TypeScript + Vite | Shares design tokens and the admin API |
| Monitoring | Sentry + provider metrics | Errors and performance, with no PII |

### 7.2 Topology

A **modular monolith**: one deployable NestJS API with hard internal module boundaries, a separate worker process for BullMQ, managed PostgreSQL and Redis, and media and delivery handled entirely by Cloudflare's edge. (`D-47`)

```
   Member app (Flutter)          Admin app (Flutter)         Portal (React)
          │                              │                          │
          └──────────────┬───────────────┴──────────────────────────┘
                         │ HTTPS + WSS
                   ┌─────▼──────────────────────────┐
                   │  NestJS API (modular monolith) │
                   │  REST · Socket.IO gateway      │
                   └──┬──────────┬──────────┬───────┘
                      │          │          │
              ┌───────▼──┐  ┌────▼────┐  ┌──▼──────────────┐
              │ Postgres │  │  Redis  │  │ BullMQ worker   │
              └──────────┘  └─────────┘  └─────────────────┘
                      │
   ┌──────────────────┴──────────────────────────────────────┐
   │ Cloudflare Stream · FCM · SMS · Payment GW · LiveKit    │
   │ Apple / Google billing webhooks                         │
   └─────────────────────────────────────────────────────────┘
```

**Why not microservices** (`D-48`). The client's concern is scalability, and that concern is right — but at launch scale (<5,000 members, <500 concurrent live viewers) microservices would add deployment, local-development, debugging and infrastructure cost while *reducing* delivery speed, which is the actual constraint on this project. What matters is that the boundaries are real, so extraction is a deployment change rather than a rewrite. §7.8 states the extraction order.

### 7.3 Module map

Each module owns its tables and exposes only a service interface. **Cross-module access goes through the other module's exported service, never its repository and never its tables.** This single rule is what makes the boundaries real rather than decorative. (`D-49`)

| Module | Owns | Depends on |
|---|---|---|
| `identity` | members, admins, sessions, consents, devices | — |
| `access` | capability catalog, roles, `AccessContext`, guards | identity, billing, points |
| `taxonomy` | communities, life stages, targeting joins | — |
| `billing` | subscriptions, trials, store webhooks, entitlement | identity, taxonomy |
| `points` | ledger, balances, rules, tiers, tier capabilities | identity |
| `content` | playlists, videos, progress, reactions, comments | taxonomy, media |
| `live` | sessions, live inputs, state machine, viewer counts | taxonomy, media |
| `social` | posts, media, reactions, comments | taxonomy |
| `chat` | rooms, messages, memberships, mutes | taxonomy |
| `moderation` | reports, blocks, actions, sanctions, audit | social, chat, content, identity |
| `booking` | availability, slots, bookings, payments, notes | identity, payments, calls |
| `notifications` | notifications, preferences, fan-out | identity, taxonomy, points |
| `analytics` | rollups, dashboards, export | reads rollups only |
| `media` | provider abstraction, upload URLs, playback tokens | — |
| `payments` | gateway abstraction, charges, refunds | — |

### 7.4 Data model — the tables that carry the design

**Append-only, never updated or deleted:** `point_events`, `moderation_actions`, `audit_logs`, `consents`, `booking_events`, `subscription_events`. (`D-50`)

Why it matters: these six tables are the ones you will be asked to explain — why a member is at a tier, why they were banned, why a refund happened, what they consented to and when. A mutable row cannot answer those questions.

**Conventions.** UUIDv7 primary keys (time-ordered, index-friendly). Created/updated/by audit columns on first-class entities. Native PostgreSQL enums for state fields. Money as `Decimal(10,3)` with an explicit currency column — never a float. Instants in UTC; scheduling in `Asia/Kuwait` wall-clock with the conversion in exactly one place.

**Indexes on the hot paths** (verified by query plan, not by assumption): community feed `(communityId, createdAt DESC, id)` · chat history `(roomId, id DESC)` · entitlement lookup `(memberId, state, currentPeriodEnd)` · ledger by member `(memberId, createdAt DESC)` · video progress `(memberId, videoId)` unique · bookings `(startsAt)` unique where confirmed · moderation queue `(status, createdAt)`.

**Volume at launch scale:** point events are the fastest-growing table at roughly 2–4 million rows per year, then chat messages. Both are designed for monthly partitioning, which is additive when needed and not done in V1. (`D-51`)

### 7.5 Media architecture

**Upload.** Admin requests a one-time upload URL → API calls Cloudflare with `requireSignedURLs: true` → admin app or portal uploads directly, resumably, to Cloudflare → webhook on `ready` → video becomes publishable. The API never handles video bytes.

**Playback.** Member requests playback → API verifies entitlement and tier → mints a signed token with the private signing key → returns the manifest URL plus token, TTL 2 hours. **No URL that works without a token is ever issued for member content.** Because tokens are minted per request at volume, we use the signing-key method rather than Cloudflare's `/token` endpoint. (`D-52`)

**Live.** API creates a live input per session with `recording.mode = automatic` and `requireSignedURLs = true`, returning RTMPS URL and key to the Doctor only. Provider webhooks drive the state machine. On disconnect the recording becomes a VOD asset attached as a draft to the configured playlist.

**Cost control.** Per-minute pricing makes spend predictable and visible. Resolution ladders are capped at 1080p, and the analytics dashboard surfaces delivered minutes so the Doctor sees cost moving with viewership rather than discovering it on an invoice.

### 7.6 Realtime architecture

One Socket.IO gateway inside the API, Redis adapter for horizontal scale, namespaces `/chat` and `/live`.

- **Handshake auth**: JWT verified, `AccessContext` loaded, socket bound to that member. Room joins are authorised against entitlement and tier — never trusted from the client.
- **Database is the source of truth.** Sockets deliver; they do not guarantee. On reconnect the client fetches history by cursor and reconciles. This is why a dropped socket is an inconvenience rather than a lost message. (`D-36`)
- **Aggregate, don't fan out.** Viewer counts and live reaction totals are computed in Redis and broadcast on a 3-second tick. One message per reaction is how live features take down an API. (`D-34`)
- **Backpressure**: per-member rate limits emit a throttle event rather than disconnecting. Rooms over a configured size switch to batched delivery.
- **Entitlement revocation** propagates within one access-cache cycle (≤ 300 s), and immediately on explicit invalidation — a member who stops paying stops receiving.

### 7.7 Background jobs

| Job | Schedule | Idempotency |
|---|---|---|
| `trial-expiry-sweep` | Hourly | `consumedAt` stamp |
| `subscription-reconcile` | Nightly | Store transaction ID |
| `points-cap-reset` | Daily, Kuwait midnight | Date key |
| `points-integrity-check` | Nightly | Read-only, reports drift |
| `live-session-reminder` | Per schedule | `remindedAt` stamp |
| `booking-reminder` (24 h, 1 h) | Per booking | `reminderSentAt` per window |
| `booking-no-show-mark` | Per booking | State transition guard |
| `slot-hold-expiry` | Every minute | State transition guard |
| `notification-fanout` | On demand, batched | Dedupe key per recipient |
| `media-status-poll` | Every 5 min | Webhook backup, state guard |
| `moderation-sla-alert` | Hourly | `alertedAt` stamp |
| `analytics-rollup` | Nightly | Idempotent upsert by date |
| `sanction-expiry` | Hourly | State transition guard |

**Every job is idempotent and safe to run twice** — because at some point every one of them will. Side effects (pushes, webhooks, job enqueues) happen **after** the originating transaction commits, never inside it. (`D-53`)

### 7.8 Scale path

The boundaries exist so that growth is a deployment decision, not an engineering crisis. In order of likelihood:

1. **Extract the Socket.IO gateway** into its own deployable. Chat and live traffic is the spikiest load and the one whose failure should not take down the API. It is already Redis-backed, so this is configuration plus a deploy.
2. **Read replica** for feeds and analytics.
3. **Partition `point_events` and `chat_messages`** monthly.
4. **CDN-cache public catalogue responses** at the edge.
5. **Extract media and billing webhook handlers** so third-party retry storms are isolated.

None of this is built in V1. All of it is *possible* in V1 without a rewrite, which is the actual requirement. (`D-54`)

---

## 8. Non-functional requirements

| Requirement | Target |
|---|---|
| Launch scale | 5,000 members · 500 concurrent live viewers · 2,000 concurrent sockets |
| Designed headroom | 10× launch scale without re-architecture |
| API latency | p95 < 400 ms for lists and feeds; < 150 ms for cached access resolution |
| Video start | < 3 s to first frame on 4G |
| Live latency | 5–15 s glass-to-glass (HLS). Sub-second is not a requirement for one-to-many broadcast |
| Chat delivery | p95 < 500 ms in-room |
| Availability | 99.5% monthly |
| App cold start | < 2.5 s on a mid-range Android device |
| App size | < 60 MB download per app |
| Crash-free sessions | > 99.5% |
| Offline | Graceful degradation with cached content and clear offline state. **Full offline operation and video downloads are out of scope** |
| Localisation | Arabic and English, full RTL, Arabic numerals per locale convention |
| Accessibility | Dynamic type, minimum 4.5:1 contrast, screen-reader labels on controls |
| Devices | iOS 15+ · Android 8+ |
| Backups | Daily automated PostgreSQL backup, 30-day retention, documented restore drill |

---

## 9. Security

| Area | Requirement |
|---|---|
| Realms | Separate JWT secrets, guards, session tables and route prefixes. (`D-03`) |
| Authorisation | Default-deny. An undeclared route is refused for everyone, `super` included. |
| Object-level checks | Every read and write verifies the caller owns or is entitled to the specific object. Out-of-scope access returns **404, not 403** — existence is never confirmed. |
| Sessions | Rotating refresh tokens with reuse detection; family-wide revocation on reuse. |
| Transport | HTTPS and WSS only, HSTS, certificate pinning on both apps. |
| Secrets | Environment or secret manager only. Never in source, never in the repository, including store credentials and service-account keys. |
| Private media | Signed, short-lived URLs only. No permanently public URL for member content is ever issued. |
| Webhooks | Signature-verified, replay-protected, idempotent. |
| Rate limiting | OTP request and verify, login, report, post, comment, chat send, booking, playback token. |
| Input | DTO validation at the edge with whitelist and unknown-field rejection; invariants re-validated in the service. The client is never trusted. |
| Logging | Structured, with request ID and principal. **Never** tokens, OTP codes, full phone numbers, payment details or consultation notes — in logs or in Sentry. |
| Audit | Every admin action on member data, content or money; append-only. |
| Dependencies | Automated vulnerability scanning in CI; no dependency released within the last 14 days. |
| Review | Security review before each phase's store submission. |

---

## 10. Privacy & compliance

### 10.1 Data protection

The platform processes personal data of members in Kuwait and the GCC. Kuwait's framework is **CITRA's Data Privacy Protection Regulation** (issued February 2024, replacing the 2021 regulation), supported by CITRA's data-classification policy and cloud-computing framework. The classification policy applies localisation requirements to its higher sensitivity tiers.

**Our commitment:** data-minimisation by design, explicit versioned consent, member export and deletion, encryption in transit and at rest, documented retention, and access logging on member data.

**Explicitly the client's responsibility** (`D-55`): confirming with Kuwaiti legal counsel whether this platform's data falls into a tier requiring in-country hosting, and whether any Ministry of Health requirement applies to a licensed practitioner delivering nutrition guidance through an app. **We have architected hosting region as a configuration choice, not an assumption**, so a localisation requirement is a deployment decision rather than a redesign — but we cannot give the legal determination, and the answer is needed before infrastructure is provisioned. See §17.8.

### 10.2 Health content positioning — not cosmetic

The app's content is **general wellness and nutrition education**, not individualised medical advice. This distinction determines whether the app is approved, and it must hold in the product itself, not only in a disclaimer:

- A prominent, acknowledged **medical disclaimer** at onboarding, versioned and recorded.
- Health claims in content carry **sources**. Apple rejects health apps for unsourced claims as a matter of routine.
- No diagnostic, treatment-recommending or dosage language in app copy or store listings.
- Store listings describe education and community, never treatment or cure.
- Consultations are presented as professional consultations with a qualified practitioner, with the practitioner's credentials shown.

### 10.3 Store compliance checklist

| Guideline | Requirement | Where it is satisfied |
|---|---|---|
| Apple 1.2 / Google UGC | Filtering, reporting, blocking, moderation response, published contact, terms | F9 in full |
| Apple 1.4.1 | Health content accuracy, sourcing, no unsupported claims | §10.2 + content guidelines supplied to the client |
| Apple 3.1.1 | Digital content sold via IAP | F3 |
| Apple 3.1.3(d) | One-to-one professional services may use other payment methods | F10 (`D-41`) |
| Apple 5.1.1 | Data collection justified, account deletion available | §2.2 |
| Apple 5.1.2 | No data sharing without consent | §10.1 |
| Both stores | Privacy policy, data-safety declarations, age rating | Phase 1 submission |

> **We expect at least one rejection round**, most likely under 1.2 or 1.4.1. This is normal for a health app with member-generated content and is **planned for in the timeline**, not treated as a surprise. Our submissions include reviewer notes that pre-empt both guidelines explicitly, which is the single most effective way to reduce rounds.

---

## 11. Deliverables

### 11.1 Software

| # | Deliverable | Phase |
|---|---|---|
| 1 | **Member app — iOS**, released on the App Store | 1, extended 2–3 |
| 2 | **Member app — Android**, released on Google Play | 1, extended 2–3 |
| 3 | **Admin app — iOS**, distributed to the Doctor and staff | 1, extended 2–3 |
| 4 | **Admin app — Android**, distributed to the Doctor and staff | 1, extended 2–3 |
| 5 | **Backend API** — NestJS, PostgreSQL, Redis, BullMQ worker, deployed with CI/CD | 1, extended 2–3 |
| 6 | **Admin web portal** — React, deployed | Add-on |
| 7 | **Design system** — tokens, components, RTL, light and dark | 1 |
| 8 | **Store configuration** — 14 subscription products across both stores, 14 Apple subscription groups | 1 |
| 9 | **Third-party configuration** — Cloudflare Stream, FCM, SMS, payment gateway, call provider, in the client's accounts | 1–3 |

### 11.2 Documentation

| # | Deliverable |
|---|---|
| 10 | API reference (Swagger / OpenAPI, published) |
| 11 | Database schema documentation with conventions and index rationale |
| 12 | Architecture document with the decision register (`D-nn`) |
| 13 | Deployment and operations runbook — deploy, migrate, rollback, restore, scale |
| 14 | Admin user guide (Arabic and English) covering every management function |
| 15 | Content guidelines for health claims and sourcing, for store compliance |
| 16 | Moderation playbook — the documented 24-hour process Apple asks about |
| 17 | Test report per phase: acceptance criteria, device matrix, results |
| 18 | Handover and training session, recorded |

### 11.3 What the client owns

Full source code and IP, in the client's repositories. All third-party accounts in the client's name. All data in the client's infrastructure. **No dependency on us to operate, deploy or extend the platform.**

---

## 12. Phased implementation plan

**Total: 15 working weeks (≈ 3.5 months)** from mobilisation. Team of 4–5 working in parallel streams.

### Week 0 — Mobilisation & de-risking

Not administrative overhead — this week removes the two risks that could otherwise derail the schedule.

| Activity | Output |
|---|---|
| **Spike 1: phone RTMPS broadcast** on physical iOS and Android devices | Go / no-go on in-app broadcast, with the desktop fallback confirmed either way |
| **Spike 2: Apple 14-subscription-group configuration** in sandbox | Confirmation that concurrent subscriptions work, or the bundle-tier fallback adopted |
| **Spike 3: WebRTC call** between physical devices | Provider selected and validated |
| Client accounts opened; **payment gateway application submitted** | The long-lead dependency started on day one |
| Scope sign-off; brand assets received; design tokens defined | Build can start without blocking questions |

### Phase 1 — Core platform & launch · Weeks 1–7

| Week | Backend | Member app | Admin app |
|---|---|---|---|
| 1 | F1 foundation, auth, realms, `AccessGuard` | Design system, auth, onboarding | Shell, auth |
| 2 | F2 taxonomy; F3 subscription model | Community selection, consent, profile | Community management |
| 3 | F3 store integration and webhooks | Paywall, IAP, restore, trial | Store product mapping |
| 4 | F4 points and tiers engine | Tier UI, points, progress | Rules, tiers, capability matrix |
| 5 | F5 media, upload, signed playback | Library, programme detail, player, progress | Upload, playlist builder, targeting |
| 6 | F6 live inputs, state machine, webhooks | Live viewer, reactions, schedule | **RTMPS broadcast**, scheduling |
| 7 | F11 notifications; hardening | Polish, device matrix | Polish |
| 7 | **Store submission — both platforms, all 14 products** | | |

**Milestone 1 (end of Week 7): apps live in both stores, taking subscriptions.** Revenue can begin.

### Phase 2 — Communities & chat · Weeks 8–11

| Week | Backend | Member app | Admin app |
|---|---|---|---|
| 8 | F7 posts, comments, reactions | Feed, composer, post detail | — |
| 9 | F8 socket gateway, rooms, messages | Chat UI, history, unread, media | Chat moderation |
| 10 | F8 rate limits, mutes; F9 reports, blocks | Report and block flows, locked states | Moderation queue, sanctions |
| 11 | F9 sanctions, audit, SLA job; hardening | Polish, device matrix | Polish |
| 11 | **Store release 2** | | *(Portal build begins in parallel)* |

**Milestone 2 (end of Week 11): feeds, group chat and moderation live.**

### Phase 3 — Consultations & insights · Weeks 12–14

| Week | Backend | Member app | Admin app |
|---|---|---|---|
| 12 | F10 availability, slots, booking state machine | Catalogue, slot picker | Availability editor, calendar |
| 13 | F10 gateway payment, refunds, call tokens | Checkout, my bookings, reschedule | Bookings, refunds, notes |
| 14 | F10 reminders, no-show; F12 rollups | Pre-call check, in-call UI | Analytics dashboards |
| 14 | **Store release 3** | | *(Portal completed)* |

**Milestone 3 (end of Week 14): paid bookings, in-app consultations and analytics live.**

### Week 15 — Stabilisation & handover

Final store releases · performance verification at target load · security review · documentation completed · recorded training session · 45-day warranty begins.

### Schedule summary

| Phase | Calendar |
|---|---|
| Week 0 — mobilisation & spikes | 1 week |
| Phase 1 — core platform & launch | 7 weeks |
| Phase 2 — communities & chat | 4 weeks |
| Phase 3 — consultations & insights | 3 weeks |
| Stabilisation & handover | 1 week |
| **Total** | **15 weeks** |
| Admin web portal (parallel, Weeks 11–14) | no added calendar |

---

## 13. Testing & acceptance

### 13.1 The minimum bar on every feature

Type-checking clean (`tsc --noEmit`, `flutter analyze`) · the acceptance criteria in its specification walked and recorded · the golden path exercised against the real API · schema validated after any migration.

### 13.2 Where unit tests are mandatory

Not everything gets tests. These do, because a bug here costs money, access or trust:

| Area | Coverage required |
|---|---|
| **Access resolution** | All three layers and their composition; entitlement boundaries; tier boundaries; cache invalidation on config change |
| **Points engine** | Idempotency; daily caps; once-per-source; reversal; tier transition at exact boundaries; balance equals ledger sum |
| **Subscription state machine** | Every legal and illegal transition; trial expiry; refund revocation; webhook replay |
| **Entitlement derivation** | Period-end boundary to the minute; grace period; multi-community intersection |
| **Slot generation & booking** | Availability minus bookings; exceptions; concurrent booking of one slot; hold expiry; cancellation refund maths |
| **Content targeting** | Intersection logic; gender exclusion; premium gating |
| **Chat authorisation** | Room join refusal; revocation mid-session |
| **Mobile** | Access-gated UI states; player progress reporting; chat reconnection gap-fill; offline degradation |

### 13.3 Device and integration verification

Physical device matrix: 2 iOS (one current, one iOS 15), 3 Android (one flagship, one mid-range, one low-end). **Broadcast, in-app calling and in-app purchase are verified on physical devices only** — a simulator cannot prove any of the three.

Store sandbox testing: purchase, concurrent purchases, restore, cancel, refund, renewal, trial expiry, on both platforms.

Load verification before each release: 500 concurrent sockets · 500 simulated live viewers · feed queries against 50,000 posts · 12 months of simulated analytics data.

### 13.4 Acceptance process

Each phase ends with a demo against its specification, a written test report, and the client's sign-off. A phase is **not accepted** until every `AC-n` in its specifications passes or is explicitly waived in writing.

---

## 14. Risk register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| **R1** | **Flutter phone-broadcast plugins are immature.** The available RTMP packages are small, young, and WHIP support is alpha. | High — a headline feature | **Medium-High** | **Week 0 spike on physical devices before any dependent work.** A desktop RTMPS stream key is built regardless (`D-33`), so the feature ships either way; only the origin changes. Client preference confirmed in §17.6. |
| **R2** | **Apple rejects 14 same-price subscription products** across 14 groups. | High — blocks monetisation | Medium | Week 0 sandbox validation. Distinct names and descriptions per product. Documented fallback to bundle tiers behind the same entitlement interface (`D-20`) — billing module only. |
| **R3** | **Guideline 1.2 rejection** over member-generated content. | Medium — delays launch | **High** | Complete moderation toolkit before first submission (F9), documented 24-hour process, explicit reviewer notes. Resubmission effort is in the plan. |
| **R4** | **Guideline 1.4.1 rejection** over health content. | Medium — delays launch | Medium-High | Wellness-not-medical positioning (§10.2), sourced claims, acknowledged disclaimer, careful store copy. Content guidelines delivered to the client. |
| **R5** | **Payment gateway KYC takes 2–4 weeks**, or longer. | High — blocks Phase 3 | **High if not started Week 1** | Application submitted in Week 0 as a stated client dependency. Phase 3 is last specifically so this has maximum runway. |
| **R6** | **Group chat volume** exceeds a single room's usability or the gateway's capacity. | Medium | Low at launch, rising | Redis-backed sockets from day one; rate limits; batched delivery above a room-size threshold; multi-room splitting designed as additive (`D-36`); gateway extraction is step 1 of the scale path. |
| **R7** | **Video delivery cost grows faster than revenue.** | Medium | Medium | Per-minute pricing, 1080p ceiling, delivered-minutes visible in the analytics dashboard so cost is watched, not discovered. |
| **R8** | **Points gaming** — members farm points to unlock posting. | Medium — community quality | Medium | Daily caps, once-per-source dedupe, moderation reversal, rate limits, admin adjustment with audit. Rules are tunable live without a release. |
| **R9** | **Scope expansion.** Two significant features (1-to-1 consultations, group chat) were added during discovery. | High — timeline and cost | **High** | This signed document is the scope baseline. Change requests are quoted with scope, cost and timeline impact before any work. §18. |
| **R10** | **Client feedback slower than 2 working days.** | High — the timeline assumes it | Medium | One named decision-maker (§15). Delay is logged and the revised date communicated at the time, not at the end. |
| **R11** | **Launch content not ready.** An empty app converts nobody. | Medium — commercial, not technical | Medium | Content readiness is a Week 6 client dependency. Bulk upload tooling in the portal; content entry support quotable if wanted. |
| **R12** | **Kuwait data-localisation requirement** discovered after provisioning. | Medium — migration | Low-Medium | Hosting region is a configuration choice, not an assumption (`D-55`). Legal determination requested in Week 1 (§17.8). |

---

## 15. Assumptions & client dependencies

### 15.1 Assumptions

1. The Doctor is the sole content owner and consultant in V1; multi-practitioner is designed-for but not built (`D-56`).
2. Member app is mobile-only. Members have no web experience in V1.
3. Arabic and English only. No further languages.
4. Launch scale per §8. 10× is reachable without re-architecture.
5. Content is pre-produced by the client; we build no production or editing tooling.
6. Legal documents are drafted or reviewed by the client's Kuwaiti counsel. We supply technical content and required disclosures.
7. All third-party accounts are in the client's name and billed to the client.
8. One named decision-maker, with feedback inside 2 working days.
9. Monthly billing only in V1. Annual plans are additive.
10. Consultations are one-to-one only. Group sessions would require store billing (`D-41`) and are out of scope.

### 15.2 Client dependencies — with dates

| # | Dependency | Needed by | Consequence if late |
|---|---|---|---|
| 1 | **Payment gateway merchant application submitted** | **Week 0** | Phase 3 slips by the delay. Longest lead time in the project. |
| 2 | Apple Developer and Google Play accounts, organisation-verified | **Week 1** | No submission, no TestFlight, Phase 1 milestone slips. |
| 3 | Cloud, Cloudflare and Firebase accounts with our access | **Week 1** | Nothing deploys. |
| 4 | Definitive 7 life stages per gender, and price per community | **Week 1** | Store products cannot be created; Apple review of 14 products cannot start. |
| 5 | Brand assets — logo, colours, Arabic typography | **Week 1** | Design system blocked, rework likely. |
| 6 | SMS provider account and sender-ID registration | **Week 2** | Sign-up cannot be tested. |
| 7 | Opening points values and tier configuration | **Week 3** | Defaults in this document are used and changed later. |
| 8 | Terms of Service, Privacy Policy, Medical Disclaimer | **Week 5** | Store submission blocked. |
| 9 | Launch content — videos and programme structure | **Week 6** | Launch is technical only; commercial launch slips. |
| 10 | Consultation durations and prices | **Week 10** | Phase 3 build blocked. |
| 11 | Data-residency legal determination | **Week 1** | Risk of migrating infrastructure later (R12). |
| 12 | Feedback within 2 working days, throughout | Ongoing | Direct day-for-day timeline impact. |

---

## 16. Out of scope for V1

Explicitly excluded. Each is a candidate for a later phase and would be quoted separately.

**Product:** public marketing website or landing page · member-facing web app · nutrition plan generation · calorie, macro or food logging · barcode or food-database lookup · wearable, Apple Health or Google Fit integration · lab-result upload or interpretation · weight and measurement tracking with charts · recipes and meal plans as a structured feature · e-commerce for supplements or physical goods · multi-practitioner marketplace · group or webinar-style paid sessions · affiliate or referral programme · gift subscriptions or promo codes · annual plans · web-based subscription checkout · live chat during broadcasts · direct member-to-member messaging · video downloads for offline viewing · Chromecast or AirPlay · in-app translation of content.

**Technical:** full offline mode · DRM beyond signed URLs · AI or automated content moderation · AI-generated content or recommendations · third-party analytics beyond the built-in dashboard · CRM, email-marketing or helpdesk integration · SSO or enterprise identity · native tablet-optimised layouts · wearable apps · multi-region active-active deployment.

**Services:** content production, filming, editing or subtitling · copywriting or translation of the Doctor's content · legal drafting · launch marketing, advertising or ASO beyond basic store listings · ongoing content entry after handover · community management or moderation staffing.

---

## 17. Open questions

To be answered by the client before or during Week 1. Numbered for reference in correspondence.

1. **The definitive seven life stages per gender.** Examples given: single, student, married, father, sportsman. We need all seven, and whether the female list differs from the male list. *(Blocks: store products, Apple review timing — dependency 4.)*
2. **Price per community in KWD.** Also: bundle discount for members joining several communities? An annual option alongside monthly? *(Blocks: store products.)*
3. **Strict gender separation?** We have assumed a male member can never see any female-community content (`D-16`). Confirm, or identify content that should be shared across both.
4. **Opening points values and tier configuration.** The engine is fully configurable; §5.2 and §5.3 propose defaults. Confirm or replace. *(Does not block the build.)*
5. **Consultation types** — durations and prices.
6. **Broadcast fallback preference.** If the Week 0 spike shows phone broadcast is unreliable on some devices, is a desktop setup acceptable for planned sessions? *(The platform supports both; we want the preference on record before the spike.)*
7. **Launch content** — how many programmes and videos will be ready, and who enters them?
8. **Data residency** — does any Kuwaiti requirement compel hosting member data in Kuwait or the GCC? Legal determination needed. *(Dependency 11, risk R12.)*
9. **Admin staff at launch** — how many, in what roles? Determines the initial role templates.
10. **Arabic and English, or Arabic only?** We have assumed both with full RTL.
11. **Future practitioners** — we are designing so additional doctors or coaches can be added later without a rewrite (`D-56`). Is that expected, and on what horizon?
12. **Subscription refunds** — store-handled refunds are Apple's and Google's decision and cannot be overridden. Confirm understood.
13. **Consultation recording** — not implemented in V1 (`D-43`) on consent and retention grounds. Confirm this is acceptable.

---

## 18. Change control

1. The signed version of this document is the scope baseline.
2. Any requested change outside it is written up as a change request stating **scope, cost and timeline impact** before any work begins.
3. The client accepts or declines in writing. **Nothing outside this document is built unquoted, and nothing unquoted is invoiced.**
4. Changes within a phase already in build may be deferred to the next phase to protect the milestone date; we will say so rather than silently absorb and slip.
5. Decisions made during the build are recorded against their `D-nn` reference with the reason, so a future question is answered from the record rather than re-litigated.

---

## Appendix A — Decision register

| Ref | Decision |
|---|---|
| D-01 | Business rules are runtime data, not code: communities, prices, point values, tiers, policies |
| D-02 | V1 is not a clinical tool: no plan generation, tracking, wearables or diagnoses |
| D-03 | Two realms with separate secrets, guards, sessions and route prefixes |
| D-04 | Phone + SMS OTP authentication for both realms |
| D-05 | Versioned consent, append-only, re-prompted on new version |
| D-06 | Gender set once at sign-up; changeable only by support |
| D-07 | Rotating refresh tokens with reuse detection and family revocation |
| D-08 | Account deletion = soft delete + PII scrub + phone sentinel; ledger retained anonymised |
| D-09 | Capability-based admin authorisation, default-deny |
| D-10 | `live.broadcast` is the Doctor's alone, enforced in code |
| D-11 | Member access = Realm ∩ Entitlement ∩ Tier capability, composed in one guard |
| D-12 | Access context cached in Redis; global `configVersion` bump invalidates all on tier config change |
| D-13 | Declarative guard over indexed tables rather than a policy engine |
| D-14 | 14 communities: 7 life stages × 2 genders |
| D-15 | Taxonomy is admin-editable data; archive, never delete |
| D-16 | Gender strictly determines community reachability |
| D-17 | Merged content library across entitled communities; separate feeds and chat rooms |
| D-18 | One subscription per community |
| D-19 | 14 Apple products across 14 subscription groups for concurrency |
| D-20 | Documented fallback: bundle tiers behind the same entitlement interface |
| D-21 | 14-day trial, once per member, no payment method |
| D-22 | Trial is server-owned, not a store introductory offer |
| D-23 | Entitlement derived from subscription state, never stored as a flag |
| D-24 | Join any time; leaving keeps access to period end |
| D-25 | Store webhooks drive state; nightly reconciliation covers lost webhooks |
| D-26 | One global points balance per member |
| D-27 | Append-only ledger; balance materialised in the same transaction |
| D-28 | Anti-abuse: daily caps, once-per-source dedupe, reversal by compensating row |
| D-29 | No point decay in V1 |
| D-30 | Direct-to-provider upload; video never transits the API |
| D-31 | All assets require signed URLs; token minted per request after entitlement check |
| D-32 | RTMPS ingest, because sub-second WebRTC cannot be recorded |
| D-33 | Desktop stream key issued for every session as the designed fallback |
| D-34 | Viewer counts and live reactions aggregated in Redis, broadcast on a 3-second tick |
| D-35 | Fan-out on read for feeds at V1 scale |
| D-36 | PostgreSQL is chat's source of truth; sockets are transport only |
| D-37 | Chat pushes batched to at most one per room per hour, except mentions and the Doctor |
| D-38 | Full moderation toolkit before first submission — an approval requirement |
| D-39 | Recurring weekly availability plus dated exceptions |
| D-40 | Redis hold is an optimisation; the unique constraint is the guarantee |
| D-41 | Consultations use a payment gateway under Apple 3.1.3(d); content stays on store billing |
| D-42 | Call tokens minted only inside the join window, only for the two participants |
| D-43 | No consultation recording in V1 |
| D-44 | Notifications filtered by entitlement and tier at send time |
| D-45 | Dashboards read nightly rollups, never raw event tables |
| D-46 | The portal consumes the same admin API; no portal-only endpoints |
| D-47 | Modular monolith with a separate worker process |
| D-48 | No microservices in V1; boundaries make extraction a deployment change |
| D-49 | Cross-module access via exported services only, never repositories or tables |
| D-50 | Six append-only tables: points, moderation, audit, consent, booking and subscription events |
| D-51 | Partitioning designed for, not implemented in V1 |
| D-52 | Signing-key token minting rather than the provider's token endpoint |
| D-53 | All jobs idempotent; side effects after commit |
| D-54 | Scale path ordered: gateway extraction, read replica, partitioning, edge cache, webhook isolation |
| D-55 | Hosting region is configuration; the legal determination is the client's |
| D-56 | Multi-practitioner designed-for, not built |

---

*End of document. Prepared 1 November 2026. Scope baseline on signature by both parties.*
