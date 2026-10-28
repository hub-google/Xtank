-- User-requested deletion of unused party/MMR queue and replay data tables.
-- Existing records were checked as zero before this migration; fail closed otherwise.
DO $$
BEGIN
 IF (SELECT count(*) FROM xtank.parties)<>0 OR
    (SELECT count(*) FROM xtank.party_members)<>0 OR
    (SELECT count(*) FROM xtank.matchmaking_tickets)<>0 OR
    (SELECT count(*) FROM xtank.replay_files)<>0 THEN
   RAISE EXCEPTION 'UNEXPECTED_USER_DATA_CANCEL_DELETION';
 END IF;
END $$;
DROP TABLE IF EXISTS xtank.matchmaking_tickets;
DROP TABLE IF EXISTS xtank.party_members;
DROP TABLE IF EXISTS xtank.parties;
DROP TABLE IF EXISTS xtank.replay_files;