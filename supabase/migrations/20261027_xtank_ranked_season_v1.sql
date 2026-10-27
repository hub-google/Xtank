
INSERT INTO xtank.seasons(code,display_name,starts_at,ends_at,status,config)
VALUES('2026-Q4','2026 年第 4 季賽季','2026-10-01T00:00:00Z','2027-01-01T00:00:00Z','active',
 '{"win_points":20,"loss_points":-10,"mmr_win":20,"mmr_loss":-15}'::jsonb)
ON CONFLICT(code) DO NOTHING;

CREATE OR REPLACE FUNCTION xtank.advance_ranked_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m xtank.matches%ROWTYPE; season xtank.seasons%ROWTYPE; part record; delta int; dmmr int;
BEGIN
 SELECT * INTO m FROM xtank.matches WHERE match_id=p_match_id;
 IF NOT FOUND OR m.match_source<>'official' OR m.status<>'completed' OR m.ended_at IS NULL
 THEN RAISE EXCEPTION 'OFFICIAL_MATCH_REQUIRED'; END IF;
 SELECT * INTO season FROM xtank.seasons WHERE status='active' AND starts_at<=m.ended_at AND ends_at>m.ended_at
 ORDER BY starts_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 FOR part IN SELECT player_id,is_winner FROM xtank.match_participants WHERE match_id=p_match_id AND player_id IS NOT NULL LOOP
   delta:=CASE WHEN part.is_winner THEN 20 WHEN part.is_winner IS FALSE THEN -10 ELSE 0 END;
   dmmr:=CASE WHEN part.is_winner THEN 20 WHEN part.is_winner IS FALSE THEN -15 ELSE 0 END;
   INSERT INTO xtank.player_ratings(season_id,player_id,mode_id,rating,mmr,wins,losses)
   VALUES(season.season_id,part.player_id,m.mode_id, greatest(0,1000+delta),greatest(0,1000+dmmr),
     CASE WHEN part.is_winner THEN 1 ELSE 0 END,
     CASE WHEN part.is_winner IS FALSE THEN 1 ELSE 0 END)
   ON CONFLICT(season_id,player_id,mode_id) DO UPDATE SET
     rating=greatest(0,xtank.player_ratings.rating+delta),
     mmr=greatest(0,xtank.player_ratings.mmr+dmmr),
     wins=xtank.player_ratings.wins+CASE WHEN part.is_winner THEN 1 ELSE 0 END,
     losses=xtank.player_ratings.losses+CASE WHEN part.is_winner IS FALSE THEN 1 ELSE 0 END,
     updated_at=now();
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION xtank.advance_ranked_match(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtank.advance_ranked_match(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.xtank_season_leaderboard(p_mode_id text DEFAULT 'FFA')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE season xtank.seasons%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_mode_id NOT IN ('FFA','TDM','FLAG_HOLD') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
 SELECT * INTO season FROM xtank.seasons WHERE status='active' AND starts_at<=now() AND ends_at>now()
 ORDER BY starts_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('season',null,'players','[]'::jsonb); END IF;
 RETURN jsonb_build_object(
  'season',jsonb_build_object('code',season.code,'name',season.display_name,'ends_at',season.ends_at),
  'players',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
    SELECT p.display_name,r.rating,r.mmr,r.wins,r.losses,
      row_number() OVER(ORDER BY r.rating DESC,r.wins DESC,r.updated_at ASC) AS rank
    FROM xtank.player_ratings r JOIN xtank.players p ON p.player_id=r.player_id
    WHERE r.season_id=season.season_id AND r.mode_id=p_mode_id AND p.account_status='active'
    ORDER BY r.rating DESC,r.wins DESC,r.updated_at ASC LIMIT 50
   ) x));
END $$;
REVOKE ALL ON FUNCTION public.xtank_season_leaderboard(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_season_leaderboard(text) TO authenticated;
