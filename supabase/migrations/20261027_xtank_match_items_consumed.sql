
CREATE TABLE IF NOT EXISTS xtank.match_item_consumptions(
 match_id uuid NOT NULL REFERENCES xtank.matches(match_id) ON DELETE CASCADE,
 player_id uuid NOT NULL REFERENCES xtank.players(player_id),
 item_id text NOT NULL REFERENCES xtank.item_defs(item_id),
 quantity int NOT NULL CHECK(quantity BETWEEN 1 AND 30),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(match_id,player_id,item_id)
);
ALTER TABLE xtank.match_item_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtank.match_item_consumptions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON xtank.match_item_consumptions TO service_role;

CREATE OR REPLACE FUNCTION xtank.consume_match_items(p_match_id uuid,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE participant jsonb; usage record; player uuid; stack record;
        amount int; left_to_take int; take_count int; itemid text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM xtank.matches WHERE match_id=p_match_id AND match_source='official' AND status='completed')
 THEN RAISE EXCEPTION 'OFFICIAL_MATCH_REQUIRED'; END IF;
 FOR participant IN SELECT value FROM jsonb_array_elements(p_result->'participants') LOOP
  player:=nullif(participant->>'player_id','')::uuid;
  IF player IS NULL THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM xtank.match_participants WHERE match_id=p_match_id AND player_id=player)
  THEN RAISE EXCEPTION 'INVALID_MATCH_PARTICIPANT'; END IF;
  IF participant->'items_used' IS NULL THEN CONTINUE; END IF;
  IF jsonb_typeof(participant->'items_used')<>'object' THEN RAISE EXCEPTION 'INVALID_ITEM_COUNTS'; END IF;
  -- Lock the profile, also locked by wallet shopping, to serialize stock changes.
  PERFORM 1 FROM xtank.players WHERE player_id=player FOR UPDATE;
  FOR usage IN SELECT * FROM jsonb_each_text(participant->'items_used') LOOP
   itemid:=usage.key;
   IF itemid NOT IN ('repair','speed_boost','shield_cell','radar_ping','smoke','team_repair')
   THEN RAISE EXCEPTION 'UNKNOWN_ITEM'; END IF;
   amount:=usage.value::int;
   IF amount<0 OR amount>30 THEN RAISE EXCEPTION 'INVALID_ITEM_AMOUNT'; END IF;
   IF amount=0 THEN CONTINUE; END IF;
   INSERT INTO xtank.match_item_consumptions(match_id,player_id,item_id,quantity)
   VALUES(p_match_id,player,itemid,amount) ON CONFLICT DO NOTHING;
   IF NOT FOUND THEN CONTINUE; END IF;
   left_to_take:=amount;
   FOR stack IN SELECT inventory_id,quantity FROM xtank.player_inventory
     WHERE player_id=player AND item_id=itemid AND quantity>0
     ORDER BY acquired_at,inventory_id FOR UPDATE LOOP
     take_count:=least(left_to_take,stack.quantity);
     UPDATE xtank.player_inventory SET quantity=quantity-take_count,updated_at=now()
       WHERE inventory_id=stack.inventory_id;
     left_to_take:=left_to_take-take_count;
     EXIT WHEN left_to_take=0;
   END LOOP;
   IF left_to_take>0 THEN RAISE EXCEPTION 'INSUFFICIENT_MATCH_ITEMS: %',itemid; END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION xtank.consume_match_items(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtank.consume_match_items(uuid,jsonb) TO service_role;
