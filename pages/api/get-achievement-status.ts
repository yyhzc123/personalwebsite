import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { steamId, apiKey, appId } = req.query;

  if (!steamId || !apiKey || !appId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const endpoint = `http://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?key=${apiKey}&steamid=${steamId}&appid=${appId}&l=english`;

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      // Steam API often returns 200 even for errors (e.g., private profile),
      // so we check the body for success.
      const errorData = await response.json().catch(() => null);
      if (errorData && errorData.playerstats && errorData.playerstats.success === false) {
         return res.status(200).json({ isCompleted: false, error: errorData.playerstats.message });
      }
      return res.status(response.status).json({ error: `Steam API error: ${response.statusText}` });
    }

    const data = await response.json();

    if (!data.playerstats || !data.playerstats.achievements) {
      // This can happen if the game has no achievements or the profile is private
      return res.status(200).json({ isCompleted: false });
    }

    const achievements = data.playerstats.achievements;
    const allAchieved = achievements.every((ach: any) => ach.achieved === 1);

    res.status(200).json({ isCompleted: allAchieved });
  } catch (e) {
    console.error('Achievement fetch error:', e);
    res.status(500).json({ error: 'Failed to fetch achievement data' });
  }
}