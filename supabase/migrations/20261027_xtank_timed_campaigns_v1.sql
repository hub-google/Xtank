
INSERT INTO xtank.live_events(code,display_name,starts_at,ends_at,config,enabled)
VALUES('launch-preseason-2026','開服預熱：完成 3 場正式戰鬥','2026-10-27T00:00:00Z','2026-11-27T00:00:00Z',
 '{"type":"matches","target":3,"coin_reward":120}'::jsonb,true)
ON CONFLICT(code) DO NOTHING;

CREATE OR REPLACE FUNCTION xtank.progress_events_for_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m xtank.matches%ROWTYPE; participant record; ev record; incr int; oldval int; target int;
BEGIN
 SELECT * INTO m FROM xtank.matches WHERE match_id=p_match_id;
 IF NOT FOUND OR m.status<>'completed' OR m.match_source<>'official' OR m.ended_at IS NULL
 THEN RAISE EXCEPTION 'OFFICIAL_MATCH_REQUIRED'; END IF;
 FOR participant IN SELECT player_id,kills,is_winner FROM xtank.match_participants
      WHERE match_id=p_match_id AND player_id IS NOT NULL LOOP
  FOR ev IN SELECT * FROM xtank.live_events
      WHERE enabled AND starts_at<=m.ended_at AND ends_at>m.ended_at LOOP
   target:=coalesce((ev.config->>'target')::int,1);
   IF target<1 OR target>1000 THEN CONTINUE; END IF;
   incr:=CASE ev.config->>'type'
     WHEN 'matches' THEN 1
     WHEN 'kills' THEN participant.kills
     WHEN 'wins' THEN CASE WHEN participant.is_winner THEN 1 ELSE 0 END
     ELSE 0 END;
   IF incr<=0 THEN CONTINUE; END IF;
   INSERT INTO xtank.live_event_progress(event_id,player_id,progress)
   VALUES(ev.event_id,participant.player_id,jsonb_build_object('value',least(incr,target)))
   ON CONFLICT(event_id,player_id) DO UPDATE
   SET progress=jsonb_build_object('value',least(target,
    coalesce((xtank.live_event_progress.progress->>'value')::int,0)+incr)),updated_at=now();
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION xtank.progress_events_for_match(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtank.progress_events_for_match(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.xtank_event_api(p_action text,p_event_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); eventrow xtank.live_events%ROWTYPE; state xtank.live_event_progress%ROWTYPE;
  coins bigint; target int; current int;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active')
 THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED'; END IF;
 IF p_action='list' THEN
   RETURN jsonb_build_object('events',(
    SELECT coalesce(jsonb_agg(jsonb_build_object(
       'id',e.event_id,'name',e.display_name,'start',e.starts_at,'end',e.ends_at,
       'target',coalesce((e.config->>'target')::int,1),
       'reward',coalesce((e.config->>'coin_reward')::int,0),
       'progress',coalesce((ep.progress->>'value')::int,0),
       'claimed_at',ep.claimed_at)
     ORDER BY e.ends_at ASC),'[]'::jsonb)
    FROM xtank.live_events e LEFT JOIN xtank.live_event_progress ep ON ep.event_id=e.event_id AND ep.player_id=me
    WHERE e.enabled AND e.starts_at<=now() AND e.ends_at+interval '7 days'>now()));
 ELSIF p_action='claim' THEN
  SELECT * INTO eventrow FROM xtank.live_events WHERE event_id=p_event_id AND enabled;
  IF NOT FOUND OR eventrow.ends_at+interval '7 days'<now() THEN RAISE EXCEPTION 'EVENT_EXPIRED'; END IF;
  SELECT * INTO state FROM xtank.live_event_progress
   WHERE event_id=p_event_id AND player_id=me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_COMPLETE'; END IF;
  target:=coalesce((eventrow.config->>'target')::int,1);
  current:=coalesce((state.progress->>'value')::int,0);
  IF current<target OR target<1 THEN RAISE EXCEPTION 'EVENT_NOT_COMPLETE'; END IF;
  IF state.claimed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'already_claimed',true); END IF;
  coins:=coalesce((eventrow.config->>'coin_reward')::bigint,0);
  IF coins<0 OR coins>100000 THEN RAISE EXCEPTION 'INVALID_REWARD'; END IF;
  IF coins>0 THEN PERFORM xtank.apply_wallet_delta(me,'COIN',coins,'event',eventrow.code,
    'event:'||eventrow.event_id::text||':'||me::text); END IF;
  UPDATE xtank.live_event_progress SET claimed_at=now(),updated_at=now()
   WHERE event_id=p_event_id AND player_id=me;
  RETURN jsonb_build_object('ok',true,'already_claimed',false,'coins',coins);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_event_api(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_event_api(text,uuid) TO authenticated;
