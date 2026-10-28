CREATE OR REPLACE FUNCTION public.xtank_liveops_api(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); eventid uuid; offerid uuid;
  code text; title text; kind text; start_at timestamptz; end_at timestamptz;
  target int; reward int; v_enabled boolean; before_value jsonb;
BEGIN
 IF actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM auth.users WHERE id=actor AND raw_app_meta_data->>'xtank_role'='admin'
 ) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>2048 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
 IF p_action='overview' THEN
  RETURN jsonb_build_object(
   'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.starts_at DESC),'[]'::jsonb)
     FROM (SELECT event_id,code,display_name,starts_at,ends_at,config,enabled
       FROM xtank.live_events ORDER BY starts_at DESC LIMIT 50)e),
   'offers',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.offer_key),'[]'::jsonb)
     FROM (SELECT offer_id,offer_key,unit_price,currency_code,enabled
       FROM xtank.shop_offers ORDER BY offer_key LIMIT 100)o));
 ELSIF p_action='create_event' THEN
   code:=lower(trim(coalesce(p_payload->>'code','')));
   title:=trim(coalesce(p_payload->>'name',''));
   kind:=p_payload->>'kind';
   IF code !~ '^[a-z0-9-]{3,40}$' OR length(title) NOT BETWEEN 3 AND 80
     OR kind NOT IN ('matches','kills','wins') THEN RAISE EXCEPTION 'INVALID_EVENT'; END IF;
   target:=(p_payload->>'target')::int;reward:=(p_payload->>'reward')::int;
   start_at:=(p_payload->>'starts_at')::timestamptz;
   end_at:=(p_payload->>'ends_at')::timestamptz;
   IF target NOT BETWEEN 1 AND 1000 OR reward NOT BETWEEN 0 AND 100000
     OR start_at IS NULL OR end_at IS NULL OR end_at<=start_at
     OR end_at>start_at+interval '90 days' OR start_at<now()-interval '1 day'
   THEN RAISE EXCEPTION 'INVALID_EVENT_CONFIG'; END IF;
   INSERT INTO xtank.live_events(code,display_name,starts_at,ends_at,config,enabled)
   VALUES(code,title,start_at,end_at,jsonb_build_object('type',kind,'target',target,'coin_reward',reward),false)
   RETURNING event_id INTO eventid;
   INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,after_data)
   VALUES(actor,'create_event','live_event',eventid::text,
     jsonb_build_object('code',code,'name',title,'type',kind,'target',target,'reward',reward,'starts_at',start_at,'ends_at',end_at,'enabled',false));
   RETURN jsonb_build_object('ok',true,'event_id',eventid,'enabled',false);
 ELSIF p_action='toggle_event' THEN
   eventid:=(p_payload->>'event_id')::uuid;
   v_enabled:=(p_payload->>'enabled')::boolean;
   IF eventid IS NULL OR v_enabled IS NULL THEN RAISE EXCEPTION 'INVALID_EVENT'; END IF;
   SELECT to_jsonb(e) INTO before_value FROM xtank.live_events e WHERE e.event_id=eventid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
   UPDATE xtank.live_events SET enabled=v_enabled WHERE event_id=eventid;
   INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,before_data,after_data)
   VALUES(actor,'toggle_event','live_event',eventid::text,before_value,jsonb_build_object('enabled',v_enabled));
   RETURN jsonb_build_object('ok',true);
 ELSIF p_action='toggle_offer' THEN
   offerid:=(p_payload->>'offer_id')::uuid;
   v_enabled:=(p_payload->>'enabled')::boolean;
   IF offerid IS NULL OR v_enabled IS NULL THEN RAISE EXCEPTION 'INVALID_OFFER'; END IF;
   SELECT to_jsonb(o) INTO before_value FROM xtank.shop_offers o WHERE o.offer_id=offerid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'OFFER_NOT_FOUND'; END IF;
   UPDATE xtank.shop_offers SET enabled=v_enabled WHERE offer_id=offerid;
   INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,before_data,after_data)
   VALUES(actor,'toggle_offer','shop_offer',offerid::text,before_value,jsonb_build_object('enabled',v_enabled));
   RETURN jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $function$
;