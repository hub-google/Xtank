-- V2: serialize checkout by player, fix free offers and pack-line totals.
CREATE OR REPLACE FUNCTION xtank.buy_offer(p_player_id uuid,p_offer_id uuid,p_quantity int,p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE offer xtank.shop_offers%ROWTYPE; old_order xtank.shop_orders%ROWTYPE;
 order_uuid uuid; lvl int; total bigint; kind text; ref text; inv_id uuid; locked_player uuid;
BEGIN
 IF p_quantity IS NULL OR p_quantity<1 OR p_quantity>99 OR p_key IS NULL OR length(p_key)=0 THEN
  RAISE EXCEPTION 'INVALID_ORDER';
 END IF;
 -- Same player's concurrent retries must serialize before examining idempotency.
 SELECT player_id INTO locked_player FROM xtank.players WHERE player_id=p_player_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
 SELECT * INTO old_order FROM xtank.shop_orders WHERE idempotency_key=p_key;
 IF FOUND THEN
  IF old_order.player_id<>p_player_id OR old_order.status<>'paid' THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN old_order.order_id;
 END IF;
 SELECT * INTO offer FROM xtank.shop_offers WHERE offer_id=p_offer_id FOR SHARE;
 IF NOT FOUND OR NOT offer.enabled OR
    (offer.starts_at IS NOT NULL AND offer.starts_at>now()) OR
    (offer.ends_at IS NOT NULL AND offer.ends_at<=now()) THEN
   RAISE EXCEPTION 'OFFER_UNAVAILABLE';
 END IF;
 IF offer.stock_limit IS NOT NULL THEN RAISE EXCEPTION 'STOCK_LIMIT_NOT_IMPLEMENTED'; END IF;
 SELECT level INTO lvl FROM xtank.player_progress WHERE player_id=p_player_id;
 IF lvl IS NULL OR lvl<offer.min_level THEN RAISE EXCEPTION 'LEVEL_TOO_LOW'; END IF;
 total:=offer.unit_price*p_quantity;
 kind:=CASE WHEN offer.weapon_id IS NOT NULL THEN 'weapon' WHEN offer.item_id IS NOT NULL THEN 'item' ELSE 'cosmetic' END;
 ref:=coalesce(offer.weapon_id,offer.item_id,offer.cosmetic_id);
 IF total>0 THEN
  PERFORM xtank.apply_wallet_delta(p_player_id,offer.currency_code,-total,'shop',p_key,'shop:'||p_key);
 END IF;
 INSERT INTO xtank.shop_orders(player_id,currency_code,total_price,status,idempotency_key,completed_at)
  VALUES(p_player_id,offer.currency_code,total,'paid',p_key,now()) RETURNING order_id INTO order_uuid;
 INSERT INTO xtank.shop_order_lines(order_id,offer_id,item_ref,item_kind,quantity,unit_price)
  VALUES(order_uuid,p_offer_id,ref,kind,p_quantity,offer.unit_price);
 INSERT INTO xtank.player_inventory(player_id,weapon_id,item_id,cosmetic_id,quantity)
  VALUES(p_player_id,offer.weapon_id,offer.item_id,offer.cosmetic_id,offer.quantity*p_quantity)
  RETURNING inventory_id INTO inv_id;
 INSERT INTO xtank.inventory_ledger(player_id,inventory_id,item_kind,item_ref,quantity_delta,source_type,source_id,idempotency_key)
  VALUES(p_player_id,inv_id,kind,ref,offer.quantity*p_quantity,'shop',order_uuid::text,'inventory:shop:'||p_key);
 RETURN order_uuid;
END $$;
REVOKE ALL ON FUNCTION xtank.buy_offer(uuid,uuid,int,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION xtank.buy_offer(uuid,uuid,int,text) TO service_role;
-- Initial shop catalog: the P-design price suggestions from docs/16, not historical prices.
INSERT INTO xtank.shop_offers(offer_key,weapon_id,currency_code,unit_price,quantity,min_level,enabled)
 VALUES ('chemical_starter','chemical','COIN',150,1,1,true),
        ('ion_missile_starter','ion_missile','COIN',200,1,1,true),
        ('mine_starter','mine','COIN',100,1,1,true)
 ON CONFLICT(offer_key) DO NOTHING;
