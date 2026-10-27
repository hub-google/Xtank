CREATE OR REPLACE FUNCTION public.xtank_record_official_match(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE rid text; g uuid; existing uuid; rs uuid; m text; map text; v jsonb;
 slot int; who uuid; bot text; tank text; iswin boolean; xp int; coin int;
 n int :=0; humans int:=0; finish timestamp with time zone;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
   AND coalesce(auth.jwt()->>'role','')<>'service_role' THEN
  RAISE EXCEPTION 'SERVER_ONLY';
 END IF;
 IF p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR length(p_result::text)>30000 THEN RAISE EXCEPTION 'BAD_MATCH_PAYLOAD'; END IF;
 rid:=p_result->>'round_id';m:=p_result->>'mode_id';map:=p_result->>'map_id';
 IF rid IS NULL OR length(rid)<12 OR length(rid)>128 THEN RAISE EXCEPTION 'BAD_ROUND_ID'; END IF;
 SELECT match_id INTO existing FROM xtank.matches WHERE server_round_id=rid;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'match_id',existing,'replayed',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.mode_defs WHERE mode_id=m AND enabled) OR
    NOT EXISTS(SELECT 1 FROM xtank.map_defs WHERE map_id=map AND enabled) THEN RAISE EXCEPTION 'BAD_MATCH_RULES'; END IF;
 IF jsonb_typeof(p_result->'participants')<>'array' OR jsonb_array_length(p_result->'participants') NOT BETWEEN 2 AND 8 THEN RAISE EXCEPTION 'BAD_PARTICIPANTS'; END IF;
 SELECT ruleset_id INTO rs FROM xtank.rulesets WHERE code='prototype_0_2_2';
 IF rs IS NULL THEN RAISE EXCEPTION 'NO_RULESET'; END IF;
 finish:=now();
 INSERT INTO xtank.matches(server_round_id,ruleset_id,mode_id,map_id,match_source,status,started_at,ended_at,seed,winning_team,results)
 VALUES(rid,rs,m,map,'official','completed',finish-make_interval(secs=>least(600,greatest(1,coalesce((p_result->>'elapsed_s')::int,300)))),finish,
   coalesce((p_result->>'seed')::bigint,0),nullif(p_result->>'winning_team','')::smallint,p_result- 'participants')
 RETURNING match_id INTO g;
 FOR v IN SELECT value FROM jsonb_array_elements(p_result->'participants') LOOP
  n:=n+1;
  slot:=coalesce((v->>'slot')::int,n);
  IF slot NOT BETWEEN 1 AND 8 OR coalesce((v->>'kills')::int,0) NOT BETWEEN 0 AND 200 OR coalesce((v->>'deaths')::int,0) NOT BETWEEN 0 AND 200
   OR coalesce((v->>'damage')::bigint,0) NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'INVALID_STATS'; END IF;
  who:=nullif(v->>'player_id','')::uuid;
  bot:=CASE WHEN who IS NULL THEN 'bot-'||slot ELSE NULL END;
  tank:=v->>'tank_id';
  IF NOT EXISTS(SELECT 1 FROM xtank.tank_defs WHERE tank_id=tank) THEN RAISE EXCEPTION 'INVALID_TANK'; END IF;
  IF who IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=who AND account_status='active') THEN RAISE EXCEPTION 'INVALID_PLAYER'; END IF;
    humans:=humans+1;
  END IF;
  iswin:=CASE WHEN v->>'is_winner' IS NULL THEN NULL ELSE (v->>'is_winner')::boolean END;
  INSERT INTO xtank.match_participants(match_id,slot_number,player_id,ai_identifier,tank_id,team,kills,deaths,assists,damage_done,flag_scores,placement,is_winner)
  VALUES(g,slot,who,bot,tank,nullif(v->>'team','')::smallint,coalesce((v->>'kills')::int,0),
    coalesce((v->>'deaths')::int,0),coalesce((v->>'assists')::int,0),
    coalesce((v->>'damage')::bigint,0),coalesce((v->>'flag_scores')::int,0),
    nullif(v->>'placement','')::smallint,iswin);
  IF who IS NOT NULL THEN
    xp:=20+5*coalesce((v->>'kills')::int,0)+CASE WHEN iswin IS TRUE THEN 20 ELSE 0 END;
    coin:=10+5*coalesce((v->>'kills')::int,0)+CASE WHEN iswin IS TRUE THEN 20 ELSE 0 END;
    INSERT INTO xtank.match_rewards(match_id,player_id,xp,currency_code,currency_amount) VALUES(g,who,xp,'COIN',coin);
  END IF;
 END LOOP;
 IF humans<2 THEN RAISE EXCEPTION 'OFFICIAL_REQUIRES_TWO_HUMANS'; END IF;
 FOR who IN SELECT player_id FROM xtank.match_rewards WHERE match_id=g ORDER BY player_id LOOP
   PERFORM xtank.settle_match_reward(g,who);
 END LOOP;
 PERFORM xtank.progress_quests_for_match(g);
 PERFORM xtank.advance_ranked_match(g);
 PERFORM xtank.progress_achievements_for_match(g);
 RETURN jsonb_build_object('ok',true,'match_id',g,'replayed',false,'players',humans);
END $function$
;
REVOKE ALL ON FUNCTION public.xtank_record_official_match(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_record_official_match(jsonb) TO service_role;