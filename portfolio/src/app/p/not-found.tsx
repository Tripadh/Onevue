/**
 * Not-found boundary for the public portfolio segment (/p/*).
 *
 * The route segment layout (src/app/p/[username]/layout.tsx) resolves the
 * published snapshot before the loading boundary flushes the response shell,
 * so that an unpublished profile commits HTTP 404. A not-found boundary in
 * the same segment does not catch notFound() raised by that segment's own
 * layout, so this parent-level boundary renders the identical designed
 * portfolio-not-available experience for that path.
 */

export { default } from "./[username]/not-found";
