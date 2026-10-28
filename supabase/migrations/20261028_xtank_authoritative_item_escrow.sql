-- Existing verified live definitions, captured 2026-10-28.
-- Full migration is additive and idempotent; backfill only if missing.
CREATE TABLE IF NOT EXISTS xtank.match_item_escrow (
 round_id text NOT NULL,player_id uuid NOT NULL REFERENCES xtank.players(player_id),item_id text NOT NULL REFERENCES xtank.item_defs(item_id),reserved int NOT NULL CHECK(reserved BETWEEN 1 AND 30),consumed int CHECK(consumed BETWEEN 0 AND 30),status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','released')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(round_id,player_id,item_id));
CREATE TABLE IF NOT EXISTS xtank.match_escrow_sessions (
 round_id text NOT NULL,player_id uuid NOT NULL REFERENCES xtank.players(player_id),status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','released')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(round_id,player_id));
ALTER TABLE xtank.match_item_escrow ENABLE ROW LEVEL SECURITY;
ALTER TABLE xtank.match_escrow_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtank.match_item_escrow,xtank.match_escrow_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON xtank.match_item_escrow,xtank.match_escrow_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.xtank_release_match_items(p_round_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v record;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 AND coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY'; END IF;
 IF EXISTS(SELECT 1 FROM xtank.matches WHERE server_round_id=p_round_id) THEN
   RAISE EXCEPTION 'SETTLED_ROUND_CANNOT_RELEASE'; END IF;
 FOR v IN SELECT * FROM xtank.match_escrow_sessions
   WHERE round_id=p_round_id AND status='reserved' ORDER BY player_id FOR UPDATE LOOP
   PERFORM 1 FROM xtank.players WHERE player_id=v.player_id FOR UPDATE;
   PERFORM xtank.refund_escrow_item(e.player_id,e.item_id,e.reserved)
     FROM xtank.match_item_escrow e
     WHERE e.round_id=p_round_id AND e.player_id=v.player_id AND e.status='reserved';
   UPDATE xtank.match_item_escrow SET status='released',updated_at=now()
     WHERE round_id=p_round_id AND player_id=v.player_id AND status='reserved';
   UPDATE xtank.match_escrow_sessions SET status='released',updated_at=now()
     WHERE round_id=p_round_id AND player_id=v.player_id;
 END LOOP;
 RETURN jsonb_build_object('ok',true);
END $function$
;

CREATE OR REPLACE FUNCTION public.xtank_reserve_match_items(p_round_id text, p_player_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v record; stock record; needed int; taken int; count_items int;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 AND coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY'; END IF;
 IF p_round_id IS NULL OR length(p_round_id) NOT BETWEEN 12 AND 128 OR p_player_id IS NULL
 OR p_items IS NULL OR jsonb_typeof(p_items)<>'object' OR length(p_items::text)>1024
 THEN RAISE EXCEPTION 'INVALID_RESERVATION'; END IF;
 PERFORM 1 FROM xtank.players WHERE player_id=p_player_id AND account_status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_INACTIVE'; END IF;
 INSERT INTO xtank.match_escrow_sessions(round_id,player_id) VALUES(p_round_id,p_player_id)
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM xtank.match_escrow_sessions
      WHERE round_id=p_round_id AND player_id=p_player_id AND status='reserved')
   THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
   RAISE EXCEPTION 'ESCROW_ALREADY_FINALIZED';
 END IF;
 SELECT count(*) INTO count_items FROM jsonb_object_keys(p_items);
 IF count_items>6 THEN RAISE EXCEPTION 'TOO_MANY_ITEM_TYPES'; END IF;
 FOR v IN SELECT key,value FROM jsonb_each_text(p_items) ORDER BY key LOOP
   IF v.key NOT IN ('repair','speed_boost','shield_cell','radar_ping','smoke','team_repair')
      OR v.value !~ '^[0-9]{1,2}$' OR v.value::int>30 THEN
      RAISE EXCEPTION 'INVALID_ESCROW_ITEM'; END IF;
   needed:=v.value::int;
   IF needed=0 THEN CONTINUE; END IF;
   INSERT INTO xtank.match_item_escrow(round_id,player_id,item_id,reserved)
       VALUES(p_round_id,p_player_id,v.key,needed);
   FOR stock IN SELECT inventory_id,quantity FROM xtank.player_inventory
       WHERE player_id=p_player_id AND item_id=v.key AND quantity>0
       ORDER BY acquired_at,inventory_id FOR UPDATE LOOP
     taken:=least(needed,stock.quantity);
     IF taken=stock.quantity THEN
       DELETE FROM xtank.player_inventory WHERE inventory_id=stock.inventory_id;
     ELSE
       UPDATE xtank.player_inventory SET quantity=quantity-taken,updated_at=now()
       WHERE inventory_id=stock.inventory_id;
     END IF;
     needed:=needed-taken;
     EXIT WHEN needed=0;
   END LOOP;
   IF needed>0 THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVED_ITEMS: %',v.key; END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'replayed',false);
END $function$
;

CREATE OR REPLACE FUNCTION xtank.consume_match_items(p_match_id uuid, p_result jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE participant jsonb; usage record; player uuid; escrow record; stock record;
 amount int; left_to_take int; taken int; itemid text; used int;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM xtank.matches WHERE match_id=p_match_id
   AND match_source='official' AND status='completed')
 THEN RAISE EXCEPTION 'OFFICIAL_MATCH_REQUIRED'; END IF;
 FOR participant IN SELECT value FROM jsonb_array_elements(p_result->'participants') LOOP
   player:=nullif(participant->>'player_id','')::uuid;
   IF player IS NULL THEN CONTINUE; END IF;
   IF NOT EXISTS(SELECT 1 FROM xtank.match_participants WHERE match_id=p_match_id AND player_id=player)
   THEN RAISE EXCEPTION 'INVALID_MATCH_PARTICIPANT'; END IF;
   PERFORM 1 FROM xtank.players WHERE player_id=player FOR UPDATE;
   IF p_result->>'reservation_version'='1' THEN
     PERFORM 1 FROM xtank.match_escrow_sessions WHERE round_id=p_result->>'round_id'
       AND player_id=player AND status='reserved' FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_ITEM_ESCROW'; END IF;
     IF jsonb_typeof(coalesce(participant->'items_used','{}'::jsonb))<>'object'
       THEN RAISE EXCEPTION 'INVALID_ITEM_COUNTS'; END IF;
     FOR usage IN SELECT * FROM jsonb_each_text(coalesce(participant->'items_used','{}'::jsonb)) LOOP
       IF usage.key NOT IN ('repair','speed_boost','shield_cell','radar_ping','smoke','team_repair')
       OR usage.value !~ '^[0-9]{1,2}$' OR usage.value::int>30
       THEN RAISE EXCEPTION 'INVALID_ITEM_COUNTS'; END IF;
       IF usage.value::int > coalesce((SELECT reserved FROM xtank.match_item_escrow
         WHERE round_id=p_result->>'round_id' AND player_id=player AND item_id=usage.key AND status='reserved'),0)
       THEN RAISE EXCEPTION 'ITEM_EXCEEDS_ESCROW'; END IF;
     END LOOP;
     FOR escrow IN SELECT * FROM xtank.match_item_escrow
       WHERE round_id=p_result->>'round_id' AND player_id=player AND status='reserved'
       ORDER BY item_id FOR UPDATE LOOP
       used:=coalesce((participant->'items_used'->>escrow.item_id)::int,0);
       IF used>0 THEN
         INSERT INTO xtank.match_item_consumptions(match_id,player_id,item_id,quantity)
         VALUES(p_match_id,player,escrow.item_id,used);
       END IF;
       PERFORM xtank.refund_escrow_item(player,escrow.item_id,escrow.reserved-used);
       UPDATE xtank.match_item_escrow SET consumed=used,status='settled',updated_at=now()
         WHERE round_id=escrow.round_id AND player_id=player AND item_id=escrow.item_id;
     END LOOP;
     UPDATE xtank.match_escrow_sessions SET status='settled',updated_at=now()
       WHERE round_id=p_result->>'round_id' AND player_id=player;
     CONTINUE;
   END IF;
   -- Backwards compatibility only for pre-escrow offline match payloads.
   IF participant->'items_used' IS NULL THEN CONTINUE; END IF;
   IF jsonb_typeof(participant->'items_used')<>'object' THEN RAISE EXCEPTION 'INVALID_ITEM_COUNTS'; END IF;
   FOR usage IN SELECT * FROM jsonb_each_text(participant->'items_used') LOOP
     itemid:=usage.key; IF itemid NOT IN ('repair','speed_boost','shield_cell','radar_ping','smoke','team_repair')
     THEN RAISE EXCEPTION 'UNKNOWN_ITEM'; END IF;
     amount:=usage.value::int;
     IF amount<0 OR amount>30 THEN RAISE EXCEPTION 'INVALID_ITEM_AMOUNT'; END IF;
     IF amount=0 THEN CONTINUE; END IF;
     INSERT INTO xtank.match_item_consumptions(match_id,player_id,item_id,quantity)
       VALUES(p_match_id,player,itemid,amount) ON CONFLICT DO NOTHING;
     IF NOT FOUND THEN CONTINUE; END IF;
     left_to_take:=amount;
     FOR stock IN SELECT inventory_id,quantity FROM xtank.player_inventory
       WHERE player_id=player AND item_id=itemid AND quantity>0
       ORDER BY acquired_at,inventory_id FOR UPDATE LOOP
       taken:=least(left_to_take,stock.quantity);
       IF taken=stock.quantity THEN DELETE FROM xtank.player_inventory WHERE inventory_id=stock.inventory_id;
       ELSE UPDATE xtank.player_inventory SET quantity=quantity-taken,updated_at=now() WHERE inventory_id=stock.inventory_id; END IF;
       left_to_take:=left_to_take-taken;EXIT WHEN left_to_take=0;
     END LOOP;
     IF left_to_take>0 THEN RAISE EXCEPTION 'INSUFFICIENT_MATCH_ITEMS: %',itemid; END IF;
   END LOOP;
 END LOOP;
END $function$
;

CREATE OR REPLACE FUNCTION xtank.refund_escrow_item(p_player uuid, p_item text, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE stack_id uuid;
BEGIN
 IF p_amount<=0 THEN RETURN; END IF;
 SELECT inventory_id INTO stack_id FROM xtank.player_inventory
 WHERE player_id=p_player AND item_id=p_item ORDER BY acquired_at,inventory_id LIMIT 1 FOR UPDATE;
 IF stack_id IS NULL THEN
   INSERT INTO xtank.player_inventory(player_id,item_id,quantity) VALUES(p_player,p_item,p_amount);
 ELSE
   UPDATE xtank.player_inventory SET quantity=quantity+p_amount,updated_at=now() WHERE inventory_id=stack_id;
 END IF;
END $function$
;
REVOKE ALL ON FUNCTION xtank.refund_escrow_item(uuid,text,int),xtank.consume_match_items(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtank.refund_escrow_item(uuid,text,int),xtank.consume_match_items(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.xtank_reserve_match_items(text,uuid,jsonb),public.xtank_release_match_items(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_reserve_match_items(text,uuid,jsonb),public.xtank_release_match_items(text) TO service_role;
