CREATE OR REPLACE FUNCTION public.xtank_community_api(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE me uuid:=auth.uid(); cid uuid; target uuid; mid uuid; txt text; nm text; tg text;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active') THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>4096 THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
 IF p_action IN ('send_dm','send_mail','send_clan_chat')
   AND EXISTS(SELECT 1 FROM xtank.chat_restrictions
     WHERE player_id=me AND muted_until>now())
 THEN RAISE EXCEPTION 'GLOBAL_CHAT_MUTED'; END IF;
 IF p_action='overview' THEN
  RETURN jsonb_build_object(
   'clans',(SELECT coalesce(jsonb_agg(jsonb_build_object('clan_id',c.clan_id,'name',c.clan_name,'tag',c.tag,
    'role',cm.role,'members',(SELECT count(*) FROM xtank.clan_members x WHERE x.clan_id=c.clan_id AND x.role<>'applicant'))),'[]'::jsonb)
     FROM xtank.clan_members cm JOIN xtank.clans c USING(clan_id) WHERE cm.player_id=me),
   'public_clans',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.clan_id,'name',x.clan_name,'tag',x.tag)),'[]'::jsonb)
     FROM (SELECT clan_id,clan_name,tag FROM xtank.clans WHERE status='active' ORDER BY created_at DESC LIMIT 30) x),
   'notifications',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
     (SELECT notification_id,kind,payload,created_at,read_at FROM xtank.notifications WHERE player_id=me ORDER BY created_at DESC LIMIT 30) x),
   'mail',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
     (SELECT mail_id,title,body,created_at,read_at,sender_id FROM xtank.mail_items
       WHERE recipient_id=me AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC LIMIT 30) x));
 ELSIF p_action='create_clan' THEN
  nm:=trim(coalesce(p_payload->>'name',''));tg:=upper(trim(coalesce(p_payload->>'tag','')));
  IF length(nm) NOT BETWEEN 3 AND 40 OR tg !~ '^[A-Z0-9]{2,6}$' THEN RAISE EXCEPTION 'INVALID_CLAN'; END IF;
  IF EXISTS(SELECT 1 FROM xtank.clan_members WHERE player_id=me AND role<>'applicant') THEN RAISE EXCEPTION 'ALREADY_IN_CLAN'; END IF;
  INSERT INTO xtank.clans(clan_name,tag,leader_id) VALUES(nm,tg,me) RETURNING clan_id INTO cid;
  INSERT INTO xtank.clan_members(clan_id,player_id,role) VALUES(cid,me,'leader');
  RETURN jsonb_build_object('ok',true,'clan_id',cid);
 ELSIF p_action='join_clan' THEN
  cid:=(p_payload->>'clan_id')::uuid;
  IF cid IS NULL OR NOT EXISTS(SELECT 1 FROM xtank.clans WHERE clan_id=cid AND status='active') THEN RAISE EXCEPTION 'CLAN_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM xtank.clan_members WHERE player_id=me AND role<>'applicant') THEN RAISE EXCEPTION 'ALREADY_IN_CLAN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(cid::text,0));
  IF (SELECT count(*) FROM xtank.clan_members WHERE clan_id=cid AND role<>'applicant')>=32 THEN RAISE EXCEPTION 'CLAN_FULL'; END IF;
  INSERT INTO xtank.clan_members(clan_id,player_id,role) VALUES(cid,me,'member')
   ON CONFLICT(clan_id,player_id) DO UPDATE SET role='member';
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='leave_clan' THEN
  cid:=(p_payload->>'clan_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM xtank.clan_members WHERE clan_id=cid AND player_id=me) THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
  IF EXISTS(SELECT 1 FROM xtank.clans WHERE clan_id=cid AND leader_id=me) THEN
    IF (SELECT count(*) FROM xtank.clan_members WHERE clan_id=cid)>1 THEN RAISE EXCEPTION 'LEADER_MUST_TRANSFER'; END IF;
    DELETE FROM xtank.clans WHERE clan_id=cid;
  ELSE
    DELETE FROM xtank.clan_members WHERE clan_id=cid AND player_id=me;
  END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='send_dm' OR p_action='send_mail' THEN
  target:=(p_payload->>'recipient_id')::uuid;txt:=trim(coalesce(p_payload->>'body',''));
  IF target IS NULL OR target=me OR NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=target AND account_status='active')
    THEN RAISE EXCEPTION 'INVALID_RECIPIENT'; END IF;
  IF EXISTS(SELECT 1 FROM xtank.player_blocks WHERE (player_id=me AND blocked_player_id=target)
             OR (player_id=target AND blocked_player_id=me)) THEN RAISE EXCEPTION 'BLOCKED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM xtank.friends WHERE status='accepted' AND
       ((player_id=me AND friend_id=target) OR (player_id=target AND friend_id=me))) THEN RAISE EXCEPTION 'NOT_FRIENDS'; END IF;
  IF length(txt) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_MESSAGE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(me::text,0));
  IF p_action='send_dm' THEN
    IF EXISTS(SELECT 1 FROM xtank.chat_messages WHERE sender_id=me AND channel='private' AND sent_at>now()-interval '1 second')
      THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
    INSERT INTO xtank.chat_messages(sender_id,recipient_id,channel,body) VALUES(me,target,'private',txt) RETURNING message_id INTO mid;
    INSERT INTO xtank.notifications(player_id,kind,payload) VALUES(target,'dm',jsonb_build_object('from',me,'message_id',mid));
  ELSE
    IF EXISTS(SELECT 1 FROM xtank.mail_items WHERE sender_id=me AND created_at>now()-interval '5 seconds')
      THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
    nm:=trim(coalesce(p_payload->>'title',''));
    IF length(nm) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_SUBJECT'; END IF;
    INSERT INTO xtank.mail_items(sender_id,recipient_id,title,body,attachments) VALUES(me,target,nm,txt,'[]'::jsonb)
      RETURNING mail_id INTO mid;
    INSERT INTO xtank.notifications(player_id,kind,payload) VALUES(target,'mail',jsonb_build_object('from',me,'mail_id',mid));
  END IF;
  RETURN jsonb_build_object('ok',true,'id',mid);
 ELSIF p_action='send_clan_chat' THEN
  cid:=(p_payload->>'clan_id')::uuid;txt:=trim(coalesce(p_payload->>'body',''));
  IF length(txt) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_MESSAGE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM xtank.clan_members WHERE clan_id=cid AND player_id=me AND role<>'applicant') THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(me::text,0));
  IF EXISTS(SELECT 1 FROM xtank.chat_messages WHERE sender_id=me AND channel='clan' AND sent_at>now()-interval '1 second')
   THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
  INSERT INTO xtank.chat_messages(sender_id,clan_id,channel,body) VALUES(me,cid,'clan',txt)
    RETURNING message_id INTO mid;
  RETURN jsonb_build_object('ok',true,'id',mid);
 ELSIF p_action='messages' THEN
  IF p_payload ? 'clan_id' THEN
   cid:=(p_payload->>'clan_id')::uuid;
   IF NOT EXISTS(SELECT 1 FROM xtank.clan_members WHERE clan_id=cid AND player_id=me AND role<>'applicant') THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
   RETURN jsonb_build_object('messages',(SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.sent_at),'[]'::jsonb) FROM
     (SELECT message_id,sender_id,body,sent_at FROM xtank.chat_messages WHERE clan_id=cid AND channel='clan' AND deleted_at IS NULL
       ORDER BY sent_at DESC LIMIT 50) z));
  ELSE
   target:=(p_payload->>'recipient_id')::uuid;
   IF target IS NULL OR NOT EXISTS(SELECT 1 FROM xtank.friends WHERE status='accepted' AND
       ((player_id=me AND friend_id=target) OR (player_id=target AND friend_id=me))) THEN RAISE EXCEPTION 'NOT_FRIENDS'; END IF;
   RETURN jsonb_build_object('messages',(SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.sent_at),'[]'::jsonb) FROM
     (SELECT message_id,sender_id,recipient_id,body,sent_at FROM xtank.chat_messages
       WHERE channel='private' AND deleted_at IS NULL AND
         ((sender_id=me AND recipient_id=target) OR (sender_id=target AND recipient_id=me))
       ORDER BY sent_at DESC LIMIT 50) z));
  END IF;
 ELSIF p_action='read_mail' THEN
  mid:=(p_payload->>'mail_id')::uuid;
  UPDATE xtank.mail_items SET read_at=coalesce(read_at,now()) WHERE recipient_id=me AND mail_id=mid;
  IF NOT FOUND THEN RAISE EXCEPTION 'MAIL_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='read_notification' THEN
  mid:=(p_payload->>'notification_id')::uuid;
  UPDATE xtank.notifications SET read_at=coalesce(read_at,now()) WHERE player_id=me AND notification_id=mid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='report' THEN
  target:=(p_payload->>'reported_id')::uuid;
  txt:=trim(coalesce(p_payload->>'reason',''));
  IF target IS NULL OR target=me OR length(txt) NOT BETWEEN 5 AND 200 THEN RAISE EXCEPTION 'INVALID_REPORT'; END IF;
  IF EXISTS(SELECT 1 FROM xtank.reports WHERE reporter_id=me AND reported_id=target AND created_at>now()-interval '1 hour')
    THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
  INSERT INTO xtank.reports(reporter_id,reported_id,reason,details)
  VALUES(me,target,txt,left(coalesce(p_payload->>'details',''),1000)) RETURNING report_id INTO mid;
  RETURN jsonb_build_object('ok',true,'report_id',mid);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $function$;
REVOKE ALL ON FUNCTION public.xtank_community_api(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xtank_community_api(text,jsonb) TO authenticated;