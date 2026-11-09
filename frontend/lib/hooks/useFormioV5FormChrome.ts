'use client';

import { useEffect } from 'react';
import { disableFormioBrowserAuth } from '@/src/features/formio-v5/disableFormioBrowserAuth';
import { withBasePath } from '@/src/shared/config/basePath';

/**
 * Form.io renderer/builder stylesheet, injected only while a Form.io component
 * (renderer or builder) is mounted. The static copy lives under `public/formio-v5/`
 * (maintain by hand when upgrading @formio/js, including `public/formio-v5/fonts/`).
 *
 * Both the renderer and the builder load the FULL stylesheet: only it contains the
 * `bootstrap-icons` @font-face + icon classes (calendar, etc.). The renderer-only
 * `formio.form.min.css` has no icons, so submitters lost icons like the calendar.
 * (The renderer could be slimmed later with an extracted icons-only stylesheet.)
 * It does not bundle Bootstrap — it relies on the app's own (unlayered) Bootstrap.
 * `bcgov-file.css` follows it with Form.io's file component rules for the BC Gov file component.
 *
 * It's loaded into a low-priority `formio` cascade layer via a `<style>` doing
 * `@import url(...) layer(formio)` (a `<link>` can't be assigned a layer). Unlayered
 * app CSS always beats layered CSS, so Form.io can't leak into / restyle the app
 * chrome (header, nav, the signed-in dropdown).
 *
 * `variant` only gates enablement (kept for call-site clarity / future per-mode
 * slimming); pass `null` to inject nothing.
 */
type Variant = 'render' | 'build';

const STYLESHEETS = ['/formio-v5/formio.full.min.css', '/formio-v5/bcgov-file.css'];

export function useFormioV5FormChrome(variant: Variant | null): void {
  useEffect(() => {
    if (!variant || typeof document === 'undefined') return;

    disableFormioBrowserAuth();
    // Shared id: a builder + its preview renderer on the same page reuse one
    // injected stylesheet; the first to mount owns cleanup.
    const id = 'soba-formio-styles';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = STYLESHEETS.map(
      (href) => `@import url("${withBasePath(href)}") layer(formio);`,
    ).join('\n');
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, [variant]);
}
