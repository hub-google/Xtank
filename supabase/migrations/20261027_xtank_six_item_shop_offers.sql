INSERT INTO xtank.shop_offers(offer_key,item_id,currency_code,unit_price,quantity,enabled)
VALUES
('repair_pack', 'repair', 'COIN', 25, 3, true),
('speed_boost_pack','speed_boost','COIN',20,3,true),
('shield_pack','shield_cell','COIN',25,3,true),
('radar_pack','radar_ping','COIN',20,3,true),
('smoke_pack','smoke','COIN',20,3,true),
('team_repair_pack','team_repair','COIN',35,3,true)
ON CONFLICT(offer_key) DO UPDATE SET
 item_id=excluded.item_id,currency_code=excluded.currency_code,
 unit_price=excluded.unit_price,quantity=excluded.quantity,enabled=excluded.enabled;