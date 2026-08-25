function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function supabaseGet(env, path) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase server configuration.");
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${path}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: "application/json"
      }
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  return text ? JSON.parse(text) : [];
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    const teamKey =
      url.searchParams.get("team") ||
      "ecb-sunrise-black";

    const playerKey =
      url.searchParams.get("player");

    if (!playerKey) {
      return json(
        {
          success: false,
          error: "Player is required."
        },
        400
      );
    }

    const teams = await supabaseGet(
      env,
      `teams?team_key=eq.${encodeURIComponent(teamKey)}&select=id,team_key,team_name&limit=1`
    );

    if (!teams.length) {
      return json(
        {
          success: false,
          error: "Team not found."
        },
        404
      );
    }

    const team = teams[0];

    const players = await supabaseGet(
      env,
      `players?team_id=eq.${encodeURIComponent(team.id)}&player_key=eq.${encodeURIComponent(playerKey)}&select=id,player_key,player_name,player_number&limit=1`
    );

    if (!players.length) {
      return json(
        {
          success: false,
          error: "Player not found."
        },
        404
      );
    }

    const player = players[0];

    const baseballs = await supabaseGet(
      env,
      `baseballs?player_id=eq.${encodeURIComponent(player.id)}&select=ball_number,amount_cents,status,donor_name,sold_at&order=ball_number.asc`
    );

    return json({
      success: true,

      team: {
        team_key: team.team_key,
        team_name: team.team_name
      },

      player: {
        player_key: player.player_key,
        player_name: player.player_name,
        player_number: player.player_number
      },

      baseballs
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error: error.message || "Server error."
      },
      500
    );
  }
}
