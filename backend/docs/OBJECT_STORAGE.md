# Object storage

OneVue keeps uploaded files in a private store. Development and tests use disk under `backend/storage/`. Production uses a private Cloudflare R2 bucket. The browser never receives R2 credentials, raw object keys, or long-lived private download URLs.

`PROFILE_PHOTO_STORAGE` selects the provider for profile photos and every other object. `local` is the default. Production refuses to start a request that would use `local`.

## Environment

Set these in `backend/.env.local` or the production environment. Do not commit real values and do not prefix them with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `PROFILE_PHOTO_STORAGE` | `local` or `r2` |
| `CLOUDFLARE_ACCOUNT_ID` | Account id used in the R2 S3 endpoint |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Bucket access key |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Bucket secret |
| `CLOUDFLARE_R2_BUCKET_NAME` | Private bucket name |

There is no public bucket URL. `CLOUDFLARE_R2_PUBLIC_URL` is not read. Files are served by this application after it checks the asset registry.

## Cloudflare setup

1. Create an R2 bucket. Leave public access disabled. Do not attach an `r2.dev` public domain.
2. Create an API token scoped to that bucket, with Object Read and Object Write. Do not grant account-wide admin.
3. Copy the Access Key ID, Secret Access Key, and account id into the server environment.
4. Set `PROFILE_PHOTO_STORAGE=r2`.
5. Confirm the bucket settings still say the bucket is not public. A request to `https://<accountid>.r2.cloudflarestorage.com/<bucket>` without a signature must not return object bytes.

The S3 endpoint is `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` and the region is `auto`.

## Upload

Clients upload through authenticated `multipart/form-data` to `POST /api/assets`. The server checks the signed-in user, magic bytes, purpose, and size, generates the object key, and stores metadata in MongoDB. Direct browser uploads to R2 are not enabled. That matches the existing profile-photo and visiting-card routes, and the API already allows bodies up to 11 MB so the 10 MB resume limit can be enforced in the route.

Send `purpose` and `file`. Optional `Idempotency-Key` (8–80 letters, numbers, `_`, or `-`) returns the original asset when the same owner repeats the same upload.

| Purpose | Who can read it | Max size | Types |
| --- | --- | --- | --- |
| `portfolio-image` | Public only after it is included in a published revision | 5 MB | JPEG, PNG, WebP |
| `portfolio-media` | Public only after it is included in a published revision | 8 MB | JPEG, PNG, WebP, PDF |
| `resume` | Owner only | 10 MB | PDF |
| `evidence` | Owner only | 8 MB | JPEG, PNG, WebP, PDF |
| `certificate` | Owner only | 8 MB | JPEG, PNG, WebP, PDF |

Profile photos and visiting-card images stay on their existing routes and remain limited to 2 MB JPEG, PNG, or WebP.

## Access

- `GET /api/assets` and `GET /api/assets/:assetId` return the signed-in user's metadata. Responses do not include the object key.
- `GET /api/assets/private/:assetId` returns bytes to the owner, or to a short-lived signed preview URL created for that owner. Preview URLs expire after 10 minutes, are `private, no-store`, and are only issued for images and media that are allowed on a public page. They are never written into a published snapshot.
- `GET /api/assets/public/:assetId` returns bytes only when the asset is public-eligible, verified, and referenced by a published revision. The URL does not expire. The response is `public, max-age=31536000, immutable` and includes `X-Content-Type-Options: nosniff`.
- Private, deleted, pending, and unpublished assets return 404 from the public route.
- `DELETE /api/assets/:assetId` removes an asset only when no profile field and no published revision still reference it. A repeated delete is safe.

External `http` and `https` links in profile fields are unchanged. An uploaded file is attached by its `assetId` (`ast_` plus 24 hex characters). Saving one profile section does not clear asset ids in other sections.

## Profile photos and visiting cards

Legacy photo keys look like `user_<id>_<time>_<hex>.jpg`. R2 profile-photo keys use the `profile-photos/` prefix. `GET /api/profile/photo/:key` accepts only those shapes, and only when the key is the user's current profile photo, a visiting-card asset reference, or a key retained on a published revision. Arbitrary paths are rejected.

Replacing or removing a profile photo does not delete the file while a visiting card or published revision still references it. Visiting-card uploads still go through `POST /api/student/card/upload` and remain servable through the photo route while that reference exists.

## Local checks

With `PROFILE_PHOTO_STORAGE=local`, no Cloudflare variables are required. Uploaded objects are written under `backend/storage/objects/` and profile photos under `backend/storage/profile-photos/`.
