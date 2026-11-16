import { appPath } from '../utils/basePath';
/**
 * Fixed Mascot image management using the user's provided asset
 */

export const USER_PROVIDED_MASCOT_PATH = appPath('/assets/mikasa.jpg');

export function getMascotImage(): string {
  return USER_PROVIDED_MASCOT_PATH;
}
