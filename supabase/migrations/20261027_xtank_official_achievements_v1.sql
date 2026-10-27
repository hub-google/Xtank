
INSERT INTO xtank.achievements(achievement_id,display_name,description,condition_config,reward_config,enabled)
VALUES
('first_battle','初次出征','完成一場正式對戰','{"type":"matches","target":1}','{"COIN":50}',true),
('first_victory','勝利之星','贏得第一場正式對戰','{"type":"wins","target":1}','{"COIN":80}',true),
('kills_10','新銳獵手','在正式對戰累計擊破十台坦克','{"type":"kills","target":10}','{"COIN":100}',true)
ON CONFLICT(achievement_id) DO NOTHING;

CREATE OR REPLACE FUNCTION xtank.progress_achievements_for_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m xtank.matches%ROWTYPE; part record; a record; incr int; target int;
BEGIN
 SELECT * INTO m FROM xtank.matches WHERE match_id=p_match_id;
 IF NOT FOUND OR m.match_source<>'official' OR m.status<>'completed' THEN RAISE EXCEPTION 'OFFICIAL_MATCH_REQUIRED'; END IF;
 FOR part IN SELECT player_id,kills,is_winner FROM xtank.match_participants WHERE match_id=p_match_id AND player_id IS NOT NULL LOOP
  FOR a IN SELECT * FROM xtank.achievements WHERE enabled LOOP
   target:=coalesce((a.condition_config->>'target')::integer,1);
   incr:=CASE a.condition_config->>'type' WHEN 'matches' THEN 1
     WHEN 'kills' THEN part.kills
     WHEN 'wins' THEN CASE WHEN part.is_winner THEN 1 ELSE 0 END ELSE 0 END;
   IF incr<=0 OR target<1 THEN CONTINUE; END IF;
   INSERT INTO xtank.player_achievements(player_id,achievement_id,progress,completed_at)
    VALUES(part.player_id,a.achievement_id,least(target,incr),CASE WHEN incr>=target THEN now() ELSE null END)
   ON CONFLICT(player_id,achievement_id) DO UPDATE SET
    progress=least(target,xtank.player_achievements.progress+EXCLUDED.progress),
    completed_at=coalesce(xtank.player_achievements.completed_at,
     CASE WHEN xtank.player_achievements.progress+EXCLUDED.progress>=target THEN now() ELSE null END);
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION xtank.progress_achievements_for_match(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtank.progress_achievements_for_match(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.xtank_achievement_api(p_action text,p_achievement_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); ach xtank.achievements%ROWTYPE; rec xtank.player_achievements%ROWTYPE; coins bigint;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active') THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED'; END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('achievements',(
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.achievement_id,'name',a.display_name,'description',a.description,
      'target',coalesce((a.condition_config->>'target')::int,1),'reward',a.reward_config,
      'progress',coalesce(pa.progress,0),'completed_at',pa.completed_at,'claimed_at',pa.claimed_at)
       ORDER BY a.achievement_id),'[]'::jsonb)
   FROM xtank.achievements a LEFT JOIN xtank.player_achievements pa
    ON pa.achievement_id=a.achievement_id AND pa.player_id=me WHERE a.enabled));
 ELSIF p_action='claim' THEN
  SELECT * INTO ach FROM xtank.achievements WHERE achievement_id=p_achievement_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACHIEVEMENT_NOT_FOUND'; END IF;
  SELECT * INTO rec FROM xtank.player_achievements WHERE player_id=me AND achievement_id=p_achievement_id FOR UPDATE;
  IF NOT FOUND OR rec.completed_at IS NULL OR rec.progress<coalesce((ach.condition_config->>'target')::int,1)
    THEN RAISE EXCEPTION 'ACHIEVEMENT_INCOMPLETE'; END IF;
  IF rec.claimed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'already_claimed',true); END IF;
  coins:=coalesce((ach.reward_config->>'COIN')::bigint,0);
  IF coins<0 OR coins>100000 THEN RAISE EXCEPTION 'INVALID_REWARD'; END IF;
  IF coins>0 THEN
    PERFORM xtank.apply_wallet_delta(me,'COIN',coins,'achievement',p_achievement_id,
      'achievement:'||me::text||':'||p_achievement_id);
  END IF;
  UPDATE xtank.player_achievements SET claimed_at=now() WHERE player_id=me AND achievement_id=p_achievement_id;
  RETURN jsonb_build_object('ok',true,'claimed_coins',coins);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_achievement_api(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_achievement_api(text,text) TO authenticated;
