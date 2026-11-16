// Stats are read from the server. Match records are written there when a game ends, so the
// browser never stores or edits them.
import { appPath } from './basePath';
import { getIdentityToken } from './telegram';
import type { PlayerStatsData } from './playerStatsCore';

export { EMPTY_STATS } from './playerStatsCore';
export type { MatchRecord, PlayerStatsData } from './playerStatsCore';

export async function fetchPlayerStats(): Promise<PlayerStatsData> {
  const token = getIdentityToken();
  if (!token) throw new Error('Not signed in');
  const response = await fetch(appPath('/api/stats'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Stats request failed (${response.status})`);
  return (await response.json()) as PlayerStatsData;
}
