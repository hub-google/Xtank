CREATE OR REPLACE FUNCTION xtank.advance_ranked_match(p_match_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE m xtank.matches%ROWTYPE; season xtank.seasons%ROWTYPE; part record; delta int; dmmr int;
BEGIN
 SELECT * INTO m FROM xtank.matches WHERE match_id=p_match_id;
 IF NOT FOUND OR m.match_source<>'official' OR m.status<>'completed' OR m.ended_at IS NULL
 THEN RAISE EXCEPTION 'OFFICIAL_MATCH_REQUIRED'; END IF;
 -- PRD §6: growth rooms keep XP and coins, but only standardized rooms
 -- update competitive season ratings and MMR. Legacy matches have no
 -- room_rule_class and retain their historical results unchanged.
 IF coalesce(m.results->>'room_rule_class','growth')<>'standard' THEN RETURN; END IF;
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
END $function$

