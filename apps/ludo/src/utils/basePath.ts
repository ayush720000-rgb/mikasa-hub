// Each app is served under its own prefix (for example /chess or /ludo) on the shared
// host. Vite injects BASE_URL from the build-time `base` setting, so every URL the client
// builds stays correct in both production and dev.
export const APP_BASE: string = import.meta.env.BASE_URL.replace(/\/$/, '');

export function appPath(path: string): string {
  return `${APP_BASE}${path}`;
}
