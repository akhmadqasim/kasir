// Only what other features consume. The page itself is deliberately not here:
// the router lazy-loads it from `components/settings-page` directly, so the
// sidebar importing the hook does not drag the whole settings screen into the
// main chunk (DESIGN.md §8, rule 4).
export { useStoreInfo } from "./hooks/use-store-info"
