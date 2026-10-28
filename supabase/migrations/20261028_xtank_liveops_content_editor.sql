CREATE OR REPLACE FUNCTION public.xtank_liveops_editor(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); eventid uuid; offerid uuid; eventrow xtank.live_events%ROWTYPE;
 offerrow xtank.shop_offers%ROWTYPE; target int; reward int; kind text; title text;
 v_starts_at timestamptz; v_ends_at timestamptz; price bigint; stock integer; before_row jsonb;
BEGIN
 IF actor IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.users WHERE id=actor AND raw_app_meta_data->>'xtank_role'='admin'
 ) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
   OR length(p_payload::text)>2048 THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
 IF p_action='audit' THEN
  RETURN jsonb_build_object('history',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb)
   FROM (SELECT actor_player_id,operation,entity_type,entity_id,created_at
    FROM xtank.audit_logs ORDER BY id DESC LIMIT 100)t));
 ELSIF p_action='edit_event' THEN
  eventid:=nullif(p_payload->>'event_id','')::uuid;
  SELECT * INTO eventrow FROM xtank.live_events WHERE event_id=eventid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  IF eventrow.enabled OR eventrow.starts_at<=now() OR EXISTS(
   SELECT 1 FROM xtank.live_event_progress WHERE event_id=eventid)
  THEN RAISE EXCEPTION 'EVENT_CANNOT_EDIT_AFTER_START_OR_PROGRESS'; END IF;
  title:=trim(coalesce(p_payload->>'name',''));
  kind:=p_payload->>'kind';target:=(p_payload->>'target')::int;
  reward:=(p_payload->>'reward')::int;
  v_starts_at:=(p_payload->>'starts_at')::timestamptz;
  v_ends_at:=(p_payload->>'ends_at')::timestamptz;
  IF length(title) NOT BETWEEN 3 AND 80 OR kind NOT IN ('matches','kills','wins')
   OR target NOT BETWEEN 1 AND 1000 OR reward NOT BETWEEN 0 AND 100000
   OR v_starts_at IS NULL OR v_ends_at IS NULL OR v_starts_at<now() OR v_ends_at<=v_starts_at OR v_ends_at>v_starts_at+interval '90 days'
  THEN RAISE EXCEPTION 'INVALID_EVENT_UPDATE'; END IF;
  before_row:=to_jsonb(eventrow);
  UPDATE xtank.live_events SET display_name=title,starts_at=v_starts_at,ends_at=v_ends_at,
   config=eventrow.config||jsonb_build_object('type',kind,'target',target,'coin_reward',reward)
  WHERE event_id=eventid;
  INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,before_data,after_data)
  SELECT actor,'edit_event','live_event',eventid::text,before_row,to_jsonb(e)
  FROM xtank.live_events e WHERE event_id=eventid;
  RETURN jsonb_build_object('ok',true,'event_id',eventid);
 ELSIF p_action='edit_offer' THEN
  offerid:=nullif(p_payload->>'offer_id','')::uuid;
  SELECT * INTO offerrow FROM xtank.shop_offers WHERE offer_id=offerid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OFFER_NOT_FOUND'; END IF;
  IF offerrow.enabled THEN RAISE EXCEPTION 'DISABLE_OFFER_BEFORE_EDIT'; END IF;
  price:=(p_payload->>'unit_price')::bigint;
  stock:=NULLIF(p_payload->>'stock_limit','')::int;
  IF price IS NULL OR price NOT BETWEEN 0 AND 100000000 OR stock IS NOT NULL AND stock NOT BETWEEN 0 AND 1000000
  THEN RAISE EXCEPTION 'INVALID_OFFER_UPDATE'; END IF;
  before_row:=to_jsonb(offerrow);
  UPDATE xtank.shop_offers SET unit_price=price,stock_limit=stock WHERE offer_id=offerid;
  INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,before_data,after_data)
  SELECT actor,'edit_offer','shop_offer',offerid::text,before_row,to_jsonb(o)
  FROM xtank.shop_offers o WHERE offer_id=offerid;
  RETURN jsonb_build_object('ok',true,'offer_id',offerid);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $function$
;
REVOKE ALL ON FUNCTION public.xtank_liveops_editor(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_liveops_editor(text,jsonb) TO authenticated;