
CREATE TABLE IF NOT EXISTS xtank.season_payouts(
 season_id uuid NOT NULL REFERENCES xtank.seasons(season_id),
 player_id uuid NOT NULL REFERENCES xtank.players(player_id),
 mode_id text NOT NULL,
 final_rank integer NOT NULL CHECK(final_rank>0),
 coins bigint NOT NULL CHECK(coins>=0 AND coins<=100000),
 granted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(season_id,player_id,mode_id)
);
ALTER TABLE xtank.season_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtank.season_payouts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON xtank.season_payouts TO service_role;

CREATE OR REPLACE FUNCTION xtank.close_expired_seasons()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE seasonrow record; participant record; prize bigint; granted int:=0; settled int:=0;
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN
  RAISE EXCEPTION 'SERVER_ONLY';
 END IF;
 FOR seasonrow IN SELECT * FROM xtank.seasons
    WHERE status='active' AND ends_at<=now()
    ORDER BY ends_at FOR UPDATE LOOP
  FOR participant IN
    SELECT player_id,mode_id,
      row_number() OVER(PARTITION BY mode_id ORDER BY rating DESC,wins DESC,updated_at ASC) AS rank,
      wins+losses AS played
    FROM xtank.player_ratings WHERE season_id=seasonrow.season_id
  LOOP
    prize:=CASE WHEN participant.played<3 THEN 0
      WHEN participant.rank=1 THEN 500
      WHEN participant.rank<=10 THEN 200
      WHEN participant.rank<=50 THEN 100
      ELSE 30 END;
    INSERT INTO xtank.season_payouts(season_id,player_id,mode_id,final_rank,coins)
    VALUES(seasonrow.season_id,participant.player_id,participant.mode_id,participant.rank,prize)
    ON CONFLICT(season_id,player_id,mode_id) DO NOTHING;
    IF FOUND THEN
      IF prize>0 THEN
        PERFORM xtank.apply_wallet_delta(participant.player_id,'COIN',prize,'season',
          seasonrow.code||':'||participant.mode_id,
          'season:'||seasonrow.season_id::text||':'||participant.player_id::text||':'||participant.mode_id);
      END IF;
      granted:=granted+1;
    END IF;
  END LOOP;
  UPDATE xtank.seasons SET status='completed' WHERE season_id=seasonrow.season_id;
  settled:=settled+1;
 END LOOP;
 RETURN jsonb_build_object('closed_seasons',settled,'payouts',granted);
END $$;
REVOKE ALL ON FUNCTION xtank.close_expired_seasons() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtank.close_expired_seasons() TO service_role;
