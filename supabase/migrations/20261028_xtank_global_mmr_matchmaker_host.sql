
-- Shared SQL coordinator: one durable claim for one online WSS host per tick.
CREATE OR REPLACE FUNCTION public.xtank_matchmaker_host(
 p_action text,p_server_id uuid DEFAULT NULL,p_endpoint text DEFAULT NULL,
 p_region text DEFAULT 'asia-east',p_room_code text DEFAULT NULL,p_player_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE serverid uuid; firstgroup record; secondgroup record; roomid uuid;
 roomcode text; tries int; myrole text;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 AND coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY'; END IF;
 IF p_action='validate' THEN
   RETURN jsonb_build_object('allowed',EXISTS(
     SELECT 1 FROM xtank.matchmaking_tickets t JOIN xtank.rooms r ON r.room_id=t.matched_room_id
     WHERE r.room_code=upper(coalesce(p_room_code,'')) AND t.player_id=p_player_id
       AND t.status='matched' AND r.phase='open' AND r.expires_at>now()));
 END IF;
 IF p_action NOT IN ('heartbeat','close_room') THEN RAISE EXCEPTION 'INVALID_ACTION'; END IF;
 IF p_action='close_room' THEN
   UPDATE xtank.rooms SET phase='closed' WHERE room_code=upper(coalesce(p_room_code,''))
     AND game_server_id=p_server_id AND phase IN ('open','ready_check','countdown','result');
   RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_endpoint IS NULL OR p_endpoint !~ '^wss://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^[:space:]]*)?$'
   OR length(p_endpoint)>200 OR p_region NOT IN ('asia-east','asia-south','us-west','eu-west')
 THEN RAISE EXCEPTION 'INVALID_PUBLIC_WSS'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('xtank-global-matchmaking-v1',0));
 UPDATE xtank.matchmaking_tickets SET status='expired',updated_at=now()
  WHERE status='queued' AND created_at<now()-interval '10 minutes';
 IF p_server_id IS NULL THEN
   INSERT INTO xtank.game_servers(server_name,region,endpoint_url,build_version,status,capacity,current_players,last_heartbeat_at)
   VALUES('X-TANK official WSS',p_region,p_endpoint,'0.2.2','online',256,0,now())
   RETURNING server_id INTO serverid;
 ELSE
   UPDATE xtank.game_servers SET endpoint_url=p_endpoint,region=p_region,status='online',
     last_heartbeat_at=now(),build_version='0.2.2' WHERE server_id=p_server_id
     RETURNING server_id INTO serverid;
   IF serverid IS NULL THEN RAISE EXCEPTION 'SERVER_NOT_REGISTERED'; END IF;
 END IF;
 SELECT g.* INTO firstgroup FROM (
   SELECT coalesce(t.party_id::text,t.ticket_id::text) group_key,t.mode_id,t.region,
          count(*) AS size,round(avg(coalesce(t.rating,1000)))::int AS mmr,min(t.created_at) AS queued_at
   FROM xtank.matchmaking_tickets t WHERE t.status='queued' AND t.region=p_region
   GROUP BY coalesce(t.party_id::text,t.ticket_id::text),t.mode_id,t.region
 ) g WHERE g.size BETWEEN 1 AND 4 ORDER BY g.queued_at LIMIT 1;
 IF FOUND THEN
   SELECT g.* INTO secondgroup FROM (
     SELECT coalesce(t.party_id::text,t.ticket_id::text) group_key,t.mode_id,t.region,
            count(*) AS size,round(avg(coalesce(t.rating,1000)))::int AS mmr,min(t.created_at) AS queued_at
     FROM xtank.matchmaking_tickets t WHERE t.status='queued' AND t.region=p_region
       AND t.mode_id=firstgroup.mode_id
     GROUP BY coalesce(t.party_id::text,t.ticket_id::text),t.mode_id,t.region
   ) g WHERE g.group_key<>firstgroup.group_key AND g.size BETWEEN 1 AND 4
     AND g.size+firstgroup.size<=8
     AND abs(g.mmr-firstgroup.mmr)<=least(600,150+floor(extract(epoch from now()-firstgroup.queued_at)/10)::int*25)
   ORDER BY abs(g.mmr-firstgroup.mmr),g.queued_at LIMIT 1;
   IF FOUND THEN
     roomcode:=upper(encode(gen_random_bytes(3),'hex'));
     FOR tries IN 1..5 LOOP
       EXIT WHEN NOT EXISTS(SELECT 1 FROM xtank.rooms WHERE room_code=roomcode);
       roomcode:=upper(encode(gen_random_bytes(3),'hex'));
     END LOOP;
     INSERT INTO xtank.rooms(room_code,game_server_id,mode_id,map_id,phase,allow_ai,capacity,expires_at)
     VALUES(roomcode,serverid,firstgroup.mode_id,'desk','open',true,8,now()+interval '10 minutes')
     RETURNING room_id INTO roomid;
     UPDATE xtank.matchmaking_tickets t SET status='matched',matched_room_id=roomid,updated_at=now()
     WHERE t.status='queued' AND t.region=firstgroup.region AND t.mode_id=firstgroup.mode_id
       AND coalesce(t.party_id::text,t.ticket_id::text) IN (firstgroup.group_key,secondgroup.group_key);
   END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'server_id',serverid,
   'rooms',(SELECT coalesce(jsonb_agg(jsonb_build_object('room_code',r.room_code,
     'mode',r.mode_id,'map_id',r.map_id)),'[]'::jsonb)
     FROM xtank.rooms r WHERE r.game_server_id=serverid AND r.phase='open' AND r.expires_at>now()));
END $$;
REVOKE ALL ON FUNCTION public.xtank_matchmaker_host(text,uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_matchmaker_host(text,uuid,text,text,text,uuid) TO service_role;

-- The player may read only their own match allocation and its safe public WSS URL.
CREATE OR REPLACE FUNCTION public.xtank_match_ticket_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid();
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 RETURN jsonb_build_object('tickets',(SELECT coalesce(jsonb_agg(
   jsonb_build_object('ticket_id',t.ticket_id,'status',t.status,'mode',t.mode_id,
   'created_at',t.created_at,'room_code',r.room_code,'endpoint',s.endpoint_url)
   ORDER BY t.created_at DESC),'[]'::jsonb)
   FROM (SELECT * FROM xtank.matchmaking_tickets WHERE player_id=me ORDER BY created_at DESC LIMIT 10) t
   LEFT JOIN xtank.rooms r ON r.room_id=t.matched_room_id
   LEFT JOIN xtank.game_servers s ON s.server_id=r.game_server_id));
END $$;
REVOKE ALL ON FUNCTION public.xtank_match_ticket_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_match_ticket_status() TO authenticated;
