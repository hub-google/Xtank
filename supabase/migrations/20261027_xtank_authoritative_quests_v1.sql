
INSERT INTO xtank.quests(quest_id,display_name,cadence,condition_config,reward_config,enabled)
VALUES
('daily_play_1','每日首戰','daily','{"type":"matches","target":1}','{"COIN":30}',true),
('daily_kills_3','每日擊破 3 台','daily','{"type":"kills","target":3}','{"COIN":60}',true),
('weekly_win_3','每週勝利 3 場','weekly','{"type":"wins","target":3}','{"COIN":150}',true)
ON CONFLICT(quest_id) DO NOTHING;

CREATE OR REPLACE FUNCTION xtank.progress_quests_for_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m xtank.matches%ROWTYPE; player record; quest record; cycle text; increment_value int; target int; current_value bigint;
BEGIN
 SELECT * INTO m FROM xtank.matches WHERE match_id=p_match_id;
 IF NOT FOUND OR m.match_source<>'official' OR m.status<>'completed' THEN RAISE EXCEPTION 'OFFICIAL_MATCH_REQUIRED'; END IF;
 FOR player IN SELECT player_id,kills,is_winner FROM xtank.match_participants WHERE match_id=p_match_id AND player_id IS NOT NULL LOOP
  FOR quest IN SELECT * FROM xtank.quests WHERE enabled LOOP
    target:=coalesce((quest.condition_config->>'target')::integer,1);
    IF target<1 OR target>10000 THEN CONTINUE; END IF;
    increment_value:=CASE quest.condition_config->>'type'
      WHEN 'matches' THEN 1
      WHEN 'kills' THEN player.kills
      WHEN 'wins' THEN CASE WHEN player.is_winner THEN 1 ELSE 0 END
      ELSE 0 END;
    IF increment_value<=0 THEN CONTINUE; END IF;
    cycle:=CASE quest.cadence WHEN 'daily' THEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')
      WHEN 'weekly' THEN to_char(now() AT TIME ZONE 'UTC','IYYY-"W"IW')
      WHEN 'once' THEN 'once'
      ELSE null END;
    IF cycle IS NULL THEN CONTINUE; END IF;
    INSERT INTO xtank.player_quests(player_id,quest_id,cycle_key,progress,completed_at)
    VALUES(player.player_id,quest.quest_id,cycle,least(target,increment_value),
      CASE WHEN increment_value>=target THEN now() ELSE NULL END)
    ON CONFLICT(player_id,quest_id,cycle_key) DO UPDATE
    SET progress=least(target,xtank.player_quests.progress+EXCLUDED.progress),
        completed_at=coalesce(xtank.player_quests.completed_at,
          CASE WHEN xtank.player_quests.progress+EXCLUDED.progress>=target THEN now() ELSE NULL END);
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION xtank.progress_quests_for_match(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtank.progress_quests_for_match(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.xtank_quest_api(p_action text,p_quest_id text DEFAULT NULL,p_cycle_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); row_value xtank.player_quests%ROWTYPE; q xtank.quests%ROWTYPE; target int; coins bigint; current_cycle text;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active') THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED'; END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('quests',(
    SELECT coalesce(jsonb_agg(jsonb_build_object('quest_id',q.quest_id,'display_name',q.display_name,'cadence',q.cadence,
      'target',coalesce((q.condition_config->>'target')::integer,1),'reward',q.reward_config,
      'cycle_key',CASE q.cadence WHEN 'daily' THEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')
        WHEN 'weekly' THEN to_char(now() AT TIME ZONE 'UTC','IYYY-"W"IW') ELSE 'once' END,
      'progress',coalesce(pq.progress,0),'completed_at',pq.completed_at,'claimed_at',pq.claimed_at)
     ORDER BY q.quest_id),'[]'::jsonb)
     FROM xtank.quests q
     LEFT JOIN xtank.player_quests pq ON pq.quest_id=q.quest_id AND pq.player_id=me AND pq.cycle_key=
       CASE q.cadence WHEN 'daily' THEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')
         WHEN 'weekly' THEN to_char(now() AT TIME ZONE 'UTC','IYYY-"W"IW') ELSE 'once' END
     WHERE q.enabled AND q.cadence IN('daily','weekly','once')));
 ELSIF p_action='claim' THEN
  SELECT * INTO q FROM xtank.quests WHERE quest_id=p_quest_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEST_NOT_FOUND'; END IF;
  current_cycle:=CASE q.cadence WHEN 'daily' THEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')
    WHEN 'weekly' THEN to_char(now() AT TIME ZONE 'UTC','IYYY-"W"IW')
    WHEN 'once' THEN 'once' ELSE NULL END;
  IF current_cycle IS NULL OR p_cycle_key IS DISTINCT FROM current_cycle THEN RAISE EXCEPTION 'QUEST_PERIOD_EXPIRED'; END IF;
  SELECT * INTO row_value FROM xtank.player_quests WHERE player_id=me AND quest_id=p_quest_id AND cycle_key=p_cycle_key FOR UPDATE;
  IF NOT FOUND OR row_value.completed_at IS NULL OR row_value.progress<coalesce((q.condition_config->>'target')::integer,1)
    THEN RAISE EXCEPTION 'QUEST_NOT_COMPLETE'; END IF;
  IF row_value.claimed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'already_claimed',true); END IF;
  coins:=coalesce((q.reward_config->>'COIN')::bigint,0);
  IF coins<0 OR coins>100000 THEN RAISE EXCEPTION 'INVALID_REWARD'; END IF;
  IF coins>0 THEN
    PERFORM xtank.apply_wallet_delta(me,'COIN',coins,'quest',p_quest_id||':'||p_cycle_key,
      'quest:'||me::text||':'||p_quest_id||':'||p_cycle_key);
  END IF;
  UPDATE xtank.player_quests SET claimed_at=now() WHERE player_id=me AND quest_id=p_quest_id AND cycle_key=p_cycle_key;
  RETURN jsonb_build_object('ok',true,'claimed_coins',coins,'already_claimed',false);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_quest_api(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_quest_api(text,text,text) TO authenticated;
