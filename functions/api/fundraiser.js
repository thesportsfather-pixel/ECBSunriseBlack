import { json, getTeam, getPlayer, supabaseRequest } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const teamKey = url.searchParams.get("team") || "ecb-sunrise";
    const playerKey = url.searchParams.get("player");

    if (!playerKey) return json({ success: false, error: "player is required" }, 400);

    const team = await getTeam(env, teamKey);
    const player = await getPlayer(env, team.id, playerKey);

    const baseballs = await supabaseRequest(
      env,
      `baseballs?team_id=eq.${encodeURIComponent(team.id)}&player_id=eq.${encodeURIComponent(player.id)}&select=ball_number,status,donor_name,sold_at&order=ball_number.asc`
    );

    const sold = (baseballs || []).filter(b => b.status === "sold");
    const raisedDollars = sold.reduce((sum, b) => sum + Number(b.ball_number || 0), 0);
    const goalDollars = Number(team.goal_cents || 505000) / 100;

    return json({
      success: true,
      team: {
        teamKey: team.team_key,
        teamName: team.team_name
      },
      player: {
        playerKey: player.player_key,
        playerName: player.player_name,
        playerNumber: player.player_number
      },
      totals: {
        soldCount: sold.length,
        raisedCents: raisedDollars * 100,
        raisedDollars,
        goalDollars
      },
      baseballs: (baseballs || []).map(b => ({
        ballNumber: b.ball_number,
        status: b.status,
        donorName: b.donor_name,
        soldAt: b.sold_at
      }))
    });
  } catch (error) {
    console.error(error);
    return json({ success: false, error: error.message || "Server error" }, 500);
  }
}
