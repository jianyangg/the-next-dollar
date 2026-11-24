// Motion's animation engine (animate/initial/exit props, AnimatePresence exits, useAnimate)
// lives in this separate module so Vite splits it into its own chunk. App.tsx loads it lazily
// through <LazyMotion features={...}>, keeping it out of the entry bundle.
// `domAnimation` covers everything the UI uses. Nothing here uses `drag` or layout animations,
// which are the only reasons to need the bigger `domMax`.
export { domAnimation as default } from 'motion/react';
