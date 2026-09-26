/**
 * The slice of the store row the server hands out before anyone signs in
 * (`GET /api/store/public`), mirroring `PublicStoreInfo` in the desktop's
 * `src/features/settings/types.ts`. Nothing else from the store row is public.
 */
export interface PublicStoreInfo {
  name: string
  /** Whether `GET /api/store/logo` has an image to serve. */
  has_logo: boolean
}
