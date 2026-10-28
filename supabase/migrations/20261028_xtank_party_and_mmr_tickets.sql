
-- Authenticated party management and durable MMR ticket creation.
CREATE UNIQUE INDEX IF NOT EXISTS xtank_party_one_membership ON xtank.party_members(player_id);
CREATE UNIQUE INDEX IF NOT EXISTS xtank_one_queued_ticket_per_player ON xtank.matchmaking_tickets(player_id) WHERE status='queued';
CREATE OR REPLACE FUNCTION public.xtank_party_queue_api(p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); pid uuid; vtarget uuid; vmode text; vregion text;
        vleader uuid; count_members int; vcount int;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active')
 THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>1024 THEN
  RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
 IF p_action='overview' THEN
   SELECT m.party_id INTO pid FROM xtank.party_members m JOIN xtank.parties p USING(party_id)
    WHERE m.player_id=me AND p.status='open' LIMIT 1;
   RETURN jsonb_build_object(
      'party_id',pid,
      'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',m.player_id,'name',pl.display_name,
      'leader',m.player_id=p.leader_id) ORDER BY m.joined_at),'[]'::jsonb)
       FROM xtank.party_members m JOIN xtank.players pl ON pl.player_id=m.player_id
       JOIN xtank.parties p USING(party_id) WHERE m.party_id=pid),
      'queue',(SELECT coalesce(jsonb_agg(jsonb_build_object('ticket_id',q.ticket_id,
       'mode',q.mode_id,'rating',q.rating,'status',q.status,'created_at',q.created_at)
       ORDER BY q.created_at DESC),'[]'::jsonb)
       FROM (SELECT * FROM xtank.matchmaking_tickets
       WHERE player_id=me ORDER BY created_at DESC LIMIT 10) q));
 ELSIF p_action='create' THEN
   IF EXISTS(SELECT 1 FROM xtank.party_members WHERE player_id=me) THEN RAISE EXCEPTION 'ALREADY_IN_PARTY'; END IF;
   INSERT INTO xtank.parties(leader_id,status) VALUES(me,'open') RETURNING party_id INTO pid;
   INSERT INTO xtank.party_members(party_id,player_id) VALUES(pid,me);
   RETURN jsonb_build_object('ok',true,'party_id',pid);
 ELSIF p_action='join' THEN
   pid:=nullif(p_payload->>'party_id','')::uuid;
   IF pid IS NULL THEN RAISE EXCEPTION 'INVALID_PARTY'; END IF;
   IF EXISTS(SELECT 1 FROM xtank.party_members WHERE player_id=me) THEN RAISE EXCEPTION 'ALREADY_IN_PARTY'; END IF;
   PERFORM 1 FROM xtank.parties WHERE party_id=pid AND status='open' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PARTY_NOT_OPEN'; END IF;
   SELECT count(*) INTO count_members FROM xtank.party_members WHERE party_id=pid;
   IF count_members>=4 THEN RAISE EXCEPTION 'PARTY_FULL'; END IF;
   IF EXISTS(SELECT 1 FROM xtank.matchmaking_tickets WHERE party_id=pid AND status='queued')
   THEN RAISE EXCEPTION 'PARTY_QUEUE_LOCKED'; END IF;
   INSERT INTO xtank.party_members(party_id,player_id) VALUES(pid,me);
   RETURN jsonb_build_object('ok',true,'party_id',pid);
 ELSIF p_action IN ('leave','kick','transfer') THEN
   SELECT m.party_id INTO pid FROM xtank.party_members m JOIN xtank.parties p USING(party_id)
    WHERE m.player_id=me AND p.status='open';
   IF pid IS NULL THEN RAISE EXCEPTION 'NOT_IN_PARTY'; END IF;
   SELECT leader_id INTO vleader FROM xtank.parties WHERE party_id=pid FOR UPDATE;
   IF EXISTS(SELECT 1 FROM xtank.matchmaking_tickets WHERE party_id=pid AND status='queued')
   THEN RAISE EXCEPTION 'CANCEL_QUEUE_FIRST'; END IF;
   IF p_action='leave' THEN
     IF vleader=me AND (SELECT count(*) FROM xtank.party_members WHERE party_id=pid)>1
     THEN RAISE EXCEPTION 'LEADER_MUST_TRANSFER'; END IF;
     DELETE FROM xtank.party_members WHERE party_id=pid AND player_id=me;
     IF vleader=me THEN
       UPDATE xtank.parties SET status='closed',closed_at=now() WHERE party_id=pid;
     END IF;
   ELSE
     IF vleader<>me THEN RAISE EXCEPTION 'LEADER_REQUIRED'; END IF;
     vtarget:=nullif(p_payload->>'target','')::uuid;
     IF vtarget IS NULL OR vtarget=me OR
       NOT EXISTS(SELECT 1 FROM xtank.party_members WHERE party_id=pid AND player_id=vtarget)
     THEN RAISE EXCEPTION 'INVALID_MEMBER'; END IF;
     IF p_action='kick' THEN DELETE FROM xtank.party_members WHERE party_id=pid AND player_id=vtarget;
     ELSE UPDATE xtank.parties SET leader_id=vtarget WHERE party_id=pid; END IF;
   END IF;
   RETURN jsonb_build_object('ok',true);
 ELSIF p_action IN ('queue','cancel') THEN
   SELECT m.party_id INTO pid FROM xtank.party_members m JOIN xtank.parties p USING(party_id)
   WHERE m.player_id=me AND p.status='open';
   IF pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM xtank.parties WHERE party_id=pid AND leader_id=me)
   THEN RAISE EXCEPTION 'LEADER_REQUIRED'; END IF;
   IF pid IS NOT NULL THEN PERFORM 1 FROM xtank.parties WHERE party_id=pid FOR UPDATE; END IF;
   UPDATE xtank.matchmaking_tickets SET status='expired',updated_at=now()
     WHERE status='queued' AND created_at<now()-interval '10 minutes';
   IF p_action='cancel' THEN
     UPDATE xtank.matchmaking_tickets SET status='cancelled',updated_at=now()
       WHERE status='queued' AND ((pid IS NULL AND player_id=me) OR (pid IS NOT NULL AND party_id=pid));
     RETURN jsonb_build_object('ok',true);
   END IF;
   vmode:=coalesce(p_payload->>'mode','FFA');
   vregion:=coalesce(p_payload->>'region','asia-east');
   IF vmode NOT IN ('FFA','TDM','FLAG_HOLD') OR vregion NOT IN ('asia-east','asia-south','us-west','eu-west')
   THEN RAISE EXCEPTION 'INVALID_QUEUE'; END IF;
   IF pid IS NULL THEN
     IF EXISTS(SELECT 1 FROM xtank.matchmaking_tickets WHERE player_id=me AND status='queued')
     THEN RAISE EXCEPTION 'ALREADY_QUEUED'; END IF;
     INSERT INTO xtank.matchmaking_tickets(player_id,mode_id,region,rating)
     VALUES(me,vmode,vregion,coalesce((SELECT pr.mmr FROM xtank.player_ratings pr
        JOIN xtank.seasons se USING(season_id) WHERE pr.player_id=me AND pr.mode_id=vmode
        AND se.status='active' ORDER BY se.starts_at DESC LIMIT 1),1000));
     vcount:=1;
   ELSE
     IF EXISTS(SELECT 1 FROM xtank.matchmaking_tickets
       WHERE status='queued' AND player_id IN (SELECT player_id FROM xtank.party_members WHERE party_id=pid))
     THEN RAISE EXCEPTION 'ALREADY_QUEUED'; END IF;
     INSERT INTO xtank.matchmaking_tickets(player_id,party_id,mode_id,region,rating)
     SELECT m.player_id,pid,vmode,vregion,coalesce((SELECT pr.mmr FROM xtank.player_ratings pr
       JOIN xtank.seasons se USING(season_id) WHERE pr.player_id=m.player_id AND pr.mode_id=vmode
       AND se.status='active' ORDER BY se.starts_at DESC LIMIT 1),1000)
     FROM xtank.party_members m WHERE m.party_id=pid;
     GET DIAGNOSTICS vcount=ROW_COUNT;
   END IF;
   RETURN jsonb_build_object('ok',true,'queued_players',vcount,'region',vregion,'mode',vmode);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_party_queue_api(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_party_queue_api(text,jsonb) TO authenticated;
